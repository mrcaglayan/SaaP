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

export async function listGroupCompanies(params = {}) {
  const response = await api.get(
    `/api/v1/org/group-companies${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertGroupCompany(payload) {
  const response = await api.post("/api/v1/org/group-companies", payload);
  return response.data;
}

export async function listCountries(params = {}) {
  const response = await api.get(`/api/v1/org/countries${toQueryString(params)}`);
  return response.data;
}

export async function listCurrencies(params = {}) {
  const response = await api.get(
    `/api/v1/org/currencies${toQueryString(params)}`
  );
  return response.data;
}

export async function listLegalEntities(params = {}) {
  const response = await api.get(
    `/api/v1/org/legal-entities${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertLegalEntity(payload) {
  const response = await api.post("/api/v1/org/legal-entities", payload);
  return response.data;
}

export async function listShareholders(params = {}) {
  const response = await api.get(
    `/api/v1/org/shareholders${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertShareholder(payload) {
  const response = await api.post("/api/v1/org/shareholders", payload);
  return response.data;
}

export async function createShareholderCommitmentBatchJournal(payload) {
  const response = await api.post(
    "/api/v1/org/shareholders/commitment-journal-batch",
    payload
  );
  return response.data;
}

export async function previewShareholderCommitmentBatchJournal(payload) {
  const response = await api.post(
    "/api/v1/org/shareholders/commitment-journal-batch/preview",
    payload
  );
  return response.data;
}

export async function previewShareholderCapitalFulfillment(payload) {
  const response = await api.post(
    "/api/v1/org/shareholders/capital-fulfillments/preview",
    payload
  );
  return response.data;
}

export async function createShareholderCapitalFulfillment(payload) {
  const response = await api.post(
    "/api/v1/org/shareholders/capital-fulfillments",
    payload
  );
  return response.data;
}

export async function listShareholderCapitalFulfillments(params = {}) {
  const response = await api.get(
    `/api/v1/org/shareholders/capital-fulfillments${toQueryString(params)}`
  );
  return response.data;
}

export async function reverseShareholderCapitalFulfillment(fulfillmentId, payload = {}) {
  const response = await api.post(
    `/api/v1/org/shareholders/capital-fulfillments/${fulfillmentId}/reverse`,
    payload
  );
  return response.data;
}

export async function autoProvisionShareholderSubAccounts(payload) {
  const response = await api.post(
    "/api/v1/org/shareholders/auto-provision-sub-accounts",
    payload
  );
  return response.data;
}

export async function listShareholderJournalConfigs(params = {}) {
  const response = await api.get(
    `/api/v1/org/shareholder-journal-config${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertShareholderJournalConfig(payload) {
  const response = await api.post(
    "/api/v1/org/shareholder-journal-config",
    payload
  );
  return response.data;
}

export async function listOperatingUnits(params = {}) {
  const response = await api.get(
    `/api/v1/org/operating-units${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertOperatingUnit(payload) {
  const response = await api.post("/api/v1/org/operating-units", payload);
  return response.data;
}

export async function autoProvisionOperatingUnitCentralCurrentAccounts(payload) {
  const response = await api.post(
    "/api/v1/org/operating-units/central-current-accounts/auto-provision",
    payload
  );
  return response.data;
}

export async function listOperatingUnitPartnerCurrentAccounts(params = {}) {
  const response = await api.get(
    `/api/v1/org/operating-unit-partner-current-accounts${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertOperatingUnitPartnerCurrentAccount(payload) {
  const response = await api.post(
    "/api/v1/org/operating-unit-partner-current-accounts",
    payload
  );
  return response.data;
}

export async function autoProvisionOperatingUnitPartnerCurrentAccounts(payload) {
  const response = await api.post(
    "/api/v1/org/operating-unit-partner-current-accounts/auto-provision",
    payload
  );
  return response.data;
}

export async function listFiscalCalendars(params = {}) {
  const response = await api.get(
    `/api/v1/org/fiscal-calendars${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertFiscalCalendar(payload) {
  const response = await api.post("/api/v1/org/fiscal-calendars", payload);
  return response.data;
}

export async function listFiscalPeriods(calendarId, params = {}) {
  const response = await api.get(
    `/api/v1/org/fiscal-calendars/${calendarId}/periods${toQueryString(params)}`
  );
  return response.data;
}

export async function generateFiscalPeriods(payload) {
  const response = await api.post("/api/v1/org/fiscal-periods/generate", payload);
  return response.data;
}
