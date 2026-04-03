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

export async function listApprovalDelegations(params = {}) {
  const response = await api.get(
    `/api/v1/approvals/delegations${toQueryString(params)}`
  );
  return response.data;
}

export async function createApprovalDelegation(payload = {}) {
  const response = await api.post("/api/v1/approvals/delegations", payload);
  return response.data;
}

export async function revokeApprovalDelegation(delegationId, payload = {}) {
  const response = await api.post(
    `/api/v1/approvals/delegations/${delegationId}/revoke`,
    payload
  );
  return response.data;
}

export async function getApprovalRequestDelegationPreview(requestId) {
  const response = await api.get(
    `/api/v1/approvals/requests/${requestId}/delegation-preview`
  );
  return response.data;
}

export async function approveApprovalRequest(requestId, payload = {}) {
  const response = await api.post(`/api/v1/approvals/requests/${requestId}/approve`, payload);
  return response.data;
}

export async function rejectApprovalRequest(requestId, payload = {}) {
  const response = await api.post(`/api/v1/approvals/requests/${requestId}/reject`, payload);
  return response.data;
}

export async function listMeApprovalDelegations(params = {}) {
  const response = await api.get(`/me/delegations${toQueryString(params)}`);
  return response.data;
}
