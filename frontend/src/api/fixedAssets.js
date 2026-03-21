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

export async function activateFixedAsset(assetId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/${assetId}/activate`, payload);
  return response.data;
}

export async function createFixedAssetFromCariDocumentLine(payload = {}) {
  const response = await api.post("/api/v1/fixed-assets/from-cari-document-line", payload);
  return response.data;
}

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

export async function postFixedAssetRun(runId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/runs/${runId}/post`, payload);
  return response.data;
}

export async function reverseFixedAssetRun(runId, payload = {}) {
  const response = await api.post(`/api/v1/fixed-assets/runs/${runId}/reverse`, payload);
  return response.data;
}

export async function getFixedAssetRun(runId) {
  const response = await api.get(`/api/v1/fixed-assets/runs/${runId}`);
  return response.data;
}

export async function listFixedAssetTransactions(assetId, params = {}) {
  const response = await api.get(
    `/api/v1/fixed-assets/${assetId}/transactions${toQueryString(params)}`
  );
  return response.data;
}
