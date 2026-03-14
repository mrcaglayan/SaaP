import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const readinessServiceSource = await readFile(
    path.resolve(root, "backend/src/services/tenant-readiness.service.js"),
    "utf8"
  );
  const i18nSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );

  const placeholderKeys = [
    "subaccountsV1",
    "setupWizardV2",
    "consolidationCanonicalMappingV1",
    "workflowCloseConsolidationV1",
    "taxEngineV1",
  ];

  for (const key of placeholderKeys) {
    const keyPattern = new RegExp(`key:\\s*["']${key}["']`);
    assert(
      keyPattern.test(readinessServiceSource),
      `Missing readiness placeholder key in tenant readiness service: ${key}`
    );
  }

  const minimumZeroMatches = (
    readinessServiceSource.match(/minimum:\s*0/g) || []
  ).length;
  assert(
    minimumZeroMatches >= placeholderKeys.length,
    "Expected warning-only readiness placeholders with minimum: 0"
  );

  for (const key of placeholderKeys) {
    assert(i18nSource.includes(`${key}:`), `Missing readiness i18n label for ${key}`);
  }

  console.log("PR-F01 readiness placeholder smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
