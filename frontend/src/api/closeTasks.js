import { api } from "./client.js";

function toQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/**
 * Read close checklist task templates for the tenant/global catalog.
 */
export async function listCloseTaskTemplates(params = {}) {
  const response = await api.get(`/api/v1/close/task-templates${toQueryString(params)}`);
  return response.data;
}

/**
 * Create a tenant close checklist task template override/catalog row.
 */
export async function createCloseTaskTemplate(payload = {}) {
  const response = await api.post("/api/v1/close/task-templates", payload);
  return response.data;
}

/**
 * Update a tenant-owned close checklist task template.
 */
export async function updateCloseTaskTemplate(templateId, payload = {}) {
  const response = await api.patch(`/api/v1/close/task-templates/${templateId}`, payload);
  return response.data;
}

/**
 * Disable a close checklist task template.
 */
export async function disableCloseTaskTemplate(templateId) {
  const response = await api.post(`/api/v1/close/task-templates/${templateId}/disable`);
  return response.data;
}

/**
 * Read close checklist task instances across cycles.
 */
export async function listCloseTasks(params = {}) {
  const response = await api.get(`/api/v1/close/tasks${toQueryString(params)}`);
  return response.data;
}

/**
 * Read close checklist task instances for one cycle.
 */
export async function listCloseCycleTasks(cycleId, params = {}) {
  const response = await api.get(
    `/api/v1/close/cycles/${cycleId}/tasks${toQueryString(params)}`,
  );
  return response.data;
}

/**
 * Read one close checklist task instance.
 */
export async function getCloseTask(taskId) {
  const response = await api.get(`/api/v1/close/tasks/${taskId}`);
  return response.data;
}

/**
 * Create a manual close checklist task inside an open close cycle.
 */
export async function createCloseTask(cycleId, payload = {}) {
  const response = await api.post(`/api/v1/close/cycles/${cycleId}/tasks`, payload);
  return response.data;
}

/**
 * Update close task metadata and assignment.
 */
export async function updateCloseTask(taskId, payload = {}) {
  const response = await api.patch(`/api/v1/close/tasks/${taskId}`, payload);
  return response.data;
}

/**
 * Execute a close task lifecycle action.
 */
export async function runCloseTaskAction(taskId, action, payload = {}) {
  const response = await api.post(`/api/v1/close/tasks/${taskId}/${action}`, payload);
  return response.data;
}

export const startCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "start", payload);
export const submitCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "submit", payload);
export const returnCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "return", payload);
export const approveCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "approve", payload);
export const waiveCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "waive", payload);
export const cancelCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "cancel", payload);
export const reopenCloseTask = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "reopen", payload);
export const refreshCloseTaskSourceCheck = (taskId, payload = {}) =>
  runCloseTaskAction(taskId, "refresh-source-check", payload);

/**
 * Read the task lifecycle event stream.
 */
export async function listCloseTaskEvents(taskId) {
  const response = await api.get(`/api/v1/close/tasks/${taskId}/events`);
  return response.data;
}

/**
 * Read task evidence links.
 */
export async function listCloseTaskEvidence(taskId) {
  const response = await api.get(`/api/v1/close/tasks/${taskId}/evidence`);
  return response.data;
}

/**
 * Attach an existing evidence object to a close task.
 */
export async function attachCloseTaskEvidence(taskId, payload = {}) {
  const response = await api.post(`/api/v1/close/tasks/${taskId}/evidence`, payload);
  return response.data;
}

/**
 * Upload or replace content for a task evidence object.
 */
export async function uploadCloseTaskEvidenceContent(taskId, evidenceId, payload = {}) {
  const response = await api.put(
    `/api/v1/close/tasks/${taskId}/evidence/${evidenceId}/content`,
    payload,
  );
  return response.data;
}

/**
 * Download task evidence content.
 */
export async function downloadCloseTaskEvidence(taskId, evidenceId) {
  const response = await api.get(
    `/api/v1/close/tasks/${taskId}/evidence/${evidenceId}/download`,
  );
  return response.data;
}

/**
 * Remove an evidence link from a close task.
 */
export async function removeCloseTaskEvidence(taskId, evidenceId, payload = {}) {
  const response = await api.delete(
    `/api/v1/close/tasks/${taskId}/evidence/${evidenceId}`,
    { data: payload },
  );
  return response.data;
}

/**
 * Read comments linked to one close task.
 */
export async function listCloseTaskComments(taskId) {
  const response = await api.get(`/api/v1/close/tasks/${taskId}/comments`);
  return response.data;
}

/**
 * Create a close task comment.
 */
export async function createCloseTaskComment(taskId, payload = {}) {
  const response = await api.post(`/api/v1/close/tasks/${taskId}/comments`, payload);
  return response.data;
}

/**
 * Delete a close task comment.
 */
export async function deleteCloseTaskComment(taskId, commentId) {
  const response = await api.delete(`/api/v1/close/tasks/${taskId}/comments/${commentId}`);
  return response.data;
}
