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

function parseCashApiError(error) {
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const data = error?.response?.data || error?.data || {};
  const message = String(data?.message || error?.message || "Request failed");
  const requestId = data?.requestId || error?.requestId || null;

  // Keep compatibility for pages expecting Axios-like error shape.
  const response = {
    status,
    data: {
      ...data,
      message,
      requestId,
    },
  };

  return {
    status,
    message,
    requestId,
    isValidation: status === 400,
    isPermission: status === 401 || status === 403,
    response,
    originalError: error,
  };
}

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCashApiError(error);
  }
}

export async function listCashRegisters(params = {}) {
  const response = await api.get(`/api/v1/cash/registers${toQueryString(params)}`);
  return response.data;
}

export async function getCashRegister(registerId, params = {}) {
  const response = await api.get(
    `/api/v1/cash/registers/${registerId}${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertCashRegister(payload) {
  const response = await api.post("/api/v1/cash/registers", payload);
  return response.data;
}

export async function setCashRegisterStatus(registerId, payload) {
  const response = await api.post(`/api/v1/cash/registers/${registerId}/status`, payload);
  return response.data;
}

export async function listCashSessions(params = {}) {
  const response = await api.get(`/api/v1/cash/sessions${toQueryString(params)}`);
  return response.data;
}

export async function getCashSession(sessionId, params = {}) {
  const response = await api.get(
    `/api/v1/cash/sessions/${sessionId}${toQueryString(params)}`
  );
  return response.data;
}

export async function openCashSession(payload) {
  const response = await api.post("/api/v1/cash/sessions/open", payload);
  return response.data;
}

export async function closeCashSession(sessionId, payload) {
  const response = await api.post(`/api/v1/cash/sessions/${sessionId}/close`, payload);
  return response.data;
}

export async function listCashTransactions(params = {}) {
  const response = await api.get(`/api/v1/cash/transactions${toQueryString(params)}`);
  return response.data;
}

export async function getCashTransaction(transactionId, params = {}) {
  const response = await api.get(
    `/api/v1/cash/transactions/${transactionId}${toQueryString(params)}`
  );
  return response.data;
}

export async function createCashTransaction(payload) {
  const response = await api.post("/api/v1/cash/transactions", payload);
  return response.data;
}

export async function postCashTransaction(transactionId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/${transactionId}/post`,
    payload
  );
  return response.data;
}

export async function cancelCashTransaction(transactionId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/${transactionId}/cancel`,
    payload
  );
  return response.data;
}

export async function reverseCashTransaction(transactionId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/${transactionId}/reverse`,
    payload
  );
  return response.data;
}

export async function applyCariForCashTransaction(transactionId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/${transactionId}/apply-cari`,
    payload
  );
  return response.data;
}

export async function getCashTransitTransfer(transitTransferId, params = {}) {
  const response = await api.get(
    `/api/v1/cash/transactions/transit/${transitTransferId}${toQueryString(params)}`
  );
  return response.data;
}

export async function listCashTransitTransfers(params = {}) {
  const response = await api.get(`/api/v1/cash/transactions/transit${toQueryString(params)}`);
  return response.data;
}

export async function initiateCashTransitTransfer(payload) {
  const response = await api.post("/api/v1/cash/transactions/transit/initiate", payload);
  return response.data;
}

export async function receiveCashTransitTransfer(transitTransferId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/transit/${transitTransferId}/receive`,
    payload
  );
  return response.data;
}

export async function cancelCashTransitTransfer(transitTransferId, payload) {
  const response = await api.post(
    `/api/v1/cash/transactions/transit/${transitTransferId}/cancel`,
    payload
  );
  return response.data;
}

export async function getCashConfig() {
  const response = await api.get("/api/v1/cash/config");
  return response.data;
}

export async function listCashExceptions(params = {}) {
  const response = await api.get(`/api/v1/cash/exceptions${toQueryString(params)}`);
  return response.data;
}

export async function listCashExchangeBatches(params = {}) {
  return run(() => api.get(`/api/v1/cash/exchanges${toQueryString(params)}`));
}

export async function getCashExchangeBatch(exchangeBatchId, params = {}) {
  return run(() =>
    api.get(`/api/v1/cash/exchanges/${exchangeBatchId}${toQueryString(params)}`)
  );
}

export async function createCashExchangeBatch(payload) {
  return run(() => api.post("/api/v1/cash/exchanges", payload));
}

export async function postCashExchangeBatch(exchangeBatchId, payload = {}) {
  return run(() =>
    api.post(`/api/v1/cash/exchanges/${exchangeBatchId}/post`, payload)
  );
}

export async function reverseCashExchangeBatch(exchangeBatchId, payload) {
  return run(() =>
    api.post(`/api/v1/cash/exchanges/${exchangeBatchId}/reverse`, payload)
  );
}

export async function getCashExchangeHistoryReport(params = {}) {
  return run(() =>
    api.get(`/api/v1/cash/reports/exchange-history${toQueryString(params)}`)
  );
}

export async function getForeignCashBalancesReport(params = {}) {
  return run(() =>
    api.get(`/api/v1/cash/reports/foreign-balances${toQueryString(params)}`)
  );
}

export async function getCashFxRevaluationRunsReport(params = {}) {
  return run(() =>
    api.get(`/api/v1/cash/reports/revaluation-runs${toQueryString(params)}`)
  );
}

export async function getCashFxOpsDashboard(params = {}) {
  return run(() =>
    api.get(`/api/v1/cash/reports/fx-ops-dashboard${toQueryString(params)}`)
  );
}

export async function rerunCashFxOpsExceptionJob(exceptionId, payload = {}) {
  return run(() =>
    api.post(`/api/v1/cash/reports/fx-ops-exceptions/${exceptionId}/rerun-job`, payload)
  );
}

export async function overrideCashFxOpsException(exceptionId, payload) {
  return run(() =>
    api.post(`/api/v1/cash/reports/fx-ops-exceptions/${exceptionId}/override`, payload)
  );
}
