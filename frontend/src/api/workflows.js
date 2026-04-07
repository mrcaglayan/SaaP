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

export async function listWorkflowDefinitions(params = {}) {
  const response = await api.get(
    `/api/v1/workflows/definitions${toQueryString(params)}`
  );
  return response.data;
}

export async function createWorkflowDefinition(payload) {
  const response = await api.post("/api/v1/workflows/definitions", payload);
  return response.data;
}

export async function updateWorkflowDefinition(definitionId, payload) {
  const response = await api.patch(
    `/api/v1/workflows/definitions/${definitionId}`,
    payload
  );
  return response.data;
}

export async function listWorkflowDefinitionSteps(definitionId) {
  const response = await api.get(
    `/api/v1/workflows/definitions/${definitionId}/steps`
  );
  return response.data;
}

export async function replaceWorkflowDefinitionSteps(definitionId, payload) {
  const response = await api.post(
    `/api/v1/workflows/definitions/${definitionId}/steps`,
    payload
  );
  return response.data;
}

export async function listWorkflowAssignments(params = {}) {
  const response = await api.get(
    `/api/v1/workflows/assignments${toQueryString(params)}`
  );
  return response.data;
}

export async function createWorkflowAssignment(payload) {
  const response = await api.post("/api/v1/workflows/assignments", payload);
  return response.data;
}

export async function updateWorkflowAssignment(assignmentId, payload) {
  const response = await api.patch(
    `/api/v1/workflows/assignments/${assignmentId}`,
    payload
  );
  return response.data;
}

export async function runWorkflowCoverageDiagnostics(payload) {
  const response = await api.post("/api/v1/workflows/coverage-diagnostics", payload);
  return response.data;
}

export async function listWorkflowInstances(params = {}) {
  const response = await api.get(
    `/api/v1/workflows/instances${toQueryString(params)}`
  );
  return response.data;
}

export async function getWorkflowInstance(instanceId) {
  const response = await api.get(`/api/v1/workflows/instances/${instanceId}`);
  return response.data;
}

export async function approveWorkflowInstance(instanceId, payload = {}) {
  const response = await api.post(
    `/api/v1/workflows/instances/${instanceId}/approve`,
    payload
  );
  return response.data;
}

export async function rejectWorkflowInstance(instanceId, payload = {}) {
  const response = await api.post(
    `/api/v1/workflows/instances/${instanceId}/reject`,
    payload
  );
  return response.data;
}

export async function returnWorkflowInstance(instanceId, payload = {}) {
  const response = await api.post(
    `/api/v1/workflows/instances/${instanceId}/return`,
    payload
  );
  return response.data;
}

