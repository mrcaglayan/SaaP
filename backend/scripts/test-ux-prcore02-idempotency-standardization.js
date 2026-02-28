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

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m079_idempotency_keys.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const utilsSource = await readFile(path.resolve(root, "backend/src/routes/_utils.js"), "utf8");
  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/idempotency.service.js"),
    "utf8"
  );
  const authRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/auth.js"),
    "utf8"
  );
  const securityRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/security.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS idempotency_keys") &&
      migrationSource.includes("uk_idempotency_scope_key"),
    "Migration m079 should create idempotency_keys with unique scope/key contract"
  );

  assert(
    migrationIndexSource.includes(
      'import migration079IdempotencyKeys from "./m079_idempotency_keys.js"'
    ) && migrationIndexSource.includes("migration079IdempotencyKeys"),
    "Migration index should register m079_idempotency_keys"
  );

  assert(
    utilsSource.includes("parseIdempotencyKey") &&
      utilsSource.includes("Idempotency-Key"),
    "Route utils should expose Idempotency-Key parser"
  );

  assert(
    serviceSource.includes("executeIdempotentRequest") &&
      serviceSource.includes("Idempotency-Key was already used with a different request payload"),
    "Idempotency service should provide shared replay + payload mismatch guard"
  );

  assert(
    authRoutesSource.includes('"/password-reset/request"') &&
      authRoutesSource.includes('"/password-reset/:token/complete"') &&
      authRoutesSource.includes('"/invite/:token/accept"') &&
      authRoutesSource.includes("idempotentReplay"),
    "Auth risky write endpoints should be standardized with idempotent replay contract"
  );

  assert(
    securityRoutesSource.includes('"/invites"') &&
      securityRoutesSource.includes("executeIdempotentRequest") &&
      securityRoutesSource.includes("idempotentReplay"),
    "Security invite creation endpoint should be standardized with idempotent replay contract"
  );

  console.log("PR-CORE02 smoke test passed (idempotency standardization wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
