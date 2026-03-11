import { useEffect, useMemo, useState } from "react";
import {
  applyConsolidationCanonicalMappingCandidates,
  createConsolidationRun,
  executeConsolidationRun,
  finalizeConsolidationRun,
  getConsolidationCanonicalReadiness,
  getConsolidationRun,
  listConsolidationCanonicalMappings,
  previewConsolidationCanonicalMappingCandidates,
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
  const l = (en, tr) => (isTr ? tr : en);

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
  const [canonicalCandidateReason, setCanonicalCandidateReason] = useState("");
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
  const [canonicalLocalForm, setCanonicalLocalForm] = useState({
    legalEntityId: "",
    localAccountId: "",
    canonicalKey: "",
    canonicalName: "",
    reason: "",
    status: "ACTIVE",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  });
  const [canonicalGroupForm, setCanonicalGroupForm] = useState({
    groupAccountId: "",
    canonicalKey: "",
    canonicalName: "",
    reason: "",
    status: "ACTIVE",
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

  const canonicalLocalAccountOptions = useMemo(() => {
    const legalEntityId = toPositiveInt(canonicalLocalForm.legalEntityId);
    return accounts.filter((row) => {
      const coaId = toPositiveInt(row?.coa_id);
      const coa = coaById.get(coaId);
      const accountLegalEntityId =
        toPositiveInt(row?.legal_entity_id) || toPositiveInt(coa?.legal_entity_id);
      if (!legalEntityId) {
        return String(coa?.scope || "").toUpperCase() === "LEGAL_ENTITY";
      }
      return accountLegalEntityId === legalEntityId;
    });
  }, [accounts, coaById, canonicalLocalForm.legalEntityId]);

  const canonicalGroupAccountOptions = useMemo(
    () =>
      accounts.filter((row) => {
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
      setCanonicalReadiness({ isLoading: false, error: "", snapshot: null });
      setPlaceholders([]);
      setRuns([]);
      setRunPreflightById({});
      return;
    }
    setCanonicalCandidateReason("");
    if (!canReadRuns) {
      setRuns([]);
      setRunPreflightById({});
    }
    if (!canReadMappings) {
      setMappings([]);
      setCanonicalMappings([]);
      setCanonicalCandidatePreview(null);
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
    if (!groupId || !groupAccountId || !canonicalKey) {
      setError(
        l(
          "Group, groupAccountId and canonicalKey are required.",
          "Grup, groupAccountId ve canonicalKey zorunludur."
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
                <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 p-2">
                  {(canonicalCandidatePreview?.rows || []).length === 0 ? (
                    <div className="text-slate-500">
                      {l("No candidate rows", "Aday satiri yok")}
                    </div>
                  ) : (
                    (canonicalCandidatePreview?.rows || []).map((row) => (
                      <div
                        key={`${row?.legalEntityId || "le"}-${row?.localAccountId || "acc"}-${row?.expectedCanonicalKey || "key"}`}
                        className="border-b border-slate-100 py-1 last:border-0"
                      >
                        [{row?.classification || "-"}] LE {row?.legalEntityId || "-"} |{" "}
                        L:{row?.localAccountCode || "-"} ({row?.localAccountId || "-"}) | G:
                        {row?.resolvedGroupAccountId || "-"} | K:
                        {row?.expectedCanonicalKey || "-"} | {row?.reason || "-"}
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
            )}

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
              />
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
                  : l("Save Local Mapping", "Lokal Eslemeyi Kaydet")}
              </button>
            </form>

            <form
              onSubmit={onSaveCanonicalGroupMapping}
              className="mt-2 grid gap-2 md:grid-cols-4"
            >
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
                  : l("Save Group Mapping", "Grup Eslemeyi Kaydet")}
              </button>
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
                    className="border-b border-slate-100 py-1 last:border-0"
                  >
                    {row?.canonicalKey || "-"} | LE {row?.localMapping?.legalEntityId || "-"} | L:{row?.localMapping?.localAccountCode || "-"} | G:{row?.groupMapping?.groupAccountCode || "-"} | L:{row?.localMapping?.status || "-"} | G:{row?.groupMapping?.status || "-"}
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

