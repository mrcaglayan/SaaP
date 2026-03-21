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

// ── Asset register ────────────────────────────────────────────────

export async function listFixedAssets(params = {}) {
  const response = await api.get(`/api/v1/fixed-assets${toQueryString(params)}`);
  return response.data;
}

export async function getFixedAsset(assetId) {
  const response = await api.get(`/api/v1/fixed-assets/${assetId}`);
  return response.data;
}

export async function createFixedAsset(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets", payload);
  return response.data;
}

export async function updateFixedAsset(assetId, payload = {}) {
  const response = await api.patch(`/api/v1/fixed-assets/${assetId}`, payload);
  return response.data;
}

// ── Asset lifecycle actions ───────────────────────────────────────

export async function activateFixedAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/activate`, payload);
  return response.data;
}

export async function suspendFixedAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/suspend`, payload);
  return response.data;
}

export async function reactivateFixedAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/reactivate`, payload);
  return response.data;
}

export async function physicalMoveAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/physical-move`, payload);
  return response.data;
}

export async function ownershipTransferAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/ownership-transfer`, payload);
  return response.data;
}

export async function writeoffAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/writeoff`, payload);
  return response.data;
}

// ── Sale staged workflow ──────────────────────────────────────────

export async function saleCreateDraftAr(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/sale/create-draft-ar-document`, payload);
  return response.data;
}

export async function saleLinkAr(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/sale/link-ar-document`, payload);
  return response.data;
}

export async function saleUpdateDraftAr(assetId, payload = {}) {
  const response = await api.patch(`/api/v1/fixed-assets/${assetId}/sale/draft-ar-document`, payload);
  return response.data;
}

export async function saleFinalizeAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/sale/finalize`, payload);
  return response.data;
}

// ── Non-run transaction reversal ──────────────────────────────────

export async function reverseFixedAssetTransaction(transactionId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/transactions/${transactionId}/reverse`, payload);
  return response.data;
}

// ── Asset transactions ────────────────────────────────────────────

export async function listFixedAssetTransactions(assetId, params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/${assetId}/transactions${toQueryString(params)}`
  );
  return response.data;
}

// ── Asset depreciation schedule ───────────────────────────────────

export async function getFixedAssetDepreciationSchedule(assetId, params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/${assetId}/depreciation-schedule${toQueryString(params)}`
  );
  return response.data;
}

// ── CARI capitalization ───────────────────────────────────────────

export async function listCariEligibleApLines(params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/from-cari-document-line${toQueryString(params)}`
  );
  return response.data;
}

export async function createFixedAssetFromCariDocumentLine(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/from-cari-document-line", payload);
  return response.data;
}

// ── Categories ────────────────────────────────────────────────────

export async function listFixedAssetCategories(params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/categories${toQueryString(params)}`
  );
  return response.data;
}

export async function createFixedAssetCategory(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/categories", payload);
  return response.data;
}

export async function updateFixedAssetCategory(categoryId, payload = {}) {
  const response = await api.patch(
    `/api/v1/fixed-assets/categories/${categoryId}`,
    payload
  );
  return response.data;
}

// ── Depreciation profiles ─────────────────────────────────────────

export async function listFixedAssetDepreciationProfiles(params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/depreciation-profiles${toQueryString(params)}`
  );
  return response.data;
}

export async function createFixedAssetDepreciationProfile(payload = {}) {
  const response = await api.post(
    "/api/v1/fixed-assets/depreciation-profiles",
    payload
  );
  return response.data;
}

export async function updateFixedAssetDepreciationProfile(profileId, payload = {}) {
  const response = await api.patch(
    `/api/v1/fixed-assets/depreciation-profiles/${profileId}`,
    payload
  );
  return response.data;
}

// ── Custodians ────────────────────────────────────────────────────

export async function listFixedAssetCustodians(params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/custodians${toQueryString(params)}`
  );
  return response.data;
}

export async function createFixedAssetCustodian(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/custodians", payload);
  return response.data;
}

export async function updateFixedAssetCustodian(custodianId, payload = {}) {
  const response = await api.patch(
    `/api/v1/fixed-assets/custodians/${custodianId}`,
    payload
  );
  return response.data;
}

// ── Depreciation runs ─────────────────────────────────────────────

export async function listFixedAssetRuns(params = {}) {
  const response = await api.get(`/api/v1/fixed-assets/runs${toQueryString(params)}`);
  return response.data;
}

export async function previewFixedAssetRun(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/runs/preview", payload);
  return response.data;
}

export async function createFixedAssetRun(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/runs", payload);
  return response.data;
}

export async function getFixedAssetRun(runId) {
  const response = await api.get(`/api/v1/fixed-assets/runs/${runId}`);
  return response.data;
}

export async function deleteFixedAssetRun(runId) {
  const response = await api.delete(`/api/v1/fixed-assets/runs/${runId}`);
  return response.data;
}

export async function postFixedAssetRun(runId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/runs/${runId}/post`, payload);
  return response.data;
}

export async function reverseFixedAssetRun(runId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/runs/${runId}/reverse`, payload);
  return response.data;
}

// ── Evidence helpers ──────────────────────────────────────────────
// Evidence routes are nested under assets, transactions, or runs.

function evidenceBasePath(surface, surfaceId) {
  if (surface === "asset") return `/api/v1/fixed-assets/${surfaceId}/evidence`;
  if (surface === "transaction") return `/api/v1/fixed-assets/transactions/${surfaceId}/evidence`;
  if (surface === "run") return `/api/v1/fixed-assets/runs/${surfaceId}/evidence`;
  throw new Error(`Unknown evidence surface: ${surface}`);
}

export async function listFixedAssetEvidence(surface, surfaceId) {
  const response = await api.get(evidenceBasePath(surface, surfaceId));
  return response.data;
}

export async function createFixedAssetEvidence(surface, surfaceId, payload = {}) {
  const response = await api.post(evidenceBasePath(surface, surfaceId), payload);
  return response.data;
}

export async function getFixedAssetEvidence(surface, surfaceId, evidenceId) {
  const response = await api.get(`${evidenceBasePath(surface, surfaceId)}/${evidenceId}`);
  return response.data;
}

export async function uploadFixedAssetEvidenceContent(surface, surfaceId, evidenceId, binaryData, contentType) {
  const response = await api.put(
    `${evidenceBasePath(surface, surfaceId)}/${evidenceId}/content`,
    binaryData,
    { headers: { "Content-Type": contentType || "application/octet-stream" } }
  );
  return response.data;
}

export async function downloadFixedAssetEvidence(surface, surfaceId, evidenceId) {
  const response = await api.get(
    `${evidenceBasePath(surface, surfaceId)}/${evidenceId}/download`,
    { responseType: "blob" }
  );
  return response.data;
}

export async function deleteFixedAssetEvidence(surface, surfaceId, evidenceId) {
  const response = await api.delete(`${evidenceBasePath(surface, surfaceId)}/${evidenceId}`);
  return response.data;
}

// ── Reports ──────────────────────────────────────────────────────

export async function getFixedAssetReport(reportName, params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/reports/${reportName}${toQueryString(params)}`
  );
  return response.data;
}

export async function exportFixedAssetReport(reportName, params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/reports/${reportName}/export${toQueryString(params)}`,
    { responseType: "blob" }
  );
  // Trigger browser download
  const disposition = response.headers?.["content-disposition"] || "";
  const fileNameMatch = disposition.match(/filename="([^"]+)"/);
  const fileName = fileNameMatch ? fileNameMatch[1] : `fa-${reportName}.csv`;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return { fileName };
}
