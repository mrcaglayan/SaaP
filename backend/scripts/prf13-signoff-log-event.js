import { readFile, writeFile } from "node:fs/promises";
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

function sanitizeTableCell(value) {
  return String(value || "")
    .trim()
    .replace(/\|/g, "\\|");
}

function isSentEvent(event) {
  return /_sent$/.test(event);
}

function utcNow() {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "finance" || role === "product" || role === "both") return role;
  throw new Error("Invalid --role. Use: finance | product | both");
}

function normalizeEvent(value) {
  const event = String(value || "").trim().toLowerCase();
  const allowed = [
    "initial_prepared",
    "initial_sent",
    "reminder1_prepared",
    "reminder1_sent",
    "reminder2_prepared",
    "reminder2_sent",
    "escalation_prepared",
    "escalation_sent",
  ];
  if (allowed.includes(event)) return event;
  throw new Error(
    "Invalid --event. Use: initial_prepared | initial_sent | reminder1_prepared | reminder1_sent | reminder2_prepared | reminder2_sent | escalation_prepared | escalation_sent"
  );
}

function eventLabel(event) {
  if (event === "initial_prepared") return "Initial sign-off request prepared";
  if (event === "initial_sent") return "Initial sign-off request sent";
  if (event === "reminder1_prepared") return "Reminder #1 prepared";
  if (event === "reminder1_sent") return "Reminder #1 sent";
  if (event === "reminder2_prepared") return "Reminder #2 prepared";
  if (event === "reminder2_sent") return "Reminder #2 sent";
  if (event === "escalation_prepared") return "Escalation prepared";
  return "Escalation sent";
}

function roleToTableLabel(role) {
  if (role === "finance") return "Finance operations approver";
  if (role === "product") return "Product owner approver";
  return "Finance + Product approvers";
}

function roleToFollowupLabels(role) {
  if (role === "finance") return ["Finance operations approver"];
  if (role === "product") return ["Product owner approver"];
  return ["Finance operations approver", "Product owner approver"];
}

function followupAction(event) {
  if (event === "initial_prepared" || event === "initial_sent") {
    return "Initial sign-off request";
  }
  if (event === "reminder1_prepared" || event === "reminder1_sent") {
    return "Reminder #1";
  }
  if (event === "reminder2_prepared" || event === "reminder2_sent") {
    return "Reminder #2";
  }
  return "Escalation";
}

function followupNotes(event, channel, proof) {
  if (/_prepared$/.test(event)) {
    return `Prepared via channel=${channel}; pending external send`;
  }
  if (proof) {
    return `Sent via channel=${channel}; proof=${proof}`;
  }
  return `Sent via channel=${channel}`;
}

function findSectionBounds(source, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`##\\s+${escaped}\\r?\\n`));
  if (!match || typeof match.index !== "number") return null;
  const sectionStart = match.index;
  const afterHeading = sectionStart + match[0].length;
  const tail = source.slice(afterHeading);
  const nextHeadingMatch = tail.match(/\r?\n##\s+/);
  const sectionEnd = nextHeadingMatch
    ? afterHeading + nextHeadingMatch.index
    : source.length;
  return { sectionStart, afterHeading, sectionEnd };
}

function appendRowToSectionTable(source, heading, rowText) {
  const bounds = findSectionBounds(source, heading);
  if (!bounds) throw new Error(`Heading not found: ${heading}`);
  const section = source.slice(bounds.afterHeading, bounds.sectionEnd);
  const trimmed = section.replace(/\s+$/g, "");
  const nextSection = `${trimmed}\n${rowText}\n`;
  return source.slice(0, bounds.afterHeading) + nextSection + source.slice(bounds.sectionEnd);
}

async function main() {
  const argv = process.argv.slice(2);
  const event = normalizeEvent(parseArgValue(argv, "--event"));
  const role = normalizeRole(parseArgValue(argv, "--role"));
  const channel = parseArgValue(argv, "--channel") || "unspecified";
  const proof = parseArgValue(argv, "--proof");
  const actor = parseArgValue(argv, "--actor") || "Engineering";
  const timestamp = parseArgValue(argv, "--timestamp") || utcNow();
  const dryRun = hasArg(argv, "--dryRun");
  const dispatchStatus = /_prepared$/.test(event) ? "READY_TO_SEND" : "SENT";
  if (isSentEvent(event) && !String(proof || "").trim()) {
    throw new Error(
      "Missing --proof for *_sent events. Provide delivery evidence id/link."
    );
  }

  const safeChannel = sanitizeTableCell(channel);
  const safeProof = String(proof || "").trim()
    ? sanitizeTableCell(proof)
    : null;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const signoffPath = path.resolve(repoRoot, "13-PR-F13-GA-SIGNOFF-RECORD.md");

  let source = await readFile(signoffPath, "utf8");

  const dispatchNotes = safeProof
    ? `${eventLabel(event)} (proof: ${safeProof})`
    : eventLabel(event);
  const dispatchRow = `| ${timestamp} | ${roleToTableLabel(
    role
  )} | ${safeChannel} | ${dispatchStatus} | ${dispatchNotes} |`;
  source = appendRowToSectionTable(source, "Dispatch Log", dispatchRow);

  const auditReference = safeProof
    ? `role=${role}; channel=${safeChannel}; proof=${safeProof}`
    : `role=${role}; channel=${safeChannel}`;
  const auditRow = `| ${timestamp} | ${actor} | ${eventLabel(event)} | COMPLETE | ${auditReference} |`;
  source = appendRowToSectionTable(source, "Approval Audit Trail", auditRow);

  const followupRows = roleToFollowupLabels(role).map((label) => {
    const notes = sanitizeTableCell(followupNotes(event, safeChannel, safeProof));
    return `| ${timestamp} | ${label} | ${followupAction(event)} | ${dispatchStatus} | ${notes} |`;
  });
  for (const row of followupRows) {
    source = appendRowToSectionTable(source, "Follow-Up Log", row);
  }

  if (!dryRun) {
    await writeFile(signoffPath, source, "utf8");
  }

  console.log("PR-F13 Sign-Off Event Logger");
  console.log("---------------------------");
  console.log(`event: ${event}`);
  console.log(`role: ${role}`);
  console.log(`channel: ${safeChannel}`);
  console.log(`proof: ${safeProof ?? "-"}`);
  console.log(`actor: ${actor}`);
  console.log(`timestamp: ${timestamp}`);
  console.log(`dry_run: ${dryRun ? "yes" : "no"}`);
  console.log("");
  console.log("rows:");
  console.log(`  - dispatch_log: ${dispatchRow}`);
  console.log(`  - approval_audit_trail: ${auditRow}`);
  for (const row of followupRows) {
    console.log(`  - follow_up_log: ${row}`);
  }
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run without --dryRun to write changes.");
  } else {
    console.log("");
    console.log("Sign-off record updated.");
  }
}

main().catch((error) => {
  console.error("[prf13-signoff-log-event] failed:", error.message);
  process.exitCode = 1;
});
