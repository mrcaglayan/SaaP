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

export async function listInventoryTransfers(params = {}) {
  const response = await api.get(`/api/v1/inventory/transfers${toQueryString(params)}`);
  return response.data;
}

export async function getInventoryTransfer(transferId) {
  const response = await api.get(`/api/v1/inventory/transfers/${transferId}`);
  return response.data;
}

export async function createInventoryTransfer(payload) {
  const response = await api.post("/api/v1/inventory/transfers", payload);
  return response.data;
}

export async function approveInventoryTransfer(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/approve`, payload);
  return response.data;
}

export async function shipInventoryTransfer(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/ship`, payload);
  return response.data;
}

export async function receiveInventoryTransfer(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/receive`, payload);
  return response.data;
}

export async function cancelInventoryTransfer(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/cancel`, payload);
  return response.data;
}

export async function reverseInventoryTransfer(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/reverse`, payload);
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
