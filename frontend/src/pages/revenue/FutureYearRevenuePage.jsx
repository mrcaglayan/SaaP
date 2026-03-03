import { useEffect, useMemo, useState } from "react";
import {
  createRevenueRecognitionRun,
  generateRevenueRecognitionSchedule,
  getRevenueAccrualSplitReport,
  getRevenueDeferredRevenueSplitReport,
  getRevenueFutureYearRollforwardReport,
  getRevenuePostingMappingSetup,
  getRevenuePrepaidExpenseSplitReport,
  listRevenueLookupFiscalPeriods,
  listRevenueLookupLegalEntities,
  listRevenueRecognitionRuns,
  listRevenueRecognitionSchedules,
  postRevenueRecognitionRun,
  reverseRevenueRecognitionRun,
} from "../../api/revenueRecognition.js";
import { useAuth } from "../../auth/useAuth.js";
import { resolveRevenueFetchGates } from "./revenueFetchGating.js";
import {
  REVENUE_ACCOUNT_FAMILIES,
  REVENUE_RUN_STATUSES,
  REVENUE_SCHEDULE_STATUSES,
  buildRevenueListQuery,
  buildRevenueReportQuery,
  buildRevenueRunActionPayload,
  createInitialReportFilters,
  createInitialRunActionForm,
  createInitialRunForm,
  createInitialScheduleForm,
  estimateReclassToShortTerm,
  familyLabel,
  formatAmount,
  validateRevenueRunForm,
  validateRevenueScheduleForm,
} from "./revenueRecognitionUtils.js";

const DEFAULT_QUERY = {
  legalEntityId: "",
  fiscalPeriodId: "",
  accountFamily: "",
  status: "",
  q: "",
  limit: 100,
  offset: 0,
};

function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.message || error?.response?.data?.message || fallback).trim();
  const requestId = String(error?.requestId || error?.response?.data?.requestId || "").trim();
  return requestId ? `${message || fallback} (requestId: ${requestId})` : message || fallback;
}

function findAccrualFamilyRow(report, family) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.find((row) => String(row?.accountFamily || "").toUpperCase() === family) || null;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildLegalEntityLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(row?.id || "");
}

function buildFiscalPeriodLabel(row) {
  const fiscalYear = Number(row?.fiscalYear || 0);
  const periodNo = Number(row?.periodNo || 0);
  const periodName = String(row?.periodName || "").trim();
  const periodCode =
    fiscalYear > 0 && periodNo > 0 ? `${fiscalYear}-P${String(periodNo).padStart(2, "0")}` : "";
  const dateWindow =
    row?.startDate && row?.endDate ? `${row.startDate}..${row.endDate}` : row?.startDate || row?.endDate || "";
  return [periodCode, periodName, dateWindow].filter(Boolean).join(" | ") || String(row?.id || "");
}

function buildPostingSetupKey(legalEntityId, accountFamily) {
  const parsedLegalEntityId = toPositiveInt(legalEntityId);
  const normalizedFamily = toUpper(accountFamily);
  if (!parsedLegalEntityId || !normalizedFamily) {
    return "";
  }
  return `${parsedLegalEntityId}:${normalizedFamily}`;
}

function collectMissingPurposeCodes(setupStatus) {
  const codes = new Set();
  for (const familyRow of setupStatus?.families || []) {
    for (const code of familyRow?.missingPurposeCodes || []) {
      if (code) {
        codes.add(String(code));
      }
    }
  }
  return Array.from(codes.values());
}

function buildPostingSetupErrorMessage(setupStatus) {
  if (!setupStatus || setupStatus.ready) {
    return "";
  }
  const missingCodes = collectMissingPurposeCodes(setupStatus);
  if (missingCodes.length === 0) {
    return "Setup required: posting mappings are incomplete.";
  }
  return `Setup required: missing or invalid purpose mappings (${missingCodes.join(", ")}).`;
}

