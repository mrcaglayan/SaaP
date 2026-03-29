import { isValidElement, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { listAccounts } from "../../api/glAdmin.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import {
  downloadCariDocumentEvidence,
  getCariDocument,
  listCariDocumentEvidence,
} from "../../api/cariDocuments.js";
import { listUsers } from "../../api/rbacAdmin.js";
import {
  activateFixedAsset,
  createFixedAssetEvidence,
  deleteFixedAssetEvidence,
  downloadFixedAssetEvidence,
  getFixedAsset,
  getFixedAssetDepreciationSchedule,
  listFixedAssetEvidence,
  listFixedAssetCustodians,
  listFixedAssetTransactions,
  ownershipTransferAsset,
  postRetroOwnershipTransferCorrection,
  physicalMoveAsset,
  previewRetroOwnershipTransferCorrection,
  reactivateFixedAsset,
  reverseFixedAssetTransaction,
  saleCreateDraftAr,
  suspendFixedAsset,
  uploadFixedAssetEvidenceContent,
  writeoffAsset,
} from "../../api/fixedAssets.js";
import {
  formatFixedAssetTransactionDisplayLabel,
  isRetroOwnershipCorrectionTransaction,
} from "./fixedAssetTransactionDisplay.js";

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function getApiErrorPayload(error) {
  const payload = error?.response?.data;
  return payload && typeof payload === "object" ? payload : null;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10) || "-";
}

function formatNumber(value) {
  if (value == null) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBool(value) {
  return value ? "Yes" : "No";
}

function formatDateTime(value) {
  if (!value) return "-";
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
  const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildSkippedPeriodRangeLabel(summary) {
  const firstPeriodKey = normalizeText(summary?.firstPeriodKey);
  const latestPeriodKey = normalizeText(summary?.latestPeriodKey);
  if (firstPeriodKey && latestPeriodKey && firstPeriodKey !== latestPeriodKey) {
    return `${firstPeriodKey} - ${latestPeriodKey}`;
  }
  return latestPeriodKey || firstPeriodKey || "-";
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function triggerBlobDownload(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = String(fileName || "").trim() || "download.bin";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function buildEvidenceDisplayName(row) {
  return normalizeText(row?.displayName) || normalizeText(row?.fileName) || "-";
}

function DetailField({ label, value, mono = false }) {
  const hasValue = value != null && value !== "";
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>
        {!hasValue ? "-" : isValidElement(value) ? value : String(value)}
      </dd>
    </div>
  );
}

function InfoHint({ text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-emerald-300 bg-white text-[10px] font-semibold text-emerald-700"
        title={text}
        aria-label={text}
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden w-72 -translate-y-1/2 rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

function SectionCard({ title, children, cols = 4 }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <dl className={`mt-3 grid gap-x-4 gap-y-3 md:grid-cols-${cols}`}>
        {children}
      </dl>
    </section>
  );
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildAssetDetailTransactionPath(assetId, transactionId) {
  const normalizedAssetId = parsePositiveInt(assetId);
  const normalizedTransactionId = parsePositiveInt(transactionId);
  if (!normalizedAssetId) {
    return "/app/demirbas-karti-listesi";
  }
  if (!normalizedTransactionId) {
    return `/app/demirbas-karti-detayi/${normalizedAssetId}?tab=transactions`;
  }
  return `/app/demirbas-karti-detayi/${normalizedAssetId}?tab=transactions&transactionId=${normalizedTransactionId}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildActivationForm(asset = null) {
  const acquisitionDate = normalizeText(asset?.acquisitionDate);
  const capitalizationDate = normalizeText(asset?.capitalizationDate);
  const inServiceDate = normalizeText(asset?.inServiceDate);
  const defaultDate = acquisitionDate || capitalizationDate || todayIsoDate();
  return {
    postingDate: capitalizationDate || defaultDate,
    capitalizationDate: capitalizationDate || defaultDate,
    inServiceDate: inServiceDate || capitalizationDate || acquisitionDate || todayIsoDate(),
    assetTag: normalizeText(asset?.assetTag),
    serialNo: normalizeText(asset?.serialNo),
    custodianEmployeeId: String(parsePositiveInt(asset?.custodianEmployeeId) || ""),
  };
}

function buildLifecycleNoteForm(defaultDate = todayIsoDate()) {
  return {
    effectiveDate: defaultDate,
    note: "",
  };
}

function buildPhysicalMoveForm(asset = null) {
  return {
    effectiveDate: todayIsoDate(),
    locationOperatingUnitId: String(parsePositiveInt(asset?.locationOperatingUnitId) || ""),
    custodianEmployeeId: String(parsePositiveInt(asset?.custodianEmployeeId) || ""),
    departmentCode: normalizeText(asset?.departmentCode),
    costCenterCode: normalizeText(asset?.costCenterCode),
    note: "",
  };
}

function buildOwnershipTransferForm(asset = null, overrides = {}) {
  return {
    effectiveDate: normalizeText(overrides.effectiveDate) || todayIsoDate(),
    postingDate: normalizeText(overrides.postingDate) || todayIsoDate(),
    targetOwnerOperatingUnitId: String(
      parsePositiveInt(overrides.targetOwnerOperatingUnitId) || ""
    ),
    targetLocationOperatingUnitId: String(
      parsePositiveInt(
        overrides.targetLocationOperatingUnitId ?? asset?.locationOperatingUnitId
      ) || ""
    ),
    note: normalizeText(overrides.note),
  };
}

function buildRetroOwnershipCorrectionForm(overrides = {}) {
  return {
    actualEffectiveDate: normalizeText(overrides.actualEffectiveDate) || todayIsoDate(),
    correctionPostingDate: normalizeText(overrides.correctionPostingDate) || todayIsoDate(),
    targetOwnerOperatingUnitId: String(
      parsePositiveInt(overrides.targetOwnerOperatingUnitId) || ""
    ),
    note: normalizeText(overrides.note),
  };
}

function buildRetroOwnershipCorrectionRequest(form = {}) {
  return {
    actualEffectiveDate: normalizeText(form.actualEffectiveDate),
    correctionPostingDate: normalizeText(form.correctionPostingDate),
    targetOwnerOperatingUnitId: parsePositiveInt(form.targetOwnerOperatingUnitId),
    note: normalizeText(form.note) || null,
  };
}

function doesRetroOwnershipCorrectionPreviewMatchForm(preview, form = {}) {
  if (!preview || typeof preview !== "object") {
    return false;
  }
  const request = buildRetroOwnershipCorrectionRequest(form);
  return (
    String(preview.actualEffectiveDate || "") === request.actualEffectiveDate
    && String(preview.correctionPostingDate || "") === request.correctionPostingDate
    && Number(preview.targetOwnerOperatingUnitId || 0) === Number(request.targetOwnerOperatingUnitId || 0)
  );
}

function buildWriteoffForm() {
  return {
    effectiveDate: todayIsoDate(),
    postingDate: todayIsoDate(),
    note: "",
  };
}

const NON_RUN_REVERSIBLE_TRANSACTION_TYPES = new Set([
  "ACQUISITION",
  "CAPITALIZATION",
  "DEPRECIATION",
  "IMPROVEMENT",
  "OWNERSHIP_TRANSFER",
  "WRITEOFF",
  "SALE",
]);

const NON_RUN_REVERSIBLE_DEPRECIATION_KINDS = new Set([
  "LOW_VALUE_FULL_EXPENSE",
  "CATCH_UP",
]);

function canReverseFixedAssetTransactionRow(tx, {
  canPost,
  canDispose,
  canTransfer,
}) {
  const transactionType = normalizeUpperText(tx?.transactionType || tx?.transaction_type);
  const depreciationKind = normalizeUpperText(tx?.depreciationKind || tx?.depreciation_kind);
  const status = normalizeUpperText(tx?.status);
  const reversedTransactionId = parsePositiveInt(
    tx?.reversedTransactionId ?? tx?.reversed_transaction_id
  );
  const reversalTransactionId = parsePositiveInt(
    tx?.reversalTransactionId ?? tx?.reversal_transaction_id
  );

  if (!canPost || status !== "POSTED") {
    return false;
  }
  if (
    transactionType === "REVERSAL"
    || reversedTransactionId
    || reversalTransactionId
    || !NON_RUN_REVERSIBLE_TRANSACTION_TYPES.has(transactionType)
  ) {
    return false;
  }
  if (
    transactionType === "DEPRECIATION"
    && !NON_RUN_REVERSIBLE_DEPRECIATION_KINDS.has(depreciationKind)
  ) {
    return false;
  }
  if (transactionType === "OWNERSHIP_TRANSFER") {
    return canTransfer;
  }
  if (transactionType === "SALE" || transactionType === "WRITEOFF") {
    return canDispose;
  }
  return true;
}

const CARI_DOCUMENTS_ROUTE = "/app/satis-faturalari";
const CARI_AP_DOCUMENTS_ROUTE = "/app/alis-faturalari";
const SALE_ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
]);
const MOVE_ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
]);
const WRITEOFF_ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
]);
const VALID_DETAIL_TABS = new Set([
  "overview",
  "accounting",
  "depreciation",
  "transactions",
  "evidence",
  "audit",
]);

function resolveCariDocumentsRoute(direction) {
  return String(direction || "").trim().toUpperCase() === "AP"
    ? CARI_AP_DOCUMENTS_ROUTE
    : CARI_DOCUMENTS_ROUTE;
}

function buildCariDocumentPath(documentId, direction = "AR") {
  const normalizedDocumentId = parsePositiveInt(documentId);
  const baseRoute = resolveCariDocumentsRoute(direction);
  if (!normalizedDocumentId) {
    return baseRoute;
  }
  const params = new URLSearchParams();
  params.set("documentId", String(normalizedDocumentId));
  return `${baseRoute}?${params.toString()}`;
}

function buildCariSalePrefillPath(asset) {
  const assetId = parsePositiveInt(asset?.id);
  if (!assetId) {
    return `${CARI_DOCUMENTS_ROUTE}#create-draft-document`;
  }
  const params = new URLSearchParams();
  params.set("prefillMode", "FA_SALE");
  params.set("prefillDirection", "AR");
  params.set("prefillTargetFixedAssetId", String(assetId));
  if (parsePositiveInt(asset?.legalEntityId)) {
    params.set("prefillLegalEntityId", String(asset.legalEntityId));
  }
  if (parsePositiveInt(asset?.ownerOperatingUnitId)) {
    params.set("prefillOperatingUnitId", String(asset.ownerOperatingUnitId));
  }
  if (asset?.assetNo) {
    params.set("prefillSourceAssetNo", String(asset.assetNo));
  }
  if (asset?.name) {
    params.set("prefillSourceAssetName", String(asset.name));
  }
  return `${CARI_DOCUMENTS_ROUTE}?${params.toString()}#create-draft-document`;
}

function createInitialLegacySaleFallbackForm() {
  return {
    counterpartyId: "",
    documentDate: todayIsoDate(),
    saleAmountTxn: "",
  };
}

function buildCodeNameLabel(row, idFallback) {
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  if (code && name) return `${code} - ${name}`;
  if (code) return code;
  if (name) return name;
  const normalizedId = parsePositiveInt(idFallback);
  return normalizedId ? `#${normalizedId}` : "-";
}

function mapCustodianOption(row) {
  const value = String(parsePositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.employeeCode || row?.employee_code);
  const name = normalizeText(row?.displayName || row?.display_name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
  };
}

function mapCodeNameOption(row, idValue = row?.id) {
  const value = String(parsePositiveInt(idValue) || "").trim();
  if (!value) return null;
  return {
    value,
    label: buildCodeNameLabel(row, value),
  };
}

function buildUserLabel(rows, userId) {
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedUserId) return "-";
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => parsePositiveInt(row?.id) === normalizedUserId
  );
  const name = normalizeText(
    match?.name ||
    match?.displayName ||
    match?.display_name ||
    match?.fullName ||
    match?.full_name
  );
  const email = normalizeText(match?.email);
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (email) return email;
  return `User ID #${normalizedUserId}`;
}

function buildAccountLabel(rows, accountId) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) return "-";
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => parsePositiveInt(row?.id) === normalizedAccountId
  );
  return buildCodeNameLabel(match, normalizedAccountId);
}

function buildOperatingUnitLabel(rows, operatingUnitId) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!normalizedOperatingUnitId) return "-";
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => parsePositiveInt(row?.id) === normalizedOperatingUnitId
  );
  return buildCodeNameLabel(match, normalizedOperatingUnitId);
}

function buildOperatingUnitIdentityLabel(code, name, id) {
  return buildCodeNameLabel(
    {
      code,
      name,
    },
    id
  );
}

function buildCariDocumentLabel(document, idFallback) {
  if (!document) {
    const normalizedId = parsePositiveInt(idFallback);
    return normalizedId ? `Record ID #${normalizedId}` : "-";
  }
  const documentNo = normalizeText(document?.documentNo);
  const documentDate = normalizeText(document?.documentDate);
  if (documentNo && documentDate) {
    return `${documentNo} · ${documentDate}`;
  }
  return documentNo || documentDate || `Record ID #${idFallback}`;
}

function buildCariLineLabel(document, lineId) {
  const normalizedLineId = parsePositiveInt(lineId);
  if (!normalizedLineId) return "-";
  if (!document) return `Line record ID #${normalizedLineId}`;
  const line = (Array.isArray(document?.lines) ? document.lines : []).find(
    (candidate) => parsePositiveInt(candidate?.id) === normalizedLineId
  );
  if (!line) return `Line record ID #${normalizedLineId}`;
  const lineNo = Number(line?.lineNo || 0);
  const description = normalizeText(line?.description);
  if (lineNo > 0 && description) {
    return `Line ${lineNo} - ${description}`;
  }
  if (lineNo > 0) {
    return `Line ${lineNo}`;
  }
  return description || `#${normalizedLineId}`;
}

/**
 * Render the fixed-asset detail workspace, including the Track 43 retro owner
 * correction workflow, corrected owner timeline, and grouped correction audit.
 */
