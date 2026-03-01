import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgValue(argv, flag) {
  const index = argv.findIndex((arg) => arg === flag);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

function hasArg(argv, flag) {
  return argv.includes(flag);
}

function parseUtcTimestamp(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/\s+UTC$/i, "Z")
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatUtc(date) {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function stampForFile(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function extractSection(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `##\\s+${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|\\s*$)`
  );
  const match = source.match(pattern);
  return match?.[1] ?? "";
}

function extractCodeBlocks(sectionSource) {
  const blocks = [];
  const regex = /```text\n([\s\S]*?)```/g;
  let match = regex.exec(sectionSource);
  while (match) {
    blocks.push(match[1].trim());
    match = regex.exec(sectionSource);
  }
  return blocks;
}

function extractDecision(source, sectionTitle) {
  const section = extractSection(source, sectionTitle);
  const decisionLine = section
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith("- decision:"));
  if (!decisionLine) return "PENDING";
  if (/\[x\]\s*APPROVED/i.test(decisionLine)) return "APPROVED";
  if (/\[x\]\s*REJECTED/i.test(decisionLine)) return "REJECTED";
  return "PENDING";
}

function extractMilestone(source, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`-\\s*${escaped}:\\s*(.+)$`, "mi");
  const match = source.match(regex);
  return parseUtcTimestamp(match?.[1] ?? "");
}

function hasAuditEvent(source, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i").test(source);
}

function extractLatestAuditContext(source, actionLabel) {
  const section = extractSection(source, "Approval Audit Trail");
  const rows = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  let latest = null;
  for (const row of rows) {
    if (/^\|\s*-+\s*\|/.test(row)) continue;
    const columns = row
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (columns.length < 5) continue;
    const [timestamp, actor, action, result, reference] = columns;
    if (action !== actionLabel) continue;
    const channelMatch = reference.match(/channel=([^;|]+)/i);
    const roleMatch = reference.match(/role=([^;|]+)/i);
    const proofMatch = reference.match(/proof=([^;|]+)/i);
    latest = {
      timestamp,
      actor,
      result,
      channel: channelMatch ? channelMatch[1].trim() : null,
      role: roleMatch ? roleMatch[1].trim().toLowerCase() : null,
      proof: proofMatch ? proofMatch[1].trim() : null,
    };
  }
  return latest;
}

function normalizeRoleArg(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "finance" || role === "product" || role === "both") return role;
  return "both";
}

function formatCliArgValue(value, fallback) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  if (/[\s"]/g.test(normalized)) {
    return `"${normalized.replace(/"/g, '\\"')}"`;
  }
  return normalized;
}

function resolveRecommendedAction(source, asOf) {
  const financeDecision = extractDecision(source, "Finance Operations Sign-Off");
  const productDecision = extractDecision(source, "Product Owner Sign-Off");
  const pendingRoles = [];
  if (financeDecision === "PENDING") pendingRoles.push("finance_operations");
  if (productDecision === "PENDING") pendingRoles.push("product_owner");

  const milestones = {
    dispatchTarget: extractMilestone(source, "Dispatch target timestamp (UTC)"),
    firstReminder: extractMilestone(source, "First reminder timestamp (UTC)"),
    secondReminder: extractMilestone(source, "Second reminder timestamp (UTC)"),
    finalDue: extractMilestone(source, "Final response due timestamp (UTC)"),
  };

  const sentEvents = {
    initialSent: hasAuditEvent(source, "Initial sign-off request sent"),
    reminder1Sent: hasAuditEvent(source, "Reminder #1 sent"),
    reminder2Sent: hasAuditEvent(source, "Reminder #2 sent"),
    escalationSent: hasAuditEvent(source, "Escalation sent"),
  };

  const preparedEvents = {
    initialPrepared: hasAuditEvent(source, "Initial sign-off request prepared"),
    reminder1Prepared: hasAuditEvent(source, "Reminder #1 prepared"),
    reminder2Prepared: hasAuditEvent(source, "Reminder #2 prepared"),
    escalationPrepared: hasAuditEvent(source, "Escalation prepared"),
  };
  const preparedContexts = {
    initialPrepared: extractLatestAuditContext(
      source,
      "Initial sign-off request prepared"
    ),
    reminder1Prepared: extractLatestAuditContext(source, "Reminder #1 prepared"),
    reminder2Prepared: extractLatestAuditContext(source, "Reminder #2 prepared"),
    escalationPrepared: extractLatestAuditContext(source, "Escalation prepared"),
  };

  let recommendedAction = "NO_ACTION";
  const initialSendDelayMs =
    !sentEvents.initialSent && milestones.dispatchTarget
      ? Math.max(0, asOf.getTime() - milestones.dispatchTarget.getTime())
      : 0;
  if (pendingRoles.length > 0) {
    const dispatchWindowOpen = milestones.dispatchTarget && asOf >= milestones.dispatchTarget;
    if (!sentEvents.initialSent) {
      if (dispatchWindowOpen && preparedEvents.initialPrepared) {
        recommendedAction = "CONFIRM_INITIAL_SEND";
      } else if (dispatchWindowOpen) {
        recommendedAction = "SEND_INITIAL_REQUESTS";
      } else {
        recommendedAction = "WAIT";
      }
    } else {
      if (milestones.finalDue && asOf >= milestones.finalDue) {
        if (sentEvents.escalationSent) {
          recommendedAction = "WAIT";
        } else if (preparedEvents.escalationPrepared) {
          recommendedAction = "CONFIRM_ESCALATION_SEND";
        } else {
          recommendedAction = "OVERDUE_ESCALATE";
        }
      } else if (
        milestones.secondReminder &&
        asOf >= milestones.secondReminder
      ) {
        if (sentEvents.reminder2Sent || sentEvents.escalationSent) {
          recommendedAction = "WAIT";
        } else if (preparedEvents.reminder2Prepared || preparedEvents.escalationPrepared) {
          recommendedAction = "CONFIRM_REMINDER_2_ESCALATION_SEND";
        } else {
          recommendedAction = "SEND_REMINDER_2_ESCALATE";
        }
      } else if (
        milestones.firstReminder &&
        asOf >= milestones.firstReminder
      ) {
        if (sentEvents.reminder1Sent) {
          recommendedAction = "WAIT";
        } else if (preparedEvents.reminder1Prepared) {
          recommendedAction = "CONFIRM_REMINDER_1_SEND";
        } else {
          recommendedAction = "SEND_REMINDER_1";
        }
      } else {
        recommendedAction = "WAIT";
      }
    }
  }

  return { recommendedAction, pendingRoles, preparedContexts, initialSendDelayMs };
}

