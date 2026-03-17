
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import {
  approveClosePayrollCloseControl,
  getPayrollCloseControl,
  listPayrollCloseControls,
  preparePayrollCloseControl,
  reopenPayrollCloseControl,
  requestPayrollCloseControl,
} from "../../api/payrollClose.js";
import StatusTimeline from "../../components/StatusTimeline.jsx";
import {
  buildLifecycleTimelineSteps,
  getLifecycleAllowedActions,
  getLifecycleStatusMeta,
} from "../../lifecycle/lifecycleRules.js";

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}
   
function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
     return parsed;
}
   
function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}
   
function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(0, 10);
}
   
function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}
   
function buildUserActorLabel(userId) {
  const parsed = toPositiveInt(userId);
  return parsed ? `User #${parsed}` : null;
}
   
function buildPayrollCloseLifecycleEvents(close, auditRows = []) {
  if (!close) return [];

  const events = [];

  if (close.created_at) {
    events.push({
      statusCode: "DRAFT",
      at: close.created_at,
      note: "Close control created.",
    });
  }
     if (close.prepared_at) {
    events.push({
      statusCode: "READY",
      at: close.prepared_at,
      actorName: buildUserActorLabel(close.prepared_by_user_id),
      note: normalizeOptionalText(close.prepare_note) || "Checklist prepared.",
    });
  }
     if (close.requested_at) {
    events.push({
      statusCode: "REQUESTED",
      at: close.requested_at,
      actorName: buildUserActorLabel(close.requested_by_user_id),
      note: normalizeOptionalText(close.request_note) || "Close requested.",
    });
  }
     if (close.closed_at) {
    events.push({
      statusCode: "CLOSED",
      at: close.closed_at,
      actorName: buildUserActorLabel(close.closed_by_user_id || close.approved_by_user_id),
      note: normalizeOptionalText(close.close_note) || "Payroll period closed.",
    });
  }
     if (close.reopened_at) {
    events.push({
      statusCode: "REOPENED",
      at: close.reopened_at,
      actorName: buildUserActorLabel(close.reopened_by_user_id),
      note: normalizeOptionalText(close.reopen_reason) || "Payroll period reopened.",
    });
  }
   
  for (const audit of Array.isArray(auditRows) ? auditRows : []) {
    const action = toUpper(audit?.action);
    let statusCode = null;
    if (action === "PREPARED") statusCode = "READY";
    if (action === "REQUESTED") statusCode = "REQUESTED";
    if (action === "CLOSED") statusCode = "CLOSED";
    if (action === "REOPENED") statusCode = "REOPENED";
    if (!statusCode) continue;
    events.push({
      statusCode,
      at: audit?.acted_at || null,
      actorName: buildUserActorLabel(audit?.acted_by_user_id),
      note: normalizeOptionalText(audit?.note),
    });
  }
   
  return events;
}
   
function normalizeDateQueryParam(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}
   
function buildFilterPrefillFromQuery(searchParams) {
  const legalEntityId = String(searchParams.get("legalEntityId") || "").trim();
  const periodStartRaw = searchParams.get("periodStart");
  const periodEndRaw = searchParams.get("periodEnd");
  const payrollPeriodRaw = searchParams.get("payrollPeriod");
  const payrollPeriod = normalizeDateQueryParam(payrollPeriodRaw);
  const periodStart = normalizeDateQueryParam(periodStartRaw) || payrollPeriod || "";
  const periodEnd = normalizeDateQueryParam(periodEndRaw) || payrollPeriod || "";
  const status = toUpper(searchParams.get("status"));
  const hasUsefulPrefill = Boolean(legalEntityId || periodStart || periodEnd || status);
  return {
    hasUsefulPrefill,
    filters: {
      legalEntityId,
      status,
      periodStart,
      periodEnd,
    },
  };
}
   
function getCloseStatusUi(status) {
  switch (toUpper(status)) {
    case "READY":
      return {
        label: "Ready",
        badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
        accentClass: "from-blue-600 via-sky-600 to-cyan-600",
        surfaceClass: "border-blue-200 bg-blue-50",
        textClass: "text-blue-700",
      };
    case "REQUESTED":
      return {
        label: "Requested",
        badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
        accentClass: "from-amber-600 via-orange-500 to-amber-500",
        surfaceClass: "border-amber-200 bg-amber-50",
        textClass: "text-amber-700",
      };
    case "CLOSED":
      return {
        label: "Closed",
        badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
        accentClass: "from-emerald-700 via-emerald-600 to-teal-600",
        surfaceClass: "border-emerald-200 bg-emerald-50",
        textClass: "text-emerald-700",
      };
    case "REOPENED":
      return {
        label: "Reopened",
        badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
        accentClass: "from-violet-700 via-fuchsia-600 to-violet-600",
        surfaceClass: "border-violet-200 bg-violet-50",
        textClass: "text-violet-700",
      };
    case "DRAFT":
    default:
      return {
        label: "Draft",
        badgeClass: "border-slate-200 bg-slate-50 text-slate-700",
        accentClass: "from-slate-900 via-slate-700 to-slate-600",
        surfaceClass: "border-slate-200 bg-slate-50",
        textClass: "text-slate-700",
      };
  }
   }
   
