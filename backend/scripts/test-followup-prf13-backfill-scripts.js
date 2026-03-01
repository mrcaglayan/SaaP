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

  const packageJson = JSON.parse(
    await readFile(path.resolve(root, "backend/package.json"), "utf8")
  );

  const scripts = packageJson?.scripts || {};
  assert(
    scripts["backfill:workflow-defaults"] === "node scripts/backfill-workflow-defaults.js",
    "backend/package.json missing backfill:workflow-defaults script"
  );
  assert(
    scripts["backfill:tax-regimes"] === "node scripts/backfill-tax-regimes-from-country.js",
    "backend/package.json missing backfill:tax-regimes script"
  );
  assert(
    scripts["backfill:tax-account-mappings"] ===
      "node scripts/backfill-tax-account-mappings.js",
    "backend/package.json missing backfill:tax-account-mappings script"
  );
  assert(
    scripts["backfill:canonical-mappings"] ===
      "node scripts/backfill-canonical-consolidation-mappings.js",
    "backend/package.json missing backfill:canonical-mappings script"
  );

  const workflowBackfillSource = await readFile(
    path.resolve(root, "backend/scripts/backfill-workflow-defaults.js"),
    "utf8"
  );
  const taxRegimeBackfillSource = await readFile(
    path.resolve(root, "backend/scripts/backfill-tax-regimes-from-country.js"),
    "utf8"
  );
  const taxMappingBackfillSource = await readFile(
    path.resolve(root, "backend/scripts/backfill-tax-account-mappings.js"),
    "utf8"
  );
  const canonicalBackfillSource = await readFile(
    path.resolve(root, "backend/scripts/backfill-canonical-consolidation-mappings.js"),
    "utf8"
  );

  for (const [label, source] of [
    ["workflow", workflowBackfillSource],
    ["tax regimes", taxRegimeBackfillSource],
    ["tax mappings", taxMappingBackfillSource],
    ["canonical", canonicalBackfillSource],
  ]) {
    assert(source.includes("--apply"), `${label} backfill script must support --apply`);
    assert(
      source.includes("Dry-run only"),
      `${label} backfill script must provide dry-run guidance`
    );
  }

  console.log("PR-F13 backfill script checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
