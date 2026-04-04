import { api } from "./client.js";

/**
 * Runs the company bootstrap transaction.
 */
export async function bootstrapCompany(payload) {
  const response = await api.post("/api/v1/onboarding/company-bootstrap", payload);
  return response.data;
}

/**
 * Loads tenant-local user options for the bootstrap handoff step.
 */
export async function getCompanyBootstrapHandoffOptions() {
  const response = await api.get("/api/v1/onboarding/company-bootstrap/handoff-options");
  return response.data;
}

/**
 * Previews current-account setup eligibility for the draft onboarding payload.
 */
export async function previewCompanyBootstrapCurrentAccountEligibility(payload) {
  const response = await api.post(
    "/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview",
    payload
  );
  return response.data;
}
