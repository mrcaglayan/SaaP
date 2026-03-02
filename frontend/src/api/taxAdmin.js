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

export async function listTaxRegimes(params = {}) {
  const response = await api.get(`/api/v1/tax/regimes${toQueryString(params)}`);
  return response.data;
}

export async function createTaxRegime(payload) {
  const response = await api.post("/api/v1/tax/regimes", payload);
  return response.data;
}

export async function updateTaxRegime(regimeId, payload) {
  const response = await api.patch(`/api/v1/tax/regimes/${regimeId}`, payload);
  return response.data;
}

export async function listTaxCodes(params = {}) {
  const response = await api.get(`/api/v1/tax/codes${toQueryString(params)}`);
  return response.data;
}

export async function createTaxCode(payload) {
  const response = await api.post("/api/v1/tax/codes", payload);
  return response.data;
}

export async function updateTaxCode(codeId, payload) {
  const response = await api.patch(`/api/v1/tax/codes/${codeId}`, payload);
  return response.data;
}

export async function listTaxRules(params = {}) {
  const response = await api.get(`/api/v1/tax/rules${toQueryString(params)}`);
  return response.data;
}

export async function createTaxRule(payload) {
  const response = await api.post("/api/v1/tax/rules", payload);
  return response.data;
}

export async function updateTaxRule(ruleId, payload) {
  const response = await api.patch(`/api/v1/tax/rules/${ruleId}`, payload);
  return response.data;
}

export async function listTaxAccountMappings(params = {}) {
  const response = await api.get(
    `/api/v1/tax/account-mappings${toQueryString(params)}`
  );
  return response.data;
}

export async function createTaxAccountMapping(payload) {
  const response = await api.post("/api/v1/tax/account-mappings", payload);
  return response.data;
}

export async function updateTaxAccountMapping(mappingId, payload) {
  const response = await api.patch(
    `/api/v1/tax/account-mappings/${mappingId}`,
    payload
  );
  return response.data;
}

export async function previewTaxComputation(payload) {
  const response = await api.post("/api/v1/tax/preview", payload);
  return response.data;
}