function getCheckSeverityClass(severity) {
  switch (toUpper(severity)) {
    case "ERROR":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "WARN":
    case "WARNING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
   }
   
function getCheckStatusClass(status) {
  switch (toUpper(status)) {
    case "FAIL":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "PASS":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
   }
   
function getLockBadgeClass(enabled) {
  return enabled
    ? "border-slate-900 bg-slate-900 text-white"
    : "border-slate-200 bg-white text-slate-600";
}
   
function buildEntityOptionLabel(row) {
  const code = normalizeOptionalText(row?.code);
  const name = normalizeOptionalText(row?.name);
  if (code && name) return `${code} - ${name}`;
  return code || name || `LE#${row?.id || "-"}`;
}
   
function buildEntityMap(rows) {
  return new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(toPositiveInt(row?.id) || ""),
      {
        id: toPositiveInt(row?.id),
        code: normalizeOptionalText(row?.code),
        name: normalizeOptionalText(row?.name),
        label: buildEntityOptionLabel(row),
      },
    ])
  );
}
   
function buildEntityLabel(row, entityMap) {
  const entityId = String(toPositiveInt(row?.legal_entity_id || row?.legalEntityId) || "");
  const lookup = entityId ? entityMap.get(entityId) : null;
  const code = normalizeOptionalText(row?.legal_entity_code || row?.legalEntityCode) || lookup?.code;
  const name = normalizeOptionalText(row?.legal_entity_name || row?.legalEntityName) || lookup?.name;
  const idLabel = entityId ? `LE#${entityId}` : "Unknown legal entity";
  return {
    primary: code || name || lookup?.label || idLabel,
    secondary: code && name ? name : code && !name ? idLabel : code || idLabel,
  };
}
   
function buildChecklistProgress(row) {
  const total = Number(row?.total_checks || 0);
  const passed = Number(row?.passed_checks || 0);
  const failed = Number(row?.failed_checks || 0);
  const warnings = Number(row?.warning_checks || 0);
  return {
    total,
    passed,
    failed,
    warnings,
    percent: total > 0 ? Math.max(0, Math.min(100, Math.round((passed / total) * 100))) : 0,
  };
}
   
function summarizeRows(rows) {
  const summary = {
    total: Array.isArray(rows) ? rows.length : 0,
    draft: 0,
    ready: 0,
    requested: 0,
    closed: 0,
    reopened: 0,
    blocked: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = toUpper(row?.status);
    if (status === "DRAFT") summary.draft += 1;
    if (status === "READY") summary.ready += 1;
    if (status === "REQUESTED") summary.requested += 1;
    if (status === "CLOSED") summary.closed += 1;
    if (status === "REOPENED") summary.reopened += 1;
    if (Number(row?.failed_checks || 0) > 0) summary.blocked += 1;
  }
   
  return summary;
}
   
function buildReadinessCallout(close, failingErrorChecks, currentUserId) {
  const status = toUpper(close?.status);
  if (!close) {
    return {
      toneClass: "border-slate-200 bg-slate-50 text-slate-700",
      title: "Select or prepare a close control",
      description: "Use the left-hand panel to prepare a checklist or pick an existing close control.",
    };
  }
     if (status === "READY") {
    return {
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
      title: "Ready to request close",
      description:
        failingErrorChecks.length > 0
          ? `${failingErrorChecks.length} blocking checks still need attention before request.`
          : "Blocking checks are clear. Submit the close request to move into maker-checker approval.",
    };
  }
     if (status === "REQUESTED") {
    return {
      toneClass: "border-amber-200 bg-amber-50 text-amber-800",
      title: "Waiting for approval",
      description:
        currentUserId && currentUserId === toPositiveInt(close?.requested_by_user_id)
          ? "This close was requested by you. A different user should approve and close it."
          : "Approve & Close is the next controlled step for this payroll period.",
    };
  }
     if (status === "CLOSED") {
    return {
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
      title: "Period is closed",
      description: "Use reopen only when a controlled correction is required and the audit reason is ready.",
    };
  }
     if (status === "REOPENED") {
    return {
      toneClass: "border-violet-200 bg-violet-50 text-violet-800",
      title: "Close control reopened",
      description: "Refresh the checklist with Prepare after corrections are complete, then request close again.",
    };
  }
     return {
    toneClass: "border-sky-200 bg-sky-50 text-sky-800",
    title: "Checklist still needs preparation",
    description: "Prepare refreshes the checks, updates lock choices, and determines whether the period can move to READY.",
  };
}
   
