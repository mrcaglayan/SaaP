import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool } from "../src/db.js";
import {
  apiRequest,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.SECURITY_UX_RBAC_04_TEST_PORT || 3152);
const BASE_URL =
  process.env.SECURITY_UX_RBAC_04_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

async function createBootstrapAdminSession(stamp) {
  const email = `ux_rbac04_admin_${stamp}@example.com`;
  const password = "UXRbac04Admin#12345";
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `UX_RBAC_04_${stamp}`,
    tenantName: `UX RBAC 04 ${stamp}`,
    adminEmail: email,
    adminPassword: password,
  });
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    email,
    password,
  };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const securityRouteSource = await readFile(
    path.resolve(rootDir, "backend/src/routes/security.js"),
    "utf8"
  );

  assert(
    pageSource.includes("WorkspaceLaneCard") &&
      pageSource.includes("People directory") &&
      pageSource.includes("Business assignment bundles") &&
      pageSource.includes("Raw role & package tools") &&
      pageSource.includes("Delegation & temporary coverage") &&
      pageSource.includes("resolveCoverageTemporalState") &&
      pageSource.includes("Invite expires") &&
      pageSource.includes("Effective from") &&
      pageSource.includes("Clear dates"),
    "UX-RBAC-04 should expose the calmer four-lane map, invited-user expiry, coverage lifecycle cues, and dated raw-role controls"
  );

  assert(
    workbenchSource.includes("people directory") &&
      workbenchSource.includes("Invite expires") &&
      workbenchSource.includes("Assignment window") &&
      workbenchSource.includes("Secondary / advanced") &&
      workbenchSource.includes("Raw role & package tools") &&
      workbenchSource.includes("Business assignment bundles"),
    "UserAssignmentWorkbench should surface invite expiry, temporal assignment windows, and secondary raw tooling language"
  );

  assert(
    securityRouteSource.includes("user_invites") &&
      securityRouteSource.includes("THEN 'INVITED'") &&
      securityRouteSource.includes("invite_status") &&
      securityRouteSource.includes("invite_expires_at") &&
      securityRouteSource.includes("base_status"),
    "Security users API should project pending invite metadata into the assignment workspace feed"
  );

  const stamp = Date.now();
  const admin = await createBootstrapAdminSession(stamp);
  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: admin.email,
      password: admin.password,
    });

    const invitedEmail = `ux_rbac04_invited_${stamp}@example.com`;
    const inviteResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/security/invites",
      expectedStatus: 201,
      body: {
        email: invitedEmail,
        name: "UX RBAC 04 Invited User",
      },
    });

    const invitedUserId = Number(inviteResponse.json?.invite?.userId || 0);
    assert(invitedUserId > 0, "Invite flow should return the invited tenant user id");
    assert(inviteResponse.json?.invite?.expiresAt, "Invite flow should return an expiry timestamp");

    const usersResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: "/api/v1/security/users",
      expectedStatus: 200,
    });
    const invitedRow =
      (Array.isArray(usersResponse.json?.rows) ? usersResponse.json.rows : []).find(
        (row) => Number(row.id) === invitedUserId
      ) || null;

    assert(invitedRow, "Users feed should include the invited tenant user");
    assert.equal(invitedRow?.status, "INVITED");
    assert.equal(invitedRow?.base_status, "DISABLED");
    assert.equal(invitedRow?.invite_status, "PENDING");
    assert.equal(Boolean(invitedRow?.invite_expires_at), true);
    assert.match(String(invitedRow?.email || ""), new RegExp(invitedEmail.replace(".", "\\."), "i"));

    console.log("test-security-ux-rbac-04-assignment-workspace-reorg passed");
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
