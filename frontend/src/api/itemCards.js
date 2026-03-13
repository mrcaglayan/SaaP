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

export async function listItemCards(params = {}) {
  const response = await api.get(`/api/v1/items/cards${toQueryString(params)}`);
  return response.data;
}

export async function getItemCard(itemCardId) {
  const response = await api.get(`/api/v1/items/cards/${itemCardId}`);
  return response.data;
}

export async function createItemCard(payload) {
  const response = await api.post("/api/v1/items/cards", payload);
  return response.data;
}

export async function updateItemCard(itemCardId, payload) {
  const response = await api.patch(`/api/v1/items/cards/${itemCardId}`, payload);
  return response.data;
}
