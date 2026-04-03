
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createBankApprovalPolicy,
  listBankApprovalPolicies,
  updateBankApprovalPolicy,
} from "../../api/bankApprovalPolicies.js";
import {
  approveBankApprovalRequest,
  getBankApprovalRequest,
  listBankApprovalRequests,
  rejectBankApprovalRequest,
} from "../../api/bankApprovalRequests.js";
import {
  approveApprovalRequest as approveUnifiedApprovalRequest,
  getApprovalRequestDelegationPreview,
  rejectApprovalRequest as rejectUnifiedApprovalRequest,
} from "../../api/approvalDelegations.js";
import { useAuth } from "../../auth/useAuth.js";
import ApprovalActionDialog from "../../components/approval/ApprovalActionDialog.jsx";
import {
  buildApprovalDelegationActionNotice,
  buildApprovalDelegationDrawerNotice,
} from "../../components/approval/approvalDelegationUi.js";
import ApprovalExecutionStatusBadge from "../../components/approval/ApprovalExecutionStatusBadge.jsx";
import ApprovalRequestDrawer from "../../components/approval/ApprovalRequestDrawer.jsx";
import ApprovalRequestStatusBadge from "../../components/approval/ApprovalRequestStatusBadge.jsx";
import {
  getApprovalExecutionStatusMeta,
  isApprovalRequestEscalated,
} from "../../components/approval/approvalUi.js";

const ESCALATION_TARGET_SCOPE_MODE_OPTIONS = [
  "REQUEST_SCOPE",
  "REQUEST_SCOPE_PARENT",
  "ASSIGNMENT_SCOPE",
  "ASSIGNMENT_SCOPE_PARENT",
  "CUSTOM",
];
function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}
function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function boolFromInput(value) {
  return value === true || String(value).trim().toLowerCase() === "true";
}
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}
function formatDecisionLabel(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) {
    return "Decision";
  }
  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
