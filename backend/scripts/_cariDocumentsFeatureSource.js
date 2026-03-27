import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function listCariDocumentsSourceFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const entryPath = path.resolve(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listCariDocumentsSourceFiles(entryPath)));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".js" || extension === ".jsx") {
        files.push(entryPath);
      }
    }

    files.sort((left, right) => left.localeCompare(right));
    return files;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Reads the CARI documents page shell plus its extracted local modules as one
 * aggregated source string.
 *
 * The release-gate scripts use source inspection as a lightweight contract
 * check. After the workbench split, those checks should follow the feature's
 * local module boundary instead of assuming every handler and label remains
 * inline in `CariDocumentsPage.jsx`.
 *
 * @param {string} root
 * @returns {Promise<string>}
 */
export async function readCariDocumentsFeatureSource(root) {
  const cariDir = path.resolve(root, "frontend", "src", "pages", "cari");
  const featureFiles = new Set([
    path.resolve(cariDir, "CariDocumentsPage.jsx"),
    path.resolve(cariDir, "cariDocumentsPageHelpers.js"),
    path.resolve(cariDir, "cariDocumentsUtils.js"),
    path.resolve(cariDir, "counterpartyInlineCreate.js"),
    path.resolve(cariDir, "cariIdempotency.js"),
  ]);

  for (const directory of [
    path.resolve(cariDir, "components"),
    path.resolve(cariDir, "hooks"),
  ]) {
    for (const filePath of await listCariDocumentsSourceFiles(directory)) {
      featureFiles.add(filePath);
    }
  }

  const orderedFiles = [...featureFiles].sort((left, right) =>
    left.localeCompare(right)
  );
  const sources = await Promise.all(
    orderedFiles.map(async (filePath) => {
      const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
      const source = await readFile(filePath, "utf8");
      return `// FILE: ${relativePath}\n${source}`;
    })
  );

  return sources.join("\n\n");
}