function sortChecks(rows) {
  const severityWeight = { ERROR: 0, WARN: 1, WARNING: 1, INFO: 2 };
  const statusWeight = { FAIL: 0, WARN: 1, PASS: 2 };
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftStatus = statusWeight[toUpper(left?.status)] ?? 99;
    const rightStatus = statusWeight[toUpper(right?.status)] ?? 99;
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;
    const leftSeverity = severityWeight[toUpper(left?.severity)] ?? 99;
    const rightSeverity = severityWeight[toUpper(right?.severity)] ?? 99;
    if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
    return String(left?.check_name || left?.check_code || "").localeCompare(
      String(right?.check_name || right?.check_code || "")
    );
  });
}
   
function sortAuditRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftTime = left?.acted_at ? Date.parse(left.acted_at) : 0;
    const rightTime = right?.acted_at ? Date.parse(right.acted_at) : 0;
    return rightTime - leftTime;
  });
}
   
function buildPrepareLockRows(form) {
  return [
    {
      key: "lockRunChanges",
      label: "Lock run changes",
      description: "Stops review/finalize changes while the close checklist is active.",
      checked: Boolean(form.lockRunChanges),
    },
    {
      key: "lockManualSettlements",
      label: "Lock manual settlements",
      description: "Prevents manual settlement overrides near payroll close.",
      checked: Boolean(form.lockManualSettlements),
    },
    {
      key: "lockPaymentPrep",
      label: "Lock payment prep",
      description: "Blocks new payment-prep batches once payouts are complete.",
      checked: Boolean(form.lockPaymentPrep),
    },
  ];
}
   
function buildSelectedLockRows(close) {
  return [
    {
      key: "run",
      label: "Run changes",
      enabled: Boolean(Number(close?.lock_run_changes || 0)),
    },
    {
      key: "manual",
      label: "Manual settlements",
      enabled: Boolean(Number(close?.lock_manual_settlements || 0)),
    },
    {
      key: "payment",
      label: "Payment prep",
      enabled: Boolean(Number(close?.lock_payment_prep || 0)),
    },
  ];
}
   
function buildActorMoments(close) {
  return [
    {
      key: "prepared",
      label: "Prepared",
      at: close?.prepared_at,
      actor: buildUserActorLabel(close?.prepared_by_user_id),
    },
    {
      key: "requested",
      label: "Requested",
      at: close?.requested_at,
      actor: buildUserActorLabel(close?.requested_by_user_id),
    },
    {
      key: "closed",
      label: "Closed",
      at: close?.closed_at,
      actor: buildUserActorLabel(close?.closed_by_user_id || close?.approved_by_user_id),
    },
    {
      key: "reopened",
      label: "Reopened",
      at: close?.reopened_at,
      actor: buildUserActorLabel(close?.reopened_by_user_id),
    },
  ].filter((row) => row.at || row.actor);
}
   
