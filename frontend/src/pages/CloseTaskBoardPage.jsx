import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Ban,
  Check,
  Download,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldOff,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { listCloseManagerCycles } from "../api/closeCycles.js";
import {
  approveCloseTask,
  attachCloseTaskEvidence,
  cancelCloseTask,
  createCloseTask,
  createCloseTaskComment,
  createCloseTaskEvidenceDraft,
  deleteCloseTaskComment,
  downloadCloseTaskEvidence,
  getCloseTask,
  listCloseTaskComments,
  listCloseTaskEvents,
  listCloseTaskEvidence,
  listCloseTasks,
  refreshCloseTaskSourceCheck,
  removeCloseTaskEvidence,
  reopenCloseTask,
  returnCloseTask,
  startCloseTask,
  submitCloseTask,
  updateCloseTask,
  uploadCloseTaskEvidenceContent,
  waiveCloseTask,
} from "../api/closeTasks.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";

const TASK_STATUSES = Object.freeze([
  "ALL",
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "WAIVED",
  "CANCELLED",
]);
const TASK_FAMILIES = Object.freeze([
  "",
  "RECONCILIATION",
  "SUBLEDGER",
  "PAYROLL",
  "INVENTORY",
  "FIXED_ASSET",
  "TAX",
  "FX",
  "INTERCOMPANY",
  "REPORTING",
  "CERTIFICATION",
  "MANUAL",
]);
const RBAC_SCOPE_TYPES = Object.freeze(["", "OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"]);
const WORK_SCOPE_TYPES = Object.freeze([
  "",
  "CYCLE",
  "BOOK",
  "CENTRAL",
  "OPERATING_UNIT",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_GROUP",
]);
const COMPLETION_MODES = Object.freeze([
  "MANUAL",
  "MANUAL_WITH_EVIDENCE",
  "SYSTEM_CHECK",
  "SOURCE_STATUS",
  "HYBRID_REVIEW",
]);
const DUE_STATES = Object.freeze(["", "OVERDUE"]);
const TERMINAL_TASK_STATUSES = new Set(["APPROVED", "WAIVED", "CANCELLED"]);
const SOURCE_CHECK_REFRESH_MODES = new Set(["SYSTEM_CHECK", "SOURCE_STATUS", "HYBRID_REVIEW"]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function toDisplayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text ? text.replaceAll("_", " ") : fallback;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function toDateTimeLocalInput(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getApiErrorMessage(error, fallback) {
  return (
    error?.normalizedError?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function getDownloadFileName(headers, fallback = "evidence.bin") {
  const disposition = headers?.["content-disposition"] || headers?.["Content-Disposition"] || "";
  const quotedMatch = String(disposition).match(/filename="([^"]+)"/i);
  const bareMatch = String(disposition).match(/filename=([^;]+)/i);
  const rawName = quotedMatch?.[1] || bareMatch?.[1] || fallback;
  try {
    return decodeURIComponent(String(rawName).trim().replace(/^UTF-8''/i, "")) || fallback;
  } catch {
    return fallback;
  }
}

function getCurrentUserId(user) {
  return toPositiveInt(user?.id ?? user?.userId ?? user?.user_id);
}

function buildCycleLabel(row, l) {
  const typeLabel = toDisplayText(row?.cycleType || row?.cycle_type, "Cycle");
  const scopeKind = toUpperText(row?.scopeKind || row?.scope_kind);
  const scopeLabel =
    scopeKind === "CONSOLIDATION_GROUP"
      ? l("Group", "Grup")
      : l("Legal entity", "Sirket");
  const scopeId =
    scopeKind === "CONSOLIDATION_GROUP"
      ? row?.consolidationGroupId || row?.consolidation_group_id
      : row?.legalEntityId || row?.legal_entity_id;
  return `${typeLabel} / ${scopeLabel} #${scopeId || "-"} / ${row?.status || "-"}`;
}

function buildScopeLabel(type, id, key) {
  const normalizedKey = String(key || "").trim();
  if (normalizedKey) {
    return normalizedKey;
  }
  const normalizedType = String(type || "").trim();
  return normalizedType ? `${normalizedType}${id ? `:${id}` : ""}` : "-";
}

function getTaskStatusTone(status) {
  switch (toUpperText(status)) {
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "SUBMITTED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "IN_PROGRESS":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "RETURNED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "WAIVED":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "CANCELLED":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function getTaskStatusLabel(status, l) {
  switch (toUpperText(status)) {
    case "NOT_STARTED":
      return l("Not started", "Baslamadi");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    case "SUBMITTED":
      return l("Submitted", "Gonderildi");
    case "RETURNED":
      return l("Returned", "Iade edildi");
    case "APPROVED":
      return l("Approved", "Onaylandi");
    case "WAIVED":
      return l("Waived", "Feragat edildi");
    case "CANCELLED":
      return l("Cancelled", "Iptal edildi");
    default:
      return status || "-";
  }
}

function renderStatusPill(status, l) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getTaskStatusTone(
        status,
      )}`}
    >
      <span className="truncate">{getTaskStatusLabel(status, l)}</span>
    </span>
  );
}

function emptyManualTaskForm(cycleId = "") {
  return {
    closeCycleId: cycleId ? String(cycleId) : "",
    taskCode: "MANUAL_CLOSE_TASK",
    taskName: "",
    taskDescription: "",
    taskFamily: "MANUAL",
    completionMode: "MANUAL",
    rbacScopeType: "LEGAL_ENTITY",
    rbacScopeId: "",
    workScopeType: "CYCLE",
    workScopeId: "",
    ownerUserId: "",
    reviewerUserId: "",
    dueAt: "",
    evidenceRequired: false,
    requiredForCycleLock: false,
    blockerClass: "",
  };
}

function buildTaskPatchPayload(form) {
  return {
    taskName: form.taskName,
    taskDescription: form.taskDescription,
    ownerUserId: toPositiveInt(form.ownerUserId),
    reviewerUserId: toPositiveInt(form.reviewerUserId),
    dueAt: toIsoOrNull(form.dueAt),
    evidenceRequired: Boolean(form.evidenceRequired),
    requiredForCycleLock: Boolean(form.requiredForCycleLock),
    blockerClass: form.blockerClass || null,
  };
}

function buildManualTaskPayload(form) {
  return {
    taskCode: form.taskCode || "MANUAL_CLOSE_TASK",
    taskName: form.taskName,
    taskDescription: form.taskDescription || null,
    taskFamily: form.taskFamily || "MANUAL",
    completionMode: form.completionMode || "MANUAL",
    rbacScopeType: form.rbacScopeType,
    rbacScopeId: toPositiveInt(form.rbacScopeId),
    workScopeType: form.workScopeType || "CYCLE",
    workScopeId: toPositiveInt(form.workScopeId),
    ownerUserId: toPositiveInt(form.ownerUserId),
    reviewerUserId: toPositiveInt(form.reviewerUserId),
    dueAt: toIsoOrNull(form.dueAt),
    evidenceRequired: Boolean(form.evidenceRequired),
    requiredForCycleLock: Boolean(form.requiredForCycleLock),
    blockerClass: form.blockerClass || null,
  };
}

function IconButton({ icon: Icon, children, disabled, title, className = "", ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

function FieldLabel({ children }) {
  return <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</label>;
}

/**
 * Render the close checklist operations board for owners, reviewers, waiver
 * authorities, and task administrators.
 */
export default function CloseTaskBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, user } = useAuth();
  const { l } = useI18n();
  const currentUserId = getCurrentUserId(user);

  const canReadTasks = hasPermission("close.task.read");
  const canCreateTasks = hasPermission("close.task.create");
  const canAssignTasks = hasPermission("close.task.assign") || hasPermission("close.task.admin");
  const canWorkTasks = hasPermission("close.task.work");
  const canReviewTasks = hasPermission("close.task.review");
  const canWaiveTasks = hasPermission("close.task.waive");
  const canAdminTasks = hasPermission("close.task.admin");

  const selectedCycleId = toPositiveInt(searchParams.get("cycleId"));
  const selectedTaskId = toPositiveInt(searchParams.get("taskId"));
  const statusFilter = TASK_STATUSES.includes(toUpperText(searchParams.get("status")))
    ? toUpperText(searchParams.get("status"))
    : "ALL";
  const dueStateFilter = DUE_STATES.includes(toUpperText(searchParams.get("dueState")))
    ? toUpperText(searchParams.get("dueState"))
    : "";
  const evidenceMissingFilter = searchParams.get("evidenceMissing") === "true";
  const queryFilter = String(searchParams.get("q") || "");
  const taskFamilyFilter = String(searchParams.get("taskFamily") || "");
  const rbacScopeTypeFilter = String(searchParams.get("rbacScopeType") || "");
  const rbacScopeIdFilter = String(searchParams.get("rbacScopeId") || "");
  const workScopeTypeFilter = String(searchParams.get("workScopeType") || "");
  const workScopeIdFilter = String(searchParams.get("workScopeId") || "");
  const ownerUserIdFilter = String(searchParams.get("ownerUserId") || "");
  const reviewerUserIdFilter = String(searchParams.get("reviewerUserId") || "");

  const [cycles, setCycles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [commentRows, setCommentRows] = useState([]);
  const [eventRows, setEventRows] = useState([]);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [detailNonce, setDetailNonce] = useState(0);
  const [manualForm, setManualForm] = useState(() => emptyManualTaskForm(searchParams.get("cycleId") || ""));
  const [editForm, setEditForm] = useState(() => emptyManualTaskForm());
  const [reason, setReason] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [newEvidenceFile, setNewEvidenceFile] = useState(null);
  const [newEvidenceDisplayName, setNewEvidenceDisplayName] = useState("");
  const [newEvidenceNote, setNewEvidenceNote] = useState("");
  const [evidenceObjectId, setEvidenceObjectId] = useState("");
  const [removeEvidenceReason, setRemoveEvidenceReason] = useState("");
  const [uploadFilesByEvidenceId, setUploadFilesByEvidenceId] = useState({});
  const [busyAction, setBusyAction] = useState("");

  const selectedCycle = useMemo(
    () => cycles.find((row) => toPositiveInt(row?.id) === selectedCycleId) || null,
    [cycles, selectedCycleId],
  );

  const selectedTaskCycleOpen = toUpperText(selectedTask?.cycleStatus) === "OPEN";
  const selectedTaskStatus = toUpperText(selectedTask?.status);
  const selectedTaskTerminal = TERMINAL_TASK_STATUSES.has(selectedTaskStatus);
  const selectedTaskEvidenceMissing =
    Boolean(selectedTask?.evidenceRequired) &&
    !["WAIVED", "CANCELLED"].includes(selectedTaskStatus) &&
    evidenceRows.filter((row) => toUpperText(row?.status) === "ACTIVE").length === 0;
  const isSelectedOwner = currentUserId && currentUserId === toPositiveInt(selectedTask?.ownerUserId);
  const isSelectedReviewer =
    currentUserId && currentUserId === toPositiveInt(selectedTask?.reviewerUserId);
  const canWorkSelected =
    Boolean(selectedTask) &&
    selectedTaskCycleOpen &&
    !selectedTaskTerminal &&
    (canAdminTasks || (canWorkTasks && isSelectedOwner));
  const canReviewSelected =
    Boolean(selectedTask) &&
    selectedTaskCycleOpen &&
    !selectedTaskTerminal &&
    (canAdminTasks || (canReviewTasks && isSelectedReviewer));
  const canWaiveSelected =
    Boolean(selectedTask) &&
    selectedTaskCycleOpen &&
    !selectedTaskTerminal &&
    canWaiveTasks;
  const canEditSelected = Boolean(selectedTask) && selectedTaskCycleOpen && canAssignTasks;
  const canRefreshSourceCheck =
    Boolean(selectedTask) &&
    selectedTaskCycleOpen &&
    SOURCE_CHECK_REFRESH_MODES.has(toUpperText(selectedTask?.completionMode)) &&
    canWorkSelected;
  const submitDisabledReason = selectedTaskEvidenceMissing
    ? l("Evidence is required before submit.", "Gondermeden once kanit gerekli.")
    : !canWorkSelected
      ? l("Owner or task admin authority is required.", "Sahip veya gorev admin yetkisi gerekli.")
      : "";
  const reasonMissing = !String(reason || "").trim();

  const updateFilter = useCallback(
    (key, value) => {
      const nextParams = new URLSearchParams(searchParams);
      const normalized = value === undefined || value === null ? "" : String(value);
      if (!normalized || normalized === "ALL") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, normalized);
      }
      if (key !== "taskId") {
        nextParams.delete("taskId");
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const selectTask = useCallback(
    (taskId) => {
      updateFilter("taskId", taskId || "");
    },
    [updateFilter],
  );

  const refreshAll = useCallback(() => {
    setReloadNonce((value) => value + 1);
    setDetailNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    setManualForm((prev) => ({
      ...prev,
      closeCycleId: selectedCycleId ? String(selectedCycleId) : prev.closeCycleId,
    }));
  }, [selectedCycleId]);

  useEffect(() => {
    if (!canReadTasks) {
      return;
    }
    let cancelled = false;
    async function loadCycles() {
      setLoadingCycles(true);
      try {
        const response = await listCloseManagerCycles({ limit: 200 });
        if (!cancelled) {
          setCycles(response?.rows || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, l("Close cycles could not be loaded.", "Kapanis donguleri yuklenemedi.")));
        }
      } finally {
        if (!cancelled) {
          setLoadingCycles(false);
        }
      }
    }
    loadCycles();
    return () => {
      cancelled = true;
    };
  }, [canReadTasks, l, reloadNonce]);

  useEffect(() => {
    if (!canReadTasks) {
      return;
    }
    let cancelled = false;
    async function loadTasks() {
      setLoadingTasks(true);
      setError("");
      try {
        const response = await listCloseTasks({
          closeCycleId: selectedCycleId || undefined,
          status: statusFilter === "ALL" ? undefined : statusFilter,
          taskFamily: taskFamilyFilter || undefined,
          rbacScopeType: rbacScopeTypeFilter || undefined,
          rbacScopeId: toPositiveInt(rbacScopeIdFilter) || undefined,
          workScopeType: workScopeTypeFilter || undefined,
          workScopeId: toPositiveInt(workScopeIdFilter) || undefined,
          ownerUserId: toPositiveInt(ownerUserIdFilter) || undefined,
          reviewerUserId: toPositiveInt(reviewerUserIdFilter) || undefined,
          dueState: dueStateFilter || undefined,
          evidenceMissing: evidenceMissingFilter ? true : undefined,
          q: queryFilter || undefined,
          limit: 200,
        });
        if (!cancelled) {
          const rows = response?.rows || [];
          setTasks(rows);
          if (selectedTaskId && !rows.some((row) => toPositiveInt(row?.id) === selectedTaskId)) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("taskId");
            setSearchParams(nextParams, { replace: true });
          } else if (!selectedTaskId && rows.length > 0) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set("taskId", String(rows[0].id));
            setSearchParams(nextParams, { replace: true });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, l("Close tasks could not be loaded.", "Kapanis gorevleri yuklenemedi.")));
        }
      } finally {
        if (!cancelled) {
          setLoadingTasks(false);
        }
      }
    }
    loadTasks();
    return () => {
      cancelled = true;
    };
  }, [
    canReadTasks,
    dueStateFilter,
    evidenceMissingFilter,
    l,
    ownerUserIdFilter,
    queryFilter,
    rbacScopeIdFilter,
    rbacScopeTypeFilter,
    reloadNonce,
    reviewerUserIdFilter,
    searchParams,
    selectedCycleId,
    selectedTaskId,
    setSearchParams,
    statusFilter,
    taskFamilyFilter,
    workScopeIdFilter,
    workScopeTypeFilter,
  ]);

  useEffect(() => {
    if (!canReadTasks || !selectedTaskId) {
      setSelectedTask(null);
      setEvidenceRows([]);
      setCommentRows([]);
      setEventRows([]);
      return;
    }
    let cancelled = false;
    async function loadDetail() {
      setLoadingDetail(true);
      try {
        const [taskResponse, evidenceResponse, commentsResponse, eventsResponse] = await Promise.all([
          getCloseTask(selectedTaskId),
          listCloseTaskEvidence(selectedTaskId),
          listCloseTaskComments(selectedTaskId),
          listCloseTaskEvents(selectedTaskId),
        ]);
        if (cancelled) {
          return;
        }
        const row = taskResponse?.row || null;
        setSelectedTask(row);
        setEvidenceRows(evidenceResponse?.rows || []);
        setCommentRows(commentsResponse?.rows || []);
        setEventRows(eventsResponse?.rows || []);
        if (row) {
          setEditForm({
            ...emptyManualTaskForm(row.closeCycleId),
            taskCode: row.taskCode || "MANUAL_CLOSE_TASK",
            taskName: row.taskName || "",
            taskDescription: row.taskDescription || "",
            taskFamily: row.taskFamily || "MANUAL",
            completionMode: row.completionMode || "MANUAL",
            rbacScopeType: row.rbacScopeType || "LEGAL_ENTITY",
            rbacScopeId: row.rbacScopeId ? String(row.rbacScopeId) : "",
            workScopeType: row.workScopeType || "CYCLE",
            workScopeId: row.workScopeId ? String(row.workScopeId) : "",
            ownerUserId: row.ownerUserId ? String(row.ownerUserId) : "",
            reviewerUserId: row.reviewerUserId ? String(row.reviewerUserId) : "",
            dueAt: toDateTimeLocalInput(row.dueAt),
            evidenceRequired: Boolean(row.evidenceRequired),
            requiredForCycleLock: Boolean(row.requiredForCycleLock),
            blockerClass: row.blockerClass || "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, l("Task detail could not be loaded.", "Gorev detayi yuklenemedi.")));
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [canReadTasks, detailNonce, l, selectedTaskId]);

  async function handleCreateManualTask(event) {
    event.preventDefault();
    const cycleId = toPositiveInt(manualForm.closeCycleId);
    if (!cycleId || !manualForm.taskName.trim() || !toPositiveInt(manualForm.rbacScopeId)) {
      setError(l("Cycle, task name, and RBAC scope id are required.", "Dongu, gorev adi ve RBAC kapsam id gerekli."));
      return;
    }
    setBusyAction("create");
    setError("");
    setMessage("");
    try {
      const response = await createCloseTask(cycleId, buildManualTaskPayload(manualForm));
      const taskId = response?.row?.id;
      setMessage(l("Task created.", "Gorev olusturuldu."));
      setManualForm(emptyManualTaskForm(cycleId));
      refreshAll();
      if (taskId) {
        selectTask(taskId);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, l("Task could not be created.", "Gorev olusturulamadi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveSelectedTask() {
    if (!selectedTask?.id) {
      return;
    }
    setBusyAction("save");
    setError("");
    setMessage("");
    try {
      const response = await updateCloseTask(selectedTask.id, buildTaskPatchPayload(editForm));
      setSelectedTask(response?.row || selectedTask);
      setMessage(l("Task assignment updated.", "Gorev atamasi guncellendi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Task could not be updated.", "Gorev guncellenemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleLifecycle(actionName, runner, options = {}) {
    if (!selectedTask?.id) {
      return;
    }
    if (options.requireReason && reasonMissing) {
      setError(l("Reason is required for this action.", "Bu aksiyon icin neden gerekli."));
      return;
    }
    setBusyAction(actionName);
    setError("");
    setMessage("");
    try {
      const response = await runner(selectedTask.id, {
        reason: options.includeReason === false ? undefined : reason || undefined,
      });
      setSelectedTask(response?.row || selectedTask);
      setReason("");
      setMessage(options.successMessage || l("Task updated.", "Gorev guncellendi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Task action failed.", "Gorev aksiyonu basarisiz.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleAttachEvidence(event) {
    event.preventDefault();
    if (!selectedTask?.id || !toPositiveInt(evidenceObjectId)) {
      setError(l("Evidence object id is required.", "Kanit nesnesi id gerekli."));
      return;
    }
    setBusyAction("attachEvidence");
    setError("");
    setMessage("");
    try {
      await attachCloseTaskEvidence(selectedTask.id, {
        evidenceObjectId: toPositiveInt(evidenceObjectId),
      });
      setEvidenceObjectId("");
      setMessage(l("Evidence attached.", "Kanit baglandi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Evidence could not be attached.", "Kanit baglanamadi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateEvidenceDraft(event) {
    event.preventDefault();
    if (!selectedTask?.id || !newEvidenceFile) {
      setError(l("Select a file to upload.", "Yuklenecek dosya secin."));
      return;
    }
    setBusyAction("createEvidenceDraft");
    setError("");
    setMessage("");
    try {
      const draft = await createCloseTaskEvidenceDraft(selectedTask.id, {
        fileName: newEvidenceFile.name,
        displayName: newEvidenceDisplayName || newEvidenceFile.name,
        note: newEvidenceNote || undefined,
        contentType: newEvidenceFile.type || "application/octet-stream",
      });
      const evidenceId = draft?.row?.evidenceObjectId;
      if (!evidenceId) {
        throw new Error(l("Evidence draft was not returned.", "Kanit taslagi donmedi."));
      }
      await uploadCloseTaskEvidenceContent(selectedTask.id, evidenceId, newEvidenceFile, {
        contentType: newEvidenceFile.type || "application/octet-stream",
      });
      setNewEvidenceFile(null);
      setNewEvidenceDisplayName("");
      setNewEvidenceNote("");
      setMessage(l("Evidence file uploaded.", "Kanit dosyasi yuklendi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Evidence file could not be uploaded.", "Kanit dosyasi yuklenemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleRemoveEvidence(evidenceId) {
    if (!selectedTask?.id || !evidenceId) {
      return;
    }
    setBusyAction(`removeEvidence:${evidenceId}`);
    setError("");
    setMessage("");
    try {
      await removeCloseTaskEvidence(selectedTask.id, evidenceId, {
        reason: removeEvidenceReason || undefined,
      });
      setRemoveEvidenceReason("");
      setMessage(l("Evidence removed.", "Kanit kaldirildi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Evidence could not be removed.", "Kanit kaldirilamadi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleUploadEvidence(evidenceId) {
    if (!selectedTask?.id || !evidenceId) {
      return;
    }
    const key = String(evidenceId);
    const file = uploadFilesByEvidenceId[key];
    if (!file) {
      setError(l("Select a file to upload.", "Yuklenecek dosya secin."));
      return;
    }
    setBusyAction(`uploadEvidence:${evidenceId}`);
    setError("");
    setMessage("");
    try {
      await uploadCloseTaskEvidenceContent(selectedTask.id, evidenceId, file, {
        contentType: file.type || "application/octet-stream",
      });
      setUploadFilesByEvidenceId((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setMessage(l("Evidence file uploaded.", "Kanit dosyasi yuklendi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Evidence file could not be uploaded.", "Kanit dosyasi yuklenemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleDownloadEvidence(evidenceId) {
    if (!selectedTask?.id || !evidenceId) {
      return;
    }
    setBusyAction(`downloadEvidence:${evidenceId}`);
    setError("");
    setMessage("");
    try {
      const response = await downloadCloseTaskEvidence(selectedTask.id, evidenceId);
      const contentType = response?.headers?.["content-type"] || "application/octet-stream";
      const blob = response?.data instanceof Blob ? response.data : new Blob([response?.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = getDownloadFileName(response?.headers);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(getApiErrorMessage(err, l("Evidence file could not be downloaded.", "Kanit dosyasi indirilemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateComment(event) {
    event.preventDefault();
    if (!selectedTask?.id || !commentBody.trim()) {
      return;
    }
    setBusyAction("comment");
    setError("");
    setMessage("");
    try {
      await createCloseTaskComment(selectedTask.id, { body: commentBody });
      setCommentBody("");
      setMessage(l("Comment added.", "Yorum eklendi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Comment could not be added.", "Yorum eklenemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteComment(commentId) {
    if (!selectedTask?.id || !commentId) {
      return;
    }
    setBusyAction(`deleteComment:${commentId}`);
    setError("");
    setMessage("");
    try {
      await deleteCloseTaskComment(selectedTask.id, commentId);
      setMessage(l("Comment deleted.", "Yorum silindi."));
      refreshAll();
    } catch (err) {
      setError(getApiErrorMessage(err, l("Comment could not be deleted.", "Yorum silinemedi.")));
    } finally {
      setBusyAction("");
    }
  }

  if (!canReadTasks) {
    return (
      <div className="p-8">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          {l("Close task access is missing.", "Kapanis gorevi erisimi eksik.")}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Year-end close", "Yilsonu kapanis")}
            </p>
            <h1 className="text-3xl font-semibold text-slate-950">
              {l("Close Checklist Tasks", "Kapanis Kontrol Gorevleri")}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/app/donem-sonu-islemler/yillik/kapanis-gorev-sablonlari"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>{l("Templates", "Sablonlar")}</span>
            </Link>
            <IconButton
              icon={RefreshCw}
              onClick={refreshAll}
              className="border-slate-300 bg-white text-slate-700 shadow-sm"
            >
              {l("Refresh", "Yenile")}
            </IconButton>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <FieldLabel>{l("Cycle", "Dongu")}</FieldLabel>
              <select
                value={selectedCycleId || ""}
                onChange={(event) => updateFilter("cycleId", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">{l("All cycles", "Tum donguler")}</option>
                {cycles.map((row) => (
                  <option key={row.id} value={row.id}>
                    {buildCycleLabel(row, l)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{l("Status", "Durum")}</FieldLabel>
              <select
                value={statusFilter}
                onChange={(event) => updateFilter("status", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === "ALL" ? l("All", "Tumu") : getTaskStatusLabel(status, l)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{l("Family", "Aile")}</FieldLabel>
              <select
                value={taskFamilyFilter}
                onChange={(event) => updateFilter("taskFamily", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {TASK_FAMILIES.map((family) => (
                  <option key={family || "ALL"} value={family}>
                    {family ? toDisplayText(family) : l("All", "Tumu")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{l("Search", "Arama")}</FieldLabel>
              <div className="mt-1 flex rounded-lg border border-slate-300 bg-white">
                <Search className="ml-3 mt-2.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  value={queryFilter}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  className="min-w-0 flex-1 rounded-lg px-2 py-2 text-sm outline-none"
                  placeholder={l("Task code or name", "Gorev kodu veya adi")}
                />
              </div>
            </div>
            <div>
              <FieldLabel>{l("RBAC scope", "RBAC kapsam")}</FieldLabel>
              <select
                value={rbacScopeTypeFilter}
                onChange={(event) => updateFilter("rbacScopeType", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {RBAC_SCOPE_TYPES.map((scopeType) => (
                  <option key={scopeType || "ALL"} value={scopeType}>
                    {scopeType || l("Any", "Herhangi")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{l("RBAC id", "RBAC id")}</FieldLabel>
              <input
                value={rbacScopeIdFilter}
                onChange={(event) => updateFilter("rbacScopeId", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
              />
            </div>
            <div>
              <FieldLabel>{l("Work scope", "Is kapsami")}</FieldLabel>
              <select
                value={workScopeTypeFilter}
                onChange={(event) => updateFilter("workScopeType", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {WORK_SCOPE_TYPES.map((scopeType) => (
                  <option key={scopeType || "ALL"} value={scopeType}>
                    {scopeType || l("Any", "Herhangi")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{l("Work id", "Is id")}</FieldLabel>
              <input
                value={workScopeIdFilter}
                onChange={(event) => updateFilter("workScopeId", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
              />
            </div>
            <div>
              <FieldLabel>{l("Owner", "Sahip")}</FieldLabel>
              <input
                value={ownerUserIdFilter}
                onChange={(event) => updateFilter("ownerUserId", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder={l("User id", "Kullanici id")}
              />
            </div>
            <div>
              <FieldLabel>{l("Reviewer", "Inceleyen")}</FieldLabel>
              <input
                value={reviewerUserIdFilter}
                onChange={(event) => updateFilter("reviewerUserId", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder={l("User id", "Kullanici id")}
              />
            </div>
            <div>
              <FieldLabel>{l("Due", "Vade")}</FieldLabel>
              <select
                value={dueStateFilter}
                onChange={(event) => updateFilter("dueState", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">{l("Any", "Herhangi")}</option>
                <option value="OVERDUE">{l("Overdue", "Gecikti")}</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={evidenceMissingFilter}
                  onChange={(event) => updateFilter("evidenceMissing", event.target.checked ? "true" : "")}
                  className="h-4 w-4"
                />
                <span>{l("Evidence missing", "Kanit eksik")}</span>
              </label>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr),minmax(420px,0.7fr)]">
          <main className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{l("Task board", "Gorev panosu")}</h2>
                  <p className="text-sm text-slate-500">
                    {loadingTasks
                      ? l("Loading tasks...", "Gorevler yukleniyor...")
                      : `${tasks.length} ${l("tasks", "gorev")}`}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="w-[260px] px-4 py-3">{l("Task", "Gorev")}</th>
                      <th className="w-[150px] px-4 py-3">{l("RBAC scope", "RBAC kapsam")}</th>
                      <th className="w-[170px] px-4 py-3">{l("Work scope", "Is kapsami")}</th>
                      <th className="w-[100px] px-4 py-3">{l("Owner", "Sahip")}</th>
                      <th className="w-[110px] px-4 py-3">{l("Reviewer", "Inceleyen")}</th>
                      <th className="w-[145px] px-4 py-3">{l("Due date", "Son tarih")}</th>
                      <th className="w-[120px] px-4 py-3">{l("Status", "Durum")}</th>
                      <th className="w-[125px] px-4 py-3">{l("Evidence", "Kanit")}</th>
                      <th className="w-[145px] px-4 py-3">{l("Blocker", "Blokaj")}</th>
                      <th className="w-[96px] px-4 py-3">{l("Actions", "Aksiyon")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const rowSelected = toPositiveInt(task?.id) === selectedTaskId;
                      const terminal = TERMINAL_TASK_STATUSES.has(toUpperText(task?.status));
                      return (
                        <tr
                          key={task.id}
                          className={`border-b border-slate-100 align-top ${rowSelected ? "bg-cyan-50/60" : "bg-white"}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{task.taskName || "-"}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">{task.taskCode || "-"}</div>
                            <div className="mt-1 text-xs text-slate-500">{toDisplayText(task.taskFamily)}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {buildScopeLabel(task.rbacScopeType, task.rbacScopeId, task.rbacScopeKey)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {buildScopeLabel(task.workScopeType, task.workScopeId, task.workScopeKey)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {task.ownerUserId ? `#${task.ownerUserId}` : "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {task.reviewerUserId ? `#${task.reviewerUserId}` : "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{formatDateTime(task.dueAt)}</td>
                          <td className="px-4 py-3">{renderStatusPill(task.status, l)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            <span className={task.evidenceRequired ? "font-semibold text-amber-700" : ""}>
                              {task.evidenceRequired ? l("Required", "Gerekli") : l("Optional", "Opsiyonel")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="truncate">{task.blockerClass || "-"}</div>
                            {task.requiredForCycleLock ? (
                              <div className="mt-1 text-xs font-semibold text-rose-600">
                                {l("Lock gate", "Kilit gecidi")}
                              </div>
                            ) : null}
                            {terminal ? (
                              <div className="mt-1 text-xs text-slate-500">{l("Resolved", "Cozuldu")}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <IconButton
                              icon={Pencil}
                              onClick={() => selectTask(task.id)}
                              className="w-full border-slate-300 bg-white text-slate-700"
                            >
                              {l("Open", "Ac")}
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingTasks && tasks.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                          {l("No close checklist tasks match the filters.", "Filtrelere uyan kapanis gorevi yok.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {l("Manual task", "Manuel gorev")}
                  </h2>
                </div>
                {selectedCycle ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {buildCycleLabel(selectedCycle, l)}
                  </span>
                ) : null}
              </div>
              <form onSubmit={handleCreateManualTask} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="xl:col-span-2">
                  <FieldLabel>{l("Cycle", "Dongu")}</FieldLabel>
                  <select
                    value={manualForm.closeCycleId}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, closeCycleId: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">{l("Select cycle", "Dongu sec")}</option>
                    {cycles.map((row) => (
                      <option key={row.id} value={row.id}>
                        {buildCycleLabel(row, l)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>{l("Task code", "Gorev kodu")}</FieldLabel>
                  <input
                    value={manualForm.taskCode}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, taskCode: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Task family", "Gorev ailesi")}</FieldLabel>
                  <select
                    value={manualForm.taskFamily}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, taskFamily: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {TASK_FAMILIES.filter(Boolean).map((family) => (
                      <option key={family} value={family}>
                        {toDisplayText(family)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>{l("Task name", "Gorev adi")}</FieldLabel>
                  <input
                    value={manualForm.taskName}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, taskName: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>{l("Description", "Aciklama")}</FieldLabel>
                  <input
                    value={manualForm.taskDescription}
                    onChange={(event) =>
                      setManualForm((prev) => ({ ...prev, taskDescription: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Completion", "Tamamlama")}</FieldLabel>
                  <select
                    value={manualForm.completionMode}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, completionMode: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {COMPLETION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {toDisplayText(mode)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>{l("RBAC scope", "RBAC kapsam")}</FieldLabel>
                  <select
                    value={manualForm.rbacScopeType}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, rbacScopeType: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {RBAC_SCOPE_TYPES.filter(Boolean).map((scopeType) => (
                      <option key={scopeType} value={scopeType}>
                        {scopeType}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>{l("RBAC id", "RBAC id")}</FieldLabel>
                  <input
                    value={manualForm.rbacScopeId}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, rbacScopeId: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Work scope", "Is kapsami")}</FieldLabel>
                  <select
                    value={manualForm.workScopeType}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, workScopeType: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {WORK_SCOPE_TYPES.filter(Boolean).map((scopeType) => (
                      <option key={scopeType} value={scopeType}>
                        {scopeType}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>{l("Work id", "Is id")}</FieldLabel>
                  <input
                    value={manualForm.workScopeId}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, workScopeId: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Owner", "Sahip")}</FieldLabel>
                  <input
                    value={manualForm.ownerUserId}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, ownerUserId: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Reviewer", "Inceleyen")}</FieldLabel>
                  <input
                    value={manualForm.reviewerUserId}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, reviewerUserId: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Due date", "Son tarih")}</FieldLabel>
                  <input
                    type="datetime-local"
                    value={manualForm.dueAt}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, dueAt: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Blocker class", "Blokaj sinifi")}</FieldLabel>
                  <input
                    value={manualForm.blockerClass}
                    onChange={(event) => setManualForm((prev) => ({ ...prev, blockerClass: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3 xl:col-span-2">
                  <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={manualForm.evidenceRequired}
                      onChange={(event) =>
                        setManualForm((prev) => ({ ...prev, evidenceRequired: event.target.checked }))
                      }
                      className="h-4 w-4"
                    />
                    <span>{l("Evidence required", "Kanit gerekli")}</span>
                  </label>
                  <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={manualForm.requiredForCycleLock}
                      onChange={(event) =>
                        setManualForm((prev) => ({ ...prev, requiredForCycleLock: event.target.checked }))
                      }
                      className="h-4 w-4"
                    />
                    <span>{l("Lock-required", "Kilit icin gerekli")}</span>
                  </label>
                </div>
                <div className="flex items-end">
                  <IconButton
                    type="submit"
                    icon={Plus}
                    disabled={!canCreateTasks || busyAction === "create" || loadingCycles}
                    title={!canCreateTasks ? l("Missing close.task.create", "Eksik close.task.create") : ""}
                    className="w-full border-cyan-700 bg-cyan-700 text-white"
                  >
                    {l("Create", "Olustur")}
                  </IconButton>
                </div>
              </form>
            </section>
          </main>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {loadingDetail ? (
                <div className="text-sm text-slate-500">{l("Loading task detail...", "Gorev detayi yukleniyor...")}</div>
              ) : null}
              {!loadingDetail && !selectedTask ? (
                <div className="text-sm text-slate-500">{l("Select a task.", "Gorev secin.")}</div>
              ) : null}
              {selectedTask ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2">{renderStatusPill(selectedTask.status, l)}</div>
                      <h2 className="break-words text-xl font-semibold text-slate-950">
                        {selectedTask.taskName || "-"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">{selectedTask.taskCode || "-"}</p>
                    </div>
                    <IconButton
                      icon={RefreshCw}
                      onClick={() => setDetailNonce((value) => value + 1)}
                      className="border-slate-300 bg-white text-slate-700"
                    >
                      {l("Reload", "Yenile")}
                    </IconButton>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("RBAC scope", "RBAC kapsam")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {buildScopeLabel(selectedTask.rbacScopeType, selectedTask.rbacScopeId, selectedTask.rbacScopeKey)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Work scope", "Is kapsami")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {buildScopeLabel(selectedTask.workScopeType, selectedTask.workScopeId, selectedTask.workScopeKey)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Owner", "Sahip")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedTask.ownerUserId ? `#${selectedTask.ownerUserId}` : "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Reviewer", "Inceleyen")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedTask.reviewerUserId ? `#${selectedTask.reviewerUserId}` : "-"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Due date", "Son tarih")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">{formatDateTime(selectedTask.dueAt)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Source check", "Kaynak kontrolu")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedTask.sourceCheckStatus || selectedTask.sourceCheckCode || "-"}
                      </div>
                    </div>
                  </div>

                  {selectedTask.returnReason ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                      <strong>{l("Return reason", "Iade nedeni")}:</strong> {selectedTask.returnReason}
                    </div>
                  ) : null}
                  {selectedTask.waiverReason ? (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-700">
                      <strong>{l("Waiver reason", "Feragat nedeni")}:</strong> {selectedTask.waiverReason}
                      {selectedTask.waivedByUserId ? ` / #${selectedTask.waivedByUserId}` : ""}
                    </div>
                  ) : null}
                  {selectedTask.cancelReason ? (
                    <div className="rounded-xl border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">
                      <strong>{l("Cancellation reason", "Iptal nedeni")}:</strong> {selectedTask.cancelReason}
                      {selectedTask.cancelledByUserId ? ` / #${selectedTask.cancelledByUserId}` : ""}
                    </div>
                  ) : null}
                  {selectedTaskEvidenceMissing ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                      {l("Evidence is missing for this evidence-required task.", "Kanit gerektiren bu gorevde kanit eksik.")}
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <FieldLabel>{l("Reason", "Neden")}</FieldLabel>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <IconButton
                        icon={Play}
                        disabled={
                          !canWorkSelected ||
                          !["NOT_STARTED", "RETURNED"].includes(selectedTaskStatus) ||
                          busyAction === "start"
                        }
                        title={!canWorkSelected ? l("Owner or admin required", "Sahip veya admin gerekli") : ""}
                        onClick={() =>
                          handleLifecycle("start", startCloseTask, {
                            successMessage: l("Task started.", "Gorev baslatildi."),
                          })
                        }
                        className="border-amber-300 bg-amber-50 text-amber-800"
                      >
                        {l("Start", "Baslat")}
                      </IconButton>
                      <IconButton
                        icon={Send}
                        disabled={
                          !canWorkSelected ||
                          !["NOT_STARTED", "IN_PROGRESS", "RETURNED"].includes(selectedTaskStatus) ||
                          Boolean(submitDisabledReason) ||
                          busyAction === "submit"
                        }
                        title={submitDisabledReason}
                        onClick={() =>
                          handleLifecycle("submit", submitCloseTask, {
                            successMessage: l("Task submitted.", "Gorev gonderildi."),
                          })
                        }
                        className="border-cyan-700 bg-cyan-700 text-white"
                      >
                        {l("Submit", "Gonder")}
                      </IconButton>
                      <IconButton
                        icon={Undo2}
                        disabled={!canReviewSelected || selectedTaskStatus !== "SUBMITTED" || reasonMissing}
                        title={reasonMissing ? l("Reason required", "Neden gerekli") : ""}
                        onClick={() =>
                          handleLifecycle("return", returnCloseTask, {
                            requireReason: true,
                            successMessage: l("Task returned.", "Gorev iade edildi."),
                          })
                        }
                        className="border-rose-300 bg-rose-50 text-rose-700"
                      >
                        {l("Return", "Iade")}
                      </IconButton>
                      <IconButton
                        icon={Check}
                        disabled={!canReviewSelected || selectedTaskStatus !== "SUBMITTED"}
                        onClick={() =>
                          handleLifecycle("approve", approveCloseTask, {
                            successMessage: l("Task approved.", "Gorev onaylandi."),
                          })
                        }
                        className="border-emerald-700 bg-emerald-700 text-white"
                      >
                        {l("Approve", "Onayla")}
                      </IconButton>
                      <IconButton
                        icon={ShieldOff}
                        disabled={!canWaiveSelected || reasonMissing}
                        title={reasonMissing ? l("Reason required", "Neden gerekli") : ""}
                        onClick={() =>
                          handleLifecycle("waive", waiveCloseTask, {
                            requireReason: true,
                            successMessage: l("Task waived.", "Gorev feragat edildi."),
                          })
                        }
                        className="border-violet-300 bg-violet-50 text-violet-700"
                      >
                        {l("Waive", "Feragat")}
                      </IconButton>
                      <IconButton
                        icon={Ban}
                        disabled={!canWorkSelected || reasonMissing}
                        title={reasonMissing ? l("Reason required", "Neden gerekli") : ""}
                        onClick={() =>
                          handleLifecycle("cancel", cancelCloseTask, {
                            requireReason: true,
                            successMessage: l("Task cancelled.", "Gorev iptal edildi."),
                          })
                        }
                        className="border-slate-300 bg-slate-100 text-slate-700"
                      >
                        {l("Cancel", "Iptal")}
                      </IconButton>
                      <IconButton
                        icon={RotateCcw}
                        disabled={!canAdminTasks || !selectedTaskTerminal}
                        onClick={() =>
                          handleLifecycle("reopen", reopenCloseTask, {
                            successMessage: l("Task reopened.", "Gorev yeniden acildi."),
                          })
                        }
                        className="border-slate-300 bg-white text-slate-700"
                      >
                        {l("Reopen", "Yeniden ac")}
                      </IconButton>
                      <IconButton
                        icon={RefreshCw}
                        disabled={!canRefreshSourceCheck}
                        onClick={() =>
                          handleLifecycle("refreshSourceCheck", refreshCloseTaskSourceCheck, {
                            successMessage: l("Source check refreshed.", "Kaynak kontrolu yenilendi."),
                          })
                        }
                        className="border-sky-300 bg-sky-50 text-sky-800"
                      >
                        {l("Source check", "Kaynak kontrolu")}
                      </IconButton>
                    </div>
                    {!selectedTaskCycleOpen ? (
                      <p className="text-xs text-slate-500">
                        {l("Routine task actions require an OPEN close cycle.", "Rutin gorev aksiyonlari OPEN kapanis dongusu gerektirir.")}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-900">{l("Assignment", "Atama")}</h3>
                      <IconButton
                        icon={Save}
                        disabled={!canEditSelected || busyAction === "save"}
                        title={!canEditSelected ? l("Assignment authority is missing.", "Atama yetkisi eksik.") : ""}
                        onClick={handleSaveSelectedTask}
                        className="border-slate-900 bg-slate-900 text-white"
                      >
                        {l("Save", "Kaydet")}
                      </IconButton>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <FieldLabel>{l("Task name", "Gorev adi")}</FieldLabel>
                        <input
                          value={editForm.taskName}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, taskName: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={!canEditSelected}
                        />
                      </div>
                      <div>
                        <FieldLabel>{l("Owner", "Sahip")}</FieldLabel>
                        <input
                          value={editForm.ownerUserId}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, ownerUserId: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={!canEditSelected}
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <FieldLabel>{l("Reviewer", "Inceleyen")}</FieldLabel>
                        <input
                          value={editForm.reviewerUserId}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, reviewerUserId: event.target.value }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={!canEditSelected}
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <FieldLabel>{l("Due date", "Son tarih")}</FieldLabel>
                        <input
                          type="datetime-local"
                          value={editForm.dueAt}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, dueAt: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={!canEditSelected}
                        />
                      </div>
                      <div>
                        <FieldLabel>{l("Blocker class", "Blokaj sinifi")}</FieldLabel>
                        <input
                          value={editForm.blockerClass}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, blockerClass: event.target.value }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          disabled={!canEditSelected}
                        />
                      </div>
                      <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={editForm.evidenceRequired}
                          disabled={!canEditSelected}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, evidenceRequired: event.target.checked }))
                          }
                          className="h-4 w-4"
                        />
                        <span>{l("Evidence required", "Kanit gerekli")}</span>
                      </label>
                      <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={editForm.requiredForCycleLock}
                          disabled={!canEditSelected}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, requiredForCycleLock: event.target.checked }))
                          }
                          className="h-4 w-4"
                        />
                        <span>{l("Lock-required", "Kilit icin gerekli")}</span>
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            {selectedTask ? (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{l("Evidence", "Kanit")}</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {evidenceRows.length}
                    </span>
                  </div>
                  <form onSubmit={handleCreateEvidenceDraft} className="mb-4 grid gap-3 lg:grid-cols-4">
                    <div>
                      <FieldLabel>{l("File", "Dosya")}</FieldLabel>
                      <input
                        key={newEvidenceFile ? "new-evidence-selected" : "new-evidence-empty"}
                        type="file"
                        onChange={(event) => setNewEvidenceFile(event.target.files?.[0] || null)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        disabled={!canWorkSelected}
                      />
                    </div>
                    <div>
                      <FieldLabel>{l("Display name", "Gorunen ad")}</FieldLabel>
                      <input
                        value={newEvidenceDisplayName}
                        onChange={(event) => setNewEvidenceDisplayName(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={newEvidenceFile?.name || ""}
                      />
                    </div>
                    <div>
                      <FieldLabel>{l("Note", "Not")}</FieldLabel>
                      <input
                        value={newEvidenceNote}
                        onChange={(event) => setNewEvidenceNote(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex items-end">
                      <IconButton
                        type="submit"
                        icon={Upload}
                        disabled={!canWorkSelected || !newEvidenceFile || busyAction === "createEvidenceDraft"}
                        className="w-full border-slate-900 bg-slate-900 text-white"
                      >
                        {l("Create & upload", "Olustur ve yukle")}
                      </IconButton>
                    </div>
                  </form>
                  <form onSubmit={handleAttachEvidence} className="mb-4 flex gap-2">
                    <input
                      value={evidenceObjectId}
                      onChange={(event) => setEvidenceObjectId(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      inputMode="numeric"
                      placeholder={l("Existing task evidence id", "Mevcut gorev kanit id")}
                    />
                    <IconButton
                      type="submit"
                      icon={Paperclip}
                      disabled={!canWorkSelected || busyAction === "attachEvidence"}
                      className="border-slate-900 bg-slate-900 text-white"
                    >
                      {l("Attach", "Bagla")}
                    </IconButton>
                  </form>
                  <input
                    value={removeEvidenceReason}
                    onChange={(event) => setRemoveEvidenceReason(event.target.value)}
                    className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={l("Remove reason", "Kaldirma nedeni")}
                  />
                  <div className="space-y-3">
                    {evidenceRows.map((row) => {
                      const evidenceActionId = row?.evidenceObjectId || row?.id;
                      const uploadKey = String(evidenceActionId || "");
                      const selectedFile = uploadFilesByEvidenceId[uploadKey];
                      const isActiveEvidence = toUpperText(row?.status) === "ACTIVE";
                      const isUploadedEvidence =
                        isActiveEvidence && toUpperText(row?.evidence?.status) === "ACTIVE" && row?.evidence?.uploadedAt;
                      return (
                        <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-900">
                                {row?.evidence?.displayName || row?.evidence?.fileName || `#${row.evidenceObjectId}`}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {row.status || "-"} / {formatDateTime(row.attachedAt)}
                              </div>
                              {row?.evidence?.fileSizeBytes ? (
                                <div className="mt-1 text-xs text-slate-500">
                                  {row.evidence.fileSizeBytes.toLocaleString()} bytes
                                </div>
                              ) : null}
                              {selectedFile ? (
                                <div className="mt-2 max-w-sm truncate text-xs font-medium text-slate-600">
                                  {selectedFile.name}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span className="truncate">{l("Choose", "Sec")}</span>
                                <input
                                  type="file"
                                  className="sr-only"
                                  disabled={!canWorkSelected || !isActiveEvidence}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0] || null;
                                    setUploadFilesByEvidenceId((prev) => {
                                      const next = { ...prev };
                                      if (file) {
                                        next[uploadKey] = file;
                                      } else {
                                        delete next[uploadKey];
                                      }
                                      return next;
                                    });
                                  }}
                                />
                              </label>
                              <IconButton
                                icon={Upload}
                                disabled={
                                  !canWorkSelected ||
                                  !isActiveEvidence ||
                                  !selectedFile ||
                                  busyAction === `uploadEvidence:${evidenceActionId}`
                                }
                                onClick={() => handleUploadEvidence(evidenceActionId)}
                                className="border-slate-900 bg-slate-900 text-white"
                              >
                                {l("Upload", "Yukle")}
                              </IconButton>
                              <IconButton
                                icon={Download}
                                disabled={!isUploadedEvidence || busyAction === `downloadEvidence:${evidenceActionId}`}
                                onClick={() => handleDownloadEvidence(evidenceActionId)}
                                className="border-slate-300 bg-white text-slate-700"
                              >
                                {l("Download", "Indir")}
                              </IconButton>
                              <IconButton
                                icon={Trash2}
                                disabled={
                                  !canWorkSelected ||
                                  !isActiveEvidence ||
                                  busyAction === `removeEvidence:${evidenceActionId}`
                                }
                                onClick={() => handleRemoveEvidence(evidenceActionId)}
                                className="border-rose-300 bg-rose-50 text-rose-700"
                              >
                                {l("Remove", "Kaldir")}
                              </IconButton>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {evidenceRows.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        {l("No evidence is linked.", "Bagli kanit yok.")}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{l("Comments", "Yorumlar")}</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {commentRows.length}
                    </span>
                  </div>
                  <form onSubmit={handleCreateComment} className="mb-4 space-y-2">
                    <textarea
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <IconButton
                      type="submit"
                      icon={MessageSquarePlus}
                      disabled={!canWorkSelected || !commentBody.trim() || busyAction === "comment"}
                      className="border-slate-900 bg-slate-900 text-white"
                    >
                      {l("Add comment", "Yorum ekle")}
                    </IconButton>
                  </form>
                  <div className="space-y-3">
                    {commentRows.map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="whitespace-pre-wrap text-slate-800">{row.body}</div>
                            <div className="mt-2 text-xs text-slate-500">
                              #{row.createdByUserId || "-"} / {formatDateTime(row.createdAt)}
                            </div>
                          </div>
                          <IconButton
                            icon={Trash2}
                            disabled={!canWorkSelected || busyAction === `deleteComment:${row.id}`}
                            onClick={() => handleDeleteComment(row.id)}
                            className="border-rose-300 bg-rose-50 text-rose-700"
                          >
                            {l("Delete", "Sil")}
                          </IconButton>
                        </div>
                      </div>
                    ))}
                    {commentRows.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        {l("No comments yet.", "Henuz yorum yok.")}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{l("Events", "Olaylar")}</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {eventRows.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {eventRows.slice(0, 20).map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                        <div className="font-semibold text-slate-900">{toDisplayText(row.eventType)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.fromStatus || "-"} {"->"} {row.toStatus || "-"} / #{row.actorUserId || "-"} /{" "}
                          {formatDateTime(row.createdAt)}
                        </div>
                        {row.note ? <div className="mt-1 text-slate-700">{row.note}</div> : null}
                      </div>
                    ))}
                    {eventRows.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        {l("No events yet.", "Henuz olay yok.")}
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
