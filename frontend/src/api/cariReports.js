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

export async function getCariAgingReport(params = {}) {
  const response = await api.get(`/api/v1/cari/reports/aging${toQueryString(params)}`);
  return response.data;
}

export async function getCariArAgingReport(params = {}) {
  const response = await api.get(`/api/v1/cari/reports/ar-aging${toQueryString(params)}`);
  return response.data;
}

export async function getCariApAgingReport(params = {}) {
  const response = await api.get(`/api/v1/cari/reports/ap-aging${toQueryString(params)}`);
  return response.data;
}

export async function getCariOpenItemsReport(params = {}) {
  const response = await api.get(`/api/v1/cari/reports/open-items${toQueryString(params)}`);
  return response.data;
}

export async function getCariCounterpartyStatementReport(params = {}) {
  const response = await api.get(`/api/v1/cari/reports/statement${toQueryString(params)}`);
  return response.data;
}
