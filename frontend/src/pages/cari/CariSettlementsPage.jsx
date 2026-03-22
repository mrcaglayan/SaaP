import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  applyCariSettlement,
  attachCariBankReference,
  applyCariBankSettlement,
  describeCariSettlementContext,
  getCariSettlementErrorHint,
  reverseCariSettlement,
} from "../../api/cariSettlements.js";
import {
  listCashRegisters,
  listCashSessions,
} from "../../api/cashAdmin.js";
import { listAccounts } from "../../api/glAdmin.js";
import {
  createCariCounterparty,
  listCariCounterparties,
} from "../../api/cariCounterparty.js";
import { listFxRates } from "../../api/fxAdmin.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { getCariOpenItemsReport } from "../../api/cariReports.js";
import { getCariCounterpartyStatementReport } from "../../api/cariReports.js";
import { extractCariReplayAndRisks } from "../../api/cariCommon.js";
import Combobox from "../../components/Combobox.jsx";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContextDefaults } from "../../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../../hooks/usePersistedFilters.js";
import {
  formatOperatingUnitCurrentAccountBlocker,
  OU_CURRENT_ACCOUNT_SETUP_PATH,
} from "../../readiness/ouCurrentAccountReadiness.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import { formatMoneyText } from "../../utils/money.js";
import {
  buildAutoAllocatePreview,
  buildSettlementApplyPayload,
  FX_MISSING_REASON_CODES,
} from "./cariSettlementsUtils.js";
import {
  buildSettlementIntentFingerprint,
  buildSettlementIntentScope,
  clearPendingIdempotencyKey,
  createEphemeralIdempotencyKey,
  createPendingIdempotencyKey,
  loadPendingIdempotencyKey,
  shouldClearPendingKeyAfterError,
} from "./cariIdempotency.js";
import {
  buildInlineCounterpartyCode,
  normalizeLookupQuery,
  prependOrReplaceCounterpartyOption,
  resolveInlineCounterpartyRoleFlags,
} from "./counterpartyInlineCreate.js";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toDateTimeLocalInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDirection(value) {
  const normalized = toUpper(value);
  if (normalized === "AR" || normalized === "AP") {
    return normalized;
  }
  return "";
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
}

function formatFxMissingReason(reasonCode, translate = (en) => en) {
  switch (String(reasonCode || "").trim().toUpperCase()) {
    case FX_MISSING_REASON_CODES.SETTLEMENT_OR_DOCUMENT_CURRENCY_MISSING:
      return translate(
        "Settlement or document currency is missing.",
        "Mahsuplastirma veya belge para birimi eksik."
      );
    case FX_MISSING_REASON_CODES.FUNCTIONAL_CURRENCY_REQUIRED_FOR_DERIVED_CROSS_RATE:
      return translate(
        "Functional currency is required for derived cross-rate.",
        "Turetilmis capraz kur icin fonksiyonel para birimi gerekli."
      );
    case FX_MISSING_REASON_CODES.SETTLEMENT_DOCUMENT_CONVERSION_RATE_MISSING:
      return translate(
        "Missing settlement/document conversion rate. Add SPOT rate(s) for settlement date.",
        "Mahsuplastirma/belge donusum kuru eksik. Mahsuplastirma tarihi icin SPOT kur(lar) ekleyin."
      );
    case FX_MISSING_REASON_CODES.DERIVED_CROSS_RATE_INVALID:
      return translate(
        "Derived cross-rate is invalid.",
        "Turetilmis capraz kur gecersiz."
      );
    default:
      return translate("Missing FX rate", "Kur eksik");
  }
}

function resolveOpenItemCurrencyCode(row) {
  return normalizeCurrencyCode(
    row?.currencyCode || row?.currency_code || row?.currencyCodeSnapshot || row?.currency_code_snapshot
  );
}

function formatCrossRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 10,
  });
}

function resolveLegalEntityCurrencyCode(legalEntities, legalEntityId) {
  const resolvedLegalEntityId = toPositiveInt(legalEntityId);
  if (!resolvedLegalEntityId) {
    return "";
  }
  const legalEntityRows = Array.isArray(legalEntities) ? legalEntities : [];
  const matchedLegalEntity =
    legalEntityRows.find((row) => toPositiveInt(row?.id) === resolvedLegalEntityId) || null;
  if (!matchedLegalEntity) {
    return "";
  }
  return normalizeCurrencyCode(
    matchedLegalEntity?.functional_currency_code || matchedLegalEntity?.functionalCurrencyCode
  );
}

function hasSelectableLegalEntity(legalEntities, legalEntityId) {
  const resolvedLegalEntityId = toPositiveInt(legalEntityId);
  if (!resolvedLegalEntityId) {
    return true;
  }
  return (Array.isArray(legalEntities) ? legalEntities : []).some(
    (row) => toPositiveInt(row?.id) === resolvedLegalEntityId
  );
}

function resolveCounterpartyRoleFromDirection(direction) {
  const normalized = toUpper(direction);
  if (normalized === "AR") return "CUSTOMER";
  if (normalized === "AP") return "VENDOR";
  return undefined;
}

function resolveCounterpartySettlementAccountId(counterparty, direction) {
  const normalizedDirection = toUpper(direction);
  if (normalizedDirection === "AP") {
    return toPositiveInt(counterparty?.apAccountId || counterparty?.ap_account_id);
  }
  if (normalizedDirection === "AR") {
    return toPositiveInt(counterparty?.arAccountId || counterparty?.ar_account_id);
  }
  return null;
}

function resolveCounterpartySettlementAccountMeta(counterparty, direction) {
  const normalizedDirection = toUpper(direction);
  if (normalizedDirection === "AP") {
    return {
      accountId: toPositiveInt(counterparty?.apAccountId || counterparty?.ap_account_id),
      accountCode: String(counterparty?.apAccountCode || counterparty?.ap_account_code || "").trim(),
      accountName: String(counterparty?.apAccountName || counterparty?.ap_account_name || "").trim(),
      accountRoleLabel: "AP",
    };
  }
  if (normalizedDirection === "AR") {
    return {
      accountId: toPositiveInt(counterparty?.arAccountId || counterparty?.ar_account_id),
      accountCode: String(counterparty?.arAccountCode || counterparty?.ar_account_code || "").trim(),
      accountName: String(counterparty?.arAccountName || counterparty?.ar_account_name || "").trim(),
      accountRoleLabel: "AR",
    };
  }
  return {
    accountId: null,
    accountCode: "",
    accountName: "",
    accountRoleLabel: "",
  };
}

function mapCounterpartyLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = String(row?.code || id || "").trim();
  const name = String(row?.name || "").trim();
  const counterpartyType = toUpper(row?.counterpartyType || "OTHER");
  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: counterpartyType || "OTHER",
  };
}

function mapGlAccountLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = String(row?.code || id || "").trim();
  const name = String(row?.name || "").trim();
  const breadcrumb = String(
    row?.account_breadcrumb || row?.accountBreadcrumb || row?.breadcrumb || ""
  ).trim();
  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: breadcrumb || "",
  };
}

function isActivePostingAccount(row, legalEntityId = null) {
  if (!row) {
    return false;
  }
  const rowLegalEntityId = toPositiveInt(row.legal_entity_id || row.legalEntityId);
  if (legalEntityId && rowLegalEntityId && rowLegalEntityId !== legalEntityId) {
    return false;
  }
  const allowPosting =
    row.allow_posting === 1 || row.allowPosting === true || row.allow_posting === true;
  const isActive = row.is_active === 1 || row.isActive === true || row.is_active === true;
  return allowPosting && isActive;
}

function toPositiveDecimal(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalPositiveDecimal(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toPositiveDecimal(value);
}

function normalizeUiError(error, fallback) {
  const message = String(error?.message || error?.response?.data?.message || fallback || "Request failed");
  const requestId = String(error?.requestId || error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message;
}

function resolveOperatingUnitContextFromRow(row) {
  return {
    operatingUnitId: toPositiveInt(row?.operatingUnitId || row?.operating_unit_id),
    operatingUnitCode: String(row?.operatingUnitCode || row?.operating_unit_code || "").trim(),
    operatingUnitName: String(row?.operatingUnitName || row?.operating_unit_name || "").trim(),
  };
}

function deriveSingleOwnerContext(rows = []) {
  const byContextKey = new Map();
  for (const row of rows) {
    const context = resolveOperatingUnitContextFromRow(row);
    const key = context.operatingUnitId ? String(context.operatingUnitId) : "CENTRAL";
    if (!byContextKey.has(key)) {
      byContextKey.set(key, context);
    }
  }

  const contexts = Array.from(byContextKey.values());
  return {
    contexts,
    hasMixed: contexts.length > 1,
    primary: contexts[0] || {
      operatingUnitId: null,
      operatingUnitCode: "",
      operatingUnitName: "",
    },
  };
}

function formatReadinessReason(reason, translate = (en) => en) {
  switch (String(reason || "").trim().toUpperCase()) {
    case "ACCOUNT_NOT_FOUND":
      return translate(
        "Mapped account no longer exists.",
        "Eslenen hesap artik mevcut degil."
      );
    case "ACCOUNT_INACTIVE":
      return translate("Mapped account is inactive.", "Eslenen hesap pasif.");
    case "ACCOUNT_NOT_POSTABLE":
      return translate(
        "Mapped account is not postable.",
        "Eslenen hesap kayit yapilabilir degil."
      );
    case "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY":
      return translate(
        "Mapped account is not in a legal-entity chart.",
        "Eslenen hesap tuzel kisilik hesap planinda degil."
      );
    case "ACCOUNT_LEGAL_ENTITY_MISMATCH":
      return translate(
        "Mapped account belongs to a different legal entity.",
        "Eslenen hesap farkli bir tuzel kisilige ait."
      );
    case "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS":
      return translate(
        "Control and offset must map to different accounts.",
        "Kontrol ve karsi hesap farkli hesaplara eslenmelidir."
      );
    case "MAPPED_ACCOUNT_ID_INVALID":
      return translate("Mapped account id is invalid.", "Eslenen hesap id gecersiz.");
    case "ACCOUNT_TENANT_MISMATCH":
      return translate(
        "Mapped account belongs to a different tenant.",
        "Eslenen hesap farkli bir tenant'a ait."
      );
    case "ACCOUNT_TYPE_MISMATCH":
      return translate(
        "Mapped account type does not match this purpose.",
        "Eslenen hesap turu bu amacla uyusmuyor."
      );
    case "ACCOUNT_NORMAL_SIDE_MISMATCH":
      return translate(
        "Mapped account normal side does not match this purpose.",
        "Eslenen hesap normal bakiye yonu bu amacla uyusmuyor."
      );
    default:
      return String(reason || translate("Invalid mapping.", "Gecersiz esleme."));
  }
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseManualAllocations(openItems, draftMap) {
  const allocations = [];
  for (const item of openItems || []) {
    const openItemId = Number(item?.openItemId || 0);
    if (!openItemId) {
      continue;
    }
    const key = String(openItemId);
    const amount = toOptionalPositiveDecimal(draftMap?.[key]);
    if (!amount) {
      continue;
    }
    allocations.push({ openItemId, amountTxn: amount });
  }
  return allocations;
}

function parseAllocationsJson(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("allocations must be a JSON array.");
  }
  return parsed.map((entry, index) => {
    const openItemId = toPositiveInt(entry?.openItemId);
    const amountTxn = toPositiveDecimal(entry?.amountTxn);
    if (!openItemId) {
      throw new Error(`allocations[${index}].openItemId must be a positive integer.`);
    }
    if (!amountTxn) {
      throw new Error(`allocations[${index}].amountTxn must be > 0.`);
    }
    return { openItemId, amountTxn };
  });
}

function hasMixedDirections(openItems = []) {
  const directions = new Set(
    openItems
      .map((row) => String(row?.direction || "").trim().toUpperCase())
      .filter(Boolean)
  );
  return directions.size > 1;
}

function buildApplyDefaultForm(direction = "") {
  const defaultDirection = normalizeDirection(direction);
  return {
    legalEntityId: "",
    counterpartyId: "",
    direction: defaultDirection,
    settlementDate: todayIsoDate(),
    currencyCode: "USD",
    incomingAmountTxn: "",
    idempotencyKey: "",
    autoAllocate: true,
    useUnappliedCash: false,
    allocations: [],
    fxRate: "",
    offsetAccountId: "",
    note: "",
  };
}

function buildLinkedCashDefaultForm() {
  return {
    paymentChannel: "MANUAL",
    createLinkedCashTransaction: false,
    registerId: "",
    cashSessionId: "",
    counterAccountId: "",
    txnDatetime: toDateTimeLocalInput(),
    bookDate: todayIsoDate(),
    referenceNo: "",
    description: "",
  };
}

function buildBankAttachDefaultForm() {
  return {
    legalEntityId: "",
    targetType: "SETTLEMENT",
    settlementBatchId: "",
    unappliedCashId: "",
    bankStatementLineId: "",
    bankTransactionRef: "",
    idempotencyKey: "",
    note: "",
  };
}

function buildBankApplyDefaultForm(direction = "") {
  const defaultDirection = normalizeDirection(direction);
  return {
    legalEntityId: "",
    counterpartyId: "",
    direction: defaultDirection,
    settlementDate: todayIsoDate(),
    currencyCode: "USD",
    incomingAmountTxn: "",
    useUnappliedCash: false,
    autoAllocate: true,
    allocationsJson: "",
    bankStatementLineId: "",
    bankTransactionRef: "",
    bankApplyIdempotencyKey: "",
    note: "",
  };
}

function buildReverseDefaultForm() {
  return {
    settlementBatchId: "",
    reversalDate: todayIsoDate(),
    reason: "Manual settlement reversal",
  };
}

function buildReverseLookupDefaultFilters() {
  return {
    legalEntityId: "",
    counterpartyId: "",
    asOfDate: todayIsoDate(),
  };
}

function buildPreviewDefaultFilters(direction = "") {
  const defaultDirection = normalizeDirection(direction);
  return {
    legalEntityId: "",
    counterpartyId: "",
    asOfDate: todayIsoDate(),
    direction: defaultDirection,
  };
}

function resolveRouteFixedDirection(directionProp, searchParams) {
  const propDirection = normalizeDirection(directionProp);
  if (propDirection) {
    return propDirection;
  }
  if (!(searchParams instanceof URLSearchParams)) {
    return "";
  }
  return normalizeDirection(searchParams.get("direction"));
}

function getSettlementPageHeading(direction, l) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return {
      title: l("AP Payments", "Tedarikci Odemeler"),
      description: l(
        "Payment allocation, reversal, and linked-cash workflows are locked to AP on this page.",
        "Bu sayfada odeme mahsuplastirma, tersleme ve bagli nakit akislari AP ile sinirlidir."
      ),
    };
  }
  if (normalizedDirection === "AR") {
    return {
      title: l("AR Receipts", "Musteri Tahsilatlar"),
      description: l(
        "Receipt allocation, reversal, and linked-cash workflows are locked to AR on this page.",
        "Bu sayfada tahsilat mahsuplastirma, tersleme ve bagli nakit akislari AR ile sinirlidir."
      ),
    };
  }
  return {
    title: l("Cari Settlements", "Cari Mahsuplastirmalari"),
    description: l(
      "Settlement apply/reverse and bank attach/apply workflows are separated on this page.",
      "Mahsuplastirma uygula/tersle ve banka bagla/uygula akislari bu sayfada ayridir."
    ),
  };
}

const SETTLEMENT_PREVIEW_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "asOfDate", contextKey: "dateTo" },
];
const SETTLEMENT_APPLY_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "settlementDate", contextKey: "dateTo" },
];
const SETTLEMENT_BANK_ATTACH_CONTEXT_MAPPINGS = [{ stateKey: "legalEntityId" }];
const SETTLEMENT_BANK_APPLY_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "settlementDate", contextKey: "dateTo" },
];
const SETTLEMENT_REVERSE_CONTEXT_MAPPINGS = [
  { stateKey: "reversalDate", contextKey: "dateTo" },
];
const SETTLEMENT_PREVIEW_FILTERS_STORAGE_SCOPE = "cari-settlements.preview";
const LINKED_CASH_SESSION_REQUIRED_ERROR =
  "cashSessionId is required because selected cash register has session_mode=REQUIRED.";
const LINKED_CASH_OPEN_SESSION_REQUIRED_ERROR =
  "Selected cash register requires an OPEN cash session. Open one from Cash Sessions first.";

