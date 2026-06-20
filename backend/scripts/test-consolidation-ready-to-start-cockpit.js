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

  const closeCyclesServiceSource = await readFile(
    path.resolve(root, "backend/src/services/close.cycles.service.js"),
    "utf8",
  );
  assert(
    closeCyclesServiceSource.includes("getConsolidationReadyToStartStatus"),
    "Close cockpit service must call getConsolidationReadyToStartStatus",
  );
  assert(
    closeCyclesServiceSource.includes("consolidationReadiness"),
    "Close cockpit response must include consolidationReadiness",
  );

  const closeCycleRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/close.cycles.routes.js"),
    "utf8",
  );
  assert(
    closeCycleRoutesSource.includes('"/cycles/:id/cockpit"') &&
      closeCycleRoutesSource.includes('requirePermission("close.cockpit.read"'),
    "Readiness must be exposed through the existing close cockpit route guarded by close.cockpit.read",
  );
  assert(
    !closeCycleRoutesSource.includes("consolidation-readiness"),
    "V1 must not add a standalone consolidation-readiness close route",
  );

  const generatorSource = await readFile(
    path.resolve(root, "backend/scripts/generate-openapi.js"),
    "utf8",
  );
  assert(
    generatorSource.includes("CloseCycleCockpitResponse") &&
      generatorSource.includes("ConsolidationReadiness") &&
      generatorSource.includes("#/components/schemas/CloseCycleCockpitResponse"),
    "OpenAPI generator must document the close cockpit consolidationReadiness payload",
  );

  const openapiSource = await readFile(
    path.resolve(root, "backend/openapi.yaml"),
    "utf8",
  );
  assert(
    openapiSource.includes('"CloseCycleCockpitResponse"') &&
      openapiSource.includes('"ConsolidationReadiness"') &&
      openapiSource.includes('"consolidationReadiness"') &&
      openapiSource.includes('"#/components/schemas/CloseCycleCockpitResponse"'),
    "Generated OpenAPI must include the close cockpit consolidationReadiness contract",
  );

  console.log(
    "Consolidation ready-to-start cockpit contract checks passed (cockpit payload + OpenAPI contract).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