function formatEscalationTargetMode(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) {
    return "Current request scope";
  }
  switch (normalized) {
    case "REQUEST_SCOPE":
      return "Current request scope";
    case "REQUEST_SCOPE_PARENT":
      return "Parent of request scope";
    case "ASSIGNMENT_SCOPE":
      return "Assignment scope";
    case "ASSIGNMENT_SCOPE_PARENT":
      return "Parent of assignment scope";
    case "CUSTOM":
      return "Custom escalation scope";
    default:
      return normalized
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}
function buildPolicyEscalationLabel(policy) {
  const escalationAfterHours = toPositiveInt(
    policy?.escalation_after_hours ?? policy?.escalationAfterHours
  );
  if (!escalationAfterHours) {
    return "No escalation";
  }
  const targetMode = formatEscalationTargetMode(
    policy?.escalation_target_scope_mode ?? policy?.escalationTargetScopeMode
  );
  const maxCount = toPositiveInt(policy?.escalation_max_count ?? policy?.escalationMaxCount);
  return `${escalationAfterHours}h -> ${targetMode}${maxCount ? ` (max ${maxCount})` : ""}`;
}
function buildApprovalTimelineItems(row) {
  if (!row) {
    return [];
  }
  const approvalRequest = row.approvalRequest || null;
  const reviewStatus = normalizeStatus(
    approvalRequest?.requestStatus || row?.request_status
  );
  const executionStatus = normalizeStatus(
    approvalRequest?.executionStatus || row?.execution_status
  );
  const timelineItems = [];
  timelineItems.push({
    key: "submitted",
    label: "Submitted for Review",
    description: "The approval request entered the queue.",
    at: approvalRequest?.submittedAt || row?.created_at || row?.submitted_at,
    actor: row?.requested_by_user_id ? `User #${row.requested_by_user_id}` : "",
    note: approvalRequest?.requestCode || row?.request_code || "",
    state: "done",
  });
  if (isApprovalRequestEscalated(reviewStatus)) {
    timelineItems.push({
      key: "escalated",
      label: "Escalated",
      description: "The request stayed in the same review queue and was escalated for urgent attention.",
      at:
        approvalRequest?.lastEscalatedAt ||
        approvalRequest?.lastActivityAt ||
        approvalRequest?.updatedAt ||
        row?.updated_at,
      actor: "",
      note:
        approvalRequest?.escalationCount > 0
          ? `Escalation #${approvalRequest.escalationCount}`
          : approvalRequest?.currentStepNo
            ? `Current step ${approvalRequest.currentStepNo}`
            : "Urgent reviewer follow-up",
      state: "attention",
      tone: "attention",
    });
  }
  const decisions = Array.isArray(row?.decisions) ? row.decisions : [];
  decisions.forEach((decision, index) => {
    const normalizedDecision = normalizeStatus(decision?.decision);
    timelineItems.push({
      key: `decision-${decision?.id || index}`,
      label: formatDecisionLabel(normalizedDecision),
      description:
        normalizedDecision === "APPROVE"
          ? "A reviewer recorded an approval decision."
          : normalizedDecision === "REJECT"
            ? "A reviewer rejected the request."
            : "A review decision was recorded.",
      at: decision?.decided_at,
      actor: decision?.decided_by_user_id ? `User #${decision.decided_by_user_id}` : "",
      note: decision?.comment || "",
      state: normalizedDecision === "REJECT" ? "done" : "done",
    });
  });
  if (reviewStatus === "PENDING_REVIEW" || reviewStatus === "PENDING" || reviewStatus === "ESCALATED") {
    timelineItems.push({
      key: "awaiting-review",
      label: isApprovalRequestEscalated(reviewStatus) ? "Escalated Review" : "Awaiting Review",
      description: isApprovalRequestEscalated(reviewStatus)
        ? "Escalated requests stay reviewable in the normal queue."
        : "A reviewer still needs to record a decision.",
      at: null,
      actor: "",
      note:
        approvalRequest?.currentStepNo != null
          ? `Current step ${approvalRequest.currentStepNo}`
          : "Pending reviewer action",
      state: isApprovalRequestEscalated(reviewStatus) ? "attention" : "current",
      tone: isApprovalRequestEscalated(reviewStatus) ? "attention" : "",
    });
  }
  if (reviewStatus === "APPROVED") {
    timelineItems.push({
      key: "approved",
      label: "Approved",
      description: "The review stage reached final approval.",
      at: approvalRequest?.approvedAt || row?.approved_at,
      actor: "",
      note:
        executionStatus === "NOT_EXECUTED" || executionStatus === "FAILED"
          ? getApprovalExecutionStatusMeta(executionStatus).label
          : "",
      state: executionStatus === "EXECUTED" ? "done" : "current",
    });
  }
  if (reviewStatus === "REJECTED") {
    timelineItems.push({
      key: "rejected",
      label: "Rejected",
      description: "The approval request was rejected.",
      at: approvalRequest?.rejectedAt || row?.updated_at,
      actor: "",
      note: decisions.find((decision) => normalizeStatus(decision?.decision) === "REJECT")?.comment || "",
      state: "done",
    });
  }
  if (reviewStatus === "WITHDRAWN" || reviewStatus === "CANCELLED") {
    timelineItems.push({
      key: "withdrawn",
      label: "Withdrawn",
      description: "The request was withdrawn before execution.",
      at: approvalRequest?.withdrawnAt || row?.updated_at,
      actor: "",
      note: "",
      state: "done",
    });
  }
  if (executionStatus === "EXECUTED") {
    timelineItems.push({
      key: "executed",
      label: "Executed",
      description: "The approved bank action was executed.",
      at: approvalRequest?.executedAt || row?.executed_at,
      actor: approvalRequest?.executedByUserId ? `User #${approvalRequest.executedByUserId}` : "",
      note: "",
      state: "done",
    });
  }
  if (executionStatus === "FAILED") {
    timelineItems.push({
      key: "execution-failed",
      label: "Execution Failed",
      description: "The review completed, but execution failed.",
      at: approvalRequest?.updatedAt || row?.updated_at,
      actor: "",
      note: approvalRequest?.executionErrorText || row?.execution_error_text || "",
      state: "attention",
      tone: "attention",
    });
  }
  return timelineItems.filter(Boolean);
}
function buildRequestSummaryItems(row) {
  if (!row) {
    return [];
  }
  const approvalRequest = row.approvalRequest || null;
  return [
    {
      key: "scope",
      label: "Scope",
      value: row.scope_type || row.target_type || "-",
      helperText: `LE ${row.legal_entity_id || "-"} | Bank ${row.bank_account_id || "-"}`,
    },
    {
      key: "target",
      label: "Target",
      value: `${row.target_type || "-"} / ${row.action_type || "-"}`,
      helperText: `Target #${row.target_id || "-"}`,
    },
    {
      key: "threshold",
      label: "Threshold",
      value: `${row.currency_code || "*"} ${formatAmount(row.threshold_amount)}`,
      helperText: row.policy_name || row.policy_code || "",
    },
    {
      key: "review-step",
      label: "Review Step",
      value:
        approvalRequest?.currentStepNo != null
          ? `Step ${approvalRequest.currentStepNo}`
          : "Legacy queue shape",
      helperText: approvalRequest?.requestCode || row.request_code || "",
    },
    {
      key: "votes",
      label: "Vote Summary",
      value: `Approve ${row.approvals_granted || row.approve_count || 0} / Reject ${row.rejections_granted || row.reject_count || 0}`,
      helperText:
        approvalRequest?.escalationCount > 0
          ? `Escalated ${approvalRequest.escalationCount} time(s)`
          : "No escalation event recorded yet",
    },
    {
      key: "submitted",
      label: "Submitted",
      value: formatDateTime(approvalRequest?.submittedAt || row.submitted_at),
      helperText: approvalRequest?.lastActivityAt
        ? `Last activity ${formatDateTime(approvalRequest.lastActivityAt)}`
        : "",
    },
  ];
}
function buildStatusNotice(row) {
  const reviewStatus = normalizeStatus(
    row?.approvalRequest?.requestStatus || row?.request_status
  );
  if (!isApprovalRequestEscalated(reviewStatus)) {
    return null;
  }
  return {
    tone: "attention",
    title: "Escalated but still actionable",
    description:
      "This request has been escalated for urgency. It stays in the same pending queue and can still be approved or rejected here.",
  };
}
function matchesApprovalRequestId(row, approvalRequestId) {
  const normalizedApprovalRequestId = toPositiveInt(approvalRequestId);
  if (!normalizedApprovalRequestId || !row) {
    return false;
  }
  return (
    toPositiveInt(row?.approvalRequest?.id) === normalizedApprovalRequestId ||
    toPositiveInt(row?.generic_request_id) === normalizedApprovalRequestId ||
    toPositiveInt(row?.id) === normalizedApprovalRequestId
  );
}

