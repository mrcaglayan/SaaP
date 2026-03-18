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

export async function listPayrollOwnershipAssignments(params = {}) {
  const response = await api.get(`/api/v1/payroll/ownership/assignments${toQueryString(params)}`);
  return response.data;
}

export async function getPayrollOwnershipAssignment(assignmentId) {
  const response = await api.get(`/api/v1/payroll/ownership/assignments/${assignmentId}`);
  return response.data;
}

export async function createPayrollOwnershipAssignment(payload = {}) {
  const response = await api.post("/api/v1/payroll/ownership/assignments", payload);
  return response.data;
}

export async function updatePayrollOwnershipAssignment(assignmentId, payload = {}) {
  const response = await api.patch(`/api/v1/payroll/ownership/assignments/${assignmentId}`, payload);
  return response.data;
}

export async function deactivatePayrollOwnershipAssignment(assignmentId) {
  const response = await api.post(
    `/api/v1/payroll/ownership/assignments/${assignmentId}/deactivate`
  );
  return response.data;
}
