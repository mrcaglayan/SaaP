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
    path.resolve(root, "backend/src/migrations/m077_password_reset_tokens.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const resetServiceSource = await readFile(
    path.resolve(root, "backend/src/services/passwordReset.service.js"),
    "utf8"
  );
  const authRouteSource = await readFile(path.resolve(root, "backend/src/routes/auth.js"), "utf8");
  const authApiSource = await readFile(path.resolve(root, "frontend/src/api/auth.js"), "utf8");
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const loginPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/LoginPage.jsx"),
    "utf8"
  );
  const forgotPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/ForgotPasswordPage.jsx"),
    "utf8"
  );
  const resetPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/ResetPasswordPage.jsx"),
    "utf8"
  );
  const i18nSource = await readFile(path.resolve(root, "frontend/src/i18n/messages.js"), "utf8");

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS user_password_resets") &&
      migrationSource.includes("reset_token_hash") &&
      migrationSource.includes("status ENUM('PENDING','USED','REVOKED','EXPIRED')"),
    "Migration m077 should create user_password_resets with token hash and lifecycle statuses"
  );

  assert(
    migrationIndexSource.includes(
      'import migration077PasswordResetTokens from "./m077_password_reset_tokens.js"'
    ) && migrationIndexSource.includes("migration077PasswordResetTokens"),
    "Migration index should register m077_password_reset_tokens"
  );

  assert(
    resetServiceSource.includes("requestPasswordResetByEmail") &&
      resetServiceSource.includes("getPasswordResetPreviewByToken") &&
      resetServiceSource.includes("completePasswordResetByToken") &&
      resetServiceSource.includes("/reset-password?token="),
    "Password reset service should expose request/preview/complete with reset URL generation"
  );

  assert(
    authRouteSource.includes('router.post("/password-reset/request"') &&
      authRouteSource.includes('router.get("/password-reset/:token"') &&
      authRouteSource.includes('router.post("/password-reset/:token/complete"'),
    "Auth routes should expose password reset request/preview/complete endpoints"
  );

  assert(
    authApiSource.includes("export async function requestPasswordReset") &&
      authApiSource.includes("export async function getPasswordResetPreview") &&
      authApiSource.includes("export async function completePasswordReset"),
    "Frontend auth API should expose password reset request/preview/complete clients"
  );

  assert(
    appSource.includes('path="/forgot-password"') && appSource.includes('path="/reset-password"'),
    "App routes should include forgot-password and reset-password pages"
  );

  assert(
    loginPageSource.includes('to="/forgot-password"'),
    "Login page should expose forgot-password navigation"
  );

  assert(
    forgotPageSource.includes("requestPasswordReset") &&
      forgotPageSource.includes("resetLink") &&
      forgotPageSource.includes("copyLink"),
    "Forgot password page should request reset and expose copy-link UX"
  );

  assert(
    resetPageSource.includes("getPasswordResetPreview") &&
      resetPageSource.includes("completePasswordReset"),
    "Reset password page should validate token preview and complete reset"
  );

  assert(
    i18nSource.includes("passwordResetRequest: {") &&
      i18nSource.includes("passwordResetComplete: {"),
    "i18n messages should include password reset request/complete copy"
  );

  console.log("PR-UX33 smoke test passed (password reset token flow wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