function canUseDelegatedDecision(preview) {
  return preview?.authorityMode === "DIRECT" || preview?.authorityMode === "DELEGATED";
}

/**
 * Render the bank governance approval compatibility UI, including escalation
 * aware queue treatment and approval policy setup.
 */
export default function BankGovernancePage() {
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canPoliciesRead = hasPermission("bank.approvals.policies.read");
  const canPoliciesCreate = hasPermission("bank.approvals.policies.create");
  const canPoliciesUpdate = hasPermission("bank.approvals.policies.update");
  const canRequestsRead = hasPermission("bank.approvals.requests.read");
  const canRequestsApprove = hasPermission("bank.approvals.requests.approve");
  const canRequestsReject = hasPermission("bank.approvals.requests.reject");
  const [policyFilters, setPolicyFilters] = useState({
    targetType: "",
    actionType: "",
    status: "",
    q: "",
  });
  const [policies, setPolicies] = useState([]);
  const [policiesTotal, setPoliciesTotal] = useState(0);
  const [requests, setRequests] = useState([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeRequestRow, setActiveRequestRow] = useState(null);
  const [requestActionDialog, setRequestActionDialog] = useState(null);
  const [requestActionError, setRequestActionError] = useState("");
  const [delegationPreview, setDelegationPreview] = useState(null);
  const [delegationPreviewLoading, setDelegationPreviewLoading] = useState(false);
  const [newPolicy, setNewPolicy] = useState({
    policyCode: "",
    policyName: "",
    targetType: "PAYMENT_BATCH",
    actionType: "SUBMIT_EXPORT",
    scopeType: "GLOBAL",
    legalEntityId: "",
    bankAccountId: "",
    currencyCode: "",
    minAmount: "",
    maxAmount: "",
    requiredApprovals: "1",
    makerCheckerRequired: true,
    approverPermissionCode: "bank.approvals.requests.approve.payment",
    autoExecuteOnFinalApproval: true,
    escalationAfterHours: "",
    escalationTargetScopeMode: "",
    escalationMaxCount: "",
  });
  const queuedRows = useMemo(
    () =>
      (Array.isArray(requests) ? requests : []).filter((row) => {
        const reviewStatus = normalizeStatus(
          row?.approvalRequest?.requestStatus || row?.request_status
        );
        return ["PENDING", "PENDING_REVIEW", "ESCALATED"].includes(reviewStatus);
      }),
    [requests]
  );
  const activeTimelineItems = useMemo(
    () => buildApprovalTimelineItems(activeRequestRow),
    [activeRequestRow]
  );
  const activeSummaryItems = useMemo(
    () => buildRequestSummaryItems(activeRequestRow),
    [activeRequestRow]
  );
  const activeStatusNotice = useMemo(
    () => buildStatusNotice(activeRequestRow),
    [activeRequestRow]
  );
  const activeDrawerDelegationNotice = useMemo(
    () => buildApprovalDelegationDrawerNotice(delegationPreview),
    [delegationPreview]
  );
  const activeActionDelegationNotice = useMemo(
    () =>
      buildApprovalDelegationActionNotice(
        delegationPreview,
        requestActionDialog?.actionType === "REJECT" ? "Reject" : "Approve"
      ),
    [delegationPreview, requestActionDialog]
  );
  async function loadPolicies() {
    if (!canPoliciesRead) {
      setPolicies([]);
      setPoliciesTotal(0);
      return;
    }
    setLoadingPolicies(true);
    try {
      const res = await listBankApprovalPolicies({
        limit: 100,
        offset: 0,
        targetType: policyFilters.targetType || undefined,
        actionType: policyFilters.actionType || undefined,
        status: policyFilters.status || undefined,
        q: policyFilters.q || undefined,
      });
      setPolicies(Array.isArray(res?.rows) ? res.rows : []);
      setPoliciesTotal(Number(res?.total || 0));
    } catch (err) {
      setPolicies([]);
      setPoliciesTotal(0);
      setError(err?.response?.data?.message || "B09 policy listesi yuklenemedi");
    } finally {
      setLoadingPolicies(false);
    }
  }
  async function loadRequests() {
    if (!canRequestsRead) {
      setRequests([]);
      setRequestsTotal(0);
      return;
    }
    setLoadingRequests(true);
    try {
      const res = await listBankApprovalRequests({
        limit: 100,
        offset: 0,
      });
      setRequests(Array.isArray(res?.rows) ? res.rows : []);
      setRequestsTotal(Number(res?.total || 0));
    } catch (err) {
      setRequests([]);
      setRequestsTotal(0);
      setError(err?.response?.data?.message || "B09 onay kuyrugu yuklenemedi");
    } finally {
      setLoadingRequests(false);
    }
  }
  async function reloadAll() {
    setError("");
    await Promise.all([loadPolicies(), loadRequests()]);
  }
  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPoliciesRead, canRequestsRead]);
  useEffect(() => {
    const requestedApprovalRequestId = searchParams.get("approvalRequestId");
    if (!requestedApprovalRequestId || !queuedRows.length || loadingRequests) {
      return;
    }
    const match = queuedRows.find((row) =>
      matchesApprovalRequestId(row, requestedApprovalRequestId)
    );
    if (!match) {
      return;
    }
    if (
      matchesApprovalRequestId(activeRequestRow, requestedApprovalRequestId) &&
      activeRequestRow
    ) {
      return;
    }
    openRequestDrawer(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedRows, searchParams, loadingRequests]);
  useEffect(() => {
    const approvalRequestId = toPositiveInt(activeRequestRow?.approvalRequest?.id);
    if (!approvalRequestId) {
      setDelegationPreview(null);
      setDelegationPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setDelegationPreviewLoading(true);
    getApprovalRequestDelegationPreview(approvalRequestId)
      .then((response) => {
        if (!cancelled) {
          setDelegationPreview(response?.row || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDelegationPreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDelegationPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRequestRow]);
  async function handleCreatePolicy() {
    if (!canPoliciesCreate) return;
    setBusy("create-policy");
    setError("");
    setMessage("");
    try {
      const payload = {
        ...newPolicy,
        legalEntityId: newPolicy.legalEntityId ? Number(newPolicy.legalEntityId) : undefined,
        bankAccountId: newPolicy.bankAccountId ? Number(newPolicy.bankAccountId) : undefined,
        currencyCode: newPolicy.currencyCode || undefined,
        minAmount: newPolicy.minAmount === "" ? undefined : Number(newPolicy.minAmount),
        maxAmount: newPolicy.maxAmount === "" ? undefined : Number(newPolicy.maxAmount),
        requiredApprovals: Number(newPolicy.requiredApprovals || 1),
        makerCheckerRequired: Boolean(newPolicy.makerCheckerRequired),
        autoExecuteOnFinalApproval: Boolean(newPolicy.autoExecuteOnFinalApproval),
        escalationAfterHours:
          newPolicy.escalationAfterHours === ""
            ? undefined
            : Number(newPolicy.escalationAfterHours),
        escalationTargetScopeMode: newPolicy.escalationTargetScopeMode || undefined,
        escalationMaxCount:
          newPolicy.escalationMaxCount === ""
            ? undefined
            : Number(newPolicy.escalationMaxCount),
      };
      await createBankApprovalPolicy(payload);
      setMessage("B09 policy olusturuldu");
      await loadPolicies();
    } catch (err) {
      setError(err?.response?.data?.message || "B09 policy olusturulamadi");
    } finally {
      setBusy("");
    }
  }
  async function handleTogglePolicyStatus(policy) {
    if (!canPoliciesUpdate) return;
    const nextStatus = String(policy?.status || "").toUpperCase() === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusy(`policy-status-${policy.id}`);
    setError("");
    setMessage("");
    try {
      await updateBankApprovalPolicy(policy.id, { status: nextStatus });
      setMessage(`Policy #${policy.id} -> ${nextStatus}`);
      await loadPolicies();
    } catch (err) {
      setError(err?.response?.data?.message || "Policy guncellenemedi");
    } finally {
      setBusy("");
    }
  }
  async function openRequestDrawer(row) {
    const requestId = toPositiveInt(row?.id);
    if (!requestId) {
      return;
    }
    setBusy(`request-detail-${requestId}`);
    setRequestActionError("");
    setActiveRequestRow(row);
    try {
      const res = await getBankApprovalRequest(requestId);
      setActiveRequestRow(res?.row || row);
      if (toPositiveInt(res?.row?.approvalRequest?.id)) {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set("approvalRequestId", String(res.row.approvalRequest.id));
        setSearchParams(nextSearchParams, { replace: true });
      }
    } catch (err) {
      setActiveRequestRow(row);
      setRequestActionError(err?.response?.data?.message || "Talep detayi yuklenemedi");
    } finally {
      setBusy("");
    }
  }
  function closeRequestDrawer() {
    setActiveRequestRow(null);
    setRequestActionDialog(null);
    setRequestActionError("");
    setDelegationPreview(null);
    setDelegationPreviewLoading(false);
    if (searchParams.get("approvalRequestId")) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("approvalRequestId");
      setSearchParams(nextSearchParams, { replace: true });
    }
  }
  function openDecisionDialog(actionType, row) {
    const requestId = toPositiveInt(row?.id);
    if (!requestId) {
      return;
    }
    setRequestActionError("");
    setRequestActionDialog({
      actionType,
      requestId,
      approvalRequestId: toPositiveInt(row?.approvalRequest?.id) || null,
    });
  }
  async function handleConfirmDecision(comment) {
    if (!requestActionDialog?.requestId) {
      return;
    }
    const requestId = requestActionDialog.requestId;
    const approvalRequestId = toPositiveInt(requestActionDialog.approvalRequestId);
    const actionType = requestActionDialog.actionType;
    setBusy(`${actionType.toLowerCase()}-${requestId}`);
    setRequestActionError("");
    setError("");
    setMessage("");
    try {
      if (actionType === "APPROVE") {
        const res = approvalRequestId
          ? await approveUnifiedApprovalRequest(approvalRequestId, {
              decisionComment: comment || "",
            })
          : await approveBankApprovalRequest(requestId, {
              decisionComment: comment || "",
            });
        setMessage(
          `Talep #${requestId} onaylandi (${res?.item?.request_status || "APPROVED"})`
        );
      } else {
        if (approvalRequestId) {
          await rejectUnifiedApprovalRequest(approvalRequestId, {
            decisionComment: comment || "",
          });
        } else {
          await rejectBankApprovalRequest(requestId, {
            decisionComment: comment || "",
          });
        }
        setMessage(`Talep #${requestId} reddedildi`);
      }
      const refreshed = await getBankApprovalRequest(requestId);
      setActiveRequestRow(refreshed?.row || null);
      setRequestActionDialog(null);
      await loadRequests();
    } catch (err) {
      setRequestActionError(err?.response?.data?.message || "Karar kaydedilemedi");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="space-y-4 p-4">
      <div className="rounded border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Banka Onaylari (B09)</h1>
          <button
            type="button"
            className="ml-auto rounded border px-3 py-1 text-sm"
            onClick={reloadAll}
            disabled={loadingPolicies || loadingRequests || busy !== ""}
          >
            Yenile
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Banka islemleri icin governance katmani: policy, escalation ayarlari ve approval queue ayni ekranda yonetilir.
        </p>
        {error ? (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {!canPoliciesRead && !canRequestsRead ? (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Missing permissions: <code>bank.approvals.policies.read</code> /{" "}
            <code>bank.approvals.requests.read</code>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-medium">Policy Listesi</h2>
            <span className="text-xs text-slate-500">Toplam: {policiesTotal}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="targetType"
              value={policyFilters.targetType}
              onChange={(e) => setPolicyFilters((p) => ({ ...p, targetType: e.target.value }))}
            />
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="actionType"
              value={policyFilters.actionType}
              onChange={(e) => setPolicyFilters((p) => ({ ...p, actionType: e.target.value }))}
            />
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="status"
              value={policyFilters.status}
              onChange={(e) => setPolicyFilters((p) => ({ ...p, status: e.target.value }))}
            />
            <div className="flex gap-2">
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                placeholder="Ara"
                value={policyFilters.q}
                onChange={(e) => setPolicyFilters((p) => ({ ...p, q: e.target.value }))}
              />
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                disabled={loadingPolicies || !canPoliciesRead}
                onClick={loadPolicies}
              >
                Ara
              </button>
            </div>
          </div>
          <div className="mt-3 max-h-[360px] overflow-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1">Target/Action</th>
                  <th className="px-2 py-1">Scope</th>
                  <th className="px-2 py-1">Threshold</th>
                  <th className="px-2 py-1">Escalation</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingPolicies ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={7}>
                      Yukleniyor...
                    </td>
                  </tr>
                ) : policies.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={7}>
                      Policy kaydi yok.
                    </td>
                  </tr>
                ) : (
                  policies.map((row) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-2 py-1">
                        <div className="font-medium">{row.policy_code}</div>
                        <div className="text-xs text-slate-500">#{row.id}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div>{row.target_type}</div>
                        <div className="text-xs text-slate-500">{row.action_type}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div>{row.scope_type}</div>
                        <div className="text-xs text-slate-500">
                          LE:{row.legal_entity_id || "-"} BA:{row.bank_account_id || "-"}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="text-xs">
                          {row.currency_code || "*"} {formatAmount(row.min_amount)} -{" "}
                          {formatAmount(row.max_amount)}
                        </div>
                        <div className="text-xs text-slate-500">
                          approvals={row.required_approvals} |{" "}
                          {boolFromInput(row.maker_checker_required) ? "maker-checker" : "self review allowed"}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="text-xs font-medium text-slate-700">
                          {buildPolicyEscalationLabel(row)}
                        </div>
                        {row.approver_permission_code ? (
                          <div className="text-[11px] text-slate-500">
                            {row.approver_permission_code}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1">
                        <span className="rounded border px-1 text-xs">{row.status}</span>
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5 text-xs"
                          disabled={!canPoliciesUpdate || busy === `policy-status-${row.id}`}
                          onClick={() => handleTogglePolicyStatus(row)}
                        >
                          {busy === `policy-status-${row.id}`
                            ? "..."
                            : row.status === "ACTIVE"
                              ? "Pause"
                              : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded border bg-white p-4">
          <h2 className="mb-2 font-medium">Policy Olustur (B09)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Escalated requests kalmaya devam eder; burada sadece kac saat sonra ve hangi kapsama gore escalation olacagini ayarlarsiniz.
          </p>
          {canPoliciesCreate ? (
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="policyCode"
                value={newPolicy.policyCode}
                onChange={(e) => setNewPolicy((p) => ({ ...p, policyCode: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="policyName"
                value={newPolicy.policyName}
                onChange={(e) => setNewPolicy((p) => ({ ...p, policyName: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="targetType (PAYMENT_BATCH / RECON_RULE ...)"
                value={newPolicy.targetType}
                onChange={(e) => setNewPolicy((p) => ({ ...p, targetType: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="actionType (SUBMIT_EXPORT / CREATE / UPDATE ...)"
                value={newPolicy.actionType}
                onChange={(e) => setNewPolicy((p) => ({ ...p, actionType: e.target.value }))}
              />
              <select
                className="rounded border px-2 py-1 text-sm"
                value={newPolicy.scopeType}
                onChange={(e) => setNewPolicy((p) => ({ ...p, scopeType: e.target.value }))}
              >
                <option value="GLOBAL">GLOBAL</option>
                <option value="LEGAL_ENTITY">LEGAL_ENTITY</option>
                <option value="BANK_ACCOUNT">BANK_ACCOUNT</option>
              </select>
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                min={1}
                placeholder="legalEntityId (opsiyonel)"
                value={newPolicy.legalEntityId}
                onChange={(e) => setNewPolicy((p) => ({ ...p, legalEntityId: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                min={1}
                placeholder="bankAccountId (opsiyonel)"
                value={newPolicy.bankAccountId}
                onChange={(e) => setNewPolicy((p) => ({ ...p, bankAccountId: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="currencyCode (opsiyonel)"
                value={newPolicy.currencyCode}
                onChange={(e) => setNewPolicy((p) => ({ ...p, currencyCode: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                placeholder="minAmount (opsiyonel)"
                value={newPolicy.minAmount}
                onChange={(e) => setNewPolicy((p) => ({ ...p, minAmount: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                placeholder="maxAmount (opsiyonel)"
                value={newPolicy.maxAmount}
                onChange={(e) => setNewPolicy((p) => ({ ...p, maxAmount: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                min={1}
                placeholder="requiredApprovals"
                value={newPolicy.requiredApprovals}
                onChange={(e) => setNewPolicy((p) => ({ ...p, requiredApprovals: e.target.value }))}
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                placeholder="approverPermissionCode"
                value={newPolicy.approverPermissionCode}
                onChange={(e) =>
                  setNewPolicy((p) => ({ ...p, approverPermissionCode: e.target.value }))
                }
              />
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                min={1}
                placeholder="escalationAfterHours (opsiyonel)"
                value={newPolicy.escalationAfterHours}
                onChange={(e) =>
                  setNewPolicy((p) => ({ ...p, escalationAfterHours: e.target.value }))
                }
              />
              <select
                className="rounded border px-2 py-1 text-sm"
                value={newPolicy.escalationTargetScopeMode}
                onChange={(e) =>
                  setNewPolicy((p) => ({ ...p, escalationTargetScopeMode: e.target.value }))
                }
              >
                <option value="">escalationTargetScopeMode (opsiyonel)</option>
                {ESCALATION_TARGET_SCOPE_MODE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                className="rounded border px-2 py-1 text-sm"
                type="number"
                min={1}
                placeholder="escalationMaxCount (opsiyonel)"
                value={newPolicy.escalationMaxCount}
                onChange={(e) =>
                  setNewPolicy((p) => ({ ...p, escalationMaxCount: e.target.value }))
                }
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(newPolicy.makerCheckerRequired)}
                  onChange={(e) =>
                    setNewPolicy((p) => ({ ...p, makerCheckerRequired: e.target.checked }))
                  }
                />
                Maker-checker zorunlu
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(newPolicy.autoExecuteOnFinalApproval)}
                  onChange={(e) =>
                    setNewPolicy((p) => ({ ...p, autoExecuteOnFinalApproval: e.target.checked }))
                  }
                />
                Final onayda auto execute
              </label>
              <div className="md:col-span-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Escalation target scope mode bos birakilirsa mevcut request scope kullanilir. Max count bos birakilirsa varsayilan tek escalation uygulanir.
              </div>
              <div className="md:col-span-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  disabled={busy === "create-policy"}
                  onClick={handleCreatePolicy}
                >
                  {busy === "create-policy" ? "Olusturuluyor..." : "Policy Olustur"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              Missing permission: <code>bank.approvals.policies.create</code>
            </div>
          )}
        </section>
      </div>
      <section className="rounded border bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-medium">Onay Kuyrugu (Pending + Escalated)</h2>
          <span className="text-xs text-slate-500">Toplam: {requestsTotal}</span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Escalated talepler ayri bir kuyruga tasinmaz; ayni pending listede daha yuksek oncelik vurgusuyla gorunur.
        </p>
        {!canRequestsRead ? (
          <div className="text-sm text-slate-500">
            Missing permission: <code>bank.approvals.requests.read</code>
          </div>
        ) : loadingRequests ? (
          <div className="text-sm text-slate-500">Yukleniyor...</div>
        ) : queuedRows.length === 0 ? (
          <div className="text-sm text-slate-500">Pending talep yok.</div>
        ) : (
          <div className="space-y-3">
            {queuedRows.map((row) => {
              const approvalRequest = row.approvalRequest || null;
              const reviewStatus = approvalRequest?.requestStatus || row.request_status;
              const escalated = isApprovalRequestEscalated(reviewStatus);
              return (
                <div
                  key={row.id}
                  className={`rounded border p-3 text-sm ${
                    escalated
                      ? "border-amber-300 bg-amber-50/60 shadow-sm"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">
                      {approvalRequest?.requestCode || row.request_code || `Request #${row.id}`}
                    </div>
                    <ApprovalRequestStatusBadge status={reviewStatus} />
                    <ApprovalExecutionStatusBadge
                      status={approvalRequest?.executionStatus || row.execution_status}
                    />
                    <span className="rounded border px-1 text-xs">
                      {row.target_type}/{row.action_type}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">
                      {formatDateTime(approvalRequest?.submittedAt || row.submitted_at)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                    <div>
                      Target: #{row.target_id || "-"} | LE:{row.legal_entity_id || "-"} | BA:
                      {row.bank_account_id || "-"}
                    </div>
                    <div>
                      Threshold: {row.currency_code || "*"} {formatAmount(row.threshold_amount)}
                    </div>
                    <div>
                      Votes: approve {row.approve_count || 0} / reject {row.reject_count || 0}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                      {approvalRequest?.currentStepNo != null
                        ? `Current step ${approvalRequest.currentStepNo}`
                        : "Legacy queue shape"}
                    </span>
                    {escalated ? (
                      <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 font-semibold text-amber-900">
                        Urgent review: still actionable in this queue
                      </span>
                    ) : null}
                    {approvalRequest?.escalationCount > 0 ? (
                      <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-800">
                        Escalated {approvalRequest.escalationCount} time(s)
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      disabled={busy !== ""}
                      onClick={() => openRequestDrawer(row)}
                    >
                      {row.approvalRequest?.id || canRequestsApprove || canRequestsReject
                        ? "Open Review"
                        : "View"}
                    </button>
                    {(canRequestsApprove || canRequestsReject) &&
                    ["PENDING", "PENDING_REVIEW", "ESCALATED"].includes(normalizeStatus(reviewStatus)) ? (
                      <>
                        <button
                          type="button"
                          className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          disabled={!canRequestsApprove || busy === `approve-${row.id}`}
                          onClick={() => openDecisionDialog("APPROVE", row)}
                        >
                          {busy === `approve-${row.id}` ? "Onay..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          disabled={!canRequestsReject || busy === `reject-${row.id}`}
                          onClick={() => openDecisionDialog("REJECT", row)}
                        >
                          {busy === `reject-${row.id}` ? "Red..." : "Reject"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {activeRequestRow ? (
        <ApprovalRequestDrawer
          open={Boolean(activeRequestRow)}
          onClose={closeRequestDrawer}
          title="Bank Approval Review"
          subtitle={`${activeRequestRow.target_type || "-"} / ${activeRequestRow.action_type || "-"}`}
          requestCode={
            activeRequestRow.approvalRequest?.requestCode ||
            activeRequestRow.request_code ||
            `Request #${activeRequestRow.id}`
          }
          requestStatus={
            activeRequestRow.approvalRequest?.requestStatus || activeRequestRow.request_status
          }
          executionStatus={
            activeRequestRow.approvalRequest?.executionStatus || activeRequestRow.execution_status
          }
          summaryItems={activeSummaryItems}
          timelineItems={activeTimelineItems}
          timelineTitle="Decision & Escalation History"
          statusNotice={activeStatusNotice}
          actions={
            ["PENDING", "PENDING_REVIEW", "ESCALATED"].includes(
              normalizeStatus(
                activeRequestRow.approvalRequest?.requestStatus ||
                  activeRequestRow.request_status
              )
            )
              ? [
                  {
                    key: "approve",
                    label: "Approve",
                    tone: "approve",
                    busy: busy === `approve-${activeRequestRow.id}`,
                    busyLabel: "Approving...",
                    disabled:
                      !(canRequestsApprove || canUseDelegatedDecision(delegationPreview)) ||
                      busy !== "",
                    description:
                      canUseDelegatedDecision(delegationPreview) &&
                      !canRequestsApprove &&
                      activeActionDelegationNotice?.description
                        ? activeActionDelegationNotice.description
                        : canRequestsApprove
                          ? "Record an approval decision for this request."
                          : "Missing permission: bank.approvals.requests.approve",
                    onClick: () => openDecisionDialog("APPROVE", activeRequestRow),
                  },
                  {
                    key: "reject",
                    label: "Reject",
                    tone: "reject",
                    busy: busy === `reject-${activeRequestRow.id}`,
                    busyLabel: "Rejecting...",
                    disabled:
                      !(canRequestsReject || canUseDelegatedDecision(delegationPreview)) ||
                      busy !== "",
                    description:
                      canUseDelegatedDecision(delegationPreview) &&
                      !canRequestsReject &&
                      activeActionDelegationNotice?.description
                        ? activeActionDelegationNotice.description
                        : canRequestsReject
                          ? "Reject the request and keep the target unchanged."
                          : "Missing permission: bank.approvals.requests.reject",
                    onClick: () => openDecisionDialog("REJECT", activeRequestRow),
                  },
                ]
              : []
          }
        >
          {delegationPreviewLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Checking approval authority for this request...
            </div>
          ) : activeDrawerDelegationNotice ? (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
              <div className="font-semibold">{activeDrawerDelegationNotice.title}</div>
              <p className="mt-1">{activeDrawerDelegationNotice.description}</p>
            </div>
          ) : null}
          {requestActionError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {requestActionError}
            </div>
          ) : null}
          {activeRequestRow.approvalRequest?.executionErrorText ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <div className="font-semibold text-rose-900">Execution Error</div>
              <p className="mt-2">{activeRequestRow.approvalRequest.executionErrorText}</p>
            </div>
          ) : null}
          {!activeRequestRow.approvalRequest ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              This row still uses the legacy compatibility shape, so detailed escalation and execution history may be limited.
            </div>
          ) : null}
        </ApprovalRequestDrawer>
      ) : null}
      <ApprovalActionDialog
        key={
          requestActionDialog
            ? `${requestActionDialog.actionType}-${requestActionDialog.requestId}`
            : "bank-request-action-closed"
        }
        open={Boolean(requestActionDialog)}
        title={
          requestActionDialog?.actionType === "APPROVE"
            ? "Approve Bank Request"
            : "Reject Bank Request"
        }
        description={
          requestActionDialog?.actionType === "APPROVE"
            ? "Escalated items remain fully reviewable. Record the approval comment if needed."
            : "Reject the request and keep the underlying bank target unchanged."
        }
        commentLabel={
          requestActionDialog?.actionType === "APPROVE" ? "Review note" : "Rejection reason"
        }
        commentPlaceholder={
          requestActionDialog?.actionType === "APPROVE"
            ? "Optional reviewer note"
            : "Optional rejection reason"
        }
        confirmLabel={requestActionDialog?.actionType === "APPROVE" ? "Approve" : "Reject"}
        confirmBusyLabel={
          requestActionDialog?.actionType === "APPROVE" ? "Approving..." : "Rejecting..."
        }
        confirmTone={requestActionDialog?.actionType === "APPROVE" ? "approve" : "reject"}
        authorityNotice={activeActionDelegationNotice}
        submitting={Boolean(busy && requestActionDialog)}
        error={requestActionError}
        onClose={() => setRequestActionDialog(null)}
        onConfirm={handleConfirmDecision}
      />
    </div>
  );
}
