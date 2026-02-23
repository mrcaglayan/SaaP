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

export async function listCariPaymentTerms(params = {}) {
  const response = await api.get(
    `/api/v1/cari/payment-terms${toQueryString(params)}`
  );
  return response.data;
}

export async function getCariPaymentTerm(paymentTermId) {
  const response = await api.get(`/api/v1/cari/payment-terms/${paymentTermId}`);
  return response.data;
}
