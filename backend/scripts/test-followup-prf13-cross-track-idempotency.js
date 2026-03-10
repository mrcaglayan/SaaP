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

  const idempotencyServiceSource = await readFile(
    path.resolve(root, "backend/src/services/idempotency.service.js"),
    "utf8"
  );
  assert(
    idempotencyServiceSource.includes("executeIdempotentRequest") &&
      idempotencyServiceSource.includes(
        "Idempotency-Key was already used with a different request payload"
      ),
    "Shared idempotency service contract is missing"
  );

  const bankAccountsRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/bank.accounts.routes.js"),
    "utf8"
  );
  assert(
    bankAccountsRouteSource.includes('"/provision-control-parent-child"') &&
      !bankAccountsRouteSource.includes('"/provision-102-child"') &&
      bankAccountsRouteSource.includes("BANK_PROVISION_CONTROL_PARENT_CHILD") &&
      bankAccountsRouteSource.includes("parseIdempotencyKey") &&
      bankAccountsRouteSource.includes("executeIdempotentRequest") &&
      bankAccountsRouteSource.includes("idempotentReplay"),
    "Bank provisioning route should keep neutral idempotent replay protection without the deprecated alias"
  );

  const cariRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.js"),
    "utf8"
  );
  assert(
    cariRouteSource.includes("idempotentReplay") &&
      cariRouteSource.includes("/settlements/apply"),
    "CARI routes should expose idempotent replay contract for settlement apply flows"
  );

  const settlementServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cari.settlement.service.js"),
    "utf8"
  );
  assert(
    settlementServiceSource.includes("idempotencyKey is required") &&
      settlementServiceSource.includes("idempotentReplay") &&
      settlementServiceSource.includes("buildCariTaxAugmentation"),
    "Settlement service should keep idempotency + tax integration wiring"
  );

  const authRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/auth.js"),
    "utf8"
  );
  const securityRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/security.js"),
    "utf8"
  );
  assert(
    authRouteSource.includes("executeIdempotentRequest") &&
      securityRouteSource.includes("executeIdempotentRequest"),
    "Cross-module idempotency baseline should remain active in auth/security routes"
  );

  console.log("PR-F13 cross-track idempotency checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
