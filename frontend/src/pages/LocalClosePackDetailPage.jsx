
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import GovernedRuntimeExplainabilityPanel from "../components/workflows/GovernedRuntimeExplainabilityPanel.jsx";
import {
  approveLocalClosePack,
  createLocalClosePackComment,
  createLocalClosePackEvidence,
  deleteLocalClosePackEvidence,
  downloadLocalClosePackEvidence,
  getLocalClosePack,
  lockLocalClosePack,
  listLocalClosePackAudit,
  listLocalClosePackComments,
  listLocalClosePackEvidence,
  listLocalClosePackReopenRequests,
  listLocalClosePackReportReviews,
  returnLocalClosePack,
  submitLocalClosePack,
  updateLocalClosePackCertificationSection,
  uploadLocalClosePackEvidenceContent,
} from "../api/localClosePacks.js";
import { buildLocalReportLocation } from "../api/glReports.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
import {
  buildLocalCloseActionDisabledReason,
  buildLocalCloseRuntimeExplainabilityModel,
} from "./localCloseRuntimeExplainability.js";
const TAB_KEYS = Object.freeze([
  "overview",
  "certification",
  "checklist",
  "reports",
  "exceptions",
  "evidence",
  "comments",
  "audit",
]);
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
function formatFileSize(bytes) {
  const parsed = Number(bytes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = parsed;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2)} ${units[unitIndex]}`;
}
function triggerBlobDownload(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = String(fileName || "").trim() || "evidence.bin";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}
function formatScopeLabel(pack, l) {
  if (String(pack?.closeScopeType || "").toUpperCase() === "OPERATING_UNIT") {
    const code = String(pack?.operatingUnitCode || "").trim();
    const name = String(pack?.operatingUnitName || "").trim();
    return code && name ? `${code} - ${name}` : code || name || l("Operating unit", "Isletme birimi");
  }
  return l("HQ / Central", "Merkez / HQ");
}
function getStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "LOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "READY_FOR_REVIEW":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "RETURNED":
    case "REOPENED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}
function getStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "NOT_OPENED":
      return l("Not opened", "Acilmadi");
    case "OPEN":
      return l("Open", "Acik");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    case "READY_FOR_REVIEW":
      return l("Ready for review", "Incelemeye hazir");
    case "RETURNED":
      return l("Returned", "Iade edildi");
    case "APPROVED":
      return l("Approved", "Onaylandi");
    case "LOCKED":
      return l("Locked", "Kilitlendi");
    case "REOPENED":
      return l("Reopened", "Yeniden acildi");
    default:
      return status || "-";
  }
}
function getReadinessLabel(state, l) {
  switch (String(state || "").trim().toUpperCase()) {
    case "NOT_READY":
      return l("Not ready", "Hazir degil");
    case "PARTIALLY_READY":
      return l("Partially ready", "Kismen hazir");
    case "READY_FOR_ENTITY_REVIEW":
      return l("Ready for entity review", "Varlik incelemesine hazir");
    case "ENTITY_REOPENED":
      return l("Entity reopened", "Varlik yeniden acildi");
    default:
      return state || "-";
  }
}
function getRecommendedActionLabel(action, l) {
  switch (String(action || "").trim().toUpperCase()) {
    case "SUBMIT":
      return l("Submit", "Gonder");
    case "RETURN":
      return l("Return", "Iade et");
    case "APPROVE":
      return l("Approve", "Onayla");
    case "LOCK":
      return l("Lock", "Kilitle");
    case "RESOLVE_BLOCKERS":
      return l("Resolve blockers", "Blokajlari cozumleyin");
    default:
      return l("No action", "Aksiyon yok");
  }
}
function getGateTone(level) {
  if (String(level || "").toUpperCase() === "BLOCKER") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}
function getGatePillTone(level) {
  if (String(level || "").toUpperCase() === "BLOCKER") {
    return "border-rose-200 bg-rose-100 text-rose-700";
  }
  return "border-amber-200 bg-amber-100 text-amber-700";
}
function getCertificationStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "COMPLETE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "IN_PROGRESS":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}
function getCertificationStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "COMPLETE":
      return l("Complete", "Tamam");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    default:
      return l("Not started", "Baslamadi");
  }
}
function getCertificationSectionTone(section) {
  if (String(section?.status || "").trim().toUpperCase() === "COMPLETE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (section?.isRequired) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}
function getCertificationSectionStatusLabel(status, l) {
  return String(status || "").trim().toUpperCase() === "COMPLETE"
    ? l("Complete", "Tamam")
    : l("Open", "Acik");
}
function buildPackReportLaunches(pack, l) {
  if (!pack) {
    return [];
  }
  const packScopedParams =
    String(pack.closeScopeType || "").toUpperCase() === "OPERATING_UNIT"
      ? {
        operatingUnitScope: "OPERATING_UNIT",
        operatingUnitId: pack.operatingUnitId,
      }
      : {
        operatingUnitScope: "CENTRAL",
      };
  const baseParams = {
    legalEntityId: pack.legalEntityId,
    bookId: pack.bookId,
    fiscalPeriodId: pack.fiscalPeriodId,
    closePackId: pack.id,
  };
  return [
    {
      key: "trialBalance",
      title: l("Mizan", "Mizan"),
      launchMode: "PACK_SCOPE",
      scopeNote: l("Exact pack scope", "Paket scope'u birebir"),
      href: buildLocalReportLocation("trialBalance", {
        ...baseParams,
        ...packScopedParams,
        closeLaunchMode: "PACK_SCOPE",
      }),
    },
    {
      key: "generalLedger",
      title: l("Defter-i Kebir", "Defter-i Kebir"),
      launchMode: "PACK_SCOPE",
      scopeNote: l("Exact pack scope", "Paket scope'u birebir"),
      href: buildLocalReportLocation("generalLedger", {
        ...baseParams,
        ...packScopedParams,
        closeLaunchMode: "PACK_SCOPE",
      }),
    },
    {
      key: "subsidiaryLedger",
      title: l("Muavin", "Muavin"),
      launchMode: "PACK_SCOPE",
      scopeNote: l("Exact pack scope", "Paket scope'u birebir"),
      href: buildLocalReportLocation("subsidiaryLedger", {
        ...baseParams,
        ...packScopedParams,
        closeLaunchMode: "PACK_SCOPE",
      }),
    },
    {
      key: "balanceSheet",
      title: l("Bilanco", "Bilanco"),
      launchMode: "ENTITY_STATEMENT_FALLBACK",
      scopeNote: l(
        "Statutory entity-level statement with pack context preserved",
        "Paket baglami korunan statutor entity duzeyi tablo"
      ),
      href: buildLocalReportLocation("balanceSheet", {
        ...baseParams,
        closeLaunchMode: "ENTITY_STATEMENT_FALLBACK",
      }),
    },
    {
      key: "incomeStatement",
      title: l("Gelir Tablosu", "Gelir Tablosu"),
      launchMode: "ENTITY_STATEMENT_FALLBACK",
      scopeNote: l(
        "Statutory entity-level statement with pack context preserved",
        "Paket baglami korunan statutor entity duzeyi tablo"
      ),
      href: buildLocalReportLocation("incomeStatement", {
        ...baseParams,
        closeLaunchMode: "ENTITY_STATEMENT_FALLBACK",
      }),
    },
  ];
}
function resolveGateDrillLabel(gateRow, l) {
  const tab = String(gateRow?.drill?.tab || "").trim().toLowerCase();
  if (String(gateRow?.drill?.surface || "").trim().toLowerCase() === "yearendrevrec") {
    return l("Open year-end REVREC", "Yil sonu REVREC'i ac");
  }
  if (String(gateRow?.drill?.path || "").trim()) {
    return l("Open related detail", "Ilgili detayi ac");
  }
  if (tab === "reports") {
    return l("Open reports tab", "Raporlar sekmesini ac");
  }
  if (tab === "certification") {
    return l("Open certification tab", "Sertifikasyon sekmesini ac");
  }
  if (tab === "exceptions") {
    return l("Open exceptions tab", "Istisnalar sekmesini ac");
  }
  if (tab === "evidence") {
    return l("Open evidence tab", "Kanit sekmesini ac");
  }
  if (tab === "overview") {
    return l("Open overview tab", "Genel bakis sekmesini ac");
  }
  return l("Open related detail", "Ilgili detayi ac");
}
function deriveChecklist(pack, reportReviews, evidenceRows, commentRows, reopenRows, entityReadiness, l) {
  const requiredReportCount = Number(pack?.requiredReportCount || 0) || 5;
  const reviewedReportCount = Array.isArray(reportReviews) ? reportReviews.length : 0;
  const pendingReopenCount = (Array.isArray(reopenRows) ? reopenRows : []).filter(
    (row) => String(row?.requestStatus || "").toUpperCase() === "REQUESTED"
  ).length;
  const invalidatingScopeCount = Array.isArray(entityReadiness?.invalidatingScopes)
    ? entityReadiness.invalidatingScopes.length
    : 0;
  return [
    {
      title: l("Required report reviews", "Gerekli rapor incelemeleri"),
      detail: `${reviewedReportCount}/${requiredReportCount}`,
      done: reviewedReportCount >= requiredReportCount,
    },
    {
      title: l("Evidence pack attachments", "Kanit paketi ekleri"),
      detail: `${Array.isArray(evidenceRows) ? evidenceRows.length : 0}`,
      done: Array.isArray(evidenceRows) && evidenceRows.length > 0,
    },
    {
      title: l("Internal commentary captured", "Dahili yorum kaydi"),
      detail: `${Array.isArray(commentRows) ? commentRows.length : 0}`,
      done: Array.isArray(commentRows) && commentRows.length > 0,
      optional: true,
    },
    {
      title: l("Pending reopen requests cleared", "Bekleyen yeniden acmalar kapatildi"),
      detail: `${pendingReopenCount}`,
      done: pendingReopenCount === 0,
    },
    {
      title: l("Entity readiness stable", "Varlik hazirligi stabil"),
      detail: invalidatingScopeCount
        ? `${invalidatingScopeCount} ${l("invalidating scopes", "invalidate eden scope")}`
        : l("No invalidating scopes", "Invalidate eden scope yok"),
      done: invalidatingScopeCount === 0,
    },
  ];
}
function SectionCard({ title, subtitle, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${active
        ? "bg-slate-900 text-white shadow-sm"
        : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900"
        }`}
    >
      {children}
    </button>
  );
}

