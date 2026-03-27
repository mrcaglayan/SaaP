import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCariDocumentsFeatureSource } from "./_cariDocumentsFeatureSource.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const pageSource = await readCariDocumentsFeatureSource(root);
  const documentApiSource = await readFile(
    path.resolve(root, "frontend/src/api/cariDocuments.js"),
    "utf8"
  );

  assert(
    documentApiSource.includes("export async function listCariDocumentEvidence") &&
      documentApiSource.includes("export async function createCariDocumentEvidence") &&
      documentApiSource.includes("export async function uploadCariDocumentEvidenceContent") &&
      documentApiSource.includes("export async function downloadCariDocumentEvidence") &&
      documentApiSource.includes("export async function deleteCariDocumentEvidence"),
    "Cari document frontend API should expose evidence list/create/upload/download/delete clients"
  );

  assert(
    pageSource.includes("Evidence attachments") &&
      pageSource.includes("handleAttachEvidence") &&
      pageSource.includes("handleDownloadEvidence") &&
      pageSource.includes("handleDeleteEvidence") &&
      pageSource.includes("listCariDocumentEvidence") &&
      pageSource.includes("createCariDocumentEvidence") &&
      pageSource.includes("uploadCariDocumentEvidenceContent") &&
      pageSource.includes("downloadCariDocumentEvidence") &&
      pageSource.includes("deleteCariDocumentEvidence"),
    "CariDocumentsPage should provide evidence uploader/list/download/delete UI wired to evidence APIs"
  );

  assert(
    pageSource.includes("Missing permission: cari.doc.update") &&
      pageSource.includes("Attach Evidence"),
    "Evidence uploader UI should be permission-aware and expose attach action label"
  );

  console.log(
    "PR-UX21 smoke test passed (CARI evidence uploader/list/download/delete UI wiring)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
