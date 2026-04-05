import { api } from "./client.js";

function toQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function parseDownloadFileName(contentDisposition, fallbackFileName = "export.csv") {
  const header = String(contentDisposition || "").trim();
  if (!header) {
    return fallbackFileName;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const bareMatch = header.match(/filename=([^;]+)/i);
  if (bareMatch?.[1]) {
    return bareMatch[1].trim();
  }

  return fallbackFileName;
}

export async function listPermissions(params = {}) {
  const response = await api.get(
    `/api/v1/security/permissions${toQueryString(params)}`
  );
  return response.data;
}

export async function listFieldVisibilityPolicies(params = {}) {
  const response = await api.get(
    `/api/v1/security/field-visibility-policies${toQueryString(params)}`
  );
  return response.data;
}

export async function getFieldVisibilityPolicy(policyId) {
  const response = await api.get(`/api/v1/security/field-visibility-policies/${policyId}`);
  return response.data;
}

export async function createFieldVisibilityPolicy(payload) {
  const response = await api.post("/api/v1/security/field-visibility-policies", payload);
  return response.data;
}

export async function updateFieldVisibilityPolicy(policyId, payload) {
  const response = await api.put(
    `/api/v1/security/field-visibility-policies/${policyId}`,
    payload
  );
  return response.data;
}

export async function deleteFieldVisibilityPolicy(policyId) {
  const response = await api.delete(`/api/v1/security/field-visibility-policies/${policyId}`);
  return response.data;
}

export async function listUsers(params = {}) {
  const response = await api.get(`/api/v1/security/users${toQueryString(params)}`);
  return response.data;
}

export async function createSecurityUser(payload) {
  const response = await api.post("/api/v1/security/users", payload);
  return response.data;
}

export async function createSecurityInvite(payload) {
  const response = await api.post("/api/v1/security/invites", payload);
  return response.data;
}

export async function getLocalUserAdminData() {
  const response = await api.get("/api/v1/security/local-user-admin");
  return response.data;
}

export async function assignLocalUserRole(payload) {
  const response = await api.post("/api/v1/security/local-user-admin/assignments", payload);
  return response.data;
}

export async function deleteLocalUserRoleAssignment(assignmentId) {
  const response = await api.delete(
    `/api/v1/security/local-user-admin/assignments/${assignmentId}`
  );
  return response.data;
}

export async function getEntityBranchOperatorAdminData() {
  const response = await api.get("/api/v1/security/entity-branch-operators");
  return response.data;
}

export async function assignEntityBranchOperator(payload) {
  const response = await api.post("/api/v1/security/entity-branch-operators", payload);
  return response.data;
}

export async function deleteEntityBranchOperatorAssignment(assignmentId) {
  const response = await api.delete(
    `/api/v1/security/entity-branch-operators/${assignmentId}`
  );
  return response.data;
}

export async function listRoles(params = {}) {
  const response = await api.get(`/api/v1/security/roles${toQueryString(params)}`);
  return response.data;
}

export async function createOrUpdateRole(payload) {
  const response = await api.post("/api/v1/security/roles", payload);
  return response.data;
}

export async function replaceRolePermissions(roleId, permissionCodes) {
  const response = await api.put(
    `/api/v1/security/roles/${roleId}/permissions`,
    { permissionCodes }
  );
  return response.data;
}

export async function listRoleAssignments(params = {}) {
  const response = await api.get(
    `/api/v1/security/role-assignments${toQueryString(params)}`
  );
  return response.data;
}

export async function createRoleAssignment(payload) {
  const response = await api.post("/api/v1/security/role-assignments", payload);
  return response.data;
}

export async function replaceRoleAssignmentScope(assignmentId, payload) {
  const response = await api.put(
    `/api/v1/security/role-assignments/${assignmentId}/scope`,
    payload
  );
  return response.data;
}

export async function deleteRoleAssignment(assignmentId) {
  const response = await api.delete(
    `/api/v1/security/role-assignments/${assignmentId}`
  );
  return response.data;
}

export async function listDataScopes(params = {}) {
  const response = await api.get(
    `/api/v1/security/data-scopes${toQueryString(params)}`
  );
  return response.data;
}

export async function listRoleMigrationRuns() {
  const response = await api.get("/api/v1/security/role-migrations");
  return response.data;
}

export async function getSecurityAdminUiState() {
  const response = await api.get("/api/v1/security/admin-ui-state");
  return response.data;
}

export async function previewRoleMigration(payload = {}) {
  const response = await api.post("/api/v1/security/role-migrations/preview", payload);
  return response.data;
}

export async function getRoleMigrationRun(runId) {
  const response = await api.get(`/api/v1/security/role-migrations/${runId}`);
  return response.data;
}

export async function executeRoleMigration(runId, payload = {}) {
  const response = await api.post(
    `/api/v1/security/role-migrations/${runId}/execute`,
    payload
  );
  return response.data;
}

export async function rollbackRoleMigration(runId) {
  const response = await api.post(
    `/api/v1/security/role-migrations/${runId}/rollback`
  );
  return response.data;
}

export async function replaceUserDataScopes(userId, scopes) {
  const response = await api.put(
    `/api/v1/security/data-scopes/users/${userId}/replace`,
    { scopes }
  );
  return response.data;
}

export async function listAuditLogs(params = {}) {
  const response = await api.get(`/api/v1/rbac/audit-logs${toQueryString(params)}`);
  return response.data;
}

export async function listRawAuditLogs(params = {}) {
  const response = await api.get(`/api/v1/rbac/raw-audit-logs${toQueryString(params)}`);
  return response.data;
}

export async function runRbacAccessCheck(payload = {}) {
  const response = await api.post("/api/v1/rbac/access-check", payload);
  return response.data;
}

export async function generateComplianceAuditReport(payload = {}) {
  const response = await api.post("/api/v1/rbac/audit-reports", payload);
  return response.data;
}

export async function exportComplianceAuditReportCsv(params = {}) {
  const response = await api.get(
    `/api/v1/rbac/audit-reports/export.csv${toQueryString(params)}`,
    {
      responseType: "blob",
    }
  );

  return {
    blob: response.data,
    fileName: parseDownloadFileName(
      response.headers?.["content-disposition"],
      `compliance-audit-report-${Date.now()}.csv`
    ),
    rowCount: Number(response.headers?.["x-export-row-count"] || 0) || 0,
  };
}

export async function listGroupCompanies() {
  const response = await api.get("/api/v1/org/group-companies");
  return response.data;
}

export async function listCountries() {
  const response = await api.get("/api/v1/org/countries");
  return response.data;
}

export async function listLegalEntities() {
  const response = await api.get("/api/v1/org/legal-entities");
  return response.data;
}

export async function listOperatingUnits() {
  const response = await api.get("/api/v1/org/operating-units");
  return response.data;
}
