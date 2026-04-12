import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const providerApi = axios.create({
  baseURL,
  timeout: 20000,
});

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

function withAuth(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

export async function loginProviderAdmin(email, password) {
  const response = await providerApi.post("/api/v1/provider/auth/login", {
    email,
    password,
  });
  return response.data;
}

export async function getProviderAdminMe(token) {
  const response = await providerApi.get("/api/v1/provider/me", withAuth(token));
  return response.data;
}

export async function listProviderTenants(token, params = {}) {
  const response = await providerApi.get(
    `/api/v1/provider/tenants${toQueryString(params)}`,
    withAuth(token)
  );
  return response.data;
}

export async function createProviderTenant(token, payload) {
  const response = await providerApi.post(
    "/api/v1/provider/tenants",
    payload,
    withAuth(token)
  );
  return response.data;
}

export async function updateProviderTenantStatus(token, tenantId, status) {
  const response = await providerApi.patch(
    `/api/v1/provider/tenants/${tenantId}/status`,
    { status },
    withAuth(token)
  );
  return response.data;
}

export async function updateProviderTenantTaxEngine(token, tenantId, enabled) {
  const response = await providerApi.patch(
    `/api/v1/provider/tenants/${tenantId}/tax-engine`,
    { enabled },
    withAuth(token)
  );
  return response.data;
}

/**
 * Reassigns the shipped bootstrap admin roles from the provider control plane.
 * When no email is supplied, the backend restores them to the tenant's
 * earliest viable user automatically.
 */
export async function restoreProviderTenantBootstrapRoles(token, tenantId, email) {
  const response = await providerApi.post(
    `/api/v1/provider/tenants/${tenantId}/bootstrap-roles`,
    email ? { email } : {},
    withAuth(token)
  );
  return response.data;
}

export async function listProviderCurrencies(token) {
  const response = await providerApi.get("/api/v1/provider/currencies", withAuth(token));
  return response.data;
}

export async function createProviderCurrency(token, payload) {
  const response = await providerApi.post(
    "/api/v1/provider/currencies",
    payload,
    withAuth(token)
  );
  return response.data;
}

export async function updateProviderCurrency(token, currencyCode, payload) {
  const response = await providerApi.patch(
    `/api/v1/provider/currencies/${encodeURIComponent(currencyCode)}`,
    payload,
    withAuth(token)
  );
  return response.data;
}

export async function listProviderCountries(token, params = {}) {
  const response = await providerApi.get(
    `/api/v1/provider/countries${toQueryString(params)}`,
    withAuth(token)
  );
  return response.data;
}

export async function createProviderCountry(token, payload) {
  const response = await providerApi.post(
    "/api/v1/provider/countries",
    payload,
    withAuth(token)
  );
  return response.data;
}

export async function updateProviderCountry(token, countryId, payload) {
  const response = await providerApi.patch(
    `/api/v1/provider/countries/${countryId}`,
    payload,
    withAuth(token)
  );
  return response.data;
}