export default function CariSettlementsPage({ direction = "" }) {
  const [searchParams] = useSearchParams();
  const fixedRouteDirection = useMemo(
    () => resolveRouteFixedDirection(direction, searchParams),
    [direction, searchParams]
  );
  const hasFixedRouteDirection = Boolean(fixedRouteDirection);
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const { getModuleRow } = useModuleReadiness();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const settlementPageHeading = getSettlementPageHeading(fixedRouteDirection, l);
  const translateLinkedCashValidationError = (message) => {
    switch (String(message || "").trim()) {
      case "Missing permission: cash.txn.create":
        return l("Missing permission: cash.txn.create", "Eksik yetki: cash.txn.create");
      case "Missing permission: cash.register.read (required to list OPEN cash sessions).":
        return l(
          "Missing permission: cash.register.read (required to list OPEN cash sessions).",
          "Eksik yetki: cash.register.read (OPEN kasa oturumlarini listelemek icin gerekli)."
        );
      case "registerId is required for linked cash transaction.":
        return l(
          "registerId is required for linked cash transaction.",
          "Bagli nakit islemi icin registerId zorunludur."
        );
      case LINKED_CASH_OPEN_SESSION_REQUIRED_ERROR:
        return l(
          LINKED_CASH_OPEN_SESSION_REQUIRED_ERROR,
          "Secili kasa icin OPEN durumunda bir kasa oturumu gerekir. Once Kasa Oturumlari ekranindan acin."
        );
      case LINKED_CASH_SESSION_REQUIRED_ERROR:
        return l(
          LINKED_CASH_SESSION_REQUIRED_ERROR,
          "Secili kasada session_mode=REQUIRED oldugu icin cashSessionId zorunludur."
        );
      case "counterAccountId is required for linked cash transaction.":
        return l(
          "counterAccountId is required for linked cash transaction.",
          "Bagli nakit islemi icin counterAccountId zorunludur."
        );
      case "direction must be AR or AP when linked cash creation is enabled.":
        return l(
          "direction must be AR or AP when linked cash creation is enabled.",
          "Bagli nakit olusturma acikken yon AR veya AP olmali."
        );
      case "counterpartyId is required when linked cash creation is enabled.":
        return l(
          "counterpartyId is required when linked cash creation is enabled.",
          "Bagli nakit olusturma acikken counterpartyId zorunludur."
        );
      case "incomingAmountTxn must be > 0 when linked cash creation is enabled.":
        return l(
          "incomingAmountTxn must be > 0 when linked cash creation is enabled.",
          "Bagli nakit olusturma acikken incomingAmountTxn 0'dan buyuk olmali."
        );
      default:
        return String(message || "");
    }
  };
  const translateAllocationsJsonError = (message) => {
    const text = String(message || "").trim();
    if (text === "allocations must be a JSON array.") {
      return l("allocations must be a JSON array.", "allocations bir JSON dizisi olmali.");
    }
    const openItemMatch = text.match(/^allocations\[(\d+)\]\.openItemId must be a positive integer\.$/);
    if (openItemMatch) {
      return l(
        text,
        `allocations[${openItemMatch[1]}].openItemId pozitif bir tam sayi olmali.`
      );
    }
    const amountMatch = text.match(/^allocations\[(\d+)\]\.amountTxn must be > 0\.$/);
    if (amountMatch) {
      return l(
        text,
        `allocations[${amountMatch[1]}].amountTxn 0'dan buyuk olmali.`
      );
    }
    return text;
  };
  const canApply = hasPermission("cari.settlement.apply");
  const canReverse = hasPermission("cari.settlement.reverse");
  const canBankAttach = hasPermission("cari.bank.attach");
  const canBankApply = hasPermission("cari.bank.apply");
  const canReadReports = hasPermission("cari.report.read");
  const canReadCards = hasPermission("cari.card.read");
  const canUpsertCards = hasPermission("cari.card.upsert");
  const canReadOrg = hasPermission("org.tree.read");
  const canReadFxRates = hasPermission("fx.rate.read");
  const canCreateCashTxn = hasPermission("cash.txn.create");
  const canReadCashRegisters = hasPermission("cash.register.read");
  // Cash session listing endpoint is guarded by cash.register.read.
  const canReadCashSessions = canReadCashRegisters;
  const canReadGlAccounts = hasPermission("gl.account.read");

  const [previewFilters, setPreviewFilters] = usePersistedFilters(
    SETTLEMENT_PREVIEW_FILTERS_STORAGE_SCOPE,
    () => buildPreviewDefaultFilters(fixedRouteDirection)
  );
  const [openItems, setOpenItems] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewFxRates, setPreviewFxRates] = useState([]);
  const [previewFxLoading, setPreviewFxLoading] = useState(false);
  const [previewFxError, setPreviewFxError] = useState("");
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);

  const [applyForm, setApplyForm] = useState(() => buildApplyDefaultForm(fixedRouteDirection));
  const [applyCurrencyManuallyEdited, setApplyCurrencyManuallyEdited] = useState(false);
  const [manualAllocationDraft, setManualAllocationDraft] = useState({});
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const [applyReplayMessage, setApplyReplayMessage] = useState("");
  const [applyResult, setApplyResult] = useState(null);
  const [applyFollowUpRisks, setApplyFollowUpRisks] = useState([]);
  const [linkedCashForm, setLinkedCashForm] = useState(() => buildLinkedCashDefaultForm());
  const [linkedCashError, setLinkedCashError] = useState("");
  const [linkedCashMessage, setLinkedCashMessage] = useState("");
  const [linkedCashResult, setLinkedCashResult] = useState(null);
  const [legalEntities, setLegalEntities] = useState([]);
  const [counterpartyOptions, setCounterpartyOptions] = useState([]);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [applyCounterpartyLookupQuery, setApplyCounterpartyLookupQuery] = useState("");
  const [applyInlineCounterpartySaving, setApplyInlineCounterpartySaving] = useState(false);
  const [applyInlineCounterpartyError, setApplyInlineCounterpartyError] = useState("");
  const [applyInlineCounterpartyMessage, setApplyInlineCounterpartyMessage] = useState("");
  const [bankApplyCounterpartyOptions, setBankApplyCounterpartyOptions] = useState([]);
  const [bankApplyCounterpartyLoading, setBankApplyCounterpartyLoading] = useState(false);
  const [bankApplyCounterpartyLookupQuery, setBankApplyCounterpartyLookupQuery] = useState("");
  const [bankApplyInlineCounterpartySaving, setBankApplyInlineCounterpartySaving] = useState(false);
  const [bankApplyInlineCounterpartyError, setBankApplyInlineCounterpartyError] = useState("");
  const [bankApplyInlineCounterpartyMessage, setBankApplyInlineCounterpartyMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");
  const [cashRegisterOptions, setCashRegisterOptions] = useState([]);
  const [openCashSessions, setOpenCashSessions] = useState([]);
  const [applyOffsetAccountOptions, setApplyOffsetAccountOptions] = useState([]);
  const [applyOffsetAccountsLoading, setApplyOffsetAccountsLoading] = useState(false);
  const [applyOffsetAccountsError, setApplyOffsetAccountsError] = useState("");
  const [linkedCashAccountOptions, setLinkedCashAccountOptions] = useState([]);
  const [linkedCashAccountLoading, setLinkedCashAccountLoading] = useState(false);
  const [linkedCashAccountError, setLinkedCashAccountError] = useState("");
  const [linkedCashAccountQuery, setLinkedCashAccountQuery] = useState("");

  const [reverseForm, setReverseForm] = useState(() => ({
    ...buildReverseDefaultForm(),
    reason: l("Manual settlement reversal", "Manuel mahsuplastirma tersleme"),
  }));
  const [reverseLookupFilters, setReverseLookupFilters] = useState(() =>
    buildReverseLookupDefaultFilters()
  );
  const [reverseSettlementRows, setReverseSettlementRows] = useState([]);
  const [reverseSettlementLoading, setReverseSettlementLoading] = useState(false);
  const [reverseSettlementLookupError, setReverseSettlementLookupError] = useState("");
  const [reverseSettlementLookupQuery, setReverseSettlementLookupQuery] = useState("");
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const [reverseMessage, setReverseMessage] = useState("");
  const [reverseResult, setReverseResult] = useState(null);

  const [bankAttachForm, setBankAttachForm] = useState(() => buildBankAttachDefaultForm());
  const [bankAttachSubmitting, setBankAttachSubmitting] = useState(false);
  const [bankAttachError, setBankAttachError] = useState("");
  const [bankAttachMessage, setBankAttachMessage] = useState("");
  const [bankAttachResult, setBankAttachResult] = useState(null);

  const [bankApplyForm, setBankApplyForm] = useState(() =>
    buildBankApplyDefaultForm(fixedRouteDirection)
  );
  const [bankApplyCurrencyManuallyEdited, setBankApplyCurrencyManuallyEdited] =
    useState(false);
  const [bankApplySubmitting, setBankApplySubmitting] = useState(false);
  const [bankApplyError, setBankApplyError] = useState("");
  const [bankApplyMessage, setBankApplyMessage] = useState("");
  const [bankApplyResult, setBankApplyResult] = useState(null);
  const [bankApplyFollowUpRisks, setBankApplyFollowUpRisks] = useState([]);
  const linkedCashSessionInputRef = useRef(null);
  const deepLinkedSettlementBatchId = toPositiveInt(
    searchParams.get("settlementBatchId") || searchParams.get("settlement_batch_id")
  );
  const deepLinkedLegalEntityId = toPositiveInt(
    searchParams.get("legalEntityId") || searchParams.get("legal_entity_id")
  );
  const deepLinkedCounterpartyId = toPositiveInt(
    searchParams.get("counterpartyId") || searchParams.get("counterparty_id")
  );

  useWorkingContextDefaults(setPreviewFilters, SETTLEMENT_PREVIEW_CONTEXT_MAPPINGS, [
    previewFilters.legalEntityId,
    previewFilters.asOfDate,
  ]);
  useWorkingContextDefaults(setApplyForm, SETTLEMENT_APPLY_CONTEXT_MAPPINGS, [
    applyForm.legalEntityId,
    applyForm.settlementDate,
  ]);
  useWorkingContextDefaults(setBankAttachForm, SETTLEMENT_BANK_ATTACH_CONTEXT_MAPPINGS, [
    bankAttachForm.legalEntityId,
  ]);
  useWorkingContextDefaults(setBankApplyForm, SETTLEMENT_BANK_APPLY_CONTEXT_MAPPINGS, [
    bankApplyForm.legalEntityId,
    bankApplyForm.settlementDate,
  ]);
  useWorkingContextDefaults(setReverseForm, SETTLEMENT_REVERSE_CONTEXT_MAPPINGS, [
    reverseForm.reversalDate,
  ]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    setPreviewFilters((prev) => {
      if (normalizeDirection(prev?.direction) === fixedRouteDirection) {
        return prev;
      }
      return {
        ...prev,
        direction: fixedRouteDirection,
        counterpartyId: "",
      };
    });
  }, [fixedRouteDirection, hasFixedRouteDirection, setPreviewFilters]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    setApplyForm((prev) => {
      if (normalizeDirection(prev?.direction) === fixedRouteDirection) {
        return prev;
      }
      return {
        ...prev,
        direction: fixedRouteDirection,
        counterpartyId: "",
        offsetAccountId: "",
      };
    });
  }, [fixedRouteDirection, hasFixedRouteDirection]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    setBankApplyForm((prev) => {
      if (normalizeDirection(prev?.direction) === fixedRouteDirection) {
        return prev;
      }
      return {
        ...prev,
        direction: fixedRouteDirection,
        counterpartyId: "",
      };
    });
  }, [fixedRouteDirection, hasFixedRouteDirection]);

  useEffect(() => {
    if (!deepLinkedSettlementBatchId) {
      return;
    }

    setReverseSettlementLookupQuery("");
    setReverseForm((prev) => {
      const nextSettlementBatchId = String(deepLinkedSettlementBatchId);
      if (String(prev?.settlementBatchId || "") === nextSettlementBatchId) {
        return prev;
      }
      return {
        ...prev,
        settlementBatchId: nextSettlementBatchId,
      };
    });
    setReverseLookupFilters((prev) => {
      let next = prev;
      if (
        deepLinkedLegalEntityId &&
        String(prev?.legalEntityId || "") !== String(deepLinkedLegalEntityId)
      ) {
        next = {
          ...next,
          legalEntityId: String(deepLinkedLegalEntityId),
        };
      }
      if (
        deepLinkedCounterpartyId &&
        String(next?.counterpartyId || "") !== String(deepLinkedCounterpartyId)
      ) {
        next = {
          ...next,
          counterpartyId: String(deepLinkedCounterpartyId),
        };
      }
      return next;
    });
  }, [
    deepLinkedCounterpartyId,
    deepLinkedLegalEntityId,
    deepLinkedSettlementBatchId,
  ]);

  const applyLegalEntityId = toPositiveInt(applyForm.legalEntityId);
  const applyCariReadiness = getModuleRow("cariPosting", applyLegalEntityId);
  const applyCariNotReady = Boolean(applyCariReadiness && !applyCariReadiness.ready);
  const applyOuCurrentAccountReadiness = getModuleRow(
    "operatingUnitCurrentAccounts",
    applyLegalEntityId
  );
  const applyOuCurrentAccountSetupBlocked = Boolean(
    applyOuCurrentAccountReadiness?.applicable && !applyOuCurrentAccountReadiness.ready
  );
  const bankApplyLegalEntityId = toPositiveInt(bankApplyForm.legalEntityId);
  const bankApplyCariReadiness = getModuleRow(
    "cariPosting",
    bankApplyLegalEntityId
  );
  const bankApplyCariNotReady = Boolean(
    bankApplyCariReadiness && !bankApplyCariReadiness.ready
  );
  const bankApplyOuCurrentAccountReadiness = getModuleRow(
    "operatingUnitCurrentAccounts",
    bankApplyLegalEntityId
  );
  const bankApplyOuCurrentAccountSetupBlocked = Boolean(
    bankApplyOuCurrentAccountReadiness?.applicable &&
      !bankApplyOuCurrentAccountReadiness.ready
  );
  const applyFunctionalCurrencyCode = useMemo(
    () => resolveLegalEntityCurrencyCode(legalEntities, applyForm.legalEntityId),
    [applyForm.legalEntityId, legalEntities]
  );
  const applySettlementCurrencyCode = normalizeCurrencyCode(applyForm.currencyCode);
  const applyFxRateHint = useMemo(() => {
    if (!applySettlementCurrencyCode || !applyFunctionalCurrencyCode) {
      return l(
        "One-off override for this settlement only. It is not saved to FX Rate Management.",
        "Bu sadece bu mahsuplastirma icin tek seferlik bir gecersiz kilmadir. Kur Yonetimine kaydedilmez."
      );
    }
    if (applySettlementCurrencyCode === applyFunctionalCurrencyCode) {
      return l(
        `One-off override only. Same-currency settlement uses parity: 1 ${applySettlementCurrencyCode} = 1 ${applyFunctionalCurrencyCode}.`,
        `Sadece tek seferlik gecersiz kilma. Ayni para birimi mahsuplastirmasi esdegerlik kullanir: 1 ${applySettlementCurrencyCode} = 1 ${applyFunctionalCurrencyCode}.`
      );
    }
    return l(
      `One-off override only. Enter as 1 ${applySettlementCurrencyCode} = X ${applyFunctionalCurrencyCode}. Not saved to FX Rate Management.`,
      `Sadece tek seferlik gecersiz kilma. 1 ${applySettlementCurrencyCode} = X ${applyFunctionalCurrencyCode} olarak girin. Kur Yonetimine kaydedilmez.`
    );
  }, [applyFunctionalCurrencyCode, applySettlementCurrencyCode, l]);
  const applyOffsetAccountChoices = useMemo(
    () =>
      (Array.isArray(applyOffsetAccountOptions) ? applyOffsetAccountOptions : []).filter(
        (row) => String(row?.accountType || "").toUpperCase() === "ASSET"
      ),
    [applyOffsetAccountOptions]
  );

  const previewRows = useMemo(
    () =>
      buildAutoAllocatePreview(openItems, Number(applyForm.incomingAmountTxn || 0), {
        settlementCurrencyCode: applyForm.currencyCode,
        functionalCurrencyCode: applyFunctionalCurrencyCode,
        settlementDate: applyForm.settlementDate,
        providedSettlementFxRate: applyForm.fxRate,
        fxRates: previewFxRates,
      }),
    [
      applyForm.currencyCode,
      applyForm.fxRate,
      applyForm.incomingAmountTxn,
      applyForm.settlementDate,
      applyFunctionalCurrencyCode,
      openItems,
      previewFxRates,
    ]
  );
  const previewMissingFxRows = useMemo(
    () => previewRows.filter((row) => Boolean(row.fxMissing)),
    [previewRows]
  );
  const hasCrossCurrencyPreviewRows = useMemo(
    () =>
      previewRows.some(
        (row) =>
          normalizeCurrencyCode(row.documentCurrencyCode) &&
          normalizeCurrencyCode(row.settlementCurrencyCode) &&
          normalizeCurrencyCode(row.documentCurrencyCode) !==
            normalizeCurrencyCode(row.settlementCurrencyCode)
      ),
    [previewRows]
  );
  const autoAllocateMissingFxRows = useMemo(
    () =>
      previewRows.filter(
        (row) => Boolean(row.fxMissing) && Boolean(row.autoAllocateBlockedByFx)
      ),
    [previewRows]
  );
  const mixedDirectionRisk = useMemo(() => hasMixedDirections(openItems), [openItems]);
  const linkedRegisterOptions = useMemo(() => {
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    if (!legalEntityId) {
      return cashRegisterOptions;
    }
    return cashRegisterOptions.filter(
      (row) => toPositiveInt(row?.legal_entity_id) === legalEntityId
    );
  }, [applyForm.legalEntityId, cashRegisterOptions]);
  const selectedLinkedRegister = useMemo(() => {
    const registerId = toPositiveInt(linkedCashForm.registerId);
    if (!registerId) {
      return null;
    }
    return linkedRegisterOptions.find((row) => toPositiveInt(row?.id) === registerId) || null;
  }, [linkedCashForm.registerId, linkedRegisterOptions]);
  const linkedRegisterOpenSessions = useMemo(() => {
    const registerId = toPositiveInt(linkedCashForm.registerId);
    if (!registerId) {
      return [];
    }
    return openCashSessions.filter(
      (row) => toPositiveInt(row?.cash_register_id) === registerId
    );
  }, [linkedCashForm.registerId, openCashSessions]);
  const linkedRegisterSessionMode = toUpper(selectedLinkedRegister?.session_mode);
  const linkedCashSessionRequiredByRegister = Boolean(
    linkedCashForm.createLinkedCashTransaction &&
      toUpper(linkedCashForm.paymentChannel) === "CASH" &&
      linkedRegisterSessionMode === "REQUIRED"
  );
  const linkedCashSessionValueMissing = Boolean(
    linkedCashSessionRequiredByRegister && !toPositiveInt(linkedCashForm.cashSessionId)
  );
  const linkedCashSessionMissingOpenSession = Boolean(
    linkedCashSessionRequiredByRegister &&
      canReadCashSessions &&
      toPositiveInt(linkedCashForm.registerId) &&
      linkedRegisterOpenSessions.length === 0
  );
  const linkedCashSessionFieldInvalid =
    linkedCashSessionValueMissing || linkedCashSessionMissingOpenSession;
  const linkedCashSessionInputClass = `mt-1 w-full rounded-md border px-3 py-2 text-sm font-normal ${
    linkedCashSessionFieldInvalid ? "border-rose-300 bg-rose-50" : "border-slate-300"
  }`;
  const selectedApplyPreviewRows = useMemo(() => {
    if (applyForm.autoAllocate) {
      return previewRows.filter(
        (row) => Number(row?.expectedApplySettlementTxn || 0) > 0.000001
      );
    }
    return previewRows.filter((row) => {
      const draftAmount = Number(manualAllocationDraft[String(row?.openItemId)] || 0);
      return Number.isFinite(draftAmount) && draftAmount > 0.000001;
    });
  }, [applyForm.autoAllocate, manualAllocationDraft, previewRows]);
  const applyOwnerContextSummary = useMemo(
    () => deriveSingleOwnerContext(selectedApplyPreviewRows),
    [selectedApplyPreviewRows]
  );
  const predictedApplySettlementContext = useMemo(() => {
    const ownerContext = applyOwnerContextSummary.primary;
    const usesLinkedCashCollector =
      linkedCashForm.createLinkedCashTransaction &&
      toUpper(linkedCashForm.paymentChannel) === "CASH";
    const collectorContext = usesLinkedCashCollector
      ? {
          operatingUnitId: toPositiveInt(selectedLinkedRegister?.operating_unit_id),
          operatingUnitCode: String(selectedLinkedRegister?.operating_unit_code || "").trim(),
          operatingUnitName: String(selectedLinkedRegister?.operating_unit_name || "").trim(),
        }
      : ownerContext;

    return describeCariSettlementContext(
      {
        ownerOperatingUnitId: ownerContext.operatingUnitId,
        ownerOperatingUnitCode: ownerContext.operatingUnitCode,
        ownerOperatingUnitName: ownerContext.operatingUnitName,
        collectorOperatingUnitId: collectorContext.operatingUnitId,
        collectorOperatingUnitCode: collectorContext.operatingUnitCode,
        collectorOperatingUnitName: collectorContext.operatingUnitName,
      },
      { translate: l }
    );
  }, [applyOwnerContextSummary.primary, l, linkedCashForm.createLinkedCashTransaction, linkedCashForm.paymentChannel, selectedLinkedRegister]);
  const predictedApplySelfBalancingWarning = useMemo(() => {
    if (applyOwnerContextSummary.hasMixed || !selectedApplyPreviewRows.length) {
      return "";
    }
    if (!predictedApplySettlementContext.isCrossContext) {
      return "";
    }
    return l(
      `This settlement will self-balance across contexts. Collector ${predictedApplySettlementContext.collectorContextLabel} will clear owner ${predictedApplySettlementContext.ownerContextLabel}.`,
      `Bu mahsuplastirma baglamlar arasinda self-balancing yapacak. Collector ${predictedApplySettlementContext.collectorContextLabel}, owner ${predictedApplySettlementContext.ownerContextLabel} bakiyesini kapatacak.`
    );
  }, [
    applyOwnerContextSummary.hasMixed,
    l,
    predictedApplySettlementContext.collectorContextLabel,
    predictedApplySettlementContext.isCrossContext,
    predictedApplySettlementContext.ownerContextLabel,
    selectedApplyPreviewRows.length,
  ]);
  const applyErrorHint = useMemo(
    () => getCariSettlementErrorHint(applyError, { translate: l }),
    [applyError, l]
  );
  const reverseErrorHint = useMemo(
    () => getCariSettlementErrorHint(reverseError, { translate: l }),
    [reverseError, l]
  );
  const bankApplyErrorHint = useMemo(
    () => getCariSettlementErrorHint(bankApplyError, { translate: l }),
    [bankApplyError, l]
  );
  const linkedCashAccountLookupOptions = useMemo(() => {
    const selectedAccountId = String(linkedCashForm.counterAccountId || "").trim();
    const rows = Array.isArray(linkedCashAccountOptions) ? [...linkedCashAccountOptions] : [];
    if (selectedAccountId && !rows.some((row) => String(row?.id || "") === selectedAccountId)) {
      const selectedCounterpartyId = toPositiveInt(applyForm.counterpartyId);
      const selectedCounterpartyRow =
        selectedCounterpartyId
          ? (counterpartyOptions || []).find(
              (row) => toPositiveInt(row?.id) === selectedCounterpartyId
            ) || null
          : null;
      const mappedAccountMeta = resolveCounterpartySettlementAccountMeta(
        selectedCounterpartyRow,
        applyForm.direction
      );
      const selectedAccountNumericId = toPositiveInt(selectedAccountId);
      const isCounterpartyMappedAccount =
        Boolean(selectedAccountNumericId) &&
        Boolean(mappedAccountMeta.accountId) &&
        selectedAccountNumericId === mappedAccountMeta.accountId;
      const fallbackCode = String(mappedAccountMeta.accountCode || "").trim();
      const fallbackName = String(mappedAccountMeta.accountName || "").trim();
      rows.unshift({
        id: selectedAccountId,
        code: fallbackCode || `ID ${selectedAccountId}`,
        name:
          fallbackName ||
          (isCounterpartyMappedAccount
            ? l(
                `Counterparty ${mappedAccountMeta.accountRoleLabel} account (ID ${selectedAccountId})`,
                `Cari ${mappedAccountMeta.accountRoleLabel} hesabi (ID ${selectedAccountId})`
              )
            : l(
                `Selected account ID ${selectedAccountId}`,
                `Secili hesap ID ${selectedAccountId}`
              )),
        account_breadcrumb: isCounterpartyMappedAccount
          ? l(
              `Auto-selected from counterparty ${mappedAccountMeta.accountRoleLabel} mapping`,
              `Cari ${mappedAccountMeta.accountRoleLabel} eslemesinden otomatik secildi`
            )
          : l(
              "Account details unavailable in current lookup results",
              "Hesap detaylari mevcut arama sonucunda kullanilamiyor"
            ),
      });
    }
    return rows.map(mapGlAccountLookupOption).filter((row) => row.value);
  }, [
    applyForm.counterpartyId,
    applyForm.direction,
    counterpartyOptions,
    l,
    linkedCashAccountOptions,
    linkedCashForm.counterAccountId,
  ]);
  const counterpartyLookupOptions = useMemo(
    () => (counterpartyOptions || []).map(mapCounterpartyLookupOption).filter((row) => row.value),
    [counterpartyOptions]
  );
  const selectedApplyCounterparty = useMemo(() => {
    const counterpartyId = toPositiveInt(applyForm.counterpartyId);
    if (!counterpartyId) {
      return null;
    }
    return (
      (counterpartyOptions || []).find((row) => toPositiveInt(row?.id) === counterpartyId) || null
    );
  }, [applyForm.counterpartyId, counterpartyOptions]);
  const selectedApplyCounterpartyAccountId = useMemo(
    () => resolveCounterpartySettlementAccountId(selectedApplyCounterparty, applyForm.direction),
    [selectedApplyCounterparty, applyForm.direction]
  );
  const linkedCashCounterAccountInLookup = useMemo(() => {
    const counterAccountId = toPositiveInt(linkedCashForm.counterAccountId);
    if (!counterAccountId) {
      return true;
    }
    return (linkedCashAccountOptions || []).some(
      (row) => toPositiveInt(row?.id) === counterAccountId
    );
  }, [linkedCashAccountOptions, linkedCashForm.counterAccountId]);
  const linkedCashCounterAccountResolutionHint = useMemo(() => {
    const counterAccountId = toPositiveInt(linkedCashForm.counterAccountId);
    if (!counterAccountId || linkedCashCounterAccountInLookup) {
      return "";
    }
    const mappedMeta = resolveCounterpartySettlementAccountMeta(
      selectedApplyCounterparty,
      applyForm.direction
    );
    const mappedCode = String(mappedMeta.accountCode || "").trim();
    const mappedName = String(mappedMeta.accountName || "").trim();
    if (mappedMeta.accountId && mappedMeta.accountId === counterAccountId) {
      const mappedLabel = [mappedCode, mappedName].filter(Boolean).join(" - ");
      if (mappedLabel) {
        return l(
          `Using counterparty ${mappedMeta.accountRoleLabel} mapped account (${mappedLabel}).`,
          `Cari ${mappedMeta.accountRoleLabel} eslenmis hesabi kullaniliyor (${mappedLabel}).`
        );
      }
      return l(
        `Using counterparty ${mappedMeta.accountRoleLabel} mapped account ID ${counterAccountId}.`,
        `Cari ${mappedMeta.accountRoleLabel} eslenmis hesap ID ${counterAccountId} kullaniliyor.`
      );
    }
    return l(
      `Using selected account ID ${counterAccountId}. Details are not in current lookup results.`,
      `Secili hesap ID ${counterAccountId} kullaniliyor. Detaylar mevcut arama sonucunda yok.`
    );
  }, [
    applyForm.direction,
    l,
    linkedCashCounterAccountInLookup,
    linkedCashForm.counterAccountId,
    selectedApplyCounterparty,
  ]);
  const linkedCashCounterpartyAccountWarning = useMemo(() => {
    if (
      !linkedCashForm.createLinkedCashTransaction ||
      toUpper(linkedCashForm.paymentChannel) !== "CASH"
    ) {
      return "";
    }
    if (!toPositiveInt(applyForm.counterpartyId) || !selectedApplyCounterparty) {
      return "";
    }
    if (selectedApplyCounterpartyAccountId) {
      return "";
    }
    const normalizedDirection = toUpper(applyForm.direction);
    if (normalizedDirection === "AP") {
      return l(
        "Selected vendor has no AP account configured. Set AP account on counterparty card or choose counterAccount manually.",
        "Secili tedarikci icin AP hesabi tanimli degil. Cari kartinda AP hesabi tanimlayin veya counterAccount'i manuel secin."
      );
    }
    if (normalizedDirection === "AR") {
      return l(
        "Selected customer has no AR account configured. Set AR account on counterparty card or choose counterAccount manually.",
        "Secili musteri icin AR hesabi tanimli degil. Cari kartinda AR hesabi tanimlayin veya counterAccount'i manuel secin."
      );
    }
    return l(
      "Selected counterparty has no default AR/AP account configured for current direction.",
      "Secili cari icin mevcut yone ait varsayilan AR/AP hesabi tanimli degil."
    );
  }, [
    linkedCashForm.createLinkedCashTransaction,
    linkedCashForm.paymentChannel,
    applyForm.counterpartyId,
    applyForm.direction,
    l,
    selectedApplyCounterparty,
    selectedApplyCounterpartyAccountId,
  ]);
  const bankApplyCounterpartyLookupOptions = useMemo(
    () =>
      (bankApplyCounterpartyOptions || [])
        .map(mapCounterpartyLookupOption)
        .filter((row) => row.value),
    [bankApplyCounterpartyOptions]
  );
  const reverseSettlementLookupOptions = useMemo(() => {
    const query = normalizeSearch(reverseSettlementLookupQuery);
    const rows = Array.isArray(reverseSettlementRows) ? reverseSettlementRows : [];
    const filteredRows = rows.filter((row) => {
      const alreadyReversal = Boolean(toPositiveInt(row?.reversalOfSettlementBatchId));
      const alreadyReversedBy = Boolean(toPositiveInt(row?.reversedBySettlementBatchId));
      if (alreadyReversal || alreadyReversedBy) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        row?.settlementNo,
        row?.settlementBatchId,
        row?.counterpartyCodeCurrent,
        row?.counterpartyNameCurrent,
        row?.settlementDate,
        row?.statusCurrent,
      ]
        .map((part) => normalizeSearch(part))
        .join(" ");
      return haystack.includes(query);
    });

    return filteredRows.map((row) => {
      const settlementLabel = String(row?.settlementNo || `#${row?.settlementBatchId || "-"}`);
      const counterpartyLabel = String(
        row?.counterpartyCodeCurrent ||
          row?.counterpartyNameCurrent ||
          row?.counterpartyId ||
          "-"
      ).trim();
      const settlementDate = String(row?.settlementDate || "-").trim();
      const totalAllocated = formatMoneyText(row?.totalAllocatedTxn, row?.currencyCode);
      const settlementContext = describeCariSettlementContext(row, { translate: l });
      return {
        value: String(row?.settlementBatchId || ""),
        label: `${settlementLabel} | ${settlementDate} | ${counterpartyLabel}`,
        description: `ID:${row?.settlementBatchId || "-"} | ${row?.statusCurrent || "-"} | ${totalAllocated} | ${settlementContext.isCrossContext ? l("cross-context", "baglamlar arasi") : l("same-context", "ayni baglam")} | ${settlementContext.collectorContextLabel} -> ${settlementContext.ownerContextLabel}`,
      };
    });
  }, [l, reverseSettlementLookupQuery, reverseSettlementRows]);
  const selectedReverseSettlement = useMemo(() => {
    const settlementBatchId = toPositiveInt(reverseForm.settlementBatchId);
    if (!settlementBatchId) {
      return null;
    }
    return (
      (reverseSettlementRows || []).find(
      (row) => toPositiveInt(row?.settlementBatchId) === settlementBatchId
      ) || null
    );
  }, [reverseForm.settlementBatchId, reverseSettlementRows]);
  const selectedReverseSettlementContext = useMemo(
    () => describeCariSettlementContext(selectedReverseSettlement, { translate: l }),
    [l, selectedReverseSettlement]
  );
  const applyResultContext = useMemo(
    () => describeCariSettlementContext(applyResult?.row, { translate: l }),
    [applyResult?.row, l]
  );
  const reverseResultContext = useMemo(
    () => describeCariSettlementContext(reverseResult?.row, { translate: l }),
    [reverseResult?.row, l]
  );
  const reverseOriginalContext = useMemo(
    () => describeCariSettlementContext(reverseResult?.original, { translate: l }),
    [l, reverseResult?.original]
  );
  const bankApplyResultContext = useMemo(
    () => describeCariSettlementContext(bankApplyResult?.row, { translate: l }),
    [bankApplyResult?.row, l]
  );
  const applyInlineCounterpartyName = normalizeLookupQuery(applyCounterpartyLookupQuery);
  const bankApplyInlineCounterpartyName = normalizeLookupQuery(
    bankApplyCounterpartyLookupQuery
  );
  const canInlineCreateCounterpartyInApplyForm = Boolean(
    canApply &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(applyForm.legalEntityId) &&
      applyInlineCounterpartyName
  );
  const canInlineCreateCounterpartyInBankApplyForm = Boolean(
    canBankApply &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(bankApplyForm.legalEntityId) &&
      bankApplyInlineCounterpartyName
  );

  const applyIntentScope = useMemo(
    () => buildSettlementIntentScope(applyForm),
    [applyForm]
  );
  const applyIntentFingerprint = useMemo(
    () => buildSettlementIntentFingerprint(applyForm),
    [applyForm]
  );
  const previewLegalEntityId = previewFilters.legalEntityId;
  const previewCounterpartyId = previewFilters.counterpartyId;
  const previewAsOfDate = previewFilters.asOfDate;
  const previewDirection = fixedRouteDirection || previewFilters.direction;
  const previewDocumentCurrencies = useMemo(() => {
    const currencies = new Set();
    for (const row of openItems || []) {
      const currencyCode = resolveOpenItemCurrencyCode(row);
      if (currencyCode) {
        currencies.add(currencyCode);
      }
    }
    return Array.from(currencies).sort();
  }, [openItems]);
  const previewFxCurrencyKey = useMemo(() => {
    const currencies = new Set(previewDocumentCurrencies);
    const settlementCurrencyCode = normalizeCurrencyCode(applyForm.currencyCode);
    if (settlementCurrencyCode) {
      currencies.add(settlementCurrencyCode);
    }
    if (applyFunctionalCurrencyCode) {
      currencies.add(applyFunctionalCurrencyCode);
    }
    return Array.from(currencies).sort().join("|");
  }, [applyForm.currencyCode, applyFunctionalCurrencyCode, previewDocumentCurrencies]);

  useEffect(() => {
    const pendingKey = loadPendingIdempotencyKey(applyIntentScope, applyIntentFingerprint);
    setApplyForm((prev) =>
      prev.idempotencyKey === pendingKey ? prev : { ...prev, idempotencyKey: pendingKey }
    );
  }, [applyIntentScope, applyIntentFingerprint]);

  useEffect(() => {
    if (!canReadReports) {
      setOpenItems([]);
      setPreviewError("");
      return;
    }

    if (!previewLegalEntityId || !previewCounterpartyId || !previewAsOfDate) {
      setOpenItems([]);
      setPreviewError("");
      return;
    }

    let active = true;
    async function loadPreviewOpenItems() {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const payload = await getCariOpenItemsReport({
          legalEntityId: previewLegalEntityId,
          counterpartyId: previewCounterpartyId,
          asOfDate: previewAsOfDate,
          direction: previewDirection || undefined,
          status: "OPEN",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        setOpenItems(rows);
      } catch (error) {
        if (!active) {
          return;
        }
        setOpenItems([]);
        setPreviewError(
          normalizeUiError(error, l("Failed to load open-items preview.", "Acik kalem onizlemesi yuklenemedi."))
        );
      } finally {
        if (active) {
          setPreviewLoading(false);
        }
      }
    }

    loadPreviewOpenItems();
    return () => {
      active = false;
    };
  }, [
    canReadReports,
    l,
    previewLegalEntityId,
    previewCounterpartyId,
    previewAsOfDate,
    previewDirection,
    previewRefreshToken,
  ]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    if (!canReadFxRates || !canReadReports || !legalEntityId || !applyForm.settlementDate) {
      setPreviewFxRates([]);
      setPreviewFxError("");
      setPreviewFxLoading(false);
      return;
    }

    const scopedCurrencies = previewFxCurrencyKey
      ? previewFxCurrencyKey.split("|").filter(Boolean)
      : [];
    if (scopedCurrencies.length <= 1) {
      setPreviewFxRates([]);
      setPreviewFxError("");
      setPreviewFxLoading(false);
      return;
    }

    let active = true;
    async function loadPreviewFxRates() {
      setPreviewFxLoading(true);
      setPreviewFxError("");
      try {
        const payload = await listFxRates({
          dateFrom: applyForm.settlementDate,
          dateTo: applyForm.settlementDate,
          rateType: "SPOT",
        });
        if (!active) {
          return;
        }
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const allowSet = new Set(scopedCurrencies);
        setPreviewFxRates(
          rows.filter((row) => {
            const fromCurrencyCode = normalizeCurrencyCode(
              row?.from_currency_code || row?.fromCurrencyCode
            );
            const toCurrencyCode = normalizeCurrencyCode(
              row?.to_currency_code || row?.toCurrencyCode
            );
            return (
              fromCurrencyCode &&
              toCurrencyCode &&
              allowSet.has(fromCurrencyCode) &&
              allowSet.has(toCurrencyCode)
            );
          })
        );
      } catch (error) {
        if (!active) {
          return;
        }
        setPreviewFxRates([]);
        setPreviewFxError(
          normalizeUiError(
            error,
            l(
              "Failed to load FX rates for settlement preview.",
              "Mahsuplastirma onizlemesi icin kur oranlari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setPreviewFxLoading(false);
        }
      }
    }

    loadPreviewFxRates();
    return () => {
      active = false;
    };
  }, [
    applyForm.legalEntityId,
    applyForm.settlementDate,
    canReadFxRates,
    canReadReports,
    l,
    previewFxCurrencyKey,
  ]);

  useEffect(() => {
    let active = true;
    async function loadLookups() {
      const warnings = [];
      if (!canReadCashRegisters) {
        warnings.push(
          l(
            "Cash register/session lookup unavailable (missing permission: cash.register.read).",
            "Kasa/kasa oturumu aramasi kullanilamiyor (eksik yetki: cash.register.read)."
          )
        );
      }
      const [legalEntitiesResult, registersResult, sessionsResult] =
        await Promise.allSettled([
          canReadOrg ? listLegalEntities({ limit: 500, includeInactive: true }) : Promise.resolve({ rows: [] }),
          canReadCashRegisters ? listCashRegisters({ limit: 300, offset: 0 }) : Promise.resolve({ rows: [] }),
          canReadCashSessions ? listCashSessions({ status: "OPEN", limit: 300, offset: 0 }) : Promise.resolve({ rows: [] }),
        ]);

      if (!active) {
        return;
      }

      if (legalEntitiesResult.status === "fulfilled") {
        setLegalEntities(Array.isArray(legalEntitiesResult.value?.rows) ? legalEntitiesResult.value.rows : []);
      } else {
        setLegalEntities([]);
        warnings.push(l("Legal entity lookup unavailable.", "Tuzel kisilik aramasi kullanilamiyor."));
      }

      if (registersResult.status === "fulfilled") {
        setCashRegisterOptions(Array.isArray(registersResult.value?.rows) ? registersResult.value.rows : []);
      } else {
        setCashRegisterOptions([]);
        warnings.push(l("Cash register lookup unavailable.", "Kasa aramasi kullanilamiyor."));
      }

      if (sessionsResult.status === "fulfilled") {
        setOpenCashSessions(Array.isArray(sessionsResult.value?.rows) ? sessionsResult.value.rows : []);
      } else {
        setOpenCashSessions([]);
        warnings.push(l("Cash session lookup unavailable.", "Kasa oturumu aramasi kullanilamiyor."));
      }

      setLookupWarning(warnings.join(" "));
    }

    loadLookups();
    return () => {
      active = false;
    };
  }, [canReadCashRegisters, canReadCashSessions, canReadOrg, l]);

  useEffect(() => {
    if (!Array.isArray(legalEntities) || legalEntities.length === 0) {
      return;
    }
    if (hasSelectableLegalEntity(legalEntities, previewFilters.legalEntityId)) {
      return;
    }
    setPreviewFilters((prev) => {
      if (hasSelectableLegalEntity(legalEntities, prev.legalEntityId)) {
        return prev;
      }
      return {
        ...prev,
        legalEntityId: "",
        counterpartyId: "",
      };
    });
  }, [legalEntities, previewFilters.legalEntityId, setPreviewFilters]);

  useEffect(() => {
    if (applyCurrencyManuallyEdited) {
      return;
    }
    const derivedCurrencyCode = resolveLegalEntityCurrencyCode(
      legalEntities,
      applyForm.legalEntityId
    );
    if (!derivedCurrencyCode || toUpper(applyForm.currencyCode) === derivedCurrencyCode) {
      return;
    }
    setApplyForm((prev) => {
      if (toUpper(prev.currencyCode) === derivedCurrencyCode) {
        return prev;
      }
      return {
        ...prev,
        currencyCode: derivedCurrencyCode,
      };
    });
  }, [
    applyCurrencyManuallyEdited,
    applyForm.currencyCode,
    applyForm.legalEntityId,
    legalEntities,
  ]);

  useEffect(() => {
    if (bankApplyCurrencyManuallyEdited) {
      return;
    }
    const derivedCurrencyCode = resolveLegalEntityCurrencyCode(
      legalEntities,
      bankApplyForm.legalEntityId
    );
    if (
      !derivedCurrencyCode ||
      toUpper(bankApplyForm.currencyCode) === derivedCurrencyCode
    ) {
      return;
    }
    setBankApplyForm((prev) => {
      if (toUpper(prev.currencyCode) === derivedCurrencyCode) {
        return prev;
      }
      return {
        ...prev,
        currencyCode: derivedCurrencyCode,
      };
    });
  }, [
    bankApplyCurrencyManuallyEdited,
    bankApplyForm.currencyCode,
    bankApplyForm.legalEntityId,
    legalEntities,
  ]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);

    setApplyOffsetAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setApplyOffsetAccountOptions([]);
      setApplyOffsetAccountsLoading(false);
      return;
    }

    let active = true;
    async function loadApplyOffsetAccounts() {
      setApplyOffsetAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const options = (Array.isArray(response?.rows) ? response.rows : [])
          .filter((row) => {
            const isActive = row?.is_active === true || Number(row?.is_active) === 1;
            const allowPosting =
              row?.allow_posting === true || Number(row?.allow_posting) === 1;
            return isActive && allowPosting;
          })
          .map((row) => ({
            id: Number(row?.id || 0),
            code: String(row?.code || "").trim(),
            name: String(row?.name || "").trim(),
            accountType: String(row?.account_type || "").trim().toUpperCase(),
          }))
          .filter((row) => row.id > 0 && row.code);
        setApplyOffsetAccountOptions(options);
      } catch (error) {
        if (!active) {
          return;
        }
        setApplyOffsetAccountOptions([]);
        setApplyOffsetAccountsError(
          normalizeUiError(
            error,
            l(
              "Failed to load settlement source account options.",
              "Mahsuplastirma kaynak hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setApplyOffsetAccountsLoading(false);
        }
      }
    }

    void loadApplyOffsetAccounts();
    return () => {
      active = false;
    };
  }, [applyForm.legalEntityId, canReadGlAccounts, l]);

  useEffect(() => {
    const availableOptionIds = new Set(
      applyOffsetAccountChoices
        .map((row) => Number(row?.id || 0))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setApplyForm((prev) => {
      const currentOffsetAccountId = String(prev.offsetAccountId || "").trim();
      if (!currentOffsetAccountId) {
        return prev;
      }
      if (availableOptionIds.has(Number(currentOffsetAccountId))) {
        return prev;
      }
      return {
        ...prev,
        offsetAccountId: "",
      };
    });
  }, [applyOffsetAccountChoices]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    if (legalEntityId) {
      return;
    }
    setLinkedCashAccountQuery("");
  }, [applyForm.legalEntityId]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    const requiresLinkedCashLookup =
      Boolean(canReadGlAccounts) &&
      Boolean(linkedCashForm.createLinkedCashTransaction) &&
      toUpper(linkedCashForm.paymentChannel) === "CASH" &&
      Boolean(legalEntityId);

    if (!requiresLinkedCashLookup) {
      setLinkedCashAccountOptions([]);
      setLinkedCashAccountLoading(false);
      setLinkedCashAccountError("");
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        setLinkedCashAccountLoading(true);
        setLinkedCashAccountError("");
        try {
          const normalizedQuery = normalizeLookupQuery(linkedCashAccountQuery);
          const response = await listAccounts({
            legalEntityId,
            q: normalizedQuery || undefined,
            limit: 80,
          });
          if (!active) {
            return;
          }
          const rows = Array.isArray(response?.rows) ? response.rows : [];
          setLinkedCashAccountOptions(
            rows.filter((row) => isActivePostingAccount(row, legalEntityId))
          );
        } catch (error) {
          if (!active) {
            return;
          }
          setLinkedCashAccountOptions([]);
          setLinkedCashAccountError(
            normalizeUiError(
              error,
              l(
                "Failed to load linked-cash counterAccount options.",
                "Bagli nakit karsi hesap secenekleri yuklenemedi."
              )
            )
          );
        } finally {
          if (active) {
            setLinkedCashAccountLoading(false);
          }
        }
      })();
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    canReadGlAccounts,
    applyForm.legalEntityId,
    linkedCashForm.createLinkedCashTransaction,
    linkedCashForm.paymentChannel,
    linkedCashAccountQuery,
    l,
  ]);

  useEffect(() => {
    if (!canReadCards) {
      setCounterpartyOptions([]);
      setCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    if (!legalEntityId) {
      setCounterpartyOptions([]);
      setCounterpartyLoading(false);
      return;
    }

    const role = resolveCounterpartyRoleFromDirection(applyForm.direction);

    let active = true;
    async function loadCounterpartyRows() {
      setCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) {
          return;
        }
        setCounterpartyOptions([]);
      } finally {
        if (active) {
          setCounterpartyLoading(false);
        }
      }
    }

    loadCounterpartyRows();
    return () => {
      active = false;
    };
  }, [applyForm.direction, applyForm.legalEntityId, canReadCards]);

  useEffect(() => {
    if (!canReadCards) {
      setBankApplyCounterpartyOptions([]);
      setBankApplyCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(bankApplyForm.legalEntityId);
    if (!legalEntityId) {
      setBankApplyCounterpartyOptions([]);
      setBankApplyCounterpartyLoading(false);
      return;
    }

    const role = resolveCounterpartyRoleFromDirection(bankApplyForm.direction);
    let active = true;
    async function loadBankApplyCounterpartyRows() {
      setBankApplyCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setBankApplyCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) {
          return;
        }
        setBankApplyCounterpartyOptions([]);
      } finally {
        if (active) {
          setBankApplyCounterpartyLoading(false);
        }
      }
    }

    loadBankApplyCounterpartyRows();
    return () => {
      active = false;
    };
  }, [bankApplyForm.direction, bankApplyForm.legalEntityId, canReadCards]);

  useEffect(() => {
    if (!canReadReports) {
      setReverseSettlementRows([]);
      setReverseSettlementLoading(false);
      setReverseSettlementLookupError("");
      return;
    }

    const legalEntityId = toPositiveInt(reverseLookupFilters.legalEntityId);
    if (!legalEntityId) {
      setReverseSettlementRows([]);
      setReverseSettlementLoading(false);
      setReverseSettlementLookupError("");
      return;
    }

    let active = true;
    async function loadReverseSettlementRows() {
      setReverseSettlementLoading(true);
      setReverseSettlementLookupError("");
      try {
        const response = await getCariCounterpartyStatementReport({
          asOfDate:
            String(reverseLookupFilters.asOfDate || "").trim() || todayIsoDate(),
          legalEntityId,
          counterpartyId:
            toPositiveInt(reverseLookupFilters.counterpartyId) || undefined,
          status: "ALL",
          includeDetails: true,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const rows = Array.isArray(response?.settlements?.rows)
          ? response.settlements.rows
          : [];
        rows.sort((left, right) => {
          const leftDate = String(left?.settlementDate || "");
          const rightDate = String(right?.settlementDate || "");
          if (leftDate !== rightDate) {
            return rightDate.localeCompare(leftDate);
          }
          return (
            Number(right?.settlementBatchId || 0) -
            Number(left?.settlementBatchId || 0)
          );
        });
        setReverseSettlementRows(rows);
      } catch (error) {
        if (!active) {
          return;
        }
        setReverseSettlementRows([]);
        setReverseSettlementLookupError(
          normalizeUiError(
            error,
            l("Failed to load settlement lookup rows.", "Mahsuplastirma arama satirlari yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setReverseSettlementLoading(false);
        }
      }
    }

    loadReverseSettlementRows();
    return () => {
      active = false;
    };
  }, [
    canReadReports,
    reverseLookupFilters.asOfDate,
    reverseLookupFilters.counterpartyId,
    reverseLookupFilters.legalEntityId,
    l,
  ]);

  useEffect(() => {
    if (!linkedCashForm.createLinkedCashTransaction) {
      return;
    }
    if (toPositiveInt(linkedCashForm.registerId)) {
      return;
    }
    if (!linkedRegisterOptions.length) {
      return;
    }
    const preferred = linkedRegisterOptions.find((row) => toUpper(row?.status) === "ACTIVE");
    setLinkedCashForm((prev) => ({
      ...prev,
      registerId: String(preferred?.id || linkedRegisterOptions[0]?.id || ""),
    }));
  }, [
    linkedCashForm.createLinkedCashTransaction,
    linkedCashForm.registerId,
    linkedRegisterOptions,
  ]);

  useEffect(() => {
    if (
      !linkedCashForm.createLinkedCashTransaction ||
      toUpper(linkedCashForm.paymentChannel) !== "CASH"
    ) {
      return;
    }
    if (!selectedApplyCounterpartyAccountId) {
      return;
    }
    setLinkedCashForm((prev) => {
      const currentAccountId = toPositiveInt(prev.counterAccountId);
      if (currentAccountId === selectedApplyCounterpartyAccountId) {
        return prev;
      }
      return {
        ...prev,
        counterAccountId: String(selectedApplyCounterpartyAccountId),
      };
    });
  }, [
    linkedCashForm.createLinkedCashTransaction,
    linkedCashForm.paymentChannel,
    selectedApplyCounterpartyAccountId,
  ]);

  useEffect(() => {
    const registerId = toPositiveInt(linkedCashForm.registerId);
    if (!registerId) {
      return;
    }
    const exists = linkedRegisterOptions.some(
      (row) => toPositiveInt(row?.id) === registerId
    );
    if (exists) {
      return;
    }
    setLinkedCashForm((prev) => ({
      ...prev,
      registerId: "",
      cashSessionId: "",
    }));
  }, [linkedCashForm.registerId, linkedRegisterOptions]);

  function updateApplyForm(field, value) {
    if (field === "currencyCode") {
      setApplyCurrencyManuallyEdited(true);
    }
    if (field === "legalEntityId") {
      const derivedCurrencyCode = resolveLegalEntityCurrencyCode(legalEntities, value);
      setApplyCurrencyManuallyEdited(false);
      setApplyForm((prev) => ({
        ...prev,
        [field]: value,
        offsetAccountId: "",
        ...(derivedCurrencyCode ? { currencyCode: derivedCurrencyCode } : {}),
      }));
    } else {
      setApplyForm((prev) => ({ ...prev, [field]: value }));
    }
    if (field === "legalEntityId" || field === "counterpartyId" || field === "direction") {
      setPreviewFilters((prev) => ({ ...prev, [field]: value }));
    }
    if (field === "settlementDate") {
      setLinkedCashForm((prev) => ({
        ...prev,
        bookDate: String(value || "").trim() || prev.bookDate,
      }));
    }
  }

  function updateBankApplyForm(field, value) {
    if (field === "currencyCode") {
      setBankApplyCurrencyManuallyEdited(true);
    }
    if (field === "legalEntityId") {
      const derivedCurrencyCode = resolveLegalEntityCurrencyCode(legalEntities, value);
      setBankApplyCurrencyManuallyEdited(false);
      setBankApplyForm((prev) => ({
        ...prev,
        [field]: value,
        ...(derivedCurrencyCode ? { currencyCode: derivedCurrencyCode } : {}),
      }));
      return;
    }
    setBankApplyForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateLinkedCashFormBeforeApply(formSnapshot) {
    if (
      !linkedCashForm.createLinkedCashTransaction ||
      toUpper(linkedCashForm.paymentChannel) !== "CASH"
    ) {
      return "";
    }
    if (!canCreateCashTxn) {
      return "Missing permission: cash.txn.create";
    }
    if (!canReadCashSessions) {
      return "Missing permission: cash.register.read (required to list OPEN cash sessions).";
    }
    if (!toPositiveInt(linkedCashForm.registerId)) {
      return "registerId is required for linked cash transaction.";
    }
    if (linkedCashSessionMissingOpenSession) {
      return LINKED_CASH_OPEN_SESSION_REQUIRED_ERROR;
    }
    if (linkedCashSessionValueMissing) {
      return LINKED_CASH_SESSION_REQUIRED_ERROR;
    }
    if (!toPositiveInt(linkedCashForm.counterAccountId)) {
      return "counterAccountId is required for linked cash transaction.";
    }
    const direction = toUpper(formSnapshot.direction);
    if (direction !== "AR" && direction !== "AP") {
      return "direction must be AR or AP when linked cash creation is enabled.";
    }
    if (!toPositiveInt(formSnapshot.counterpartyId)) {
      return "counterpartyId is required when linked cash creation is enabled.";
    }
    if (!toPositiveDecimal(formSnapshot.incomingAmountTxn)) {
      return "incomingAmountTxn must be > 0 when linked cash creation is enabled.";
    }
    return "";
  }

  function buildLinkedCashPayloadForApply(formSnapshot, settlementIdempotencyKey) {
    const wantsCashLink =
      linkedCashForm.createLinkedCashTransaction &&
      toUpper(linkedCashForm.paymentChannel) === "CASH";
    if (!wantsCashLink) {
      return {
        paymentChannel: "MANUAL",
        linkedCashTransaction: undefined,
      };
    }

    const registerId = toPositiveInt(linkedCashForm.registerId);
    const counterAccountId = toPositiveInt(linkedCashForm.counterAccountId);
    const deterministicCashKey = `CARI-CASH-${settlementIdempotencyKey}`.slice(0, 100);
    const deterministicCashEvent = `CARI-CASH-EVT-${settlementIdempotencyKey}`.slice(0, 100);

    return {
      paymentChannel: "CASH",
      linkedCashTransaction: {
        registerId,
        cashSessionId: toPositiveInt(linkedCashForm.cashSessionId) || undefined,
        counterAccountId,
        txnDatetime: String(linkedCashForm.txnDatetime || "").trim() || toDateTimeLocalInput(),
        bookDate:
          String(linkedCashForm.bookDate || "").trim() ||
          String(formSnapshot.settlementDate || "").trim() ||
          todayIsoDate(),
        referenceNo: String(linkedCashForm.referenceNo || "").trim() || undefined,
        description: String(linkedCashForm.description || "").trim() || undefined,
        idempotencyKey: deterministicCashKey,
        integrationEventUid: deterministicCashEvent,
      },
    };
  }

  async function handleInlineCreateCounterpartyForApplyForm() {
    setApplyInlineCounterpartyError("");
    setApplyInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(applyForm.legalEntityId);
    const name = normalizeLookupQuery(applyCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setApplyInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setApplyInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setApplyInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }

    setApplyInlineCounterpartySaving(true);
    try {
      const payload = {
        legalEntityId,
        code: buildInlineCounterpartyCode({ legalEntityId, name }),
        name,
        status: "ACTIVE",
        ...resolveInlineCounterpartyRoleFlags(applyForm.direction),
      };
      const response = await createCariCounterparty(payload);
      const row = response?.row || null;
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        throw new Error(
          l("Counterparty create response is missing row.id.", "Cari olusturma yanitinda row.id yok.")
        );
      }
      setCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      updateApplyForm("counterpartyId", String(counterpartyId));
      setApplyCounterpartyLookupQuery("");
      setApplyInlineCounterpartyMessage(
        l(
          `Counterparty created and selected. counterpartyId=${counterpartyId}`,
          `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
        )
      );
    } catch (error) {
      setApplyInlineCounterpartyError(
        normalizeUiError(error, l("Failed to create counterparty from lookup.", "Aramadan cari olusturulamadi."))
      );
    } finally {
      setApplyInlineCounterpartySaving(false);
    }
  }

  async function handleInlineCreateCounterpartyForBankApplyForm() {
    setBankApplyInlineCounterpartyError("");
    setBankApplyInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(bankApplyForm.legalEntityId);
    const name = normalizeLookupQuery(bankApplyCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setBankApplyInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setBankApplyInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setBankApplyInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }

    setBankApplyInlineCounterpartySaving(true);
    try {
      const payload = {
        legalEntityId,
        code: buildInlineCounterpartyCode({ legalEntityId, name }),
        name,
        status: "ACTIVE",
        ...resolveInlineCounterpartyRoleFlags(bankApplyForm.direction),
      };
      const response = await createCariCounterparty(payload);
      const row = response?.row || null;
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        throw new Error(
          l("Counterparty create response is missing row.id.", "Cari olusturma yanitinda row.id yok.")
        );
      }
      setBankApplyCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setBankApplyForm((prev) => ({
        ...prev,
        counterpartyId: String(counterpartyId),
      }));
      setBankApplyCounterpartyLookupQuery("");
      setBankApplyInlineCounterpartyMessage(
        l(
          `Counterparty created and selected. counterpartyId=${counterpartyId}`,
          `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
        )
      );
    } catch (error) {
      setBankApplyInlineCounterpartyError(
        normalizeUiError(error, l("Failed to create counterparty from lookup.", "Aramadan cari olusturulamadi."))
      );
    } finally {
      setBankApplyInlineCounterpartySaving(false);
    }
  }

  async function onApply(form = applyForm) {
    setApplyError("");
    setApplyMessage("");
    setApplyReplayMessage("");
    setApplyResult(null);
    setApplyFollowUpRisks([]);
    setLinkedCashError("");
    setLinkedCashMessage("");
    setLinkedCashResult(null);

    if (!canApply) {
      setApplyError(
        l("Missing permission: cari.settlement.apply", "Eksik yetki: cari.settlement.apply")
      );
      return;
    }
    if (applyCariNotReady) {
      setApplyError(
        l(
          "Setup incomplete for selected legal entity. Configure CARI purpose mappings in GL Setup first.",
          "Secili tuzel kisilik icin kurulum eksik. Once GL Ayarlari altinda CARI amac eslemelerini tamamlayin."
        )
      );
      return;
    }

    if (form.autoAllocate && !form.direction) {
      setApplyError(
        l("Direction is required for auto-allocation.", "Otomatik dagitim icin yon zorunludur.")
      );
      return;
    }
    if (form.autoAllocate && mixedDirectionRisk) {
      setApplyError(
        l(
          "Open-items preview contains mixed AR/AP rows. Select one direction and retry.",
          "Acik kalem onizlemesinde karisik AR/AP satirlari var. Tek bir yon secip tekrar deneyin."
        )
      );
      return;
    }
    if (form.autoAllocate && canReadFxRates && autoAllocateMissingFxRows.length > 0) {
      setApplyError(
        l(
          "Auto-allocation requires settlement/document FX rates for the preview rows. Add missing SPOT rates or enter manual allocations.",
          "Otomatik dagitim icin onizleme satirlarinda mahsuplastirma/belge kurlari gerekir. Eksik SPOT kurlarini ekleyin veya manuel dagitim girin."
        )
      );
      return;
    }

    const linkedCashValidationError = validateLinkedCashFormBeforeApply(form);
    if (linkedCashValidationError) {
      setApplyError(translateLinkedCashValidationError(linkedCashValidationError));
      if (
        linkedCashValidationError === LINKED_CASH_SESSION_REQUIRED_ERROR ||
        linkedCashValidationError === LINKED_CASH_OPEN_SESSION_REQUIRED_ERROR
      ) {
        linkedCashSessionInputRef.current?.focus();
        linkedCashSessionInputRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }
      return;
    }

    const intentScope = buildSettlementIntentScope(form);
    const intentFingerprint = buildSettlementIntentFingerprint(form);
    const idempotencyKey =
      form.idempotencyKey || createPendingIdempotencyKey(intentScope, intentFingerprint);
    setApplyForm((prev) => ({ ...prev, idempotencyKey }));

    const manualAllocations = parseManualAllocations(openItems, manualAllocationDraft);
    if (!form.autoAllocate && manualAllocations.length === 0) {
      setApplyError(
        l("allocations are required when autoAllocate=false.", "autoAllocate=false iken allocations zorunludur.")
      );
      return;
    }

    for (const allocation of manualAllocations) {
      const openItem = openItems.find(
        (row) => Number(row?.openItemId || 0) === Number(allocation.openItemId || 0)
      );
      const maxOpen = Number(openItem?.residualAmountTxnAsOf || 0);
      if (allocation.amountTxn > maxOpen + 0.000001) {
        setApplyError(
          l(
            `Allocation exceeds open amount for openItemId=${allocation.openItemId}.`,
            `Dagitim tutari openItemId=${allocation.openItemId} icin acik tutari asiyor.`
          )
        );
        return;
      }
    }

    setApplySubmitting(true);
    try {
      const derivedOwnerOperatingUnitId =
        !applyOwnerContextSummary.hasMixed && selectedApplyPreviewRows.length > 0
          ? applyOwnerContextSummary.primary.operatingUnitId || undefined
          : undefined;
      const payload = buildSettlementApplyPayload({
        ...form,
        operatingUnitId: derivedOwnerOperatingUnitId,
        idempotencyKey,
        allocations: form.autoAllocate ? [] : manualAllocations,
        ...buildLinkedCashPayloadForApply(form, idempotencyKey),
      });
      const response = await applyCariSettlement(payload);
      const replayState = extractCariReplayAndRisks(response);
      clearPendingIdempotencyKey(intentScope);

      setApplyResult(response);
      setApplyFollowUpRisks(replayState.followUpRisks);
      if (replayState.idempotentReplay) {
        setApplyReplayMessage(
          l(
            "This request was already applied; showing the existing result.",
            "Bu istek daha once uygulanmis; mevcut sonuc gosteriliyor."
          )
        );
      }
      setApplyMessage(
        l(
          `Settlement apply completed. settlementBatchId=${response?.row?.id || "-"}`,
          `Mahsuplastirma uygulamasi tamamlandi. settlementBatchId=${response?.row?.id || "-"}`
        )
      );
      setManualAllocationDraft({});
      setPreviewRefreshToken((prev) => prev + 1);
      const wantsCashLink =
        linkedCashForm.createLinkedCashTransaction &&
        toUpper(linkedCashForm.paymentChannel) === "CASH";
      if (wantsCashLink) {
        const linkedCashId =
          toPositiveInt(response?.cashTransaction?.id) ||
          toPositiveInt(response?.row?.cashTransactionId);
        if (!linkedCashId) {
          setLinkedCashError(
            l(
              "Settlement applied, but linked cash transaction details were not returned.",
              "Mahsuplastirma uygulandi ancak bagli nakit islem detayi donmedi."
            )
          );
        } else {
          setLinkedCashResult(response?.cashTransaction || { id: linkedCashId });
          setLinkedCashMessage(
            replayState.idempotentReplay
              ? l(
                  `Linked cash transaction already exists. cashTransactionId=${linkedCashId}`,
                  `Bagli nakit islemi zaten mevcut. cashTransactionId=${linkedCashId}`
                )
              : l(
                  `Linked cash transaction created. cashTransactionId=${linkedCashId}`,
                  `Bagli nakit islemi olusturuldu. cashTransactionId=${linkedCashId}`
                )
          );
        }
      }
    } catch (error) {
      if (shouldClearPendingKeyAfterError(error)) {
        clearPendingIdempotencyKey(intentScope);
      }
      setApplyError(
        normalizeUiError(error, l("Settlement apply failed.", "Mahsuplastirma uygulamasi basarisiz oldu."))
      );
    } finally {
      setApplySubmitting(false);
    }
  }

  async function onReverse(event) {
    event.preventDefault();
    setReverseError("");
    setReverseMessage("");
    setReverseResult(null);
    if (!canReverse) {
      setReverseError(
        l("Missing permission: cari.settlement.reverse", "Eksik yetki: cari.settlement.reverse")
      );
      return;
    }

    const settlementBatchId = toPositiveInt(reverseForm.settlementBatchId);
    if (!settlementBatchId) {
      setReverseError(
        l("settlementBatchId must be a positive integer.", "settlementBatchId pozitif bir tam sayi olmali.")
      );
      return;
    }

    setReverseSubmitting(true);
    try {
      const response = await reverseCariSettlement(settlementBatchId, {
        reason:
          String(reverseForm.reason || "").trim() ||
          l("Manual settlement reversal", "Manuel mahsuplastirma tersleme"),
        reversalDate: String(reverseForm.reversalDate || "").trim() || undefined,
      });
      setReverseResult(response);
      setReverseMessage(
        l(
          `Settlement reversed. reversalSettlementBatchId=${response?.row?.id || "-"}`,
          `Mahsuplastirma terslendi. reversalSettlementBatchId=${response?.row?.id || "-"}`
        )
      );
      setManualAllocationDraft({});
      setPreviewRefreshToken((prev) => prev + 1);
    } catch (error) {
      setReverseError(
        normalizeUiError(error, l("Settlement reverse failed.", "Mahsuplastirma tersleme basarisiz oldu."))
      );
    } finally {
      setReverseSubmitting(false);
    }
  }

  async function onBankAttach(event) {
    event.preventDefault();
    setBankAttachError("");
    setBankAttachMessage("");
    setBankAttachResult(null);
    if (!canBankAttach) {
      setBankAttachError(l("Missing permission: cari.bank.attach", "Eksik yetki: cari.bank.attach"));
      return;
    }

    const legalEntityId = toPositiveInt(bankAttachForm.legalEntityId);
    if (!legalEntityId) {
      setBankAttachError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }
    if (!bankAttachForm.bankStatementLineId && !bankAttachForm.bankTransactionRef) {
      setBankAttachError(
        l(
          "bankStatementLineId or bankTransactionRef is required for bank attach.",
          "Banka baglama icin bankStatementLineId veya bankTransactionRef zorunludur."
        )
      );
      return;
    }

    const targetType = String(bankAttachForm.targetType || "").toUpperCase();
    const settlementBatchId = toPositiveInt(bankAttachForm.settlementBatchId);
    const unappliedCashId = toPositiveInt(bankAttachForm.unappliedCashId);
    if (targetType === "SETTLEMENT") {
      if (!settlementBatchId) {
        setBankAttachError(
          l(
            "settlementBatchId is required when targetType=SETTLEMENT.",
            "targetType=SETTLEMENT iken settlementBatchId zorunludur."
          )
        );
        return;
      }
      if (unappliedCashId) {
        setBankAttachError(
          l(
            "unappliedCashId must be empty when targetType=SETTLEMENT.",
            "targetType=SETTLEMENT iken unappliedCashId bos olmali."
          )
        );
        return;
      }
    } else if (targetType === "UNAPPLIED_CASH") {
      if (!unappliedCashId) {
        setBankAttachError(
          l(
            "unappliedCashId is required when targetType=UNAPPLIED_CASH.",
            "targetType=UNAPPLIED_CASH iken unappliedCashId zorunludur."
          )
        );
        return;
      }
      if (settlementBatchId) {
        setBankAttachError(
          l(
            "settlementBatchId must be empty when targetType=UNAPPLIED_CASH.",
            "targetType=UNAPPLIED_CASH iken settlementBatchId bos olmali."
          )
        );
        return;
      }
    } else {
      setBankAttachError(
        l(
          "targetType must be SETTLEMENT or UNAPPLIED_CASH.",
          "targetType SETTLEMENT veya UNAPPLIED_CASH olmali."
        )
      );
      return;
    }

    const idempotencyKey =
      bankAttachForm.idempotencyKey ||
      createEphemeralIdempotencyKey("CARI-BANK-ATTACH");
    setBankAttachForm((prev) => ({ ...prev, idempotencyKey }));

    setBankAttachSubmitting(true);
    try {
      const response = await attachCariBankReference({
        legalEntityId,
        targetType,
        settlementBatchId: settlementBatchId || null,
        unappliedCashId: unappliedCashId || null,
        bankStatementLineId: toPositiveInt(bankAttachForm.bankStatementLineId),
        bankTransactionRef: String(bankAttachForm.bankTransactionRef || "").trim() || null,
        idempotencyKey,
        note: String(bankAttachForm.note || "").trim() || undefined,
      });
      setBankAttachResult(response);
      if (response?.idempotentReplay) {
        setBankAttachMessage(
          l(
            "This request was already applied; showing the existing result.",
            "Bu istek daha once uygulanmis; mevcut sonuc gosteriliyor."
          )
        );
      } else {
        setBankAttachMessage(l("Bank attach completed.", "Banka baglama tamamlandi."));
      }
    } catch (error) {
      setBankAttachError(
        normalizeUiError(error, l("Bank attach failed.", "Banka baglama basarisiz oldu."))
      );
    } finally {
      setBankAttachSubmitting(false);
    }
  }

  async function onBankApply(event) {
    event.preventDefault();
    setBankApplyError("");
    setBankApplyMessage("");
    setBankApplyResult(null);
    setBankApplyFollowUpRisks([]);
    if (!canBankApply) {
      setBankApplyError(l("Missing permission: cari.bank.apply", "Eksik yetki: cari.bank.apply"));
      return;
    }
    if (bankApplyCariNotReady) {
      setBankApplyError(
        l(
          "Setup incomplete for selected legal entity. Configure CARI purpose mappings in GL Setup first.",
          "Secili tuzel kisilik icin kurulum eksik. Once GL Ayarlari altinda CARI amac eslemelerini tamamlayin."
        )
      );
      return;
    }

    const legalEntityId = toPositiveInt(bankApplyForm.legalEntityId);
    const counterpartyId = toPositiveInt(bankApplyForm.counterpartyId);
    if (!legalEntityId) {
      setBankApplyError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }
    if (!counterpartyId) {
      setBankApplyError(l("counterpartyId is required.", "counterpartyId zorunludur."));
      return;
    }
    if (!bankApplyForm.bankStatementLineId && !bankApplyForm.bankTransactionRef) {
      setBankApplyError(
        l(
          "bankStatementLineId or bankTransactionRef is required for bank apply.",
          "Banka uygulama icin bankStatementLineId veya bankTransactionRef zorunludur."
        )
      );
      return;
    }
    if (bankApplyForm.autoAllocate && !String(bankApplyForm.direction || "").trim()) {
      setBankApplyError(
        l("Direction is required for auto-allocation.", "Otomatik dagitim icin yon zorunludur.")
      );
      return;
    }

    let allocations = [];
    if (!bankApplyForm.autoAllocate) {
      try {
        allocations = parseAllocationsJson(bankApplyForm.allocationsJson);
      } catch (error) {
        setBankApplyError(
          translateAllocationsJsonError(
            error?.message || l("allocations JSON is invalid.", "allocations JSON gecersiz.")
          )
        );
        return;
      }
      if (allocations.length === 0) {
        setBankApplyError(
          l("allocations are required when autoAllocate=false.", "autoAllocate=false iken allocations zorunludur.")
        );
        return;
      }
    }

    const bankApplyIdempotencyKey =
      bankApplyForm.bankApplyIdempotencyKey ||
      createEphemeralIdempotencyKey("CARI-BANK-APPLY");
    setBankApplyForm((prev) => ({ ...prev, bankApplyIdempotencyKey }));

    setBankApplySubmitting(true);
    try {
      const payload = buildSettlementApplyPayload({
        ...bankApplyForm,
        legalEntityId,
        counterpartyId,
        idempotencyKey: bankApplyIdempotencyKey,
        allocations: bankApplyForm.autoAllocate ? [] : allocations,
      });
      const response = await applyCariBankSettlement({
        ...payload,
        bankApplyIdempotencyKey,
        bankStatementLineId: toPositiveInt(bankApplyForm.bankStatementLineId),
        bankTransactionRef: String(bankApplyForm.bankTransactionRef || "").trim() || null,
      });
      const replayState = extractCariReplayAndRisks(response);
      setBankApplyResult(response);
      setBankApplyFollowUpRisks(replayState.followUpRisks);
      if (replayState.idempotentReplay) {
        setBankApplyMessage(
          l(
            "This request was already applied; showing the existing result.",
            "Bu istek daha once uygulanmis; mevcut sonuc gosteriliyor."
          )
        );
      } else {
        setBankApplyMessage(
          l(
            `Bank apply completed. settlementBatchId=${response?.row?.id || "-"}`,
            `Banka uygulamasi tamamlandi. settlementBatchId=${response?.row?.id || "-"}`
          )
        );
      }
      setPreviewRefreshToken((prev) => prev + 1);
    } catch (error) {
      setBankApplyError(
        normalizeUiError(error, l("Bank apply failed.", "Banka uygulamasi basarisiz oldu."))
      );
    } finally {
      setBankApplySubmitting(false);
    }
  }

  const manualAllocations = useMemo(
    () => parseManualAllocations(openItems, manualAllocationDraft),
    [openItems, manualAllocationDraft]
  );
  const autoAllocateDirectionMissing =
    Boolean(applyForm.autoAllocate) && !String(applyForm.direction || "").trim();
  const autoAllocateFxMissing =
    Boolean(applyForm.autoAllocate) &&
    canReadFxRates &&
    autoAllocateMissingFxRows.length > 0;
  const autoAllocateBlocked =
    autoAllocateDirectionMissing ||
    (Boolean(applyForm.autoAllocate) && mixedDirectionRisk) ||
    autoAllocateFxMissing;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {settlementPageHeading.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {settlementPageHeading.description}
        </p>
        {lookupWarning ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {lookupWarning}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Legal Entity ID", "Tuzel Kisilik ID")}
            {legalEntities.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.legalEntityId}
                onChange={(event) => updateApplyForm("legalEntityId", event.target.value)}
                disabled={!canApply}
              >
                <option value="">{l("Select legal entity", "Tuzel kisilik secin")}</option>
                {legalEntities.map((row) => (
                  <option key={`settlement-le-${row.id}`} value={row.id}>
                    {`${row.code || row.id} - ${row.name || "-"}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.legalEntityId}
                onChange={(event) => updateApplyForm("legalEntityId", event.target.value)}
                disabled={!canApply}
              />
            )}
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Counterparty ID", "Cari ID")}
            {counterpartyOptions.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.counterpartyId}
                onChange={(event) => updateApplyForm("counterpartyId", event.target.value)}
                disabled={!canApply}
              >
                <option value="">{l("Select counterparty", "Cari secin")}</option>
                {counterpartyOptions.map((row) => (
                  <option key={`settlement-cp-${row.id}`} value={row.id}>
                    {`${row.code || row.id} - ${row.name || "-"} (${row.counterpartyType || "OTHER"})`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.counterpartyId}
                onChange={(event) => updateApplyForm("counterpartyId", event.target.value)}
                disabled={!canApply}
              />
            )}
          </label>
          {canReadCards ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Counterparty Lookup", "Cari Arama")}
                <Combobox
                  className="mt-1"
                  value={applyForm.counterpartyId}
                  options={counterpartyLookupOptions}
                  loading={counterpartyLoading}
                  disabled={!canApply || !toPositiveInt(applyForm.legalEntityId)}
                  placeholder={toPositiveInt(applyForm.legalEntityId) ? l("Type code/name", "Kod/ad yazin") : l("Select legal entity first", "Once tuzel kisilik secin")}
                  noOptionsText={toPositiveInt(applyForm.legalEntityId) ? l("No counterparties found.", "Cari bulunamadi.") : l("Set legalEntityId to load counterparties.", "Carileri yuklemek icin legalEntityId secin.")}
                  onInputChange={(nextValue, meta) => {
                    setApplyInlineCounterpartyError("");
                    setApplyInlineCounterpartyMessage("");
                    const reason = String(meta?.reason || "").trim().toLowerCase();
                    if (reason === "select" || reason === "clear") {
                      setApplyCounterpartyLookupQuery("");
                      return;
                    }
                    setApplyCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                  }}
                  onChange={(nextValue) =>
                    updateApplyForm("counterpartyId", nextValue ? String(nextValue) : "")
                  }
                />
              </label>
              {canUpsertCards ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                  onClick={handleInlineCreateCounterpartyForApplyForm}
                  disabled={!canInlineCreateCounterpartyInApplyForm || applyInlineCounterpartySaving}
                >
                  {applyInlineCounterpartySaving
                    ? l("Creating counterparty...", "Cari olusturuluyor...")
                    : l(
                        `Create "${applyInlineCounterpartyName || "new counterparty"}"`,
                        `"${applyInlineCounterpartyName || "yeni cari"}" olustur`
                      )}
                </button>
              ) : null}
              {applyInlineCounterpartyError ? (
                <p className="mt-1 text-[11px] normal-case text-rose-700">{applyInlineCounterpartyError}</p>
              ) : null}
              {applyInlineCounterpartyMessage ? (
                <p className="mt-1 text-[11px] normal-case text-emerald-700">{applyInlineCounterpartyMessage}</p>
              ) : null}
            </div>
          ) : null}
          {!hasFixedRouteDirection ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Direction", "Yon")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.direction}
                onChange={(event) => updateApplyForm("direction", event.target.value)}
                disabled={!canApply}
              >
                <option value="">{l("Select", "Secin")}</option>
                <option value="AR">AR</option>
                <option value="AP">AP</option>
              </select>
            </label>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("As-Of Date (Preview)", "Tarih Itibariyla (Onizleme)")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={previewFilters.asOfDate}
              onChange={(event) =>
                setPreviewFilters((prev) => ({ ...prev, asOfDate: event.target.value }))
              }
              disabled={!canApply}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Payment Channel", "Odeme Kanali")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={linkedCashForm.paymentChannel}
              onChange={(event) =>
                setLinkedCashForm((prev) => ({
                  ...prev,
                  paymentChannel: event.target.value,
                  createLinkedCashTransaction:
                    event.target.value === "CASH" ? prev.createLinkedCashTransaction : false,
                }))
              }
              disabled={!canApply}
            >
              <option value="MANUAL">MANUAL</option>
              <option value="CASH">CASH</option>
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(linkedCashForm.createLinkedCashTransaction)}
              onChange={(event) =>
                setLinkedCashForm((prev) => ({
                  ...prev,
                  createLinkedCashTransaction:
                    toUpper(prev.paymentChannel) === "CASH" ? event.target.checked : false,
                }))
              }
              disabled={!canApply || toUpper(linkedCashForm.paymentChannel) !== "CASH"}
            />
            {l(
              "Create linked cash transaction after settlement apply",
              "Mahsuplastirma sonrasi bagli kasa islemi olustur"
            )}
          </label>
          {toUpper(linkedCashForm.paymentChannel) !== "CASH" ? (
            <p className="text-xs text-slate-500 md:col-span-2">
              {l(
                "Select payment channel CASH to enable linked cash transaction creation.",
                "Bagli kasa islemi olusturmayi acmak icin odeme kanali olarak CASH secin."
              )}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Settlement Apply", "Mahsuplastirma Uygula")}
        </h2>
        {!canApply ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {l("Missing permission: `cari.settlement.apply`", "Eksik yetki: `cari.settlement.apply`")}
          </div>
        ) : null}
        {applyCariNotReady ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              {l("Setup incomplete (CARI posting)", "Kurulum eksik (CARI kaydi)")}
            </p>
            <p className="mt-1">
              {l(
                "Settlement apply is disabled for legalEntityId=",
                "Mahsuplastirma uygulama su legalEntityId icin kapali: "
              )}
              {applyLegalEntityId || "-"}.
            </p>
            {Array.isArray(applyCariReadiness?.missingPurposeCodes) &&
            applyCariReadiness.missingPurposeCodes.length > 0 ? (
              <p className="mt-1">
                {l("Missing purpose codes:", "Eksik amac kodlari:")}{" "}
                {applyCariReadiness.missingPurposeCodes.join(", ")}
              </p>
            ) : null}
            {Array.isArray(applyCariReadiness?.invalidMappings) &&
            applyCariReadiness.invalidMappings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {applyCariReadiness.invalidMappings.map((row, index) => (
                  <li key={`apply-cari-invalid-${index}`}>
                    {String(row?.purposeCode || "-")}: {formatReadinessReason(row?.reason, l)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Fix manually", "Elle Duzelt")}
              </Link>
              <Link
                to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Use template", "Sablon Kullan")}
              </Link>
            </div>
          </div>
        ) : null}
        {applyOuCurrentAccountSetupBlocked ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              {l(
                "Cross-context current-account setup still needs attention",
                "Capraz-context cari hesap kurulumu halen dikkat istiyor"
              )}
            </p>
            <p className="mt-1">
              {formatOperatingUnitCurrentAccountBlocker(
                applyOuCurrentAccountReadiness,
                l
              )}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {l(
                "Same-branch settlement can still continue, but branch/central or branch/branch collector flows will stay blocked until Organization Management current-account setup is fixed.",
                "Ayni sube icindeki mahsuplastirma devam edebilir; ancak sube/merkez veya sube/sube tahsilat-odeme akislari Organizasyon Yonetimi altindaki cari hesap kurulumu duzeltilene kadar bloklu kalir."
              )}
            </p>
            <div className="mt-2">
              <Link
                to={OU_CURRENT_ACCOUNT_SETUP_PATH}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Open Organization Management", "Organizasyon Yonetimini Ac")}
              </Link>
            </div>
          </div>
        ) : null}
        {applyError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {applyError}
          </div>
        ) : null}
        {applyErrorHint ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {applyErrorHint}
          </div>
        ) : null}
        {applyMessage ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {applyMessage}
          </div>
        ) : null}
        {applyReplayMessage ? (
          <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
            {applyReplayMessage}
          </div>
        ) : null}
        {applyFollowUpRisks.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold">{l("Follow-up risks", "Takip riskleri")}</p>
            <ul className="mt-1 list-disc pl-5">
              {applyFollowUpRisks.map((risk, index) => (
                <li key={`apply-risk-${index}`}>{risk}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {linkedCashError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {linkedCashError}
          </div>
        ) : null}
        {linkedCashMessage ? (
          <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
            {linkedCashMessage}
          </div>
        ) : null}

        <form
          className="mt-4 grid gap-3 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onApply(applyForm);
          }}
        >
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Settlement Date", "Mahsuplastirma Tarihi")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={applyForm.settlementDate}
              onChange={(event) => updateApplyForm("settlementDate", event.target.value)}
              disabled={!canApply || applySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Currency", "Para Birimi")}
            <input
              type="text"
              maxLength={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
              value={applyForm.currencyCode}
              onChange={(event) => updateApplyForm("currencyCode", event.target.value)}
              disabled={!canApply || applySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Incoming Amount Txn", "Gelen Tutar Txn")}
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={applyForm.incomingAmountTxn}
              onChange={(event) => updateApplyForm("incomingAmountTxn", event.target.value)}
              disabled={!canApply || applySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("FX Rate (optional)", "Kur (opsiyonel)")}
            <input
              type="number"
              min="0.0000000001"
              step="0.0000000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={applyForm.fxRate}
              onChange={(event) => updateApplyForm("fxRate", event.target.value)}
              disabled={!canApply || applySubmitting}
            />
            <span className="mt-1 block text-[11px] font-normal normal-case text-slate-500">
              {applyFxRateHint}
            </span>
          </label>
          {toUpper(linkedCashForm.paymentChannel) === "CASH" ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
              {l("Settlement Source Account", "Mahsuplastirma Kaynak Hesabi")}
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-normal normal-case text-slate-600">
                {l(
                  "CASH channel uses the selected cash register account automatically.",
                  "CASH kanali secilen kasa hesabini otomatik kullanir."
                )}
              </p>
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
              {l("Settlement Source Account (optional)", "Mahsuplastirma Kaynak Hesabi (opsiyonel)")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={applyForm.offsetAccountId}
                onChange={(event) => updateApplyForm("offsetAccountId", event.target.value)}
                disabled={
                  !canApply ||
                  applySubmitting ||
                  applyOffsetAccountsLoading ||
                  !canReadGlAccounts
                }
              >
                <option value="">
                  {l(
                    "Use default MANUAL settlement mapping",
                    "Varsayilan MANUAL mahsuplastirma eslemesini kullan"
                  )}
                </option>
                {applyOffsetAccountChoices.map((row) => (
                  <option key={`settlement-offset-account-${row.id}`} value={String(row.id)}>
                    {row.code} - {row.name} ({row.accountType || "-"})
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] font-normal normal-case text-slate-500">
                {l(
                  "Pick the actual bank/cash/clearing asset account for this MANUAL settlement.",
                  "Bu MANUAL mahsuplastirma icin gercek banka/kasa/clearing varlik hesabini secin."
                )}
              </span>
              {!canReadGlAccounts ? (
                <span className="mt-1 block text-[11px] font-normal normal-case text-amber-700">
                  {l(
                    "Missing permission: gl.account.read. Default mapping will be used.",
                    "Eksik yetki: gl.account.read. Varsayilan esleme kullanilacak."
                  )}
                </span>
              ) : null}
              {applyOffsetAccountsLoading ? (
                <span className="mt-1 block text-[11px] font-normal normal-case text-slate-500">
                  {l(
                    "Loading settlement source accounts...",
                    "Mahsuplastirma kaynak hesaplari yukleniyor..."
                  )}
                </span>
              ) : null}
              {applyOffsetAccountsError ? (
                <span className="mt-1 block text-[11px] font-normal normal-case text-rose-700">
                  {applyOffsetAccountsError}
                </span>
              ) : null}
              {!applyOffsetAccountsLoading &&
              !applyOffsetAccountsError &&
              canReadGlAccounts &&
              applyOffsetAccountChoices.length === 0 ? (
                <span className="mt-1 block text-[11px] font-normal normal-case text-slate-500">
                  {l(
                    "No postable ASSET accounts found for the selected legal entity.",
                    "Secili tuzel kisilik icin kaydedilebilir ASSET hesap bulunamadi."
                  )}
                </span>
              ) : null}
            </label>
          )}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("Note (optional)", "Not (opsiyonel)")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={applyForm.note}
              onChange={(event) => updateApplyForm("note", event.target.value)}
              disabled={!canApply || applySubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("Idempotency Key (auto-generated if empty)", "Idempotency Key (bossa otomatik olusur)")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={applyForm.idempotencyKey}
              onChange={(event) => updateApplyForm("idempotencyKey", event.target.value)}
              disabled={!canApply || applySubmitting}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(applyForm.autoAllocate)}
              onChange={(event) => updateApplyForm("autoAllocate", event.target.checked)}
              disabled={!canApply || applySubmitting}
            />
            {l("autoAllocate", "otomatikDagit")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(applyForm.useUnappliedCash)}
              onChange={(event) => updateApplyForm("useUnappliedCash", event.target.checked)}
              disabled={!canApply || applySubmitting}
            />
            {l("useUnappliedCash", "kullanilmayanNakdiKullan")}
          </label>

          {linkedCashForm.createLinkedCashTransaction &&
          toUpper(linkedCashForm.paymentChannel) === "CASH" ? (
            <>
              {!canCreateCashTxn ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 md:col-span-4">
                  {l("Missing permission: `cash.txn.create`", "Eksik yetki: `cash.txn.create`")}
                </div>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("cash register", "kasa")}
                {linkedRegisterOptions.length > 0 ? (
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={linkedCashForm.registerId}
                    onChange={(event) =>
                      setLinkedCashForm((prev) => ({
                        ...prev,
                        registerId: event.target.value,
                        cashSessionId: "",
                      }))
                    }
                    disabled={applySubmitting}
                    required
                  >
                    <option value="">{l("Select register", "Kasa secin")}</option>
                    {linkedRegisterOptions.map((row) => (
                      <option key={`linked-register-${row.id}`} value={row.id}>
                        {`${row.code || row.id} - ${row.name || "-"} (${row.currency_code || "-"})`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={linkedCashForm.registerId}
                    onChange={(event) =>
                      setLinkedCashForm((prev) => ({
                        ...prev,
                        registerId: event.target.value,
                        cashSessionId: "",
                      }))
                    }
                    disabled={applySubmitting}
                    required
                  />
                )}
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("cash session", "kasa oturumu")} {linkedCashSessionRequiredByRegister ? "*" : l("(optional)", "(opsiyonel)")}
                {linkedRegisterOpenSessions.length > 0 ? (
                  <select
                    className={linkedCashSessionInputClass}
                    value={linkedCashForm.cashSessionId}
                    onChange={(event) =>
                      setLinkedCashForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                    }
                    disabled={applySubmitting}
                    ref={linkedCashSessionInputRef}
                  >
                    <option value="">{l("Select open session", "Acik oturum secin")}</option>
                    {linkedRegisterOpenSessions.map((row) => (
                      <option key={`linked-session-${row.id}`} value={row.id}>
                        {`#${row.id} - ${row.cash_register_code || row.cash_register_id}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min="1"
                    className={linkedCashSessionInputClass}
                    value={linkedCashForm.cashSessionId}
                    onChange={(event) =>
                      setLinkedCashForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                    }
                    disabled={applySubmitting}
                    ref={linkedCashSessionInputRef}
                  />
                )}
                {linkedCashSessionMissingOpenSession ? (
                  <p className="mt-1 text-xs normal-case text-rose-700">
                    Selected register has session_mode=REQUIRED but no OPEN session exists.
                    {l("Open a session on Cash Sessions page first.", "Once Cash Sessions sayfasinda bir oturum acin.")}
                  </p>
                ) : null}
                {!canReadCashSessions ? (
                  <p className="mt-1 text-xs normal-case text-rose-700">
                    {l("Missing permission: cash.register.read (required to list OPEN sessions).", "Eksik yetki: cash.register.read (OPEN oturumlari listelemek icin gerekli).")}
                  </p>
                ) : null}
                {linkedCashSessionValueMissing && !linkedCashSessionMissingOpenSession ? (
                  <p className="mt-1 text-xs normal-case text-rose-700">
                    {l("This register requires cashSessionId. Select an OPEN session.", "Bu kasa cashSessionId gerektirir. Bir OPEN oturumu secin.")}
                  </p>
                ) : null}
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("counterAccount", "karsiHesap")}
                {canReadGlAccounts ? (
                  <>
                    <Combobox
                      className="mt-1"
                      value={linkedCashForm.counterAccountId}
                      options={linkedCashAccountLookupOptions}
                      loading={linkedCashAccountLoading}
                      filterOptions={false}
                      placeholder={
                        toPositiveInt(applyForm.legalEntityId)
                          ? l("Type account code/name", "Hesap kodu/adi yazin")
                          : l("Select legal entity first", "Once tuzel kisilik secin")
                      }
                      noOptionsText={
                        toPositiveInt(applyForm.legalEntityId)
                          ? l("No accounts found. Type to refine search.", "Hesap bulunamadi. Aramayi daraltin.")
                          : l("Set legalEntityId to load accounts.", "Hesaplari yuklemek icin legalEntityId secin.")
                      }
                      disabled={applySubmitting || !toPositiveInt(applyForm.legalEntityId)}
                      onInputChange={(nextValue, meta) => {
                        const reason = String(meta?.reason || "").trim().toLowerCase();
                        if (reason === "select" || reason === "clear") {
                          setLinkedCashAccountQuery("");
                          return;
                        }
                        setLinkedCashAccountQuery(normalizeLookupQuery(nextValue));
                      }}
                      onChange={(nextValue) =>
                        setLinkedCashForm((prev) => ({
                          ...prev,
                          counterAccountId: nextValue ? String(nextValue) : "",
                        }))
                      }
                    />
                    {linkedCashAccountError ? (
                      <p className="mt-1 text-xs text-amber-700">{linkedCashAccountError}</p>
                    ) : null}
                    {linkedCashCounterAccountResolutionHint ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {linkedCashCounterAccountResolutionHint}
                      </p>
                    ) : null}
                    {linkedCashCounterpartyAccountWarning ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {linkedCashCounterpartyAccountWarning}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={linkedCashForm.counterAccountId}
                    onChange={(event) =>
                      setLinkedCashForm((prev) => ({
                        ...prev,
                        counterAccountId: event.target.value,
                      }))
                    }
                    disabled={applySubmitting}
                    required
                  />
                )}
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("txnDatetime", "islemZamani")}
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={linkedCashForm.txnDatetime}
                  onChange={(event) =>
                    setLinkedCashForm((prev) => ({ ...prev, txnDatetime: event.target.value }))
                  }
                  disabled={applySubmitting}
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("bookDate", "kayitTarihi")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={linkedCashForm.bookDate}
                  onChange={(event) =>
                    setLinkedCashForm((prev) => ({ ...prev, bookDate: event.target.value }))
                  }
                  disabled={applySubmitting}
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("referenceNo (optional)", "referansNo (opsiyonel)")}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={linkedCashForm.referenceNo}
                  onChange={(event) =>
                    setLinkedCashForm((prev) => ({ ...prev, referenceNo: event.target.value }))
                  }
                  disabled={applySubmitting}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                {l("description (optional)", "aciklama (opsiyonel)")}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={linkedCashForm.description}
                  onChange={(event) =>
                    setLinkedCashForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  disabled={applySubmitting}
                />
              </label>
              {selectedLinkedRegister &&
              toUpper(selectedLinkedRegister.currency_code) !== toUpper(applyForm.currencyCode) ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 md:col-span-4">
                  {l(
                    `Register currency (${selectedLinkedRegister.currency_code}) differs from settlement currency (${toUpper(applyForm.currencyCode)}). Exchange first, then settle.`,
                    `Kasa para birimi (${selectedLinkedRegister.currency_code}) mahsuplastirma para biriminden (${toUpper(applyForm.currencyCode)}) farkli. Once kur degisimi yapin, sonra mahsuplastirin.`
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="md:col-span-4 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={
                !canApply ||
                applySubmitting ||
                autoAllocateBlocked ||
                applyCariNotReady
              }
            >
              {applySubmitting ? l("Applying...", "Uygulaniyor...") : l("Apply Settlement", "Mahsuplastirmayi Uygula")}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              onClick={() => {
                setApplyCurrencyManuallyEdited(false);
                setApplyForm(buildApplyDefaultForm(fixedRouteDirection));
                setManualAllocationDraft({});
                setApplyError("");
                setApplyMessage("");
                setApplyReplayMessage("");
                setApplyResult(null);
                setApplyFollowUpRisks([]);
                setApplyCounterpartyLookupQuery("");
                setApplyInlineCounterpartyError("");
                setApplyInlineCounterpartyMessage("");
                setLinkedCashForm(buildLinkedCashDefaultForm());
                setLinkedCashError("");
                setLinkedCashMessage("");
                setLinkedCashResult(null);
                setPreviewFilters((prev) => ({
                  ...prev,
                  legalEntityId: "",
                  counterpartyId: "",
                  direction: fixedRouteDirection,
                }));
              }}
              disabled={applySubmitting}
            >
              {l("Reset Apply Form", "Uygulama Formunu Sifirla")}
            </button>
          </div>
        </form>

        {autoAllocateDirectionMissing ? (
          <p className="mt-3 text-sm text-amber-700">
            {l("Direction is required for auto-allocation.", "Otomatik dagitim icin yon zorunludur.")}
          </p>
        ) : null}
        {applyForm.autoAllocate && mixedDirectionRisk ? (
          <p className="mt-1 text-sm text-amber-700">
            {l("Mixed-direction risk detected in preview rows. Select one direction before auto-allocate.", "Onizleme satirlarinda karisik yon riski bulundu. Otomatik dagitimdan once tek yon secin.")}
          </p>
        ) : null}
        {applyForm.autoAllocate && autoAllocateFxMissing ? (
          <p className="mt-1 text-sm text-amber-700">
            {l("Auto-allocation is blocked: missing settlement/document FX rate on at least one due row.", "Otomatik dagitim engellendi: en az bir satirda mahsuplastirma/belge kuru eksik.")}
          </p>
        ) : null}
        {selectedApplyPreviewRows.length > 0 ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              {l("Owner context preview:", "Owner baglam onizlemesi:")}{" "}
              {applyOwnerContextSummary.hasMixed
                ? l("Mixed owner contexts", "Karisik owner baglamlari")
                : predictedApplySettlementContext.ownerContextLabel}
            </p>
            <p className="mt-1">
              {l("Collector context preview:", "Collector baglam onizlemesi:")}{" "}
              {predictedApplySettlementContext.collectorContextLabel}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Owner = open-item/document context. Collector = cash, bank, or execution context that closes it.",
                "Owner = acik kalem/belge baglami. Collector = bunu kapatan kasa, banka veya uygulama baglami."
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Owner preview is derived from the open items actually selected for settlement. With auto-allocation on, entering incoming amount can change the selected rows and the owner preview. The chosen cash register affects collector context, not owner context.",
                "Owner onizlemesi mahsuplastirma icin fiilen secilen acik kalemlerden uretilir. Otomatik dagitim acikken gelen tutari girmek secilen satirlari ve owner onizlemesini degistirebilir. Secilen kasa register'i owner degil, collector baglamini etkiler."
              )}
            </p>
            {applyOwnerContextSummary.hasMixed ? (
              <p className="mt-1 text-rose-700">
                {l(
                  "Selected rows span multiple owner contexts. V1 requires one owner OU per settlement batch.",
                  "Secili satirlar birden fazla owner baglamina yayiliyor. V1 her mahsuplastirma batch'i icin tek owner OU ister."
                )}
              </p>
            ) : null}
            {predictedApplySelfBalancingWarning ? (
              <p className="mt-1 text-amber-700">{predictedApplySelfBalancingWarning}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {l("Open-item auto-allocation preview (oldest due first)", "Acik kalem otomatik dagitim onizlemesi (en eski vade once)")}
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {l(
              "This preview shows only posted documents that still have an open residual balance for the selected legal entity, counterparty, and as-of date.",
              "Bu onizleme, secili tuzel kisilik, cari ve tarih icin acik bakiye tasiyan sadece kaydedilmis belgeleri gosterir."
            )}
          </p>
          {!canReadReports ? (
            <p className="mt-2 text-sm text-amber-700">
              {l(
                "Preview needs permission: `cari.report.read`. Settlement apply/reverse and bank workflows can still be submitted with their own permissions.",
                "Onizleme icin `cari.report.read` yetkisi gerekir. Mahsuplastirma ve banka akislari kendi yetkileriyle yine gonderilebilir."
              )}
            </p>
          ) : null}
          {previewError ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {previewError}
            </div>
          ) : null}
          {previewFxLoading ? (
            <p className="mt-2 text-sm text-slate-600">
              {l("Loading exact-date SPOT FX rates for settlement preview...", "Mahsuplastirma onizlemesi icin tam tarihli SPOT kurlar yukleniyor...")}
            </p>
          ) : null}
          {previewFxError ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {previewFxError}
            </div>
          ) : null}
          {!canReadFxRates && hasCrossCurrencyPreviewRows ? (
            <p className="mt-2 text-sm text-amber-700">
              {l(
                "Cross-currency preview requires permission: `fx.rate.read`. You can still submit and the backend will validate rates.",
                "Capraz para birimi onizlemesi `fx.rate.read` yetkisi ister. Yine de gonderebilirsiniz; backend kurlari dogrular."
              )}
            </p>
          ) : null}
          {previewMissingFxRows.length > 0 ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {l("Missing FX for", "Eksik kur")} {previewMissingFxRows.length}{" "}
              {l(
                "row(s). Add SPOT rate(s) for settlement date",
                "satir. Mahsuplastirma tarihi icin SPOT kur ekleyin"
              )}{" "}
              {applyForm.settlementDate || "-"}, {l("or use same-currency settlement.", "veya ayni para birimi ile mahsuplastirin.")}
            </div>
          ) : null}
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("openItemId", "openItemId")}</th>
                  <th className="px-3 py-2">{l("documentNo", "belgeNo")}</th>
                  <th className="px-3 py-2">{l("owner context", "owner baglam")}</th>
                  <th className="px-3 py-2">{l("direction", "yon")}</th>
                  <th className="px-3 py-2">{l("dueDate", "vadeTarihi")}</th>
                  <th className="px-3 py-2">{l("open (doc)", "acik (belge)")}</th>
                  <th className="px-3 py-2">{l("apply (settlement)", "uygula (mahsuplastirma)")}</th>
                  <th className="px-3 py-2">{l("equiv. doc apply", "esdeger belge uygulama")}</th>
                  <th className="px-3 py-2">{l("residual (doc)", "kalan (belge)")}</th>
                  <th className="px-3 py-2">{l("cross rate / source", "capraz kur / kaynak")}</th>
                  <th className="px-3 py-2">{l("manual doc amount", "manuel belge tutari")}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={`preview-${row.openItemId}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.openItemId}</td>
                    <td className="px-3 py-2">{row.documentNo || "-"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {String(row?.operatingUnitContextLabel || row?.ownerContextLabel || "-")}
                    </td>
                    <td className="px-3 py-2">{row.direction || "-"}</td>
                    <td className="px-3 py-2">{row.dueDate || "-"}</td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.openAmountDocTxn}
                        currencyCode={row.documentCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.expectedApplySettlementTxn}
                        currencyCode={row.settlementCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.expectedApplyDocTxn}
                        currencyCode={row.documentCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.expectedResidualDocTxn}
                        currencyCode={row.documentCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.fxMissing ? (
                        <span className="text-amber-700">
                          {formatFxMissingReason(
                            row.fxMissingReasonCode || row.fxMissingReason,
                            l
                          )}
                        </span>
                      ) : (
                        <>
                          <span>
                            1 {row.settlementCurrencyCode || "-"} = {formatCrossRate(row.appliedCrossRate)}{" "}
                            {row.documentCurrencyCode || "-"}
                          </span>
                          <br />
                          <span className="text-slate-500">
                            {row.crossRateSource || "-"} / {row.crossRateDate || "-"}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        placeholder={row.documentCurrencyCode || "DOC"}
                        value={manualAllocationDraft[String(row.openItemId)] || ""}
                        onChange={(event) =>
                          setManualAllocationDraft((prev) => ({
                            ...prev,
                            [String(row.openItemId)]: event.target.value,
                          }))
                        }
                        disabled={!canApply || applySubmitting || applyForm.autoAllocate}
                      />
                    </td>
                  </tr>
                ))}
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-3 text-slate-500">
                      {previewLoading
                        ? l("Loading preview...", "Onizleme yukleniyor...")
                        : l(
                            "No open-item preview rows for the selected legalEntityId, counterpartyId, and asOfDate.",
                            "Secili legalEntityId, counterpartyId ve asOfDate icin acik kalem onizleme satiri yok."
                          )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!applyForm.autoAllocate ? (
            <p className="mt-2 text-sm text-slate-600">
              {l("Manual allocations selected:", "Secilen manuel dagitim:")}{" "}
              {manualAllocations.length} {l("(document-currency amounts)", "(belge para birimi tutarlari)")}
            </p>
          ) : null}
        </div>

        {applyResult ? (
          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              {l("Apply response blocks", "Uygulama yanit bloklari")}
            </h3>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">
                {applyResultContext.isCrossContext
                  ? l("Cross-context self-balancing", "Baglamlar arasi self-balancing")
                  : l("Same-context settlement", "Ayni baglam mahsuplastirmasi")}
              </p>
              <p className="mt-1">
                {l("Collector context:", "Collector baglami:")} {applyResultContext.collectorContextLabel}
              </p>
              <p className="mt-1">
                {l("Owner context:", "Owner baglami:")} {applyResultContext.ownerContextLabel}
              </p>
              {applyResultContext.originatingCrossContextSettlementBatchId ? (
                <p className="mt-1">
                  {l("Originating cross-context batch:", "Kaynak baglamlar arasi batch:")} #
                  {applyResultContext.originatingCrossContextSettlementBatchId}
                </p>
              ) : null}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="font-semibold text-slate-600">settlementBatchId</dt>
              <dd>{applyResult?.row?.id || "-"}</dd>
              <dt className="font-semibold text-slate-600">settlementNo</dt>
              <dd>{applyResult?.row?.settlementNo || "-"}</dd>
              <dt className="font-semibold text-slate-600">idempotentReplay</dt>
              <dd>{String(Boolean(applyResult?.idempotentReplay))}</dd>
              <dt className="font-semibold text-slate-600">allocationCount</dt>
              <dd>{Array.isArray(applyResult?.allocations) ? applyResult.allocations.length : 0}</dd>
              <dt className="font-semibold text-slate-600">linkedCashTransactionId</dt>
              <dd>
                {applyResult?.row?.cashTransactionId ||
                  linkedCashResult?.id ||
                  "-"}
              </dd>
              <dt className="font-semibold text-slate-600">ownerOperatingUnitId</dt>
              <dd>{applyResult?.row?.ownerOperatingUnitId || "-"}</dd>
              <dt className="font-semibold text-slate-600">collectorOperatingUnitId</dt>
              <dd>{applyResult?.row?.collectorOperatingUnitId || "-"}</dd>
              <dt className="font-semibold text-slate-600">ownerContext</dt>
              <dd>{applyResultContext.ownerContextLabel}</dd>
              <dt className="font-semibold text-slate-600">collectorContext</dt>
              <dd>{applyResultContext.collectorContextLabel}</dd>
              <dt className="font-semibold text-slate-600">isCrossContext</dt>
              <dd>{String(Boolean(applyResultContext.isCrossContext))}</dd>
              <dt className="font-semibold text-slate-600">originatingCrossContextSettlementBatchId</dt>
              <dd>{applyResult?.row?.originatingCrossContextSettlementBatchId || "-"}</dd>
            </dl>
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(
  {
    allocations: applyResult?.allocations || [],
    fx: applyResult?.fx || null,
    unapplied: applyResult?.unapplied || null,
  },
  null,
  2
)}
            </pre>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Settlement Reverse", "Mahsuplastirmayi Tersle")}
        </h2>
        {!canReverse ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {l("Missing permission: `cari.settlement.reverse`", "Eksik yetki: `cari.settlement.reverse`")}
          </div>
        ) : null}
        {reverseError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {reverseError}
          </div>
        ) : null}
        {reverseErrorHint ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {reverseErrorHint}
          </div>
        ) : null}
        {reverseMessage ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {reverseMessage}
          </div>
        ) : null}
        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={onReverse}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("lookup legalEntityId", "arama legalEntityId")}
            {legalEntities.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={reverseLookupFilters.legalEntityId}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setReverseLookupFilters((prev) => ({
                    ...prev,
                    legalEntityId: nextValue,
                  }));
                  setReverseSettlementLookupQuery("");
                  setReverseForm((prev) => ({
                    ...prev,
                    settlementBatchId: "",
                  }));
                }}
                disabled={!canReverse || reverseSubmitting}
              >
                <option value="">{l("Select legal entity", "Tuzel kisilik secin")}</option>
                {legalEntities.map((row) => (
                  <option key={`reverse-lookup-le-${row.id}`} value={row.id}>
                    {`${row.code || row.id} - ${row.name || "-"}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={reverseLookupFilters.legalEntityId}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setReverseLookupFilters((prev) => ({
                    ...prev,
                    legalEntityId: nextValue,
                  }));
                  setReverseSettlementLookupQuery("");
                  setReverseForm((prev) => ({
                    ...prev,
                    settlementBatchId: "",
                  }));
                }}
                disabled={!canReverse || reverseSubmitting}
              />
            )}
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("lookup counterpartyId (optional)", "arama counterpartyId (opsiyonel)")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={reverseLookupFilters.counterpartyId}
              onChange={(event) => {
                setReverseLookupFilters((prev) => ({
                  ...prev,
                  counterpartyId: event.target.value,
                }));
                setReverseSettlementLookupQuery("");
                setReverseForm((prev) => ({
                  ...prev,
                  settlementBatchId: "",
                }));
              }}
              disabled={!canReverse || reverseSubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("lookup asOfDate", "arama asOfDate")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={reverseLookupFilters.asOfDate}
              onChange={(event) => {
                setReverseLookupFilters((prev) => ({
                  ...prev,
                  asOfDate: event.target.value,
                }));
                setReverseSettlementLookupQuery("");
                setReverseForm((prev) => ({
                  ...prev,
                  settlementBatchId: "",
                }));
              }}
              disabled={!canReverse || reverseSubmitting}
            />
          </label>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("lookup rows", "arama satirlari")}
            <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
              {reverseSettlementLoading
                ? l("Loading...", "Yukleniyor...")
                : l(
                    `${reverseSettlementLookupOptions.length} selectable settlement(s)`,
                    `${reverseSettlementLookupOptions.length} secilebilir mahsuplastirma`
                  )}
            </div>
          </div>

          {canReadReports ? (
            <div className="md:col-span-4 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Settlement lookup (by settlement no/date/counterparty)", "Mahsuplastirma arama (mahsuplastirma no/tarih/cari)")}
              <Combobox
                className="mt-1"
                value={reverseForm.settlementBatchId}
                options={reverseSettlementLookupOptions}
                loading={reverseSettlementLoading}
                disabled={
                  !canReverse ||
                  reverseSubmitting ||
                  !toPositiveInt(reverseLookupFilters.legalEntityId)
                }
                placeholder={
                  toPositiveInt(reverseLookupFilters.legalEntityId)
                    ? l("Type settlement no or counterparty", "Mahsuplastirma no veya cari yazin")
                    : l("Select lookup legalEntityId first", "Once arama legalEntityId secin")
                }
                noOptionsText={
                  toPositiveInt(reverseLookupFilters.legalEntityId)
                    ? l("No reversible settlements found for filters.", "Filtreler icin terslenebilir mahsuplastirma bulunamadi.")
                    : l("Set lookup legalEntityId to load settlements.", "Mahsuplastirmalari yuklemek icin arama legalEntityId secin.")
                }
                onInputChange={(nextValue, meta) => {
                  const reason = String(meta?.reason || "").trim().toLowerCase();
                  if (reason === "select" || reason === "clear") {
                    setReverseSettlementLookupQuery("");
                    return;
                  }
                  setReverseSettlementLookupQuery(normalizeLookupQuery(nextValue));
                }}
                onChange={(nextValue) => {
                  setReverseForm((prev) => ({
                    ...prev,
                    settlementBatchId: nextValue ? String(nextValue) : "",
                  }));
                }}
              />
              {reverseSettlementLookupError ? (
                <p className="mt-1 text-[11px] normal-case text-rose-700">
                  {reverseSettlementLookupError}
                </p>
              ) : null}
              {selectedReverseSettlement ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] normal-case text-slate-700">
                  <p>
                    {l("Selected:", "Secilen:")}{" "}
                    {selectedReverseSettlement.settlementNo ||
                      `#${selectedReverseSettlement.settlementBatchId || "-"}`}
                    {selectedReverseSettlement.settlementBatchId
                      ? ` (ID ${selectedReverseSettlement.settlementBatchId})`
                      : ""}{" "}
                    | {l("Date", "Tarih")} {selectedReverseSettlement.settlementDate || "-"} |{" "}
                    {l("Status", "Durum")} {selectedReverseSettlement.statusCurrent || "-"} |{" "}
                    {l("Counterparty", "Cari")}{" "}
                    {selectedReverseSettlement.counterpartyCodeCurrent ||
                      selectedReverseSettlement.counterpartyNameCurrent ||
                      selectedReverseSettlement.counterpartyId ||
                      "-"}
                  </p>
                  <p className="mt-1">
                    {selectedReverseSettlementContext.isCrossContext
                      ? l("Cross-context self-balancing", "Baglamlar arasi self-balancing")
                      : l("Same-context settlement", "Ayni baglam mahsuplastirmasi")}
                  </p>
                  <p className="mt-1">
                    {l("Collector context:", "Collector baglami:")}{" "}
                    {selectedReverseSettlementContext.collectorContextLabel}
                  </p>
                  <p className="mt-1">
                    {l("Owner context:", "Owner baglami:")}{" "}
                    {selectedReverseSettlementContext.ownerContextLabel}
                  </p>
                  {selectedReverseSettlementContext.originatingCrossContextSettlementBatchId ? (
                    <p className="mt-1">
                      {l("Originating cross-context batch:", "Kaynak baglamlar arasi batch:")} #
                      {selectedReverseSettlementContext.originatingCrossContextSettlementBatchId}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="md:col-span-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {l(
                "Settlement lookup needs permission: `cari.report.read`. You can still reverse by manual `settlementBatchId`.",
                "Mahsuplastirma aramasi icin `cari.report.read` yetkisi gerekir. Yine de manuel `settlementBatchId` ile ters kayit yapabilirsiniz."
              )}
            </div>
          )}

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("settlementBatchId", "settlementBatchId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={reverseForm.settlementBatchId}
              onChange={(event) =>
                setReverseForm((prev) => ({ ...prev, settlementBatchId: event.target.value }))
              }
              disabled={!canReverse || reverseSubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("reversalDate", "tersKayitTarihi")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={reverseForm.reversalDate}
              onChange={(event) =>
                setReverseForm((prev) => ({ ...prev, reversalDate: event.target.value }))
              }
              disabled={!canReverse || reverseSubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("reason", "neden")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={reverseForm.reason}
              onChange={(event) =>
                setReverseForm((prev) => ({ ...prev, reason: event.target.value }))
              }
              disabled={!canReverse || reverseSubmitting}
            />
          </label>
          <div className="md:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canReverse || reverseSubmitting}
            >
              {reverseSubmitting ? l("Reversing...", "Tersleniyor...") : l("Reverse Settlement", "Mahsuplastirmayi Tersle")}
            </button>
          </div>
        </form>
        {reverseResult ? (
          <>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">
                {reverseOriginalContext.isCrossContext
                  ? l("Original collection was cross-context", "Orijinal tahsilat baglamlar arasiydi")
                  : l("Original collection was same-context", "Orijinal tahsilat ayni baglamdaydi")}
              </p>
              <p className="mt-1">
                {l("Original collector -> owner:", "Orijinal collector -> owner:")}{" "}
                {reverseOriginalContext.collectorContextLabel} {"->"}{" "}
                {reverseOriginalContext.ownerContextLabel}
              </p>
              <p className="mt-1">
                {l("Reversal collector -> owner:", "Ters kayit collector -> owner:")}{" "}
                {reverseResultContext.collectorContextLabel} {"->"}{" "}
                {reverseResultContext.ownerContextLabel}
              </p>
              {reverseOriginalContext.originatingCrossContextSettlementBatchId ? (
                <p className="mt-1">
                  {l("Originating cross-context batch:", "Kaynak baglamlar arasi batch:")} #
                  {reverseOriginalContext.originatingCrossContextSettlementBatchId}
                </p>
              ) : null}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="font-semibold text-slate-600">reversal.ownerContext</dt>
              <dd>{reverseResultContext.ownerContextLabel}</dd>
              <dt className="font-semibold text-slate-600">reversal.collectorContext</dt>
              <dd>{reverseResultContext.collectorContextLabel}</dd>
              <dt className="font-semibold text-slate-600">reversal.isCrossContext</dt>
              <dd>{String(Boolean(reverseResultContext.isCrossContext))}</dd>
              <dt className="font-semibold text-slate-600">original.ownerContext</dt>
              <dd>{reverseOriginalContext.ownerContextLabel}</dd>
              <dt className="font-semibold text-slate-600">original.collectorContext</dt>
              <dd>{reverseOriginalContext.collectorContextLabel}</dd>
              <dt className="font-semibold text-slate-600">original.isCrossContext</dt>
              <dd>{String(Boolean(reverseOriginalContext.isCrossContext))}</dd>
            </dl>
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(reverseResult, null, 2)}
            </pre>
          </>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Bank Attach (explicit workflow)", "Banka Bagla (acik akis)")}
        </h2>
        {!canBankAttach ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {l("Missing permission: `cari.bank.attach`", "Eksik yetki: `cari.bank.attach`")}
          </div>
        ) : null}
        {bankAttachError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {bankAttachError}
          </div>
        ) : null}
        {bankAttachMessage ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {bankAttachMessage}
          </div>
        ) : null}
        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={onBankAttach}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("legalEntityId", "legalEntityId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.legalEntityId}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
              disabled={!canBankAttach || bankAttachSubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("targetType", "hedefTip")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.targetType}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, targetType: event.target.value }))
              }
              disabled={!canBankAttach || bankAttachSubmitting}
            >
              <option value="SETTLEMENT">SETTLEMENT</option>
              <option value="UNAPPLIED_CASH">UNAPPLIED_CASH</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("settlementBatchId", "settlementBatchId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.settlementBatchId}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, settlementBatchId: event.target.value }))
              }
              disabled={
                !canBankAttach ||
                bankAttachSubmitting ||
                String(bankAttachForm.targetType || "") === "UNAPPLIED_CASH"
              }
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("unappliedCashId", "unappliedCashId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.unappliedCashId}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, unappliedCashId: event.target.value }))
              }
              disabled={
                !canBankAttach ||
                bankAttachSubmitting ||
                String(bankAttachForm.targetType || "") === "SETTLEMENT"
              }
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("bankStatementLineId", "bankStatementLineId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.bankStatementLineId}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, bankStatementLineId: event.target.value }))
              }
              disabled={!canBankAttach || bankAttachSubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("bankTransactionRef", "bankTransactionRef")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.bankTransactionRef}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, bankTransactionRef: event.target.value }))
              }
              disabled={!canBankAttach || bankAttachSubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("note", "not")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankAttachForm.note}
              onChange={(event) =>
                setBankAttachForm((prev) => ({ ...prev, note: event.target.value }))
              }
              disabled={!canBankAttach || bankAttachSubmitting}
            />
          </label>
          <div className="md:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canBankAttach || bankAttachSubmitting}
            >
              {bankAttachSubmitting ? l("Attaching...", "Baglaniyor...") : l("Attach Bank Reference", "Banka Referansi Bagla")}
            </button>
          </div>
        </form>
        {bankAttachResult ? (
          <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(bankAttachResult, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Bank Apply (explicit workflow)", "Banka Uygula (acik akis)")}
        </h2>
        {!canBankApply ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {l("Missing permission: `cari.bank.apply`", "Eksik yetki: `cari.bank.apply`")}
          </div>
        ) : null}
        {bankApplyCariNotReady ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              {l("Setup incomplete (CARI posting)", "Kurulum eksik (CARI kaydi)")}
            </p>
            <p className="mt-1">
              {l("Bank apply is disabled for legalEntityId=", "Banka uygulama su legalEntityId icin kapali:")}
              {bankApplyLegalEntityId || "-"}.
            </p>
            {Array.isArray(bankApplyCariReadiness?.missingPurposeCodes) &&
            bankApplyCariReadiness.missingPurposeCodes.length > 0 ? (
              <p className="mt-1">
                {l("Missing purpose codes:", "Eksik amac kodlari:")}{" "}
                {bankApplyCariReadiness.missingPurposeCodes.join(", ")}
              </p>
            ) : null}
            {Array.isArray(bankApplyCariReadiness?.invalidMappings) &&
            bankApplyCariReadiness.invalidMappings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {bankApplyCariReadiness.invalidMappings.map((row, index) => (
                  <li key={`bank-apply-cari-invalid-${index}`}>
                    {String(row?.purposeCode || "-")}: {formatReadinessReason(row?.reason, l)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Fix manually", "Elle Duzelt")}
              </Link>
              <Link
                to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Use template", "Sablon Kullan")}
              </Link>
            </div>
          </div>
        ) : null}
        {bankApplyOuCurrentAccountSetupBlocked ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              {l(
                "Cross-context current-account setup still needs attention",
                "Capraz-context cari hesap kurulumu halen dikkat istiyor"
              )}
            </p>
            <p className="mt-1">
              {formatOperatingUnitCurrentAccountBlocker(
                bankApplyOuCurrentAccountReadiness,
                l
              )}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {l(
                "Bank settlement can still continue for same-context ownership, but branch/central and branch/branch balancing stays blocked until Organization Management current-account setup is fixed.",
                "Banka mahsuplastirmasi ayni context sahipliginde devam edebilir; ancak sube/merkez ve sube/sube denkleme Organizasyon Yonetimi altindaki cari hesap kurulumu duzeltilene kadar bloklu kalir."
              )}
            </p>
            <div className="mt-2">
              <Link
                to={OU_CURRENT_ACCOUNT_SETUP_PATH}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {l("Open Organization Management", "Organizasyon Yonetimini Ac")}
              </Link>
            </div>
          </div>
        ) : null}
        {bankApplyError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {bankApplyError}
          </div>
        ) : null}
        {bankApplyErrorHint ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {bankApplyErrorHint}
          </div>
        ) : null}
        {bankApplyMessage ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {bankApplyMessage}
          </div>
        ) : null}
        {bankApplyFollowUpRisks.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold">{l("Follow-up risks", "Takip riskleri")}</p>
            <ul className="mt-1 list-disc pl-5">
              {bankApplyFollowUpRisks.map((risk, index) => (
                <li key={`bank-apply-risk-${index}`}>{risk}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={onBankApply}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            legalEntityId
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.legalEntityId}
              onChange={(event) =>
                updateBankApplyForm("legalEntityId", event.target.value)
              }
              disabled={!canBankApply || bankApplySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            counterpartyId
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.counterpartyId}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, counterpartyId: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
              required
            />
          </label>
          {canReadCards ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
              <label className="block">
                {l("counterpartyLookup", "cariArama")}
                <Combobox
                  className="mt-1"
                  value={bankApplyForm.counterpartyId}
                  options={bankApplyCounterpartyLookupOptions}
                  loading={bankApplyCounterpartyLoading}
                  disabled={!canBankApply || bankApplySubmitting || !toPositiveInt(bankApplyForm.legalEntityId)}
                  placeholder={toPositiveInt(bankApplyForm.legalEntityId) ? l("Type code/name", "Kod/ad yazin") : l("Select legal entity first", "Once tuzel kisilik secin")}
                  noOptionsText={toPositiveInt(bankApplyForm.legalEntityId) ? l("No counterparties found.", "Cari bulunamadi.") : l("Set legalEntityId to load counterparties.", "Carileri yuklemek icin legalEntityId secin.")}
                  onInputChange={(nextValue, meta) => {
                    setBankApplyInlineCounterpartyError("");
                    setBankApplyInlineCounterpartyMessage("");
                    const reason = String(meta?.reason || "").trim().toLowerCase();
                    if (reason === "select" || reason === "clear") {
                      setBankApplyCounterpartyLookupQuery("");
                      return;
                    }
                    setBankApplyCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                  }}
                  onChange={(nextValue) =>
                    setBankApplyForm((prev) => ({
                      ...prev,
                      counterpartyId: nextValue ? String(nextValue) : "",
                    }))
                  }
                />
              </label>
              {canUpsertCards ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                  onClick={handleInlineCreateCounterpartyForBankApplyForm}
                  disabled={!canInlineCreateCounterpartyInBankApplyForm || bankApplyInlineCounterpartySaving || bankApplySubmitting}
                >
                  {bankApplyInlineCounterpartySaving
                    ? l("Creating counterparty...", "Cari olusturuluyor...")
                    : l(
                        `Create "${bankApplyInlineCounterpartyName || "new counterparty"}"`,
                        `"${bankApplyInlineCounterpartyName || "yeni cari"}" olustur`
                      )}
                </button>
              ) : null}
              {bankApplyInlineCounterpartyError ? (
                <p className="mt-1 text-[11px] normal-case text-rose-700">{bankApplyInlineCounterpartyError}</p>
              ) : null}
              {bankApplyInlineCounterpartyMessage ? (
                <p className="mt-1 text-[11px] normal-case text-emerald-700">{bankApplyInlineCounterpartyMessage}</p>
              ) : null}
            </div>
          ) : null}
          {!hasFixedRouteDirection ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("direction", "yon")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={bankApplyForm.direction}
                onChange={(event) =>
                  setBankApplyForm((prev) => ({ ...prev, direction: event.target.value }))
                }
                disabled={!canBankApply || bankApplySubmitting}
              >
                <option value="">{l("Select", "Secin")}</option>
                <option value="AR">AR</option>
                <option value="AP">AP</option>
              </select>
            </label>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("settlementDate", "mahsuplastirmaTarihi")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.settlementDate}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, settlementDate: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("currencyCode", "paraBirimi")}
            <input
              type="text"
              maxLength={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
              value={bankApplyForm.currencyCode}
              onChange={(event) =>
                updateBankApplyForm("currencyCode", event.target.value)
              }
              disabled={!canBankApply || bankApplySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("incomingAmountTxn", "gelenTutarTxn")}
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.incomingAmountTxn}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, incomingAmountTxn: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("bankStatementLineId", "bankStatementLineId")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.bankStatementLineId}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, bankStatementLineId: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("bankTransactionRef", "bankTransactionRef")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.bankTransactionRef}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, bankTransactionRef: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(bankApplyForm.autoAllocate)}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, autoAllocate: event.target.checked }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
            {l("autoAllocate", "otomatikDagit")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(bankApplyForm.useUnappliedCash)}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, useUnappliedCash: event.target.checked }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
            {l("useUnappliedCash", "kullanilmayanNakdiKullan")}
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-4">
            {l("allocations JSON (required if autoAllocate=false)", "allocations JSON (autoAllocate=false ise zorunlu)")}
            <textarea
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal font-mono"
              value={bankApplyForm.allocationsJson}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, allocationsJson: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting || bankApplyForm.autoAllocate}
              placeholder='[{"openItemId":123,"amountTxn":100.5}]'
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("bankApplyIdempotencyKey", "bankApplyIdempotencyKey")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.bankApplyIdempotencyKey}
              onChange={(event) =>
                setBankApplyForm((prev) => ({
                  ...prev,
                  bankApplyIdempotencyKey: event.target.value,
                }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("note", "not")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={bankApplyForm.note}
              onChange={(event) =>
                setBankApplyForm((prev) => ({ ...prev, note: event.target.value }))
              }
              disabled={!canBankApply || bankApplySubmitting}
            />
          </label>
          <div className="md:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canBankApply || bankApplySubmitting || bankApplyCariNotReady}
            >
              {bankApplySubmitting ? l("Applying...", "Uygulaniyor...") : l("Apply Bank Settlement", "Banka Mahsuplastirmasini Uygula")}
            </button>
          </div>
        </form>
        {bankApplyResult ? (
          <>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">
                {bankApplyResultContext.isCrossContext
                  ? l("Cross-context self-balancing", "Baglamlar arasi self-balancing")
                  : l("Same-context settlement", "Ayni baglam mahsuplastirmasi")}
              </p>
              <p className="mt-1">
                {l("Collector context:", "Collector baglami:")}{" "}
                {bankApplyResultContext.collectorContextLabel}
              </p>
              <p className="mt-1">
                {l("Owner context:", "Owner baglami:")} {bankApplyResultContext.ownerContextLabel}
              </p>
              {bankApplyResultContext.originatingCrossContextSettlementBatchId ? (
                <p className="mt-1">
                  {l("Originating cross-context batch:", "Kaynak baglamlar arasi batch:")} #
                  {bankApplyResultContext.originatingCrossContextSettlementBatchId}
                </p>
              ) : null}
            </div>
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(bankApplyResult, null, 2)}
            </pre>
          </>
        ) : null}
      </section>
    </div>
  );
}