export default function FixedAssetDetailPage() {
  const { assetId } = useParams();
  const [searchParams] = useSearchParams();
  const { l, t } = useI18n();
  const { hasPermission } = useAuth();
  const saleFlowSectionRef = useRef(null);
  const canRead = hasPermission("fixed_assets.read");
  const canUpsert = hasPermission("fixed_assets.upsert");
  const canPost = hasPermission("fixed_assets.post");
  const canDispose = hasPermission("fixed_assets.dispose");
  const canTransfer = hasPermission("fixed_assets.transfer");
  const canReadCariDocuments = hasPermission("cari.doc.read");
  const canCreateCariDocuments = hasPermission("cari.doc.create");

  // Deep-link query params: tab and transactionId
  const queryTab = searchParams.get("tab");
  const queryTransactionId = parsePositiveInt(searchParams.get("transactionId"));

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initialTab = VALID_DETAIL_TABS.has(queryTab) ? queryTab : "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Transaction list state (loaded when transactions tab is active)
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [reversingTransactionId, setReversingTransactionId] = useState(null);
  const [transactionActionError, setTransactionActionError] = useState("");
  const [transactionActionSuccess, setTransactionActionSuccess] = useState("");

  // Depreciation schedule state
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [legacySaleFallbackOpen, setLegacySaleFallbackOpen] = useState(false);
  const [saleFlowOpen, setSaleFlowOpen] = useState(false);
  const [legacySaleFallbackForm, setLegacySaleFallbackForm] = useState(
    createInitialLegacySaleFallbackForm()
  );
  const [legacySaleFallbackSaving, setLegacySaleFallbackSaving] = useState(false);
  const [legacySaleFallbackError, setLegacySaleFallbackError] = useState("");
  const [legacySaleFallbackResult, setLegacySaleFallbackResult] = useState(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationForm, setActivationForm] = useState(() => buildActivationForm());
  const [activationSaving, setActivationSaving] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [activationSuccess, setActivationSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionWarning, setActionWarning] = useState("");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendForm, setSuspendForm] = useState(() => buildLifecycleNoteForm());
  const [suspendSaving, setSuspendSaving] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reactivateForm, setReactivateForm] = useState(() => buildLifecycleNoteForm());
  const [reactivateSaving, setReactivateSaving] = useState(false);
  const [physicalMoveOpen, setPhysicalMoveOpen] = useState(false);
  const [physicalMoveForm, setPhysicalMoveForm] = useState(() => buildPhysicalMoveForm());
  const [physicalMoveSaving, setPhysicalMoveSaving] = useState(false);
  const [ownershipTransferOpen, setOwnershipTransferOpen] = useState(false);
  const [ownershipTransferForm, setOwnershipTransferForm] = useState(() => buildOwnershipTransferForm());
  const [ownershipTransferSaving, setOwnershipTransferSaving] = useState(false);
  const [retroCorrectionOpen, setRetroCorrectionOpen] = useState(false);
  const [retroCorrectionForm, setRetroCorrectionForm] = useState(() => buildRetroOwnershipCorrectionForm());
  const [retroCorrectionPreviewResult, setRetroCorrectionPreviewResult] = useState(null);
  const [retroCorrectionPreviewLoading, setRetroCorrectionPreviewLoading] = useState(false);
  const [retroCorrectionSaving, setRetroCorrectionSaving] = useState(false);
  const [retroCorrectionError, setRetroCorrectionError] = useState("");
  const [retroCorrectionReroute, setRetroCorrectionReroute] = useState(null);
  const [writeoffOpen, setWriteoffOpen] = useState(false);
  const [writeoffForm, setWriteoffForm] = useState(() => buildWriteoffForm());
  const [writeoffSaving, setWriteoffSaving] = useState(false);
  const [assetEvidenceRows, setAssetEvidenceRows] = useState([]);
  const [assetEvidenceLoading, setAssetEvidenceLoading] = useState(false);
  const [assetEvidenceError, setAssetEvidenceError] = useState("");
  const [assetEvidenceMessage, setAssetEvidenceMessage] = useState("");
  const [assetEvidenceUploadFile, setAssetEvidenceUploadFile] = useState(null);
  const [assetEvidenceNote, setAssetEvidenceNote] = useState("");
  const [assetEvidenceUploading, setAssetEvidenceUploading] = useState(false);
  const [assetEvidenceUploadInputKey, setAssetEvidenceUploadInputKey] = useState(0);
  const [assetEvidenceDownloadingId, setAssetEvidenceDownloadingId] = useState(null);
  const [assetEvidenceDeletingId, setAssetEvidenceDeletingId] = useState(null);
  const [sourceDocumentEvidenceRows, setSourceDocumentEvidenceRows] = useState([]);
  const [sourceDocumentEvidenceLoading, setSourceDocumentEvidenceLoading] = useState(false);
  const [sourceDocumentEvidenceError, setSourceDocumentEvidenceError] = useState("");
  const [sourceDocumentEvidenceDownloadingId, setSourceDocumentEvidenceDownloadingId] = useState(null);
  const [accountRows, setAccountRows] = useState([]);
  const [operatingUnitRows, setOperatingUnitRows] = useState([]);
  const [custodianRows, setCustodianRows] = useState([]);
  const [sourceCariDocument, setSourceCariDocument] = useState(null);
  const [userRows, setUserRows] = useState([]);

  useEffect(() => {
    if (!canRead || !assetId) { setAsset(null); return; }
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getFixedAsset(assetId);
        if (active) setAsset(res);
      } catch (err) {
        if (active) {
          setAsset(null);
          setError(normalizeApiError(err, l("Failed to load asset.", "Demirbas yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, assetId, l]);

  // Load transactions when transactions tab is active
  useEffect(() => {
    if (!canRead || !assetId || activeTab !== "transactions") return;
    let active = true;
    (async () => {
      setTransactionsLoading(true);
      setTransactionsError("");
      try {
        const res = await listFixedAssetTransactions(assetId);
        if (active) setTransactions(res.rows || []);
      } catch (err) {
        if (active) {
          setTransactions([]);
          setTransactionsError(
            normalizeApiError(err, l("Failed to load transactions.", "Hareketler yuklenemedi."))
          );
        }
      } finally {
        if (active) setTransactionsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, assetId, activeTab, l]);

  // Load depreciation schedule when depreciation tab is active
  useEffect(() => {
    if (!canRead || !assetId || activeTab !== "depreciation") return;
    let active = true;
    (async () => {
      setScheduleLoading(true);
      setScheduleError("");
      try {
        const res = await getFixedAssetDepreciationSchedule(assetId);
        if (active) setSchedule(res.rows || []);
      } catch (err) {
        if (active) {
          setSchedule([]);
          setScheduleError(
            normalizeApiError(err, l("Failed to load schedule.", "Amortisman plani yuklenemedi."))
          );
        }
      } finally {
        if (active) setScheduleLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, assetId, activeTab, l]);

  useEffect(() => {
    setLegacySaleFallbackOpen(false);
    setSaleFlowOpen(false);
    setLegacySaleFallbackError("");
    setLegacySaleFallbackResult(null);
    setLegacySaleFallbackForm(createInitialLegacySaleFallbackForm());
    setActivationOpen(false);
    setActivationError("");
    setActivationSuccess("");
    setActivationForm(buildActivationForm(asset));
    setActionError("");
    setActionSuccess("");
    setActionWarning("");
    setSuspendOpen(false);
    setSuspendForm(buildLifecycleNoteForm());
    setSuspendSaving(false);
    setReactivateOpen(false);
    setReactivateForm(buildLifecycleNoteForm());
    setReactivateSaving(false);
    setPhysicalMoveOpen(false);
    setPhysicalMoveForm(buildPhysicalMoveForm(asset));
    setPhysicalMoveSaving(false);
    setOwnershipTransferOpen(false);
    setOwnershipTransferForm(buildOwnershipTransferForm(asset));
    setOwnershipTransferSaving(false);
    setRetroCorrectionOpen(false);
    setRetroCorrectionForm(buildRetroOwnershipCorrectionForm());
    setRetroCorrectionPreviewResult(null);
    setRetroCorrectionPreviewLoading(false);
    setRetroCorrectionSaving(false);
    setRetroCorrectionError("");
    setRetroCorrectionReroute(null);
    setWriteoffOpen(false);
    setWriteoffForm(buildWriteoffForm());
    setWriteoffSaving(false);
    setReversingTransactionId(null);
    setTransactionActionError("");
    setTransactionActionSuccess("");
    setAssetEvidenceRows([]);
    setAssetEvidenceLoading(false);
    setAssetEvidenceError("");
    setAssetEvidenceMessage("");
    setAssetEvidenceUploadFile(null);
    setAssetEvidenceNote("");
    setAssetEvidenceUploading(false);
    setAssetEvidenceUploadInputKey((prev) => prev + 1);
    setAssetEvidenceDownloadingId(null);
    setAssetEvidenceDeletingId(null);
    setSourceDocumentEvidenceRows([]);
    setSourceDocumentEvidenceLoading(false);
    setSourceDocumentEvidenceError("");
    setSourceDocumentEvidenceDownloadingId(null);
  }, [asset]);

  useEffect(() => {
    const legalEntityId = parsePositiveInt(asset?.legalEntityId);
    if (!legalEntityId) {
      setAccountRows([]);
      setOperatingUnitRows([]);
      setCustodianRows([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [accountResponse, operatingUnitResponse, custodianResponse] = await Promise.all([
          listAccounts({
            legalEntityId,
            includeInactive: true,
            limit: 1000,
          }),
          listOperatingUnits({ legalEntityId, limit: 500 }),
          listFixedAssetCustodians({
            legalEntityId,
            status: "ACTIVE",
          }),
        ]);
        if (!active) return;
        setAccountRows(Array.isArray(accountResponse?.rows) ? accountResponse.rows : []);
        setOperatingUnitRows(Array.isArray(operatingUnitResponse?.rows) ? operatingUnitResponse.rows : []);
        setCustodianRows(Array.isArray(custodianResponse?.rows) ? custodianResponse.rows : []);
      } catch {
        if (!active) return;
        setAccountRows([]);
        setOperatingUnitRows([]);
        setCustodianRows([]);
      }
    })();
    return () => { active = false; };
  }, [asset?.legalEntityId]);

  useEffect(() => {
    const documentId = parsePositiveInt(asset?.sourceCariDocumentId);
    if (!documentId || !canReadCariDocuments) {
      setSourceCariDocument(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const response = await getCariDocument(documentId);
        if (active) {
          setSourceCariDocument(response || null);
        }
      } catch {
        if (active) {
          setSourceCariDocument(null);
        }
      }
    })();
    return () => { active = false; };
  }, [asset?.sourceCariDocumentId, canReadCariDocuments]);

  useEffect(() => {
    if (!canRead || !assetId || activeTab !== "evidence") return;
    let active = true;
    (async () => {
      setAssetEvidenceLoading(true);
      setAssetEvidenceError("");
      try {
        const response = await listFixedAssetEvidence("asset", assetId);
        if (!active) return;
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setAssetEvidenceRows(rows);
        setAsset((prev) => (
          prev
            ? {
                ...prev,
                evidenceSummary: {
                  ...(prev.evidenceSummary || {}),
                  totalCount: rows.length,
                },
              }
            : prev
        ));
      } catch (err) {
        if (!active) return;
        setAssetEvidenceRows([]);
        setAssetEvidenceError(
          normalizeApiError(err, l("Failed to load evidence.", "Kanitlar yuklenemedi."))
        );
      } finally {
        if (active) {
          setAssetEvidenceLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [activeTab, assetId, canRead, l]);

  useEffect(() => {
    const documentId = parsePositiveInt(asset?.sourceCariDocumentId);
    if (activeTab !== "evidence" || !documentId || !canReadCariDocuments) {
      setSourceDocumentEvidenceRows([]);
      setSourceDocumentEvidenceLoading(false);
      setSourceDocumentEvidenceError("");
      return;
    }
    let active = true;
    (async () => {
      setSourceDocumentEvidenceLoading(true);
      setSourceDocumentEvidenceError("");
      try {
        const response = await listCariDocumentEvidence(documentId);
        if (!active) return;
        setSourceDocumentEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (!active) return;
        setSourceDocumentEvidenceRows([]);
        setSourceDocumentEvidenceError(
          normalizeApiError(
            err,
            l("Failed to load source document evidence.", "Kaynak belge kanitlari yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setSourceDocumentEvidenceLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [activeTab, asset?.sourceCariDocumentId, canReadCariDocuments, l]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await listUsers();
        if (active) {
          setUserRows(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (active) {
          setUserRows([]);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  // Focused transaction (highlighted from deep-link)
  const focusedTransactionId = queryTransactionId;

  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Missing permission: fixed_assets.read", "Eksik yetki: fixed_assets.read")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
        <Link to="/app/demirbas-karti-listesi" className="text-sm text-cyan-700 hover:underline">
          {l("Back to register", "Listeye don")}
        </Link>
      </div>
    );
  }

  if (!asset) return null;

  const tabs = [
    { key: "overview", label: l("Overview", "Genel Bakis") },
    { key: "accounting", label: l("Accounting", "Muhasebe") },
    { key: "depreciation", label: l("Depreciation", "Amortisman") },
    { key: "transactions", label: l("Transactions", "Hareketler") },
    { key: "evidence", label: l("Evidence", "Kanit") },
    { key: "audit", label: l("Audit Trail", "Denetim Izi") },
  ];

  const status = String(asset.status || "").toUpperCase();
  const statusColor =
    status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" :
    status === "DISPOSED" ? "bg-rose-100 text-rose-800" :
    status === "CANCELLED" ? "bg-slate-200 text-slate-700" :
    status === "SUSPENDED" ? "bg-amber-100 text-amber-800" :
    status === "FULLY_DEPRECIATED" ? "bg-blue-100 text-blue-800" :
    "bg-slate-100 text-slate-700";
  const isSaleEligibleStatus = SALE_ELIGIBLE_STATUSES.has(status);
  const isMoveEligibleStatus = MOVE_ELIGIBLE_STATUSES.has(status);
  const isWriteoffEligibleStatus = WRITEOFF_ELIGIBLE_STATUSES.has(status);
  const canOpenCariSaleFlow = canReadCariDocuments && canCreateCariDocuments;
  const canUseLegacySaleFallback = canDispose && canCreateCariDocuments;
  const canManageAssetEvidence = canUpsert;
  const normalizedAssetId = parsePositiveInt(asset?.id);
  const normalizedSourceCariDocumentId = parsePositiveInt(asset?.sourceCariDocumentId);
  const ownerOperatingUnitLabel = buildOperatingUnitLabel(
    operatingUnitRows,
    asset.ownerOperatingUnitId
  );
  const locationOperatingUnitLabel = buildOperatingUnitLabel(
    operatingUnitRows,
    asset.locationOperatingUnitId
  );
  const assetAccountLabel = buildAccountLabel(accountRows, asset.assetAccountId);
  const accumDeprAccountLabel = buildAccountLabel(accountRows, asset.accumDeprAccountId);
  const deprExpenseAccountLabel = buildAccountLabel(accountRows, asset.deprExpenseAccountId);
  const disposalGainAccountLabel = buildAccountLabel(accountRows, asset.disposalGainAccountId);
  const disposalLossAccountLabel = buildAccountLabel(accountRows, asset.disposalLossAccountId);
  const sourceCariDirection = normalizeText(sourceCariDocument?.direction).toUpperCase() || "AP";
  const sourceCariDocumentLabel = buildCariDocumentLabel(
    sourceCariDocument,
    asset.sourceCariDocumentId
  );
  const sourceCariLineLabel = buildCariLineLabel(
    sourceCariDocument,
    asset.sourceCariDocumentLineId
  );
  const sourceCariDocumentPath = normalizedSourceCariDocumentId
    ? buildCariDocumentPath(normalizedSourceCariDocumentId, sourceCariDirection)
    : null;
  const createdByLabel = buildUserLabel(userRows, asset.createdByUserId);
  const updatedByLabel = buildUserLabel(userRows, asset.updatedByUserId);
  const operatingUnitOptions = operatingUnitRows
    .map((row) => mapCodeNameOption(row))
    .filter(Boolean);
  const ownershipTargetOwnerOptions = operatingUnitOptions.filter(
    (option) => parsePositiveInt(option.value) !== parsePositiveInt(asset.ownerOperatingUnitId)
  );
  // Retro correction can replace an earlier correction while keeping the same
  // current owner OU, so V1 must not exclude the asset master owner here.
  const retroCorrectionTargetOwnerOptions = operatingUnitOptions;
  const custodianOptions = custodianRows.map(mapCustodianOption).filter(Boolean);
  const retroCorrectionPreviewResolutionMode = normalizeUpperText(
    retroCorrectionPreviewResult?.resolutionMode
  );
  const retroCorrectionPreviewMatchesForm = doesRetroOwnershipCorrectionPreviewMatchForm(
    retroCorrectionPreviewResult,
    retroCorrectionForm
  );
  const retroCorrectionImpactedPeriods = Array.isArray(
    retroCorrectionPreviewResult?.impactedPostedPeriods
  )
    ? retroCorrectionPreviewResult.impactedPostedPeriods
    : [];
  const retroCorrectionChronologyBlockers = Array.isArray(
    retroCorrectionPreviewResult?.chronologyBlockers
  )
    ? retroCorrectionPreviewResult.chronologyBlockers
    : [];
  const retroCorrectionCanPost =
    retroCorrectionPreviewResolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED"
    && retroCorrectionPreviewMatchesForm
    && !retroCorrectionPreviewLoading
    && !retroCorrectionSaving;
  const retroCorrectionSourceOwnerLabel = buildOperatingUnitLabel(
    operatingUnitRows,
    retroCorrectionPreviewResult?.fromOwnerOperatingUnitId
  );
  const retroCorrectionTargetOwnerLabel = buildOperatingUnitLabel(
    operatingUnitRows,
    retroCorrectionPreviewResult?.targetOwnerOperatingUnitId
      ?? retroCorrectionForm.targetOwnerOperatingUnitId
  );
  const retroCorrectionRerouteLocationOperatingUnitId = parsePositiveInt(
    retroCorrectionReroute?.targetLocationOperatingUnitId
  );
  const retroCorrectionRerouteLocationLabel = retroCorrectionRerouteLocationOperatingUnitId
    ? buildOperatingUnitLabel(
        operatingUnitRows,
        retroCorrectionRerouteLocationOperatingUnitId
      )
    : "-";
  const activationAssetTagMissing = !normalizeText(activationForm.assetTag);
  const activationSerialNoMissing = !normalizeText(activationForm.serialNo);
  const assetEvidenceCount = assetEvidenceLoading
    ? Number(asset.evidenceSummary?.totalCount ?? 0)
    : assetEvidenceRows.length;
  const sourceDocumentEvidenceCount = sourceDocumentEvidenceLoading
    ? sourceDocumentEvidenceRows.length
    : sourceDocumentEvidenceRows.length;
  const capitalizationDateHelpText = l(
    "Example: invoice date is March 5, but the machine is installed and capitalized on March 20. Bill date can stay as acquisition date, while capitalization date becomes March 20.",
    "Ornek: fatura tarihi 5 Mart, ancak makine 20 Mart'ta kurulup aktiflestiriliyor. Fatura tarihi alim tarihi olarak kalabilir; aktiflesme tarihi ise 20 Mart olur."
  );
  const pendingSkippedDepreciation = asset.pendingSkippedDepreciation || {};
  const pendingSkippedDepreciationCount = Number(
    pendingSkippedDepreciation.totalCount ?? 0
  );
  const pendingSkippedDepreciationLatestRunId = parsePositiveInt(
    pendingSkippedDepreciation.latestRunId
  );
  const pendingSkippedDepreciationLatestRunPath = pendingSkippedDepreciationLatestRunId
    ? `/app/demirbas-amortisman-islemleri?runId=${pendingSkippedDepreciationLatestRunId}`
    : "/app/demirbas-amortisman-islemleri";
  const pendingSkippedDepreciationPeriodLabel = buildSkippedPeriodRangeLabel(
    pendingSkippedDepreciation
  );
  const pendingSkippedDepreciationReviewRecommended = Boolean(
    pendingSkippedDepreciation.reviewRecommended
  );
  const retroOwnershipCorrectionHistory = Array.isArray(
    asset.retroOwnershipCorrectionHistory
  )
    ? asset.retroOwnershipCorrectionHistory
    : [];
  const retroCorrectedOwnerTimeline = asset.retroCorrectedOwnerTimeline
    && typeof asset.retroCorrectedOwnerTimeline === "object"
    ? asset.retroCorrectedOwnerTimeline
    : null;
  const retroCorrectedOwnerRanges = Array.isArray(retroCorrectedOwnerTimeline?.ranges)
    ? retroCorrectedOwnerTimeline.ranges
    : [];
  const retroCorrectedOwnerEvents = Array.isArray(retroCorrectedOwnerTimeline?.events)
    ? retroCorrectedOwnerTimeline.events
    : [];
  const retroCorrectedOwnerCurrentLabel = buildOperatingUnitIdentityLabel(
    retroCorrectedOwnerTimeline?.currentOwnerOuCode,
    retroCorrectedOwnerTimeline?.currentOwnerOuName,
    retroCorrectedOwnerTimeline?.currentOwnerOperatingUnitId
  );

  function resetActionFeedback() {
    setActionError("");
    setActionSuccess("");
    setActionWarning("");
  }

  function resetRetroCorrectionWorkflow(nextForm = buildRetroOwnershipCorrectionForm(), nextReroute = null) {
    setRetroCorrectionForm(nextForm);
    setRetroCorrectionPreviewResult(null);
    setRetroCorrectionError("");
    setRetroCorrectionReroute(nextReroute);
  }

  function updateRetroCorrectionFormField(field, value) {
    setRetroCorrectionForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    if (field !== "note") {
      setRetroCorrectionPreviewResult(null);
      setRetroCorrectionError("");
    }
  }

  function closeLifecyclePanels() {
    setSuspendOpen(false);
    setReactivateOpen(false);
    setPhysicalMoveOpen(false);
    setOwnershipTransferOpen(false);
    setRetroCorrectionOpen(false);
    setWriteoffOpen(false);
    setSaleFlowOpen(false);
    setLegacySaleFallbackOpen(false);
  }

  function openSuspendPanel() {
    closeLifecyclePanels();
    setSuspendForm(buildLifecycleNoteForm());
    resetActionFeedback();
    setSuspendOpen(true);
  }

  function openReactivatePanel() {
    closeLifecyclePanels();
    setReactivateForm(buildLifecycleNoteForm());
    resetActionFeedback();
    setReactivateOpen(true);
  }

  function openPhysicalMovePanel() {
    closeLifecyclePanels();
    setPhysicalMoveForm(buildPhysicalMoveForm(asset));
    resetActionFeedback();
    setPhysicalMoveOpen(true);
  }

  function openOwnershipTransferPanel(overrides = null) {
    closeLifecyclePanels();
    setOwnershipTransferForm(buildOwnershipTransferForm(asset, overrides || {}));
    resetActionFeedback();
    setOwnershipTransferOpen(true);
  }

  function openRetroCorrectionPanel({
    formOverrides = null,
    rerouteContext = null,
  } = {}) {
    closeLifecyclePanels();
    resetActionFeedback();
    resetRetroCorrectionWorkflow(
      buildRetroOwnershipCorrectionForm(formOverrides || {}),
      rerouteContext
    );
    setRetroCorrectionOpen(true);
  }

  function closeRetroCorrectionPanel() {
    setRetroCorrectionOpen(false);
    resetRetroCorrectionWorkflow(buildRetroOwnershipCorrectionForm(), null);
    resetActionFeedback();
  }

  function openWriteoffPanel() {
    closeLifecyclePanels();
    setWriteoffForm(buildWriteoffForm());
    resetActionFeedback();
    setWriteoffOpen(true);
  }

  function focusSaleFlowPanel() {
    closeLifecyclePanels();
    resetActionFeedback();
    setLegacySaleFallbackError("");
    setLegacySaleFallbackResult(null);
    setLegacySaleFallbackOpen(false);
    setSaleFlowOpen(true);
    window.setTimeout(() => {
      saleFlowSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function refreshAssetEvidenceRows(targetAssetId = asset?.id) {
    const evidenceAssetId = parsePositiveInt(targetAssetId);
    if (!evidenceAssetId) {
      setAssetEvidenceRows([]);
      return [];
    }
    const response = await listFixedAssetEvidence("asset", evidenceAssetId);
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    setAssetEvidenceRows(rows);
    setAsset((prev) => (
      prev
        ? {
            ...prev,
            evidenceSummary: {
              ...(prev.evidenceSummary || {}),
              totalCount: rows.length,
            },
          }
        : prev
    ));
    return rows;
  }

  async function handleAttachAssetEvidence(event) {
    event.preventDefault();
    if (!normalizedAssetId || !canManageAssetEvidence) {
      setAssetEvidenceError(
        l(
          "Evidence attach requires a valid asset and permission: fixed_assets.upsert.",
          "Kanit eklemek icin gecerli demirbas ve `fixed_assets.upsert` yetkisi gerekir."
        )
      );
      return;
    }
    if (!assetEvidenceUploadFile) {
      setAssetEvidenceError(
        l("Select a file before attaching evidence.", "Kanit eklemeden once dosya secin.")
      );
      return;
    }

    setAssetEvidenceUploading(true);
    setAssetEvidenceError("");
    setAssetEvidenceMessage("");
    try {
      const draftResponse = await createFixedAssetEvidence("asset", normalizedAssetId, {
        fileName: assetEvidenceUploadFile.name || "evidence.bin",
        contentType: assetEvidenceUploadFile.type || undefined,
        displayName: assetEvidenceUploadFile.name || undefined,
        note: normalizeText(assetEvidenceNote) || undefined,
      });
      const evidenceId = parsePositiveInt(draftResponse?.row?.id);
      if (!evidenceId) {
        throw new Error(
          l("Evidence create response is missing id.", "Kanit olusturma yanitinda id yok.")
        );
      }

      await uploadFixedAssetEvidenceContent(
        "asset",
        normalizedAssetId,
        evidenceId,
        assetEvidenceUploadFile,
        assetEvidenceUploadFile.type || "application/octet-stream"
      );

      await refreshAssetEvidenceRows(normalizedAssetId);
      setAssetEvidenceMessage(
        l(`Evidence attached. id=${evidenceId}`, `Kanit eklendi. id=${evidenceId}`)
      );
      setAssetEvidenceNote("");
      setAssetEvidenceUploadFile(null);
      setAssetEvidenceUploadInputKey((prev) => prev + 1);
    } catch (err) {
      await refreshAssetEvidenceRows(normalizedAssetId).catch(() => {});
      setAssetEvidenceError(
        normalizeApiError(err, l("Failed to attach evidence.", "Kanit eklenemedi."))
      );
    } finally {
      setAssetEvidenceUploading(false);
    }
  }

  async function handleDownloadAssetEvidence(row) {
    const evidenceId = parsePositiveInt(row?.id);
    if (!normalizedAssetId || !evidenceId) {
      setAssetEvidenceError(l("Evidence id is invalid.", "Kanit id gecersiz."));
      return;
    }
    setAssetEvidenceDownloadingId(evidenceId);
    setAssetEvidenceError("");
    try {
      const response = await downloadFixedAssetEvidence("asset", normalizedAssetId, evidenceId);
      const blob = response?.blob;
      if (!(blob instanceof Blob)) {
        throw new Error(
          l("Evidence download payload is invalid.", "Kanit indirme yuklemi gecersiz.")
        );
      }
      triggerBlobDownload(blob, response?.fileName || row?.fileName || `evidence-${evidenceId}.bin`);
    } catch (err) {
      setAssetEvidenceError(
        normalizeApiError(err, l("Failed to download evidence.", "Kanit indirilemedi."))
      );
    } finally {
      setAssetEvidenceDownloadingId(null);
    }
  }

  async function refreshTransactions(targetAssetId = asset?.id) {
    const normalizedTargetAssetId = parsePositiveInt(targetAssetId);
    if (!normalizedTargetAssetId) {
      setTransactions([]);
      return [];
    }
    const response = await listFixedAssetTransactions(normalizedTargetAssetId);
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    setTransactions(rows);
    return rows;
  }

  async function refreshAssetDetail(targetAssetId = asset?.id) {
    const normalizedTargetAssetId = parsePositiveInt(targetAssetId);
    if (!normalizedTargetAssetId) {
      setAsset(null);
      return null;
    }
    const response = await getFixedAsset(normalizedTargetAssetId);
    setAsset(response || null);
    return response || null;
  }

  async function handleReverseTransaction(row) {
    const transactionId = parsePositiveInt(row?.id);
    if (!transactionId) {
      setTransactionActionError(
        l("Transaction record is missing.", "Hareket kaydi eksik.")
      );
      return;
    }
    if (!canReverseFixedAssetTransactionRow(row, {
      canPost,
      canDispose,
      canTransfer,
    })) {
      setTransactionActionError(
        l(
          "You do not have permission to reverse this transaction, or the transaction is not eligible for standalone reversal.",
          "Bu hareketi ters kayitlamak icin yetkiniz yok veya hareket tek basina ters kayit icin uygun degil."
        )
      );
      return;
    }

    const confirmed = window.confirm(
      l(
        `Reverse fixed-asset transaction #${transactionId}?`,
        `#${transactionId} numarali demirbas hareketi ters kayitlansin mi?`
      )
    );
    if (!confirmed) {
      return;
    }

    const noteInput = window.prompt(
      l(
        "Optional reversal note",
        "Opsiyonel ters kayit notu"
      ),
      l("Mistaken transaction", "Yanlis hareket")
    );
    if (noteInput === null) {
      return;
    }

    setReversingTransactionId(transactionId);
    setTransactionActionError("");
    setTransactionActionSuccess("");
    try {
      const response = await reverseFixedAssetTransaction(transactionId, {
        note: normalizeText(noteInput) || null,
      });
      setAsset(response || null);
      await refreshTransactions(normalizedAssetId);
      setTransactionActionSuccess(
        l(
          `Transaction #${transactionId} reversed successfully.`,
          `#${transactionId} numarali hareket basariyla ters kayitlandi.`
        )
      );
    } catch (err) {
      setTransactionActionError(
        normalizeApiError(
          err,
          l(
            "Failed to reverse fixed-asset transaction.",
            "Demirbas hareketi ters kayitlanamadi."
          )
        )
      );
    } finally {
      setReversingTransactionId(null);
    }
  }

  async function handleDeleteAssetEvidence(evidenceIdRaw) {
    const evidenceId = parsePositiveInt(evidenceIdRaw);
    if (!normalizedAssetId || !evidenceId || !canManageAssetEvidence) {
      setAssetEvidenceError(
        l(
          "Evidence delete requires a valid asset, evidence id, and fixed_assets.upsert permission.",
          "Kanit silmek icin gecerli demirbas, kanit id ve `fixed_assets.upsert` yetkisi gerekir."
        )
      );
      return;
    }
    setAssetEvidenceDeletingId(evidenceId);
    setAssetEvidenceError("");
    setAssetEvidenceMessage("");
    try {
      await deleteFixedAssetEvidence("asset", normalizedAssetId, evidenceId);
      await refreshAssetEvidenceRows(normalizedAssetId);
      setAssetEvidenceMessage(
        l(`Evidence deleted. id=${evidenceId}`, `Kanit silindi. id=${evidenceId}`)
      );
    } catch (err) {
      setAssetEvidenceError(
        normalizeApiError(err, l("Failed to delete evidence.", "Kanit silinemedi."))
      );
    } finally {
      setAssetEvidenceDeletingId(null);
    }
  }

  async function handleDownloadSourceDocumentEvidence(row) {
    const evidenceId = parsePositiveInt(row?.id);
    if (!normalizedSourceCariDocumentId || !evidenceId) {
      setSourceDocumentEvidenceError(l("Evidence id is invalid.", "Kanit id gecersiz."));
      return;
    }
    setSourceDocumentEvidenceDownloadingId(evidenceId);
    setSourceDocumentEvidenceError("");
    try {
      const response = await downloadCariDocumentEvidence(normalizedSourceCariDocumentId, evidenceId);
      const blob = response?.blob;
      if (!(blob instanceof Blob)) {
        throw new Error(
          l("Evidence download payload is invalid.", "Kanit indirme yuklemi gecersiz.")
        );
      }
      triggerBlobDownload(blob, response?.fileName || row?.fileName || `evidence-${evidenceId}.bin`);
    } catch (err) {
      setSourceDocumentEvidenceError(
        normalizeApiError(
          err,
          l("Failed to download source document evidence.", "Kaynak belge kaniti indirilemedi.")
        )
      );
    } finally {
      setSourceDocumentEvidenceDownloadingId(null);
    }
  }

  async function handleCreateLegacySaleFallbackDraft() {
    const counterpartyId = parsePositiveInt(legacySaleFallbackForm.counterpartyId);
    const saleAmountTxn = Number(legacySaleFallbackForm.saleAmountTxn);
    const documentDate = String(legacySaleFallbackForm.documentDate || "").trim();

    if (!normalizedAssetId) {
      setLegacySaleFallbackError(
        t("fixedAssets.detail.legacySaleFallbackMissingAsset")
      );
      return;
    }
    if (!counterpartyId) {
      setLegacySaleFallbackError(
        t("fixedAssets.detail.legacySaleFallbackCounterpartyRequired")
      );
      return;
    }
    if (!documentDate) {
      setLegacySaleFallbackError(
        t("fixedAssets.detail.legacySaleFallbackDocumentDateRequired")
      );
      return;
    }
    if (!Number.isFinite(saleAmountTxn) || saleAmountTxn <= 0) {
      setLegacySaleFallbackError(
        t("fixedAssets.detail.legacySaleFallbackAmountRequired")
      );
      return;
    }

    setLegacySaleFallbackSaving(true);
    setLegacySaleFallbackError("");
    setLegacySaleFallbackResult(null);
    try {
      const response = await saleCreateDraftAr(normalizedAssetId, {
        counterpartyId,
        documentDate,
        saleAmountTxn,
      });
      const pendingSaleCariDocumentId = parsePositiveInt(
        response?.pendingSaleCariDocumentId
      );
      const pendingSaleCariDocumentLineId = parsePositiveInt(
        response?.pendingSaleCariDocumentLineId
      );
      setLegacySaleFallbackResult({
        pendingSaleCariDocumentId,
        pendingSaleCariDocumentLineId,
      });
      setLegacySaleFallbackOpen(false);
    } catch (err) {
      setLegacySaleFallbackError(
        normalizeApiError(
          err,
          t("fixedAssets.detail.legacySaleFallbackCreateFailed")
        )
      );
    } finally {
      setLegacySaleFallbackSaving(false);
    }
  }

  async function handleActivateAsset() {
    const normalizedAssetId = parsePositiveInt(asset?.id);
    if (!normalizedAssetId) {
      setActivationError(
        l("Asset record is missing.", "Demirbas kaydi eksik.")
      );
      return;
    }

    const postingDate = normalizeText(activationForm.postingDate);
    const capitalizationDate = normalizeText(activationForm.capitalizationDate);
    const inServiceDate = normalizeText(activationForm.inServiceDate);
    const assetTag = normalizeText(activationForm.assetTag);
    const serialNo = normalizeText(activationForm.serialNo);
    const custodianEmployeeId = parsePositiveInt(activationForm.custodianEmployeeId);

    if (!postingDate || !capitalizationDate || !inServiceDate) {
      setActivationError(
        l(
          "Posting date, capitalization date, and in-service date are required.",
          "Kayit tarihi, aktiflesme tarihi ve hizmete giris tarihi zorunludur."
        )
      );
      return;
    }
    if (!assetTag) {
      setActivationError(
        l(
          "Asset tag is required before activation.",
          "Aktiflestirme oncesinde varlik etiketi zorunludur."
        )
      );
      return;
    }

    setActivationSaving(true);
    setActivationError("");
    setActivationSuccess("");
    try {
      const response = await activateFixedAsset(normalizedAssetId, {
        postingDate,
        capitalizationDate,
        inServiceDate,
        assetTag,
        serialNo: serialNo || null,
        custodianEmployeeId: custodianEmployeeId || null,
      });
      setAsset(response || null);
      setActivationOpen(false);
      setActivationSuccess(
        l(
          "Asset activated successfully.",
          "Demirbas basariyla aktiflestirildi."
        )
      );
      setActiveTab("overview");
    } catch (err) {
      setActivationError(
        normalizeApiError(
          err,
          l("Failed to activate asset.", "Demirbas aktiflestirilemedi.")
        )
      );
    } finally {
      setActivationSaving(false);
    }
  }

  async function handleSuspendAsset() {
    if (!normalizedAssetId) {
      setActionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }
    const effectiveDate = normalizeText(suspendForm.effectiveDate);
    if (!effectiveDate) {
      setActionError(l("Effective date is required.", "Gecerlilik tarihi zorunludur."));
      return;
    }

    setSuspendSaving(true);
    resetActionFeedback();
    try {
      const response = await suspendFixedAsset(normalizedAssetId, {
        effectiveDate,
        note: normalizeText(suspendForm.note) || null,
      });
      setAsset(response || null);
      setSuspendOpen(false);
      setActionSuccess(l("Asset suspended successfully.", "Demirbas basariyla askiya alindi."));
      setActiveTab("overview");
    } catch (err) {
      setActionError(
        normalizeApiError(err, l("Failed to suspend asset.", "Demirbas askiya alinamadi."))
      );
    } finally {
      setSuspendSaving(false);
    }
  }

  async function handleReactivateAsset() {
    if (!normalizedAssetId) {
      setActionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }
    const effectiveDate = normalizeText(reactivateForm.effectiveDate);
    if (!effectiveDate) {
      setActionError(l("Effective date is required.", "Gecerlilik tarihi zorunludur."));
      return;
    }

    setReactivateSaving(true);
    resetActionFeedback();
    try {
      const response = await reactivateFixedAsset(normalizedAssetId, {
        effectiveDate,
        note: normalizeText(reactivateForm.note) || null,
      });
      const skippedSummary = response?.pendingSkippedDepreciation || {};
      const skippedCount = Number(skippedSummary.totalCount ?? 0);
      const skippedPeriodLabel = buildSkippedPeriodRangeLabel(skippedSummary);
      setAsset(response || null);
      setReactivateOpen(false);
      setActionSuccess(
        l("Asset reactivated successfully.", "Demirbas basariyla yeniden aktiflestirildi.")
      );
      if (skippedCount > 0) {
        setActionWarning(
          l(
            `Skipped depreciation months now need review and reprocess. Periods: ${skippedPeriodLabel}.`,
            `Atlanan amortisman donemleri artik gozden gecirilmeli ve yeniden islenmelidir. Donemler: ${skippedPeriodLabel}.`
          )
        );
      }
      setActiveTab("overview");
    } catch (err) {
      setActionError(
        normalizeApiError(
          err,
          l("Failed to reactivate asset.", "Demirbas yeniden aktiflestirilemedi.")
        )
      );
    } finally {
      setReactivateSaving(false);
    }
  }

  async function handlePhysicalMoveAsset() {
    if (!normalizedAssetId) {
      setActionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }

    const effectiveDate = normalizeText(physicalMoveForm.effectiveDate);
    const currentLocationValue = String(parsePositiveInt(asset?.locationOperatingUnitId) || "");
    const currentCustodianValue = String(parsePositiveInt(asset?.custodianEmployeeId) || "");
    const currentDepartmentCode = normalizeText(asset?.departmentCode);
    const currentCostCenterCode = normalizeText(asset?.costCenterCode);

    if (!effectiveDate) {
      setActionError(l("Effective date is required.", "Gecerlilik tarihi zorunludur."));
      return;
    }

    const payload = {
      effectiveDate,
      note: normalizeText(physicalMoveForm.note) || null,
    };
    let hasChange = false;

    if (physicalMoveForm.locationOperatingUnitId !== currentLocationValue) {
      const locationOperatingUnitId = parsePositiveInt(physicalMoveForm.locationOperatingUnitId);
      if (!locationOperatingUnitId) {
        setActionError(
          l(
            "Location operating unit cannot be empty for physical move.",
            "Fiziksel hareket icin lokasyon isletme birimi bos birakilamaz."
          )
        );
        return;
      }
      payload.locationOperatingUnitId = locationOperatingUnitId;
      hasChange = true;
    }

    if (physicalMoveForm.custodianEmployeeId !== currentCustodianValue) {
      payload.custodianEmployeeId = parsePositiveInt(physicalMoveForm.custodianEmployeeId) || null;
      hasChange = true;
    }

    if (normalizeText(physicalMoveForm.departmentCode) !== currentDepartmentCode) {
      payload.departmentCode = normalizeText(physicalMoveForm.departmentCode) || null;
      hasChange = true;
    }

    if (normalizeText(physicalMoveForm.costCenterCode) !== currentCostCenterCode) {
      payload.costCenterCode = normalizeText(physicalMoveForm.costCenterCode) || null;
      hasChange = true;
    }

    if (!hasChange) {
      setActionError(
        l(
          "Change at least one location or responsibility field before posting the move.",
          "Hareketi kaydetmeden once en az bir lokasyon veya sorumluluk alani degistirin."
        )
      );
      return;
    }

    setPhysicalMoveSaving(true);
    resetActionFeedback();
    try {
      const response = await physicalMoveAsset(normalizedAssetId, payload);
      setAsset(response || null);
      setPhysicalMoveOpen(false);
      setActionSuccess(
        l("Physical move posted successfully.", "Fiziksel hareket basariyla kaydedildi.")
      );
      setActiveTab("overview");
    } catch (err) {
      setActionError(
        normalizeApiError(
          err,
          l("Failed to post physical move.", "Fiziksel hareket kaydedilemedi.")
        )
      );
    } finally {
      setPhysicalMoveSaving(false);
    }
  }

  async function handleOwnershipTransferAsset() {
    if (!normalizedAssetId) {
      setActionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }

    const effectiveDate = normalizeText(ownershipTransferForm.effectiveDate);
    const postingDate = normalizeText(ownershipTransferForm.postingDate);
    const targetOwnerOperatingUnitId = parsePositiveInt(
      ownershipTransferForm.targetOwnerOperatingUnitId
    );
    const targetLocationOperatingUnitId = parsePositiveInt(
      ownershipTransferForm.targetLocationOperatingUnitId
    );

    if (!effectiveDate || !postingDate) {
      setActionError(
        l(
          "Effective date and posting date are required.",
          "Gecerlilik tarihi ve kayit tarihi zorunludur."
        )
      );
      return;
    }
    if (!targetOwnerOperatingUnitId) {
      setActionError(
        l(
          "Target owner operating unit is required.",
          "Hedef sahip isletme birimi zorunludur."
        )
      );
      return;
    }

    setOwnershipTransferSaving(true);
    resetActionFeedback();
    try {
      const response = await ownershipTransferAsset(normalizedAssetId, {
        effectiveDate,
        postingDate,
        targetOwnerOperatingUnitId,
        targetLocationOperatingUnitId: targetLocationOperatingUnitId || null,
        note: normalizeText(ownershipTransferForm.note) || null,
      });
      setAsset(response || null);
      setOwnershipTransferOpen(false);
      setActionSuccess(
        l("Ownership transfer posted successfully.", "Sahiplik transferi basariyla kaydedildi.")
      );
      setActiveTab("overview");
    } catch (err) {
      const errorStatus = Number(err?.response?.status || 0);
      const errorPayload = getApiErrorPayload(err);
      const reroute = errorPayload?.reroute;

      // Chronology-unsafe backdated transfers are not generic form failures in
      // Track 43. The detail page must preserve the owner's requested dates and
      // any location guidance, then pivot into the dedicated retro workflow.
      if (errorStatus === 409 && reroute?.retroCorrectionPreviewRequired) {
        const rerouteTargetLocationOperatingUnitId = parsePositiveInt(
          reroute.targetLocationOperatingUnitId
            ?? targetLocationOperatingUnitId
        );
        openRetroCorrectionPanel({
          formOverrides: {
            actualEffectiveDate: effectiveDate,
            correctionPostingDate: postingDate,
            targetOwnerOperatingUnitId,
            note: normalizeText(ownershipTransferForm.note),
          },
          rerouteContext: {
            ...reroute,
            reasonCode: normalizeUpperText(errorPayload?.reasonCode),
            message: normalizeText(errorPayload?.message),
            targetLocationOperatingUnitId: rerouteTargetLocationOperatingUnitId || null,
          },
        });
        setActionWarning(
          normalizeText(errorPayload?.message)
          || l(
            "The backdated owner transfer needs retro correction preview before it can be posted.",
            "Geri tarihli sahiplik degisikligi kaydedilmeden once retro duzeltme onizlemesine yonlendirilmelidir."
          )
        );
        return;
      }
      setActionError(
        normalizeApiError(
          err,
          l("Failed to post ownership transfer.", "Sahiplik transferi kaydedilemedi.")
        )
      );
    } finally {
      setOwnershipTransferSaving(false);
    }
  }

  async function handlePreviewRetroCorrection() {
    if (!normalizedAssetId) {
      setRetroCorrectionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }

    const request = buildRetroOwnershipCorrectionRequest(retroCorrectionForm);
    if (!request.actualEffectiveDate || !request.correctionPostingDate) {
      setRetroCorrectionError(
        l(
          "Actual effective date and correction posting date are required.",
          "Gercek gecerlilik tarihi ve duzeltme kayit tarihi zorunludur."
        )
      );
      return;
    }
    if (request.actualEffectiveDate > request.correctionPostingDate) {
      setRetroCorrectionError(
        l(
          "Actual effective date cannot be after correction posting date.",
          "Gercek gecerlilik tarihi duzeltme kayit tarihinden sonra olamaz."
        )
      );
      return;
    }
    if (!request.targetOwnerOperatingUnitId) {
      setRetroCorrectionError(
        l(
          "Target owner operating unit is required.",
          "Hedef sahip isletme birimi zorunludur."
        )
      );
      return;
    }

    setRetroCorrectionPreviewLoading(true);
    setRetroCorrectionError("");
    setRetroCorrectionPreviewResult(null);
    try {
      const response = await previewRetroOwnershipTransferCorrection(normalizedAssetId, request);
      setRetroCorrectionPreviewResult(response || null);
    } catch (err) {
      const errorStatus = Number(err?.response?.status || 0);
      const errorPayload = getApiErrorPayload(err);
      if (errorStatus === 409 && errorPayload) {
        setRetroCorrectionPreviewResult(errorPayload);
        return;
      }
      setRetroCorrectionError(
        normalizeApiError(
          err,
          l(
            "Failed to preview retro ownership correction.",
            "Retro sahiplik duzeltmesi onizlenemedi."
          )
        )
      );
    } finally {
      setRetroCorrectionPreviewLoading(false);
    }
  }

  async function handlePostRetroCorrection() {
    if (!normalizedAssetId) {
      setRetroCorrectionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }

    const request = buildRetroOwnershipCorrectionRequest(retroCorrectionForm);
    if (!retroCorrectionCanPost) {
      setRetroCorrectionError(
        l(
          "Run a fresh preview for the same dates and target owner before posting the correction.",
          "Duzeltmeyi kaydetmeden once ayni tarihler ve hedef sahip icin guncel bir onizleme calistirin."
        )
      );
      return;
    }

    setRetroCorrectionSaving(true);
    setRetroCorrectionError("");
    resetActionFeedback();
    try {
      const response = await postRetroOwnershipTransferCorrection(normalizedAssetId, {
        ...request,
        previewFingerprint: retroCorrectionPreviewResult.previewFingerprint,
        resolutionMode: retroCorrectionPreviewResult.resolutionMode,
      });
      let refreshFailed = false;
      await refreshAssetDetail(normalizedAssetId).catch(() => {
        refreshFailed = true;
        return null;
      });
      await refreshTransactions(normalizedAssetId).catch(() => {
        refreshFailed = true;
        return [];
      });
      setRetroCorrectionOpen(false);
      resetRetroCorrectionWorkflow(buildRetroOwnershipCorrectionForm(), null);
      setActionSuccess(
        response?.replacementApplied
          ? l(
              "Retro ownership correction posted and the earlier overlapping correction was replaced.",
              "Retro sahiplik duzeltmesi kaydedildi ve onceki cakisan duzeltme degistirildi."
            )
          : l(
              "Retro ownership correction posted successfully. The current owner was updated and the current-period owner move was posted.",
              "Retro sahiplik duzeltmesi basariyla kaydedildi. Guncel sahip guncellendi ve cari donem sahiplik tasima kaydi olusturuldu."
            )
      );
      if (refreshFailed) {
        setActionWarning(
          l(
            "The correction posted, but the page could not refresh every detail automatically. Reload the asset if something still looks stale.",
            "Duzeltme kaydedildi ancak sayfadaki tum ayrintilar otomatik yenilenemedi. Bir sey eski gorunuyorsa demirbasi yeniden yukleyin."
          )
        );
      }
      setActiveTab("overview");
    } catch (err) {
      const errorStatus = Number(err?.response?.status || 0);
      const errorPayload = getApiErrorPayload(err);
      if (errorStatus === 409 && errorPayload) {
        setRetroCorrectionPreviewResult(null);
      }
      setRetroCorrectionError(
        normalizeApiError(
          err,
          l(
            "Failed to post retro ownership correction.",
            "Retro sahiplik duzeltmesi kaydedilemedi."
          )
        )
      );
    } finally {
      setRetroCorrectionSaving(false);
    }
  }

  async function handleWriteoffAsset() {
    if (!normalizedAssetId) {
      setActionError(l("Asset record is missing.", "Demirbas kaydi eksik."));
      return;
    }

    const effectiveDate = normalizeText(writeoffForm.effectiveDate);
    const postingDate = normalizeText(writeoffForm.postingDate);
    if (!effectiveDate || !postingDate) {
      setActionError(
        l(
          "Effective date and posting date are required.",
          "Gecerlilik tarihi ve kayit tarihi zorunludur."
        )
      );
      return;
    }

    setWriteoffSaving(true);
    resetActionFeedback();
    try {
      const response = await writeoffAsset(normalizedAssetId, {
        effectiveDate,
        postingDate,
        note: normalizeText(writeoffForm.note) || null,
      });
      setAsset(response || null);
      setWriteoffOpen(false);
      setActionSuccess(l("Write-off posted successfully.", "Hurda islemi basariyla kaydedildi."));
      setActiveTab("overview");
    } catch (err) {
      setActionError(
        normalizeApiError(err, l("Failed to post write-off.", "Hurda islemi kaydedilemedi."))
      );
    } finally {
      setWriteoffSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/app/demirbas-karti-listesi" className="text-sm text-cyan-700 hover:underline">
            {l("Register", "Liste")}
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl font-semibold text-slate-900">
            {asset.assetNo || `#${asset.id}`}
          </h1>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor}`}>
            {asset.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{asset.name || "-"}</p>
        {asset.description ? <p className="mt-1 text-xs text-slate-500">{asset.description}</p> : null}
      </section>

      {pendingSkippedDepreciationCount > 0 ? (
        <section
          className={`rounded-xl border p-4 shadow-sm ${
            pendingSkippedDepreciationReviewRecommended
              ? "border-amber-200 bg-amber-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {pendingSkippedDepreciationReviewRecommended
                  ? l(
                      "Skipped depreciation months need review",
                      "Atlanan amortisman donemleri gozden gecirilmeli"
                    )
                  : l(
                      "Skipped depreciation months are recorded",
                      "Atlanan amortisman donemleri kayitli"
                    )}
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                {pendingSkippedDepreciationReviewRecommended
                  ? l(
                      "Skipped depreciation months exist after the last posted period. Review the latest skipped run and reprocess the affected month if the asset has returned to service.",
                      "Son postalanan donemden sonra atlanan amortisman donemleri var. Varlik yeniden hizmete donduyse en son atlanan runu inceleyin ve ilgili donemi yeniden isleyin."
                    )
                  : l(
                      "Skipped depreciation months are still tracked after the last posted period. They remain visible until the asset returns to service or becomes depreciable again.",
                      "Son postalanan donemden sonra atlanan amortisman donemleri izlenmeye devam ediyor. Varlik yeniden hizmete donene veya tekrar amortismana uygun hale gelene kadar gorunur kalir."
                    )}
              </p>
              <p className="mt-2 text-xs font-medium text-slate-600">
                {l("Periods", "Donemler")}: {pendingSkippedDepreciationPeriodLabel} · {l("Count", "Adet")}: {pendingSkippedDepreciationCount}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={pendingSkippedDepreciationLatestRunPath}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {pendingSkippedDepreciationLatestRunId
                  ? l("Open Latest Skipped Run", "Son Atlanan Runu Ac")
                  : l("Open Depreciation Runs", "Amortisman Runlarini Ac")}
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Permission-gated actions */}
      {(canUpsert || canPost || canDispose || canTransfer) ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {l("Available Actions", "Mevcut Aksiyonlar")}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {canUpsert && status === "DRAFT" ? (
              <span className="rounded-md bg-slate-50 px-3 py-1 text-xs font-medium text-slate-800 border border-slate-200">
                {l("Edit Draft", "Taslak Duzenle")}
              </span>
            ) : null}
            {canPost && status === "DRAFT" ? (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  closeLifecyclePanels();
                  resetActionFeedback();
                  setActivationOpen(true);
                  setActivationError("");
                  setActivationSuccess("");
                  setActivationForm(buildActivationForm(asset));
                }}
                disabled={activationSaving}
              >
                {l("Activate", "Aktiflestir")}
              </button>
            ) : null}
            {canPost && status === "ACTIVE" ? (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                onClick={openSuspendPanel}
              >
                {l("Suspend", "Askiya Al")}
              </button>
            ) : null}
            {canPost && status === "SUSPENDED" ? (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                onClick={openReactivatePanel}
              >
                {l("Reactivate", "Yeniden Aktiflestir")}
              </button>
            ) : null}
            {canTransfer && isMoveEligibleStatus ? (
              <>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
                  onClick={openPhysicalMovePanel}
                >
                  {l("Physical Move", "Fiziksel Hareket")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
                  onClick={openOwnershipTransferPanel}
                >
                  {l("Ownership Transfer", "Sahiplik Transferi")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  onClick={() => openRetroCorrectionPanel()}
                >
                  {l("Retro Owner Correction", "Geriye Donuk Sahiplik Duzeltmesi")}
                </button>
              </>
            ) : null}
            {canDispose && isWriteoffEligibleStatus ? (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                onClick={openWriteoffPanel}
              >
                {l("Write Off", "Hurda Islem")}
              </button>
            ) : null}
            {canDispose && isSaleEligibleStatus ? (
              <button
                type="button"
                className="cursor-pointer rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                onClick={focusSaleFlowPanel}
              >
                {l("Sale", "Satis")}
              </button>
            ) : null}
          </div>
          {activationSuccess ? (
            <p className="mt-3 text-sm text-emerald-700">{activationSuccess}</p>
          ) : null}
          {activationError ? (
            <p className="mt-3 text-sm text-rose-700">{activationError}</p>
          ) : null}
          {actionSuccess ? (
            <p className="mt-3 text-sm text-emerald-700">{actionSuccess}</p>
          ) : null}
          {actionWarning ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>{actionWarning}</p>
              <Link
                to={pendingSkippedDepreciationLatestRunPath}
                className="mt-2 inline-flex text-xs font-semibold text-amber-900 underline"
              >
                {pendingSkippedDepreciationLatestRunId
                  ? l("Open Latest Skipped Run", "Son Atlanan Runu Ac")
                  : l("Open Depreciation Runs", "Amortisman Runlarini Ac")}
              </Link>
            </div>
          ) : null}
          {actionError ? (
            <p className="mt-3 text-sm text-rose-700">{actionError}</p>
          ) : null}
          {activationOpen ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                {l("Activate Asset", "Demirbasi Aktiflestir")}
              </p>
              <p className="mt-2 text-sm text-emerald-950">
                {l(
                  "Set the real service dates before activation. If the asset started being used earlier, enter that historical in-service date here.",
                  "Aktiflestirmeden once gercek hizmet tarihlerini girin. Varlik daha once kullanima basladiysa, o gercek hizmete giris tarihini burada girin."
                )}
              </p>
              {activationAssetTagMissing || activationSerialNoMissing ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">
                    {l(
                      "Complete missing identity details before activation.",
                      "Aktiflestirmeden once eksik kimlik bilgilerini tamamlayin."
                    )}
                  </p>
                  <p className="mt-1 text-xs">
                    {activationAssetTagMissing
                      ? l(
                          "Asset Tag is required. Serial No can be filled now if known.",
                          "Varlik Etiketi zorunludur. Seri No biliniyorsa simdi girilebilir."
                        )
                      : l(
                          "Serial No is still optional, but this is the last easy point to capture it.",
                          "Seri No hala opsiyoneldir, ancak kaydetmek icin en kolay nokta burasidir."
                        )}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Posting Date", "Kayit Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={activationForm.postingDate}
                    onChange={(event) =>
                      setActivationForm((prev) => ({
                        ...prev,
                        postingDate: event.target.value,
                      }))
                    }
                    disabled={activationSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  <span className="inline-flex items-center gap-1">
                    <span>{l("Capitalization Date", "Aktiflesme Tarihi")}</span>
                    <InfoHint text={capitalizationDateHelpText} />
                  </span>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={activationForm.capitalizationDate}
                    onChange={(event) =>
                      setActivationForm((prev) => ({
                        ...prev,
                        capitalizationDate: event.target.value,
                      }))
                    }
                    disabled={activationSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("In-Service Date", "Hizmete Giris Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={activationForm.inServiceDate}
                    onChange={(event) =>
                      setActivationForm((prev) => ({
                        ...prev,
                        inServiceDate: event.target.value,
                      }))
                    }
                    disabled={activationSaving}
                  />
                </label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Asset Tag", "Varlik Etiketi")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={activationForm.assetTag}
                    onChange={(event) =>
                      setActivationForm((prev) => ({
                        ...prev,
                        assetTag: event.target.value,
                      }))
                    }
                    disabled={activationSaving}
                    placeholder={l("Required before activation", "Aktiflestirme oncesi zorunlu")}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Serial No", "Seri No")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={activationForm.serialNo}
                    onChange={(event) =>
                      setActivationForm((prev) => ({
                        ...prev,
                        serialNo: event.target.value,
                      }))
                    }
                    disabled={activationSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Custodian", "Zimmetli")}
                  <div className="mt-1">
                    <Combobox
                      value={activationForm.custodianEmployeeId}
                      options={custodianOptions}
                      placeholder={l("Optional", "Opsiyonel")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        setActivationForm((prev) => ({
                          ...prev,
                          custodianEmployeeId: value ? String(value) : "",
                        }))
                      }
                      disabled={activationSaving}
                    />
                  </div>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleActivateAsset}
                  disabled={activationSaving}
                >
                  {activationSaving
                    ? l("Activating...", "Aktiflestiriliyor...")
                    : l("Confirm Activation", "Aktiflestirmeyi Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setActivationOpen(false);
                    setActivationError("");
                    setActivationForm(buildActivationForm(asset));
                  }}
                  disabled={activationSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {suspendOpen ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                {l("Suspend Asset", "Demirbasi Askiya Al")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {l("Effective Date", "Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={suspendForm.effectiveDate}
                    onChange={(event) =>
                      setSuspendForm((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    disabled={suspendSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={suspendForm.note}
                    onChange={(event) =>
                      setSuspendForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    disabled={suspendSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSuspendAsset}
                  disabled={suspendSaving}
                >
                  {suspendSaving ? l("Posting...", "Kaydediliyor...") : l("Confirm Suspend", "Askiya Almayi Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setSuspendOpen(false);
                    setSuspendForm(buildLifecycleNoteForm());
                    resetActionFeedback();
                  }}
                  disabled={suspendSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {reactivateOpen ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                {l("Reactivate Asset", "Demirbasi Yeniden Aktiflestir")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Effective Date", "Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={reactivateForm.effectiveDate}
                    onChange={(event) =>
                      setReactivateForm((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    disabled={reactivateSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={reactivateForm.note}
                    onChange={(event) =>
                      setReactivateForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    disabled={reactivateSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleReactivateAsset}
                  disabled={reactivateSaving}
                >
                  {reactivateSaving
                    ? l("Posting...", "Kaydediliyor...")
                    : l("Confirm Reactivation", "Yeniden Aktiflestirmeyi Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setReactivateOpen(false);
                    setReactivateForm(buildLifecycleNoteForm());
                    resetActionFeedback();
                  }}
                  disabled={reactivateSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {physicalMoveOpen ? (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                {l("Physical Move", "Fiziksel Hareket")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Effective Date", "Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={physicalMoveForm.effectiveDate}
                    onChange={(event) =>
                      setPhysicalMoveForm((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    disabled={physicalMoveSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Location Operating Unit", "Lokasyon Isletme Birimi")}
                  <div className="mt-1">
                    <Combobox
                      value={physicalMoveForm.locationOperatingUnitId}
                      options={operatingUnitOptions}
                      placeholder={l("Select operating unit", "Isletme birimi secin")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        setPhysicalMoveForm((prev) => ({
                          ...prev,
                          locationOperatingUnitId: value ? String(value) : "",
                        }))
                      }
                      disabled={physicalMoveSaving}
                    />
                  </div>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Custodian", "Zimmetli")}
                  <div className="mt-1">
                    <Combobox
                      value={physicalMoveForm.custodianEmployeeId}
                      options={custodianOptions}
                      placeholder={l("Optional", "Opsiyonel")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        setPhysicalMoveForm((prev) => ({
                          ...prev,
                          custodianEmployeeId: value ? String(value) : "",
                        }))
                      }
                      disabled={physicalMoveSaving}
                    />
                  </div>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Department Code", "Departman Kodu")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={physicalMoveForm.departmentCode}
                    onChange={(event) =>
                      setPhysicalMoveForm((prev) => ({
                        ...prev,
                        departmentCode: event.target.value,
                      }))
                    }
                    disabled={physicalMoveSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Cost Center Code", "Masraf Merkezi Kodu")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={physicalMoveForm.costCenterCode}
                    onChange={(event) =>
                      setPhysicalMoveForm((prev) => ({
                        ...prev,
                        costCenterCode: event.target.value,
                      }))
                    }
                    disabled={physicalMoveSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900 md:col-span-3">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={physicalMoveForm.note}
                    onChange={(event) =>
                      setPhysicalMoveForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    disabled={physicalMoveSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handlePhysicalMoveAsset}
                  disabled={physicalMoveSaving}
                >
                  {physicalMoveSaving
                    ? l("Posting...", "Kaydediliyor...")
                    : l("Confirm Move", "Hareketi Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setPhysicalMoveOpen(false);
                    setPhysicalMoveForm(buildPhysicalMoveForm(asset));
                    resetActionFeedback();
                  }}
                  disabled={physicalMoveSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {ownershipTransferOpen ? (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                {l("Ownership Transfer", "Sahiplik Transferi")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Effective Date", "Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={ownershipTransferForm.effectiveDate}
                    onChange={(event) =>
                      setOwnershipTransferForm((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    disabled={ownershipTransferSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Posting Date", "Kayit Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={ownershipTransferForm.postingDate}
                    onChange={(event) =>
                      setOwnershipTransferForm((prev) => ({
                        ...prev,
                        postingDate: event.target.value,
                      }))
                    }
                    disabled={ownershipTransferSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Target Owner Operating Unit", "Hedef Sahip Isletme Birimi")}
                  <div className="mt-1">
                    <Combobox
                      value={ownershipTransferForm.targetOwnerOperatingUnitId}
                      options={ownershipTargetOwnerOptions}
                      placeholder={l("Select operating unit", "Isletme birimi secin")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        setOwnershipTransferForm((prev) => ({
                          ...prev,
                          targetOwnerOperatingUnitId: value ? String(value) : "",
                        }))
                      }
                      disabled={ownershipTransferSaving}
                    />
                  </div>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                  {l("Target Location Operating Unit", "Hedef Lokasyon Isletme Birimi")}
                  <div className="mt-1">
                    <Combobox
                      value={ownershipTransferForm.targetLocationOperatingUnitId}
                      options={operatingUnitOptions}
                      placeholder={l("Keep current location", "Mevcut lokasyonu koru")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        setOwnershipTransferForm((prev) => ({
                          ...prev,
                          targetLocationOperatingUnitId: value ? String(value) : "",
                        }))
                      }
                      disabled={ownershipTransferSaving}
                    />
                  </div>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-blue-900 md:col-span-2">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={ownershipTransferForm.note}
                    onChange={(event) =>
                      setOwnershipTransferForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    disabled={ownershipTransferSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleOwnershipTransferAsset}
                  disabled={ownershipTransferSaving}
                >
                  {ownershipTransferSaving
                    ? l("Posting...", "Kaydediliyor...")
                    : l("Confirm Transfer", "Transferi Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setOwnershipTransferOpen(false);
                    setOwnershipTransferForm(buildOwnershipTransferForm(asset));
                    resetActionFeedback();
                  }}
                  disabled={ownershipTransferSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {retroCorrectionOpen ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                {l(
                  "Retro Ownership Transfer Correction",
                  "Geriye Donuk Sahiplik Transferi Duzeltmesi"
                )}
              </p>
              <p className="mt-2 text-sm text-amber-950">
                {l(
                  "Use this flow when the real owner changed earlier, but depreciation for one or more impacted periods has already been posted. V1 corrects owner attribution only and keeps any location move separate.",
                  "Gercek sahip daha once degisti ancak etkilenen donemler icin amortisman zaten kaydedildiyse bu akisi kullanin. V1 sadece sahip atamasini duzeltir; lokasyon hareketi ayridir."
                )}
              </p>

              {retroCorrectionReroute ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-white/80 px-3 py-3 text-sm text-amber-950">
                  <p className="font-semibold">
                    {l(
                      "Plain ownership transfer was rerouted into retro correction.",
                      "Normal sahiplik transferi retro duzeltme akisina yonlendirildi."
                    )}
                  </p>
                  {retroCorrectionReroute.message ? (
                    <p className="mt-1">{retroCorrectionReroute.message}</p>
                  ) : null}
                  <p className="mt-1 text-xs">
                    {l("Reason", "Neden")}: {retroCorrectionReroute.reasonCode || "-"} |{" "}
                    {l("First impacted period", "Ilk etkilenen donem")}:{" "}
                    {retroCorrectionReroute.firstImpactedPeriodKey || "-"} |{" "}
                    {l("Impacted posted periods", "Etkilenen kayitli donem")}:{" "}
                    {retroCorrectionReroute.impactedPostedPeriodCount ?? 0}
                  </p>
                  {retroCorrectionReroute.mixedRequestRejected ? (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-medium">
                      {l(
                        `Requested location change ${retroCorrectionRerouteLocationLabel} must be submitted separately via Physical Move after the retro correction is posted.`,
                        `${retroCorrectionRerouteLocationLabel} lokasyon degisikligi retro duzeltme kaydedildikten sonra Fiziksel Hareket ile ayri gonderilmelidir.`
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {l("Actual Effective Date", "Gercek Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={retroCorrectionForm.actualEffectiveDate}
                    onChange={(event) =>
                      updateRetroCorrectionFormField("actualEffectiveDate", event.target.value)
                    }
                    disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {l("Correction Posting Date", "Duzeltme Kayit Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={retroCorrectionForm.correctionPostingDate}
                    onChange={(event) =>
                      updateRetroCorrectionFormField("correctionPostingDate", event.target.value)
                    }
                    disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900 md:col-span-2">
                  {l("Target Owner Operating Unit", "Hedef Sahip Isletme Birimi")}
                  <div className="mt-1">
                    <Combobox
                      value={retroCorrectionForm.targetOwnerOperatingUnitId}
                      options={retroCorrectionTargetOwnerOptions}
                      placeholder={l("Select operating unit", "Isletme birimi secin")}
                      noOptionsText={l("None", "Yok")}
                      onChange={(value) =>
                        updateRetroCorrectionFormField(
                          "targetOwnerOperatingUnitId",
                          value ? String(value) : ""
                        )
                      }
                      disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                    />
                  </div>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-amber-900 md:col-span-2">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={retroCorrectionForm.note}
                    onChange={(event) =>
                      updateRetroCorrectionFormField("note", event.target.value)
                    }
                    disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>

              {retroCorrectionError ? (
                <p className="mt-3 text-sm text-rose-700">{retroCorrectionError}</p>
              ) : null}
              {retroCorrectionPreviewLoading ? (
                <p className="mt-3 text-sm text-amber-900">
                  {l("Loading preview...", "Onizleme yukleniyor...")}
                </p>
              ) : null}

              {retroCorrectionPreviewResult ? (
                <div className="mt-4 space-y-3">
                  {retroCorrectionPreviewResolutionMode === "BLOCKED" ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      <p className="font-semibold">
                        {l(
                          "Retro correction is blocked for this input.",
                          "Retro duzeltme bu giris icin engellendi."
                        )}
                      </p>
                      <p className="mt-1">
                        {retroCorrectionPreviewResult.message || "-"}
                      </p>
                      <p className="mt-2 text-xs">
                        {l("Reason", "Neden")}: {retroCorrectionPreviewResult.reasonCode || "-"}
                      </p>
                      {retroCorrectionChronologyBlockers.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs">
                          {retroCorrectionChronologyBlockers.map((blocker, index) => (
                            <li key={`retro-blocker-${index}`}>
                              {normalizeUpperText(blocker?.reasonCode) || "-"}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {retroCorrectionPreviewResolutionMode === "NORMAL_TRANSFER_ALLOWED" ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                      <p className="font-semibold">
                        {l(
                          "Retro correction is not required for these dates.",
                          "Bu tarihler icin retro duzeltme gerekmiyor."
                        )}
                      </p>
                      <p className="mt-1">
                        {l(
                          "Use the normal ownership transfer flow instead.",
                          "Bunun yerine normal sahiplik transferi akisina donun."
                        )}
                      </p>
                      <button
                        type="button"
                        className="mt-3 cursor-pointer rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                        onClick={() =>
                          openOwnershipTransferPanel({
                            effectiveDate: retroCorrectionForm.actualEffectiveDate,
                            postingDate: retroCorrectionForm.correctionPostingDate,
                            targetOwnerOperatingUnitId:
                              retroCorrectionForm.targetOwnerOperatingUnitId,
                            targetLocationOperatingUnitId:
                              retroCorrectionRerouteLocationOperatingUnitId,
                            note: retroCorrectionForm.note,
                          })
                        }
                      >
                        {l("Open Ownership Transfer", "Sahiplik Transferini Ac")}
                      </button>
                    </div>
                  ) : null}

                  {retroCorrectionPreviewResolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED" ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-950">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Actual Effective Date", "Gercek Gecerlilik Tarihi")}
                          </p>
                          <p className="mt-1 font-medium">
                            {formatDate(retroCorrectionPreviewResult.actualEffectiveDate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Correction Posting Date", "Duzeltme Kayit Tarihi")}
                          </p>
                          <p className="mt-1 font-medium">
                            {formatDate(retroCorrectionPreviewResult.correctionPostingDate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Source Owner", "Kaynak Sahip")}
                          </p>
                          <p className="mt-1 font-medium">{retroCorrectionSourceOwnerLabel}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Target Owner", "Hedef Sahip")}
                          </p>
                          <p className="mt-1 font-medium">{retroCorrectionTargetOwnerLabel}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Impacted Posted Periods", "Etkilenen Kayitli Donem")}
                          </p>
                          <p className="mt-1 text-lg font-semibold">
                            {retroCorrectionPreviewResult.impactedPostedPeriodCount ?? 0}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("First Impacted Period", "Ilk Etkilenen Donem")}
                          </p>
                          <p className="mt-1 text-lg font-semibold">
                            {retroCorrectionPreviewResult.firstImpactedPeriodKey || "-"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Cumulative Delta Base", "Kumulatif Fark Baz")}
                          </p>
                          <p className="mt-1 text-lg font-semibold font-mono">
                            {formatNumber(retroCorrectionPreviewResult.cumulativeDelta?.amountBase)}
                          </p>
                          <p className="mt-1 text-xs text-emerald-900/80">
                            txn={formatNumber(retroCorrectionPreviewResult.cumulativeDelta?.amountTxn)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            {l("Replacement", "Degistirme")}
                          </p>
                          <p className="mt-1 text-sm font-semibold">
                            {retroCorrectionPreviewResult.replacementRequired
                              ? l(
                                  `Replaces #${retroCorrectionPreviewResult.replacesCorrectionId || "-"}`,
                                  `#${retroCorrectionPreviewResult.replacesCorrectionId || "-"} kaydini degistirir`
                                )
                              : l("No earlier overlapping correction", "Onceki cakisan duzeltme yok")}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 rounded-lg border border-emerald-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                          {l("Posting Effect", "Kayit Etkisi")}
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                          <li>
                            {retroCorrectionPreviewResult.mandatoryCurrentPeriodOwnerMoveWillPost
                              ? l(
                                  "A current-period true-up and a mandatory current-period owner move will post together.",
                                  "Cari donem true-up kaydi ile zorunlu cari donem sahiplik tasima kaydi birlikte olusturulacak."
                                )
                              : l(
                                  "No current-period owner move is planned.",
                                  "Cari donem sahiplik tasima kaydi planlanmiyor."
                                )}
                          </li>
                          <li>
                            {retroCorrectionPreviewResult.currentOwnerChanged
                              ? l(
                                  "The asset master owner will be updated to the target owner in V1.",
                                  "V1'de demirbas kartindaki mevcut sahip hedef sahip olarak guncellenecek."
                                )
                              : l(
                                  "The asset master owner will not change.",
                                  "Demirbas kartindaki mevcut sahip degismeyecek."
                                )}
                          </li>
                        </ul>
                      </div>

                      {!retroCorrectionPreviewMatchesForm ? (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-sm text-amber-950">
                          {l(
                            "The preview is no longer aligned with the current dates or target owner. Run preview again before posting.",
                            "Onizleme mevcut tarihler veya hedef sahip ile artik uyumlu degil. Kaydetmeden once onizlemeyi yeniden calistirin."
                          )}
                        </div>
                      ) : null}

                      <div className="mt-4 space-y-3">
                        {retroCorrectionImpactedPeriods.map((period) => (
                          <div
                            key={`retro-period-${period.periodKey}-${Array.isArray(period.runLineIds) ? period.runLineIds.join("-") : ""}`}
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {period.periodKey || "-"}
                                </p>
                                <p className="mt-1 text-xs text-slate-600">
                                  {l("Kinds", "Turler")}:{" "}
                                  {Array.isArray(period.depreciationKinds) && period.depreciationKinds.length > 0
                                    ? period.depreciationKinds.join(", ")
                                    : "-"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                                  {l("Delta Base", "Fark Baz")}
                                </p>
                                <p className="mt-1 font-mono text-sm font-semibold">
                                  {formatNumber(period.delta?.amountBase)}
                                </p>
                                <p className="mt-1 text-xs text-slate-600">
                                  txn={formatNumber(period.delta?.amountTxn)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  {l("Originally Posted", "Ilk Kaydedilen")}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionSourceOwnerLabel}:{" "}
                                  {formatNumber(period.originallyPosted?.sourceAmountBase)}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionTargetOwnerLabel}:{" "}
                                  {formatNumber(period.originallyPosted?.targetAmountBase)}
                                </p>
                              </div>
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  {l("Corrected Attribution", "Duzeltilmis Dagilim")}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionSourceOwnerLabel}:{" "}
                                  {formatNumber(period.corrected?.sourceAmountBase)}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionTargetOwnerLabel}:{" "}
                                  {formatNumber(period.corrected?.targetAmountBase)}
                                </p>
                              </div>
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  {l("Eligible Day Split", "Hak Edilen Gun Dagilimi")}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionSourceOwnerLabel}:{" "}
                                  {period.eligibleDaySplit?.correctedSourceEligibleDays ?? 0}
                                </p>
                                <p className="mt-1 text-xs text-slate-700">
                                  {retroCorrectionTargetOwnerLabel}:{" "}
                                  {period.eligibleDaySplit?.correctedTargetEligibleDays ?? 0}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-amber-900">
                  {l(
                    "Preview the impacted periods and current-period correction before posting.",
                    "Kaydetmeden once etkilenen donemleri ve cari donem duzeltmesini onizleyin."
                  )}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handlePreviewRetroCorrection}
                  disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                >
                  {retroCorrectionPreviewLoading
                    ? l("Previewing...", "Onizleniyor...")
                    : l("Preview Correction", "Duzeltmeyi Onizle")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handlePostRetroCorrection}
                  disabled={!retroCorrectionCanPost}
                >
                  {retroCorrectionSaving
                    ? l("Posting...", "Kaydediliyor...")
                    : l("Post Correction", "Duzeltmeyi Kaydet")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={closeRetroCorrectionPanel}
                  disabled={retroCorrectionPreviewLoading || retroCorrectionSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {writeoffOpen ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-900">
                {l("Write Off Asset", "Demirbasi Hurda Yap")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-rose-900">
                  {l("Effective Date", "Gecerlilik Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={writeoffForm.effectiveDate}
                    onChange={(event) =>
                      setWriteoffForm((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    disabled={writeoffSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-rose-900">
                  {l("Posting Date", "Kayit Tarihi")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={writeoffForm.postingDate}
                    onChange={(event) =>
                      setWriteoffForm((prev) => ({
                        ...prev,
                        postingDate: event.target.value,
                      }))
                    }
                    disabled={writeoffSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-rose-900 md:col-span-2">
                  {l("Note", "Not")}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={writeoffForm.note}
                    onChange={(event) =>
                      setWriteoffForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    disabled={writeoffSaving}
                    placeholder={l("Optional", "Opsiyonel")}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleWriteoffAsset}
                  disabled={writeoffSaving}
                >
                  {writeoffSaving
                    ? l("Posting...", "Kaydediliyor...")
                    : l("Confirm Write Off", "Hurda Islemini Onayla")}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                  onClick={() => {
                    setWriteoffOpen(false);
                    setWriteoffForm(buildWriteoffForm());
                    resetActionFeedback();
                  }}
                  disabled={writeoffSaving}
                >
                  {l("Cancel", "Iptal")}
                </button>
              </div>
            </div>
          ) : null}
          {canDispose && isSaleEligibleStatus && saleFlowOpen ? (
            <div ref={saleFlowSectionRef} className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
                  {t("fixedAssets.detail.preferredSaleFlowTitle")}
                </p>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setSaleFlowOpen(false);
                    setLegacySaleFallbackOpen(false);
                    setLegacySaleFallbackError("");
                  }}
                >
                  {l("Close", "Kapat")}
                </button>
              </div>
              <p className="mt-2 text-sm text-cyan-950">
                {t("fixedAssets.detail.preferredSaleFlowDescription")}
              </p>
              <div className="mt-3 rounded-lg border border-cyan-200 bg-white/70 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900">
                  {t("fixedAssets.detail.preferredSaleFlowTargetLabel")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {asset.assetNo || `#${asset.id}`}
                </p>
                <p className="text-xs text-slate-600">
                  {asset.name || "-"}
                </p>
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-cyan-950">
                <li>{t("fixedAssets.detail.preferredSaleFlowStepOne")}</li>
                <li>{t("fixedAssets.detail.preferredSaleFlowStepTwo")}</li>
                <li>{t("fixedAssets.detail.preferredSaleFlowStepThree")}</li>
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {canOpenCariSaleFlow ? (
                  <Link
                    to={buildCariSalePrefillPath(asset)}
                    className="inline-flex rounded-md border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100"
                  >
                    {t("fixedAssets.detail.openCariSaleFlow")}
                  </Link>
                ) : (
                  <p className="text-xs text-amber-800">
                    {t("fixedAssets.detail.missingCariSalePermissions")}
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {t("fixedAssets.detail.legacySaleFallbackTitle")}
                </p>
                <p className="mt-1 text-sm text-amber-900">
                  {t("fixedAssets.detail.legacySaleFallbackDescription")}
                </p>
                {legacySaleFallbackResult?.pendingSaleCariDocumentId ? (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <p>
                      {t("fixedAssets.detail.legacySaleFallbackCreateSuccess")}
                    </p>
                    {canReadCariDocuments ? (
                      <Link
                        to={buildCariDocumentPath(
                          legacySaleFallbackResult.pendingSaleCariDocumentId
                        )}
                        className="mt-1 inline-flex font-semibold text-emerald-800 underline"
                      >
                        {t("fixedAssets.detail.openLegacySaleFallbackDraft")}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {legacySaleFallbackOpen ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        {t("fixedAssets.detail.legacySaleFallbackCounterpartyId")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-amber-200 px-3 py-2 text-sm font-normal text-slate-900"
                          value={legacySaleFallbackForm.counterpartyId}
                          onChange={(event) =>
                            setLegacySaleFallbackForm((prev) => ({
                              ...prev,
                              counterpartyId: event.target.value,
                            }))
                          }
                          disabled={legacySaleFallbackSaving}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        {t("fixedAssets.detail.legacySaleFallbackDocumentDate")}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-md border border-amber-200 px-3 py-2 text-sm font-normal text-slate-900"
                          value={legacySaleFallbackForm.documentDate}
                          onChange={(event) =>
                            setLegacySaleFallbackForm((prev) => ({
                              ...prev,
                              documentDate: event.target.value,
                            }))
                          }
                          disabled={legacySaleFallbackSaving}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        {t("fixedAssets.detail.legacySaleFallbackAmount")}
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          className="mt-1 w-full rounded-md border border-amber-200 px-3 py-2 text-sm font-normal text-slate-900"
                          value={legacySaleFallbackForm.saleAmountTxn}
                          onChange={(event) =>
                            setLegacySaleFallbackForm((prev) => ({
                              ...prev,
                              saleAmountTxn: event.target.value,
                            }))
                          }
                          disabled={legacySaleFallbackSaving}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-amber-900">
                      {t("fixedAssets.detail.legacySaleFallbackHelper")}
                    </p>
                    {legacySaleFallbackError ? (
                      <p className="mt-2 text-sm text-rose-700">
                        {legacySaleFallbackError}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="cursor-pointer rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed"
                        onClick={handleCreateLegacySaleFallbackDraft}
                        disabled={legacySaleFallbackSaving}
                      >
                        {legacySaleFallbackSaving
                          ? t("fixedAssets.detail.creatingLegacySaleFallbackDraft")
                          : t("fixedAssets.detail.createLegacySaleFallbackDraft")}
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed"
                        onClick={() => {
                          setLegacySaleFallbackOpen(false);
                          setLegacySaleFallbackError("");
                        }}
                        disabled={legacySaleFallbackSaving}
                      >
                        {l("Cancel", "Iptal")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {canUseLegacySaleFallback ? (
                      <button
                        type="button"
                        className="inline-flex cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                        onClick={() => {
                          setSaleFlowOpen(true);
                          setLegacySaleFallbackOpen(true);
                          setLegacySaleFallbackError("");
                        }}
                      >
                        {t("fixedAssets.detail.createLegacySaleFallbackDraft")}
                      </button>
                    ) : (
                      <p className="text-xs text-amber-900">
                        {t("fixedAssets.detail.missingLegacySaleFallbackPermissions")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setSaleFlowOpen(false);
                    setLegacySaleFallbackOpen(false);
                    setLegacySaleFallbackError("");
                  }}
                >
                  {l("Close", "Kapat")}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="text-xs text-amber-700">
          {l(
            "Read-only access — you do not have edit permissions.",
            "Salt okunur erisim — duzenleme yetkiniz yok."
          )}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
        {tabs.map((tab) => (
          <button key={tab.key} type="button"
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────── */}
      {activeTab === "overview" ? (
        <div className="space-y-4">
          <SectionCard title={l("Identity", "Kimlik")}>
            <DetailField label={l("Asset No", "Demirbas No")} value={asset.assetNo} />
            <DetailField label={l("Sequence No", "Sira No")} value={asset.sequenceNo} />
            <DetailField label={l("Asset Tag", "Etiket")} value={asset.assetTag} />
            <DetailField label={l("Serial No", "Seri No")} value={asset.serialNo} />
            <DetailField label={l("Category", "Kategori")} value={asset.categoryCode ? `${asset.categoryCode} - ${asset.categoryName || ""}` : null} />
            <DetailField label={l("Status", "Durum")} value={asset.status} />
            <DetailField label={l("Currency", "Para Birimi")} value={asset.currencyCode} />
            <DetailField label={l("Counterparty ID", "Karsi Taraf ID")} value={asset.counterpartyId} />
          </SectionCard>

          <SectionCard title={l("Organizational Assignment", "Organizasyonel Atama")}>
            <DetailField label={l("Owner Operating Unit", "Sahip Isletme Birimi")} value={ownerOperatingUnitLabel} />
            <DetailField label={l("Location Operating Unit", "Lokasyon Isletme Birimi")} value={locationOperatingUnitLabel} />
            <DetailField label={l("Department Code", "Departman Kodu")} value={asset.departmentCode} />
            <DetailField label={l("Cost Center Code", "Masraf Merkezi Kodu")} value={asset.costCenterCode} />
            <DetailField label={l("Custodian", "Zimmetli")} value={
              asset.custodianDisplayName
                ? `${asset.custodianEmployeeCode || ""} - ${asset.custodianDisplayName}`
                : asset.custodianEmployeeId
            } />
          </SectionCard>

          {retroCorrectedOwnerTimeline ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {l("Retro-Corrected Owner Timeline", "Retro Duzeltilmis Sahip Zaman Cizelgesi")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Track 43 keeps the asset master owner current while separately surfacing the corrected historical owner ranges used for future attribution.",
                      "Track 43, demirbas kartindaki mevcut sahibi korurken gelecekteki dagilimda kullanilan duzeltilmis tarihsel sahip araliklarini ayrica gosterir."
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    {l("Current Owner Snapshot", "Guncel Sahip Anlik Gorunumu")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {retroCorrectedOwnerCurrentLabel}
                  </p>
                </div>
              </div>

              {retroCorrectedOwnerRanges.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {retroCorrectedOwnerRanges.map((range, index) => (
                    <div
                      key={`retro-owner-range-${range.fromDate || "start"}-${range.toDate || "open"}-${index}`}
                      className="rounded-lg border border-emerald-200 bg-white px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {buildOperatingUnitIdentityLabel(
                          range.ownerOuCode,
                          range.ownerOuName,
                          range.ownerOperatingUnitId
                        )}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatDate(range.fromDate)}{" "}
                        {"->"}{" "}
                        {range.openEnded
                          ? l("Open-ended", "Acik Uclu")
                          : formatDate(range.toDate)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  {l(
                    "No corrected owner ranges are available for this asset.",
                    "Bu demirbas icin duzeltilmis sahip araligi bulunmuyor."
                  )}
                </p>
              )}

              {retroCorrectedOwnerEvents.length > 0 ? (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    {l("Owner-Change Events", "Sahip Degisim Olaylari")}
                  </p>
                  <div className="mt-3 space-y-3">
                    {retroCorrectedOwnerEvents.map((event, index) => (
                      <div
                        key={`retro-owner-event-${event.transactionId || "tx"}-${event.effectiveDate || index}`}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {buildOperatingUnitIdentityLabel(
                              event.fromOwnerOuCode,
                              event.fromOwnerOuName,
                              event.fromOwnerOperatingUnitId
                            )}{" "}
                            {"->"}{" "}
                            {buildOperatingUnitIdentityLabel(
                              event.toOwnerOuCode,
                              event.toOwnerOuName,
                              event.toOwnerOperatingUnitId
                            )}
                          </p>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            {event.sourceType === "RETRO_OWNERSHIP_CORRECTION"
                              ? l("Retro Correction", "Retro Duzeltme")
                              : event.sourceType || "-"}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                          <p>
                            {l("Actual Effective", "Gercek Yurumelilik")}: {formatDate(
                              event.actualEffectiveDate || event.effectiveDate
                            )}
                          </p>
                          <p>
                            {l("Correction Posting", "Duzeltme Kayit Tarihi")}: {formatDate(
                              event.correctionPostingDate
                            )}
                          </p>
                          <p>
                            {l("Reference", "Referans")}: {event.retroCorrectionId
                              ? l(
                                  `Correction #${event.retroCorrectionId}`,
                                  `Duzeltme #${event.retroCorrectionId}`
                                )
                              : event.transactionId
                                ? `#${event.transactionId}`
                                : "-"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <SectionCard title={l("Key Dates", "Onemli Tarihler")}>
            <DetailField label={l("Acquisition Date", "Alim Tarihi")} value={formatDate(asset.acquisitionDate)} />
            <DetailField label={l("Capitalization Date", "Aktiflesme Tarihi")} value={formatDate(asset.capitalizationDate)} />
            <DetailField label={l("In-Service Date", "Hizmete Giris Tarihi")} value={formatDate(asset.inServiceDate)} />
            <DetailField label={l("Disposal Date", "Elden Cikarma Tarihi")} value={formatDate(asset.disposalDate)} />
          </SectionCard>

          <SectionCard title={l("Cost", "Maliyet")}>
            <DetailField label={l("Original Cost (Txn)", "Orijinal Maliyet (Islem)")} value={formatNumber(asset.originalCostTxn)} mono />
            <DetailField label={l("Original Cost (Base)", "Orijinal Maliyet (Baz)")} value={formatNumber(asset.originalCostBase)} mono />
          </SectionCard>

          {/* Source CARI Linkage */}
          {asset.sourceCariDocumentId ? (
            <SectionCard title={l("Source CARI Linkage", "Kaynak CARI Baglantisi")}>
              <DetailField
                label={l("CARI Document", "CARI Belgesi")}
                value={
                  canReadCariDocuments ? (
                    <Link
                      to={buildCariDocumentPath(asset.sourceCariDocumentId, sourceCariDirection)}
                      className="text-cyan-700 hover:underline"
                    >
                      {sourceCariDocumentLabel}
                    </Link>
                  ) : sourceCariDocumentLabel
                }
              />
              <DetailField label={l("CARI Source Line", "CARI Kaynak Satiri")} value={sourceCariLineLabel} />
              <DetailField label={l("CARI Line Unit No", "CARI Satir Birim No")} value={asset.sourceCariDocumentLineUnitNo} />
            </SectionCard>
          ) : null}

          {/* Legacy */}
          {(asset.legacyAccumDeprBase != null || asset.legacyNbvBase != null) ? (
            <SectionCard title={l("Legacy Onboarding", "Eski Sistem Devir")}>
              <DetailField label={l("Legacy Accum Depr (Txn)", "Eski Birikm. Amort. (Islem)")} value={formatNumber(asset.legacyAccumDeprTxn)} mono />
              <DetailField label={l("Legacy Accum Depr (Base)", "Eski Birikm. Amort. (Baz)")} value={formatNumber(asset.legacyAccumDeprBase)} mono />
              <DetailField label={l("Legacy NBV (Txn)", "Eski NBV (Islem)")} value={formatNumber(asset.legacyNbvTxn)} mono />
              <DetailField label={l("Legacy NBV (Base)", "Eski NBV (Baz)")} value={formatNumber(asset.legacyNbvBase)} mono />
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      {/* ── Accounting Tab ───────────────────────────────────────── */}
      {activeTab === "accounting" ? (
        <div className="space-y-4">
          <SectionCard title={l("Salvage Snapshot Inputs", "Hurda Deger Anlık Girisler")}>
            <DetailField label={l("Salvage Rule Type", "Hurda Kural Tipi")} value={asset.salvageRuleType} />
            <DetailField label={l("Salvage Percent", "Hurda Yuzdesi")} value={asset.salvagePercent != null ? `${asset.salvagePercent}%` : null} />
            <DetailField label={l("Salvage Amount (Base Rule)", "Hurda Tutar (Baz Kural)")} value={formatNumber(asset.salvageAmountBaseRule)} mono />
          </SectionCard>

          <SectionCard title={l("Resolved Salvage Values", "Hesaplanan Hurda Degerleri")}>
            <DetailField label={l("Salvage Value (Txn)", "Hurda Deger (Islem)")} value={formatNumber(asset.salvageValueTxn)} mono />
            <DetailField label={l("Salvage Value (Base)", "Hurda Deger (Baz)")} value={formatNumber(asset.salvageValueBase)} mono />
          </SectionCard>

          <SectionCard title={l("Account Mappings", "Hesap Eslemeleri")}>
            <DetailField label={l("Asset Account", "Varlik Hesabi")} value={assetAccountLabel} />
            <DetailField label={l("Accum Depreciation Account", "Birikm. Amort. Hesabi")} value={accumDeprAccountLabel} />
            <DetailField label={l("Depreciation Expense Account", "Amort. Gider Hesabi")} value={deprExpenseAccountLabel} />
            <DetailField label={l("Disposal Gain Account", "Elden Cikarma Kar Hesabi")} value={disposalGainAccountLabel} />
            <DetailField label={l("Disposal Loss Account", "Elden Cikarma Zarar Hesabi")} value={disposalLossAccountLabel} />
          </SectionCard>
        </div>
      ) : null}

      {/* ── Depreciation Tab ─────────────────────────────────────── */}
      {activeTab === "depreciation" ? (
        <div className="space-y-4">
          <SectionCard title={l("Profile Lineage", "Profil Kokensel Baglantilar")}>
            <DetailField label={l("Profile ID", "Profil ID")} value={asset.depreciationProfileId} />
            <DetailField label={l("Profile Code", "Profil Kodu")} value={asset.profileCode} />
            <DetailField label={l("Profile Name", "Profil Adi")} value={asset.profileName} />
          </SectionCard>

          <SectionCard title={l("Frozen Runtime Behavior", "Donmus Calisma Zamani Davranisi")}>
            <DetailField label={l("Depreciation Method", "Amortisman Yontemi")} value={asset.depreciationMethod} />
            <DetailField label={l("Declining Balance Rate %", "Azalan Bakiye Orani %")} value={asset.decliningBalanceRatePercent != null ? `${asset.decliningBalanceRatePercent}%` : null} />
            <DetailField label={l("Switch to Straight Line", "Esit Payliya Gecis")} value={formatBool(asset.switchToStraightLine)} />
            <DetailField label={l("Useful Life (months)", "Faydali Omur (ay)")} value={asset.usefulLifeMonths} />
            <DetailField label={l("Remaining Useful Life (months)", "Kalan Faydali Omur (ay)")} value={asset.remainingUsefulLifeMonths} />
            <DetailField label={l("Last Depreciation Period", "Son Amortisman Donemi")} value={asset.lastDepreciationPeriod} />
          </SectionCard>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{l("Depreciation Schedule", "Amortisman Plani")}</h2>
            {scheduleLoading ? (
              <p className="mt-2 text-sm text-slate-500">{l("Loading...", "Yukleniyor...")}</p>
            ) : scheduleError ? (
              <p className="mt-2 text-sm text-rose-600">{scheduleError}</p>
            ) : schedule.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                {l("No schedule lines found.", "Amortisman plan satiri bulunamadi.")}
              </p>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">{l("Period", "Donem")}</th>
                      <th className="px-2 py-2">{l("Status", "Durum")}</th>
                      <th className="px-2 py-2 text-right">{l("Depr Amount (Base)", "Amort Tutar (Baz)")}</th>
                      <th className="px-2 py-2 text-right">{l("Accum Depr (Base)", "Birikm Amort (Baz)")}</th>
                      <th className="px-2 py-2 text-right">{l("NBV (Base)", "NBV (Baz)")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((line, idx) => {
                      const depreciationAmountBase = (
                        line.depreciationAmountBase
                        ?? line.depreciation_amount_base
                        ?? line.plannedAmountBase
                        ?? line.planned_amount_base
                      );
                      const accumDepreciationBase = (
                        line.accumDepreciationBase
                        ?? line.accum_depreciation_base
                        ?? line.accumulatedDepreciationBase
                      );
                      const nbvBase = (
                        line.nbvBase
                        ?? line.nbv_base
                        ?? line.closingNbvBase
                        ?? line.closing_nbv_base
                      );
                      return (
                        <tr key={line.id || idx} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5">{line.periodKey || line.period_key || "-"}</td>
                          <td className="px-2 py-1.5">{line.status || "-"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(depreciationAmountBase)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(accumDepreciationBase)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(nbvBase)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* ── Transactions Tab ─────────────────────────────────────── */}
      {activeTab === "transactions" ? (
        <div className="space-y-4">
          <SectionCard title={l("Transaction Summary", "Hareket Ozeti")} cols={3}>
            <DetailField label={l("Total Transactions", "Toplam Hareket")} value={asset.transactionSummary?.totalCount} />
            <DetailField label={l("Posted", "Kaydedilmis")} value={asset.transactionSummary?.postedCount} />
            <DetailField label={l("Reversed", "Ters Kayit")} value={asset.transactionSummary?.reversedCount} />
            <DetailField label={l("Latest Effective Date", "Son Gecerlilik Tarihi")} value={formatDate(asset.transactionSummary?.latestEffectiveDate)} />
            <DetailField label={l("Latest Posting Date", "Son Kayit Tarihi")} value={formatDate(asset.transactionSummary?.latestPostingDate)} />
          </SectionCard>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{l("Transaction List", "Hareket Listesi")}</h2>
            {transactionActionSuccess ? (
              <p className="mt-2 text-sm text-emerald-700">{transactionActionSuccess}</p>
            ) : null}
            {transactionActionError ? (
              <p className="mt-2 text-sm text-rose-600">{transactionActionError}</p>
            ) : null}
            {transactionsLoading ? (
              <p className="mt-2 text-sm text-slate-500">{l("Loading...", "Yukleniyor...")}</p>
            ) : transactionsError ? (
              <p className="mt-2 text-sm text-rose-600">{transactionsError}</p>
            ) : transactions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                {l("No transactions found.", "Hareket bulunamadi.")}
              </p>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">{l("ID", "ID")}</th>
                      <th className="px-2 py-2">{l("Type", "Tip")}</th>
                      <th className="px-2 py-2">{l("Status", "Durum")}</th>
                      <th className="px-2 py-2">{l("Effective Date", "Gecerlilik Tarihi")}</th>
                      <th className="px-2 py-2">{l("Posting Date", "Kayit Tarihi")}</th>
                      <th className="px-2 py-2 text-right">{l("Gross (Base)", "Brut (Baz)")}</th>
                      <th className="px-2 py-2 text-right">{l("NBV (Base)", "NBV (Baz)")}</th>
                      <th className="px-2 py-2 text-right">{l("Actions", "Islemler")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const txId = parsePositiveInt(tx.id);
                      const isFocused = focusedTransactionId && txId === focusedTransactionId;
                      const transactionLabel = formatFixedAssetTransactionDisplayLabel(
                        tx.transactionType || tx.transaction_type,
                        tx.sourceRefType || tx.source_ref_type,
                        tx.displayLabel || tx.display_label
                      );
                      const retroCorrectionId = parsePositiveInt(
                        tx.retroCorrectionId || tx.retro_correction_id
                      );
                      const isRetroCorrection = isRetroOwnershipCorrectionTransaction(
                        tx.transactionType || tx.transaction_type
                      );
                      const canReverseRow = canReverseFixedAssetTransactionRow(tx, {
                        canPost,
                        canDispose,
                        canTransfer,
                      });
                      const reversalTransactionId = parsePositiveInt(
                        tx.reversalTransactionId ?? tx.reversal_transaction_id
                      );
                      const reversedTransactionId = parsePositiveInt(
                        tx.reversedTransactionId ?? tx.reversed_transaction_id
                      );
                      const isReversingRow = txId && Number(reversingTransactionId) === Number(txId);
                      return (
                        <tr
                          key={tx.id}
                          className={`border-b border-slate-100 ${
                            isFocused
                              ? "bg-cyan-50 ring-1 ring-cyan-300"
                              : isRetroCorrection
                                ? "bg-emerald-50/40 hover:bg-emerald-50"
                                : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-2 py-1.5 font-mono text-xs">{tx.id}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{transactionLabel}</span>
                              {retroCorrectionId ? (
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                  {l(
                                    `Correction #${retroCorrectionId}`,
                                    `Duzeltme #${retroCorrectionId}`
                                  )}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">{tx.status || "-"}</td>
                          <td className="px-2 py-1.5">{formatDate(tx.effectiveDate || tx.effective_date)}</td>
                          <td className="px-2 py-1.5">{formatDate(tx.postingDate || tx.posting_date)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(tx.grossAmountBase || tx.gross_amount_base)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(tx.nbvAmountBase || tx.nbv_amount_base)}</td>
                          <td className="px-2 py-1.5 text-right">
                            {canReverseRow ? (
                              <button
                                type="button"
                                className="cursor-pointer rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => handleReverseTransaction(tx)}
                                disabled={Boolean(isReversingRow)}
                              >
                                {isReversingRow
                                  ? l("Reversing...", "Ters kayitlaniyor...")
                                  : l("Reverse", "Ters Kayitla")}
                              </button>
                            ) : reversalTransactionId ? (
                              <span className="text-xs text-slate-500">
                                {l(
                                  `Reversed by #${reversalTransactionId}`,
                                  `#${reversalTransactionId} ile ters kayitlandi`
                                )}
                              </span>
                            ) : reversedTransactionId ? (
                              <span className="text-xs text-slate-500">
                                {l(
                                  `Reversal of #${reversedTransactionId}`,
                                  `#${reversedTransactionId} hareketinin ters kaydi`
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* ── Evidence Tab ─────────────────────────────────────────── */}
      {activeTab === "evidence" ? (
        <div className="space-y-4">
          <SectionCard title={l("Evidence Summary", "Kanit Ozeti")} cols={3}>
            <DetailField
              label={l("Asset Attachments", "Demirbas Ekleri")}
              value={assetEvidenceCount}
            />
            <DetailField
              label={l("Source Document Attachments", "Kaynak Belge Ekleri")}
              value={
                !normalizedSourceCariDocumentId
                  ? l("Not linked", "Bagli degil")
                  : canReadCariDocuments
                    ? sourceDocumentEvidenceCount
                    : l("Hidden by permission", "Yetki nedeniyle gizli")
              }
            />
            <DetailField
              label={l("Source Document", "Kaynak Belge")}
              value={
                normalizedSourceCariDocumentId
                  ? canReadCariDocuments && sourceCariDocumentPath
                    ? (
                        <Link
                          to={sourceCariDocumentPath}
                          className="text-cyan-700 hover:underline"
                        >
                          {sourceCariDocumentLabel}
                        </Link>
                      )
                    : sourceCariDocumentLabel
                  : l("Not linked", "Bagli degil")
              }
            />
          </SectionCard>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Asset Evidence", "Demirbas Kanitlari")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {l(
                    "Attach files directly to this asset when the evidence belongs to the asset itself, not only to the source bill or invoice.",
                    "Kanit sadece kaynak fatura/belgeye degil dogrudan bu demirbasa aitse dosyalari burada ekleyin."
                  )}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {l("Count", "Adet")}: {assetEvidenceCount}
              </span>
            </div>

            {assetEvidenceError ? (
              <p className="mt-3 text-sm text-rose-600">{assetEvidenceError}</p>
            ) : null}
            {assetEvidenceMessage ? (
              <p className="mt-3 text-sm text-emerald-700">{assetEvidenceMessage}</p>
            ) : null}
            {assetEvidenceLoading ? (
              <p className="mt-3 text-sm text-slate-500">{l("Loading...", "Yukleniyor...")}</p>
            ) : null}

            {canManageAssetEvidence ? (
              <form
                onSubmit={handleAttachAssetEvidence}
                className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <input
                  key={assetEvidenceUploadInputKey}
                  type="file"
                  className="block w-full cursor-pointer text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
                  onChange={(event) => {
                    setAssetEvidenceError("");
                    setAssetEvidenceMessage("");
                    setAssetEvidenceUploadFile(event.target.files?.[0] || null);
                  }}
                  disabled={assetEvidenceUploading}
                />
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  placeholder={l("Optional note", "Opsiyonel not")}
                  value={assetEvidenceNote}
                  onChange={(event) => setAssetEvidenceNote(event.target.value)}
                  disabled={assetEvidenceUploading}
                />
                <button
                  type="submit"
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!assetEvidenceUploadFile || assetEvidenceUploading}
                >
                  {assetEvidenceUploading
                    ? l("Uploading...", "Yukleniyor...")
                    : l("Attach Evidence", "Kanit Ekle")}
                </button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                {l("Missing permission: fixed_assets.upsert", "Eksik yetki: fixed_assets.upsert")}
              </p>
            )}

            {!assetEvidenceLoading && assetEvidenceRows.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                {l(
                  "No evidence is attached directly to this asset yet.",
                  "Bu demirbasa dogrudan eklenmis kanit henuz yok."
                )}
              </p>
            ) : null}

            {!assetEvidenceLoading && assetEvidenceRows.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {assetEvidenceRows.map((row) => {
                  const rowId = parsePositiveInt(row?.id);
                  const isDownloading = rowId && Number(assetEvidenceDownloadingId) === Number(rowId);
                  const isDeleting = rowId && Number(assetEvidenceDeletingId) === Number(rowId);
                  const isDownloadable = normalizeUpperText(row?.status) === "ACTIVE";
                  return (
                    <li
                      key={`asset-evidence-${row.id}`}
                      className="rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900">
                            {buildEvidenceDisplayName(row)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {row.fileName || "-"} | {formatFileSize(row.fileSizeBytes)} |{" "}
                            {row.contentType || "-"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            status={row.status || "-"} | uploaded={formatDateTime(row.uploadedAt)} |
                            created={formatDateTime(row.createdAt)}
                          </p>
                          {row.note ? (
                            <p className="mt-2 text-sm text-slate-600">note={row.note}</p>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            normalizeUpperText(row?.status) === "ACTIVE"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {row.status || "-"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => handleDownloadAssetEvidence(row)}
                          disabled={!rowId || !isDownloadable || Boolean(isDownloading)}
                        >
                          {isDownloading
                            ? l("Downloading...", "Indiriliyor...")
                            : l("Download", "Indir")}
                        </button>
                        {canManageAssetEvidence ? (
                          <button
                            type="button"
                            className="cursor-pointer rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleDeleteAssetEvidence(row.id)}
                            disabled={!rowId || Boolean(isDeleting)}
                          >
                            {isDeleting ? l("Deleting...", "Siliniyor...") : l("Delete", "Sil")}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Source Document Evidence", "Kaynak Belge Kanitlari")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {l(
                    "Files attached on the source bill or invoice remain on the source CARI document. They are shown here for visibility.",
                    "Kaynak alis/satis belgesine eklenen dosyalar CARI belge uzerinde kalir. Burada gorunurluk icin listelenir."
                  )}
                </p>
              </div>
              {normalizedSourceCariDocumentId && canReadCariDocuments && sourceCariDocumentPath ? (
                <Link
                  to={sourceCariDocumentPath}
                  className="text-sm font-medium text-cyan-700 hover:underline"
                >
                  {l("Open Source Document", "Kaynak Belgeyi Ac")}
                </Link>
              ) : null}
            </div>

            {!normalizedSourceCariDocumentId ? (
              <p className="mt-4 text-sm text-slate-500">
                {l(
                  "This asset is not linked to a source CARI document.",
                  "Bu demirbas bir kaynak CARI belgeye bagli degil."
                )}
              </p>
            ) : !canReadCariDocuments ? (
              <p className="mt-4 text-sm text-slate-500">
                {l("Missing permission: cari.doc.read", "Eksik yetki: cari.doc.read")}
              </p>
            ) : (
              <>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-800">
                    {sourceCariDocumentLabel}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {l("Linked line", "Bagli satir")}: {sourceCariLineLabel}
                  </p>
                </div>

                {sourceDocumentEvidenceError ? (
                  <p className="mt-3 text-sm text-rose-600">{sourceDocumentEvidenceError}</p>
                ) : null}
                {sourceDocumentEvidenceLoading ? (
                  <p className="mt-3 text-sm text-slate-500">{l("Loading...", "Yukleniyor...")}</p>
                ) : null}
                {!sourceDocumentEvidenceLoading && sourceDocumentEvidenceRows.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    {l(
                      "No evidence is attached to the source CARI document.",
                      "Kaynak CARI belgeye eklenmis kanit yok."
                    )}
                  </p>
                ) : null}
                {!sourceDocumentEvidenceLoading && sourceDocumentEvidenceRows.length > 0 ? (
                  <ul className="mt-4 space-y-3">
                    {sourceDocumentEvidenceRows.map((row) => {
                      const rowId = parsePositiveInt(row?.id);
                      const isDownloading =
                        rowId && Number(sourceDocumentEvidenceDownloadingId) === Number(rowId);
                      const isDownloadable = normalizeUpperText(row?.status) === "ACTIVE";
                      return (
                        <li
                          key={`source-document-evidence-${row.id}`}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900">
                                {buildEvidenceDisplayName(row)}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">
                                {row.fileName || "-"} | {formatFileSize(row.fileSizeBytes)} |{" "}
                                {row.contentType || "-"}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                status={row.status || "-"} | uploaded={formatDateTime(row.uploadedAt)} |
                                created={formatDateTime(row.createdAt)}
                              </p>
                              {row.note ? (
                                <p className="mt-2 text-sm text-slate-600">note={row.note}</p>
                              ) : null}
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                normalizeUpperText(row?.status) === "ACTIVE"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {row.status || "-"}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => handleDownloadSourceDocumentEvidence(row)}
                              disabled={!rowId || !isDownloadable || Boolean(isDownloading)}
                            >
                              {isDownloading
                                ? l("Downloading...", "Indiriliyor...")
                                : l("Download", "Indir")}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

      {/* ── Audit Trail Tab ──────────────────────────────────────── */}
      {activeTab === "audit" ? (
        <div className="space-y-4">
          <SectionCard title={l("Audit Trail", "Denetim Izi")}>
            <DetailField label={l("Created By", "Olusturan")} value={createdByLabel} />
            <DetailField label={l("Updated By", "Guncelleyen")} value={updatedByLabel} />
            <DetailField label={l("Created At", "Olusturma Tarihi")} value={formatDate(asset.createdAt)} />
            <DetailField label={l("Updated At", "Guncelleme Tarihi")} value={formatDate(asset.updatedAt)} />
          </SectionCard>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Retro Ownership Correction History", "Retro Sahiplik Duzeltme Gecmisi")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Each posted retro correction stays grouped as one parent record with its true-up and owner-move child transactions.",
                    "Her kaydedilmis retro duzeltme, true-up ve owner-move alt hareketleriyle tek ust kayit olarak gruplanir."
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                {l(
                  `${retroOwnershipCorrectionHistory.length} correction(s)`,
                  `${retroOwnershipCorrectionHistory.length} duzeltme`
                )}
              </div>
            </div>

            {retroOwnershipCorrectionHistory.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                {l(
                  "No retro ownership corrections have been posted for this asset.",
                  "Bu demirbas icin kaydedilmis retro sahiplik duzeltmesi bulunmuyor."
                )}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {retroOwnershipCorrectionHistory.map((correction) => {
                  const impactedPeriods = Array.isArray(correction.impactedPeriods)
                    ? correction.impactedPeriods
                    : [];
                  const childTransactions = Array.isArray(correction.childTransactions)
                    ? correction.childTransactions
                    : [];
                  const fromOwnerLabel = buildOperatingUnitIdentityLabel(
                    correction.fromOwnerOuCode,
                    correction.fromOwnerOuName,
                    correction.fromOwnerOperatingUnitId
                  );
                  const toOwnerLabel = buildOperatingUnitIdentityLabel(
                    correction.toOwnerOuCode,
                    correction.toOwnerOuName,
                    correction.toOwnerOperatingUnitId
                  );
                  return (
                    <article
                      key={`retro-correction-${correction.id}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {l(
                              `Correction #${correction.id}`,
                              `Duzeltme #${correction.id}`
                            )}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {fromOwnerLabel} {"->"} {toOwnerLabel}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            {correction.status || "-"}
                          </span>
                          {correction.currentOwnerChanged ? (
                            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">
                              {l("Current owner updated", "Guncel sahip guncellendi")}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Actual Effective Date", "Gercek Yurumelilik Tarihi")}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {formatDate(correction.actualEffectiveDate)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Correction Posting Date", "Duzeltme Kayit Tarihi")}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {formatDate(correction.correctionPostingDate)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Resolution Mode", "Cozum Modu")}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {correction.resolutionMode || "-"}
                          </p>
                        </div>
                      </div>

                      {correction.note ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Note", "Not")}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">{correction.note}</p>
                        </div>
                      ) : null}

                      {correction.replacesCorrectionId || correction.replacedByCorrectionId ? (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                          {correction.replacesCorrectionId ? (
                            <p>
                              {l(
                                `Replaces correction #${correction.replacesCorrectionId}.`,
                                `#${correction.replacesCorrectionId} duzeltmesinin yerine gecer.`
                              )}
                            </p>
                          ) : null}
                          {correction.replacedByCorrectionId ? (
                            <p>
                              {l(
                                `Superseded by correction #${correction.replacedByCorrectionId}.`,
                                `#${correction.replacedByCorrectionId} duzeltmesi tarafindan supersede edildi.`
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {impactedPeriods.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Impacted Periods", "Etkilenen Donemler")}
                          </p>
                          <div className="mt-3 overflow-auto">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  <th className="px-2 py-2 text-left">{l("Period", "Donem")}</th>
                                  <th className="px-2 py-2 text-right">{l("Delta (Base)", "Fark (Baz)")}</th>
                                  <th className="px-2 py-2 text-right">{l("Source Days", "Kaynak Gun")}</th>
                                  <th className="px-2 py-2 text-right">{l("Target Days", "Hedef Gun")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {impactedPeriods.map((period, index) => (
                                  <tr
                                    key={`retro-correction-period-${correction.id}-${period.periodKey || index}`}
                                    className="border-b border-slate-100 last:border-b-0"
                                  >
                                    <td className="px-2 py-1.5">{period.periodKey || "-"}</td>
                                    <td className="px-2 py-1.5 text-right font-mono">
                                      {formatNumber(period.deltaAmountBase)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono">
                                      {period.sourceEligibleDays ?? 0}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono">
                                      {period.targetEligibleDays ?? 0}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}

                      {childTransactions.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {l("Child Transactions", "Alt Hareketler")}
                          </p>
                          <div className="mt-3 space-y-3">
                            {childTransactions.map((child) => {
                              const childTransactionLabel = formatFixedAssetTransactionDisplayLabel(
                                child.transactionType,
                                child.sourceRefType,
                                child.displayLabel
                              );
                              return (
                                <div
                                  key={`retro-correction-child-${correction.id}-${child.id}`}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">
                                        {childTransactionLabel}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-600">
                                        {l("Transaction", "Hareket")}:{" "}
                                        <Link
                                          to={buildAssetDetailTransactionPath(asset.id, child.id)}
                                          className="font-mono text-cyan-700 hover:underline"
                                        >
                                          #{child.id}
                                        </Link>
                                        {" · "}
                                        {l("Journal", "Fis")}:{" "}
                                        {child.journalEntryId ? (
                                          <span className="font-mono">#{child.journalEntryId}</span>
                                        ) : "-"}
                                      </p>
                                    </div>
                                    <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                      {child.sourceRefType || "-"}
                                    </span>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("Effective Date", "Gecerlilik Tarihi")}
                                      </p>
                                      <p className="mt-1 text-sm text-slate-900">
                                        {formatDate(child.effectiveDate)}
                                      </p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("Posting Date", "Kayit Tarihi")}
                                      </p>
                                      <p className="mt-1 text-sm text-slate-900">
                                        {formatDate(child.postingDate)}
                                      </p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("Status", "Durum")}
                                      </p>
                                      <p className="mt-1 text-sm text-slate-900">
                                        {child.status || "-"}
                                      </p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("Gross (Base)", "Brut (Baz)")}
                                      </p>
                                      <p className="mt-1 font-mono text-sm text-slate-900">
                                        {formatNumber(child.grossAmountBase)}
                                      </p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("Accum Depr (Base)", "Birikm. Amort. (Baz)")}
                                      </p>
                                      <p className="mt-1 font-mono text-sm text-slate-900">
                                        {formatNumber(child.accumDeprAmountBase)}
                                      </p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {l("NBV (Base)", "NBV (Baz)")}
                                      </p>
                                      <p className="mt-1 font-mono text-sm text-slate-900">
                                        {formatNumber(child.nbvAmountBase)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