function ActionButtonWithTooltip({
  disabled = false,
  disabledReason = "",
  children,
  ...props
}) {
  const button = (
    <button {...props} disabled={disabled}>
      {children}
    </button>
  );
  if (!disabled || !disabledReason) {
    return button;
  }
  return (
    <span className="inline-flex" title={disabledReason}>
      {button}
    </span>
  );
}
/**
 * Local close-pack detail shell with reports, certification sections,
 * evidence, comments, reopen context, and audit in one page.
 */
export default function LocalClosePackDetailPage() {
  const { packId } = useParams();
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canRead = hasPermission("ouclose.read");
  const canPrepare = hasPermission("ouclose.prepare");
  const canSubmit = hasPermission("ouclose.submit");
  const canReview = hasPermission("ouclose.review");
  const canApprove = hasPermission("ouclose.approve");
  const canLock = hasPermission("ouclose.lock");
  const normalizedPackId = toPositiveInt(packId);
  const requestedTab = String(searchParams.get("tab") || "overview").trim().toLowerCase();
  const [activeTab, setActiveTab] = useState(
    TAB_KEYS.includes(requestedTab) ? requestedTab : "overview"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pack, setPack] = useState(null);
  const [entityReadiness, setEntityReadiness] = useState(null);
  const [reviewGate, setReviewGate] = useState(null);
  const [certification, setCertification] = useState(null);
  const [reportReviews, setReportReviews] = useState([]);
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [commentRows, setCommentRows] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [reopenRows, setReopenRows] = useState([]);
  const [uploadDraft, setUploadDraft] = useState({ file: null, note: "", displayName: "" });
  const [uploading, setUploading] = useState(false);
  const [downloadId, setDownloadId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [actionSaving, setActionSaving] = useState("");
  const [certificationNotes, setCertificationNotes] = useState({});
  const [certificationSavingKey, setCertificationSavingKey] = useState("");
  useEffect(() => {
    const normalizedTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "overview";
    setActiveTab((prev) => (prev === normalizedTab ? prev : normalizedTab));
  }, [requestedTab]);
  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", activeTab);
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);
  const loadWorkspaceData = useCallback(async () => {
    if (!canRead || !normalizedPackId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [packResponse, reviewResponse, evidenceResponse, commentResponse, auditResponse, reopenResponse] =
        await Promise.all([
          getLocalClosePack(normalizedPackId),
          listLocalClosePackReportReviews(normalizedPackId),
          listLocalClosePackEvidence(normalizedPackId),
          listLocalClosePackComments(normalizedPackId),
          listLocalClosePackAudit(normalizedPackId, { limit: 100, includePayload: true }),
          listLocalClosePackReopenRequests(normalizedPackId),
        ]);
      setPack(packResponse?.row || null);
      setEntityReadiness(packResponse?.entityReadiness || null);
      setReviewGate(packResponse?.reviewGate || null);
      setCertification(packResponse?.certification || null);
      setReportReviews(Array.isArray(reviewResponse?.rows) ? reviewResponse.rows : []);
      setEvidenceRows(Array.isArray(evidenceResponse?.rows) ? evidenceResponse.rows : []);
      setCommentRows(Array.isArray(commentResponse?.rows) ? commentResponse.rows : []);
      setAuditRows(Array.isArray(auditResponse?.rows) ? auditResponse.rows : []);
      setReopenRows(Array.isArray(reopenResponse?.rows) ? reopenResponse.rows : []);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l("Failed to load the local close pack.", "Yerel kapanis paketi yuklenemedi.")
      );
    } finally {
      setLoading(false);
    }
  }, [canRead, l, normalizedPackId]);
  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);
  useEffect(() => {
    const nextNotes = {};
    for (const section of certification?.sections || []) {
      nextNotes[section.sectionKey] = section.note || "";
    }
    setCertificationNotes(nextNotes);
  }, [certification]);
  const reportLaunches = useMemo(() => buildPackReportLaunches(pack, l), [l, pack]);
  const reportLaunchByKey = useMemo(
    () => new Map(reportLaunches.map((row) => [row.key, row])),
    [reportLaunches]
  );
  const reviewByKey = useMemo(
    () =>
      new Map(
        (Array.isArray(reportReviews) ? reportReviews : []).map((row) => [row.reportKey, row])
      ),
    [reportReviews]
  );
  const checklistItems = useMemo(
    () => deriveChecklist(pack, reportReviews, evidenceRows, commentRows, reopenRows, entityReadiness, l),
    [commentRows, entityReadiness, evidenceRows, l, pack, reportReviews, reopenRows]
  );
  const certificationSummary = certification?.summary || null;
  const runtimeExplainabilityModel = useMemo(
    () =>
      buildLocalCloseRuntimeExplainabilityModel({
        pack,
        reviewGate,
        auditRows,
        canRead,
        canPrepare,
        canSubmit,
        canReview,
        canApprove,
        canLock,
        l,
      }),
    [
      auditRows,
      canApprove,
      canLock,
      canPrepare,
      canRead,
      canReview,
      canSubmit,
      l,
      pack,
      reviewGate,
    ]
  );
  const actionDisabledReasons = useMemo(
    () => ({
      submit: buildLocalCloseActionDisabledReason({
        actionKey: "submit",
        reviewGate,
        l,
      }),
      return: buildLocalCloseActionDisabledReason({
        actionKey: "return",
        reviewGate,
        l,
      }),
      approve: buildLocalCloseActionDisabledReason({
        actionKey: "approve",
        reviewGate,
        l,
      }),
      lock: buildLocalCloseActionDisabledReason({
        actionKey: "lock",
        reviewGate,
        l,
      }),
    }),
    [l, reviewGate]
  );
  const visibleActionDisabledReasons = useMemo(
    () =>
      [
        canSubmit && !reviewGate?.actionAvailability?.submit?.allowed
          ? {
              key: "submit",
              label: l("Submit", "Gonder"),
              reason: actionDisabledReasons.submit,
            }
          : null,
        canReview && !reviewGate?.actionAvailability?.return?.allowed
          ? {
              key: "return",
              label: l("Return", "Iade et"),
              reason: actionDisabledReasons.return,
            }
          : null,
        canApprove && !reviewGate?.actionAvailability?.approve?.allowed
          ? {
              key: "approve",
              label: l("Approve", "Onayla"),
              reason: actionDisabledReasons.approve,
            }
          : null,
        canLock && !reviewGate?.actionAvailability?.lock?.allowed
          ? {
              key: "lock",
              label: l("Lock", "Kilitle"),
              reason: actionDisabledReasons.lock,
            }
          : null,
      ].filter((row) => row?.reason),
    [
      actionDisabledReasons.approve,
      actionDisabledReasons.lock,
      actionDisabledReasons.return,
      actionDisabledReasons.submit,
      canApprove,
      canLock,
      canReview,
      canSubmit,
      l,
      reviewGate,
    ]
  );
  async function handleAttachEvidence(event) {
    event.preventDefault();
    if (!canPrepare || !normalizedPackId || !uploadDraft.file) {
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const createResponse = await createLocalClosePackEvidence(normalizedPackId, {
        fileName: uploadDraft.file.name,
        contentType: uploadDraft.file.type || undefined,
        displayName: String(uploadDraft.displayName || "").trim() || undefined,
        note: String(uploadDraft.note || "").trim() || undefined,
      });
      const evidenceId = toPositiveInt(createResponse?.row?.id);
      if (!evidenceId) {
        throw new Error("Evidence draft id is missing");
      }
      await uploadLocalClosePackEvidenceContent(
        normalizedPackId,
        evidenceId,
        uploadDraft.file,
        { contentType: uploadDraft.file.type || undefined }
      );
      setUploadDraft({ file: null, note: "", displayName: "" });
      setMessage(l("Evidence attached.", "Kanit eklendi."));
      await loadWorkspaceData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        l("Failed to attach evidence.", "Kanit eklenemedi.")
      );
    } finally {
      setUploading(false);
    }
  }
  async function handleDownloadEvidence(row) {
    const evidenceId = toPositiveInt(row?.id);
    if (!normalizedPackId || !evidenceId) {
      return;
    }
    setDownloadId(evidenceId);
    setError("");
    try {
      const payload = await downloadLocalClosePackEvidence(normalizedPackId, evidenceId);
      triggerBlobDownload(payload.blob, payload.fileName || row?.fileName);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l("Failed to download evidence.", "Kanit indirilemedi.")
      );
    } finally {
      setDownloadId(null);
    }
  }
  async function handleDeleteEvidence(evidenceId) {
    if (!canPrepare || !normalizedPackId || !evidenceId) {
      return;
    }
    setDeleteId(evidenceId);
    setError("");
    try {
      await deleteLocalClosePackEvidence(normalizedPackId, evidenceId);
      setMessage(l("Evidence deleted.", "Kanit silindi."));
      await loadWorkspaceData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l("Failed to delete evidence.", "Kanit silinemedi.")
      );
    } finally {
      setDeleteId(null);
    }
  }
  async function handleCreateComment(event) {
    event.preventDefault();
    if (!canPrepare || !normalizedPackId || !String(commentBody || "").trim()) {
      return;
    }
    setCommentSaving(true);
    setError("");
    try {
      await createLocalClosePackComment(normalizedPackId, {
        body: String(commentBody || "").trim(),
      });
      setCommentBody("");
      setMessage(l("Comment added.", "Yorum eklendi."));
      await loadWorkspaceData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l("Failed to add comment.", "Yorum eklenemedi.")
      );
    } finally {
      setCommentSaving(false);
    }
  }
  async function handlePackAction(actionKey) {
    if (!normalizedPackId) {
      return;
    }
    const normalizedAction = String(actionKey || "").trim().toLowerCase();
    const payload =
      normalizedAction === "return" && String(decisionNote || "").trim()
        ? { decisionNote: String(decisionNote || "").trim() }
        : normalizedAction === "return"
          ? { decisionNote: "" }
          : String(decisionNote || "").trim()
            ? { decisionNote: String(decisionNote || "").trim() }
            : {};
    const actionMap = {
      submit: submitLocalClosePack,
      return: returnLocalClosePack,
      approve: approveLocalClosePack,
      lock: lockLocalClosePack,
    };
    const actionFn = actionMap[normalizedAction];
    if (!actionFn) {
      return;
    }
    setActionSaving(normalizedAction);
    setError("");
    setMessage("");
    try {
      const response = await actionFn(normalizedPackId, payload);
      setPack(response?.row || null);
      setEntityReadiness(response?.entityReadiness || null);
      setReviewGate(response?.reviewGate || null);
      setDecisionNote("");
      setMessage(
        normalizedAction === "submit"
          ? l("Pack submitted for review.", "Paket incelemeye gonderildi.")
          : normalizedAction === "return"
            ? l("Pack returned for correction.", "Paket duzeltme icin iade edildi.")
            : normalizedAction === "approve"
              ? l("Pack approved.", "Paket onaylandi.")
              : l("Pack locked.", "Paket kilitlendi.")
      );
      await loadWorkspaceData();
    } catch (err) {
      const errorCode = String(err?.response?.data?.code || "").trim();
      const errorMessage =
        err?.response?.data?.message ||
        l("Pack action failed.", "Paket aksiyonu basarisiz oldu.");
      setError(errorCode ? `${errorMessage} [${errorCode}]` : errorMessage);
    } finally {
      setActionSaving("");
    }
  }
  async function handleCertificationSectionAction(section, nextStatus) {
    if (!normalizedPackId || !section?.sectionKey || !canLock) {
      return;
    }
    setCertificationSavingKey(section.sectionKey);
    setError("");
    setMessage("");
    try {
      const response = await updateLocalClosePackCertificationSection(
        normalizedPackId,
        section.sectionKey,
        {
          status: nextStatus,
          note:
            String(certificationNotes?.[section.sectionKey] || "").trim() || undefined,
        }
      );
      setCertification(response?.certification || null);
      setMessage(
        nextStatus === "COMPLETE"
          ? l("Certification section completed.", "Sertifikasyon bolumu tamamlandi.")
          : l("Certification section reopened.", "Sertifikasyon bolumu yeniden acildi.")
      );
      await loadWorkspaceData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to update the certification section.",
            "Sertifikasyon bolumu guncellenemedi."
          )
      );
    } finally {
      setCertificationSavingKey("");
    }
  }
  if (!canRead) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {l("Missing permission: ouclose.read", "Eksik yetki: ouclose.read")}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Link
                to="/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri"
                className="hover:text-slate-700"
              >
                {l("Local Close Workspace", "Yerel Kapanis Calisma Alani")}
              </Link>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              {pack?.legalEntityCode || pack?.legalEntityName || l("Local Close Pack", "Yerel Kapanis Paketi")}
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-600">
              {l(
                "RP07 gathers the local report family, evidence pack, comments, reopen context, and audit around one pack without widening the workflow policy itself.",
                "RP07, workflow politikasini genisletmeden yerel rapor ailesini, kanit paketini, yorumlari, yeniden acma baglamini ve denetim izini tek bir paket etrafinda toplar."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadWorkspaceData()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {loading ? l("Refreshing...", "Yenileniyor...") : l("Refresh", "Yenile")}
          </button>
        </div>
        {pack ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Scope", "Scope")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{formatScopeLabel(pack, l)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {(pack.bookCode || pack.bookName || "-")} | {pack.periodName || "-"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Status", "Durum")}
              </div>
              <div className="mt-1">
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getStatusTone(pack.status)}`}>
                  {getStatusLabel(pack.status, l)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {l("Entity readiness", "Varlik hazirligi")}: {getReadinessLabel(entityReadiness?.state, l)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Completion", "Tamamlanma")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {pack.completionPercentage || 0}%
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {pack.reportReviewCount || 0}/{pack.requiredReportCount || 0}{" "}
                {l("reviewed reports", "incelenen rapor")}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Certification", "Sertifikasyon")}
              </div>
              <div className="mt-1">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getCertificationStatusTone(
                    certificationSummary?.status || pack.certificationStatus
                  )}`}
                >
                  {getCertificationStatusLabel(
                    certificationSummary?.status || pack.certificationStatus,
                    l
                  )}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {certificationSummary?.completedRequiredSectionCount ||
                  pack.certificationCompletedRequiredSectionCount ||
                  0}
                /
                {certificationSummary?.requiredSectionCount ||
                  pack.certificationRequiredSectionCount ||
                  0}{" "}
                {l("required sections complete", "zorunlu bolum tamam")}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Issues", "Sorunlar")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {l("Blockers", "Blokajlar")}: {pack.blockerCount || 0}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {l("Warnings", "Uyarilar")}: {pack.warningCount || 0} |{" "}
                {l("Pending reopens", "Bekleyen yeniden acmalar")}: {pack.pendingReopenRequestCount || 0}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Last activity", "Son aktivite")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTime(pack.lastActivityAt)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {l("Certified", "Sertifikalandi")}:{" "}
                {formatDateTime(certification?.row?.certifiedAt || pack.certifiedAt)}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {pack && reviewGate ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Review gate and status progression", "Inceleme kapisi ve durum ilerlemesi")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {l(
                  "RP12 surfaces the existing pack blockers from report reviews, draft journals, workflow status, and reopen truth before the close actions mutate status.",
                  "RP12, kapanis aksiyonlari durumu degistirmeden once rapor incelemeleri, taslak fisler, workflow durumu ve yeniden acma gerceginden gelen mevcut paket blokajlarini gorunur kilar."
                )}
              </p>
            </div>
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {l("Next recommended action", "Onerilen sonraki aksiyon")}
              </div>
              <div className="mt-1 font-semibold">
                {getRecommendedActionLabel(reviewGate.nextRecommendedAction, l)}
              </div>
            </div>
          </div>
          <GovernedRuntimeExplainabilityPanel
            className="mt-4"
            l={l}
            model={runtimeExplainabilityModel}
            title={l("Close-stage explainability", "Kapanis asamasi aciklamasi")}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Current status", "Mevcut durum")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {getStatusLabel(reviewGate.currentStatus, l)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Report reviews", "Rapor incelemeleri")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {reviewGate.counts?.reviewedReportCount || 0}/{reviewGate.counts?.requiredReportCount || 0}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Blockers / Warnings", "Blokaj / Uyari")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {reviewGate.blockerCount || 0} / {reviewGate.warningCount || 0}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Certification pack", "Sertifikasyon paketi")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {reviewGate.counts?.certificationCompletedRequiredSectionCount || 0}/
                {reviewGate.counts?.certificationRequiredSectionCount || 0}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {l("Incomplete required", "Eksik zorunlu")}:{" "}
                {reviewGate.counts?.certificationIncompleteRequiredCount || 0}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Workflow gate", "Workflow kapisi")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {reviewGate.workflowGate?.approved
                  ? l("Approved", "Onayli")
                  : reviewGate.workflowGate?.required
                    ? reviewGate.workflowGate?.workflowInstanceStatus || l("Pending", "Beklemede")
                    : l("Not required", "Gerekli degil")}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Decision note", "Karar notu")}
            </label>
            <textarea
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l(
                "Required for return; optional for approve/lock audit context.",
                "Iade icin zorunlu; onay/kilit denetim baglami icin opsiyonel."
              )}
              disabled={Boolean(actionSaving)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {canSubmit ? (
                <ActionButtonWithTooltip
                  type="button"
                  onClick={() => void handlePackAction("submit")}
                  disabled={!reviewGate.actionAvailability?.submit?.allowed || Boolean(actionSaving)}
                  disabledReason={actionDisabledReasons.submit}
                  className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionSaving === "submit" ? l("Submitting...", "Gonderiliyor...") : l("Submit", "Gonder")}
                </ActionButtonWithTooltip>
              ) : null}
              {canReview ? (
                <ActionButtonWithTooltip
                  type="button"
                  onClick={() => void handlePackAction("return")}
                  disabled={!reviewGate.actionAvailability?.return?.allowed || Boolean(actionSaving)}
                  disabledReason={actionDisabledReasons.return}
                  className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-60"
                >
                  {actionSaving === "return" ? l("Returning...", "Iade ediliyor...") : l("Return", "Iade et")}
                </ActionButtonWithTooltip>
              ) : null}
              {canApprove ? (
                <ActionButtonWithTooltip
                  type="button"
                  onClick={() => void handlePackAction("approve")}
                  disabled={!reviewGate.actionAvailability?.approve?.allowed || Boolean(actionSaving)}
                  disabledReason={actionDisabledReasons.approve}
                  className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionSaving === "approve" ? l("Approving...", "Onaylaniyor...") : l("Approve", "Onayla")}
                </ActionButtonWithTooltip>
              ) : null}
              {canLock ? (
                <ActionButtonWithTooltip
                  type="button"
                  onClick={() => void handlePackAction("lock")}
                  disabled={!reviewGate.actionAvailability?.lock?.allowed || Boolean(actionSaving)}
                  disabledReason={actionDisabledReasons.lock}
                  className="rounded-lg border border-cyan-600 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionSaving === "lock" ? l("Locking...", "Kilitleniyor...") : l("Lock", "Kilitle")}
                </ActionButtonWithTooltip>
              ) : null}
            </div>
            {visibleActionDisabledReasons.length > 0 ? (
              <div className="mt-3 space-y-2">
                {visibleActionDisabledReasons.map((row) => (
                  <div
                    key={row.key}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    <span className="font-semibold">{row.label}:</span> {row.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {[...(reviewGate.blockers || []), ...(reviewGate.warnings || [])].map((gateRow) => {
              const reportLaunch = gateRow?.drill?.reportKey
                ? reportLaunchByKey.get(gateRow.drill.reportKey)
                : null;
              const drillSurface = String(gateRow?.drill?.surface || "").trim().toLowerCase();
              const hasDirectDrillPath = Boolean(String(gateRow?.drill?.path || "").trim());
              const showTabDrillButton = Boolean(gateRow?.drill?.tab) && !(
                drillSurface === "yearendrevrec" && hasDirectDrillPath
              );
              return (
                <div
                  key={`${gateRow.level}-${gateRow.code}`}
                  className={`rounded-xl border px-4 py-3 ${getGateTone(gateRow.level)}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${getGatePillTone(gateRow.level)}`}>
                          {gateRow.level === "BLOCKER" ? l("Blocker", "Blokaj") : l("Warning", "Uyari")}
                        </span>
                        <span className="font-mono text-[11px]">{gateRow.code}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold">{gateRow.message}</div>
                      {gateRow.count ? (
                        <div className="mt-1 text-xs opacity-80">
                          {l("Count", "Sayi")}: {gateRow.count}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {showTabDrillButton ? (
                        <button
                          type="button"
                          onClick={() => setActiveTab(String(gateRow.drill.tab || "overview"))}
                          className="rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold"
                        >
                          {resolveGateDrillLabel(gateRow, l)}
                        </button>
                      ) : null}
                      {reportLaunch ? (
                        <Link
                          to={reportLaunch.href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold"
                        >
                          {l("Open related report", "Ilgili raporu ac")}
                        </Link>
                      ) : null}
                      {gateRow?.drill?.path ? (
                        <Link
                          to={gateRow.drill.path}
                          className="rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold"
                        >
                          {resolveGateDrillLabel(gateRow, l)}
                        </Link>
                      ) : null}
                      {gateRow?.drill?.surface === "workflow" ? (
                        <Link
                          to="/app/ayarlar/workflow-kurulumu"
                          className="rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold"
                        >
                          {l("Open workflow governance", "Workflow yonetimini ac")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {(reviewGate.blockers || []).length === 0 && (reviewGate.warnings || []).length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {l(
                  "No surfaced blockers or warnings are currently open for this pack.",
                  "Bu paket icin su anda gorunur blokaj veya uyari acik degil."
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
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
      <div className="flex flex-wrap gap-2">
        {TAB_KEYS.map((tabKey) => (
          <TabButton
            key={tabKey}
            active={activeTab === tabKey}
            onClick={() => setActiveTab(tabKey)}
          >
            {tabKey === "overview"
              ? l("Overview", "Genel Bakis")
              : tabKey === "certification"
                ? l("Certification", "Sertifikasyon")
              : tabKey === "checklist"
                ? l("Checklist", "Kontrol Listesi")
                : tabKey === "reports"
                  ? l("Reports", "Raporlar")
                  : tabKey === "exceptions"
                    ? l("Exceptions", "Istisnalar")
                    : tabKey === "evidence"
                      ? l("Evidence", "Kanit")
                      : tabKey === "comments"
                        ? l("Comments", "Yorumlar")
                        : l("Audit Trail", "Denetim Izi")}
          </TabButton>
        ))}
      </div>
      {activeTab === "overview" ? (
        <SectionCard
          title={l("Pack Overview", "Paket Ozeti")}
          subtitle={l(
            "This shell keeps the close context, readiness subset, and timestamps visible while RP08/RP09 workflow policy stays in its own slices.",
            "Bu kabuk, RP08/RP09 workflow politikasi kendi dilimlerinde kalirken kapanis baglamini, hazirlik alt kumesini ve zaman damgalarini gorunur tutar."
          )}
        >
          {pack ? (
            <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Legal entity", "Yasal varlik")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {(pack.legalEntityCode || "-")} {pack.legalEntityName || ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Book", "Defter")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {(pack.bookCode || "-")} {pack.bookName || ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Fiscal period", "Mali donem")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{pack.periodName || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Owner", "Sahip")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{pack.ownerUserName || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Reviewer", "Inceleyen")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{pack.reviewerUserName || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Workflow gate", "Workflow kapisi")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {pack.workflowInstanceStatus || l("Not linked yet", "Henuz bagli degil")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Approved at", "Onay zamani")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{formatDateTime(pack.approvedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Locked at", "Kilit zamani")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{formatDateTime(pack.lockedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Reopened at", "Yeniden acma zamani")}
                </dt>
                <dd className="mt-1 text-sm text-slate-900">{formatDateTime(pack.reopenedAt)}</dd>
              </div>
            </dl>
          ) : (
            <div className="text-sm text-slate-500">
              {loading ? l("Loading pack...", "Paket yukleniyor...") : "-"}
            </div>
          )}
          {entityReadiness ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {l("Entity readiness subset", "Varlik hazirlik alt kumesi")}
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {getReadinessLabel(entityReadiness.state, l)} | {entityReadiness.approvedOrLockedMandatoryScopeCount || 0}/
                {entityReadiness.mandatoryScopeCount || 0} {l("mandatory scopes approved or locked", "zorunlu scope onayli veya kilitli")}
              </div>
              {Array.isArray(entityReadiness.missingMandatoryScopes) &&
                entityReadiness.missingMandatoryScopes.length > 0 ? (
                <div className="mt-2 text-xs text-slate-500">
                  {l("Missing mandatory scopes:", "Eksik zorunlu scope'lar:")}{" "}
                  {entityReadiness.missingMandatoryScopes
                    .map((row) =>
                      row.closeScopeType === "OPERATING_UNIT"
                        ? `${row.operatingUnitCode || row.operatingUnitName || row.scopeKey}`
                        : l("HQ / Central", "Merkez / HQ")
                    )
                    .join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      ) : null}
      {activeTab === "certification" ? (
        <SectionCard
          title={l("Certification pack v2", "Sertifikasyon paketi v2")}
          subtitle={l(
            "PR-04 adds explicit certification sections on top of the existing report, evidence, and workflow pack so lock can depend on visible certification work instead of hidden assumptions.",
            "PR-04, kilitlemenin gizli varsayimlar yerine gorunur sertifikasyon calismasina dayanabilmesi icin mevcut rapor, kanit ve workflow paketinin ustune acik sertifikasyon bolumleri ekler."
          )}
        >
          {certificationSummary ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l("Certification status", "Sertifikasyon durumu")}
                </div>
                <div className="mt-1">
                  <span
                    className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getCertificationStatusTone(
                      certificationSummary.status
                    )}`}
                  >
                    {getCertificationStatusLabel(certificationSummary.status, l)}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l("Required sections", "Zorunlu bolumler")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {certificationSummary.completedRequiredSectionCount || 0}/
                  {certificationSummary.requiredSectionCount || 0}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l("Progress", "Ilerleme")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {certificationSummary.progressPercentage || 0}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l("Certified at", "Sertifika zamani")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatDateTime(certification?.row?.certifiedAt)}
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {(certification?.sections || []).map((section) => {
              const isManual = section.sectionType === "MANUAL";
              const isComplete = section.status === "COMPLETE";
              const noteValue = certificationNotes?.[section.sectionKey] || "";
              return (
                <div
                  key={section.sectionKey}
                  className={`rounded-2xl border px-4 py-4 ${getCertificationSectionTone(section)}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{section.sectionTitle}</span>
                        <span className="rounded-full border border-current px-2 py-1 text-[11px] font-semibold">
                          {section.isRequired
                            ? l("Required", "Zorunlu")
                            : l("Optional", "Opsiyonel")}
                        </span>
                        <span className="rounded-full border border-current px-2 py-1 text-[11px] font-semibold">
                          {section.sectionType === "MANUAL"
                            ? l("Manual", "Manuel")
                            : l("System", "Sistem")}
                        </span>
                      </div>
                      <div className="mt-2 text-sm">{section.sectionDescription}</div>
                      <div className="mt-2 text-xs opacity-80">
                        {l("Status", "Durum")}: {getCertificationSectionStatusLabel(section.status, l)}
                        {" | "}
                        {l("Completed", "Tamamlandi")}: {formatDateTime(section.completedAt)}
                        {section.completedByUserName
                          ? ` | ${l("By", "Yapan")}: ${section.completedByUserName}`
                          : ""}
                      </div>
                    </div>
                    {!isManual ? (
                      <div className="rounded-lg border border-current bg-white/70 px-3 py-2 text-xs font-semibold">
                        {section.completionSource === "SYSTEM"
                          ? l("Derived from live pack state", "Canli paket durumundan turetilir")
                          : l("Waiting for live pack state", "Canli paket durumu bekleniyor")}
                      </div>
                    ) : null}
                  </div>
                  {isManual ? (
                    <div className="mt-4 space-y-3">
                      <label className="block text-xs font-semibold uppercase tracking-wide">
                        {l("Attestation note", "Teyit notu")}
                      </label>
                      <textarea
                        value={noteValue}
                        onChange={(event) =>
                          setCertificationNotes((prev) => ({
                            ...prev,
                            [section.sectionKey]: event.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        placeholder={l(
                          "Explain why the pack is ready to be locked.",
                          "Paketin neden kilitlenmeye hazir oldugunu aciklayin."
                        )}
                        disabled={Boolean(certificationSavingKey)}
                      />
                      {canLock ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCertificationSectionAction(
                                section,
                                isComplete ? "OPEN" : "COMPLETE"
                              )
                            }
                            disabled={Boolean(certificationSavingKey)}
                            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${isComplete
                              ? "border border-amber-600 bg-amber-600"
                              : "border border-slate-900 bg-slate-900"
                              }`}
                          >
                            {certificationSavingKey === section.sectionKey
                              ? l("Saving...", "Kaydediliyor...")
                              : isComplete
                                ? l("Reopen section", "Bolumu yeniden ac")
                                : l("Complete section", "Bolumu tamamla")}
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          {l(
                            "Missing permission: ouclose.lock",
                            "Eksik yetki: ouclose.lock"
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "checklist" ? (
        <SectionCard
          title={l("First-pass checklist", "Ilk gecis kontrol listesi")}
          subtitle={l(
            "RP07 keeps the checklist derived and explainable instead of introducing a second child-state engine before RP08 gates are hardened.",
            "RP07, RP08 kapilari sertlestirilmeden once ikinci bir child-state motoru getirmek yerine kontrol listesini turetilmis ve aciklanabilir tutar."
          )}
        >
          <div className="space-y-3">
            {checklistItems.map((item) => (
              <div
                key={item.title}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${item.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : item.optional
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                >
                  {item.done
                    ? l("Done", "Tamam")
                    : item.optional
                      ? l("Optional", "Opsiyonel")
                      : l("Open", "Acik")}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "reports" ? (
        <SectionCard
          title={l("Report launch pad", "Rapor baslatma alani")}
          subtitle={l(
            "Pack-scoped summary/detail launches stay exact-scope where the repo supports it. Statutory statements stay entity-level and preserve the pack context explicitly.",
            "Repo destekledigi yerde pack-scope ozet/detay baslatmalari birebir scope'ta kalir. Statutor tablolar entity duzeyinde kalir ve paket baglamini acik sekilde korur."
          )}
        >
          <div className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            {l(
              "Reviewed report fingerprints are captured from the launched report page header. Use the buttons below to open each report with the pack context prefilled, then mark that instance reviewed inside the report.",
              "Incelenen rapor fingerprint'leri baslatilan rapor sayfasi basligindan kaydedilir. Asagidaki butonlarla her raporu paket baglami hazir dolu olarak acin, sonra o instance'i rapor icinden incelendi diye isaretleyin."
            )}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {reportLaunches.map((launch) => {
              const reviewRow = reviewByKey.get(launch.key) || null;
              return (
                <div key={launch.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{launch.title}</h3>
                      <div className="mt-1 text-xs text-slate-500">{launch.scopeNote}</div>
                    </div>
                    <Link
                      to={launch.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {l("Open report", "Raporu ac")}
                    </Link>
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    {reviewRow ? (
                      <>
                        <div>
                          {l("Last reviewed", "Son inceleme")}: {formatDateTime(reviewRow.reviewedAt)}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-500">
                          {reviewRow.fingerprintSha256 || "-"}
                        </div>
                      </>
                    ) : (
                      l("No reviewed instance captured yet.", "Henuz incelenmis instance kaydi yok.")
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "exceptions" ? (
        <SectionCard
          title={l("Exceptions and reopen context", "Istisnalar ve yeniden acma baglami")}
          subtitle={l(
            "RP07 surfaces the existing reopen/readiness contract but intentionally does not widen the reopen policy itself.",
            "RP07 mevcut yeniden acma/hazirlik kontratini gorunur kilar, ancak yeniden acma politikasini bilerek genisletmez."
          )}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {l("Invalidating scopes", "Invalidate eden scope'lar")}
              </div>
              {Array.isArray(entityReadiness?.invalidatingScopes) &&
                entityReadiness.invalidatingScopes.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {entityReadiness.invalidatingScopes.map((row) => (
                    <li key={`${row.scopeKey}-${row.status}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      {row.closeScopeType === "OPERATING_UNIT"
                        ? `${row.operatingUnitCode || row.operatingUnitName || row.scopeKey}`
                        : l("HQ / Central", "Merkez / HQ")}{" "}
                      | {getStatusLabel(row.status, l)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-slate-500">
                  {l("No invalidating scopes currently surfaced.", "Su anda invalidate eden scope gorunmuyor.")}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {l("Reopen requests", "Yeniden acma talepleri")}
              </div>
              {reopenRows.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {reopenRows.map((row) => (
                    <div key={row.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div className="font-semibold">
                        #{row.id} | {row.requestedActionType || "-"} | {row.requestStatus || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(row.requestedAt)} | {row.reasonCode || "-"}
                      </div>
                      {row.explanation ? <div className="mt-1 text-xs text-slate-600">{row.explanation}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">
                  {l("No reopen requests recorded for this pack.", "Bu paket icin yeniden acma talebi kaydi yok.")}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "evidence" ? (
        <SectionCard
          title={l("Evidence pack", "Kanit paketi")}
          subtitle={l(
            "This first pass reuses the shared evidence store and keeps pack-scoped file support inside the local-close route family.",
            "Bu ilk gecis paylasilan kanit storesunu yeniden kullanir ve pack-scope dosya destegini yerel kapanis route ailesinin icinde tutar."
          )}
        >
          {canPrepare ? (
            <form onSubmit={handleAttachEvidence} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="file"
                onChange={(event) =>
                  setUploadDraft((prev) => ({
                    ...prev,
                    file: event.target.files?.[0] || null,
                  }))
                }
                className="block w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                disabled={uploading}
              />
              <input
                value={uploadDraft.displayName}
                onChange={(event) =>
                  setUploadDraft((prev) => ({ ...prev, displayName: event.target.value }))
                }
                placeholder={l("Optional display name", "Opsiyonel gorunen ad")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={uploading}
              />
              <input
                value={uploadDraft.note}
                onChange={(event) =>
                  setUploadDraft((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder={l("Optional note", "Opsiyonel not")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={uploading}
              />
              <button
                type="submit"
                disabled={!uploadDraft.file || uploading}
                className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {uploading ? l("Uploading...", "Yukleniyor...") : l("Attach evidence", "Kanit ekle")}
              </button>
            </form>
          ) : null}
          <div className="mt-4 space-y-2">
            {evidenceRows.length > 0 ? (
              evidenceRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.displayName || row.fileName || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.fileName || "-"} | {formatFileSize(row.fileSizeBytes)} | {row.contentType || "-"}
                      </div>
                      {row.note ? <div className="mt-1 text-xs text-slate-600">{row.note}</div> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownloadEvidence(row)}
                        disabled={downloadId === row.id}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {downloadId === row.id ? l("Downloading...", "Indiriliyor...") : l("Download", "Indir")}
                      </button>
                      {canPrepare ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteEvidence(row.id)}
                          disabled={deleteId === row.id}
                          className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60"
                        >
                          {deleteId === row.id ? l("Deleting...", "Siliniyor...") : l("Delete", "Sil")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                {l("No evidence attached yet.", "Henuz ekli kanit yok.")}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "comments" ? (
        <SectionCard
          title={l("Comments", "Yorumlar")}
          subtitle={l(
            "RP07 keeps comments lightweight and pack-scoped so review explanations can sit beside evidence and audit before later governance slices add stronger mandatory-comment rules.",
            "RP07 yorumlari hafif ve pack-scope tutar; boylece sonraki governance dilimleri daha guclu zorunlu-yorum kurallari eklemeden once inceleme aciklamalari kanit ve denetimin yaninda durabilir."
          )}
        >
          {canPrepare ? (
            <form onSubmit={handleCreateComment} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <textarea
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Add internal close-pack comment...", "Dahili kapanis paketi yorumu ekleyin...")}
                disabled={commentSaving}
              />
              <button
                type="submit"
                disabled={!String(commentBody || "").trim() || commentSaving}
                className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {commentSaving ? l("Saving...", "Kaydediliyor...") : l("Add comment", "Yorum ekle")}
              </button>
            </form>
          ) : null}
          <div className="mt-4 space-y-2">
            {commentRows.length > 0 ? (
              commentRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="whitespace-pre-wrap text-sm text-slate-800">{row.body || "-"}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {formatDateTime(row.createdAt)} | {row.createdByUserName || row.createdByUserEmail || row.createdByUserId || "-"}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                {l("No internal comments yet.", "Henuz dahili yorum yok.")}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}
      {activeTab === "audit" ? (
        <SectionCard
          title={l("Audit trail", "Denetim izi")}
          subtitle={l(
            "This tab reads the shared audit_logs table for the pack and any governed reopen actions tied back through the pack id payload.",
            "Bu sekme paylasilan audit_logs tablosunu, paket ve paket id payload'i uzerinden geri baglanan governed reopen aksiyonlari icin okur."
          )}
        >
          <div className="space-y-2">
            {auditRows.length > 0 ? (
              auditRows.map((row) => (
                <div key={row.auditLogId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{row.action || "-"}</div>
                    <div className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.actorName || row.actorEmail || row.actorUserId || "-"} | {row.resourceType || "-"}:{row.resourceId || "-"}
                  </div>
                  {row.payload ? (
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                {l("No audit rows found yet.", "Henuz denetim kaydi bulunmadi.")}
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
