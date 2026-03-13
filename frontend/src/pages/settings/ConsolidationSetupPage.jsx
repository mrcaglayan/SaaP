import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyConsolidationCanonicalRuleMappings,
  applyConsolidationCanonicalMappingCandidates,
  applySavedConsolidationCanonicalMappingRule,
  createConsolidationCanonicalMappingRule,
  createConsolidationRun,
  deactivateConsolidationCanonicalMappingRule,
  executeConsolidationRun,
  finalizeConsolidationRun,
  getConsolidationCanonicalReadiness,
  getConsolidationRun,
  listConsolidationCanonicalMappings,
  listConsolidationCanonicalMappingRules,
  previewConsolidationCanonicalMappingCandidates,
  previewConsolidationCanonicalRuleMappings,
  previewSavedConsolidationCanonicalMappingRule,
  listConsolidationCoaMappings,
  listConsolidationEliminationPlaceholders,
  listConsolidationGroupMembers,
  listConsolidationGroups,
  listConsolidationRuns,
  upsertConsolidationCanonicalGroupMapping,
  upsertConsolidationCanonicalLocalMapping,
  upsertConsolidationCoaMapping,
  upsertConsolidationEliminationPlaceholder,
  upsertConsolidationGroup,
  upsertConsolidationGroupMember,
} from "../../api/consolidationAdmin.js";
import { listAccounts, listCoas } from "../../api/glAdmin.js";
import {
  listFiscalCalendars,
  listFiscalPeriods,
  listGroupCompanies,
  listLegalEntities,
} from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import Combobox from "../../components/Combobox.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const METHODS = ["FULL", "PROPORTIONAL", "EQUITY"];
const DIRECTIONS = ["AUTO", "DEBIT", "CREDIT"];
const RATE_TYPES = ["CLOSING", "SPOT", "AVERAGE"];
const BULK_CANONICAL_RULE_TYPES = ["DESCENDANTS_OF_ACCOUNT", "CODE_PREFIX"];
const CANONICAL_CANDIDATE_PREVIEW_FILTERS = [
  "ALL",
  "UNRESOLVED",
  "MISSING_GROUP_MATCH",
  "PARTIAL_MAPPING",
  "AMBIGUOUS_GROUP_MATCH",
  "SAFE",
  "ALREADY_MAPPED",
];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function padPeriod(value) {
  return String(value || "").padStart(2, "0");
}

function optionListHasValue(options, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return false;
  }
  return (Array.isArray(options) ? options : []).some(
    (option) => String(option?.value || "").trim() === normalizedValue
  );
}

function isActiveAccount(account) {
  const activeRaw = account?.is_active;
  if (activeRaw === false || activeRaw === 0) {
    return false;
  }
  const normalized = String(activeRaw ?? "true").trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function isPostableLeafAccount(account) {
  const allowPostingRaw = account?.allow_posting;
  const allowPosting =
    allowPostingRaw === true ||
    allowPostingRaw === 1 ||
    String(allowPostingRaw || "").trim().toLowerCase() === "true";
  const hasActiveChildrenRaw = account?.has_active_children;
  const hasActiveChildren =
    hasActiveChildrenRaw === true ||
    hasActiveChildrenRaw === 1 ||
    String(hasActiveChildrenRaw || "").trim().toLowerCase() === "true";
  return allowPosting && !hasActiveChildren;
}

function describeAccountShape(account) {
  if (isPostableLeafAccount(account)) {
    return "POSTABLE_LEAF";
  }
  const allowPostingRaw = account?.allow_posting;
  const allowPosting =
    allowPostingRaw === true ||
    allowPostingRaw === 1 ||
    String(allowPostingRaw || "").trim().toLowerCase() === "true";
  return allowPosting ? "POSTABLE_PARENT" : "HEADER";
}

function bulkPreviewBadgeClass(classification) {
  const normalized = String(classification || "").toUpperCase();
  if (normalized === "READY_TO_APPLY") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "ALREADY_ALIGNED") {
    return "bg-slate-200 text-slate-700";
  }
  if (normalized === "CONFLICTING_LOCAL_MAPPING") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "SKIPPED_ALREADY_ALIGNED") {
    return "bg-slate-200 text-slate-700";
  }
  if (normalized.includes("CONFLICT")) {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized.includes("READY")) {
    return "bg-cyan-100 text-cyan-700";
  }
  return "bg-amber-100 text-amber-700";
}

function candidatePreviewFilterMatches(row, filterValue) {
  const normalizedFilter = String(filterValue || "ALL").toUpperCase();
  if (normalizedFilter === "ALL") {
    return true;
  }
  const classification = String(row?.classification || "").toUpperCase();
  if (normalizedFilter === "UNRESOLVED") {
    return (
      classification === "PARTIAL_MAPPING" ||
      classification === "MISSING_GROUP_MATCH" ||
      classification === "AMBIGUOUS_GROUP_MATCH"
    );
  }
  return classification === normalizedFilter;
}

function getCandidatePreviewFilterCount(summary, filterValue) {
  const normalizedFilter = String(filterValue || "ALL").toUpperCase();
  if (normalizedFilter === "ALL") {
    return Number(summary?.total || 0);
  }
  if (normalizedFilter === "UNRESOLVED") {
    return Number(summary?.unresolvedCount || 0);
  }
  if (normalizedFilter === "SAFE") {
    return Number(summary?.safeCount || 0);
  }
  if (normalizedFilter === "ALREADY_MAPPED") {
    return Number(summary?.alreadyMappedCount || 0);
  }
  if (normalizedFilter === "PARTIAL_MAPPING") {
    return Number(summary?.partialMappingCount || 0);
  }
  if (normalizedFilter === "MISSING_GROUP_MATCH") {
    return Number(summary?.missingGroupMatchCount || 0);
  }
  if (normalizedFilter === "AMBIGUOUS_GROUP_MATCH") {
    return Number(summary?.ambiguousGroupMatchCount || 0);
  }
  return 0;
}

function resolveCandidatePreviewGroupAccount(row) {
  const currentGroupAccountId = toPositiveInt(row?.currentMapping?.groupAccountId);
  const currentGroupAccountCode = String(
    row?.currentMapping?.groupAccountCode || ""
  ).trim();
  if (currentGroupAccountId || currentGroupAccountCode) {
    return {
      id: currentGroupAccountId,
      code: currentGroupAccountCode,
      source: "CURRENT_MAPPING",
    };
  }

  const resolvedGroupAccountId = toPositiveInt(row?.resolvedGroupAccountId);
  const resolvedGroupAccountCode = String(row?.resolvedGroupAccountCode || "").trim();
  if (resolvedGroupAccountId || resolvedGroupAccountCode) {
    return {
      id: resolvedGroupAccountId,
      code: resolvedGroupAccountCode,
      source: "CODE_MATCH",
    };
  }

  const expectedGroupAccountId = toPositiveInt(row?.expectedKeyState?.groupAccountId);
  const expectedGroupAccountCode = String(
    row?.expectedKeyState?.groupAccountCode || ""
  ).trim();
  if (expectedGroupAccountId || expectedGroupAccountCode) {
    return {
      id: expectedGroupAccountId,
      code: expectedGroupAccountCode,
      source: "EXPECTED_KEY",
    };
  }

  return {
    id: null,
    code: "",
    source: "",
  };
}

function buildInitialCanonicalLocalForm() {
  return {
    legalEntityId: "",
    localAccountId: "",
    canonicalKey: "",
    canonicalName: "",
    reason: "",
    status: "ACTIVE",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  };
}

function buildInitialCanonicalGroupForm() {
  return {
    groupAccountId: "",
    canonicalKey: "",
    canonicalName: "",
    reason: "",
    status: "ACTIVE",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  };
}

function isLocked(status) {
  return String(status || "").toUpperCase() === "LOCKED";
}

function resolveCanonicalCoverageSnapshot(runPayload) {
  const subaccounts = runPayload?.compatibility?.subaccounts || {};
  const checks = subaccounts?.checks || {};
  const run = runPayload?.run || {};
  return {
    canonicalCoverage: checks.canonicalMappingCoverage === true,
    missingCount: Number(subaccounts?.missingCanonicalMappingCount || 0),
    message: String(subaccounts?.message || "").trim(),
    periodEndDate: toDateOnly(run?.period_end_date || run?.periodEndDate || ""),
  };
}

