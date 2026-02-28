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
    path.resolve(root, "backend/src/migrations/m072_user_saved_views.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const meRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/me.js"),
    "utf8"
  );
  const savedViewServiceSource = await readFile(
    path.resolve(root, "backend/src/services/me.saved-views.service.js"),
    "utf8"
  );
  const meApiClientSource = await readFile(
    path.resolve(root, "frontend/src/api/me.js"),
    "utf8"
  );
  const cariDocumentsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );
  const cashTransactionsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );

  assert(
    migrationSource.includes("m072_user_saved_views") &&
      migrationSource.includes("CREATE TABLE IF NOT EXISTS user_saved_views") &&
      migrationSource.includes("view_payload_json") &&
      migrationSource.includes("is_default"),
    "Migration m072 should create user_saved_views table with JSON payload + default flag"
  );

  assert(
    migrationIndexSource.includes("m072_user_saved_views") &&
      migrationIndexSource.includes("migration072UserSavedViews"),
    "Migration index should register m072_user_saved_views"
  );

  assert(
    savedViewServiceSource.includes("listUserSavedViews") &&
      savedViewServiceSource.includes("createUserSavedView") &&
      savedViewServiceSource.includes("updateUserSavedView") &&
      savedViewServiceSource.includes("deleteUserSavedView"),
    "Saved-view service should expose list/create/update/delete operations"
  );

  assert(
    meRouteSource.includes('router.get("/saved-views"') &&
      meRouteSource.includes('router.post("/saved-views"') &&
      meRouteSource.includes('router.put("/saved-views/:savedViewId"') &&
      meRouteSource.includes('router.delete("/saved-views/:savedViewId"'),
    "/me routes should expose saved-view CRUD endpoints"
  );

  assert(
    meApiClientSource.includes("listMeSavedViews") &&
      meApiClientSource.includes("createMeSavedView") &&
      meApiClientSource.includes("updateMeSavedView") &&
      meApiClientSource.includes("deleteMeSavedView"),
    "Frontend me API client should expose saved-view CRUD helpers"
  );

  assert(
    cariDocumentsPageSource.includes("DOCUMENT_SAVED_VIEW_MODULE_CODE") &&
      cariDocumentsPageSource.includes("loadDocumentSavedViews") &&
      cariDocumentsPageSource.includes("handleCreateDocumentSavedView") &&
      cariDocumentsPageSource.includes("Saved Views (server-side)"),
    "CariDocumentsPage should integrate server-side saved views for list filters/table prefs"
  );

  assert(
    cashTransactionsPageSource.includes("CASH_TRANSACTION_SAVED_VIEW_MODULE_CODE") &&
      cashTransactionsPageSource.includes("loadTransactionSavedViews") &&
      cashTransactionsPageSource.includes("handleCreateTransactionSavedView") &&
      cashTransactionsPageSource.includes("Saved Views (server-side)"),
    "CashTransactionsPage should integrate server-side saved views for list filters/table prefs"
  );

  console.log(
    "PR-UX25 smoke test passed (server-side per-user saved views backend + Cari/Cash list integrations)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
