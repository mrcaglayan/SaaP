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

export async function upsertInventoryWarehouse(payload) {
  const response = await api.post("/api/v1/inventory/warehouses", payload);
  return response.data;
}

export async function listInventoryTransferTargetWarehouses(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/transfers/warehouse-options/targets${toQueryString(params)}`
  );
  return response.data;
}

export async function listInventoryTransfers(params = {}) {
  const response = await api.get(`/api/v1/inventory/transfers${toQueryString(params)}`);
  return response.data;
}

export async function getInventoryTransfer(transferId, params = {}) {
  const response = await api.get(
    `/api/v1/inventory/transfers/${transferId}${toQueryString(params)}`
  );
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

export async function listInventoryTransferEvidence(transferId, params = {}) {
  const response = await api.get(
    `/api/v1/inventory/transfers/${transferId}/evidence${toQueryString(params)}`
  );
  return response.data;
}

export async function createInventoryTransferEvidence(transferId, payload = {}) {
  const response = await api.post(`/api/v1/inventory/transfers/${transferId}/evidence`, payload);
  return response.data;
}

export async function uploadInventoryTransferEvidenceContent(
  transferId,
  evidenceId,
  fileOrBlob,
  options = {}
) {
  const response = await api.put(
    `/api/v1/inventory/transfers/${transferId}/evidence/${evidenceId}/content`,
    fileOrBlob,
    {
      headers: {
        "Content-Type": options?.contentType || "application/octet-stream",
      },
    }
  );
  return response.data;
}

function parseDispositionFileName(dispositionHeader) {
  const raw = String(dispositionHeader || "").trim();
  if (!raw) {
    return null;
  }
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return String(utf8Match[1]).trim();
    }
  }
  const basicMatch = raw.match(/filename="([^"]+)"/i) || raw.match(/filename=([^;]+)/i);
  return basicMatch?.[1] ? String(basicMatch[1]).trim() : null;
}

export async function downloadInventoryTransferEvidence(transferId, evidenceId, params = {}) {
  const response = await api.get(
    `/api/v1/inventory/transfers/${transferId}/evidence/${evidenceId}/download${toQueryString(params)}`,
    { responseType: "blob" }
  );
  return {
    blob: response.data,
    fileName: parseDispositionFileName(response.headers?.["content-disposition"]),
    contentType: response.headers?.["content-type"] || null,
  };
}

export async function deleteInventoryTransferEvidence(transferId, evidenceId) {
  const response = await api.delete(
    `/api/v1/inventory/transfers/${transferId}/evidence/${evidenceId}`
  );
  return response.data;
}

export async function listInventoryCariStockLinks(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/cari-stock-links${toQueryString(params)}`
  );
  return response.data;
}

export async function getInventoryWorkQueueSummary(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/work-queue-summary${toQueryString(params)}`
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

export async function materializeInventoryCariStockLink(stockLinkId, payload) {
  const response = await api.post(
    `/api/v1/inventory/cari-stock-links/${stockLinkId}/materialize`,
    payload
  );
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

export async function listInventoryLandedCostVouchers(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/landed-cost-vouchers${toQueryString(params)}`
  );
  return response.data;
}

export async function getInventoryLandedCostVoucher(voucherId, params = {}) {
  const response = await api.get(
    `/api/v1/inventory/landed-cost-vouchers/${voucherId}${toQueryString(params)}`
  );
  return response.data;
}

export async function listInventoryLandedCostSourceLineLookup(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/landed-cost-vouchers/lookups/source-lines${toQueryString(params)}`
  );
  return response.data;
}

export async function listInventoryLandedCostTargetLookup(params = {}) {
  const response = await api.get(
    `/api/v1/inventory/landed-cost-vouchers/lookups/receipt-targets${toQueryString(params)}`
  );
  return response.data;
}

export async function previewInventoryLandedCostVoucher(payload) {
  const response = await api.post("/api/v1/inventory/landed-cost-vouchers/preview", payload);
  return response.data;
}

export async function createInventoryLandedCostVoucher(payload) {
  const response = await api.post("/api/v1/inventory/landed-cost-vouchers", payload);
  return response.data;
}

export async function reverseInventoryLandedCostVoucher(voucherId, payload = {}) {
  const response = await api.post(
    `/api/v1/inventory/landed-cost-vouchers/${voucherId}/reverse`,
    payload
  );
  return response.data;
}
