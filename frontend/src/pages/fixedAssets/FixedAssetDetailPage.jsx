import { isValidElement, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { listAccounts } from "../../api/glAdmin.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import { getCariDocument } from "../../api/cariDocuments.js";
import { listUsers } from "../../api/rbacAdmin.js";
import {
  activateFixedAsset,
  getFixedAsset,
  getFixedAssetDepreciationSchedule,
  listFixedAssetTransactions,
  saleCreateDraftAr,
} from "../../api/fixedAssets.js";

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
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

function normalizeText(value) {
  return String(value || "").trim();
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
  };
}

const CARI_DOCUMENTS_ROUTE = "/app/satis-faturalari";
const CARI_AP_DOCUMENTS_ROUTE = "/app/alis-faturalari";
const SALE_ELIGIBLE_STATUSES = new Set([
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
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

export default function FixedAssetDetailPage() {
  const { assetId } = useParams();
  const [searchParams] = useSearchParams();
  const { l, t } = useI18n();
  const { hasPermission } = useAuth();
  const canRead = hasPermission("fixed_assets.read");
  const canUpsert = hasPermission("fixed_assets.upsert");
  const canPost = hasPermission("fixed_assets.post");
  const canDispose = hasPermission("fixed_assets.dispose");
  const canTransfer = hasPermission("fixed_assets.transfer");
  const canOverrideAccounts = hasPermission("fixed_assets.account_override");
  const canReadCariDocuments = hasPermission("cari.doc.read");
  const canCreateCariDocuments = hasPermission("cari.doc.create");

  // Deep-link query params: tab and transactionId
  const queryTab = searchParams.get("tab");
  const queryTransactionId = parsePositiveInt(searchParams.get("transactionId"));

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initialTab = queryTab === "transactions" ? "transactions" : "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Transaction list state (loaded when transactions tab is active)
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");

  // Depreciation schedule state
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [legacySaleFallbackOpen, setLegacySaleFallbackOpen] = useState(false);
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
  const [accountRows, setAccountRows] = useState([]);
  const [operatingUnitRows, setOperatingUnitRows] = useState([]);
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
    setLegacySaleFallbackError("");
    setLegacySaleFallbackResult(null);
    setLegacySaleFallbackForm(createInitialLegacySaleFallbackForm());
    setActivationOpen(false);
    setActivationError("");
    setActivationSuccess("");
    setActivationForm(buildActivationForm(asset));
  }, [asset?.id]);

  useEffect(() => {
    const legalEntityId = parsePositiveInt(asset?.legalEntityId);
    if (!legalEntityId) {
      setAccountRows([]);
      setOperatingUnitRows([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [accountResponse, operatingUnitResponse] = await Promise.all([
          listAccounts({
            legalEntityId,
            includeInactive: true,
            limit: 1000,
          }),
          listOperatingUnits({ legalEntityId, limit: 500 }),
        ]);
        if (!active) return;
        setAccountRows(Array.isArray(accountResponse?.rows) ? accountResponse.rows : []);
        setOperatingUnitRows(Array.isArray(operatingUnitResponse?.rows) ? operatingUnitResponse.rows : []);
      } catch {
        if (!active) return;
        setAccountRows([]);
        setOperatingUnitRows([]);
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
    status === "SUSPENDED" ? "bg-amber-100 text-amber-800" :
    status === "FULLY_DEPRECIATED" ? "bg-blue-100 text-blue-800" :
    "bg-slate-100 text-slate-700";
  const isSaleEligibleStatus = SALE_ELIGIBLE_STATUSES.has(status);
  const canOpenCariSaleFlow = canReadCariDocuments && canCreateCariDocuments;
  const canUseLegacySaleFallback = canDispose && canCreateCariDocuments;
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
  const createdByLabel = buildUserLabel(userRows, asset.createdByUserId);
  const updatedByLabel = buildUserLabel(userRows, asset.updatedByUserId);

  async function handleCreateLegacySaleFallbackDraft() {
    const normalizedAssetId = parsePositiveInt(asset?.id);
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

    if (!postingDate || !capitalizationDate || !inServiceDate) {
      setActivationError(
        l(
          "Posting date, capitalization date, and in-service date are required.",
          "Kayit tarihi, aktiflesme tarihi ve hizmete giris tarihi zorunludur."
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
                className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                onClick={() => {
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
              <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200">
                {l("Suspend", "Askiya Al")}
              </span>
            ) : null}
            {canPost && status === "SUSPENDED" ? (
              <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
                {l("Reactivate", "Yeniden Aktiflestir")}
              </span>
            ) : null}
            {canTransfer && (status === "ACTIVE" || status === "SUSPENDED") ? (
              <>
                <span className="rounded-md bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 border border-blue-200">
                  {l("Physical Move", "Fiziksel Hareket")}
                </span>
                <span className="rounded-md bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 border border-blue-200">
                  {l("Ownership Transfer", "Sahiplik Transferi")}
                </span>
              </>
            ) : null}
            {canDispose && status === "ACTIVE" ? (
              <span className="rounded-md bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 border border-rose-200">
                {l("Write Off", "Hurda Islem")}
              </span>
            ) : null}
            {canDispose && isSaleEligibleStatus ? (
              <span className="rounded-md bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 border border-rose-200">
                {l("Sale", "Satis")}
              </span>
            ) : null}
          </div>
          {activationSuccess ? (
            <p className="mt-3 text-sm text-emerald-700">{activationSuccess}</p>
          ) : null}
          {activationError ? (
            <p className="mt-3 text-sm text-rose-700">{activationError}</p>
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
                  {l("Capitalization Date", "Aktiflesme Tarihi")}
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  onClick={handleActivateAsset}
                  disabled={activationSaving}
                >
                  {activationSaving
                    ? l("Activating...", "Aktiflestiriliyor...")
                    : l("Confirm Activation", "Aktiflestirmeyi Onayla")}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
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
          {canOverrideAccounts ? (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <span className="rounded-md bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 border border-violet-200">
                {l("Override Account Mappings", "Hesap Eslemelerini Gecersiz Kil")}
              </span>
            </div>
          ) : null}
          {canDispose && isSaleEligibleStatus ? (
            <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
                {t("fixedAssets.detail.preferredSaleFlowTitle")}
              </p>
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
                        className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900"
                        onClick={handleCreateLegacySaleFallbackDraft}
                        disabled={legacySaleFallbackSaving}
                      >
                        {legacySaleFallbackSaving
                          ? t("fixedAssets.detail.creatingLegacySaleFallbackDraft")
                          : t("fixedAssets.detail.createLegacySaleFallbackDraft")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
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
                        className="inline-flex rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                        onClick={() => {
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
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
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
                    {schedule.map((line, idx) => (
                      <tr key={line.id || idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5">{line.periodKey || line.period_key || "-"}</td>
                        <td className="px-2 py-1.5">{line.status || "-"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(line.depreciationAmountBase || line.depreciation_amount_base)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(line.accumDepreciationBase || line.accum_depreciation_base)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(line.nbvBase || line.nbv_base)}</td>
                      </tr>
                    ))}
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
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const txId = parsePositiveInt(tx.id);
                      const isFocused = focusedTransactionId && txId === focusedTransactionId;
                      return (
                        <tr
                          key={tx.id}
                          className={`border-b border-slate-100 ${isFocused ? "bg-cyan-50 ring-1 ring-cyan-300" : "hover:bg-slate-50"}`}
                        >
                          <td className="px-2 py-1.5 font-mono text-xs">{tx.id}</td>
                          <td className="px-2 py-1.5">{tx.transactionType || tx.transaction_type || "-"}</td>
                          <td className="px-2 py-1.5">{tx.status || "-"}</td>
                          <td className="px-2 py-1.5">{formatDate(tx.effectiveDate || tx.effective_date)}</td>
                          <td className="px-2 py-1.5">{formatDate(tx.postingDate || tx.posting_date)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(tx.grossAmountBase || tx.gross_amount_base)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNumber(tx.nbvAmountBase || tx.nbv_amount_base)}</td>
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
          <SectionCard title={l("Evidence Summary", "Kanit Ozeti")} cols={2}>
            <DetailField label={l("Total Attachments", "Toplam Ek")} value={asset.evidenceSummary?.totalCount} />
          </SectionCard>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{l("Evidence", "Kanit")}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {l(
                "Evidence endpoints are available. Full evidence management UI will be delivered with the frontend completion pass.",
                "Kanit endpointleri kullanilabilir. Tam kanit yonetimi arayuzu frontend tamamlama adiminda sunulacaktir."
              )}
            </p>
          </section>
        </div>
      ) : null}

      {/* ── Audit Trail Tab ──────────────────────────────────────── */}
      {activeTab === "audit" ? (
        <SectionCard title={l("Audit Trail", "Denetim Izi")}>
          <DetailField label={l("Created By", "Olusturan")} value={createdByLabel} />
          <DetailField label={l("Updated By", "Guncelleyen")} value={updatedByLabel} />
          <DetailField label={l("Created At", "Olusturma Tarihi")} value={formatDate(asset.createdAt)} />
          <DetailField label={l("Updated At", "Guncelleme Tarihi")} value={formatDate(asset.updatedAt)} />
        </SectionCard>
      ) : null}
    </div>
  );
}
