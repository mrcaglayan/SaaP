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

export async function listLocalClosePacks(params = {}) {
  const response = await api.get(`/api/v1/gl/local-close-packs${toQueryString(params)}`);
  return response.data;
}

export async function getLocalClosePack(packId) {
  const response = await api.get(`/api/v1/gl/local-close-packs/${packId}`);
  return response.data;
}

export async function createLocalClosePack(payload = {}) {
  const response = await api.post("/api/v1/gl/local-close-packs", payload);
  return response.data;
}

export async function listLocalClosePackReopenRequests(packId, params = {}) {
  const response = await api.get(
    `/api/v1/gl/local-close-packs/${packId}/reopen-requests${toQueryString(params)}`
  );
  return response.data;
}

export async function listLocalClosePackReportReviews(packId) {
  const response = await api.get(`/api/v1/gl/local-close-packs/${packId}/report-reviews`);
  return response.data;
}

export async function upsertLocalClosePackReportReview(packId, payload = {}) {
  const response = await api.post(
    `/api/v1/gl/local-close-packs/${packId}/report-reviews`,
    payload
  );
  return response.data;
}

export async function listLocalClosePackEvidence(packId) {
  const response = await api.get(`/api/v1/gl/local-close-packs/${packId}/evidence`);
  return response.data;
}

export async function createLocalClosePackEvidence(packId, payload = {}) {
  const response = await api.post(`/api/v1/gl/local-close-packs/${packId}/evidence`, payload);
  return response.data;
}

export async function uploadLocalClosePackEvidenceContent(
  packId,
  evidenceId,
  fileOrBlob,
  options = {}
) {
  const response = await api.put(
    `/api/v1/gl/local-close-packs/${packId}/evidence/${evidenceId}/content`,
    fileOrBlob,
    {
      headers: {
        "Content-Type": options?.contentType || "application/octet-stream",
      },
    }
  );
  return response.data;
}

export async function downloadLocalClosePackEvidence(packId, evidenceId) {
  const response = await api.get(
    `/api/v1/gl/local-close-packs/${packId}/evidence/${evidenceId}/download`,
    { responseType: "blob" }
  );
  return {
    blob: response.data,
    fileName: parseDispositionFileName(response.headers?.["content-disposition"]),
    contentType: response.headers?.["content-type"] || null,
  };
}

export async function deleteLocalClosePackEvidence(packId, evidenceId) {
  const response = await api.delete(
    `/api/v1/gl/local-close-packs/${packId}/evidence/${evidenceId}`
  );
  return response.data;
}

export async function listLocalClosePackComments(packId) {
  const response = await api.get(`/api/v1/gl/local-close-packs/${packId}/comments`);
  return response.data;
}

export async function createLocalClosePackComment(packId, payload = {}) {
  const response = await api.post(`/api/v1/gl/local-close-packs/${packId}/comments`, payload);
  return response.data;
}

export async function listLocalClosePackAudit(packId, params = {}) {
  const response = await api.get(
    `/api/v1/gl/local-close-packs/${packId}/audit${toQueryString(params)}`
  );
  return response.data;
}