function resolveTemplates(source) {
  const signoffSection = extractSection(
    source,
    "Sign-Off Request Package (Dispatch-Ready)"
  );
  const reminderSection = extractSection(source, "Reminder and Escalation Templates");

  const requestBlocks = extractCodeBlocks(signoffSection);
  const reminderBlocks = extractCodeBlocks(reminderSection);

  const financeInitial = requestBlocks.find((block) =>
    /Finance Ops/i.test(block)
  );
  const productInitial = requestBlocks.find((block) =>
    /Product Owner/i.test(block)
  );
  const reminder1 = reminderBlocks.find((block) => /Reminder #1/i.test(block));
  const reminder2 = reminderBlocks.find((block) =>
    /Reminder #2|Escalation/i.test(block)
  );

  if (!financeInitial || !productInitial || !reminder1 || !reminder2) {
    throw new Error(
      "Unable to resolve one or more templates from 13-PR-F13-GA-SIGNOFF-RECORD.md"
    );
  }

  return { financeInitial, productInitial, reminder1, reminder2 };
}

function buildMessages(action, templates) {
  if (action === "SEND_INITIAL_REQUESTS") {
    return [
      { role: "finance", kind: "initial", content: templates.financeInitial },
      { role: "product", kind: "initial", content: templates.productInitial },
    ];
  }
  if (action === "SEND_REMINDER_1") {
    return [
      { role: "finance", kind: "reminder1", content: templates.reminder1 },
      { role: "product", kind: "reminder1", content: templates.reminder1 },
    ];
  }
  if (action === "SEND_REMINDER_2_ESCALATE" || action === "OVERDUE_ESCALATE") {
    return [
      { role: "finance", kind: "reminder2_escalate", content: templates.reminder2 },
      { role: "product", kind: "reminder2_escalate", content: templates.reminder2 },
    ];
  }
  return [];
}

function buildFollowupHint(action, preparedContexts) {
  const contextByAction = {
    CONFIRM_INITIAL_SEND: preparedContexts?.initialPrepared ?? null,
    CONFIRM_REMINDER_1_SEND: preparedContexts?.reminder1Prepared ?? null,
    CONFIRM_REMINDER_2_ESCALATION_SEND:
      preparedContexts?.reminder2Prepared ??
      preparedContexts?.escalationPrepared ??
      null,
    CONFIRM_ESCALATION_SEND: preparedContexts?.escalationPrepared ?? null,
  };
  const selectedContext = contextByAction[action] ?? null;
  const roleArg = normalizeRoleArg(selectedContext?.role);
  const channelArg = formatCliArgValue(
    selectedContext?.channel,
    "<actual-channel>"
  );
  const proofArg = formatCliArgValue("<delivery-proof>", "<delivery-proof>");

  if (action === "CONFIRM_INITIAL_SEND") {
    return `cd backend && npm run ops:prf13-signoff-log-event -- --event initial_sent --role ${roleArg} --channel ${channelArg} --proof ${proofArg}`;
  }
  if (action === "CONFIRM_REMINDER_1_SEND") {
    return `cd backend && npm run ops:prf13-signoff-log-event -- --event reminder1_sent --role ${roleArg} --channel ${channelArg} --proof ${proofArg}`;
  }
  if (action === "CONFIRM_REMINDER_2_ESCALATION_SEND") {
    return `cd backend && npm run ops:prf13-signoff-log-event -- --event reminder2_sent --role ${roleArg} --channel ${channelArg} --proof ${proofArg}  # or escalation_sent`;
  }
  if (action === "CONFIRM_ESCALATION_SEND") {
    return `cd backend && npm run ops:prf13-signoff-log-event -- --event escalation_sent --role ${roleArg} --channel ${channelArg} --proof ${proofArg}`;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const signoffPath = path.resolve(repoRoot, "13-PR-F13-GA-SIGNOFF-RECORD.md");

  const asOfArg = parseArgValue(argv, "--asOf");
  const asOf = asOfArg ? parseUtcTimestamp(asOfArg) : new Date();
  if (!asOf) {
    throw new Error(
      "Invalid --asOf value. Use format like: 2026-03-02 06:31:54 UTC"
    );
  }

  const outDirArg = parseArgValue(argv, "--outDir");
  const outDir = outDirArg
    ? path.resolve(repoRoot, outDirArg)
    : path.resolve(repoRoot, "backend", "outbox", "prf13-signoff");
  const dryRun = hasArg(argv, "--dryRun");

  const source = await readFile(signoffPath, "utf8");
  const templates = resolveTemplates(source);
  const { recommendedAction, pendingRoles, preparedContexts, initialSendDelayMs } = resolveRecommendedAction(
    source,
    asOf
  );
  const messages = buildMessages(recommendedAction, templates);

  console.log("PR-F13 Sign-Off Outbox Generator");
  console.log("--------------------------------");
  console.log(`as_of_utc: ${formatUtc(asOf)}`);
  console.log(`recommended_action: ${recommendedAction}`);
  console.log(
    `pending_roles: ${pendingRoles.length ? pendingRoles.join(", ") : "none"}`
  );
  const contextForAction = (() => {
    if (recommendedAction === "CONFIRM_INITIAL_SEND") {
      return preparedContexts.initialPrepared;
    }
    if (recommendedAction === "CONFIRM_REMINDER_1_SEND") {
      return preparedContexts.reminder1Prepared;
    }
    if (recommendedAction === "CONFIRM_REMINDER_2_ESCALATION_SEND") {
      return preparedContexts.reminder2Prepared || preparedContexts.escalationPrepared;
    }
    if (recommendedAction === "CONFIRM_ESCALATION_SEND") {
      return preparedContexts.escalationPrepared;
    }
    return null;
  })();
  if (contextForAction) {
    console.log(
      `prepared_context: ${contextForAction.timestamp}; role=${contextForAction.role ?? "unknown"}; channel=${contextForAction.channel ?? "unknown"}; proof=${contextForAction.proof ?? "-"}`
    );
  }
  console.log(
    `initial_send_overdue_by: ${initialSendDelayMs > 0 ? formatDuration(initialSendDelayMs) : "none"}`
  );
  console.log(`outbox_dir: ${outDir}`);
  console.log(`dry_run: ${dryRun ? "yes" : "no"}`);

  if (messages.length === 0) {
    console.log("");
    console.log("No outbound messages generated for current action.");
    const hint = buildFollowupHint(recommendedAction, preparedContexts);
    if (hint) {
      console.log(`recommended_command: ${hint}`);
    }
    return;
  }

  const stamp = stampForFile(asOf);
  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
  }

  console.log("");
  console.log("files:");
  for (const message of messages) {
    const fileName = `${stamp}_${message.role}_${message.kind}.txt`;
    const filePath = path.resolve(outDir, fileName);
    if (!dryRun) {
      await writeFile(filePath, message.content + "\n", "utf8");
    }
    console.log(`  - ${filePath}`);
  }

  console.log("");
  if (dryRun) {
    console.log("Dry-run only. Re-run without --dryRun to write files.");
  } else {
    console.log("Outbox files generated. Send them through your approved channel.");
  }
}

main().catch((error) => {
  console.error("[prf13-signoff-generate-outbox] failed:", error.message);
  process.exitCode = 1;
});
