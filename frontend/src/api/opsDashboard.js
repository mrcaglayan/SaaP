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

function parseFileNameFromContentDisposition(headerValue, fallback) {
  const raw = String(headerValue || "");
  const match = raw.match(/filename=\"?([^\";]+)\"?/i);
  if (!match?.[1]) {
    return fallback;
  }
  return match[1].trim() || fallback;
}

export async function getOpsBankReconciliationSummary(params = {}) {
  const response = await api.get("/api/v1/ops/bank/reconciliation-summary", { params });
  return response.data;
}

export async function getOpsBankPaymentBatchesHealth(params = {}) {
  const response = await api.get("/api/v1/ops/bank/payment-batches-health", { params });
  return response.data;
}

export async function getOpsPayrollImportHealth(params = {}) {
  const response = await api.get("/api/v1/ops/payroll/import-health", { params });
  return response.data;
}

export async function getOpsPayrollCloseStatus(params = {}) {
  const response = await api.get("/api/v1/ops/payroll/close-status", { params });
  return response.data;
}

export async function getOpsJobsHealth(params = {}) {
  const response = await api.get("/api/v1/ops/jobs/health", { params });
  return response.data;
}

export async function downloadOpsUsageExportCsv(params = {}) {
  const response = await api.get(
    `/api/v1/ops/exports/usage.csv${toQueryString(params)}`,
    { responseType: "blob" }
  );
  return {
    blob: response.data,
    fileName: parseFileNameFromContentDisposition(
      response.headers?.["content-disposition"],
      "ops-usage-export.csv"
    ),
  };
}

export async function downloadOpsAuditExportCsv(params = {}) {
  const response = await api.get(
    `/api/v1/ops/exports/audit.csv${toQueryString(params)}`,
    { responseType: "blob" }
  );
  return {
    blob: response.data,
    fileName: parseFileNameFromContentDisposition(
      response.headers?.["content-disposition"],
      "ops-audit-export.csv"
    ),
  };
}
