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

export async function listConsolidationGroups(params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/groups${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertConsolidationGroup(payload) {
  const response = await api.post("/api/v1/consolidation/groups", payload);
  return response.data;
}

export async function listConsolidationGroupMembers(groupId, params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/members${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertConsolidationGroupMember(groupId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/members`,
    payload
  );
  return response.data;
}

export async function listConsolidationCoaMappings(groupId, params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/coa-mappings${toQueryString(params)}`
  );
  return response.data;
}

export async function upsertConsolidationCoaMapping(groupId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/coa-mappings`,
    payload
  );
  return response.data;
}

export async function listConsolidationCanonicalMappings(groupId, params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings${toQueryString(
      params
    )}`
  );
  return response.data;
}

export async function getConsolidationCanonicalReadiness(groupId, params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/canonical-readiness${toQueryString(
      params
    )}`
  );
  return response.data;
}

export async function upsertConsolidationCanonicalLocalMapping(groupId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/local`,
    payload
  );
  return response.data;
}

export async function upsertConsolidationCanonicalGroupMapping(groupId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/group`,
    payload
  );
  return response.data;
}

export async function previewConsolidationCanonicalMappingCandidates(
  groupId,
  params = {}
) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/candidates${toQueryString(
      params
    )}`
  );
  return response.data;
}

export async function applyConsolidationCanonicalMappingCandidates(
  groupId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/candidates/apply`,
    payload
  );
  return response.data;
}

export async function previewConsolidationCanonicalRuleMappings(
  groupId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules/preview`,
    payload
  );
  return response.data;
}

export async function applyConsolidationCanonicalRuleMappings(
  groupId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules/apply`,
    payload
  );
  return response.data;
}

export async function listConsolidationCanonicalMappingRules(
  groupId,
  params = {}
) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules${toQueryString(
      params
    )}`
  );
  return response.data;
}

export async function createConsolidationCanonicalMappingRule(
  groupId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules`,
    payload
  );
  return response.data;
}

export async function previewSavedConsolidationCanonicalMappingRule(
  groupId,
  ruleId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules/${ruleId}/preview`,
    payload
  );
  return response.data;
}

export async function applySavedConsolidationCanonicalMappingRule(
  groupId,
  ruleId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules/${ruleId}/apply`,
    payload
  );
  return response.data;
}

export async function deactivateConsolidationCanonicalMappingRule(
  groupId,
  ruleId,
  payload = {}
) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/canonical-mappings/rules/${ruleId}/deactivate`,
    payload
  );
  return response.data;
}

export async function listConsolidationEliminationPlaceholders(
  groupId,
  params = {}
) {
  const response = await api.get(
    `/api/v1/consolidation/groups/${groupId}/elimination-placeholders${toQueryString(
      params
    )}`
  );
  return response.data;
}

export async function upsertConsolidationEliminationPlaceholder(groupId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/groups/${groupId}/elimination-placeholders`,
    payload
  );
  return response.data;
}

export async function listConsolidationRuns(params = {}) {
  const response = await api.get(
    `/api/v1/consolidation/runs${toQueryString(params)}`
  );
  return response.data;
}

export async function getConsolidationRun(runId) {
  const response = await api.get(`/api/v1/consolidation/runs/${runId}`);
  return response.data;
}

export async function createConsolidationRun(payload) {
  const response = await api.post("/api/v1/consolidation/runs", payload);
  return response.data;
}

export async function executeConsolidationRun(runId, payload = {}) {
  const response = await api.post(
    `/api/v1/consolidation/runs/${runId}/execute`,
    payload
  );
  return response.data;
}

/**
 * Read the first-pass RP12 consolidation finalize review gate.
 */
export async function getConsolidationRunReviewGate(runId) {
  const response = await api.get(`/api/v1/consolidation/runs/${runId}/review-gate`);
  return response.data;
}

/**
 * Persist one immutable RP13 member-support snapshot for the currently loaded
 * consolidation drill chain.
 */
export async function createConsolidationRunMemberSupportSnapshot(runId, payload) {
  const response = await api.post(
    `/api/v1/consolidation/runs/${runId}/report-snapshots/member-support`,
    payload,
  );
  return response.data;
}

export async function finalizeConsolidationRun(runId) {
  const response = await api.post(`/api/v1/consolidation/runs/${runId}/finalize`);
  return response.data;
}
