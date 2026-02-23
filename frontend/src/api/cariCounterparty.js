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

export async function listCariCounterparties(params = {}) {
  const response = await api.get(
    `/api/v1/cari/counterparties${toQueryString(params)}`
  );
  return response.data;
}

export async function getCariCounterparty(counterpartyId) {
  const response = await api.get(`/api/v1/cari/counterparties/${counterpartyId}`);
  return response.data;
}

export async function createCariCounterparty(payload) {
  const response = await api.post("/api/v1/cari/counterparties", payload);
  return response.data;
}

export async function updateCariCounterparty(counterpartyId, payload) {
  const response = await api.put(`/api/v1/cari/counterparties/${counterpartyId}`, payload);
  return response.data;
}
