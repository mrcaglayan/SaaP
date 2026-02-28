import { api } from "./client.js";
import { parseCariApiError, toCariQueryString } from "./cariCommon.js";

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
}

export async function listCariDocuments(params = {}) {
  return run(() => api.get(`/api/v1/cari/documents${toCariQueryString(params)}`));
}

export async function getCariDocument(documentId) {
  return run(() => api.get(`/api/v1/cari/documents/${documentId}`));
}

export async function getCariDocumentOpenItems(documentId) {
  return run(() => api.get(`/api/v1/cari/documents/${documentId}/open-items`));
}

export async function listCariDocumentComments(documentId) {
  return run(() => api.get(`/api/v1/cari/documents/${documentId}/comments`));
}

export async function createCariDocumentComment(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/comments`, payload));
}

export async function listCariDocumentEvidence(documentId) {
  return run(() => api.get(`/api/v1/cari/documents/${documentId}/evidence`));
}

export async function createCariDocumentEvidence(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/evidence`, payload));
}

export async function uploadCariDocumentEvidenceContent(
  documentId,
  evidenceId,
  fileOrBlob,
  options = {}
) {
  try {
    const response = await api.put(
      `/api/v1/cari/documents/${documentId}/evidence/${evidenceId}/content`,
      fileOrBlob,
      {
        headers: {
          "Content-Type": options?.contentType || "application/octet-stream",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
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

export async function downloadCariDocumentEvidence(documentId, evidenceId) {
  try {
    const response = await api.get(
      `/api/v1/cari/documents/${documentId}/evidence/${evidenceId}/download`,
      { responseType: "blob" }
    );
    return {
      blob: response.data,
      fileName: parseDispositionFileName(response.headers?.["content-disposition"]),
      contentType: response.headers?.["content-type"] || null,
    };
  } catch (error) {
    throw parseCariApiError(error);
  }
}

export async function deleteCariDocumentEvidence(documentId, evidenceId) {
  return run(() => api.delete(`/api/v1/cari/documents/${documentId}/evidence/${evidenceId}`));
}

export async function createCariDocument(payload) {
  return run(() => api.post("/api/v1/cari/documents", payload));
}

export async function updateCariDocument(documentId, payload) {
  return run(() => api.put(`/api/v1/cari/documents/${documentId}`, payload));
}

export async function cancelCariDocument(documentId) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/cancel`, {}));
}

export async function postCariDocument(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/post`, payload));
}

export async function reverseCariDocument(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/reverse`, payload));
}