export default function ConsolidationSetupPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);

  const canReadGroups = hasPermission("consolidation.group.read");
  const canUpsertGroups = hasPermission("consolidation.group.upsert");
  const canUpsertMembers = hasPermission("consolidation.group_member.upsert");
  const canReadMappings = hasPermission("consolidation.coa_mapping.read");
  const canUpsertMappings = hasPermission("consolidation.coa_mapping.upsert");
  const canReadPlaceholders = hasPermission("consolidation.elimination_placeholder.read");
  const canUpsertPlaceholders = hasPermission("consolidation.elimination_placeholder.upsert");
  const canReadRuns = hasPermission("consolidation.run.read");
  const canCreateRuns = hasPermission("consolidation.run.create");
  const canExecuteRuns = hasPermission("consolidation.run.execute");
  const canFinalizeRuns = hasPermission("consolidation.run.finalize");

  const canUsePage = [
    canReadGroups,
    canUpsertGroups,
    canUpsertMembers,
    canReadMappings,
    canUpsertMappings,
    canReadPlaceholders,
    canUpsertPlaceholders,
    canReadRuns,
    canCreateRuns,
    canExecuteRuns,
    canFinalizeRuns,
  ].some(Boolean);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [groupCompanies, setGroupCompanies] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [coas, setCoas] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [members, setMembers] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [canonicalMappings, setCanonicalMappings] = useState([]);
  const [canonicalCandidatePreview, setCanonicalCandidatePreview] = useState(null);
  const [canonicalCandidatePreviewFilter, setCanonicalCandidatePreviewFilter] = useState(
    "ALL"
  );
  const [canonicalCandidateReason, setCanonicalCandidateReason] = useState("");
  const [canonicalRulePreview, setCanonicalRulePreview] = useState(null);
  const [canonicalSavedRules, setCanonicalSavedRules] = useState([]);
  const [canonicalReadiness, setCanonicalReadiness] = useState({
    isLoading: false,
    error: "",
    snapshot: null,
  });
  const [placeholders, setPlaceholders] = useState([]);
  const [runs, setRuns] = useState([]);
  const [runPreflightById, setRunPreflightById] = useState({});
  const [periods, setPeriods] = useState([]);
  const [canonicalCandidateFilters, setCanonicalCandidateFilters] = useState({
    legalEntityId: "",
    limit: "500",
  });

  const [groupForm, setGroupForm] = useState({
    groupCompanyId: "",
    calendarId: "",
    code: "",
    name: "",
    presentationCurrencyCode: "USD",
  });
  const [memberForm, setMemberForm] = useState({
    legalEntityId: "",
    consolidationMethod: "FULL",
    ownershipPct: "1",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  });
  const [mappingForm, setMappingForm] = useState({
    legalEntityId: "",
    groupCoaId: "",
    localCoaId: "",
    status: "ACTIVE",
  });
  const [canonicalLocalForm, setCanonicalLocalForm] = useState(
    buildInitialCanonicalLocalForm
  );
  const [canonicalGroupForm, setCanonicalGroupForm] = useState(
    buildInitialCanonicalGroupForm
  );
  const [canonicalLocalEditTarget, setCanonicalLocalEditTarget] = useState(null);
  const [canonicalGroupEditTarget, setCanonicalGroupEditTarget] = useState(null);
  const [canonicalRuleForm, setCanonicalRuleForm] = useState({
    legalEntityId: "",
    ruleType: "DESCENDANTS_OF_ACCOUNT",
    parentLocalAccountId: "",
    codePrefix: "",
    canonicalKey: "",
    canonicalName: "",
    groupAccountId: "",
    reason: "",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  });
  const [placeholderForm, setPlaceholderForm] = useState({
    placeholderCode: "",
    name: "",
    accountId: "",
    defaultDirection: "AUTO",
    description: "",
    isActive: true,
  });
  const [runForm, setRunForm] = useState({
    fiscalPeriodId: "",
    runName: "",
    presentationCurrencyCode: "USD",
    rateType: "CLOSING",
  });

  const selectedGroup = useMemo(() => {
    const id = toPositiveInt(selectedGroupId);
    if (!id) return null;
    return groups.find((row) => Number(row.id) === id) || null;
  }, [groups, selectedGroupId]);
  const selectedGroupCompanyId = useMemo(
    () => toPositiveInt(selectedGroup?.group_company_id),
    [selectedGroup?.group_company_id]
  );
  const filteredLegalEntities = useMemo(() => {
    if (!selectedGroupCompanyId) {
      return legalEntities;
    }
    return legalEntities.filter(
      (row) => Number(row.group_company_id) === selectedGroupCompanyId
    );
  }, [legalEntities, selectedGroupCompanyId]);

  const groupCoaOptions = useMemo(
    () => coas.filter((row) => String(row.scope || "").toUpperCase() === "GROUP"),
    [coas]
  );

  const localCoaOptions = useMemo(() => {
    const legalEntityId = toPositiveInt(mappingForm.legalEntityId);
    return coas.filter((row) => {
      if (String(row.scope || "").toUpperCase() !== "LEGAL_ENTITY") return false;
      if (!legalEntityId) return true;
      return Number(row.legal_entity_id) === legalEntityId;
    });
  }, [coas, mappingForm.legalEntityId]);

  const coaById = useMemo(() => {
    const out = new Map();
    for (const row of coas) {
      const id = toPositiveInt(row?.id);
      if (id) {
        out.set(id, row);
      }
    }
    return out;
  }, [coas]);

  const activeCanonicalLocalMappingAccountIds = useMemo(() => {
    const ids = new Set();
    for (const row of canonicalMappings) {
      if (String(row?.localMapping?.status || "").toUpperCase() !== "ACTIVE") {
        continue;
      }
      const localAccountId = toPositiveInt(row?.localMapping?.localAccountId);
      if (localAccountId) {
        ids.add(localAccountId);
      }
    }
    return ids;
  }, [canonicalMappings]);

  const canonicalLocalAccountOptions = useMemo(() => {
    const legalEntityId = toPositiveInt(canonicalLocalForm.legalEntityId);
    const selectedLocalAccountId = toPositiveInt(canonicalLocalForm.localAccountId);
    return accounts.filter((row) => {
      if (!isPostableLeafAccount(row)) {
        return false;
      }
      const accountId = toPositiveInt(row?.id);
      if (
        accountId &&
        activeCanonicalLocalMappingAccountIds.has(accountId) &&
        accountId !== selectedLocalAccountId
      ) {
        return false;
      }
      const coaId = toPositiveInt(row?.coa_id);
      const coa = coaById.get(coaId);
      const accountLegalEntityId =
        toPositiveInt(row?.legal_entity_id) || toPositiveInt(coa?.legal_entity_id);
      if (!legalEntityId) {
        return String(coa?.scope || "").toUpperCase() === "LEGAL_ENTITY";
      }
      return accountLegalEntityId === legalEntityId;
    });
  }, [
    accounts,
    activeCanonicalLocalMappingAccountIds,
    coaById,
    canonicalLocalForm.legalEntityId,
    canonicalLocalForm.localAccountId,
  ]);

  const canonicalGroupAccountOptions = useMemo(
    () =>
      accounts.filter((row) => {
        if (!isPostableLeafAccount(row)) {
          return false;
        }
        const coaId = toPositiveInt(row?.coa_id);
        const coa = coaById.get(coaId);
        return String(coa?.scope || row?.scope || "").toUpperCase() === "GROUP";
      }),
    [accounts, coaById]
  );
  const selectedGroupOptions = useMemo(
    () =>
      groups.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [groups]
  );
  const groupCompanySelectOptions = useMemo(
    () =>
      groupCompanies.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [groupCompanies]
  );
  const calendarSelectOptions = useMemo(
    () =>
      calendars.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [calendars]
  );
  const legalEntitySelectOptions = useMemo(
    () =>
      filteredLegalEntities.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [filteredLegalEntities]
  );
  const groupCoaSelectOptions = useMemo(
    () =>
      groupCoaOptions.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [groupCoaOptions]
  );
  const localCoaSelectOptions = useMemo(
    () =>
      localCoaOptions.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [localCoaOptions]
  );
  const canonicalLocalAccountSelectOptions = useMemo(
    () =>
      canonicalLocalAccountOptions.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [canonicalLocalAccountOptions]
  );
  const canonicalGroupAccountSelectOptions = useMemo(
    () =>
      canonicalGroupAccountOptions.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [canonicalGroupAccountOptions]
  );
  const filteredCanonicalCandidateRows = useMemo(() => {
    const rows = Array.isArray(canonicalCandidatePreview?.rows)
      ? canonicalCandidatePreview.rows
      : [];
    return rows.filter((row) =>
      candidatePreviewFilterMatches(row, canonicalCandidatePreviewFilter)
    );
  }, [canonicalCandidatePreview, canonicalCandidatePreviewFilter]);
  const canonicalRuleTypeSelectOptions = useMemo(
    () =>
      BULK_CANONICAL_RULE_TYPES.map((value) => ({
        value,
        label: value,
        description:
          value === "DESCENDANTS_OF_ACCOUNT"
            ? l("Expand posting descendants under a selected root.", "Secili kok altindaki posting descendant hesaplari genislet.")
            : l("Match posting leaf accounts by local account code prefix.", "Lokal hesap kodu on ekiyle posting leaf hesaplari eslestir."),
      })),
    [l]
  );
  const canonicalRuleRootAccountOptions = useMemo(() => {
    const legalEntityId = toPositiveInt(canonicalRuleForm.legalEntityId);
    return accounts
      .filter((row) => {
        if (!isActiveAccount(row)) {
          return false;
        }
        const coaId = toPositiveInt(row?.coa_id);
        const coa = coaById.get(coaId);
        if (String(coa?.scope || "").toUpperCase() !== "LEGAL_ENTITY") {
          return false;
        }
        const accountLegalEntityId =
          toPositiveInt(row?.legal_entity_id) || toPositiveInt(coa?.legal_entity_id);
        return !legalEntityId || accountLegalEntityId === legalEntityId;
      })
      .map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id} · ${describeAccountShape(row)}`,
      }));
  }, [accounts, coaById, canonicalRuleForm.legalEntityId]);
  const accountSelectOptions = useMemo(
    () =>
      accounts.map((row) => ({
        value: String(row.id),
        label: `${row.code} - ${row.name}`,
        description: `#${row.id}`,
      })),
    [accounts]
  );
  const periodSelectOptions = useMemo(
    () =>
      periods.map((row) => ({
        value: String(row.id),
        label: `${row.fiscal_year}-P${padPeriod(row.period_no)} ${row.period_name}`,
        description: `#${row.id}`,
      })),
    [periods]
  );
  const methodSelectOptions = useMemo(
    () => METHODS.map((value) => ({ value, label: value })),
    []
  );
  const directionSelectOptions = useMemo(
    () => DIRECTIONS.map((value) => ({ value, label: value })),
    []
  );
  const rateTypeSelectOptions = useMemo(
    () => RATE_TYPES.map((value) => ({ value, label: value })),
    []
  );
  const activeInactiveSelectOptions = useMemo(
    () => [
      { value: "ACTIVE", label: "ACTIVE" },
      { value: "INACTIVE", label: "INACTIVE" },
    ],
    []
  );

  useEffect(() => {
    setMappingForm((prev) => {
      if (!prev.localCoaId || optionListHasValue(localCoaSelectOptions, prev.localCoaId)) {
        return prev;
      }
      return {
        ...prev,
        localCoaId: "",
      };
    });
  }, [localCoaSelectOptions]);

  useEffect(() => {
    setCanonicalLocalForm((prev) => {
      if (
        !prev.localAccountId ||
        optionListHasValue(canonicalLocalAccountSelectOptions, prev.localAccountId)
      ) {
        return prev;
      }
      return {
        ...prev,
        localAccountId: "",
      };
    });
  }, [canonicalLocalAccountSelectOptions]);

  useEffect(() => {
    setCanonicalGroupForm((prev) => {
      if (
        !prev.groupAccountId ||
        optionListHasValue(canonicalGroupAccountSelectOptions, prev.groupAccountId)
      ) {
        return prev;
      }
      return {
        ...prev,
        groupAccountId: "",
      };
    });
  }, [canonicalGroupAccountSelectOptions]);

  useEffect(() => {
    setCanonicalRuleForm((prev) => {
      if (
        !prev.parentLocalAccountId ||
        optionListHasValue(canonicalRuleRootAccountOptions, prev.parentLocalAccountId)
      ) {
        return prev;
      }
      return {
        ...prev,
        parentLocalAccountId: "",
      };
    });
  }, [canonicalRuleRootAccountOptions]);

  async function loadLookups() {
    const results = await Promise.allSettled([
      listGroupCompanies(),
      listFiscalCalendars(),
      listLegalEntities(),
      listCoas({ includeInactive: true }),
      listAccounts({ includeInactive: true }),
    ]);
    const [companiesRes, calendarsRes, entitiesRes, coasRes, accountsRes] = results;

    if (companiesRes.status === "fulfilled") {
      const rows = companiesRes.value?.rows || [];
      setGroupCompanies(rows);
      setGroupForm((prev) => ({
        ...prev,
        groupCompanyId: prev.groupCompanyId || String(rows[0]?.id || ""),
      }));
    }
    if (calendarsRes.status === "fulfilled") {
      const rows = calendarsRes.value?.rows || [];
      setCalendars(rows);
      setGroupForm((prev) => ({
        ...prev,
        calendarId: prev.calendarId || String(rows[0]?.id || ""),
      }));
    }
    if (entitiesRes.status === "fulfilled") {
      const rows = entitiesRes.value?.rows || [];
      setLegalEntities(rows);
      setMemberForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(rows[0]?.id || ""),
      }));
      setMappingForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(rows[0]?.id || ""),
      }));
      setCanonicalLocalForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(rows[0]?.id || ""),
      }));
    }
    if (coasRes.status === "fulfilled") {
      setCoas(coasRes.value?.rows || []);
    }
    if (accountsRes.status === "fulfilled") {
      setAccounts(accountsRes.value?.rows || []);
    }
  }

  async function loadGroups() {
    if (!canReadGroups) {
      setGroups([]);
      return;
    }
    const response = await listConsolidationGroups();
    const rows = response?.rows || [];
    setGroups(rows);
    setSelectedGroupId((prev) => {
      const current = toPositiveInt(prev);
      if (current && rows.some((row) => Number(row.id) === current)) return prev;
      return String(rows[0]?.id || "");
    });
  }

  async function loadPeriods(group) {
    const calendarId = toPositiveInt(group?.calendar_id);
    if (!calendarId) {
      setPeriods([]);
      return;
    }
    try {
      const response = await listFiscalPeriods(calendarId);
      const rows = response?.rows || [];
      setPeriods(rows);
      setRunForm((prev) => ({
        ...prev,
        fiscalPeriodId: prev.fiscalPeriodId || String(rows[0]?.id || ""),
      }));
    } catch {
      setPeriods([]);
    }
  }

  async function loadRunPreflight(rows) {
    const runIds = (Array.isArray(rows) ? rows : [])
      .map((row) => toPositiveInt(row?.id))
      .filter(Boolean);

    if (!runIds.length || !canReadRuns) {
      setRunPreflightById({});
      return;
    }

    const pending = {};
    for (const runId of runIds) {
      pending[String(runId)] = {
        isLoading: true,
        canonicalCoverage: false,
        missingCount: null,
        message: "",
        error: "",
        periodEndDate: "",
      };
    }
    setRunPreflightById(pending);

    const results = await Promise.allSettled(
      runIds.map((runId) => getConsolidationRun(runId))
    );

    const next = {};
    for (let index = 0; index < results.length; index += 1) {
      const runId = runIds[index];
      const result = results[index];
      if (result.status === "fulfilled") {
        const snapshot = resolveCanonicalCoverageSnapshot(result.value);
        next[String(runId)] = {
          isLoading: false,
          canonicalCoverage: snapshot.canonicalCoverage,
          missingCount: snapshot.missingCount,
          message: snapshot.message,
          error: "",
          periodEndDate: snapshot.periodEndDate || "",
        };
        continue;
      }

      next[String(runId)] = {
        isLoading: false,
        canonicalCoverage: false,
        missingCount: null,
        message: "",
        error: String(
          result.reason?.response?.data?.message ||
            result.reason?.message ||
            "Failed to load run compatibility"
        ),
        periodEndDate: "",
      };
    }
    setRunPreflightById(next);
  }

  async function loadGroupDetails(groupId) {
    const id = toPositiveInt(groupId);
    if (!id) {
      setMembers([]);
      setMappings([]);
      setCanonicalMappings([]);
      setCanonicalCandidatePreview(null);
      setCanonicalCandidateReason("");
      setCanonicalRulePreview(null);
      setCanonicalSavedRules([]);
      setCanonicalReadiness({ isLoading: false, error: "", snapshot: null });
      setPlaceholders([]);
      setRuns([]);
      setRunPreflightById({});
      return;
    }
    setCanonicalCandidateReason("");
    setCanonicalRulePreview(null);
    if (!canReadRuns) {
      setRuns([]);
      setRunPreflightById({});
    }
    if (!canReadMappings) {
      setMappings([]);
      setCanonicalMappings([]);
      setCanonicalCandidatePreview(null);
      setCanonicalSavedRules([]);
      setCanonicalReadiness({ isLoading: false, error: "", snapshot: null });
    } else {
      setCanonicalReadiness((prev) => ({
        isLoading: true,
        error: "",
        snapshot: prev?.snapshot || null,
      }));
    }

    const tasks = [];
    if (canReadGroups) {
      tasks.push(
        listConsolidationGroupMembers(id).then((response) =>
          setMembers(response?.rows || [])
        )
      );
    }
    if (canReadMappings) {
      tasks.push(
        listConsolidationCoaMappings(id).then((response) =>
          setMappings(response?.rows || [])
        )
      );
      tasks.push(
        listConsolidationCanonicalMappings(id).then((response) =>
          setCanonicalMappings(response?.rows || [])
        )
      );
      tasks.push(
        listConsolidationCanonicalMappingRules(id).then((response) =>
          setCanonicalSavedRules(response?.rows || [])
        )
      );
      tasks.push(
        getConsolidationCanonicalReadiness(id, { limit: 5000 })
          .then((response) =>
            setCanonicalReadiness({
              isLoading: false,
              error: "",
              snapshot: response || null,
            })
          )
          .catch((err) =>
            setCanonicalReadiness({
              isLoading: false,
              error: String(
                err?.response?.data?.message ||
                  err?.message ||
                  "Failed to load canonical readiness"
              ),
              snapshot: null,
            })
          )
      );
    }
    if (canReadPlaceholders) {
      tasks.push(
        listConsolidationEliminationPlaceholders(id).then((response) =>
          setPlaceholders(response?.rows || [])
        )
      );
    }
    if (canReadRuns) {
      tasks.push(
        listConsolidationRuns({ consolidationGroupId: id }).then(
          async (response) => {
            const rows = response?.rows || [];
            setRuns(rows);
            await loadRunPreflight(rows);
          }
        )
      );
    }

    await Promise.allSettled(tasks);
  }

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadLookups(), loadGroups()]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to load setup data.", "Kurulum verileri yuklenemedi.")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadGroups]);

  useEffect(() => {
    loadGroupDetails(selectedGroupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, canReadGroups, canReadMappings, canReadPlaceholders, canReadRuns]);

  useEffect(() => {
    loadPeriods(selectedGroup);
    if (selectedGroup?.presentation_currency_code) {
      setRunForm((prev) => ({
        ...prev,
        presentationCurrencyCode: String(selectedGroup.presentation_currency_code).toUpperCase(),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.id]);

  useEffect(() => {
    const fallbackLegalEntityId = String(filteredLegalEntities[0]?.id || "");
    setMemberForm((prev) => {
      const current = toPositiveInt(prev.legalEntityId);
      const isValid =
        current &&
        filteredLegalEntities.some((row) => Number(row.id) === Number(current));
      if (isValid || String(prev.legalEntityId || "") === fallbackLegalEntityId) {
        return prev;
      }
      return { ...prev, legalEntityId: fallbackLegalEntityId };
    });
    setMappingForm((prev) => {
      const current = toPositiveInt(prev.legalEntityId);
      const isValid =
        current &&
        filteredLegalEntities.some((row) => Number(row.id) === Number(current));
      const sameLegalEntity = String(prev.legalEntityId || "") === fallbackLegalEntityId;
      if (isValid || (sameLegalEntity && !prev.localCoaId)) {
        return prev;
      }
      return {
        ...prev,
        legalEntityId: fallbackLegalEntityId,
        localCoaId: "",
      };
    });
    setCanonicalLocalForm((prev) => {
      const current = toPositiveInt(prev.legalEntityId);
      const isValid =
        current &&
        filteredLegalEntities.some((row) => Number(row.id) === Number(current));
      const sameLegalEntity = String(prev.legalEntityId || "") === fallbackLegalEntityId;
      if (isValid || (sameLegalEntity && !prev.localAccountId)) {
        return prev;
      }
      return {
        ...prev,
        legalEntityId: fallbackLegalEntityId,
        localAccountId: "",
      };
    });
    setCanonicalCandidateFilters((prev) => {
      const current = toPositiveInt(prev.legalEntityId);
      if (!current) {
        return prev;
      }
      const isValid = filteredLegalEntities.some(
        (row) => Number(row.id) === Number(current)
      );
      if (isValid) {
        return prev;
      }
      return {
        ...prev,
        legalEntityId: "",
      };
    });
    setCanonicalRuleForm((prev) => {
      const current = toPositiveInt(prev.legalEntityId);
      const isValid =
        current &&
        filteredLegalEntities.some((row) => Number(row.id) === Number(current));
      const nextLegalEntityId = isValid ? String(current) : fallbackLegalEntityId;
      if (
        String(prev.legalEntityId || "") === nextLegalEntityId &&
        (nextLegalEntityId || !prev.parentLocalAccountId)
      ) {
        return prev;
      }
      return {
        ...prev,
        legalEntityId: nextLegalEntityId,
        parentLocalAccountId: "",
      };
    });
  }, [filteredLegalEntities]);

  function findCanonicalDateMisalignedRuns(effectiveFromInput) {
    const effectiveFrom = toDateOnly(effectiveFromInput || todayIso());
    if (!effectiveFrom) {
      return [];
    }

    return (runs || [])
      .map((run) => {
        const runId = toPositiveInt(run?.id);
        const preflight = runPreflightById[String(runId || "")] || null;
        const periodEndDate = toDateOnly(
          preflight?.periodEndDate || run?.period_end_date || ""
        );
        if (!runId || !preflight || !periodEndDate) {
          return null;
        }
        if (preflight.isLoading || preflight.error || preflight.canonicalCoverage === true) {
          return null;
        }
        if (effectiveFrom <= periodEndDate) {
          return null;
        }
        return {
          runId,
          runName: String(run?.run_name || ""),
          periodEndDate,
        };
      })
      .filter(Boolean);
  }

  async function runAction(key, fn, failText, okText) {
    setSaving(key);
    setError("");
    setMessage("");
    try {
      await fn();
      if (okText) setMessage(okText);
      const groupId = toPositiveInt(selectedGroupId);
      if (groupId) await loadGroupDetails(groupId);
    } catch (err) {
      setError(err?.response?.data?.message || failText);
    } finally {
      setSaving("");
    }
  }

  async function onSaveGroup(event) {
    event.preventDefault();
    if (!canUpsertGroups) {
      setError(l("Missing permission: consolidation.group.upsert", "Eksik yetki: consolidation.group.upsert"));
      return;
    }

    const groupCompanyId = toPositiveInt(groupForm.groupCompanyId);
    const calendarId = toPositiveInt(groupForm.calendarId);
    if (!groupCompanyId || !calendarId) {
      setError(l("groupCompanyId and calendarId are required.", "groupCompanyId ve calendarId zorunludur."));
      return;
    }

    await runAction(
      "group",
      async () => {
        await upsertConsolidationGroup({
          groupCompanyId,
          calendarId,
          code: groupForm.code.trim(),
          name: groupForm.name.trim(),
          presentationCurrencyCode: String(groupForm.presentationCurrencyCode).toUpperCase(),
        });
        await loadGroups();
      },
      l("Failed to save consolidation group.", "Konsolidasyon grubu kaydedilemedi."),
      l("Consolidation group saved.", "Konsolidasyon grubu kaydedildi.")
    );
  }

  async function onSaveMember(event) {
    event.preventDefault();
    if (!canUpsertMembers) {
      setError(l("Missing permission: consolidation.group_member.upsert", "Eksik yetki: consolidation.group_member.upsert"));
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(memberForm.legalEntityId);
    const ownershipPct = Number(memberForm.ownershipPct);
    if (!groupId || !legalEntityId || !memberForm.effectiveFrom) {
      setError(l("Group, legalEntityId and effectiveFrom are required.", "Grup, legalEntityId ve effectiveFrom zorunludur."));
      return;
    }
    if (!filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    if (!Number.isFinite(ownershipPct) || ownershipPct < 0) {
      setError(l("ownershipPct must be zero or positive.", "ownershipPct sifir veya pozitif olmalidir."));
      return;
    }

    await runAction(
      "member",
      async () => {
        await upsertConsolidationGroupMember(groupId, {
          legalEntityId,
          consolidationMethod: memberForm.consolidationMethod,
          ownershipPct,
          effectiveFrom: memberForm.effectiveFrom,
          effectiveTo: memberForm.effectiveTo || undefined,
        });
      },
      l("Failed to save group member.", "Grup uyesi kaydedilemedi."),
      l("Group member saved.", "Grup uyesi kaydedildi.")
    );
  }

  async function onSaveMapping(event) {
    event.preventDefault();
    if (!canUpsertMappings) {
      setError(l("Missing permission: consolidation.coa_mapping.upsert", "Eksik yetki: consolidation.coa_mapping.upsert"));
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(mappingForm.legalEntityId);
    const groupCoaId = toPositiveInt(mappingForm.groupCoaId);
    const localCoaId = toPositiveInt(mappingForm.localCoaId);
    if (!groupId || !legalEntityId || !groupCoaId || !localCoaId) {
      setError(l("Group and mapping IDs are required.", "Grup ve esleme ID alanlari zorunludur."));
      return;
    }
    if (!filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }

    await runAction(
      "mapping",
      async () => {
        await upsertConsolidationCoaMapping(groupId, {
          legalEntityId,
          groupCoaId,
          localCoaId,
          status: mappingForm.status,
        });
      },
      l("Failed to save mapping.", "Esleme kaydedilemedi."),
      l("Mapping saved.", "Esleme kaydedildi.")
    );
  }

  async function onSaveCanonicalLocalMapping(event) {
    event.preventDefault();
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalLocalForm.legalEntityId);
    const localAccountId = toPositiveInt(canonicalLocalForm.localAccountId);
    const canonicalKey = String(canonicalLocalForm.canonicalKey || "").trim();
    const editLegalEntityId = toPositiveInt(canonicalLocalEditTarget?.legalEntityId);
    const editLocalAccountId = toPositiveInt(canonicalLocalEditTarget?.localAccountId);

    if (!groupId || !legalEntityId || !localAccountId || !canonicalKey) {
      setError(
        l(
          "Group, legalEntityId, localAccountId and canonicalKey are required.",
          "Grup, legalEntityId, localAccountId ve canonicalKey zorunludur."
        )
      );
      return;
    }
    if (!filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    const effectiveFrom = toDateOnly(canonicalLocalForm.effectiveFrom || todayIso());
    const misalignedRuns = findCanonicalDateMisalignedRuns(effectiveFrom);
    const isExistingActiveMapping = activeCanonicalLocalMappingAccountIds.has(localAccountId);
    if (misalignedRuns.length > 0) {
      const runList = misalignedRuns
        .slice(0, 3)
        .map((row) => `#${row.runId}(${row.periodEndDate})`)
        .join(", ");
      setError(
        l(
          `effectiveFrom ${effectiveFrom} is after run period end for unresolved run(s): ${runList}. Use an effectiveFrom on/before those period end dates.`,
          `effectiveFrom ${effectiveFrom}, cozumlenecek run(lar) icin period end tarihinden sonra: ${runList}. Bu runlar icin effectiveFrom tarihini period end veya oncesi yapin.`
        )
      );
      return;
    }
    if (
      canonicalLocalEditTarget &&
      (legalEntityId !== editLegalEntityId || localAccountId !== editLocalAccountId)
    ) {
      setError(
        l(
          "Changing legal entity or local account during edit would target a different mapping. Cancel edit, retire the current mapping, or create a new mapping intentionally.",
          "Duzenleme sirasinda istirak veya lokal hesap degistirmek farkli bir eslemeyi hedefler. Duzenlemeyi iptal edin, mevcut eslemeyi pasife alin veya bilerek yeni bir esleme olusturun."
        )
      );
      return;
    }

    let saveSucceeded = false;
    await runAction(
      "canonical-local",
      async () => {
        await upsertConsolidationCanonicalLocalMapping(groupId, {
          legalEntityId,
          localAccountId,
          canonicalKey: canonicalKey.toUpperCase(),
          canonicalName: String(canonicalLocalForm.canonicalName || "").trim() || undefined,
          canonicalType: "ACCOUNT",
          status: canonicalLocalForm.status,
          effectiveFrom: canonicalLocalForm.effectiveFrom || undefined,
          effectiveTo: canonicalLocalForm.effectiveTo || undefined,
          reason: String(canonicalLocalForm.reason || "").trim() || undefined,
          source: "UI_WORKBENCH_MANUAL",
        });
        saveSucceeded = true;
      },
      l(
        "Failed to save canonical local mapping.",
        "Canonical local mapping kaydedilemedi."
      ),
      l(
        "Canonical local mapping saved.",
        "Canonical local mapping kaydedildi."
      )
    );
    if (saveSucceeded && !isExistingActiveMapping) {
      setCanonicalLocalForm((prev) => ({
        ...prev,
        localAccountId: "",
        canonicalKey: "",
        canonicalName: "",
        reason: "",
        effectiveTo: "",
      }));
    }
    if (saveSucceeded && canonicalLocalEditTarget) {
      setCanonicalLocalEditTarget(null);
      setCanonicalLocalForm(buildInitialCanonicalLocalForm());
    }
  }

  async function onSaveCanonicalGroupMapping(event) {
    event.preventDefault();
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const groupAccountId = toPositiveInt(canonicalGroupForm.groupAccountId);
    const canonicalKey = String(canonicalGroupForm.canonicalKey || "").trim();
    const editCanonicalKey = String(canonicalGroupEditTarget?.canonicalKey || "")
      .trim()
      .toUpperCase();
    if (!groupId || !groupAccountId || !canonicalKey) {
      setError(
        l(
          "Group, groupAccountId and canonicalKey are required.",
          "Grup, groupAccountId ve canonicalKey zorunludur."
        )
      );
      return;
    }
    if (
      canonicalGroupEditTarget &&
      canonicalKey.toUpperCase() !== editCanonicalKey
    ) {
      setError(
        l(
          "Changing canonical key during group edit would target a different mapping. Cancel edit or update the current canonical key mapping in place.",
          "Grup duzenlemesinde canonical anahtari degistirmek farkli bir eslemeyi hedefler. Duzenlemeyi iptal edin veya mevcut canonical anahtar eslemesini yerinde guncelleyin."
        )
      );
      return;
    }
    const effectiveFrom = toDateOnly(canonicalGroupForm.effectiveFrom || todayIso());
    const misalignedRuns = findCanonicalDateMisalignedRuns(effectiveFrom);
    if (misalignedRuns.length > 0) {
      const runList = misalignedRuns
        .slice(0, 3)
        .map((row) => `#${row.runId}(${row.periodEndDate})`)
        .join(", ");
      setError(
        l(
          `effectiveFrom ${effectiveFrom} is after run period end for unresolved run(s): ${runList}. Use an effectiveFrom on/before those period end dates.`,
          `effectiveFrom ${effectiveFrom}, cozumlenecek run(lar) icin period end tarihinden sonra: ${runList}. Bu runlar icin effectiveFrom tarihini period end veya oncesi yapin.`
        )
      );
      return;
    }

    let saveSucceeded = false;
    await runAction(
      "canonical-group",
      async () => {
        await upsertConsolidationCanonicalGroupMapping(groupId, {
          groupAccountId,
          canonicalKey: canonicalKey.toUpperCase(),
          canonicalName: String(canonicalGroupForm.canonicalName || "").trim() || undefined,
          canonicalType: "ACCOUNT",
          status: canonicalGroupForm.status,
          effectiveFrom: canonicalGroupForm.effectiveFrom || undefined,
          effectiveTo: canonicalGroupForm.effectiveTo || undefined,
          reason: String(canonicalGroupForm.reason || "").trim() || undefined,
          source: "UI_WORKBENCH_MANUAL",
        });
        saveSucceeded = true;
      },
      l(
        "Failed to save canonical group mapping.",
        "Canonical group mapping kaydedilemedi."
      ),
      l(
        "Canonical group mapping saved.",
        "Canonical group mapping kaydedildi."
      )
    );
    if (saveSucceeded && canonicalGroupEditTarget) {
      setCanonicalGroupEditTarget(null);
      setCanonicalGroupForm(buildInitialCanonicalGroupForm());
    }
  }

  async function onPreviewCanonicalCandidates() {
    if (!canReadMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.read",
          "Eksik yetki: consolidation.coa_mapping.read"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalCandidateFilters.legalEntityId);
    const limitRaw = String(canonicalCandidateFilters.limit || "").trim();
    const limit = limitRaw ? toPositiveInt(limitRaw) : null;
    if (!groupId) {
      setError(l("Group is required.", "Grup zorunludur."));
      return;
    }
    if (limitRaw && !limit) {
      setError(l("limit must be a positive integer.", "limit pozitif bir tam sayi olmalidir."));
      return;
    }
    if (
      legalEntityId &&
      !filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)
    ) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }

    setSaving("canonical-candidates-preview");
    setError("");
    setMessage("");
    try {
      const response = await previewConsolidationCanonicalMappingCandidates(groupId, {
        legalEntityId: legalEntityId || undefined,
        limit: limit || undefined,
      });
      setCanonicalCandidatePreview(response || null);
      const safeCount = Number(response?.summary?.safeCount || 0);
      const totalCount = Number(response?.summary?.total || 0);
      setMessage(
        l(
          `Candidate preview ready: ${safeCount}/${totalCount} safe.`,
          `Aday onizleme hazir: ${safeCount}/${totalCount} guvenli.`
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to preview candidates.", "Adaylar onizlenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onApplyCanonicalCandidates() {
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalCandidateFilters.legalEntityId);
    const limitRaw = String(canonicalCandidateFilters.limit || "").trim();
    const limit = limitRaw ? toPositiveInt(limitRaw) : null;
    if (!groupId) {
      setError(l("Group is required.", "Grup zorunludur."));
      return;
    }
    if (limitRaw && !limit) {
      setError(l("limit must be a positive integer.", "limit pozitif bir tam sayi olmalidir."));
      return;
    }
    if (
      legalEntityId &&
      !filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)
    ) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    const highRiskSafeCount = Number(
      (canonicalCandidatePreview?.rows || []).filter(
        (row) =>
          String(row?.classification || "").toUpperCase() === "SAFE" &&
          row?.semanticRisk?.highRisk === true
      ).length
    );
    const applyReason = String(canonicalCandidateReason || "").trim();
    if (highRiskSafeCount > 0 && !applyReason) {
      setError(
        l(
          `Reason is required before applying ${highRiskSafeCount} high-risk safe candidate(s).`,
          `${highRiskSafeCount} adet yuksek-riskli guvenli aday icin uygulama oncesi reason zorunludur.`
        )
      );
      return;
    }

    setSaving("canonical-candidates-apply");
    setError("");
    setMessage("");
    try {
      const response = await applyConsolidationCanonicalMappingCandidates(groupId, {
        legalEntityId: legalEntityId || undefined,
        limit: limit || undefined,
        reason: applyReason || undefined,
        source: "UI_WORKBENCH_CANDIDATE_APPLY",
      });
      const applied = Number(response?.appliedCandidateCount || 0);
      const safeCount = Number(response?.safeCandidateCount || 0);
      setMessage(
        l(
          `Applied ${applied} safe candidate(s) out of ${safeCount}.`,
          `${safeCount} guvenli adaydan ${applied} tanesi uygulandi.`
        )
      );
      await loadGroupDetails(groupId);
      const refreshedPreview = await previewConsolidationCanonicalMappingCandidates(groupId, {
        legalEntityId: legalEntityId || undefined,
        limit: limit || undefined,
      });
      setCanonicalCandidatePreview(refreshedPreview || null);
      setCanonicalCandidateReason("");
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to apply safe candidates.", "Guvenli adaylar uygulanamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  function onEditCanonicalMapping(row) {
    const canonicalKey = String(row?.canonicalKey || "").trim().toUpperCase();
    const canonicalName = String(row?.canonicalName || "").trim();
    const localEffectiveFrom = toDateOnly(row?.localMapping?.effectiveFrom || todayIso());
    const groupEffectiveFrom = toDateOnly(row?.groupMapping?.effectiveFrom || todayIso());

    setCanonicalLocalForm((prev) => ({
      ...prev,
      legalEntityId: row?.localMapping?.legalEntityId
        ? String(row.localMapping.legalEntityId)
        : prev.legalEntityId,
      localAccountId: row?.localMapping?.localAccountId
        ? String(row.localMapping.localAccountId)
        : "",
      canonicalKey,
      canonicalName,
      reason: "",
      status: row?.localMapping?.status || "ACTIVE",
      effectiveFrom: localEffectiveFrom || todayIso(),
      effectiveTo: toDateOnly(row?.localMapping?.effectiveTo || ""),
    }));
    setCanonicalLocalEditTarget(
      row?.localMapping?.id
        ? {
            id: String(row.localMapping.id),
            legalEntityId: row?.localMapping?.legalEntityId
              ? String(row.localMapping.legalEntityId)
              : "",
            localAccountId: row?.localMapping?.localAccountId
              ? String(row.localMapping.localAccountId)
              : "",
            localAccountCode: row?.localMapping?.localAccountCode || "",
          }
        : null
    );
    setCanonicalGroupForm((prev) => ({
      ...prev,
      groupAccountId: row?.groupMapping?.groupAccountId
        ? String(row.groupMapping.groupAccountId)
        : "",
      canonicalKey,
      canonicalName,
      reason: "",
      status: row?.groupMapping?.status || "ACTIVE",
      effectiveFrom: groupEffectiveFrom || todayIso(),
      effectiveTo: toDateOnly(row?.groupMapping?.effectiveTo || ""),
    }));
    setCanonicalGroupEditTarget(
      row?.groupMapping?.id
        ? {
            id: String(row.groupMapping.id),
            canonicalKey: canonicalKey || "",
          }
        : null
    );
    setCanonicalRuleForm((prev) => ({
      ...prev,
      legalEntityId: row?.localMapping?.legalEntityId
        ? String(row.localMapping.legalEntityId)
        : prev.legalEntityId,
      canonicalKey,
      canonicalName,
      groupAccountId: row?.groupMapping?.groupAccountId
        ? String(row.groupMapping.groupAccountId)
        : prev.groupAccountId,
    }));
    setCanonicalRulePreview(null);
    setError("");
    setMessage(
      l(
        `Prefilled canonical edit forms for ${canonicalKey || "selected mapping"}.`,
        `${canonicalKey || "Secilen mapping"} icin canonical duzenleme formlari dolduruldu.`
      )
    );
  }

  function onCancelCanonicalLocalEdit() {
    setCanonicalLocalEditTarget(null);
    setCanonicalLocalForm(buildInitialCanonicalLocalForm());
    setError("");
  }

  function onCancelCanonicalGroupEdit() {
    setCanonicalGroupEditTarget(null);
    setCanonicalGroupForm(buildInitialCanonicalGroupForm());
    setError("");
  }

  async function onPreviewCanonicalRule() {
    if (!canReadMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.read",
          "Eksik yetki: consolidation.coa_mapping.read"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalRuleForm.legalEntityId);
    const ruleType = String(canonicalRuleForm.ruleType || "").trim().toUpperCase();
    const parentLocalAccountId = toPositiveInt(canonicalRuleForm.parentLocalAccountId);
    const codePrefix = String(canonicalRuleForm.codePrefix || "").trim().toUpperCase();
    const canonicalKey = String(canonicalRuleForm.canonicalKey || "").trim().toUpperCase();
    const groupAccountId = toPositiveInt(canonicalRuleForm.groupAccountId);

    if (!groupId || !legalEntityId || !ruleType || !canonicalKey) {
      setError(
        l(
          "Group, legal entity, rule type and canonical key are required.",
          "Grup, istirak, kural tipi ve canonical key zorunludur."
        )
      );
      return;
    }
    if (
      legalEntityId &&
      !filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)
    ) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    if (ruleType === "DESCENDANTS_OF_ACCOUNT" && !parentLocalAccountId) {
      setError(
        l(
          "Select a parent/root local account for descendant expansion.",
          "Descendant genisletme icin parent/root lokal hesap secin."
        )
      );
      return;
    }
    if (ruleType === "CODE_PREFIX" && !codePrefix) {
      setError(
        l(
          "Enter a local account code prefix for prefix rule preview.",
          "Prefix kural onizlemesi icin lokal hesap kodu on eki girin."
        )
      );
      return;
    }

    setSaving("canonical-rule-preview");
    setError("");
    setMessage("");
    try {
      const response = await previewConsolidationCanonicalRuleMappings(groupId, {
        legalEntityId,
        ruleType,
        parentLocalAccountId:
          ruleType === "DESCENDANTS_OF_ACCOUNT"
            ? parentLocalAccountId
            : undefined,
        codePrefix: ruleType === "CODE_PREFIX" ? codePrefix : undefined,
        canonicalKey,
        canonicalName: String(canonicalRuleForm.canonicalName || "").trim() || undefined,
        groupAccountId: groupAccountId || undefined,
        effectiveFrom: canonicalRuleForm.effectiveFrom || undefined,
        effectiveTo: canonicalRuleForm.effectiveTo || undefined,
      });
      setCanonicalRulePreview(response || null);
      setMessage(
        l(
          `Bulk rule preview ready: ${Number(response?.summary?.readyToApplyCount || 0)} ready, ${Number(response?.summary?.conflictCount || 0)} conflicts.`,
          `Toplu kural onizlemesi hazir: ${Number(response?.summary?.readyToApplyCount || 0)} hazir, ${Number(response?.summary?.conflictCount || 0)} cakisma.`
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to preview bulk rule mapping.", "Toplu kural eslemesi onizlenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onApplyCanonicalRule() {
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalRuleForm.legalEntityId);
    const ruleType = String(canonicalRuleForm.ruleType || "").trim().toUpperCase();
    const parentLocalAccountId = toPositiveInt(canonicalRuleForm.parentLocalAccountId);
    const codePrefix = String(canonicalRuleForm.codePrefix || "").trim().toUpperCase();
    const canonicalKey = String(canonicalRuleForm.canonicalKey || "").trim().toUpperCase();
    const groupAccountId = toPositiveInt(canonicalRuleForm.groupAccountId);
    const effectiveFrom = toDateOnly(canonicalRuleForm.effectiveFrom || todayIso());
    const applyReason = String(canonicalRuleForm.reason || "").trim();

    if (!groupId || !legalEntityId || !ruleType || !canonicalKey) {
      setError(
        l(
          "Group, legal entity, rule type and canonical key are required.",
          "Grup, istirak, kural tipi ve canonical key zorunludur."
        )
      );
      return;
    }
    if (
      legalEntityId &&
      !filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)
    ) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    if (ruleType === "DESCENDANTS_OF_ACCOUNT" && !parentLocalAccountId) {
      setError(
        l(
          "Select a parent/root local account for descendant expansion.",
          "Descendant genisletme icin parent/root lokal hesap secin."
        )
      );
      return;
    }
    if (ruleType === "CODE_PREFIX" && !codePrefix) {
      setError(
        l(
          "Enter a local account code prefix for prefix rule apply.",
          "Prefix kural uygulamasi icin lokal hesap kodu on eki girin."
        )
      );
      return;
    }
    const misalignedRuns = findCanonicalDateMisalignedRuns(effectiveFrom);
    if (misalignedRuns.length > 0) {
      const runList = misalignedRuns
        .slice(0, 3)
        .map((row) => `#${row.runId}(${row.periodEndDate})`)
        .join(", ");
      setError(
        l(
          `effectiveFrom ${effectiveFrom} is after run period end for unresolved run(s): ${runList}. Use an effectiveFrom on/before those period end dates.`,
          `effectiveFrom ${effectiveFrom}, cozumlenecek run(lar) icin period end tarihinden sonra: ${runList}. Bu runlar icin effectiveFrom tarihini period end veya oncesi yapin.`
        )
      );
      return;
    }

    setSaving("canonical-rule-apply");
    setError("");
    setMessage("");
    try {
      const response = await applyConsolidationCanonicalRuleMappings(groupId, {
        legalEntityId,
        ruleType,
        parentLocalAccountId:
          ruleType === "DESCENDANTS_OF_ACCOUNT"
            ? parentLocalAccountId
            : undefined,
        codePrefix: ruleType === "CODE_PREFIX" ? codePrefix : undefined,
        canonicalKey,
        canonicalName: String(canonicalRuleForm.canonicalName || "").trim() || undefined,
        groupAccountId: groupAccountId || undefined,
        effectiveFrom: canonicalRuleForm.effectiveFrom || undefined,
        effectiveTo: canonicalRuleForm.effectiveTo || undefined,
        reason: applyReason || undefined,
        source: "UI_WORKBENCH_BULK_RULE_APPLY",
      });
      setMessage(
        l(
          `Bulk rule applied: ${Number(response?.appliedLocalMappings || 0)} local mapping(s), group action ${String(response?.groupMappingAction?.status || "NOT_REQUESTED")}.`,
          `Toplu kural uygulandi: ${Number(response?.appliedLocalMappings || 0)} lokal esleme, grup aksiyonu ${String(response?.groupMappingAction?.status || "NOT_REQUESTED")}.`
        )
      );
      setCanonicalRulePreview(null);
      setCanonicalRuleForm((prev) => ({
        ...prev,
        reason: "",
      }));
      await loadGroupDetails(groupId);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to apply bulk rule mapping.", "Toplu kural eslemesi uygulanamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  function onReuseSavedCanonicalRule(rule) {
    setCanonicalRuleForm((prev) => ({
      ...prev,
      legalEntityId: rule?.legalEntityId ? String(rule.legalEntityId) : prev.legalEntityId,
      ruleType: String(rule?.ruleType || "DESCENDANTS_OF_ACCOUNT"),
      parentLocalAccountId: rule?.parentLocalAccountId
        ? String(rule.parentLocalAccountId)
        : "",
      codePrefix: String(rule?.codePrefix || ""),
      canonicalKey: String(rule?.canonicalKey || ""),
      canonicalName: String(rule?.canonicalName || ""),
      groupAccountId: rule?.groupAccountId ? String(rule.groupAccountId) : "",
      reason: String(rule?.reason || ""),
      effectiveFrom: toDateOnly(rule?.effectiveFrom || todayIso()),
      effectiveTo: toDateOnly(rule?.effectiveTo || ""),
    }));
    setCanonicalRulePreview(null);
    setMessage(
      l(
        `Saved rule ${rule?.id || ""} loaded into the bulk mapping form.`,
        `Kayitli kural ${rule?.id || ""} toplu esleme formuna yuklendi.`
      )
    );
  }

  async function onSaveCanonicalRuleDefinition() {
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const legalEntityId = toPositiveInt(canonicalRuleForm.legalEntityId);
    const ruleType = String(canonicalRuleForm.ruleType || "").trim().toUpperCase();
    const parentLocalAccountId = toPositiveInt(canonicalRuleForm.parentLocalAccountId);
    const codePrefix = String(canonicalRuleForm.codePrefix || "").trim().toUpperCase();
    const canonicalKey = String(canonicalRuleForm.canonicalKey || "").trim().toUpperCase();
    const groupAccountId = toPositiveInt(canonicalRuleForm.groupAccountId);
    if (!groupId || !legalEntityId || !ruleType || !canonicalKey) {
      setError(
        l(
          "Group, legal entity, rule type and canonical key are required.",
          "Grup, istirak, kural tipi ve canonical key zorunludur."
        )
      );
      return;
    }
    if (
      legalEntityId &&
      !filteredLegalEntities.some((row) => Number(row.id) === legalEntityId)
    ) {
      setError(
        l(
          "Selected legal entity must belong to selected group company.",
          "Secilen istirak / bagli ortak secili grup sirketine ait olmalidir."
        )
      );
      return;
    }
    if (ruleType === "DESCENDANTS_OF_ACCOUNT" && !parentLocalAccountId) {
      setError(
        l(
          "Select a parent/root local account for descendant rules before saving.",
          "Kaydetmeden once descendant kural icin parent/root lokal hesap secin."
        )
      );
      return;
    }
    if (ruleType === "CODE_PREFIX" && !codePrefix) {
      setError(
        l(
          "Enter a local account code prefix before saving a prefix rule.",
          "Prefix kural kaydetmeden once lokal hesap kodu on eki girin."
        )
      );
      return;
    }

    await runAction(
      "canonical-rule-save",
      async () => {
        await createConsolidationCanonicalMappingRule(groupId, {
          legalEntityId,
          ruleType,
          parentLocalAccountId:
            ruleType === "DESCENDANTS_OF_ACCOUNT"
              ? parentLocalAccountId
              : undefined,
          codePrefix: ruleType === "CODE_PREFIX" ? codePrefix : undefined,
          canonicalKey,
          canonicalName: String(canonicalRuleForm.canonicalName || "").trim() || undefined,
          groupAccountId: groupAccountId || undefined,
          effectiveFrom: canonicalRuleForm.effectiveFrom || undefined,
          effectiveTo: canonicalRuleForm.effectiveTo || undefined,
          reason: String(canonicalRuleForm.reason || "").trim() || undefined,
          status: "ACTIVE",
        });
      },
      l(
        "Failed to save canonical bulk rule.",
        "Canonical toplu kural kaydedilemedi."
      ),
      l(
        "Canonical bulk rule saved.",
        "Canonical toplu kural kaydedildi."
      )
    );
  }

  async function onPreviewSavedCanonicalRule(rule) {
    if (!canReadMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.read",
          "Eksik yetki: consolidation.coa_mapping.read"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const ruleId = toPositiveInt(rule?.id);
    if (!groupId || !ruleId) {
      setError(l("Group and ruleId are required.", "Grup ve ruleId zorunludur."));
      return;
    }

    setSaving(`canonical-rule-saved-preview-${ruleId}`);
    setError("");
    setMessage("");
    try {
      const response = await previewSavedConsolidationCanonicalMappingRule(
        groupId,
        ruleId
      );
      setCanonicalRulePreview(response || null);
      setMessage(
        l(
          `Saved rule preview ready for rule #${ruleId}.`,
          `Kayitli kural onizlemesi #${ruleId} icin hazir.`
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to preview saved rule.", "Kayitli kural onizlenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onApplySavedCanonicalRule(rule) {
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const ruleId = toPositiveInt(rule?.id);
    const effectiveFrom = toDateOnly(rule?.effectiveFrom || todayIso());
    if (!groupId || !ruleId) {
      setError(l("Group and ruleId are required.", "Grup ve ruleId zorunludur."));
      return;
    }
    const misalignedRuns = findCanonicalDateMisalignedRuns(effectiveFrom);
    if (misalignedRuns.length > 0) {
      const runList = misalignedRuns
        .slice(0, 3)
        .map((row) => `#${row.runId}(${row.periodEndDate})`)
        .join(", ");
      setError(
        l(
          `Saved rule effectiveFrom ${effectiveFrom} is after run period end for unresolved run(s): ${runList}. Reuse the rule in the workbench and set an effectiveFrom on/before those period end dates before apply.`,
          `Kayitli kural effectiveFrom ${effectiveFrom}, cozumlenecek run(lar) icin period end tarihinden sonra: ${runList}. Uygulamadan once kurali workbench formuna yukleyip effectiveFrom tarihini bu runlar icin period end veya oncesine cekin.`
        )
      );
      return;
    }

    setSaving(`canonical-rule-saved-apply-${ruleId}`);
    setError("");
    setMessage("");
    try {
      const response = await applySavedConsolidationCanonicalMappingRule(groupId, ruleId, {
        reason: String(rule?.reason || "").trim() || undefined,
        source: "UI_SAVED_RULE_APPLY",
      });
      setCanonicalRulePreview(null);
      setMessage(
        l(
          `Saved rule #${ruleId} applied: ${Number(response?.appliedLocalMappings || 0)} local mapping(s).`,
          `Kayitli kural #${ruleId} uygulandi: ${Number(response?.appliedLocalMappings || 0)} lokal esleme.`
        )
      );
      await loadGroupDetails(groupId);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to apply saved rule.", "Kayitli kural uygulanamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onDeactivateSavedCanonicalRule(rule) {
    if (!canUpsertMappings) {
      setError(
        l(
          "Missing permission: consolidation.coa_mapping.upsert",
          "Eksik yetki: consolidation.coa_mapping.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const ruleId = toPositiveInt(rule?.id);
    if (!groupId || !ruleId) {
      setError(l("Group and ruleId are required.", "Grup ve ruleId zorunludur."));
      return;
    }

    setSaving(`canonical-rule-saved-deactivate-${ruleId}`);
    setError("");
    setMessage("");
    try {
      await deactivateConsolidationCanonicalMappingRule(groupId, ruleId, {
        reason: l(
          "Deactivated from canonical bulk mapping workbench.",
          "Canonical toplu esleme workbench ekranindan deaktive edildi."
        ),
      });
      if (
        toPositiveInt(canonicalRulePreview?.savedRule?.id) === ruleId ||
        toPositiveInt(canonicalRulePreview?.ruleId) === ruleId
      ) {
        setCanonicalRulePreview(null);
      }
      setMessage(
        l(
          `Saved rule #${ruleId} deactivated.`,
          `Kayitli kural #${ruleId} deaktive edildi.`
        )
      );
      await loadGroupDetails(groupId);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to deactivate saved rule.", "Kayitli kural deaktive edilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onSavePlaceholder(event) {
    event.preventDefault();
    if (!canUpsertPlaceholders) {
      setError(
        l(
          "Missing permission: consolidation.elimination_placeholder.upsert",
          "Eksik yetki: consolidation.elimination_placeholder.upsert"
        )
      );
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const accountId = placeholderForm.accountId
      ? toPositiveInt(placeholderForm.accountId)
      : null;
    if (!groupId || !placeholderForm.placeholderCode.trim() || !placeholderForm.name.trim()) {
      setError(l("Group, placeholderCode and name are required.", "Grup, placeholderCode ve name zorunludur."));
      return;
    }
    if (placeholderForm.accountId && !accountId) {
      setError(l("accountId must be a positive integer.", "accountId pozitif bir tam sayi olmalidir."));
      return;
    }

    await runAction(
      "placeholder",
      async () => {
        await upsertConsolidationEliminationPlaceholder(groupId, {
          placeholderCode: placeholderForm.placeholderCode.trim().toUpperCase(),
          name: placeholderForm.name.trim(),
          accountId: accountId || undefined,
          defaultDirection: placeholderForm.defaultDirection,
          description: placeholderForm.description.trim() || undefined,
          isActive: Boolean(placeholderForm.isActive),
        });
      },
      l("Failed to save placeholder.", "Placeholder kaydedilemedi."),
      l("Placeholder saved.", "Placeholder kaydedildi.")
    );
  }

  async function onCreateRun(event) {
    event.preventDefault();
    if (!canCreateRuns) {
      setError(l("Missing permission: consolidation.run.create", "Eksik yetki: consolidation.run.create"));
      return;
    }

    const groupId = toPositiveInt(selectedGroupId);
    const fiscalPeriodId = toPositiveInt(runForm.fiscalPeriodId);
    if (!groupId || !fiscalPeriodId || !runForm.runName.trim()) {
      setError(l("Group, fiscalPeriodId and runName are required.", "Grup, fiscalPeriodId ve runName zorunludur."));
      return;
    }

    await runAction(
      "run-create",
      async () => {
        await createConsolidationRun({
          consolidationGroupId: groupId,
          fiscalPeriodId,
          runName: runForm.runName.trim(),
          presentationCurrencyCode: String(runForm.presentationCurrencyCode).toUpperCase(),
        });
      },
      l("Failed to create run.", "Run olusturulamadi."),
      l("Run created.", "Run olusturuldu.")
    );
  }

  async function onExecuteRun(runId) {
    if (!canExecuteRuns) {
      setError(l("Missing permission: consolidation.run.execute", "Eksik yetki: consolidation.run.execute"));
      return;
    }
    const preflight = runPreflightById[String(runId)] || null;
    if (!preflight || preflight.canonicalCoverage !== true) {
      const missingCount = Number(preflight?.missingCount || 0);
      setError(
        missingCount > 0
          ? l(
              `Canonical mapping coverage is missing (${missingCount} account(s)). Complete mappings before Execute.`,
              `Canonical mapping coverage eksik (${missingCount} hesap). Execute oncesi eslemeleri tamamlayin.`
            )
          : l(
              "Canonical mapping preflight is not ready. Refresh run compatibility before Execute.",
              "Canonical mapping preflight hazir degil. Execute oncesi run uyumluluk durumunu yenileyin."
            )
      );
      return;
    }

    await runAction(
      `run-exec-${runId}`,
      async () => {
        await executeConsolidationRun(runId, { rateType: runForm.rateType });
      },
      l("Failed to execute run.", "Run execute edilemedi."),
      l("Run executed.", "Run execute edildi.")
    );
  }

  async function onFinalizeRun(runId) {
    if (!canFinalizeRuns) {
      setError(l("Missing permission: consolidation.run.finalize", "Eksik yetki: consolidation.run.finalize"));
      return;
    }

    await runAction(
      `run-final-${runId}`,
      async () => {
        await finalizeConsolidationRun(runId);
      },
      l("Failed to finalize run.", "Run final edilemedi."),
      l("Run finalized.", "Run final edildi.")
    );
  }

  if (!canUsePage) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l("You need consolidation setup permissions.", "Konsolidasyon kurulum yetkileri gerekir.")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TenantReadinessChecklist />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{l("Consolidation Setup", "Konsolidasyon Kurulumu")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Manage groups, members, mappings, elimination placeholders and runs.",
            "Grup, uye, esleme, placeholder ve run yonetimi."
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">{l("Groups", "Gruplar")}</h2>
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
          >
            {loading ? l("Loading...", "Yukleniyor...") : l("Refresh", "Yenile")}
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <Combobox
            value={selectedGroupId || null}
            options={selectedGroupOptions}
            onChange={(nextValue) =>
              setSelectedGroupId(nextValue ? String(nextValue) : "")
            }
            placeholder={l("Select group", "Grup secin")}
            noOptionsText={l("No groups found.", "Grup bulunamadi.")}
            className="md:col-span-2"
            clearable={false}
          />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {selectedGroup
              ? `${selectedGroup.code} (${selectedGroup.presentation_currency_code})`
              : l("No group selected", "Grup secilmedi")}
          </div>
        </div>

        <form onSubmit={onSaveGroup} className="mt-3 grid gap-2 md:grid-cols-5">
          <Combobox
            value={groupForm.groupCompanyId || null}
            options={groupCompanySelectOptions}
            onChange={(nextValue) =>
              setGroupForm((prev) => ({
                ...prev,
                groupCompanyId: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("Select group company", "Grup sirketi secin")}
            noOptionsText={l("No group companies found.", "Grup sirketi bulunamadi.")}
            clearable={false}
          />

          <Combobox
            value={groupForm.calendarId || null}
            options={calendarSelectOptions}
            onChange={(nextValue) =>
              setGroupForm((prev) => ({
                ...prev,
                calendarId: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("Select calendar", "Takvim secin")}
            noOptionsText={l("No calendars found.", "Takvim bulunamadi.")}
            clearable={false}
          />

          <input
            value={groupForm.code}
            onChange={(event) => setGroupForm((prev) => ({ ...prev, code: event.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Code", "Kod")}
            required
          />
          <input
            value={groupForm.name}
            onChange={(event) => setGroupForm((prev) => ({ ...prev, name: event.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Name", "Ad")}
            required
          />

          <div className="flex gap-2">
            <input
              value={groupForm.presentationCurrencyCode}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, presentationCurrencyCode: event.target.value.toUpperCase() }))
              }
              maxLength={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Currency", "Para birimi")}
              required
            />
            <button
              type="submit"
              disabled={saving === "group"}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "group" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
            </button>
          </div>
        </form>
      </section>

      {toPositiveInt(selectedGroupId) && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                {l("Canonical Readiness", "Canonical Hazirlik")}
              </h2>
              <button
                type="button"
                onClick={() => loadGroupDetails(selectedGroupId)}
                disabled={loading || canonicalReadiness.isLoading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              >
                {canonicalReadiness.isLoading
                  ? l("Refreshing...", "Yenileniyor...")
                  : l("Refresh readiness", "Hazirligi yenile")}
              </button>
            </div>

            {!canReadMappings ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {l(
                  "Missing permission: consolidation.coa_mapping.read",
                  "Eksik yetki: consolidation.coa_mapping.read"
                )}
              </div>
            ) : canonicalReadiness.isLoading && !canonicalReadiness.snapshot ? (
              <div className="text-xs text-slate-500">
                {l(
                  "Loading canonical readiness snapshot...",
                  "Canonical hazirlik ozeti yukleniyor..."
                )}
              </div>
            ) : canonicalReadiness.error ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {canonicalReadiness.error}
              </div>
            ) : canonicalReadiness.snapshot ? (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${
                      canonicalReadiness.snapshot.ready
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {canonicalReadiness.snapshot.ready
                      ? l("READY", "HAZIR")
                      : l("SETUP_REQUIRED", "KURULUM_GEREKLI")}
                  </span>
                  <span className="text-slate-600">
                    {l("coverage", "kapsam")}:{" "}
                    {canonicalReadiness.snapshot.coverageDetected
                      ? l("detected", "algilandi")
                      : l("missing", "eksik")}
                  </span>
                  {canonicalReadiness.snapshot.blockedReason && (
                    <span className="text-amber-700">
                      {l("blocked reason", "engel nedeni")}:{" "}
                      {canonicalReadiness.snapshot.blockedReason}
                    </span>
                  )}
                </div>
                <div className="text-slate-700">
                  {l("Summary", "Ozet")}:{" "}
                  {l("total", "toplam")}{" "}
                  {Number(canonicalReadiness.snapshot?.summary?.total || 0)} |{" "}
                  SAFE {Number(canonicalReadiness.snapshot?.summary?.safeCount || 0)} |{" "}
                  UNRESOLVED{" "}
                  {Number(canonicalReadiness.snapshot?.summary?.unresolvedCount || 0)} |{" "}
                  PARTIAL{" "}
                  {Number(canonicalReadiness.snapshot?.summary?.partialMappingCount || 0)} |{" "}
                  MISSING{" "}
                  {Number(
                    canonicalReadiness.snapshot?.summary?.missingGroupMatchCount || 0
                  )}{" "}
                  | AMBIGUOUS{" "}
                  {Number(
                    canonicalReadiness.snapshot?.summary?.ambiguousGroupMatchCount || 0
                  )}
                </div>
                <div className="max-h-32 overflow-auto rounded border border-slate-200 p-2 text-[11px] text-slate-700">
                  {(canonicalReadiness.snapshot?.byLegalEntity || []).length === 0 ? (
                    <div className="text-slate-500">
                      {l("No legal entity readiness rows", "Istirak bazli hazirlik satiri yok")}
                    </div>
                  ) : (
                    (canonicalReadiness.snapshot?.byLegalEntity || []).map((row) => (
                      <div
                        key={`canonical-readiness-le-${row?.legalEntityId || "na"}`}
                        className="border-b border-slate-100 py-1 last:border-0"
                      >
                        LE {row?.legalEntityId || "-"} ({row?.legalEntityCode || "-"}) |{" "}
                        {row?.readinessState || "-"} |{" "}
                        {l("unresolved", "cozumlenecek")}{" "}
                        {Number(row?.unresolvedCount || 0)} / {l("total", "toplam")}{" "}
                        {Number(row?.total || 0)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                {l(
                  "Canonical readiness snapshot is not available yet.",
                  "Canonical hazirlik ozeti henuz mevcut degil."
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Members", "Uyeler")}</h2>
            <form onSubmit={onSaveMember} className="grid gap-2 md:grid-cols-5">
              <Combobox
                value={memberForm.legalEntityId || null}
                options={legalEntitySelectOptions}
                onChange={(nextValue) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                className="md:col-span-2"
                placeholder={l("Select legal entity", "Istirak / bagli ortak secin")}
                noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
                clearable={false}
              />
              <Combobox
                value={memberForm.consolidationMethod || null}
                options={methodSelectOptions}
                onChange={(nextValue) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    consolidationMethod: nextValue ? String(nextValue) : "FULL",
                  }))
                }
                placeholder={l("Consolidation method", "Konsolidasyon yontemi")}
                clearable={false}
              />
              <input
                type="number"
                min="0"
                step="0.0001"
                value={memberForm.ownershipPct}
                onChange={(event) => setMemberForm((prev) => ({ ...prev, ownershipPct: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Ownership %", "Sahiplik %")}
                required
              />
              <button type="submit" disabled={saving === "member"} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving === "member" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
              </button>
              <input
                type="date"
                value={memberForm.effectiveFrom}
                onChange={(event) => setMemberForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                required
              />
              <input
                type="date"
                value={memberForm.effectiveTo}
                onChange={(event) => setMemberForm((prev) => ({ ...prev, effectiveTo: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              />
            </form>
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 text-xs">
              {members.length === 0 ? (
                <div className="text-slate-500">{l("No members", "Uye yok")}</div>
              ) : (
                members.map((row) => (
                  <div key={row.id} className="border-b border-slate-100 py-1 last:border-0">
                    #{row.id} | LE {row.legal_entity_id} | {row.consolidation_method} | {row.ownership_pct}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("CoA Mappings", "Hesap Plani Eslemeleri")}</h2>
            <form onSubmit={onSaveMapping} className="grid gap-2 md:grid-cols-4">
              <Combobox
                value={mappingForm.legalEntityId || null}
                options={legalEntitySelectOptions}
                onChange={(nextValue) =>
                  setMappingForm((prev) => ({
                    ...prev,
                    legalEntityId: nextValue ? String(nextValue) : "",
                    localCoaId: "",
                  }))
                }
                placeholder={l("Select legal entity", "Istirak / bagli ortak secin")}
                noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
                clearable={false}
              />
              <Combobox
                value={mappingForm.groupCoaId || null}
                options={groupCoaSelectOptions}
                onChange={(nextValue) =>
                  setMappingForm((prev) => ({
                    ...prev,
                    groupCoaId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Select group CoA", "Grup HP secin")}
                noOptionsText={l("No group CoA found.", "Grup HP bulunamadi.")}
                clearable={false}
              />
              <Combobox
                value={mappingForm.localCoaId || null}
                options={localCoaSelectOptions}
                onChange={(nextValue) =>
                  setMappingForm((prev) => ({
                    ...prev,
                    localCoaId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Select local CoA", "Lokal HP secin")}
                noOptionsText={l("No local CoA found.", "Lokal HP bulunamadi.")}
                clearable={false}
              />
              <div className="flex gap-2">
                <Combobox
                  value={mappingForm.status || null}
                  options={activeInactiveSelectOptions}
                  onChange={(nextValue) =>
                    setMappingForm((prev) => ({
                      ...prev,
                      status: nextValue ? String(nextValue) : "ACTIVE",
                    }))
                  }
                  className="w-full"
                  clearable={false}
                />
                <button type="submit" disabled={saving === "mapping"} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {saving === "mapping" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
                </button>
              </div>
            </form>
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 text-xs">
              {mappings.length === 0 ? (
                <div className="text-slate-500">{l("No mappings", "Esleme yok")}</div>
              ) : (
                mappings.map((row) => (
                  <div key={row.id} className="border-b border-slate-100 py-1 last:border-0">
                    #{row.id} | LE {row.legal_entity_id} | G-COA {row.group_coa_id} | L-COA {row.local_coa_id} | {row.status}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              {l("Canonical Mappings", "Canonical Eslemeler")}
            </h2>
            <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-5">
              <Combobox
                value={canonicalCandidateFilters.legalEntityId || null}
                options={legalEntitySelectOptions}
                onChange={(nextValue) =>
                  setCanonicalCandidateFilters((prev) => ({
                    ...prev,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                className="md:col-span-2"
                placeholder={l(
                  "Legal entity (optional)",
                  "Istirak / bagli ortak (opsiyonel)"
                )}
                noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
              />
              <input
                type="number"
                min={1}
                value={canonicalCandidateFilters.limit}
                onChange={(event) =>
                  setCanonicalCandidateFilters((prev) => ({
                    ...prev,
                    limit: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Candidate limit", "Aday limiti")}
              />
              <button
                type="button"
                onClick={onPreviewCanonicalCandidates}
                disabled={
                  saving === "canonical-candidates-preview" ||
                  saving === "canonical-candidates-apply"
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {saving === "canonical-candidates-preview"
                  ? l("Previewing...", "Onizleniyor...")
                  : l("Preview candidates", "Adaylari onizle")}
              </button>
              <button
                type="button"
                onClick={onApplyCanonicalCandidates}
                disabled={
                  saving === "canonical-candidates-preview" ||
                  saving === "canonical-candidates-apply"
                }
                className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "canonical-candidates-apply"
                  ? l("Applying...", "Uygulaniyor...")
                  : l("Apply safe candidates", "Guvenli adaylari uygula")}
              </button>
              <input
                value={canonicalCandidateReason}
                onChange={(event) => setCanonicalCandidateReason(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-5"
                placeholder={l(
                  "Apply reason (required when SAFE rows have high-risk semantic warnings)",
                  "Uygulama nedeni (SAFE satirlarda yuksek-risk semantic uyari varsa zorunlu)"
                )}
              />
            </div>

            {canonicalCandidatePreview && (
              <div className="mb-3 rounded-lg border border-slate-200 p-2 text-xs text-slate-700">
                <div>
                  {l("Candidate summary", "Aday ozeti")}:{" "}
                  {l("total", "toplam")}{" "}
                  {Number(canonicalCandidatePreview?.summary?.total || 0)} |{" "}
                  SAFE {Number(canonicalCandidatePreview?.summary?.safeCount || 0)} |{" "}
                  ALREADY_MAPPED{" "}
                  {Number(canonicalCandidatePreview?.summary?.alreadyMappedCount || 0)} |{" "}
                  PARTIAL_MAPPING{" "}
                  {Number(canonicalCandidatePreview?.summary?.partialMappingCount || 0)} |{" "}
                  MISSING_GROUP_MATCH{" "}
                  {Number(
                    canonicalCandidatePreview?.summary?.missingGroupMatchCount || 0
                  )}{" "}
                  | AMBIGUOUS_GROUP_MATCH{" "}
                  {Number(
                    canonicalCandidatePreview?.summary?.ambiguousGroupMatchCount || 0
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-600">
                  {l("semantic warned", "semantic uyarili")}{" "}
                  {Number(canonicalCandidatePreview?.summary?.semanticWarningCount || 0)}{" "}
                  | {l("semantic high-risk", "semantic yuksek-risk")}{" "}
                  {Number(canonicalCandidatePreview?.summary?.semanticHighRiskCount || 0)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {CANONICAL_CANDIDATE_PREVIEW_FILTERS.map((filterValue) => {
                    const isActive = canonicalCandidatePreviewFilter === filterValue;
                    const count = getCandidatePreviewFilterCount(
                      canonicalCandidatePreview?.summary,
                      filterValue
                    );
                    const label =
                      filterValue === "ALL"
                        ? l("All", "Tum")
                        : filterValue === "UNRESOLVED"
                          ? l("Unresolved", "Cozumlenecek")
                          : filterValue === "MISSING_GROUP_MATCH"
                            ? l("Missing", "Eksik")
                            : filterValue === "PARTIAL_MAPPING"
                              ? l("Partial", "Kismi")
                              : filterValue === "AMBIGUOUS_GROUP_MATCH"
                                ? l("Ambiguous", "Belirsiz")
                                : filterValue === "ALREADY_MAPPED"
                                  ? l("Aligned", "Eslenmis")
                                  : filterValue;
                    return (
                      <button
                        key={filterValue}
                        type="button"
                        onClick={() => setCanonicalCandidatePreviewFilter(filterValue)}
                        className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          isActive
                            ? "border-cyan-300 bg-cyan-100 text-cyan-800"
                            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {label} {count}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 text-[11px] text-slate-600">
                  {l("Showing", "Gosterilen")} {filteredCanonicalCandidateRows.length} /{" "}
                  {Number(canonicalCandidatePreview?.summary?.total || 0)}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {l(
                    "Headers: LE = Legal Entity, L = Local Account, G = Group Account, K = Canonical Key.",
                    "Basliklar: LE = Istirak / Bagli Ortak, L = Lokal Hesap, G = Grup Hesabi, K = Canonical Anahtar."
                  )}
                </div>
                <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-200">
                  {filteredCanonicalCandidateRows.length === 0 ? (
                    <div className="p-2 text-slate-500">
                      {canonicalCandidatePreview?.rows?.length
                        ? l(
                            "No candidate rows for the selected filter.",
                            "Secili filtre icin aday satiri yok."
                          )
                        : l("No candidate rows", "Aday satiri yok")}
                    </div>
                  ) : (
                    <table className="min-w-[900px] w-full text-[11px] text-slate-700">
                      <thead className="text-left text-[10px] uppercase tracking-wide text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Status", "Durum")}
                          </th>
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Legal Entity (LE)", "Istirak / Bagli Ortak (LE)")}
                          </th>
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Local Account (L)", "Lokal Hesap (L)")}
                          </th>
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Group Account (G)", "Grup Hesabi (G)")}
                          </th>
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Canonical Key (K)", "Canonical Anahtar (K)")}
                          </th>
                          <th
                            scope="col"
                            className="sticky top-0 z-10 bg-slate-50 px-2 py-2 font-semibold"
                          >
                            {l("Reason", "Neden")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCanonicalCandidateRows.map((row) => {
                          const groupAccount = resolveCandidatePreviewGroupAccount(row);
                          const groupAccountSourceLabel =
                            groupAccount.source === "CURRENT_MAPPING"
                              ? l("Active mapping", "Aktif esleme")
                              : groupAccount.source === "CODE_MATCH"
                                ? l("Code match", "Kod eslesmesi")
                                : groupAccount.source === "EXPECTED_KEY"
                                  ? l("Expected key", "Beklenen anahtar")
                                  : "";
                          return (
                            <tr
                              key={`${row?.legalEntityId || "le"}-${row?.localAccountId || "acc"}-${row?.expectedCanonicalKey || "key"}`}
                              className="border-b border-slate-100 align-top last:border-0"
                            >
                              <td className="px-2 py-2 align-top">
                                <div className="font-semibold text-slate-800">
                                  {row?.classification || "-"}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="font-medium text-slate-800">
                                  {row?.legalEntityId || "-"}
                                </div>
                                {row?.legalEntityCode || row?.legalEntityName ? (
                                  <div className="text-[10px] text-slate-500">
                                    {[row?.legalEntityCode, row?.legalEntityName]
                                      .filter(Boolean)
                                      .join(" - ")}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="font-mono text-slate-800">
                                  {row?.localAccountCode || "-"}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  #{row?.localAccountId || "-"}
                                  {row?.localAccountName
                                    ? ` - ${row.localAccountName}`
                                    : ""}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="font-mono text-slate-800">
                                  {groupAccount.code ||
                                    (groupAccount.id ? `#${groupAccount.id}` : "-")}
                                </div>
                                {groupAccount.id || groupAccountSourceLabel ? (
                                  <div className="text-[10px] text-slate-500">
                                    {groupAccount.id ? `#${groupAccount.id}` : ""}
                                    {groupAccount.id && groupAccountSourceLabel
                                      ? " - "
                                      : ""}
                                    {groupAccountSourceLabel}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="font-mono text-slate-800">
                                  {row?.expectedCanonicalKey || "-"}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div>{row?.reason || "-"}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {row?.semanticRisk?.highRisk === true && (
                                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                      HIGH_RISK
                                    </span>
                                  )}
                                  {(row?.semanticWarnings || []).map((warning, index) => (
                                    <span
                                      key={`${warning?.code || "warn"}-${index}`}
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        String(warning?.severity || "").toUpperCase() ===
                                        "HIGH"
                                          ? "bg-rose-100 text-rose-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {warning?.code || "SEMANTIC_WARNING"}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3">
              <div className="mb-2">
                <div className="text-sm font-semibold text-cyan-900">
                  {l("Bulk Canonical Mapping", "Toplu Canonical Esleme")}
                </div>
                <div className="mt-1 text-[11px] text-cyan-900/80">
                  {l(
                    "Select a parent/root account only as the selection root. The system previews and applies mappings on posting child leaf accounts, and many local leaves can converge into one group target.",
                    "Parent/root hesap yalnizca secim koku olarak kullanilir. Sistem onizleme ve uygulamayi posting child leaf hesaplar uzerinde yapar; cok sayida lokal leaf ayni grup hedefine baglanabilir."
                  )}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-6">
                <Combobox
                  value={canonicalRuleForm.legalEntityId || null}
                  options={legalEntitySelectOptions}
                  onChange={(nextValue) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      legalEntityId: nextValue ? String(nextValue) : "",
                      parentLocalAccountId: "",
                    }))
                  }
                  className="md:col-span-2"
                  placeholder={l("Select legal entity", "Istirak / bagli ortak secin")}
                  noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
                  clearable={false}
                />
                <Combobox
                  value={canonicalRuleForm.ruleType || null}
                  options={canonicalRuleTypeSelectOptions}
                  onChange={(nextValue) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      ruleType: nextValue ? String(nextValue) : "DESCENDANTS_OF_ACCOUNT",
                      parentLocalAccountId: "",
                      codePrefix: "",
                    }))
                  }
                  className="md:col-span-2"
                  placeholder={l("Rule type", "Kural tipi")}
                  noOptionsText={l("No rule types found.", "Kural tipi bulunamadi.")}
                  clearable={false}
                />
                <Combobox
                  value={canonicalRuleForm.groupAccountId || null}
                  options={canonicalGroupAccountSelectOptions}
                  onChange={(nextValue) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      groupAccountId: nextValue ? String(nextValue) : "",
                    }))
                  }
                  className="md:col-span-2"
                  placeholder={l(
                    "Select group account (optional)",
                    "Grup hesap secin (opsiyonel)"
                  )}
                  noOptionsText={l("No group accounts found.", "Grup hesap bulunamadi.")}
                />

                {String(canonicalRuleForm.ruleType || "").toUpperCase() ===
                "DESCENDANTS_OF_ACCOUNT" ? (
                  <Combobox
                    value={canonicalRuleForm.parentLocalAccountId || null}
                    options={canonicalRuleRootAccountOptions}
                    onChange={(nextValue) =>
                      setCanonicalRuleForm((prev) => ({
                        ...prev,
                        parentLocalAccountId: nextValue ? String(nextValue) : "",
                      }))
                    }
                    className="md:col-span-3"
                    placeholder={l(
                      "Select parent/root local account",
                      "Parent/root lokal hesap secin"
                    )}
                    noOptionsText={l(
                      "No local root accounts found.",
                      "Lokal kok hesap bulunamadi."
                    )}
                    clearable={false}
                  />
                ) : (
                  <input
                    value={canonicalRuleForm.codePrefix}
                    onChange={(event) =>
                      setCanonicalRuleForm((prev) => ({
                        ...prev,
                        codePrefix: event.target.value.toUpperCase(),
                      }))
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                    placeholder={l(
                      "Local account code prefix",
                      "Lokal hesap kodu on eki"
                    )}
                  />
                )}
                <input
                  value={canonicalRuleForm.canonicalKey}
                  onChange={(event) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      canonicalKey: event.target.value.toUpperCase(),
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={l("Canonical key", "Canonical anahtar")}
                  required
                />
                <input
                  value={canonicalRuleForm.canonicalName}
                  onChange={(event) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      canonicalName: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder={l("Canonical name (optional)", "Canonical ad (opsiyonel)")}
                />
                <input
                  type="date"
                  value={canonicalRuleForm.effectiveFrom}
                  onChange={(event) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      effectiveFrom: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={canonicalRuleForm.effectiveTo}
                  onChange={(event) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      effectiveTo: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  value={canonicalRuleForm.reason}
                  onChange={(event) =>
                    setCanonicalRuleForm((prev) => ({
                      ...prev,
                      reason: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                  placeholder={l(
                    "Reason/note (required when high-risk rows or remaps are applied)",
                    "Neden/not (yuksek-risk satirlar veya remap uygulanirken zorunlu)"
                  )}
                />
                <button
                  type="button"
                  onClick={onPreviewCanonicalRule}
                  disabled={
                    saving === "canonical-rule-save" ||
                    saving === "canonical-rule-preview" ||
                    saving === "canonical-rule-apply"
                  }
                  className="rounded-lg border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-900 disabled:opacity-60"
                >
                  {saving === "canonical-rule-preview"
                    ? l("Previewing...", "Onizleniyor...")
                    : l("Preview bulk rule", "Toplu kurali onizle")}
                </button>
                <button
                  type="button"
                  onClick={onApplyCanonicalRule}
                  disabled={
                    saving === "canonical-rule-save" ||
                    saving === "canonical-rule-preview" ||
                    saving === "canonical-rule-apply"
                  }
                  className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving === "canonical-rule-apply"
                    ? l("Applying...", "Uygulaniyor...")
                    : l("Apply bulk rule", "Toplu kurali uygula")}
                </button>
                <button
                  type="button"
                  onClick={onSaveCanonicalRuleDefinition}
                  disabled={
                    saving === "canonical-rule-save" ||
                    saving === "canonical-rule-preview" ||
                    saving === "canonical-rule-apply"
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  {saving === "canonical-rule-save"
                    ? l("Saving rule...", "Kural kaydediliyor...")
                    : l("Save rule", "Kurali kaydet")}
                </button>
              </div>

              {canonicalRulePreview && (
                <div className="mt-3 rounded-lg border border-cyan-200 bg-white p-3 text-xs text-slate-700">
                  {canonicalRulePreview?.savedRule && (
                    <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                      {l("Saved rule", "Kayitli kural")} #
                      {canonicalRulePreview.savedRule.id} |{" "}
                      {canonicalRulePreview.savedRule.ruleType} |{" "}
                      {canonicalRulePreview.savedRule.canonicalKey}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      {l("Bulk summary", "Toplu ozet")}:
                    </span>
                    <span>
                      {l("total", "toplam")}{" "}
                      {Number(canonicalRulePreview?.summary?.total || 0)}
                    </span>
                    <span>
                      READY_TO_APPLY{" "}
                      {Number(canonicalRulePreview?.summary?.readyToApplyCount || 0)}
                    </span>
                    <span>
                      ALREADY_ALIGNED{" "}
                      {Number(canonicalRulePreview?.summary?.alreadyAlignedCount || 0)}
                    </span>
                    <span>
                      CONFLICTS{" "}
                      {Number(canonicalRulePreview?.summary?.conflictCount || 0)}
                    </span>
                    <span>
                      {l("semantic warned", "semantic uyarili")}{" "}
                      {Number(canonicalRulePreview?.summary?.semanticWarningCount || 0)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${bulkPreviewBadgeClass(
                        canonicalRulePreview?.groupMappingPreview?.status
                      )}`}
                    >
                      {canonicalRulePreview?.groupMappingPreview?.status || "GROUP_STATE"}
                    </span>
                    <span>{canonicalRulePreview?.groupMappingPreview?.reason || "-"}</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-600">
                    {canonicalRulePreview?.context?.selectedRootAccount ? (
                      <span>
                        {l("Selection root", "Secim koku")}:{" "}
                        {canonicalRulePreview.context.selectedRootAccount.accountCode} -{" "}
                        {canonicalRulePreview.context.selectedRootAccount.accountName} |{" "}
                        {l("descendants", "descendant")}{" "}
                        {Number(
                          canonicalRulePreview?.context?.descendantAccountCount || 0
                        )}{" "}
                        | {l("leaf targets", "leaf hedef")}{" "}
                        {Number(
                          canonicalRulePreview?.context?.descendantLeafCount || 0
                        )}
                      </span>
                    ) : canonicalRulePreview?.context?.codePrefix ? (
                      <span>
                        {l("Code prefix", "Kod on eki")}:{" "}
                        {canonicalRulePreview.context.codePrefix}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {[
                      {
                        key: "matched",
                        title: l("Ready To Apply", "Uygulamaya Hazir"),
                        rows: canonicalRulePreview?.buckets?.matched || [],
                      },
                      {
                        key: "alreadyAligned",
                        title: l("Already Aligned", "Zaten Hizali"),
                        rows: canonicalRulePreview?.buckets?.alreadyAligned || [],
                      },
                      {
                        key: "conflicts",
                        title: l("Conflicts", "Cakismalar"),
                        rows: canonicalRulePreview?.buckets?.conflicts || [],
                      },
                    ].map((bucket) => (
                      <div
                        key={bucket.key}
                        className="rounded-lg border border-slate-200 p-2"
                      >
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {bucket.title} ({bucket.rows.length})
                        </div>
                        <div className="max-h-44 space-y-2 overflow-auto">
                          {bucket.rows.length === 0 ? (
                            <div className="text-slate-400">
                              {l("No rows", "Satir yok")}
                            </div>
                          ) : (
                            bucket.rows.map((row) => (
                              <div
                                key={`${bucket.key}-${row?.localAccountId || "na"}`}
                                className="rounded border border-slate-100 p-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${bulkPreviewBadgeClass(
                                      row?.classification
                                    )}`}
                                  >
                                    {row?.classification || "ROW"}
                                  </span>
                                  <span className="font-medium text-slate-800">
                                    {row?.localAccountCode || "-"} -{" "}
                                    {row?.localAccountName || "-"}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-600">
                                  {row?.reason || "-"}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {(row?.semanticWarnings || []).map((warning, index) => (
                                    <span
                                      key={`${warning?.code || "warn"}-${index}`}
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        String(warning?.severity || "").toUpperCase() === "HIGH"
                                          ? "bg-rose-100 text-rose-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {warning?.code || "SEMANTIC_WARNING"}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                <div className="mb-2 text-sm font-semibold text-slate-800">
                  {l("Saved bulk rules", "Kayitli toplu kurallar")}
                </div>
                <div className="mb-2 text-[11px] text-slate-500">
                  {l(
                    "Saved rules stay out of execute-time resolution. They are reusable authoring shortcuts that rerun the same explicit preview/apply flow later.",
                    "Kayitli kurallar execute-time cozumlemeye girmez. Bunlar ayni explicit preview/apply akisinin daha sonra yeniden kullanilabilen authoring kisayollaridir."
                  )}
                </div>
                {canonicalSavedRules.length === 0 ? (
                  <div className="text-slate-400">
                    {l("No saved rules yet.", "Henuz kayitli kural yok.")}
                  </div>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-auto">
                    {canonicalSavedRules.map((rule) => {
                      const ruleId = toPositiveInt(rule?.id);
                      const previewSavingKey = `canonical-rule-saved-preview-${ruleId}`;
                      const applySavingKey = `canonical-rule-saved-apply-${ruleId}`;
                      const deactivateSavingKey = `canonical-rule-saved-deactivate-${ruleId}`;
                      return (
                        <div
                          key={`saved-rule-${ruleId || "na"}`}
                          className="rounded border border-slate-200 p-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800">
                                #{rule?.id || "-"} | {rule?.ruleType || "-"} |{" "}
                                {rule?.canonicalKey || "-"}
                              </div>
                              <div className="text-slate-600">
                                LE {rule?.legalEntityCode || rule?.legalEntityId || "-"} |{" "}
                                {rule?.parentLocalAccountCode
                                  ? `ROOT ${rule.parentLocalAccountCode}`
                                  : `PREFIX ${rule?.codePrefix || "-"}`}{" "}
                                | G:{rule?.groupAccountCode || "-"} | {rule?.status || "-"}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {l("Effective", "Effective")} {rule?.effectiveFrom || "-"} /{" "}
                                {rule?.effectiveTo || "-"} |{" "}
                                {l("Reason", "Neden")} {rule?.reason || "-"}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onReuseSavedCanonicalRule(rule)}
                                className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                {l("Reuse", "Yeniden kullan")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onPreviewSavedCanonicalRule(rule)}
                                disabled={saving === previewSavingKey}
                                className="rounded border border-cyan-300 px-2 py-1 text-[11px] font-semibold text-cyan-900 disabled:opacity-60"
                              >
                                {saving === previewSavingKey
                                  ? l("Previewing...", "Onizleniyor...")
                                  : l("Preview", "Onizle")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onApplySavedCanonicalRule(rule)}
                                disabled={
                                  saving === applySavingKey ||
                                  String(rule?.status || "").toUpperCase() !== "ACTIVE"
                                }
                                className="rounded bg-cyan-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                              >
                                {saving === applySavingKey
                                  ? l("Applying...", "Uygulaniyor...")
                                  : l("Apply", "Uygula")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeactivateSavedCanonicalRule(rule)}
                                disabled={
                                  saving === deactivateSavingKey ||
                                  String(rule?.status || "").toUpperCase() !== "ACTIVE"
                                }
                                className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                              >
                                {saving === deactivateSavingKey
                                  ? l("Deactivating...", "Deaktive ediliyor...")
                                  : l("Deactivate", "Deaktive et")}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="mb-2 text-[11px] text-amber-700">
              {l(
                "Date safety: if unresolved runs exist, set mapping effectiveFrom on/before run period end.",
                "Tarih guvenligi: cozumlenmemis run varsa mapping effectiveFrom tarihini run period end veya oncesi yapin."
              )}
            </div>

            <form
              onSubmit={onSaveCanonicalLocalMapping}
              className="grid gap-2 md:grid-cols-4"
            >
              {canonicalLocalEditTarget ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 md:col-span-4">
                  {l(
                    "Editing an existing local mapping. Legal entity and local account are locked because they define the mapping scope. To retire this row, set Status to INACTIVE and save.",
                    "Mevcut bir lokal esleme duzenleniyor. Istirak ve lokal hesap alanlari esleme kapsamini tanimladigi icin kilitlendi. Bu satiri devreden cikarmak icin Status alanini INACTIVE yapip kaydedin."
                  )}
                </div>
              ) : null}
              <Combobox
                value={canonicalLocalForm.legalEntityId || null}
                options={legalEntitySelectOptions}
                onChange={(nextValue) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    legalEntityId: nextValue ? String(nextValue) : "",
                    localAccountId: "",
                  }))
                }
                placeholder={l("Select legal entity", "Istirak / bagli ortak secin")}
                noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
                clearable={false}
                disabled={Boolean(canonicalLocalEditTarget)}
              />
              <Combobox
                id="canonical-local-account-options"
                value={canonicalLocalForm.localAccountId || null}
                options={canonicalLocalAccountSelectOptions}
                onChange={(nextValue) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    localAccountId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Select local account", "Lokal hesap secin")}
                noOptionsText={l("No local accounts found.", "Lokal hesap bulunamadi.")}
                clearable={false}
                disabled={Boolean(canonicalLocalEditTarget)}
              />
              <div className="text-[11px] text-slate-500 md:col-span-2">
                {l(
                  "Only local accounts without an active canonical local mapping are listed here. Use Edit below to update an existing mapping.",
                  "Burada yalnizca aktif canonical lokal eslemesi olmayan hesaplar listelenir. Mevcut eslemeyi guncellemek icin asagidaki Duzenle aksiyonunu kullanin."
                )}
              </div>
              <input
                value={canonicalLocalForm.canonicalKey}
                onChange={(event) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    canonicalKey: event.target.value.toUpperCase(),
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Canonical key", "Canonical anahtar")}
                required
              />
              <input
                value={canonicalLocalForm.canonicalName}
                onChange={(event) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    canonicalName: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Canonical name (optional)", "Canonical ad (opsiyonel)")}
              />
              <input
                value={canonicalLocalForm.reason}
                onChange={(event) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    reason: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={l(
                  "Reason/note (required for high-risk remap)",
                  "Neden/not (yuksek-risk remap icin zorunlu)"
                )}
              />
              <Combobox
                value={canonicalLocalForm.status || null}
                options={activeInactiveSelectOptions}
                onChange={(nextValue) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    status: nextValue ? String(nextValue) : "ACTIVE",
                  }))
                }
                clearable={false}
              />
              <input
                type="date"
                value={canonicalLocalForm.effectiveFrom}
                onChange={(event) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    effectiveFrom: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={canonicalLocalForm.effectiveTo}
                onChange={(event) =>
                  setCanonicalLocalForm((prev) => ({
                    ...prev,
                    effectiveTo: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={saving === "canonical-local"}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "canonical-local"
                  ? l("Saving local...", "Lokal kaydediliyor...")
                  : canonicalLocalEditTarget
                    ? l("Update Local Mapping", "Lokal Eslemeyi Guncelle")
                    : l("Save Local Mapping", "Lokal Eslemeyi Kaydet")}
              </button>
              {canonicalLocalEditTarget ? (
                <button
                  type="button"
                  onClick={onCancelCanonicalLocalEdit}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {l("Cancel Local Edit", "Lokal Duzenlemeyi Iptal Et")}
                </button>
              ) : null}
            </form>

            <form
              onSubmit={onSaveCanonicalGroupMapping}
              className="mt-2 grid gap-2 md:grid-cols-4"
            >
              {canonicalGroupEditTarget ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 md:col-span-4">
                  {l(
                    "Editing an existing group mapping. Canonical key is locked because it defines the mapping scope. To retire this row, set Status to INACTIVE and save.",
                    "Mevcut bir grup eslemesi duzenleniyor. Canonical anahtar esleme kapsamini tanimladigi icin kilitlendi. Bu satiri devreden cikarmak icin Status alanini INACTIVE yapip kaydedin."
                  )}
                </div>
              ) : null}
              <Combobox
                id="canonical-group-account-options"
                value={canonicalGroupForm.groupAccountId || null}
                options={canonicalGroupAccountSelectOptions}
                onChange={(nextValue) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    groupAccountId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Select group account", "Grup hesap secin")}
                noOptionsText={l("No group accounts found.", "Grup hesap bulunamadi.")}
                clearable={false}
              />
              <input
                value={canonicalGroupForm.canonicalKey}
                onChange={(event) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    canonicalKey: event.target.value.toUpperCase(),
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Canonical key", "Canonical anahtar")}
                required
                disabled={Boolean(canonicalGroupEditTarget)}
              />
              <input
                value={canonicalGroupForm.canonicalName}
                onChange={(event) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    canonicalName: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Canonical name (optional)", "Canonical ad (opsiyonel)")}
              />
              <input
                value={canonicalGroupForm.reason}
                onChange={(event) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    reason: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={l(
                  "Reason/note (required for high-risk remap)",
                  "Neden/not (yuksek-risk remap icin zorunlu)"
                )}
              />
              <Combobox
                value={canonicalGroupForm.status || null}
                options={activeInactiveSelectOptions}
                onChange={(nextValue) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    status: nextValue ? String(nextValue) : "ACTIVE",
                  }))
                }
                clearable={false}
              />
              <input
                type="date"
                value={canonicalGroupForm.effectiveFrom}
                onChange={(event) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    effectiveFrom: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={canonicalGroupForm.effectiveTo}
                onChange={(event) =>
                  setCanonicalGroupForm((prev) => ({
                    ...prev,
                    effectiveTo: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={saving === "canonical-group"}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "canonical-group"
                  ? l("Saving group...", "Grup kaydediliyor...")
                  : canonicalGroupEditTarget
                    ? l("Update Group Mapping", "Grup Eslemeyi Guncelle")
                    : l("Save Group Mapping", "Grup Eslemeyi Kaydet")}
              </button>
              {canonicalGroupEditTarget ? (
                <button
                  type="button"
                  onClick={onCancelCanonicalGroupEdit}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {l("Cancel Group Edit", "Grup Duzenlemeyi Iptal Et")}
                </button>
              ) : null}
            </form>

            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 text-xs">
              {canonicalMappings.length === 0 ? (
                <div className="text-slate-500">
                  {l("No canonical mappings", "Canonical esleme yok")}
                </div>
              ) : (
                canonicalMappings.map((row, index) => (
                  <div
                    key={`${row?.canonicalKeyId || "key"}-${row?.localMapping?.id || "local"}-${row?.groupMapping?.id || "group"}-${index}`}
                    className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">
                        {row?.canonicalKey || "-"}
                      </div>
                      <div className="text-slate-600">
                        LE {row?.localMapping?.legalEntityId || "-"} | L:
                        {row?.localMapping?.localAccountCode || "-"} | G:
                        {row?.groupMapping?.groupAccountCode || "-"} | L:
                        {row?.localMapping?.status || "-"} | G:
                        {row?.groupMapping?.status || "-"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {l("Local effective", "Lokal effective")}{" "}
                        {row?.localMapping?.effectiveFrom || "-"} /{" "}
                        {row?.localMapping?.effectiveTo || "-"} |{" "}
                        {l("Group effective", "Grup effective")}{" "}
                        {row?.groupMapping?.effectiveFrom || "-"} /{" "}
                        {row?.groupMapping?.effectiveTo || "-"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEditCanonicalMapping(row)}
                      className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                    >
                      {l("Edit", "Duzenle")}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Elimination Placeholders", "Eliminasyon Placeholderlari")}</h2>
            <form onSubmit={onSavePlaceholder} className="grid gap-2 md:grid-cols-5">
              <input
                value={placeholderForm.placeholderCode}
                onChange={(event) => setPlaceholderForm((prev) => ({ ...prev, placeholderCode: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Code", "Kod")}
                required
              />
              <input
                value={placeholderForm.name}
                onChange={(event) => setPlaceholderForm((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Name", "Ad")}
                required
              />
              <Combobox
                value={placeholderForm.accountId || null}
                options={accountSelectOptions}
                onChange={(nextValue) =>
                  setPlaceholderForm((prev) => ({
                    ...prev,
                    accountId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Account (optional)", "Hesap (opsiyonel)")}
                noOptionsText={l("No accounts found.", "Hesap bulunamadi.")}
              />
              <Combobox
                value={placeholderForm.defaultDirection || null}
                options={directionSelectOptions}
                onChange={(nextValue) =>
                  setPlaceholderForm((prev) => ({
                    ...prev,
                    defaultDirection: nextValue ? String(nextValue) : "AUTO",
                  }))
                }
                clearable={false}
              />
              <button type="submit" disabled={saving === "placeholder"} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving === "placeholder" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
              </button>
              <input
                value={placeholderForm.description}
                onChange={(event) => setPlaceholderForm((prev) => ({ ...prev, description: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-4"
                placeholder={l("Description", "Aciklama")}
              />
            </form>
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 text-xs">
              {placeholders.length === 0 ? (
                <div className="text-slate-500">{l("No placeholders", "Placeholder yok")}</div>
              ) : (
                placeholders.map((row) => (
                  <div key={row.id} className="border-b border-slate-100 py-1 last:border-0">
                    {row.placeholder_code} | {row.name} | ACC {row.account_id || "-"} | {row.default_direction} | {row.is_active ? "ACTIVE" : "INACTIVE"}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Runs", "Runlar")}</h2>
            <form onSubmit={onCreateRun} className="grid gap-2 md:grid-cols-4">
              <Combobox
                value={runForm.fiscalPeriodId || null}
                options={periodSelectOptions}
                onChange={(nextValue) =>
                  setRunForm((prev) => ({
                    ...prev,
                    fiscalPeriodId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("Select fiscal period", "Mali donem secin")}
                noOptionsText={l("No periods found.", "Donem bulunamadi.")}
                clearable={false}
              />
              <input
                value={runForm.runName}
                onChange={(event) => setRunForm((prev) => ({ ...prev, runName: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Run name", "Run adi")}
                required
              />
              <input
                value={runForm.presentationCurrencyCode}
                onChange={(event) => setRunForm((prev) => ({ ...prev, presentationCurrencyCode: event.target.value.toUpperCase() }))}
                maxLength={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Currency", "Para birimi")}
                required
              />
              <button type="submit" disabled={saving === "run-create"} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving === "run-create" ? l("Creating...", "Olusturuluyor...") : l("Create Run", "Run Olustur")}
              </button>
              <Combobox
                value={runForm.rateType || null}
                options={rateTypeSelectOptions}
                onChange={(nextValue) =>
                  setRunForm((prev) => ({
                    ...prev,
                    rateType: nextValue ? String(nextValue) : "CLOSING",
                  }))
                }
                className="md:col-span-2"
                clearable={false}
              />
            </form>
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 p-2 text-xs">
              {runs.length === 0 ? (
                <div className="text-slate-500">{l("No runs", "Run yok")}</div>
              ) : (
                runs.map((row) => {
                  const runIdKey = String(row.id);
                  const preflight = runPreflightById[runIdKey] || null;
                  const isPreflightLoading = Boolean(preflight?.isLoading);
                  const canonicalCoverageReady =
                    preflight?.canonicalCoverage === true;
                  const executeBlockedByPreflight = !canonicalCoverageReady;
                  const executeDisabled =
                    saving === `run-exec-${row.id}` ||
                    isLocked(row.status) ||
                    executeBlockedByPreflight;

                  let preflightToneClass = "text-slate-500";
                  let preflightText = l(
                    "Preflight not loaded yet. Refresh runs before Execute.",
                    "Preflight henuz yuklenmedi. Execute oncesi runlari yenileyin."
                  );
                  if (isPreflightLoading) {
                    preflightToneClass = "text-slate-500";
                    preflightText = l(
                      "Checking canonical mapping coverage...",
                      "Canonical mapping coverage kontrol ediliyor..."
                    );
                  } else if (preflight?.error) {
                    preflightToneClass = "text-amber-700";
                    preflightText = l(
                      "Preflight could not be loaded. Execute is blocked until compatibility is available.",
                      "Preflight yuklenemedi. Uyumluluk verisi gelene kadar Execute engellendi."
                    );
                  } else if (canonicalCoverageReady) {
                    preflightToneClass = "text-emerald-700";
                    preflightText = l(
                      "Canonical mapping coverage: ready.",
                      "Canonical mapping coverage: hazir."
                    );
                  } else {
                    const missingCount = Number(preflight?.missingCount || 0);
                    preflightToneClass = "text-amber-700";
                    preflightText =
                      missingCount > 0
                        ? l(
                            `Execute blocked: canonical mapping coverage missing (${missingCount} account(s)). Complete canonical mappings and refresh.`,
                            `Execute engellendi: canonical mapping coverage eksik (${missingCount} hesap). Canonical eslemeleri tamamlayip yenileyin.`
                          )
                        : l(
                            "Execute blocked: canonical mapping coverage is not ready. Complete mappings and refresh.",
                            "Execute engellendi: canonical mapping coverage hazir degil. Eslemeleri tamamlayip yenileyin."
                          );
                  }

                  return (
                    <div
                      key={row.id}
                      className="border-b border-slate-100 py-1 last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          #{row.id} | {row.run_name} | {row.fiscal_year}-P
                          {padPeriod(row.period_no)} | {row.status}
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => onExecuteRun(row.id)}
                            disabled={executeDisabled}
                            className="rounded bg-cyan-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            {saving === `run-exec-${row.id}`
                              ? l("Running...", "Calisiyor...")
                              : l("Execute", "Execute")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onFinalizeRun(row.id)}
                            disabled={
                              saving === `run-final-${row.id}` || isLocked(row.status)
                            }
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {saving === `run-final-${row.id}`
                              ? l("Finalizing...", "Final ediliyor...")
                              : l("Finalize", "Finalize")}
                          </button>
                        </div>
                      </div>
                      <div className={`mt-1 text-[11px] ${preflightToneClass}`}>
                        {preflightText}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