export default function PayrollCloseControlsPage() {
  const [searchParams] = useSearchParams();
  const { user, hasPermission } = useAuth();
  const canRead = hasPermission("payroll.close.read");
  const canPrepare = hasPermission("payroll.close.prepare");
  const canRequest = hasPermission("payroll.close.request");
  const canApprove = hasPermission("payroll.close.approve");
  const canReopen = hasPermission("payroll.close.reopen");
  const canReadOrgTree = hasPermission("org.tree.read");

  const [filters, setFilters] = useState({
    legalEntityId: "",
    status: "",
    periodStart: "",
    periodEnd: "",
  });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [selectedCloseId, setSelectedCloseId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const [legalEntityOptions, setLegalEntityOptions] = useState([]);
  const [legalEntityLoading, setLegalEntityLoading] = useState(false);
  const [legalEntityError, setLegalEntityError] = useState("");

  const [prepareForm, setPrepareForm] = useState({
    legalEntityId: "",
    periodStart: "",
    periodEnd: "",
    lockRunChanges: true,
    lockManualSettlements: true,
    lockPaymentPrep: false,
    note: "",
  });
  const [requestForm, setRequestForm] = useState({
    note: "",
    requestIdempotencyKey: "",
  });
  const [approveForm, setApproveForm] = useState({
    note: "",
    closeIdempotencyKey: "",
  });
  const [reopenForm, setReopenForm] = useState({
    reason: "",
  });

  const currentUserId = toPositiveInt(user?.id);
  const selectedClose = detail?.close || null;
  const failingErrorChecks = useMemo(
    () =>
      (detail?.checks || []).filter(
        (check) => toUpper(check?.severity) === "ERROR" && toUpper(check?.status) === "FAIL"
      ),
    [detail]
  );
  const selectedCloseLifecycleMeta = useMemo(
    () => getLifecycleStatusMeta("payrollClose", selectedClose?.status),
    [selectedClose?.status]
  );
  const selectedCloseLifecycleActions = useMemo(
    () => getLifecycleAllowedActions("payrollClose", selectedClose?.status),
    [selectedClose?.status]
  );
  const selectedCloseLifecycleActionLabels = useMemo(
    () => selectedCloseLifecycleActions.map((item) => item.label),
    [selectedCloseLifecycleActions]
  );
  const selectedCloseLifecycleTimeline = useMemo(
    () =>
      buildLifecycleTimelineSteps(
        "payrollClose",
        selectedClose?.status,
        buildPayrollCloseLifecycleEvents(selectedClose, detail?.audit || [])
      ),
    [selectedClose, detail?.audit]
  );
  const entityMap = useMemo(() => buildEntityMap(legalEntityOptions), [legalEntityOptions]);
  const listSummary = useMemo(() => summarizeRows(rows), [rows]);
  const sortedChecklistRows = useMemo(() => sortChecks(detail?.checks || []), [detail?.checks]);
  const sortedAuditRows = useMemo(() => sortAuditRows(detail?.audit || []), [detail?.audit]);
  const selectedCloseStatusUi = useMemo(
    () => getCloseStatusUi(selectedClose?.status),
    [selectedClose?.status]
  );
  const selectedCloseEntity = useMemo(
    () => buildEntityLabel(selectedClose, entityMap),
    [selectedClose, entityMap]
  );
  const selectedCloseProgress = useMemo(
    () => buildChecklistProgress(selectedClose),
    [selectedClose]
  );
  const selectedLockRows = useMemo(() => buildSelectedLockRows(selectedClose), [selectedClose]);
  const selectedActorMoments = useMemo(() => buildActorMoments(selectedClose), [selectedClose]);
  const readinessCallout = useMemo(
    () => buildReadinessCallout(selectedClose, failingErrorChecks, currentUserId),
    [selectedClose, failingErrorChecks, currentUserId]
  );
  const availableActionSet = useMemo(
    () => new Set(selectedCloseLifecycleActions.map((item) => item.action)),
    [selectedCloseLifecycleActions]
  );

  const requestDisabledReason = useMemo(() => {
    if (!selectedClose?.id) return "Select a close control first.";
    if (!canRequest) return "Missing permission: payroll.close.request";
    if (!availableActionSet.has("request")) {
      return `Request Close is not available while status is ${selectedClose.status || "-"}.`;
    }
    if (failingErrorChecks.length > 0) {
      return "Resolve blocking error checks before requesting close.";
    }
    return "";
  }, [selectedClose, canRequest, availableActionSet, failingErrorChecks.length]);

  const approveDisabledReason = useMemo(() => {
    if (!selectedClose?.id) return "Select a close control first.";
    if (!canApprove) return "Missing permission: payroll.close.approve";
    if (!availableActionSet.has("approveClose")) {
      return `Approve & Close is not available while status is ${selectedClose.status || "-"}.`;
    }
    if (currentUserId && currentUserId === toPositiveInt(selectedClose?.requested_by_user_id)) {
      return "Maker-checker guard: the requester should not approve the same close.";
    }
    return "";
  }, [selectedClose, canApprove, availableActionSet, currentUserId]);

  const reopenDisabledReason = useMemo(() => {
    if (!selectedClose?.id) return "Select a close control first.";
    if (!canReopen) return "Missing permission: payroll.close.reopen";
    if (!availableActionSet.has("reopen")) {
      return `Reopen is not available while status is ${selectedClose.status || "-"}.`;
    }
    if (!normalizeOptionalText(reopenForm.reason)) {
      return "Reason is required to reopen a closed period.";
    }
    return "";
  }, [selectedClose, canReopen, availableActionSet, reopenForm.reason]);

  async function loadList(overrideFilters = null) {
    const activeFilters = overrideFilters || filters;
    if (!canRead) return;
    setListLoading(true);
    setListError("");
    try {
      const res = await listPayrollCloseControls({
        limit: 200,
        offset: 0,
        legalEntityId: activeFilters.legalEntityId || undefined,
        status: activeFilters.status || undefined,
        periodStart: activeFilters.periodStart || undefined,
        periodEnd: activeFilters.periodEnd || undefined,
      });
      const nextRows = Array.isArray(res?.rows) ? res.rows : [];
      setRows(nextRows);
      setTotal(Number(res?.total || 0));
      setSelectedCloseId((previous) => {
        const normalizedPrevious = toPositiveInt(previous);
        if (
          normalizedPrevious &&
          nextRows.some((row) => toPositiveInt(row?.id) === normalizedPrevious)
        ) {
          return normalizedPrevious;
        }
        return toPositiveInt(nextRows[0]?.id) || null;
      });
    } catch (err) {
      setRows([]);
      setTotal(0);
      setSelectedCloseId(null);
      setListError(err?.response?.data?.message || "Payroll close listesi yuklenemedi");
    } finally {
      setListLoading(false);
    }
     }
   
  async function loadDetail(closeId) {
    if (!canRead || !closeId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    try {
      const res = await getPayrollCloseControl(closeId);
      setDetail(res);
    } catch (err) {
      setDetail(null);
      setDetailError(err?.response?.data?.message || "Payroll close detayi yuklenemedi");
    } finally {
      setDetailLoading(false);
    }
     }
   
  async function refreshAll() {
    await loadList();
    if (selectedCloseId) {
      await loadDetail(selectedCloseId);
    }
     }
   
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    if (!canReadOrgTree) {
      setLegalEntityOptions([]);
      setLegalEntityLoading(false);
      setLegalEntityError(
        canRead || canPrepare ? "org.tree.read missing: enter legal entity ID manually." : ""
      );
      return;
    }
    let cancelled = false;
    setLegalEntityLoading(true);
    setLegalEntityError("");
    void listLegalEntities({ limit: 500, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        const nextRows = [...(res?.rows || [])].sort((left, right) =>
          buildEntityOptionLabel(left).localeCompare(buildEntityOptionLabel(right))
        );
        setLegalEntityOptions(nextRows);
      })
      .catch((err) => {
        if (cancelled) return;
        setLegalEntityOptions([]);
        setLegalEntityError(err?.response?.data?.message || "Legal entity listesi yuklenemedi");
      })
      .finally(() => {
        if (!cancelled) setLegalEntityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, canPrepare, canReadOrgTree]);

  useEffect(() => {
    if (!canRead) return;
    const prefill = buildFilterPrefillFromQuery(searchParams);
    if (!prefill.hasUsefulPrefill) return;
    setFilters((prev) => ({ ...prev, ...prefill.filters }));
    setPrepareForm((prev) => ({
      ...prev,
      legalEntityId: prefill.filters.legalEntityId || prev.legalEntityId,
      periodStart: prefill.filters.periodStart || prev.periodStart,
      periodEnd: prefill.filters.periodEnd || prev.periodEnd,
    }));
    setSelectedCloseId(null);
    loadList(prefill.filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canRead]);

  useEffect(() => {
    if (selectedCloseId) {
      loadDetail(selectedCloseId);
    } else {
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCloseId, canRead]);

  async function handlePrepare(event) {
    event.preventDefault();
    if (!canPrepare) return;
    setBusy("prepare");
    setMessage("");
    setDetailError("");
    try {
      const res = await preparePayrollCloseControl({
        ...prepareForm,
        legalEntityId: Number(prepareForm.legalEntityId),
      });
      setDetail(res);
      if (res?.close?.id) setSelectedCloseId(res.close.id);
      setMessage("Checklist prepared.");
      await loadList();
    } catch (err) {
      setDetailError(err?.response?.data?.message || "Prepare islemi basarisiz");
    } finally {
      setBusy("");
    }
     }
   
  async function handleRequest() {
    if (requestDisabledReason || !selectedClose?.id) return;
    setBusy("request");
    setMessage("");
    setDetailError("");
    try {
      const res = await requestPayrollCloseControl(selectedClose.id, requestForm);
      setDetail(res);
      setMessage("Close request created.");
      await loadList();
    } catch (err) {
      setDetailError(err?.response?.data?.message || "Request-close basarisiz");
    } finally {
      setBusy("");
    }
     }
   
  async function handleApprove() {
    if (approveDisabledReason || !selectedClose?.id) return;
    setBusy("approve");
    setMessage("");
    setDetailError("");
    try {
      const res = await approveClosePayrollCloseControl(selectedClose.id, approveForm);
      setDetail(res);
      setMessage("Payroll period closed.");
      await loadList();
    } catch (err) {
      setDetailError(err?.response?.data?.message || "Approve-close basarisiz");
    } finally {
      setBusy("");
    }
     }
   
  async function handleReopen() {
    if (reopenDisabledReason || !selectedClose?.id) return;
    setBusy("reopen");
    setMessage("");
    setDetailError("");
    try {
      const res = await reopenPayrollCloseControl(selectedClose.id, reopenForm);
      setDetail(res);
      setMessage("Payroll period reopened.");
      await loadList();
    } catch (err) {
      setDetailError(err?.response?.data?.message || "Reopen basarisiz");
    } finally {
      setBusy("");
    }
     }
   
  function renderLegalEntityField(value, onChange, required = false) {
    if (canReadOrgTree) {
      return (
        <select
          value={value}
          onChange={onChange}
          required={required}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          disabled={legalEntityLoading}
        >
          <option value="">{required ? "Select legal entity" : "All legal entities"}</option>
          {legalEntityOptions.map((row) => (
            <option key={row.id} value={String(row.id || "")}>
              {buildEntityOptionLabel(row)}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        value={value}
        onChange={onChange}
        required={required}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        placeholder={required ? "legalEntityId *" : "legalEntityId"}
      />
    );
  }
   
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Payroll Close Controls</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Prepare the close checklist, review blockers, and move the payroll period through the
            maker-checker close flow without forcing users to decode raw tables first.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/payroll-runs"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Payroll Runs
          </Link>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={!canRead || listLoading || detailLoading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {listLoading || detailLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {!canRead ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Missing permission: <code>payroll.close.read</code>
        </div>
      ) : null}
      {listError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {listError}
        </div>
      ) : null}
      {detailError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {detailError}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
   
      {canRead ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filtered Controls
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">{total}</div>
            <p className="mt-1 text-sm text-slate-600">Current list result count for the active filters.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ready Or Requested
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {listSummary.ready + listSummary.requested}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Controls that are prepared for request or already waiting for approval.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Blocked By Failures
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">{listSummary.blocked}</div>
            <p className="mt-1 text-sm text-slate-600">Controls that still show failed checklist rows.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Closed Periods
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">{listSummary.closed}</div>
            <p className="mt-1 text-sm text-slate-600">Controls that have already completed the close flow.</p>
          </div>
        </div>
      ) : null}
   
      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.35fr)]">
        <div className="space-y-6">
          <form onSubmit={handlePrepare} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Prepare Checklist</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Start or refresh one payroll close control for a specific legal entity and period.
                </p>
              </div>
              {selectedClose ? (
                <button
                  type="button"
                  onClick={() =>
                    setPrepareForm((prev) => ({
                      ...prev,
                      legalEntityId: String(selectedClose.legal_entity_id || ""),
                      periodStart: formatDate(selectedClose.period_start) !== "-" ? formatDate(selectedClose.period_start) : prev.periodStart,
                      periodEnd: formatDate(selectedClose.period_end) !== "-" ? formatDate(selectedClose.period_end) : prev.periodEnd,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Use Selected Period
                </button>
              ) : null}
            </div>

            {!canPrepare ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Missing permission: <code>payroll.close.prepare</code>
              </div>
            ) : null}
            {legalEntityError ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {legalEntityError}
              </div>
            ) : null}
   
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Legal Entity
                {renderLegalEntityField(
                  prepareForm.legalEntityId,
                  (event) =>
                    setPrepareForm((prev) => ({ ...prev, legalEntityId: event.target.value })),
                  true
                )}
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Prepare Note
                <input
                  value={prepareForm.note}
                  onChange={(event) => setPrepareForm((prev) => ({ ...prev, note: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  placeholder="Optional note for the checklist refresh"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Period Start
                <input
                  type="date"
                  value={prepareForm.periodStart}
                  onChange={(event) =>
                    setPrepareForm((prev) => ({ ...prev, periodStart: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Period End
                <input
                  type="date"
                  value={prepareForm.periodEnd}
                  onChange={(event) =>
                    setPrepareForm((prev) => ({ ...prev, periodEnd: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  required
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3">
              {buildPrepareLockRows(prepareForm).map((row) => (
                <label
                  key={row.key}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                    checked={row.checked}
                    onChange={(event) =>
                      setPrepareForm((prev) => ({
                        ...prev,
                        [row.key]: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{row.label}</span>
                    <span className="mt-1 block text-xs text-slate-500">{row.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!canPrepare || busy === "prepare"}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "prepare" ? "Preparing..." : "Prepare Checklist"}
              </button>
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    legalEntityId: prepareForm.legalEntityId || prev.legalEntityId,
                    periodStart: prepareForm.periodStart || prev.periodStart,
                    periodEnd: prepareForm.periodEnd || prev.periodEnd,
                  }))
                }
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Copy To Filters
              </button>
            </div>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Close Controls</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Scan current periods quickly, then select one control to inspect blockers and actions.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {rows.length}
              </span>
            </div>

            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void loadList();
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Legal Entity
                  {renderLegalEntityField(
                    filters.legalEntityId,
                    (event) => setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
                  )}
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Status
                  <select
                    value={filters.status}
                    onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">All statuses</option>
                    <option value="DRAFT">Draft</option>
                    <option value="READY">Ready</option>
                    <option value="REQUESTED">Requested</option>
                    <option value="CLOSED">Closed</option>
                    <option value="REOPENED">Reopened</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Period Start
                  <input
                    type="date"
                    value={filters.periodStart}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, periodStart: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Period End
                  <input
                    type="date"
                    value={filters.periodEnd}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, periodEnd: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={!canRead || listLoading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {listLoading ? "Loading..." : "Apply Filters"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cleared = {
                      legalEntityId: "",
                      status: "",
                      periodStart: "",
                      periodEnd: "",
                    };
                    setFilters(cleared);
                    void loadList(cleared);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </form>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Draft / Ready
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {listSummary.draft} / {listSummary.ready}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Requested / Closed
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {listSummary.requested} / {listSummary.closed}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {rows.map((row) => {
                const rowStatusUi = getCloseStatusUi(row.status);
                const rowEntity = buildEntityLabel(row, entityMap);
                const progress = buildChecklistProgress(row);
                const isSelected = toPositiveInt(row.id) === toPositiveInt(selectedCloseId);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedCloseId(row.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? "border-sky-300 bg-sky-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{rowEntity.primary}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${rowStatusUi.badgeClass}`}
                          >
                            {rowStatusUi.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{rowEntity.secondary}</div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <div>Close #{row.id}</div>
                        <div>
                          {formatDate(row.period_start)} to {formatDate(row.period_end)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>
                            {progress.passed}/{progress.total} checks passing
                          </span>
                          <span>{progress.percent}%</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-200">
                          <div
                            className={`h-2 rounded-full bg-gradient-to-r ${rowStatusUi.accentClass}`}
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-slate-600">
                        fail={progress.failed} warn={progress.warnings}
                      </div>
                    </div>
                  </button>
                );
              })}
   
              {rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                  No close controls matched the current filters.
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {!selectedClose ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">No Close Selected</h2>
              <p className="mt-2 text-sm text-slate-600">
                Choose a close control from the list or prepare a new checklist to see status, blockers,
                lifecycle history, and close actions.
              </p>
            </div>
          ) : (
            <>
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className={`bg-gradient-to-r ${selectedCloseStatusUi.accentClass} px-5 py-5 text-white`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                        Payroll Close Snapshot
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {selectedCloseEntity.primary}
                      </h2>
                      <p className="mt-1 text-sm text-white/85">
                        {formatDate(selectedClose.period_start)} to {formatDate(selectedClose.period_end)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                        {selectedCloseStatusUi.label}
                      </span>
                      <div className="mt-2 text-sm text-white/80">Close #{selectedClose.id}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-5 px-5 py-5">
                  <div className={`rounded-2xl border px-4 py-4 ${readinessCallout.toneClass}`}>
                    <div className="text-sm font-semibold">{readinessCallout.title}</div>
                    <div className="mt-1 text-sm">{readinessCallout.description}</div>
                    {selectedCloseLifecycleMeta?.description ? (
                      <div className="mt-2 text-xs opacity-80">
                        Current lifecycle meaning: {selectedCloseLifecycleMeta.description}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Checks Passing
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {selectedCloseProgress.passed}/{selectedCloseProgress.total}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {selectedCloseProgress.percent}% checklist completion
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Blocking Errors
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {failingErrorChecks.length}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        Error-severity failed checks that block close progression
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Warning Checks
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">
                        {Number(selectedClose.warning_checks || 0)}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">Warnings to review before final close approval</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Next Allowed Actions
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedCloseLifecycleActionLabels.length > 0 ? (
                          selectedCloseLifecycleActionLabels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                            >
                              {label}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-600">No further lifecycle action</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Active Locks
                      </div>
                      {selectedLockRows.map((row) => (
                        <span
                          key={row.key}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getLockBadgeClass(
                            row.enabled
                          )}`}
                        >
                          {row.label}: {row.enabled ? "On" : "Off"}
                        </span>
                      ))}
                    </div>
                    {selectedActorMoments.length > 0 ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {selectedActorMoments.map((row) => (
                          <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {row.label}
                            </div>
                            <div className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(row.at)}</div>
                            <div className="mt-1 text-xs text-slate-500">{row.actor || "-"}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
                <StatusTimeline
                  title="Payroll Close Lifecycle Timeline"
                  steps={selectedCloseLifecycleTimeline}
                  emptyText="No lifecycle history available for this close control yet."
                />

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Action Center</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    The current status decides which action should be emphasized. Disabled actions show why.
                  </p>

                  <div className="mt-4 grid gap-4">
                    <div
                      className={`rounded-2xl border p-4 ${
                        availableActionSet.has("request")
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">Request Close</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Use once checklist blockers are clear and lock choices are final.
                      </p>
                      <textarea
                        rows={3}
                        value={requestForm.note}
                        onChange={(event) => setRequestForm((prev) => ({ ...prev, note: event.target.value }))}
                        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Optional request note"
                      />
                      <input
                        value={requestForm.requestIdempotencyKey}
                        onChange={(event) =>
                          setRequestForm((prev) => ({
                            ...prev,
                            requestIdempotencyKey: event.target.value,
                          }))
                        }
                        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Optional request idempotency key"
                      />
                      {requestDisabledReason ? (
                        <p className="mt-3 text-xs text-slate-500">{requestDisabledReason}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleRequest}
                        disabled={Boolean(requestDisabledReason) || busy === "request"}
                        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy === "request" ? "Working..." : "Request Close"}
                      </button>
                    </div>

                    <div
                      className={`rounded-2xl border p-4 ${
                        availableActionSet.has("approveClose")
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">Approve & Close</div>
                      <p className="mt-1 text-sm text-slate-600">
                        This is the second-person approval step that actually closes the payroll period.
                      </p>
                      <textarea
                        rows={3}
                        value={approveForm.note}
                        onChange={(event) => setApproveForm((prev) => ({ ...prev, note: event.target.value }))}
                        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Optional approval note"
                      />
                      <input
                        value={approveForm.closeIdempotencyKey}
                        onChange={(event) =>
                          setApproveForm((prev) => ({
                            ...prev,
                            closeIdempotencyKey: event.target.value,
                          }))
                        }
                        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Optional close idempotency key"
                      />
                      {approveDisabledReason ? (
                        <p className="mt-3 text-xs text-slate-500">{approveDisabledReason}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleApprove}
                        disabled={Boolean(approveDisabledReason) || busy === "approve"}
                        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy === "approve" ? "Working..." : "Approve & Close"}
                      </button>
                    </div>

                    <div
                      className={`rounded-2xl border p-4 ${
                        availableActionSet.has("reopen")
                          ? "border-violet-200 bg-violet-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">Reopen</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Reopen only when a controlled correction is needed and the audit reason is explicit.
                      </p>
                      <textarea
                        rows={3}
                        value={reopenForm.reason}
                        onChange={(event) => setReopenForm((prev) => ({ ...prev, reason: event.target.value }))}
                        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Reason for reopen (required)"
                      />
                      {reopenDisabledReason ? (
                        <p className="mt-3 text-xs text-slate-500">{reopenDisabledReason}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleReopen}
                        disabled={Boolean(reopenDisabledReason) || busy === "reopen"}
                        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy === "reopen" ? "Working..." : "Reopen Period"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Checklist Results</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Failed items stay at the top so operators can see blockers before passing rows.
                      </p>
                    </div>
                    <span className="text-sm text-slate-500">{sortedChecklistRows.length}</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {sortedChecklistRows.map((check) => (
                      <div
                        key={check.id || check.check_code}
                        className={`rounded-2xl border p-4 ${
                          toUpper(check?.status) === "FAIL"
                            ? "border-rose-200 bg-rose-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {check.check_name || check.check_code || "Checklist item"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{check.check_code || "-"}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getCheckSeverityClass(
                                check.severity
                              )}`}
                            >
                              {check.severity || "INFO"}
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getCheckStatusClass(
                                check.status
                              )}`}
                            >
                              {check.status || "-"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                            Metric: <span className="font-semibold text-slate-900">{check.metric_value ?? "-"}</span>
                          </div>
                          <div className="text-sm text-slate-700">{check.metric_text || "No detail text."}</div>
                        </div>
                      </div>
                    ))}
   
                    {sortedChecklistRows.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                        No checklist rows were returned for this close control.
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Audit Trail</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Most recent events first, including who acted and any note left behind.
                      </p>
                    </div>
                    <span className="text-sm text-slate-500">{sortedAuditRows.length}</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {sortedAuditRows.map((row) => (
                      <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{row.action || "-"}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.acted_by_user_id ? `User #${row.acted_by_user_id}` : "Unknown actor"}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500">{formatDateTime(row.acted_at)}</div>
                        </div>
                        <div className="mt-3 text-sm text-slate-700">{row.note || "No note provided."}</div>
                      </div>
                    ))}
   
                    {sortedAuditRows.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                        No audit rows yet.
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
