import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgValue(argv, flag) {
  const index = argv.findIndex((arg) => arg === flag);
  if (index === -1 || index + 1 >= argv.length) {
    return null;
  }
  return argv[index + 1];
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

function extractSection(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `##\\s+${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|\\s*$)`
  );
  const match = source.match(pattern);
  return match?.[1] ?? "";
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
  const regex = new RegExp(escaped, "i");
  return regex.test(source);
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

function buildRecommendedCommand(recommendedAction, preparedContexts) {
  const contextByAction = {
    CONFIRM_INITIAL_SEND: preparedContexts?.initialPrepared ?? null,
    CONFIRM_REMINDER_1_SEND: preparedContexts?.reminder1Prepared ?? null,
    CONFIRM_REMINDER_2_ESCALATION_SEND:
      preparedContexts?.reminder2Prepared ??
      preparedContexts?.escalationPrepared ??
      null,
    CONFIRM_ESCALATION_SEND: preparedContexts?.escalationPrepared ?? null,
  };
  const selectedContext = contextByAction[recommendedAction] ?? null;
  const roleArg = normalizeRoleArg(selectedContext?.role);
  const channelArg = formatCliArgValue(
    selectedContext?.channel,
    "<actual-channel>"
  );
  const proofArg = formatCliArgValue("<delivery-proof>", "<delivery-proof>");
  const logCmdBase =
    `cd backend && npm run ops:prf13-signoff-log-event -- --role ${roleArg} --channel ${channelArg} --proof ${proofArg}`;
  switch (recommendedAction) {
    case "CONFIRM_INITIAL_SEND":
      return `${logCmdBase} --event initial_sent`;
    case "CONFIRM_REMINDER_1_SEND":
      return `${logCmdBase} --event reminder1_sent`;
    case "CONFIRM_REMINDER_2_ESCALATION_SEND":
      return `${logCmdBase} --event reminder2_sent  # or --event escalation_sent`;
    case "CONFIRM_ESCALATION_SEND":
      return `${logCmdBase} --event escalation_sent`;
    case "SEND_INITIAL_REQUESTS":
      return "cd backend && npm run ops:prf13-signoff-generate-outbox";
    case "SEND_REMINDER_1":
      return 'cd backend && npm run ops:prf13-signoff-generate-outbox -- --asOf "2026-03-02 06:31:54 UTC"';
    case "SEND_REMINDER_2_ESCALATE":
      return 'cd backend && npm run ops:prf13-signoff-generate-outbox -- --asOf "2026-03-02 14:31:54 UTC"';
    case "OVERDUE_ESCALATE":
      return 'cd backend && npm run ops:prf13-signoff-generate-outbox -- --asOf "2026-03-02 18:31:54 UTC"';
    default:
      return null;
  }
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const signoffPath = path.resolve(repoRoot, "13-PR-F13-GA-SIGNOFF-RECORD.md");

  const asOfArg = parseArgValue(process.argv.slice(2), "--asOf");
  const asOf = asOfArg ? parseUtcTimestamp(asOfArg) : new Date();
  if (!asOf) {
    throw new Error(
      "Invalid --asOf value. Use format like: 2026-03-02 06:31:54 UTC"
    );
  }

  const source = await readFile(signoffPath, "utf8");

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
  let note = "No pending approvals.";

  if (pendingRoles.length > 0) {
    const dispatchWindowOpen = milestones.dispatchTarget && asOf >= milestones.dispatchTarget;
    const initialSendDelayMs =
      !sentEvents.initialSent && milestones.dispatchTarget
        ? Math.max(0, asOf.getTime() - milestones.dispatchTarget.getTime())
        : 0;
    if (!sentEvents.initialSent) {
      if (dispatchWindowOpen && preparedEvents.initialPrepared) {
        recommendedAction = "CONFIRM_INITIAL_SEND";
        note =
          `Initial outbound messages are prepared; reminders/escalation stay blocked until initial send is logged (overdue by ${formatDuration(initialSendDelayMs)} from dispatch target).`;
      } else if (dispatchWindowOpen) {
        recommendedAction = "SEND_INITIAL_REQUESTS";
        note =
          `Initial dispatch is not logged yet; send initial requests before any reminder/escalation actions (overdue by ${formatDuration(initialSendDelayMs)} from dispatch target).`;
      } else {
        recommendedAction = "WAIT";
        note = "Pending approvals exist, but initial dispatch window is not open yet.";
      }
    } else {
      if (milestones.finalDue && asOf >= milestones.finalDue) {
        if (sentEvents.escalationSent) {
          recommendedAction = "WAIT";
          note = "Overdue escalation already sent; await business responses.";
        } else if (preparedEvents.escalationPrepared) {
          recommendedAction = "CONFIRM_ESCALATION_SEND";
          note =
            "Escalation is prepared and overdue threshold is reached; confirm external send.";
        } else {
          recommendedAction = "OVERDUE_ESCALATE";
          note = "Final response due timestamp has passed and approvals are pending.";
        }
      } else if (
        milestones.secondReminder &&
        asOf >= milestones.secondReminder
      ) {
        if (sentEvents.reminder2Sent || sentEvents.escalationSent) {
          recommendedAction = "WAIT";
          note = "Second reminder/escalation already sent for this window.";
        } else if (preparedEvents.reminder2Prepared || preparedEvents.escalationPrepared) {
          recommendedAction = "CONFIRM_REMINDER_2_ESCALATION_SEND";
          note =
            "Second reminder/escalation content is prepared; confirm external send.";
        } else {
          recommendedAction = "SEND_REMINDER_2_ESCALATE";
          note = "Second reminder/escalation window is active.";
        }
      } else if (
        milestones.firstReminder &&
        asOf >= milestones.firstReminder
      ) {
        if (sentEvents.reminder1Sent) {
          recommendedAction = "WAIT";
          note = "First reminder already sent for this window.";
        } else if (preparedEvents.reminder1Prepared) {
          recommendedAction = "CONFIRM_REMINDER_1_SEND";
          note = "First reminder content is prepared; confirm external send.";
        } else {
          recommendedAction = "SEND_REMINDER_1";
          note = "First reminder window is active.";
        }
      } else {
        recommendedAction = "WAIT";
        note = "Initial send is logged; no reminder/escalation action is due yet.";
      }
    }
  }

  console.log("PR-F13 Sign-Off Status");
  console.log("----------------------");
  console.log(`as_of_utc: ${formatUtc(asOf)}`);
  console.log(`finance_decision: ${financeDecision}`);
  console.log(`product_decision: ${productDecision}`);
  console.log(
    `pending_roles: ${pendingRoles.length ? pendingRoles.join(", ") : "none"}`
  );
  console.log("");
  console.log("milestones_utc:");
  for (const [key, value] of Object.entries(milestones)) {
    console.log(`  - ${key}: ${value ? formatUtc(value) : "not_found"}`);
  }
  const initialSendDelayMs =
    !sentEvents.initialSent && milestones.dispatchTarget
      ? Math.max(0, asOf.getTime() - milestones.dispatchTarget.getTime())
      : 0;
  console.log(`initial_send_overdue_by: ${initialSendDelayMs > 0 ? formatDuration(initialSendDelayMs) : "none"}`);
  console.log("");
  console.log("send_events_detected:");
  for (const [key, value] of Object.entries(sentEvents)) {
    console.log(`  - ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("");
  console.log("prepared_events_detected:");
  for (const [key, value] of Object.entries(preparedEvents)) {
    console.log(`  - ${key}: ${value ? "yes" : "no"}`);
  }
  console.log("");
  console.log("prepared_event_context:");
  for (const [key, value] of Object.entries(preparedContexts)) {
    if (!value) {
      console.log(`  - ${key}: not_found`);
      continue;
    }
    console.log(
      `  - ${key}: ${value.timestamp}; role=${value.role ?? "unknown"}; channel=${value.channel ?? "unknown"}; proof=${value.proof ?? "-"}`
    );
  }
  console.log("");
  console.log(`recommended_action: ${recommendedAction}`);
  console.log(`note: ${note}`);
  const recommendedCommand = buildRecommendedCommand(
    recommendedAction,
    preparedContexts
  );
  if (recommendedCommand) {
    console.log(`recommended_command: ${recommendedCommand}`);
  }
  console.log("");
  console.log(
    "source: 13-PR-F13-GA-SIGNOFF-RECORD.md (Finance Operations Sign-Off, Product Owner Sign-Off, Response SLA and Follow-Up Cadence, Approval Audit Trail)"
  );
}

main().catch((error) => {
  console.error("[prf13-signoff-status] failed:", error.message);
  process.exitCode = 1;
});
