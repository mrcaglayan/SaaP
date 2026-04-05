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
  const appLayoutSource = await readFile(
    path.resolve(root, "frontend/src/layouts/AppLayout.jsx"),
    "utf8"
  );
  const readinessGuardSource = await readFile(
    path.resolve(root, "frontend/src/readiness/RequireTenantReadiness.jsx"),
    "utf8"
  );
  const messagesSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );

  assert(
    appLayoutSource.includes("useLegalEntityActivation") &&
      appLayoutSource.includes("activationSummaryVisible") &&
      appLayoutSource.includes("layout.bootstrapCompletedActivationPendingPlural") &&
      appLayoutSource.includes("layout.activationOpenWorkspace") &&
      appLayoutSource.includes("refreshActivation();"),
    "AppLayout should keep the staged bootstrap/activation summary wired to LegalEntityActivationProvider"
  );

  assert(
    appLayoutSource.includes("currentWorkingActivationStatus") &&
      appLayoutSource.includes("layout.currentEntityActivationPending"),
    "AppLayout should surface the optional current-working-entity activation indicator"
  );

  assert(
    readinessGuardSource.includes("const ENTITY_ACTIVATION_ROUTE") &&
      readinessGuardSource.includes(
        "return <Navigate to={ENTITY_ACTIVATION_ROUTE} replace />;"
      ),
    "RequireTenantReadiness should route scoped setup users toward the activation workspace instead of tenant-wide bootstrap pages"
  );

  const stagedSummaryKeys = [
    "readinessStages",
    "bootstrapCompletedActivationPendingPlural",
    "activationOpenWorkspace",
    "currentEntityActivationPending",
  ];
  for (const key of stagedSummaryKeys) {
    const occurrences = (messagesSource.match(new RegExp(`${key}:`, "g")) || []).length;
    assert(
      occurrences >= 2,
      `messages.js should provide TR and EN copies for layout.${key}`
    );
  }

  console.log("PR-56 PR-5 guard/navigation cleanup static checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
