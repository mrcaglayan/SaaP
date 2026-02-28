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
    path.resolve(root, "backend/src/migrations/m076_user_invites_copy_link_flow.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const inviteServiceSource = await readFile(
    path.resolve(root, "backend/src/services/userInvites.service.js"),
    "utf8"
  );
  const securityRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/security.js"),
    "utf8"
  );
  const authRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/auth.js"),
    "utf8"
  );
  const rbacApiSource = await readFile(
    path.resolve(root, "frontend/src/api/rbacAdmin.js"),
    "utf8"
  );
  const authApiSource = await readFile(path.resolve(root, "frontend/src/api/auth.js"), "utf8");
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const userAssignmentsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const acceptInvitePageSource = await readFile(
    path.resolve(root, "frontend/src/pages/AcceptInvitePage.jsx"),
    "utf8"
  );
  const i18nSource = await readFile(path.resolve(root, "frontend/src/i18n/messages.js"), "utf8");

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS user_invites") &&
      migrationSource.includes("invite_token_hash") &&
      migrationSource.includes("status ENUM('PENDING','ACCEPTED','REVOKED','EXPIRED')"),
    "Migration m076 should create user_invites with token hash and lifecycle statuses"
  );

  assert(
    migrationIndexSource.includes(
      'import migration076UserInvitesCopyLinkFlow from "./m076_user_invites_copy_link_flow.js"'
    ) && migrationIndexSource.includes("migration076UserInvitesCopyLinkFlow"),
    "Migration index should register m076_user_invites_copy_link_flow"
  );

  assert(
    inviteServiceSource.includes("createInviteForTenantUser") &&
      inviteServiceSource.includes("getInvitePreviewByToken") &&
      inviteServiceSource.includes("acceptInviteByToken") &&
      inviteServiceSource.includes("/accept-invite?token="),
    "Invite service should expose create/preview/accept and generate copy-link URL"
  );

  assert(
    securityRoutesSource.includes('router.post(\n  "/invites"') &&
      securityRoutesSource.includes('requirePermission("security.role_assignment.upsert"'),
    "Security routes should expose invite creation endpoint with permission guard"
  );

  assert(
    authRoutesSource.includes('router.get("/invite/:token"') &&
      authRoutesSource.includes('router.post("/invite/:token/accept"'),
    "Auth routes should expose invite preview and accept endpoints"
  );

  assert(
    rbacApiSource.includes("export async function createSecurityInvite") &&
      authApiSource.includes("export async function getInvitePreview") &&
      authApiSource.includes("export async function acceptInvite"),
    "Frontend API clients should expose invite create/preview/accept methods"
  );

  assert(
    userAssignmentsPageSource.includes("createSecurityInvite") &&
      userAssignmentsPageSource.includes("inviteLink") &&
      userAssignmentsPageSource.includes("copyInviteLink"),
    "User assignments page should support invite-link generation and copy action"
  );

  assert(
    appSource.includes('path="/accept-invite"') &&
      acceptInvitePageSource.includes("getInvitePreview") &&
      acceptInvitePageSource.includes("acceptInvite"),
    "App should route /accept-invite and page should use preview/accept APIs"
  );

  assert(
    i18nSource.includes("inviteAccept: {") &&
      i18nSource.includes("Invite User (Copy Link)"),
    "i18n should include invite accept page and invite creation labels"
  );

  console.log("PR-UX32 smoke test passed (invite flow copy-link, no SMTP).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
