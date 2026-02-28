import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_EVIDENCE_STORAGE_ROOT = path.resolve(
  BACKEND_ROOT,
  "storage",
  "evidence"
);

function resolveStorageRoot() {
  const configuredRoot = String(process.env.EVIDENCE_STORAGE_ROOT || "").trim();
  if (!configuredRoot) {
    return DEFAULT_EVIDENCE_STORAGE_ROOT;
  }
  if (path.isAbsolute(configuredRoot)) {
    return path.resolve(configuredRoot);
  }
  // Keep relative env paths stable by resolving from backend root, not process cwd.
  return path.resolve(BACKEND_ROOT, configuredRoot);
}

function sanitizePathSegment(value, fallback = "x") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeRelativeStoragePath(storagePath) {
  const normalized = String(storagePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized || normalized.includes("..")) {
    throw badRequest("storagePath is invalid");
  }
  return normalized;
}

function resolveAbsoluteStoragePath(storagePath) {
  const root = resolveStorageRoot();
  const relativePath = normalizeRelativeStoragePath(storagePath);
  const absolutePath = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolutePath !== root && !absolutePath.startsWith(rootWithSep)) {
    throw badRequest("storagePath escapes evidence storage root");
  }
  return {
    root,
    relativePath,
    absolutePath,
  };
}

async function pruneEmptyDirectories(startDirectory, rootDirectory) {
  let current = startDirectory;
  while (current && current !== rootDirectory) {
    try {
      await rmdir(current);
      current = path.dirname(current);
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTEMPTY" || err?.code === "EEXIST") {
        return;
      }
      return;
    }
  }
}

export function buildEvidenceStoragePath({
  tenantId,
  legalEntityId,
  sourceRefType,
  sourceRefId,
  evidenceId,
  fileExtension = null,
}) {
  const tId = parsePositiveInt(tenantId);
  const leId = parsePositiveInt(legalEntityId);
  const srcId = parsePositiveInt(sourceRefId);
  const evId = parsePositiveInt(evidenceId);
  if (!tId || !leId || !srcId || !evId) {
    throw badRequest("Storage path scope identifiers are required");
  }

  const sourceType = sanitizePathSegment(sourceRefType, "SOURCE").toUpperCase();
  const extension = sanitizePathSegment(fileExtension || "", "").slice(0, 16).toLowerCase();
  const extensionSuffix = extension ? `.${extension}` : "";
  const stamp = Date.now();

  return [
    `tenant-${tId}`,
    `le-${leId}`,
    sourceType,
    `src-${srcId}`,
    `${evId}-${stamp}${extensionSuffix}`,
  ].join("/");
}

export async function writeEvidenceBinary({ storagePath, data }) {
  if (!(data instanceof Buffer)) {
    throw badRequest("Evidence upload payload must be binary");
  }
  const { relativePath, absolutePath } = resolveAbsoluteStoragePath(storagePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
  return {
    storagePath: relativePath,
    bytesWritten: data.length,
  };
}

export async function readEvidenceBinary({ storagePath }) {
  const { relativePath, absolutePath } = resolveAbsoluteStoragePath(storagePath);
  const data = await readFile(absolutePath);
  return {
    storagePath: relativePath,
    data,
  };
}

export async function deleteEvidenceBinary({ storagePath }) {
  const { root, relativePath, absolutePath } = resolveAbsoluteStoragePath(storagePath);
  try {
    await unlink(absolutePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }
  await pruneEmptyDirectories(path.dirname(absolutePath), root);
  return {
    storagePath: relativePath,
    deleted: true,
  };
}

export function getEvidenceStorageRoot() {
  return resolveStorageRoot();
}
