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

export async function listBooks(params = {}) {
  const response = await api.get(`/api/v1/gl/books${toQueryString(params)}`);
  return response.data;
}

export async function upsertBook(payload) {
  const response = await api.post("/api/v1/gl/books", payload);
  return response.data;
}

export async function listCoas(params = {}) {
  const response = await api.get(`/api/v1/gl/coas${toQueryString(params)}`);
  return response.data;
}

export async function upsertCoa(payload) {
  const response = await api.post("/api/v1/gl/coas", payload);
  return response.data;
}

export async function listAccounts(params = {}) {
  const response = await api.get(`/api/v1/gl/accounts${toQueryString(params)}`);
  return response.data;
}

export async function upsertAccount(payload) {
  const response = await api.post("/api/v1/gl/accounts", payload);
  return response.data;
}

export async function upsertAccountMapping(payload) {
  const response = await api.post("/api/v1/gl/account-mappings", payload);
  return response.data;
}

export async function createJournal(payload) {
  const response = await api.post("/api/v1/gl/journals", payload);
  return response.data;
}

export async function listJournals(params = {}) {
  const response = await api.get(`/api/v1/gl/journals${toQueryString(params)}`);
  return response.data;
}

export async function getJournal(journalId) {
  const response = await api.get(`/api/v1/gl/journals/${journalId}`);
  return response.data;
}

export async function postJournal(journalId) {
  const response = await api.post(`/api/v1/gl/journals/${journalId}/post`);
  return response.data;
}

export async function reverseJournal(journalId, payload) {
  const response = await api.post(
    `/api/v1/gl/journals/${journalId}/reverse`,
    payload
  );
  return response.data;
}

export async function getTrialBalance(params = {}) {
  const response = await api.get(
    `/api/v1/gl/trial-balance${toQueryString(params)}`
  );
  return response.data;
}

export async function closePeriod(bookId, periodId, payload) {
  const response = await api.post(
    `/api/v1/gl/period-statuses/${bookId}/${periodId}/close`,
    payload
  );
  return response.data;
}
