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

/**
 * List consolidation runs for operational surfaces such as the close cockpit.
 */
export async function listConsolidationRuns(params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/runs${toQueryString(params)}`,
  );
  return response.data;
}

/**
 * Read one consolidation run by id.
 */
export async function getConsolidationRun(runId) {
  const response = await api.get(`/api/v1/consolidation/runs/${runId}`);
  return response.data;
}

/**
 * Create or replay a consolidation run through the canonical run endpoint.
 */
export async function createConsolidationRun(payload) {
  const response = await api.post("/api/v1/consolidation/runs", payload);
  return response.data;
}

/**
 * Start the official consolidation run for a group period. The backend is
 * authoritative for idempotency and returns the existing run on duplicate.
 */
export async function createOfficialConsolidationRun({
  consolidationGroupId,
  fiscalPeriodId,
  presentationCurrencyCode,
  versionNo = 1,
  ...rest
} = {}) {
  const payload = {
    ...rest,
    consolidationGroupId,
    fiscalPeriodId,
    runName: "OFFICIAL",
    scenarioCode: "OFFICIAL",
    versionNo,
  };
  if (presentationCurrencyCode) {
    payload.presentationCurrencyCode = String(
      presentationCurrencyCode,
    ).toUpperCase();
  }
  return createConsolidationRun(payload);
}
