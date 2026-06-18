import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");
const repoRoot = path.resolve(backendRoot, "..");

function readSource(relativePath, root = backendRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

async function main() {
  const evidenceServiceSource = readSource("src/services/close.task-evidence.service.js");
  for (const contract of [
    "export async function createCloseTaskEvidenceDraft",
    "export async function uploadCloseTaskEvidenceContent",
    "export async function downloadCloseTaskEvidence",
    "assertEvidenceObjectAttachableToTask",
    "Evidence object is already attached to another source",
    "Evidence object is already attached to another close task",
    "writeEvidenceBinary",
    "readEvidenceBinary",
    "deleteEvidenceBinary",
    "fileSha256",
    "buildCloseTaskEvidenceStoragePath",
    '"close-task"',
    'eventType: "EVIDENCE_ATTACHED"',
    'eventType: "EVIDENCE_REMOVED"',
  ]) {
    assert(evidenceServiceSource.includes(contract), `Missing evidence contract: ${contract}`);
  }
  assert(!evidenceServiceSource.includes("NOT_IMPLEMENTED"));

  const routesSource = readSource("src/routes/close.tasks.routes.js");
  for (const contract of [
    '"/tasks/:taskId/evidence/drafts"',
    "evidenceBinaryUploadMiddleware",
    "express.raw",
    "createCloseTaskEvidenceDraft(input",
    "uploadCloseTaskEvidenceContent(",
    "downloadCloseTaskEvidence(input",
    "Content-Disposition",
    "Content-Length",
  ]) {
    assert(routesSource.includes(contract), `Missing route contract: ${contract}`);
  }

  const taskServiceSource = readSource("src/services/close.tasks.service.js");
  assert(taskServiceSource.includes("Evidence is required before this task can be submitted"));
  assert(taskServiceSource.includes("Evidence is required before this task can be approved"));

  const commentsServiceSource = readSource("src/services/close.task-comments.service.js");
  assert(commentsServiceSource.includes('eventType: "COMMENT_ADDED"'));
  assert(commentsServiceSource.includes("affectedRows"));
  assert(commentsServiceSource.includes("Task comment not found"));

  const eventsServiceSource = readSource("src/services/close.task-events.service.js");
  for (const auditedType of ["EVIDENCE_ATTACHED", "EVIDENCE_REMOVED", "COMMENT_ADDED"]) {
    assert(eventsServiceSource.includes(auditedType), `Missing audited type: ${auditedType}`);
  }

  const frontendApiSource = readSource("frontend/src/api/closeTasks.js", repoRoot);
  assert(frontendApiSource.includes("createCloseTaskEvidenceDraft"));
  assert(frontendApiSource.includes('"Content-Type": options.contentType'));
  assert(frontendApiSource.includes('responseType: "blob"'));

  const boardSource = readSource("frontend/src/pages/CloseTaskBoardPage.jsx", repoRoot);
  for (const contract of [
    "handleCreateEvidenceDraft",
    "createCloseTaskEvidenceDraft(selectedTask.id",
    "handleUploadEvidence",
    "handleDownloadEvidence",
    "downloadCloseTaskEvidence(selectedTask.id, evidenceId)",
    "uploadCloseTaskEvidenceContent(selectedTask.id, evidenceId, file",
    "row?.evidenceObjectId || row?.id",
  ]) {
    assert(boardSource.includes(contract), `Missing frontend board contract: ${contract}`);
  }

  console.log("test-close-task-prctm07-evidence-comments-audit passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
