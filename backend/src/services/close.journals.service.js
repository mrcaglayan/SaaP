import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const CLOSE_JOURNAL_FAMILIES = Object.freeze([
  "LOCAL_ADJUSTMENT",
  "TOPSIDE",
  "ELIMINATION",
  "CONSOLIDATION_ADJUSTMENT",
  "RECLASS",
  "REVERSING",
  "RECURRING",
]);

const ENTITY_RELEVANT_JOURNAL_FAMILIES = new Set([
  "LOCAL_ADJUSTMENT",
  "RECLASS",
  "REVERSING",
  "RECURRING",
]);

const GROUP_RELEVANT_JOURNAL_FAMILIES = new Set([
  "TOPSIDE",
  "ELIMINATION",
  "CONSOLIDATION_ADJUSTMENT",
  "RECLASS",
  "REVERSING",
  "RECURRING",
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function parseJsonValue(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function normalizeJournalFamily(value) {
  const normalized = toUpperText(value);
  if (!normalized) {
    return null;
  }
  if (!CLOSE_JOURNAL_FAMILIES.includes(normalized)) {
    throw badRequest(`Unsupported close journal family: ${value}`);
  }
  return normalized;
}

function mapCloseJournalProfileRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    profileCode: String(row.profile_code || "").trim().toUpperCase() || null,
    profileName: String(row.profile_name || "").trim() || null,
    journalFamily: normalizeJournalFamily(row.journal_family),
    scopeKind: toUpperText(row.scope_kind) || "GLOBAL",
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    status: toUpperText(row.status) || "ACTIVE",
    description: String(row.description || "").trim() || null,
    governance: parseJsonValue(row.governance_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapCloseJournalTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeJournalProfileId: parsePositiveInt(row.close_journal_profile_id),
    templateCode: String(row.template_code || "").trim().toUpperCase() || null,
    templateName: String(row.template_name || "").trim() || null,
    status: toUpperText(row.status) || "ACTIVE",
    runtimeBindingType: toUpperText(row.runtime_binding_type) || "NONE",
    runtimeBindingCode: String(row.runtime_binding_code || "").trim().toUpperCase() || null,
    reversalMode: toUpperText(row.reversal_mode) || "NONE",
    requiresCycleLink: parseDbBoolean(row.requires_cycle_link),
    requiresPeriodBinding: parseDbBoolean(row.requires_period_binding),
    allowManualDraft: parseDbBoolean(row.allow_manual_draft),
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    description: String(row.description || "").trim() || null,
    template: parseJsonValue(row.template_json, {}),
    profile: {
      id: parsePositiveInt(row.profile_id ?? row.close_journal_profile_id),
      profileCode: String(row.profile_code || "").trim().toUpperCase() || null,
      profileName: String(row.profile_name || "").trim() || null,
      journalFamily: normalizeJournalFamily(row.journal_family),
      scopeKind: toUpperText(row.profile_scope_kind || row.scope_kind) || "GLOBAL",
      legalEntityId: parsePositiveInt(row.profile_legal_entity_id ?? row.legal_entity_id),
      consolidationGroupId: parsePositiveInt(
        row.profile_consolidation_group_id ?? row.consolidation_group_id
      ),
      status: toUpperText(row.profile_status) || "ACTIVE",
    },
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function dedupeRowsByCode(rows = [], codeField) {
  const mergedRows = [];
  const seenCodes = new Set();
  for (const row of rows) {
    const code = String(row?.[codeField] || "").trim().toUpperCase();
    if (!code || seenCodes.has(code)) {
      continue;
    }
    seenCodes.add(code);
    mergedRows.push(row);
  }
  return mergedRows;
}

function isFamilyRelevantForCycleScope(journalFamily, scopeKind) {
  const normalizedFamily = normalizeJournalFamily(journalFamily);
  const normalizedScopeKind = toUpperText(scopeKind || "LEGAL_ENTITY");
  if (normalizedScopeKind === "CONSOLIDATION_GROUP") {
    return GROUP_RELEVANT_JOURNAL_FAMILIES.has(normalizedFamily);
  }
  return ENTITY_RELEVANT_JOURNAL_FAMILIES.has(normalizedFamily);
}

function profileMatchesCycle(profile, cycle) {
  if (!profile || !cycle) {
    return false;
  }

  if (!isFamilyRelevantForCycleScope(profile.journalFamily, cycle.scopeKind)) {
    return false;
  }

  if (profile.scopeKind === "GLOBAL") {
    return true;
  }
  if (profile.scopeKind === "LEGAL_ENTITY") {
    return cycle.scopeKind === "LEGAL_ENTITY" && profile.legalEntityId === cycle.legalEntityId;
  }
  if (profile.scopeKind === "CONSOLIDATION_GROUP") {
    return (
      cycle.scopeKind === "CONSOLIDATION_GROUP" &&
      profile.consolidationGroupId === cycle.consolidationGroupId
    );
  }
  return false;
}

function buildWorkJournalPath({ legalEntityId = null, fiscalPeriodId = null }) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/mahsup-islemleri${queryString ? `?${queryString}` : ""}`;
}

function buildConsolidationReportsPath() {
  return "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari";
}

function createRuntimeCountRow() {
  return {
    total: 0,
    byStatus: {},
  };
}

function appendRuntimeStatusCount(catalog, code, status, incrementBy) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (!normalizedCode || !normalizedStatus) {
    return;
  }

  if (!catalog.has(normalizedCode)) {
    catalog.set(normalizedCode, createRuntimeCountRow());
  }
  const summary = catalog.get(normalizedCode);
  const count = Number(incrementBy || 0);
  summary.total += count;
  summary.byStatus[normalizedStatus] = Number(summary.byStatus[normalizedStatus] || 0) + count;
}

async function listConsolidationGroupMemberEntityIds({
  consolidationGroupId,
  periodStartDate,
  periodEndDate,
  runQuery = query,
}) {
  const normalizedGroupId = parsePositiveInt(consolidationGroupId);
  if (!normalizedGroupId || !periodStartDate || !periodEndDate) {
    return [];
  }

  const result = await runQuery(
    `SELECT DISTINCT legal_entity_id
     FROM consolidation_group_members
     WHERE consolidation_group_id = ?
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY legal_entity_id ASC`,
    [normalizedGroupId, periodEndDate, periodStartDate]
  );

  return (result.rows || [])
    .map((row) => parsePositiveInt(row.legal_entity_id))
    .filter(Boolean);
}

async function loadGlJournalRuntimeCatalog({
  tenantId,
  cycle,
  period,
  runQuery = query,
}) {
  const catalog = new Map();
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId || !cycle?.fiscalPeriodId) {
    return catalog;
  }

  let legalEntityIds = [];
  if (cycle.scopeKind === "LEGAL_ENTITY" && cycle.legalEntityId) {
    legalEntityIds = [parsePositiveInt(cycle.legalEntityId)];
  } else if (cycle.scopeKind === "CONSOLIDATION_GROUP") {
    legalEntityIds = await listConsolidationGroupMemberEntityIds({
      consolidationGroupId: cycle.consolidationGroupId,
      periodStartDate: period?.startDate || null,
      periodEndDate: period?.endDate || null,
      runQuery,
    });
  }

  if (!legalEntityIds.length) {
    return catalog;
  }

  const result = await runQuery(
    `SELECT
       source_type,
       status,
       COUNT(*) AS total
     FROM journal_entries
     WHERE tenant_id = ?
       AND fiscal_period_id = ?
       AND legal_entity_id IN (${legalEntityIds.map(() => "?").join(", ")})
     GROUP BY source_type, status`,
    [normalizedTenantId, parsePositiveInt(cycle.fiscalPeriodId), ...legalEntityIds]
  );

  for (const row of result.rows || []) {
    appendRuntimeStatusCount(catalog, row.source_type, row.status, row.total);
  }
  return catalog;
}

async function loadConsolidationAdjustmentRuntimeCatalog({
  tenantId,
  cycle,
  runQuery = query,
}) {
  const catalog = new Map();
  if (
    !parsePositiveInt(tenantId) ||
    cycle?.scopeKind !== "CONSOLIDATION_GROUP" ||
    !cycle?.consolidationGroupId ||
    !cycle?.fiscalPeriodId
  ) {
    return catalog;
  }

  const result = await runQuery(
    `SELECT
       ca.adjustment_type,
       ca.status,
       COUNT(*) AS total
     FROM consolidation_adjustments ca
     JOIN consolidation_runs cr
       ON cr.id = ca.consolidation_run_id
     JOIN consolidation_groups cg
       ON cg.id = cr.consolidation_group_id
     WHERE cg.tenant_id = ?
       AND cr.consolidation_group_id = ?
       AND cr.fiscal_period_id = ?
     GROUP BY ca.adjustment_type, ca.status`,
    [tenantId, cycle.consolidationGroupId, cycle.fiscalPeriodId]
  );

  for (const row of result.rows || []) {
    appendRuntimeStatusCount(catalog, row.adjustment_type, row.status, row.total);
  }
  return catalog;
}

function buildScopeLabelForProfile(profile) {
  if (profile?.scopeKind === "LEGAL_ENTITY") {
    return profile?.legalEntityId ? `Legal Entity #${profile.legalEntityId}` : "Legal entity scope";
  }
  if (profile?.scopeKind === "CONSOLIDATION_GROUP") {
    return profile?.consolidationGroupId
      ? `Consolidation Group #${profile.consolidationGroupId}`
      : "Consolidation-group scope";
  }
  return "Global default";
}

function buildRuntimeBindingLabel(template) {
  if (template?.runtimeBindingType === "GL_SOURCE_TYPE" && template?.runtimeBindingCode) {
    return `GL source type: ${template.runtimeBindingCode}`;
  }
  if (
    template?.runtimeBindingType === "CONSOLIDATION_ADJUSTMENT_TYPE" &&
    template?.runtimeBindingCode
  ) {
    return `Consolidation adjustment type: ${template.runtimeBindingCode}`;
  }
  return "Catalog only";
}

function buildTemplateDrillPath(template, cycle) {
  if (template?.runtimeBindingType === "CONSOLIDATION_ADJUSTMENT_TYPE") {
    return buildConsolidationReportsPath();
  }
  if (template?.runtimeBindingType === "GL_SOURCE_TYPE" || template?.runtimeBindingType === "NONE") {
    return buildWorkJournalPath({
      legalEntityId: cycle?.scopeKind === "LEGAL_ENTITY" ? cycle?.legalEntityId : null,
      fiscalPeriodId: cycle?.fiscalPeriodId || null,
    });
  }
  return null;
}

function buildObservedRuntimeSnapshot(template, glCatalog, consolidationCatalog) {
  if (template?.runtimeBindingType === "GL_SOURCE_TYPE" && template?.runtimeBindingCode) {
    const summary = glCatalog.get(template.runtimeBindingCode) || createRuntimeCountRow();
    return {
      governanceMode: "RUNTIME_MAPPED",
      total: summary.total,
      byStatus: summary.byStatus,
    };
  }
  if (
    template?.runtimeBindingType === "CONSOLIDATION_ADJUSTMENT_TYPE" &&
    template?.runtimeBindingCode
  ) {
    const summary = consolidationCatalog.get(template.runtimeBindingCode) || createRuntimeCountRow();
    return {
      governanceMode: "RUNTIME_MAPPED",
      total: summary.total,
      byStatus: summary.byStatus,
    };
  }
  return {
    governanceMode: "CATALOG_ONLY",
    total: null,
    byStatus: {},
  };
}

/**
 * Read the merged close-journal profile catalog for one tenant while
 * preferring tenant-specific overrides over shipped global defaults.
 */
export async function listCloseJournalProfiles(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const result = await runQuery(
    `SELECT *
     FROM close_journal_profiles
     WHERE tenant_id IS NULL OR tenant_id = ?
     ORDER BY
       CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
       profile_code`,
    [tenantId, tenantId]
  );

  let rows = dedupeRowsByCode(
    (result.rows || []).map(mapCloseJournalProfileRow),
    "profileCode"
  );

  if (filters?.journalFamily) {
    const journalFamily = normalizeJournalFamily(filters.journalFamily);
    rows = rows.filter((row) => row.journalFamily === journalFamily);
  }
  if (filters?.scopeKind) {
    rows = rows.filter((row) => row.scopeKind === toUpperText(filters.scopeKind));
  }
  if (filters?.status) {
    rows = rows.filter((row) => row.status === toUpperText(filters.status));
  }

  return {
    rows,
  };
}

/**
 * Read the merged close-journal template catalog for one tenant while
 * preserving the profile-family relationship for cockpit and later routes.
 */
export async function listCloseJournalTemplates(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const result = await runQuery(
    `SELECT
       t.*,
       p.id AS profile_id,
       p.profile_code,
       p.profile_name,
       p.journal_family,
       p.scope_kind AS profile_scope_kind,
       p.legal_entity_id AS profile_legal_entity_id,
       p.consolidation_group_id AS profile_consolidation_group_id,
       p.status AS profile_status
     FROM close_journal_templates t
     JOIN close_journal_profiles p
       ON p.id = t.close_journal_profile_id
     WHERE (t.tenant_id IS NULL OR t.tenant_id = ?)
       AND (p.tenant_id IS NULL OR p.tenant_id = ?)
     ORDER BY
       CASE WHEN t.tenant_id = ? THEN 0 ELSE 1 END,
       t.template_code`,
    [tenantId, tenantId, tenantId]
  );

  let rows = dedupeRowsByCode(
    (result.rows || []).map(mapCloseJournalTemplateRow),
    "templateCode"
  );

  if (filters?.journalFamily) {
    const journalFamily = normalizeJournalFamily(filters.journalFamily);
    rows = rows.filter((row) => row.profile?.journalFamily === journalFamily);
  }
  if (filters?.status) {
    rows = rows.filter((row) => row.status === toUpperText(filters.status));
  }
  if (filters?.runtimeBindingType) {
    rows = rows.filter((row) => row.runtimeBindingType === toUpperText(filters.runtimeBindingType));
  }

  return {
    rows,
  };
}

/**
 * Build the PR-06 governed close-journal catalog for one close cycle so the
 * cockpit can expose family coverage on top of the repo's existing journal
 * and consolidation-adjustment runtimes without changing how those runtimes
 * post entries today.
 */
export async function buildCloseCycleJournalGovernanceSnapshot(
  {
    cycle,
    period,
  } = {},
  actorCtx = {}
) {
  if (!cycle?.id) {
    throw badRequest("cycle is required");
  }

  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const [profileResult, templateResult, glRuntimeCatalog, consolidationRuntimeCatalog] =
    await Promise.all([
      listCloseJournalProfiles({}, { tenantId, runQuery }),
      listCloseJournalTemplates({}, { tenantId, runQuery }),
      loadGlJournalRuntimeCatalog({
        tenantId,
        cycle,
        period,
        runQuery,
      }),
      loadConsolidationAdjustmentRuntimeCatalog({
        tenantId,
        cycle,
        runQuery,
      }),
    ]);

  const relevantProfiles = (profileResult.rows || []).filter((row) => profileMatchesCycle(row, cycle));
  const profileIds = new Set(relevantProfiles.map((row) => row.id));
  const templatesByProfileId = new Map();

  for (const template of templateResult.rows || []) {
    if (!profileIds.has(template.closeJournalProfileId)) {
      continue;
    }
    const existing = templatesByProfileId.get(template.closeJournalProfileId) || [];
    existing.push(template);
    templatesByProfileId.set(template.closeJournalProfileId, existing);
  }

  const familyRows = [];
  for (const journalFamily of CLOSE_JOURNAL_FAMILIES) {
    if (!isFamilyRelevantForCycleScope(journalFamily, cycle.scopeKind)) {
      continue;
    }

    const familyProfiles = relevantProfiles
      .filter((profile) => profile.journalFamily === journalFamily)
      .map((profile) => {
        const profileTemplates = (templatesByProfileId.get(profile.id) || []).map((template) => {
          const observedRuntime = buildObservedRuntimeSnapshot(
            template,
            glRuntimeCatalog,
            consolidationRuntimeCatalog
          );
          return {
            ...template,
            scopeLabel: buildScopeLabelForProfile(profile),
            runtimeBindingLabel: buildRuntimeBindingLabel(template),
            drillPath: buildTemplateDrillPath(template, cycle),
            observedRuntime,
          };
        });

        return {
          ...profile,
          scopeLabel: buildScopeLabelForProfile(profile),
          templates: profileTemplates,
        };
      });

    if (!familyProfiles.length) {
      continue;
    }

    const familyTemplates = familyProfiles.flatMap((profile) => profile.templates || []);
    familyRows.push({
      journalFamily,
      profileCount: familyProfiles.length,
      templateCount: familyTemplates.length,
      runtimeMappedTemplateCount: familyTemplates.filter(
        (row) => row?.observedRuntime?.governanceMode === "RUNTIME_MAPPED"
      ).length,
      catalogOnlyTemplateCount: familyTemplates.filter(
        (row) => row?.observedRuntime?.governanceMode === "CATALOG_ONLY"
      ).length,
      observedRuntimeRowCount: familyTemplates.reduce(
        (total, row) => total + Number(row?.observedRuntime?.total || 0),
        0
      ),
      profiles: familyProfiles,
    });
  }

  const allProfiles = familyRows.flatMap((row) => row.profiles || []);
  const allTemplates = allProfiles.flatMap((row) => row.templates || []);

  // PR-06 intentionally distinguishes runtime-mapped templates from
  // catalog-only rows because several governed families do not yet have a
  // dedicated source discriminator in the repo runtime.
  return {
    summary: {
      profileCount: allProfiles.length,
      templateCount: allTemplates.length,
      familyCount: familyRows.length,
      runtimeMappedTemplateCount: allTemplates.filter(
        (row) => row?.observedRuntime?.governanceMode === "RUNTIME_MAPPED"
      ).length,
      catalogOnlyTemplateCount: allTemplates.filter(
        (row) => row?.observedRuntime?.governanceMode === "CATALOG_ONLY"
      ).length,
      observedRuntimeRowCount: allTemplates.reduce(
        (total, row) => total + Number(row?.observedRuntime?.total || 0),
        0
      ),
    },
    families: familyRows,
  };
}

export default {
  listCloseJournalProfiles,
  listCloseJournalTemplates,
  buildCloseCycleJournalGovernanceSnapshot,
};
