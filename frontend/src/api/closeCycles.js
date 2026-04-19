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

export async function createCloseCycle(payload) {
  const response = await api.post("/api/v1/close/cycles", payload);
  return response.data;
}

/**
 * Read the cockpit-owned cycle selector list without depending on the close
 * cycle management permission family.
 */
export async function listCloseCockpitCycles(params = {}) {
  const response = await api.get(`/api/v1/close/cockpit/cycles${toQueryString(params)}`);
  return response.data;
}

/**
 * Read manager-surface cycle headers for lifecycle targeting. This stays
 * separate from explicit close-cycle read routes so provision- or lock-only
 * operators can still select the cycles they are allowed to act on.
 */
export async function listCloseManagerCycles(params = {}) {
  const response = await api.get(`/api/v1/close/manager/cycles${toQueryString(params)}`);
  return response.data;
}

export async function listCloseCycles(params = {}) {
  const response = await api.get(`/api/v1/close/cycles${toQueryString(params)}`);
  return response.data;
}

export async function getCloseCycle(cycleId, params = {}) {
  const response = await api.get(
    `/api/v1/close/cycles/${cycleId}${toQueryString(params)}`
  );
  return response.data;
}

export async function provisionCloseCycle(cycleId, payload = {}) {
  const response = await api.post(`/api/v1/close/cycles/${cycleId}/provision`, payload);
  return response.data;
}

/**
 * Trigger the PR-02b cycle lock action for one close cycle once all terminal
 * dependencies are resolved on the backend.
 */
export async function lockCloseCycle(cycleId, payload = {}) {
  const response = await api.post(`/api/v1/close/cycles/${cycleId}/lock`, payload);
  return response.data;
}

export async function getCloseCycleCockpit(cycleId) {
  const response = await api.get(`/api/v1/close/cycles/${cycleId}/cockpit`);
  return response.data;
}

export async function getCloseCycleWorklist(cycleId) {
  const response = await api.get(`/api/v1/close/cycles/${cycleId}/worklist`);
  return response.data;
}

export async function getCloseCycleBlockers(cycleId) {
  const response = await api.get(`/api/v1/close/cycles/${cycleId}/blockers`);
  return response.data;
}

export async function getCloseCycleReadiness(cycleId) {
  const response = await api.get(`/api/v1/close/cycles/${cycleId}/readiness`);
  return response.data;
}

/**
 * Load the close-owned scope-option catalog used by the cycle manager create
 * form. This avoids coupling cycle creation to unrelated admin browse APIs.
 */
export async function listCloseCycleScopeOptions() {
  const response = await api.get("/api/v1/close/lookups/cycle-scope-options");
  return response.data;
}

/**
 * Load cycle-create fiscal periods from the close domain. Group cycles are
 * narrowed to the group's calendar, while entity cycles only surface periods
 * backed by LOCAL-book calendars that can later provision successfully.
 */
export async function listCloseCycleCreateFiscalPeriods(params = {}) {
  const response = await api.get(
    `/api/v1/close/lookups/fiscal-periods${toQueryString(params)}`,
  );
  return response.data;
}