export default function FutureYearRevenuePage() {
  const { permissions } = useAuth();
  const gates = useMemo(() => resolveRevenueFetchGates(permissions), [permissions]);

  const [scheduleQuery, setScheduleQuery] = useState(DEFAULT_QUERY);
  const [runQuery, setRunQuery] = useState(DEFAULT_QUERY);

  const [scheduleRows, setScheduleRows] = useState([]);
  const [scheduleTotal, setScheduleTotal] = useState(0);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const [runRows, setRunRows] = useState([]);
  const [runTotal, setRunTotal] = useState(0);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");

  const [scheduleForm, setScheduleForm] = useState(() => createInitialScheduleForm());
  const [runForm, setRunForm] = useState(() => createInitialRunForm());
  const [runActionForm, setRunActionForm] = useState(() => createInitialRunActionForm());

  const [saveLoading, setSaveLoading] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const [selectedRunId, setSelectedRunId] = useState(null);
  const [reportFilters, setReportFilters] = useState(() => createInitialReportFilters());

  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportsMessage, setReportsMessage] = useState("");

  const [rollforwardReport, setRollforwardReport] = useState(null);
  const [deferredSplitReport, setDeferredSplitReport] = useState(null);
  const [accrualSplitReport, setAccrualSplitReport] = useState(null);
  const [prepaidSplitReport, setPrepaidSplitReport] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [legalEntityOptions, setLegalEntityOptions] = useState([]);
  const [fiscalPeriodsByLegalEntityId, setFiscalPeriodsByLegalEntityId] = useState({});
  const [periodLookupLoadingByEntityId, setPeriodLookupLoadingByEntityId] = useState({});
  const [postingSetupByKey, setPostingSetupByKey] = useState({});
  const [postingSetupLoadingByKey, setPostingSetupLoadingByKey] = useState({});
  const [postingSetupErrorByKey, setPostingSetupErrorByKey] = useState({});

  const selectedRun = useMemo(
    () => runRows.find((row) => Number(row?.id || 0) === Number(selectedRunId || 0)) || null,
    [runRows, selectedRunId]
  );

  const canPostSelectedRun =
    gates.canPostRun && ["DRAFT", "READY"].includes(String(selectedRun?.status || "").toUpperCase());
  const canReverseSelectedRun =
    gates.canReverseRun && String(selectedRun?.status || "").toUpperCase() === "POSTED";

  const deferredSummary = deferredSplitReport?.summary || {};
  const prepaidSummary = prepaidSplitReport?.summary || {};
  const rollforwardSummary = rollforwardReport?.summary || {};
  const accrRevRow = findAccrualFamilyRow(accrualSplitReport, "ACCRUED_REVENUE");
  const accrExpRow = findAccrualFamilyRow(accrualSplitReport, "ACCRUED_EXPENSE");

  const selectedEntityIds = useMemo(() => {
    const set = new Set();
    for (const value of [
      scheduleQuery.legalEntityId,
      runQuery.legalEntityId,
      scheduleForm.legalEntityId,
      runForm.legalEntityId,
      reportFilters.legalEntityId,
      selectedRun?.legalEntityId,
    ]) {
      const parsed = toPositiveInt(value);
      if (parsed) {
        set.add(parsed);
      }
    }
    return Array.from(set.values());
  }, [
    scheduleQuery.legalEntityId,
    runQuery.legalEntityId,
    scheduleForm.legalEntityId,
    runForm.legalEntityId,
    reportFilters.legalEntityId,
    selectedRun?.legalEntityId,
  ]);

  const scheduleSetupKey = buildPostingSetupKey(
    scheduleForm.legalEntityId,
    scheduleForm.accountFamily
  );
  const runSetupKey = buildPostingSetupKey(runForm.legalEntityId, runForm.accountFamily);
  const scheduleSetupStatus = scheduleSetupKey ? postingSetupByKey[scheduleSetupKey] : null;
  const runSetupStatus = runSetupKey ? postingSetupByKey[runSetupKey] : null;
  const scheduleSetupLoading = Boolean(
    scheduleSetupKey && postingSetupLoadingByKey[scheduleSetupKey]
  );
  const runSetupLoading = Boolean(runSetupKey && postingSetupLoadingByKey[runSetupKey]);
  const scheduleSetupError = scheduleSetupKey ? postingSetupErrorByKey[scheduleSetupKey] || "" : "";
  const runSetupError = runSetupKey ? postingSetupErrorByKey[runSetupKey] || "" : "";

  async function loadSchedules(nextQuery = scheduleQuery) {
    if (!gates.shouldFetchSchedules) {
      setScheduleRows([]);
      setScheduleTotal(0);
      return;
    }
    setScheduleLoading(true);
    setScheduleError("");
    try {
      const response = await listRevenueRecognitionSchedules(buildRevenueListQuery(nextQuery));
      setScheduleRows(Array.isArray(response?.rows) ? response.rows : []);
      setScheduleTotal(Number(response?.total || 0));
    } catch (error) {
      setScheduleRows([]);
      setScheduleTotal(0);
      setScheduleError(normalizeApiError(error, "Failed to load schedules."));
    } finally {
      setScheduleLoading(false);
    }
  }

  async function loadRuns(nextQuery = runQuery) {
    if (!gates.shouldFetchRuns) {
      setRunRows([]);
      setRunTotal(0);
      return;
    }
    setRunLoading(true);
    setRunError("");
    try {
      const response = await listRevenueRecognitionRuns(buildRevenueListQuery(nextQuery));
      setRunRows(Array.isArray(response?.rows) ? response.rows : []);
      setRunTotal(Number(response?.total || 0));
    } catch (error) {
      setRunRows([]);
      setRunTotal(0);
      setRunError(normalizeApiError(error, "Failed to load runs."));
    } finally {
      setRunLoading(false);
    }
  }

  function getFiscalPeriodOptions(legalEntityId) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId) {
      return [];
    }
    return fiscalPeriodsByLegalEntityId[String(parsedLegalEntityId)] || [];
  }

  function isFiscalPeriodLookupLoading(legalEntityId) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId) {
      return false;
    }
    return Boolean(periodLookupLoadingByEntityId[String(parsedLegalEntityId)]);
  }

  async function ensureFiscalPeriods(legalEntityId) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId) {
      return [];
    }

    const mapKey = String(parsedLegalEntityId);
    const existing = fiscalPeriodsByLegalEntityId[mapKey];
    if (Array.isArray(existing)) {
      return existing;
    }
    if (periodLookupLoadingByEntityId[mapKey]) {
      return [];
    }

    setPeriodLookupLoadingByEntityId((prev) => ({ ...prev, [mapKey]: true }));
    try {
      const response = await listRevenueLookupFiscalPeriods({
        legalEntityId: parsedLegalEntityId,
        limit: 500,
        offset: 0,
      });
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      setFiscalPeriodsByLegalEntityId((prev) => ({ ...prev, [mapKey]: rows }));
      return rows;
    } catch (error) {
      setLookupError(normalizeApiError(error, "Failed to load fiscal period lookup."));
      setFiscalPeriodsByLegalEntityId((prev) => ({ ...prev, [mapKey]: [] }));
      return [];
    } finally {
      setPeriodLookupLoadingByEntityId((prev) => ({ ...prev, [mapKey]: false }));
    }
  }

  async function ensurePostingSetup(legalEntityId, accountFamily, forceReload = false) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    const normalizedFamily = toUpper(accountFamily);
    if (!parsedLegalEntityId || !REVENUE_ACCOUNT_FAMILIES.includes(normalizedFamily)) {
      return null;
    }

    const key = buildPostingSetupKey(parsedLegalEntityId, normalizedFamily);
    if (!key) {
      return null;
    }
    if (!forceReload && postingSetupByKey[key]) {
      return postingSetupByKey[key];
    }
    if (postingSetupLoadingByKey[key]) {
      return postingSetupByKey[key] || null;
    }

    setPostingSetupLoadingByKey((prev) => ({ ...prev, [key]: true }));
    setPostingSetupErrorByKey((prev) => ({ ...prev, [key]: "" }));
    try {
      const response = await getRevenuePostingMappingSetup({
        legalEntityId: parsedLegalEntityId,
        accountFamily: normalizedFamily,
      });
      setPostingSetupByKey((prev) => ({ ...prev, [key]: response || null }));
      return response || null;
    } catch (error) {
      const message = normalizeApiError(error, "Failed to check posting setup.");
      setPostingSetupErrorByKey((prev) => ({ ...prev, [key]: message }));
      return null;
    } finally {
      setPostingSetupLoadingByKey((prev) => ({ ...prev, [key]: false }));
    }
  }

  useEffect(() => {
    if (!gates.shouldFetchSchedules) {
      setScheduleRows([]);
      setScheduleTotal(0);
      return;
    }
    loadSchedules(DEFAULT_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gates.shouldFetchSchedules]);

  useEffect(() => {
    if (!gates.shouldFetchRuns) {
      setRunRows([]);
      setRunTotal(0);
      return;
    }
    loadRuns(DEFAULT_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gates.shouldFetchRuns]);

  useEffect(() => {
    let active = true;
    async function loadLegalEntityLookups() {
      setLookupLoading(true);
      setLookupError("");
      try {
        const response = await listRevenueLookupLegalEntities({
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setLegalEntityOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setLegalEntityOptions([]);
        setLookupError(normalizeApiError(error, "Failed to load legal entity lookup."));
      } finally {
        if (active) {
          setLookupLoading(false);
        }
      }
    }

    if (
      gates.canReadSchedules ||
      gates.canReadRuns ||
      gates.canReadReports ||
      gates.canGenerateSchedule ||
      gates.canCreateRun
    ) {
      void loadLegalEntityLookups();
    }

    return () => {
      active = false;
    };
  }, [
    gates.canReadSchedules,
    gates.canReadRuns,
    gates.canReadReports,
    gates.canGenerateSchedule,
    gates.canCreateRun,
  ]);

  useEffect(() => {
    for (const legalEntityId of selectedEntityIds) {
      const key = String(legalEntityId);
      if (Array.isArray(fiscalPeriodsByLegalEntityId[key])) {
        continue;
      }
      if (periodLookupLoadingByEntityId[key]) {
        continue;
      }
      void ensureFiscalPeriods(legalEntityId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityIds, fiscalPeriodsByLegalEntityId, periodLookupLoadingByEntityId]);

  useEffect(() => {
    void ensurePostingSetup(scheduleForm.legalEntityId, scheduleForm.accountFamily, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleForm.legalEntityId, scheduleForm.accountFamily]);

  useEffect(() => {
    void ensurePostingSetup(runForm.legalEntityId, runForm.accountFamily, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runForm.legalEntityId, runForm.accountFamily]);

  async function handleGenerateSchedule(event) {
    event.preventDefault();
    if (!gates.canGenerateSchedule) {
      setSaveError("Missing permission: revenue.schedule.generate");
      return;
    }

    setSaveLoading("generateSchedule");
    setSaveError("");
    setSaveMessage("");
    try {
      const { payload, errors } = validateRevenueScheduleForm(scheduleForm);
      if (errors.length > 0) {
        setSaveError(errors.join(" "));
        return;
      }
      const setupStatus = await ensurePostingSetup(
        payload.legalEntityId,
        payload.accountFamily,
        true
      );
      if (!setupStatus) {
        setSaveError("Could not verify posting mappings. Please retry.");
        return;
      }
      const setupErrorText = buildPostingSetupErrorMessage(setupStatus);
      if (setupErrorText) {
        setSaveError(setupErrorText);
        return;
      }
      const response = await generateRevenueRecognitionSchedule(payload);
      setSaveMessage(`Schedule generated. id=${response?.row?.id || "-"}`);
      if (gates.shouldFetchSchedules) {
        await loadSchedules(scheduleQuery);
      }
    } catch (error) {
      setSaveError(normalizeApiError(error, "Failed to generate schedule."));
    } finally {
      setSaveLoading("");
    }
  }

  async function handleCreateRun(event) {
    event.preventDefault();
    if (!gates.canCreateRun) {
      setSaveError("Missing permission: revenue.run.create");
      return;
    }

    setSaveLoading("createRun");
    setSaveError("");
    setSaveMessage("");
    try {
      const { payload, errors } = validateRevenueRunForm(runForm);
      if (errors.length > 0) {
        setSaveError(errors.join(" "));
        return;
      }
      const setupStatus = await ensurePostingSetup(
        payload.legalEntityId,
        payload.accountFamily,
        true
      );
      if (!setupStatus) {
        setSaveError("Could not verify posting mappings. Please retry.");
        return;
      }
      const setupErrorText = buildPostingSetupErrorMessage(setupStatus);
      if (setupErrorText) {
        setSaveError(setupErrorText);
        return;
      }
      const response = await createRevenueRecognitionRun(payload);
      setSaveMessage(`Run created. id=${response?.row?.id || "-"}`);
      if (gates.shouldFetchRuns) {
        await loadRuns(runQuery);
      }
    } catch (error) {
      setSaveError(normalizeApiError(error, "Failed to create run."));
    } finally {
      setSaveLoading("");
    }
  }

  async function handleRunAction(action) {
    if (!selectedRun) {
      setSaveError("Select a run first.");
      return;
    }

    if (action === "post" && !canPostSelectedRun) {
      setSaveError("Post action is not allowed for selected run.");
      return;
    }
    if (action === "reverse" && !canReverseSelectedRun) {
      setSaveError("Reverse action is not allowed for selected run.");
      return;
    }

    setSaveLoading(action);
    setSaveError("");
    setSaveMessage("");
    try {
      if (action === "post") {
        await postRevenueRecognitionRun(
          selectedRun.id,
          buildRevenueRunActionPayload(runActionForm, "post")
        );
      } else {
        await reverseRevenueRecognitionRun(
          selectedRun.id,
          buildRevenueRunActionPayload(runActionForm, "reverse")
        );
      }
      setSaveMessage(`Run ${action} action completed.`);
      if (gates.shouldFetchRuns) {
        await loadRuns(runQuery);
      }
    } catch (error) {
      setSaveError(normalizeApiError(error, `Failed to ${action} run.`));
    } finally {
      setSaveLoading("");
    }
  }

  async function loadReports() {
    if (!gates.shouldFetchReports) {
      setReportsError("Missing permission: revenue.report.read");
      return;
    }

    setReportsLoading(true);
    setReportsError("");
    setReportsMessage("");
    try {
      const query = buildRevenueReportQuery(reportFilters);
      const [rollforward, deferred, accrual, prepaid] = await Promise.all([
        getRevenueFutureYearRollforwardReport(query),
        getRevenueDeferredRevenueSplitReport(query),
        getRevenueAccrualSplitReport(query),
        getRevenuePrepaidExpenseSplitReport(query),
      ]);
      setRollforwardReport(rollforward || null);
      setDeferredSplitReport(deferred || null);
      setAccrualSplitReport(accrual || null);
      setPrepaidSplitReport(prepaid || null);
      setReportsMessage("Reports loaded.");
    } catch (error) {
      setReportsError(normalizeApiError(error, "Failed to load reports."));
      setRollforwardReport(null);
      setDeferredSplitReport(null);
      setAccrualSplitReport(null);
      setPrepaidSplitReport(null);
    } finally {
      setReportsLoading(false);
    }
  }

  function renderLegalEntityField({
    value,
    onChange,
    placeholder = "legalEntityId",
    allOptionLabel = "",
  }) {
    if (legalEntityOptions.length === 0) {
      return (
        <input
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
      );
    }
    return (
      <select
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={value}
        onChange={onChange}
      >
        <option value="">{allOptionLabel || placeholder}</option>
        {legalEntityOptions.map((row) => (
          <option key={`le-${row.id}`} value={String(row.id)}>
            {buildLegalEntityLabel(row)}
          </option>
        ))}
      </select>
    );
  }

  function renderFiscalPeriodField({
    legalEntityId,
    value,
    onChange,
    placeholder = "fiscalPeriodId",
    allOptionLabel = "",
  }) {
    const options = getFiscalPeriodOptions(legalEntityId);
    const loading = isFiscalPeriodLookupLoading(legalEntityId);
    if (!toPositiveInt(legalEntityId) || options.length === 0) {
      return (
        <input
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder={loading ? "Loading periods..." : placeholder}
          value={value}
          onChange={onChange}
        />
      );
    }
    return (
      <select
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={value}
        onChange={onChange}
      >
        <option value="">{allOptionLabel || placeholder}</option>
        {options.map((row) => (
          <option key={`fp-${row.id}`} value={String(row.id)}>
            {buildFiscalPeriodLabel(row)}
          </option>
        ))}
      </select>
    );
  }

  const runActionLegalEntityId = toPositiveInt(selectedRun?.legalEntityId);
  const runActionPeriodOptions = getFiscalPeriodOptions(runActionLegalEntityId);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Gelecek Yillar Gelirleri</h1>
        <p className="mt-1 text-sm text-slate-600">
          Periodization split UI for deferred, accrual, prepaid and rollforward reconciliation.
        </p>
        {lookupLoading ? (
          <div className="mt-2 text-sm text-slate-500">Loading legal entity and period lookups...</div>
        ) : null}
        {lookupError ? <div className="mt-2 text-sm text-amber-700">{lookupError}</div> : null}
        {saveError ? <div className="mt-2 text-sm text-rose-700">{saveError}</div> : null}
        {saveMessage ? <div className="mt-2 text-sm text-emerald-700">{saveMessage}</div> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Schedules</h2>
        {!gates.canReadSchedules ? (
          <div className="mt-2 text-sm text-amber-700">Read section hidden: revenue.schedule.read missing.</div>
        ) : (
          <>
            {scheduleError ? <div className="mt-2 text-sm text-rose-700">{scheduleError}</div> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              {renderLegalEntityField({
                value: scheduleQuery.legalEntityId,
                onChange: (event) =>
                  setScheduleQuery((prev) => ({
                    ...prev,
                    legalEntityId: event.target.value,
                    fiscalPeriodId: "",
                  })),
                allOptionLabel: "ALL ENTITIES",
              })}
              {renderFiscalPeriodField({
                legalEntityId: scheduleQuery.legalEntityId,
                value: scheduleQuery.fiscalPeriodId,
                onChange: (event) =>
                  setScheduleQuery((prev) => ({ ...prev, fiscalPeriodId: event.target.value })),
                allOptionLabel: "ALL PERIODS",
              })}
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={scheduleQuery.accountFamily} onChange={(event) => setScheduleQuery((prev) => ({ ...prev, accountFamily: event.target.value }))}>
                <option value="">ALL FAMILIES</option>
                {REVENUE_ACCOUNT_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}
              </select>
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={scheduleQuery.status} onChange={(event) => setScheduleQuery((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="">ALL STATUS</option>
                {REVENUE_SCHEDULE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={() => loadSchedules(scheduleQuery)} disabled={scheduleLoading}>{scheduleLoading ? "Loading..." : "Refresh"}</button>
            </div>
            <div className="mt-2 text-sm text-slate-600">Rows: {scheduleTotal}</div>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th>ID</th><th>Family</th><th>Status</th><th>Maturity</th><th>Amount Base</th></tr></thead>
                <tbody>
                  {scheduleRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200"><td>{row.id}</td><td>{row.accountFamily}</td><td>{row.status}</td><td>{row.maturityDate}</td><td>{formatAmount(row.amountBase)}</td></tr>
                  ))}
                  {scheduleRows.length === 0 ? <tr><td colSpan={5} className="py-2 text-slate-500">No schedules.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        )}

        <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={handleGenerateSchedule}>
          {renderLegalEntityField({
            value: scheduleForm.legalEntityId,
            onChange: (event) =>
              setScheduleForm((prev) => ({
                ...prev,
                legalEntityId: event.target.value,
                fiscalPeriodId: "",
              })),
            placeholder: "Select legalEntityId",
          })}
          {renderFiscalPeriodField({
            legalEntityId: scheduleForm.legalEntityId,
            value: scheduleForm.fiscalPeriodId,
            onChange: (event) =>
              setScheduleForm((prev) => ({ ...prev, fiscalPeriodId: event.target.value })),
            placeholder: "Select fiscalPeriodId",
          })}
          <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={scheduleForm.accountFamily} onChange={(event) => setScheduleForm((prev) => ({ ...prev, accountFamily: event.target.value }))}>{REVENUE_ACCOUNT_FAMILIES.map((family) => <option key={`s-${family}`} value={family}>{family}</option>)}</select>
          <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={scheduleForm.maturityDate} onChange={(event) => setScheduleForm((prev) => ({ ...prev, maturityDate: event.target.value }))} />
          <button className="rounded bg-cyan-700 px-3 py-1 text-sm text-white disabled:opacity-60" disabled={!gates.canGenerateSchedule || saveLoading === "generateSchedule" || scheduleSetupLoading}>{saveLoading === "generateSchedule" ? "Generating..." : "Generate Schedule"}</button>
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="amountTxn" value={scheduleForm.amountTxn} onChange={(event) => setScheduleForm((prev) => ({ ...prev, amountTxn: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="amountBase" value={scheduleForm.amountBase} onChange={(event) => setScheduleForm((prev) => ({ ...prev, amountBase: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="currencyCode" value={scheduleForm.currencyCode} onChange={(event) => setScheduleForm((prev) => ({ ...prev, currencyCode: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="fxRate" value={scheduleForm.fxRate} onChange={(event) => setScheduleForm((prev) => ({ ...prev, fxRate: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="sourceEventUid (optional)" value={scheduleForm.sourceEventUid} onChange={(event) => setScheduleForm((prev) => ({ ...prev, sourceEventUid: event.target.value }))} />
        </form>
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {scheduleSetupLoading ? "Checking posting mappings..." : null}
          {!scheduleSetupLoading && scheduleSetupError ? (
            <div className="text-rose-700">{scheduleSetupError}</div>
          ) : null}
          {!scheduleSetupLoading && scheduleSetupStatus?.ready ? (
            <div className="text-emerald-700">Posting mappings are ready for selected family.</div>
          ) : null}
          {!scheduleSetupLoading && scheduleSetupStatus && !scheduleSetupStatus.ready ? (
            <div className="text-rose-700">{buildPostingSetupErrorMessage(scheduleSetupStatus)}</div>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Runs</h2>
        {!gates.canReadRuns ? (
          <div className="mt-2 text-sm text-amber-700">Read section hidden: revenue.run.read missing.</div>
        ) : (
          <>
            {runError ? <div className="mt-2 text-sm text-rose-700">{runError}</div> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              {renderLegalEntityField({
                value: runQuery.legalEntityId,
                onChange: (event) =>
                  setRunQuery((prev) => ({
                    ...prev,
                    legalEntityId: event.target.value,
                    fiscalPeriodId: "",
                  })),
                allOptionLabel: "ALL ENTITIES",
              })}
              {renderFiscalPeriodField({
                legalEntityId: runQuery.legalEntityId,
                value: runQuery.fiscalPeriodId,
                onChange: (event) =>
                  setRunQuery((prev) => ({ ...prev, fiscalPeriodId: event.target.value })),
                allOptionLabel: "ALL PERIODS",
              })}
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={runQuery.accountFamily} onChange={(event) => setRunQuery((prev) => ({ ...prev, accountFamily: event.target.value }))}>
                <option value="">ALL FAMILIES</option>
                {REVENUE_ACCOUNT_FAMILIES.map((family) => <option key={`rf-${family}`} value={family}>{family}</option>)}
              </select>
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={runQuery.status} onChange={(event) => setRunQuery((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="">ALL STATUS</option>
                {REVENUE_RUN_STATUSES.map((status) => <option key={`rs-${status}`} value={status}>{status}</option>)}
              </select>
              <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={() => loadRuns(runQuery)} disabled={runLoading}>{runLoading ? "Loading..." : "Refresh"}</button>
            </div>
            <div className="mt-2 text-sm text-slate-600">Rows: {runTotal}</div>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th>ID</th><th>Run No</th><th>Family</th><th>Status</th><th>Amount Base</th><th></th></tr></thead>
                <tbody>
                  {runRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200"><td>{row.id}</td><td>{row.runNo}</td><td>{row.accountFamily}</td><td>{row.status}</td><td>{formatAmount(row.totalAmountBase)}</td><td><button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setSelectedRunId(row.id)}>Select</button></td></tr>
                  ))}
                  {runRows.length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No runs.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        )}

        <form className="mt-3 grid gap-2 md:grid-cols-5" onSubmit={handleCreateRun}>
          {renderLegalEntityField({
            value: runForm.legalEntityId,
            onChange: (event) =>
              setRunForm((prev) => ({
                ...prev,
                legalEntityId: event.target.value,
                fiscalPeriodId: "",
              })),
            placeholder: "Select legalEntityId",
          })}
          {renderFiscalPeriodField({
            legalEntityId: runForm.legalEntityId,
            value: runForm.fiscalPeriodId,
            onChange: (event) =>
              setRunForm((prev) => ({ ...prev, fiscalPeriodId: event.target.value })),
            placeholder: "Select fiscalPeriodId",
          })}
          <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={runForm.accountFamily} onChange={(event) => setRunForm((prev) => ({ ...prev, accountFamily: event.target.value }))}>{REVENUE_ACCOUNT_FAMILIES.map((family) => <option key={`run-${family}`} value={family}>{family}</option>)}</select>
          <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={runForm.maturityDate} onChange={(event) => setRunForm((prev) => ({ ...prev, maturityDate: event.target.value }))} />
          <button className="rounded bg-cyan-700 px-3 py-1 text-sm text-white disabled:opacity-60" disabled={!gates.canCreateRun || saveLoading === "createRun" || runSetupLoading}>{saveLoading === "createRun" ? "Creating..." : "Create Run"}</button>
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="runNo (optional)" value={runForm.runNo} onChange={(event) => setRunForm((prev) => ({ ...prev, runNo: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="sourceRunUid (optional)" value={runForm.sourceRunUid} onChange={(event) => setRunForm((prev) => ({ ...prev, sourceRunUid: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="scheduleId (optional)" value={runForm.scheduleId} onChange={(event) => setRunForm((prev) => ({ ...prev, scheduleId: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="totalAmountTxn" value={runForm.totalAmountTxn} onChange={(event) => setRunForm((prev) => ({ ...prev, totalAmountTxn: event.target.value }))} />
          <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="totalAmountBase" value={runForm.totalAmountBase} onChange={(event) => setRunForm((prev) => ({ ...prev, totalAmountBase: event.target.value }))} />
        </form>
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {runSetupLoading ? "Checking posting mappings..." : null}
          {!runSetupLoading && runSetupError ? <div className="text-rose-700">{runSetupError}</div> : null}
          {!runSetupLoading && runSetupStatus?.ready ? (
            <div className="text-emerald-700">Posting mappings are ready for selected family.</div>
          ) : null}
          {!runSetupLoading && runSetupStatus && !runSetupStatus.ready ? (
            <div className="text-rose-700">{buildPostingSetupErrorMessage(runSetupStatus)}</div>
          ) : null}
        </div>

        <div className="mt-3 rounded border border-slate-200 p-3">
          <div className="text-sm text-slate-700">
            Selected run: {selectedRun ? `#${selectedRun.id} ${selectedRun.status}` : "none"}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            {runActionLegalEntityId && runActionPeriodOptions.length > 0 ? (
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={runActionForm.settlementPeriodId}
                onChange={(event) =>
                  setRunActionForm((prev) => ({ ...prev, settlementPeriodId: event.target.value }))
                }
              >
                <option value="">settlementPeriodId (post)</option>
                {runActionPeriodOptions.map((row) => (
                  <option key={`settle-${row.id}`} value={String(row.id)}>
                    {buildFiscalPeriodLabel(row)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="settlementPeriodId (post)"
                value={runActionForm.settlementPeriodId}
                onChange={(event) =>
                  setRunActionForm((prev) => ({ ...prev, settlementPeriodId: event.target.value }))
                }
              />
            )}
            {runActionLegalEntityId && runActionPeriodOptions.length > 0 ? (
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={runActionForm.reversalPeriodId}
                onChange={(event) =>
                  setRunActionForm((prev) => ({ ...prev, reversalPeriodId: event.target.value }))
                }
              >
                <option value="">reversalPeriodId (reverse)</option>
                {runActionPeriodOptions.map((row) => (
                  <option key={`reverse-${row.id}`} value={String(row.id)}>
                    {buildFiscalPeriodLabel(row)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="reversalPeriodId (reverse)"
                value={runActionForm.reversalPeriodId}
                onChange={(event) =>
                  setRunActionForm((prev) => ({ ...prev, reversalPeriodId: event.target.value }))
                }
              />
            )}
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="reverse reason" value={runActionForm.reason} onChange={(event) => setRunActionForm((prev) => ({ ...prev, reason: event.target.value }))} />
            <div className="flex gap-2">
              <button className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleRunAction("post")} disabled={!canPostSelectedRun || saveLoading === "post"}>{saveLoading === "post" ? "..." : "Post"}</button>
              <button className="rounded bg-rose-700 px-3 py-1 text-sm text-white disabled:opacity-60" onClick={() => handleRunAction("reverse")} disabled={!canReverseSelectedRun || saveLoading === "reverse"}>{saveLoading === "reverse" ? "..." : "Reverse"}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Reports and Split Panels</h2>
        {!gates.canReadReports ? (
          <div className="mt-2 text-sm text-amber-700">Read section hidden: revenue.report.read missing.</div>
        ) : (
          <>
            {reportsError ? <div className="mt-2 text-sm text-rose-700">{reportsError}</div> : null}
            {reportsMessage ? <div className="mt-2 text-sm text-emerald-700">{reportsMessage}</div> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              {renderLegalEntityField({
                value: reportFilters.legalEntityId,
                onChange: (event) =>
                  setReportFilters((prev) => ({
                    ...prev,
                    legalEntityId: event.target.value,
                    fiscalPeriodId: "",
                  })),
                allOptionLabel: "ALL ENTITIES",
              })}
              {renderFiscalPeriodField({
                legalEntityId: reportFilters.legalEntityId,
                value: reportFilters.fiscalPeriodId,
                onChange: (event) =>
                  setReportFilters((prev) => ({ ...prev, fiscalPeriodId: event.target.value })),
                allOptionLabel: "ALL PERIODS",
              })}
              <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={reportFilters.accountFamily} onChange={(event) => setReportFilters((prev) => ({ ...prev, accountFamily: event.target.value }))}>
                <option value="">ALL FAMILIES</option>
                {REVENUE_ACCOUNT_FAMILIES.map((family) => <option key={`report-${family}`} value={family}>{family}</option>)}
              </select>
              <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={reportFilters.asOfDate} onChange={(event) => setReportFilters((prev) => ({ ...prev, asOfDate: event.target.value }))} />
              <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white" onClick={loadReports} disabled={reportsLoading}>{reportsLoading ? "Loading..." : "Load Reports"}</button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Gelecek Aylar Gelirleri</div>
                <div className="text-slate-600">Short-term deferred: {formatAmount(deferredSummary.shortTermAmountBase)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Gelecek Yillar Gelirleri</div>
                <div className="text-slate-600">Long-term deferred: {formatAmount(deferredSummary.longTermAmountBase)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Gelir Tahakkuklari (181/281)</div>
                <div className="text-slate-600">Short/Long: {formatAmount(accrRevRow?.shortTermAmountBase)} / {formatAmount(accrRevRow?.longTermAmountBase)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Gider Tahakkuklari (381/481)</div>
                <div className="text-slate-600">Short/Long: {formatAmount(accrExpRow?.shortTermAmountBase)} / {formatAmount(accrExpRow?.longTermAmountBase)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Prepaid Carry (180/280)</div>
                <div className="text-slate-600">Short/Long: {formatAmount(prepaidSummary.shortTermAmountBase)} / {formatAmount(prepaidSummary.longTermAmountBase)}</div>
              </div>
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold text-slate-800">Reclass Visibility (Long to Short)</div>
                <div className="text-slate-600">Indicator: {formatAmount(estimateReclassToShortTerm(rollforwardSummary))}</div>
              </div>
            </div>

            <div className="mt-3 rounded border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-800">Subledger / GL Reconciliation Summary</div>
              <table className="mt-2 min-w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th>Report</th><th>Matched</th><th>Unmatched</th><th>Diff Base</th><th>Reconciled</th></tr></thead>
                <tbody>
                  {[
                    ["Rollforward", rollforwardReport],
                    ["Deferred split", deferredSplitReport],
                    ["Accrual split", accrualSplitReport],
                    ["Prepaid split", prepaidSplitReport],
                  ].map(([label, report]) => (
                    <tr key={label} className="border-t border-slate-200">
                      <td>{label}</td>
                      <td>{Number(report?.reconciliation?.matchedGroups || 0)} / {Number(report?.reconciliation?.totalGroups || 0)}</td>
                      <td>{Number(report?.reconciliation?.unmatchedGroups || 0)}</td>
                      <td>{formatAmount(report?.reconciliation?.differenceBaseTotal)}</td>
                      <td>{report?.reconciliation?.reconciled ? "YES" : "NO"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold text-slate-800">Rollforward (period basis)</h3>
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th>Family</th><th>Opening</th><th>Movement</th><th>Closing</th><th>Short</th><th>Long</th></tr></thead>
                <tbody>
                  {(rollforwardReport?.rows || []).map((row, index) => (
                    <tr key={`rf-row-${index}`} className="border-t border-slate-200">
                      <td>{familyLabel(row.accountFamily)}</td>
                      <td>{formatAmount(row.openingAmountBase)}</td>
                      <td>{formatAmount(row.movementAmountBase)}</td>
                      <td>{formatAmount(row.closingAmountBase)}</td>
                      <td>{formatAmount(row.closingShortTermAmountBase)}</td>
                      <td>{formatAmount(row.closingLongTermAmountBase)}</td>
                    </tr>
                  ))}
                  {(rollforwardReport?.rows || []).length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No rollforward rows.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              {[
                ["Deferred revenue split", deferredSplitReport],
                ["Accrual split", accrualSplitReport],
                ["Prepaid expense split", prepaidSplitReport],
              ].map(([title, report]) => (
                <div key={title} className="overflow-x-auto rounded border border-slate-200 p-2">
                  <div className="mb-1 text-sm font-semibold text-slate-800">{title}</div>
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-600"><tr><th>Family</th><th>Short</th><th>Long</th><th>Total</th></tr></thead>
                    <tbody>
                      {(report?.rows || []).map((row, index) => (
                        <tr key={`${title}-${index}`} className="border-t border-slate-200">
                          <td>{familyLabel(row.accountFamily)}</td>
                          <td>{formatAmount(row.shortTermAmountBase)}</td>
                          <td>{formatAmount(row.longTermAmountBase)}</td>
                          <td>{formatAmount(row.totalAmountBase)}</td>
                        </tr>
                      ))}
                      {(report?.rows || []).length === 0 ? <tr><td colSpan={4} className="py-2 text-slate-500">No rows.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

