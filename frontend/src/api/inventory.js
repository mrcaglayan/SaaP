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

export async function listInventoryWarehouses(params = {}) {
  const response = await api.get(`/api/v1/inventory/warehouses${toQueryString(params)}`);
  return response.data;
}

export async function createInventoryWarehouse(payload) {
  const response = await api.post("/api/v1/inventory/warehouses", payload);
  return response.data;
}

export async function listInventoryCariStockLinks(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/cari-stock-links${toQueryString(params)}`
  );
  return response.data;
}

export async function listInventoryMovements(params = {}) {
  const response = await api.get(`/api/v1/inventory/movements${toQueryString(params)}`);
  return response.data;
}

export async function createInventoryMovement(payload) {
  const response = await api.post("/api/v1/inventory/movements", payload);
  return response.data;
}

export async function reverseInventoryMovement(movementId, payload = {}) {
  const response = await api.post(
    `/api/v1/inventory/movements/${movementId}/reverse`,
    payload
  );
  return response.data;
}

export async function listInventoryCostLayers(params = {}) {
  const response = await api.get(`/api/v1/inventory/cost-layers${toQueryString(params)}`);
  return response.data;
}
