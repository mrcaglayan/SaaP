import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  applyOperatingUnitCurrentAccountConfig,
  autoProvisionShareholderSubAccounts,
  createShareholderCapitalFulfillment,
  createShareholderCommitmentBatchJournal,
  generateFiscalPeriods,
  listCountries,
  listCurrencies,
  listFiscalCalendars,
  listFiscalPeriods,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnitCurrentAccountConfigs,
  listOperatingUnitPartnerCurrentAccounts,
  listOperatingUnits,
  listShareholderCapitalFulfillments,
  listShareholderJournalConfigs,
  listShareholders,
  previewShareholderCapitalFulfillment,
  previewShareholderCommitmentBatchJournal,
  reverseShareholderCapitalFulfillment,
  upsertFiscalCalendar,
  upsertGroupCompany,
  upsertLegalEntity,
  upsertOperatingUnitCurrentAccountConfig,
  upsertOperatingUnitPartnerCurrentAccount,
  upsertOperatingUnit,
  upsertShareholderJournalConfig,
  upsertShareholder,
} from "../../api/orgAdmin.js";
import {
  createBankAccount,
  listBankAccounts,
  provisionBankAccountControlParentChild,
} from "../../api/bankAccounts.js";
import { listCashRegisters, listCashSessions } from "../../api/cashAdmin.js";
import { listAccounts, listBooks, listCoas } from "../../api/glAdmin.js";
import { listPolicyPacks } from "../../api/policyPacks.js";
import { useAuth } from "../../auth/useAuth.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { useI18n } from "../../i18n/useI18n.js";
import { formatOperatingUnitCurrentAccountBlocker } from "../../readiness/ouCurrentAccountReadiness.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";
import {
  buildRankedOperatingUnitCurrentAccountOptions,
  formatAccountOptionLabel,
  formatRankedOperatingUnitCurrentAccountOptionLabel,
  summarizeOperatingUnitCurrentAccountConfigDrift,
} from "./orgCurrentAccountHelpers.js";

const UNIT_TYPES = ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"];
const LEGAL_ENTITY_STATUSES = ["ACTIVE", "INACTIVE"];
const SHAREHOLDER_TYPES = ["INDIVIDUAL", "CORPORATE"];
const SHAREHOLDER_STATUSES = ["ACTIVE", "INACTIVE"];
const SHAREHOLDER_BATCH_QUEUE_STORAGE_KEY =
  "org.shareholderCommitmentBatchQueueByEntity.v1";
const DEFAULT_ENTITY_FORM = {
  groupCompanyId: "",
  code: "",
  name: "",
  taxId: "",
  countryId: "",
  functionalCurrencyCode: "USD",
  status: "INACTIVE",
  isIntercompanyEnabled: true,
  intercompanyPartnerRequired: false,
  autoProvisionDefaults: true,
  policyPackId: "",
  useCustomPaymentTerms: false,
  paymentTermsJson: "",
};
const DEFAULT_UNIT_FORM = {
  legalEntityId: "",
  code: "",
  name: "",
  unitType: "BRANCH",
  hasSubledger: false,
  centralDueFromAccountId: "",
  centralDueToAccountId: "",
  ouDueFromCentralAccountId: "",
  ouDueToCentralAccountId: "",
};
const DEFAULT_OPERATING_UNIT_CURRENT_ACCOUNT_CONFIG_FORM = {
  legalEntityId: "",
  dueFromParentAccountId: "",
  dueToParentAccountId: "",
  autoProvisionOnOperatingUnitCreate: true,
};
const DEFAULT_UNIT_PARTNER_CURRENT_FORM = {
  legalEntityId: "",
  operatingUnitId: "",
  partnerOperatingUnitId: "",
  dueFromAccountId: "",
  dueToAccountId: "",
};
const DEFAULT_CAPITAL_FULFILLMENT_FORM = {
  legalEntityId: "",
  shareholderId: "",
  contributionDate: new Date().toISOString().slice(0, 10),
  amount: "",
  destinationMode: "BANK_ACCOUNT",
  bankAccountId: "",
  cashRegisterId: "",
  cashSessionId: "",
  destinationAccountId: "",
  operatingUnitId: "",
  note: "",
};
const DEFAULT_CAPITAL_FULFILLMENT_BANK_FORM = {
  code: "",
  name: "",
  currencyCode: "",
  glAccountId: "",
  bankName: "",
  branchName: "",
  iban: "",
  accountNo: "",
  isActive: true,
  autoProvisionControlParent: true,
  glAccountName: "",
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function formatAmount(value) {
  return normalizeAmount(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOperatingUnitLabel(unit) {
  const code = String(unit?.code || "").trim();
  const name = String(unit?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || "-";
}

function getLegalEntityStatusLabel(status, l) {
  return normalizeUpperText(status) === "INACTIVE"
    ? l("Inactive", "Pasif")
    : l("Active", "Aktif");
}

function formatTimestampLabel(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatOperatingUnitCurrentAccountApplySummary(l, summary, warningCountOverride = null) {
  if (!summary) {
    return "";
  }
  const childAccountCount = Array.isArray(summary.createdAccounts)
    ? summary.createdAccounts.length
    : 0;
  const mappingCount =
    (Array.isArray(summary.updatedOperatingUnits) ? summary.updatedOperatingUnits.length : 0) +
    (Array.isArray(summary.updatedPartnerMappings) ? summary.updatedPartnerMappings.length : 0);
  const reusedCount = Array.isArray(summary.reusedAccounts) ? summary.reusedAccounts.length : 0;
  const warningCount =
    warningCountOverride === null
      ? Array.isArray(summary.warnings)
        ? summary.warnings.length
        : 0
      : Number(warningCountOverride) || 0;

  return l(
    `Current-account delta: child accounts created ${childAccountCount}, mappings created ${mappingCount}, reused rows ${reusedCount}, warnings ${warningCount}.`,
    `Cari hesap deltasi: olusturulan alt hesap ${childAccountCount}, olusturulan esleme ${mappingCount}, yeniden kullanilan satir ${reusedCount}, uyari ${warningCount}.`
  );
}

function formatOperatingUnitCreateProvisioningMessage(l, provisioning) {
  if (!provisioning) {
    return "";
  }
  const warnings = Array.isArray(provisioning.warnings) ? provisioning.warnings : [];
  if (provisioning.summary) {
    return formatOperatingUnitCurrentAccountApplySummary(
      l,
      provisioning.summary,
      warnings.length
    );
  }
  if (provisioning.status === "skipped_missing_config") {
    return l(
      "Saved current-account config is missing, so branch delta auto-provision was skipped. Save the config in OU Current-Account Config and rerun apply.",
      "Kaydedilmis cari hesap konfigurasyonu eksik oldugu icin sube deltasi otomatik provision atlandi. OU Cari Hesap Konfigurasyonu bolumunde konfigurasyonu kaydedip yeniden uygulayin."
    );
  }
  if (provisioning.status === "skipped_auto_provision_disabled") {
    return l(
      "Saved current-account config exists, but auto-provision on branch create is disabled. Use the apply actions when you are ready.",
      "Kaydedilmis cari hesap konfigurasyonu var, ancak sube olusturmada otomatik provision kapali. Hazir oldugunuzda uygula islemlerini kullanin."
    );
  }
  if (provisioning.status === "warning") {
    return l(
      "Branch saved, but current-account delta auto-provision needs attention. Use the saved-config apply action to rerun repair-missing-only.",
      "Sube kaydedildi, ancak cari hesap delta otomatik provision dikkat gerektiriyor. Sadece eksikleri onar modunda yeniden calistirmak icin kaydedilen konfigurasyonu uygula islemini kullanin."
    );
  }
  return "";
}

function buildOperatingUnitCurrentAccountConfigForm(legalEntityId, row = null) {
  return {
    ...DEFAULT_OPERATING_UNIT_CURRENT_ACCOUNT_CONFIG_FORM,
    legalEntityId: String(row?.legal_entity_id || legalEntityId || ""),
    dueFromParentAccountId: String(row?.due_from_parent_account_id || ""),
    dueToParentAccountId: String(row?.due_to_parent_account_id || ""),
    autoProvisionOnOperatingUnitCreate:
      row?.auto_provision_on_operating_unit_create === undefined ||
      row?.auto_provision_on_operating_unit_create === null
        ? true
        : Boolean(row?.auto_provision_on_operating_unit_create),
  };
}

function formatBankAccountOptionLabel(account) {
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  const glCode = String(account?.gl_account_code || "").trim();
  const glName = String(account?.gl_account_name || "").trim();
  const ouCode = String(account?.operating_unit_code || "").trim();
  const parts = [];
  if (code || name) {
    parts.push([code, name].filter(Boolean).join(" - "));
  }
  if (glCode || glName) {
    parts.push([glCode, glName].filter(Boolean).join(" - "));
  }
  if (ouCode) {
    parts.push(`OU ${ouCode}`);
  } else {
    parts.push("Central");
  }
  return parts.filter(Boolean).join(" | ") || "-";
}

function formatCashRegisterOptionLabel(register, l = (en) => en) {
  const code = String(register?.code || "").trim();
  const name = String(register?.name || "").trim();
  const currencyCode = String(register?.currency_code || "").trim().toUpperCase();
  const sessionMode = String(register?.session_mode || "").trim().toUpperCase();
  const explicitOwnershipContext = String(register?.ownership_context_label || "").trim();
  const ownershipContext = explicitOwnershipContext
    ? explicitOwnershipContext === "Central / HQ" ||
      explicitOwnershipContext === "Merkez / HQ" ||
      explicitOwnershipContext === "Central" ||
      explicitOwnershipContext === "Merkez"
      ? l("Central", "Merkez")
      : explicitOwnershipContext.startsWith("OU:")
        ? explicitOwnershipContext
        : register?.operating_unit_code
          ? `OU: ${register.operating_unit_code}`
          : explicitOwnershipContext
    : register?.operating_unit_code
      ? `OU: ${register.operating_unit_code}`
      : l("Central", "Merkez");
  const parts = [];
  if (code || name) {
    parts.push([code, name].filter(Boolean).join(" - "));
  }
  if (currencyCode) {
    parts.push(currencyCode);
  }
  if (sessionMode) {
    parts.push(`session=${sessionMode}`);
  }
  parts.push(ownershipContext);
  return parts.filter(Boolean).join(" | ") || "-";
}

function formatCashSessionOptionLabel(session, l = (en) => en) {
  const sessionId = toNumber(session?.id);
  const registerCode = String(session?.cash_register_code || "").trim();
  const explicitOwnershipContext = String(session?.ownership_context_label || "").trim();
  const ownershipContext = explicitOwnershipContext
    ? explicitOwnershipContext === "Central / HQ" ||
      explicitOwnershipContext === "Merkez / HQ" ||
      explicitOwnershipContext === "Central" ||
      explicitOwnershipContext === "Merkez"
      ? l("Central", "Merkez")
      : explicitOwnershipContext.startsWith("OU:")
        ? explicitOwnershipContext
        : session?.operating_unit_code
          ? `OU: ${session.operating_unit_code}`
          : explicitOwnershipContext
    : session?.operating_unit_code
      ? `OU: ${session.operating_unit_code}`
      : l("Central", "Merkez");
  const openedAt = String(session?.opened_at || "").trim();
  return [`#${sessionId || "-"}`, registerCode, ownershipContext, openedAt]
    .filter(Boolean)
    .join(" | ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildCapitalFulfillmentBankForm(defaultCurrencyCode = "") {
  return {
    ...DEFAULT_CAPITAL_FULFILLMENT_BANK_FORM,
    currencyCode: String(defaultCurrencyCode || "").trim().toUpperCase(),
  };
}

function generateProvisionIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `org-capital-fulfillment-bank-control-parent-${globalThis.crypto.randomUUID()}`;
  }
  return `org-capital-fulfillment-bank-control-parent-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function buildCapitalFulfillmentTransitShortcutPath(shortcut) {
  const params = new URLSearchParams();
  params.set("prefillMode", "capitalFulfillmentTransit");
  params.set("txnType", "TRANSFER_OUT");

  const sourceRegisterId = toNumber(shortcut?.sourceRegisterId);
  const targetRegisterId = toNumber(shortcut?.targetRegisterId);
  const amountBase = normalizeAmount(shortcut?.amountBase);
  const currencyCode = String(shortcut?.currencyCode || "").trim().toUpperCase();
  const referenceNo = String(shortcut?.referenceNo || "").trim();
  const description = String(shortcut?.description || "").trim();
  const fulfillmentId = toNumber(shortcut?.fulfillmentId);
  const bookDate = String(shortcut?.bookDate || "").trim();
  const sourceRegisterCode = String(shortcut?.sourceRegisterCode || "").trim();
  const targetRegisterCode = String(shortcut?.targetRegisterCode || "").trim();

  if (sourceRegisterId) {
    params.set("registerId", String(sourceRegisterId));
  }
  if (targetRegisterId) {
    params.set("counterCashRegisterId", String(targetRegisterId));
  }
  if (amountBase > 0) {
    params.set("amount", String(amountBase));
  }
  if (currencyCode) {
    params.set("currencyCode", currencyCode);
  }
  if (referenceNo) {
    params.set("referenceNo", referenceNo);
  }
  if (description) {
    params.set("description", description);
  }
  if (bookDate) {
    params.set("bookDate", bookDate);
  }
  if (fulfillmentId) {
    params.set("fulfillmentId", String(fulfillmentId));
  }
  if (sourceRegisterCode) {
    params.set("sourceRegisterCode", sourceRegisterCode);
  }
  if (targetRegisterCode) {
    params.set("targetRegisterCode", targetRegisterCode);
  }
  params.set("sourceDocType", "OTHER");

  return `/app/kasa-islemleri?${params.toString()}`;
}

function formatCapitalFulfillmentDestination(row) {
  const mode = String(row?.destination_mode || "").trim().toUpperCase();
  if (mode === "BANK_ACCOUNT") {
    const code = String(row?.bank_account_code || "").trim();
    const name = String(row?.bank_account_name || "").trim();
    return [code, name].filter(Boolean).join(" - ") || "-";
  }
  if (mode === "CASH_REGISTER") {
    const code = String(row?.cash_register_code || "").trim();
    const name = String(row?.cash_register_name || "").trim();
    return [code, name].filter(Boolean).join(" - ") || "-";
  }
  const code = String(row?.destination_account_code || "").trim();
  const name = String(row?.destination_account_name || "").trim();
  return [code, name].filter(Boolean).join(" - ") || "-";
}

function getAccountNormalSide(account) {
  return String(account?.normal_side || "").trim().toUpperCase();
}

function isPostingEnabled(account) {
  return !(
    account?.allow_posting === false ||
    account?.allow_posting === 0 ||
    account?.allow_posting === "0"
  );
}

function isDescendantAccount(accountId, parentAccountId, parentById) {
  const normalizedAccountId = toNumber(accountId);
  const normalizedParentAccountId = toNumber(parentAccountId);
  if (!normalizedAccountId || !normalizedParentAccountId) {
    return false;
  }

  const visited = new Set();
  let currentParentId = toNumber(parentById.get(normalizedAccountId));
  while (currentParentId) {
    if (currentParentId === normalizedParentAccountId) {
      return true;
    }
    if (visited.has(currentParentId)) {
      break;
    }
    visited.add(currentParentId);
    currentParentId = toNumber(parentById.get(currentParentId));
  }
  return false;
}

function getShareholderTypeLabel(value, l) {
  switch (String(value || "").toUpperCase()) {
    case "INDIVIDUAL":
      return l("Individual", "Bireysel");
    case "CORPORATE":
      return l("Corporate", "Kurumsal");
    default:
      return value || "-";
  }
}

function getShareholderStatusLabel(value, l) {
  switch (String(value || "").toUpperCase()) {
    case "ACTIVE":
      return l("Active", "Aktif");
    case "INACTIVE":
      return l("Inactive", "Pasif");
    default:
      return value || "-";
  }
}

function formatShareholderReadinessReason(reason, l) {
  switch (String(reason || "").trim().toUpperCase()) {
    case "ACCOUNT_NOT_FOUND":
      return l("Mapped account no longer exists.", "Eslenen hesap artik mevcut degil.");
    case "ACCOUNT_INACTIVE":
      return l("Mapped account is inactive.", "Eslenen hesap aktif degil.");
    case "ACCOUNT_TYPE_NOT_EQUITY":
      return l("Mapped account must be EQUITY.", "Eslenen hesap EQUITY olmalidir.");
    case "ACCOUNT_MUST_BE_NON_POSTABLE":
      return l(
        "Mapped account must be non-postable parent.",
        "Eslenen hesap post edilemeyen parent olmali."
      );
    case "ACCOUNT_NORMAL_SIDE_MISMATCH":
      return l(
        "Mapped account has invalid normal side.",
        "Eslenen hesap normal bakiye yonu gecersiz."
      );
    case "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS":
      return l(
        "Shareholder parent purposes must map to different accounts.",
        "Ortak parent amaclari farkli hesaplara eslenmeli."
      );
    case "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY":
      return l(
        "Mapped account is not in a legal-entity chart.",
        "Eslenen hesap legal entity hesap planinda degil."
      );
    case "ACCOUNT_LEGAL_ENTITY_MISMATCH":
      return l(
        "Mapped account belongs to a different legal entity.",
        "Eslenen hesap farkli bir legal entity'e ait."
      );
    case "MAPPED_ACCOUNT_ID_INVALID":
      return l("Mapped account id is invalid.", "Eslenen hesap id gecersiz.");
    case "ACCOUNT_TENANT_MISMATCH":
      return l("Mapped account belongs to another tenant.", "Eslenen hesap baska tenant'a ait.");
    default:
      return String(reason || "-");
  }
}

/**
 * Maintains the organization-management surface and, when requested via
 * `workspaceMode="activation"`, narrows the experience to one local
 * legal-entity activation workspace instead of the full tenant structure UI.
 */
export default function OrganizationManagementPage({ workspaceMode = "full" }) {
  const { hasPermission } = useAuth();
  const { loadingBase, preferencesHydrated, refreshLookups, workingContext } =
    useWorkingContext();
  const { language } = useI18n();
  const { getModuleRow, refreshLegalEntity } = useModuleReadiness();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canRunTenantSetup = hasPermission("onboarding.company.setup");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadFiscalCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadCoas = hasPermission("gl.coa.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertGroupCompany = hasPermission("org.group_company.upsert");
  const canUpsertLegalEntity = hasPermission("org.legal_entity.upsert");
  const canUpsertOperatingUnit = hasPermission("org.operating_unit.upsert");
  const canReadShareholders = hasPermission("org.tree.read");
  const canUpsertShareholder = hasPermission("org.shareholder.upsert");
  const canManageShareholderCapitalFulfillment = hasPermission(
    "org.shareholder.capital_fulfillment.upsert"
  );
  const canUpsertAccounts = hasPermission("gl.account.upsert");
  const canUpsertFiscalCalendar = hasPermission("org.fiscal_calendar.upsert");
  const canGenerateFiscalPeriods = hasPermission("org.fiscal_period.generate");
  const canReadBanks = hasPermission("bank.accounts.read");
  const canWriteBanks = hasPermission("bank.accounts.write");
  const canReadCashRegisters = hasPermission("cash.register.read");
  const canReadCashSessions = canReadCashRegisters;
  const isScopedCapitalFulfillmentOperator = Boolean(
    canManageShareholderCapitalFulfillment &&
      !canRunTenantSetup &&
      !canUpsertShareholder &&
      !canUpsertAccounts &&
      !canUpsertGroupCompany &&
      !canUpsertLegalEntity &&
      !canUpsertOperatingUnit &&
      !canUpsertFiscalCalendar &&
      !canGenerateFiscalPeriods
  );
  const isActivationWorkspace = workspaceMode === "activation";
  const isScopedActivationWorkspace = Boolean(
    isActivationWorkspace && !canRunTenantSetup
  );
  const showTenantReadinessChecklist =
    !isActivationWorkspace && !isScopedCapitalFulfillmentOperator;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareholderJournalModal, setShareholderJournalModal] = useState(null);
  const [shareholderCardExpanded, setShareholderCardExpanded] = useState(false);
  const [autoSubAccountSetupModalOpen, setAutoSubAccountSetupModalOpen] =
    useState(false);
  const [autoSubAccountSetupSaving, setAutoSubAccountSetupSaving] =
    useState(false);
  const [
    commitmentBatchQueueByEntity,
    setCommitmentBatchQueueByEntity,
  ] = useState({});
  const [batchCommitmentModalOpen, setBatchCommitmentModalOpen] =
    useState(false);
  const [batchCommitmentSaving, setBatchCommitmentSaving] = useState(false);
  const [commitmentIncreaseModalOpen, setCommitmentIncreaseModalOpen] =
    useState(false);
  const [commitmentIncreaseForm, setCommitmentIncreaseForm] = useState({
    shareholderId: "",
    commitmentDate: new Date().toISOString().slice(0, 10),
    increaseAmount: "0",
  });
  const [capitalFulfillmentModalOpen, setCapitalFulfillmentModalOpen] =
    useState(false);
  const [capitalFulfillmentForm, setCapitalFulfillmentForm] = useState(
    DEFAULT_CAPITAL_FULFILLMENT_FORM
  );
  const [capitalFulfillmentPreview, setCapitalFulfillmentPreview] =
    useState(null);
  const [capitalFulfillmentPreviewLoading, setCapitalFulfillmentPreviewLoading] =
    useState(false);
  const [capitalFulfillmentSaving, setCapitalFulfillmentSaving] =
    useState(false);
  const [capitalFulfillmentBankAccounts, setCapitalFulfillmentBankAccounts] =
    useState([]);
  const [capitalFulfillmentBankLoading, setCapitalFulfillmentBankLoading] =
    useState(false);
  const [capitalFulfillmentBankError, setCapitalFulfillmentBankError] =
    useState("");
  const [capitalFulfillmentCreateBankModalOpen, setCapitalFulfillmentCreateBankModalOpen] =
    useState(false);
  const [capitalFulfillmentCreateBankForm, setCapitalFulfillmentCreateBankForm] =
    useState(() => buildCapitalFulfillmentBankForm());
  const [capitalFulfillmentCreateBankSaving, setCapitalFulfillmentCreateBankSaving] =
    useState(false);
  const [capitalFulfillmentCreateBankError, setCapitalFulfillmentCreateBankError] =
    useState("");
  const [capitalFulfillmentCashRegisters, setCapitalFulfillmentCashRegisters] =
    useState([]);
  const [capitalFulfillmentCashRegistersLoading, setCapitalFulfillmentCashRegistersLoading] =
    useState(false);
  const [capitalFulfillmentCashRegistersError, setCapitalFulfillmentCashRegistersError] =
    useState("");
  const [capitalFulfillmentOpenCashSessions, setCapitalFulfillmentOpenCashSessions] =
    useState([]);
  const [capitalFulfillmentCashSessionsLoading, setCapitalFulfillmentCashSessionsLoading] =
    useState(false);
  const [capitalFulfillmentCashSessionsError, setCapitalFulfillmentCashSessionsError] =
    useState("");
  const [capitalFulfillmentHistory, setCapitalFulfillmentHistory] = useState([]);
  const [capitalFulfillmentHistoryLoading, setCapitalFulfillmentHistoryLoading] =
    useState(false);
  const [capitalFulfillmentHistoryError, setCapitalFulfillmentHistoryError] =
    useState("");
  const [capitalFulfillmentReversingId, setCapitalFulfillmentReversingId] =
    useState(null);
  const [batchCommitmentDate, setBatchCommitmentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);
  const [batchPreviewData, setBatchPreviewData] = useState(null);

  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [books, setBooks] = useState([]);
  const [coas, setCoas] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [operatingUnitCurrentAccountConfigs, setOperatingUnitCurrentAccountConfigs] =
    useState([]);
  const [operatingUnitPartnerCurrentAccounts, setOperatingUnitPartnerCurrentAccounts] =
    useState([]);
  const [shareholders, setShareholders] = useState([]);
  const [shareholderJournalConfigs, setShareholderJournalConfigs] = useState(
    []
  );
  const [policyPacks, setPolicyPacks] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [activationBankAccounts, setActivationBankAccounts] = useState([]);
  const [activationBankAccountsLoading, setActivationBankAccountsLoading] =
    useState(false);
  const [activationBankAccountsError, setActivationBankAccountsError] =
    useState("");
  const [activationCashRegisters, setActivationCashRegisters] = useState([]);
  const [activationCashRegistersLoading, setActivationCashRegistersLoading] =
    useState(false);
  const [activationCashRegistersError, setActivationCashRegistersError] =
    useState("");
  const [showAllPolicyPackOptions, setShowAllPolicyPackOptions] = useState(false);

  const [groupForm, setGroupForm] = useState({ code: "", name: "" });
  const [groupEditingCode, setGroupEditingCode] = useState("");
  const [legalEntityEditingCode, setLegalEntityEditingCode] = useState("");
  const [unitEditingKey, setUnitEditingKey] = useState("");
  const [unitPartnerCurrentEditingKey, setUnitPartnerCurrentEditingKey] = useState("");
  const [entityForm, setEntityForm] = useState(DEFAULT_ENTITY_FORM);
  const [unitForm, setUnitForm] = useState(DEFAULT_UNIT_FORM);
  const [operatingUnitCurrentAccountConfigForm, setOperatingUnitCurrentAccountConfigForm] =
    useState(DEFAULT_OPERATING_UNIT_CURRENT_ACCOUNT_CONFIG_FORM);
  const [unitPartnerCurrentForm, setUnitPartnerCurrentForm] = useState(
    DEFAULT_UNIT_PARTNER_CURRENT_FORM
  );
  const [shareholderForm, setShareholderForm] = useState({
    legalEntityId: "",
    code: "",
    name: "",
    shareholderType: "INDIVIDUAL",
    taxId: "",
    commitmentDate: new Date().toISOString().slice(0, 10),
    committedCapital: "0",
    capitalSubAccountId: "",
    commitmentDebitSubAccountId: "",
    currencyCode: "",
    status: "ACTIVE",
    notes: "",
  });
  const [shareholderParentConfigForm, setShareholderParentConfigForm] =
    useState({
      capitalCreditParentAccountId: "",
      commitmentDebitParentAccountId: "",
    });
  const [calendarForm, setCalendarForm] = useState({
    code: "",
    name: "",
    yearStartMonth: 1,
    yearStartDay: 1,
  });
  const [periodForm, setPeriodForm] = useState({
    calendarId: "",
    fiscalYear: new Date().getUTCFullYear(),
  });

  async function loadCoreData() {
    if (!canReadOrgTree && !canReadFiscalCalendars) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (canReadOrgTree) {
        const [
          groupsRes,
          countriesRes,
          currenciesRes,
          booksRes,
          coasRes,
          accountsRes,
          policyPacksRes,
          entitiesRes,
          unitsRes,
          operatingUnitCurrentAccountConfigsRes,
          unitPartnerAccountsRes,
          shareholdersRes,
          shareholderConfigsRes,
        ] =
          await Promise.all([
            listGroupCompanies(),
            listCountries(),
            listCurrencies(),
            canReadBooks ? listBooks() : Promise.resolve({ rows: [] }),
            canReadCoas ? listCoas() : Promise.resolve({ rows: [] }),
            canReadAccounts
              ? listAccounts({ includeInactive: true })
              : Promise.resolve({ rows: [] }),
            listPolicyPacks(),
            listLegalEntities(),
            listOperatingUnits(),
            listOperatingUnitCurrentAccountConfigs(),
            listOperatingUnitPartnerCurrentAccounts(),
            canReadShareholders
              ? listShareholders()
              : Promise.resolve({ rows: [] }),
            canReadShareholders
              ? listShareholderJournalConfigs()
              : Promise.resolve({ rows: [] }),
          ]);

        const groupRows = groupsRes?.rows || [];
        const countryRows = countriesRes?.rows || [];
        const currencyRows = currenciesRes?.rows || [];
        const bookRows = booksRes?.rows || [];
        const coaRows = coasRes?.rows || [];
        const accountRows = accountsRes?.rows || [];
        const policyPackRows = policyPacksRes?.rows || [];
        const entityRows = entitiesRes?.rows || [];
        const unitRows = unitsRes?.rows || [];
        const operatingUnitCurrentAccountConfigRows =
          operatingUnitCurrentAccountConfigsRes?.rows || [];
        const unitPartnerAccountRows = unitPartnerAccountsRes?.rows || [];
        const shareholderRows = shareholdersRes?.rows || [];
        const shareholderConfigRows = shareholderConfigsRes?.rows || [];

        setGroups(groupRows);
        setCountries(countryRows);
        setCurrencies(currencyRows);
        setBooks(bookRows);
        setCoas(coaRows);
        setAccounts(accountRows);
        setPolicyPacks(policyPackRows);
        setLegalEntities(entityRows);
        setOperatingUnits(unitRows);
        setOperatingUnitCurrentAccountConfigs(operatingUnitCurrentAccountConfigRows);
        setOperatingUnitPartnerCurrentAccounts(unitPartnerAccountRows);
        setShareholders(shareholderRows);
        setShareholderJournalConfigs(shareholderConfigRows);

        setEntityForm((prev) => {
          const nextCountryId =
            prev.countryId || String(countryRows[0]?.id || "");
          const selectedCountry = countryRows.find(
            (row) => String(row.id) === String(nextCountryId)
          );
          const countryDefaultCurrency = String(
            selectedCountry?.default_currency_code || ""
          ).toUpperCase();
          const policyPacksByCountry = new Map();
          for (const row of policyPackRows) {
            const countryIso2 = normalizeUpperText(row?.countryIso2);
            if (!countryIso2) {
              continue;
            }
            if (!policyPacksByCountry.has(countryIso2)) {
              policyPacksByCountry.set(countryIso2, []);
            }
            policyPacksByCountry.get(countryIso2).push(row);
          }
          const recommendedPolicyPackId = String(
            (
              policyPacksByCountry.get(normalizeUpperText(selectedCountry?.iso2)) || []
            )[0]?.packId || ""
          ).trim();

          return {
            ...prev,
            groupCompanyId:
              prev.groupCompanyId || String(groupRows[0]?.id || ""),
            countryId: nextCountryId,
            functionalCurrencyCode:
              prev.functionalCurrencyCode || countryDefaultCurrency || "USD",
            policyPackId: prev.policyPackId || recommendedPolicyPackId,
          };
        });
        setUnitForm((prev) => ({
          ...prev,
          legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
        }));
        setOperatingUnitCurrentAccountConfigForm((prev) => {
          const nextLegalEntityId =
            prev.legalEntityId || String(entityRows[0]?.id || "");
          const selectedConfig =
            operatingUnitCurrentAccountConfigRows.find(
              (row) => String(row?.legal_entity_id || "") === String(nextLegalEntityId)
            ) || null;
          return buildOperatingUnitCurrentAccountConfigForm(
            nextLegalEntityId,
            selectedConfig
          );
        });
        setShareholderForm((prev) => {
          const nextLegalEntityId =
            prev.legalEntityId || String(entityRows[0]?.id || "");
          const selectedEntity = entityRows.find(
            (row) => String(row.id) === String(nextLegalEntityId)
          );
          const legalEntityCurrency = String(
            selectedEntity?.functional_currency_code || ""
          ).toUpperCase();
          return {
            ...prev,
            legalEntityId: nextLegalEntityId,
            currencyCode: legalEntityCurrency || prev.currencyCode || "USD",
          };
        });
      }

      if (canReadFiscalCalendars) {
        const calendarsRes = await listFiscalCalendars();
        const calendarRows = calendarsRes?.rows || [];
        setCalendars(calendarRows);
        setPeriodForm((prev) => ({
          ...prev,
          calendarId: prev.calendarId || String(calendarRows[0]?.id || ""),
        }));
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load organization data.", "Organizasyon verileri yuklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriods(calendarId, fiscalYear) {
    if (!canReadFiscalPeriods || !calendarId) {
      setPeriods([]);
      return;
    }

    try {
      const response = await listFiscalPeriods(calendarId, {
        fiscalYear: fiscalYear || undefined,
      });
      setPeriods(response?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi."));
    }
  }

  async function loadCapitalFulfillmentHistory(legalEntityId) {
    if (!canReadShareholders || !legalEntityId) {
      setCapitalFulfillmentHistory([]);
      setCapitalFulfillmentHistoryError("");
      return;
    }

    setCapitalFulfillmentHistoryLoading(true);
    setCapitalFulfillmentHistoryError("");
    try {
      const response = await listShareholderCapitalFulfillments({
        legalEntityId,
      });
      setCapitalFulfillmentHistory(response?.rows || []);
    } catch (err) {
      setCapitalFulfillmentHistory([]);
      setCapitalFulfillmentHistoryError(
        err?.response?.data?.message ||
        l(
          "Failed to load capital fulfillment history.",
          "Sermaye karsilama gecmisi yuklenemedi."
        )
      );
    } finally {
      setCapitalFulfillmentHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadCoreData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canReadOrgTree,
    canReadFiscalCalendars,
    canReadShareholders,
    canReadAccounts,
    canReadBooks,
    canReadCoas,
  ]);

  useEffect(() => {
    loadPeriods(periodForm.calendarId, periodForm.fiscalYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodForm.calendarId, periodForm.fiscalYear, canReadFiscalPeriods]);

  const countrySelectOptions = useMemo(
    () =>
      countries.map((row) => ({
        id: row.id,
        label: `${row.iso2} - ${row.name}`,
        defaultCurrencyCode: String(row.default_currency_code || "").toUpperCase(),
      })),
    [countries]
  );
  const groupCompanyById = useMemo(() => {
    const next = new Map();
    for (const row of groups) {
      const id = toNumber(row.id);
      if (id) {
        next.set(id, row);
      }
    }
    return next;
  }, [groups]);
  const countryById = useMemo(() => {
    const next = new Map();
    for (const row of countries) {
      const id = toNumber(row.id);
      if (id) {
        next.set(id, row);
      }
    }
    return next;
  }, [countries]);
  const policyPacksByCountry = useMemo(() => {
    const next = new Map();
    for (const row of policyPacks || []) {
      const countryIso2 = normalizeUpperText(row?.countryIso2);
      if (!countryIso2) {
        continue;
      }
      if (!next.has(countryIso2)) {
        next.set(countryIso2, []);
      }
      next.get(countryIso2).push(row);
    }
    return next;
  }, [policyPacks]);
  const policyPackOptions = useMemo(
    () =>
      [...(policyPacks || [])].sort((left, right) => {
        const leftCountry = normalizeUpperText(left?.countryIso2);
        const rightCountry = normalizeUpperText(right?.countryIso2);
        if (leftCountry !== rightCountry) {
          return leftCountry.localeCompare(rightCountry);
        }
        return String(left?.packId || "").localeCompare(String(right?.packId || ""));
      }),
    [policyPacks]
  );
  const legalEntityById = useMemo(() => {
    const next = new Map();
    for (const row of legalEntities) {
      const id = toNumber(row.id);
      if (id) {
        next.set(id, row);
      }
    }
    return next;
  }, [legalEntities]);
  const workingLegalEntityId = toNumber(workingContext?.legalEntityId);
  const resolvedWorkingLegalEntity = useMemo(
    () => legalEntityById.get(workingLegalEntityId) || null,
    [legalEntityById, workingLegalEntityId]
  );
  const fallbackActivationLegalEntityId = useMemo(() => {
    if (!isActivationWorkspace) {
      return null;
    }
    if (!canRunTenantSetup && legalEntities.length === 1) {
      return toNumber(legalEntities[0]?.id);
    }
    if (canRunTenantSetup) {
      return toNumber(legalEntities[0]?.id);
    }
    return null;
  }, [canRunTenantSetup, isActivationWorkspace, legalEntities]);
  const activationFocusLegalEntityId = useMemo(() => {
    if (!isActivationWorkspace) {
      return null;
    }
    return (
      workingLegalEntityId ||
      toNumber(resolvedWorkingLegalEntity?.id) ||
      fallbackActivationLegalEntityId
    );
  }, [
    fallbackActivationLegalEntityId,
    isActivationWorkspace,
    resolvedWorkingLegalEntity?.id,
    workingLegalEntityId,
  ]);
  const activationFocusLegalEntity = useMemo(
    () => legalEntityById.get(activationFocusLegalEntityId) || null,
    [activationFocusLegalEntityId, legalEntityById]
  );
  const activationFocusCountry = useMemo(
    () => countryById.get(toNumber(activationFocusLegalEntity?.country_id)) || null,
    [activationFocusLegalEntity?.country_id, countryById]
  );
  const showCentralStructureSections = !isActivationWorkspace;
  const activationWorkingContextResolved =
    Boolean(activationFocusLegalEntityId) ||
    (preferencesHydrated && !loadingBase);
  const activationScopeLabel = activationFocusLegalEntity
    ? activationFocusCountry
      ? `${activationFocusLegalEntity.code} - ${activationFocusLegalEntity.name} | ${activationFocusCountry.iso2} - ${activationFocusCountry.name}`
      : `${activationFocusLegalEntity.code} - ${activationFocusLegalEntity.name}`
    : l("No legal entity selected", "Legal entity secilmedi");
  const workspaceLegalEntities = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return legalEntities;
    }
    return legalEntities.filter(
      (row) => toNumber(row?.id) === Number(activationFocusLegalEntityId)
    );
  }, [activationFocusLegalEntityId, isActivationWorkspace, legalEntities]);
  const workspaceOperatingUnits = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return operatingUnits;
    }
    return operatingUnits.filter(
      (row) =>
        toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
    );
  }, [activationFocusLegalEntityId, isActivationWorkspace, operatingUnits]);
  const workspaceOperatingUnitCurrentAccountConfigs = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return operatingUnitCurrentAccountConfigs;
    }
    return operatingUnitCurrentAccountConfigs.filter(
      (row) =>
        toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
    );
  }, [
    activationFocusLegalEntityId,
    isActivationWorkspace,
    operatingUnitCurrentAccountConfigs,
  ]);
  const workspaceOperatingUnitPartnerCurrentAccounts = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return operatingUnitPartnerCurrentAccounts;
    }
    return operatingUnitPartnerCurrentAccounts.filter(
      (row) =>
        toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
    );
  }, [
    activationFocusLegalEntityId,
    isActivationWorkspace,
    operatingUnitPartnerCurrentAccounts,
  ]);
  const workspaceShareholders = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return shareholders;
    }
    return shareholders.filter(
      (row) =>
        toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
    );
  }, [activationFocusLegalEntityId, isActivationWorkspace, shareholders]);
  const workspaceBooks = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return books;
    }
    return books.filter(
      (row) => toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
    );
  }, [activationFocusLegalEntityId, books, isActivationWorkspace]);
  const workspaceCoas = useMemo(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return coas;
    }
    return coas.filter((row) => {
      const legalEntityId = toNumber(row?.legal_entity_id);
      return !legalEntityId || legalEntityId === Number(activationFocusLegalEntityId);
    });
  }, [activationFocusLegalEntityId, coas, isActivationWorkspace]);
  const workspaceCalendarIdSet = useMemo(() => {
    const next = new Set();
    for (const row of workspaceBooks) {
      const calendarId = toNumber(row?.calendar_id);
      if (calendarId) {
        next.add(calendarId);
      }
    }
    return next;
  }, [workspaceBooks]);
  const workspaceCalendarOptions = useMemo(() => {
    if (!isActivationWorkspace || workspaceCalendarIdSet.size === 0) {
      return calendars;
    }
    return calendars.filter((row) => workspaceCalendarIdSet.has(toNumber(row?.id)));
  }, [calendars, isActivationWorkspace, workspaceCalendarIdSet]);
  const operatingUnitCurrentAccountConfigSummaryByEntityId = useMemo(() => {
    const next = new Map();
    for (const row of operatingUnitCurrentAccountConfigs) {
      const legalEntityId = toNumber(row?.legal_entity_id);
      if (!legalEntityId) {
        continue;
      }
      next.set(
        legalEntityId,
        summarizeOperatingUnitCurrentAccountConfigDrift(
          row,
          operatingUnits,
          operatingUnitPartnerCurrentAccounts
        )
      );
    }
    return next;
  }, [
    operatingUnitCurrentAccountConfigs,
    operatingUnitPartnerCurrentAccounts,
    operatingUnits,
  ]);

  const currencySelectOptions = useMemo(
    () =>
      currencies.map((row) => ({
        code: String(row.code || "").toUpperCase(),
        label: `${String(row.code || "").toUpperCase()} - ${row.name}`,
      })),
    [currencies]
  );
  const selectedEntityCountryIso2 = useMemo(
    () =>
      normalizeUpperText(
        countryById.get(toNumber(entityForm.countryId))?.iso2
      ),
    [countryById, entityForm.countryId]
  );
  const selectedEntityRecommendedPolicyPack = useMemo(
    () => (policyPacksByCountry.get(selectedEntityCountryIso2) || [])[0] || null,
    [policyPacksByCountry, selectedEntityCountryIso2]
  );
  const selectedEntityPolicyPack = useMemo(
    () =>
      policyPackOptions.find(
        (row) => normalizeUpperText(row?.packId) === normalizeUpperText(entityForm.policyPackId)
      ) || null,
    [entityForm.policyPackId, policyPackOptions]
  );
  const entitySelectablePolicyPackOptions = useMemo(() => {
    const countryPackRows = policyPacksByCountry.get(selectedEntityCountryIso2) || [];
    const baseRows = showAllPolicyPackOptions ? [...policyPackOptions] : [...countryPackRows];
    if (
      !showAllPolicyPackOptions &&
      selectedEntityPolicyPack &&
      !baseRows.some(
        (row) =>
          normalizeUpperText(row?.packId) ===
          normalizeUpperText(selectedEntityPolicyPack?.packId)
      )
    ) {
      baseRows.push(selectedEntityPolicyPack);
    }

    return baseRows.sort((left, right) => {
      if (showAllPolicyPackOptions) {
        const leftPriority =
          normalizeUpperText(left?.packId) ===
          normalizeUpperText(selectedEntityRecommendedPolicyPack?.packId)
            ? 0
            : normalizeUpperText(left?.countryIso2) === selectedEntityCountryIso2
              ? 1
              : 2;
        const rightPriority =
          normalizeUpperText(right?.packId) ===
          normalizeUpperText(selectedEntityRecommendedPolicyPack?.packId)
            ? 0
            : normalizeUpperText(right?.countryIso2) === selectedEntityCountryIso2
              ? 1
              : 2;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
      }
      const leftCountry = normalizeUpperText(left?.countryIso2);
      const rightCountry = normalizeUpperText(right?.countryIso2);
      if (leftCountry !== rightCountry) {
        return leftCountry.localeCompare(rightCountry);
      }
      return String(left?.packId || "").localeCompare(String(right?.packId || ""));
    });
  }, [
    policyPacksByCountry,
    selectedEntityCountryIso2,
    showAllPolicyPackOptions,
    policyPackOptions,
    selectedEntityPolicyPack,
    selectedEntityRecommendedPolicyPack,
  ]);
  const selectedOperatingUnitCurrentAccountConfigLegalEntityId = toNumber(
    operatingUnitCurrentAccountConfigForm.legalEntityId
  );
  const selectedOperatingUnitCurrentAccountConfigEntityAccounts = useMemo(
    () =>
      accounts.filter(
        (row) =>
          Number(row.legal_entity_id) ===
            Number(selectedOperatingUnitCurrentAccountConfigLegalEntityId) &&
          String(row.scope || "").trim().toUpperCase() === "LEGAL_ENTITY"
      ),
    [accounts, selectedOperatingUnitCurrentAccountConfigLegalEntityId]
  );
  const operatingUnitCurrentAccountConfigSelectableAccounts = useMemo(
    () =>
      selectedOperatingUnitCurrentAccountConfigEntityAccounts.filter((account) =>
        Boolean(account.is_active)
      ),
    [selectedOperatingUnitCurrentAccountConfigEntityAccounts]
  );
  const operatingUnitCurrentDueFromParentOptions = useMemo(
    () =>
      operatingUnitCurrentAccountConfigSelectableAccounts.filter(
        (account) =>
          String(account.account_type || "").toUpperCase() === "ASSET" &&
          getAccountNormalSide(account) === "DEBIT"
      ),
    [operatingUnitCurrentAccountConfigSelectableAccounts]
  );
  const operatingUnitCurrentDueToParentOptions = useMemo(
    () =>
      operatingUnitCurrentAccountConfigSelectableAccounts.filter(
        (account) =>
          String(account.account_type || "").toUpperCase() === "LIABILITY" &&
          getAccountNormalSide(account) === "CREDIT"
      ),
    [operatingUnitCurrentAccountConfigSelectableAccounts]
  );
  const selectedUnitLegalEntityId = toNumber(unitForm.legalEntityId);
  const selectedUnitEntityAccounts = useMemo(
    () =>
      accounts.filter(
        (row) => Number(row.legal_entity_id) === Number(selectedUnitLegalEntityId)
      ),
    [accounts, selectedUnitLegalEntityId]
  );
  const selectedUnitEntityParentIds = useMemo(() => {
    const next = new Set();
    for (const account of selectedUnitEntityAccounts) {
      const parentId = toNumber(account.parent_account_id);
      if (parentId) {
        next.add(parentId);
      }
    }
    return next;
  }, [selectedUnitEntityAccounts]);
  const unitEligibleLeafAccounts = useMemo(
    () =>
      selectedUnitEntityAccounts.filter((account) => {
        const accountId = toNumber(account.id);
        if (!accountId) {
          return false;
        }
        return (
          Boolean(account.is_active) &&
          isPostingEnabled(account) &&
          !selectedUnitEntityParentIds.has(accountId)
        );
      }),
    [selectedUnitEntityAccounts, selectedUnitEntityParentIds]
  );
  const unitCentralDueFromAccountOptions = useMemo(
    () =>
      buildRankedOperatingUnitCurrentAccountOptions(
        unitEligibleLeafAccounts.filter(
          (account) =>
            String(account.account_type || "").toUpperCase() === "ASSET" &&
            getAccountNormalSide(account) === "DEBIT"
        ),
        {
          sourceOperatingUnitCode: unitForm.code,
        }
      ),
    [unitEligibleLeafAccounts, unitForm.code]
  );
  const unitOuDueToCentralAccountOptions = useMemo(
    () =>
      buildRankedOperatingUnitCurrentAccountOptions(
        unitEligibleLeafAccounts.filter(
          (account) =>
            String(account.account_type || "").toUpperCase() === "LIABILITY" &&
            getAccountNormalSide(account) === "CREDIT"
        ),
        {
          sourceOperatingUnitCode: unitForm.code,
        }
      ),
    [unitEligibleLeafAccounts, unitForm.code]
  );
  const selectedUnitPartnerCurrentLegalEntityId = toNumber(
    unitPartnerCurrentForm.legalEntityId
  );
  const selectedUnitPartnerCurrentEntityAccounts = useMemo(
    () =>
      accounts.filter(
        (row) =>
          Number(row.legal_entity_id) === Number(selectedUnitPartnerCurrentLegalEntityId)
      ),
    [accounts, selectedUnitPartnerCurrentLegalEntityId]
  );
  const selectedUnitPartnerCurrentEntityParentIds = useMemo(() => {
    const next = new Set();
    for (const account of selectedUnitPartnerCurrentEntityAccounts) {
      const parentId = toNumber(account.parent_account_id);
      if (parentId) {
        next.add(parentId);
      }
    }
    return next;
  }, [selectedUnitPartnerCurrentEntityAccounts]);
  const unitPartnerCurrentEligibleLeafAccounts = useMemo(
    () =>
      selectedUnitPartnerCurrentEntityAccounts.filter((account) => {
        const accountId = toNumber(account.id);
        if (!accountId) {
          return false;
        }
        return (
          Boolean(account.is_active) &&
          isPostingEnabled(account) &&
          !selectedUnitPartnerCurrentEntityParentIds.has(accountId)
        );
      }),
    [
      selectedUnitPartnerCurrentEntityAccounts,
      selectedUnitPartnerCurrentEntityParentIds,
    ]
  );
  const selectedUnitPartnerCurrentOperatingUnits = useMemo(
    () =>
      operatingUnits.filter(
        (row) =>
          Number(row.legal_entity_id) === Number(selectedUnitPartnerCurrentLegalEntityId)
      ),
    [operatingUnits, selectedUnitPartnerCurrentLegalEntityId]
  );
  const selectedUnitPartnerCurrentOperatingUnit = useMemo(
    () =>
      selectedUnitPartnerCurrentOperatingUnits.find(
        (row) => Number(row.id) === Number(unitPartnerCurrentForm.operatingUnitId)
      ) || null,
    [selectedUnitPartnerCurrentOperatingUnits, unitPartnerCurrentForm.operatingUnitId]
  );
  const selectedUnitPartnerCurrentPartnerOperatingUnit = useMemo(
    () =>
      selectedUnitPartnerCurrentOperatingUnits.find(
        (row) => Number(row.id) === Number(unitPartnerCurrentForm.partnerOperatingUnitId)
      ) || null,
    [
      selectedUnitPartnerCurrentOperatingUnits,
      unitPartnerCurrentForm.partnerOperatingUnitId,
    ]
  );
  const unitPartnerCurrentDueFromAccountOptions = useMemo(
    () =>
      buildRankedOperatingUnitCurrentAccountOptions(
        unitPartnerCurrentEligibleLeafAccounts.filter(
          (account) =>
            String(account.account_type || "").toUpperCase() === "ASSET" &&
            getAccountNormalSide(account) === "DEBIT"
        ),
        {
          sourceOperatingUnitCode: selectedUnitPartnerCurrentOperatingUnit?.code,
          partnerOperatingUnitCode:
            selectedUnitPartnerCurrentPartnerOperatingUnit?.code,
        }
      ),
    [
      selectedUnitPartnerCurrentOperatingUnit?.code,
      selectedUnitPartnerCurrentPartnerOperatingUnit?.code,
      unitPartnerCurrentEligibleLeafAccounts,
    ]
  );
  const unitPartnerCurrentDueToAccountOptions = useMemo(
    () =>
      buildRankedOperatingUnitCurrentAccountOptions(
        unitPartnerCurrentEligibleLeafAccounts.filter(
          (account) =>
            String(account.account_type || "").toUpperCase() === "LIABILITY" &&
            getAccountNormalSide(account) === "CREDIT"
        ),
        {
          sourceOperatingUnitCode: selectedUnitPartnerCurrentOperatingUnit?.code,
          partnerOperatingUnitCode:
            selectedUnitPartnerCurrentPartnerOperatingUnit?.code,
        }
      ),
    [
      selectedUnitPartnerCurrentOperatingUnit?.code,
      selectedUnitPartnerCurrentPartnerOperatingUnit?.code,
      unitPartnerCurrentEligibleLeafAccounts,
    ]
  );

  const selectedShareholderLegalEntityId = toNumber(
    shareholderForm.legalEntityId
  );
  const selectedShareholderEntityAccounts = useMemo(
    () =>
      accounts.filter(
        (row) =>
          Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId)
      ),
    [accounts, selectedShareholderLegalEntityId]
  );
  const selectedShareholderParentConfig = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return null;
    }
    return (
      shareholderJournalConfigs.find(
        (row) =>
          Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId)
      ) || null
    );
  }, [shareholderJournalConfigs, selectedShareholderLegalEntityId]);
  const selectedCapitalCreditParentAccountId = toNumber(
    selectedShareholderParentConfig?.capital_credit_parent_account_id
  );
  const selectedCommitmentDebitParentAccountId = toNumber(
    selectedShareholderParentConfig?.commitment_debit_parent_account_id
  );
  const selectedShareholderEntityAccountById = useMemo(() => {
    const next = new Map();
    for (const account of selectedShareholderEntityAccounts) {
      const accountId = toNumber(account.id);
      if (accountId) {
        next.set(accountId, account);
      }
    }
    return next;
  }, [selectedShareholderEntityAccounts]);
  const selectedShareholderParentById = useMemo(() => {
    const next = new Map();
    for (const account of selectedShareholderEntityAccounts) {
      const accountId = toNumber(account.id);
      if (!accountId) {
        continue;
      }
      next.set(accountId, toNumber(account.parent_account_id));
    }
    return next;
  }, [selectedShareholderEntityAccounts]);
  const selectedCapitalCreditParentAccount = useMemo(
    () => selectedShareholderEntityAccountById.get(selectedCapitalCreditParentAccountId) || null,
    [selectedShareholderEntityAccountById, selectedCapitalCreditParentAccountId]
  );
  const selectedCommitmentDebitParentAccount = useMemo(
    () =>
      selectedShareholderEntityAccountById.get(
        selectedCommitmentDebitParentAccountId
      ) || null,
    [selectedShareholderEntityAccountById, selectedCommitmentDebitParentAccountId]
  );
  const parentMappingStatus = useMemo(() => {
    const reasons = [];
    const validateParent = (account, expectedSide, label) => {
      if (!account) {
        reasons.push(
          l(
            `${label} account mapping is missing.`,
            `${label} hesap eslesmesi eksik.`
          )
        );
        return;
      }
      if (!account.is_active) {
        reasons.push(
          l(
            `${label} must be active.`,
            `${label} aktif olmalidir.`
          )
        );
      }
      if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
        reasons.push(
          l(
            `${label} must be EQUITY.`,
            `${label} EQUITY olmalidir.`
          )
        );
      }
      if (getAccountNormalSide(account) !== expectedSide) {
        reasons.push(
          l(
            `${label} must have ${expectedSide} normal side.`,
            `${label} ${expectedSide} normal tarafa sahip olmalidir.`
          )
        );
      }
      if (isPostingEnabled(account)) {
        reasons.push(
          l(
            `${label} must be a non-postable header account.`,
            `${label} post edilemeyen ust hesap olmalidir.`
          )
        );
      }
    };

    if (!selectedCapitalCreditParentAccountId || !selectedCommitmentDebitParentAccountId) {
      reasons.push(
        l(
          "Save parent mapping accounts first.",
          "Once parent hesap eslesmelerini kaydedin."
        )
      );
    }
    if (selectedCapitalCreditParentAccountId === selectedCommitmentDebitParentAccountId) {
      reasons.push(
        l(
          "Capital and commitment parent mapping cannot be the same account.",
          "Sermaye ve taahhut parent eslesmesi ayni hesap olamaz."
        )
      );
    }
    validateParent(
      selectedCapitalCreditParentAccount,
      "CREDIT",
      l("Capital parent", "Sermaye parent")
    );
    validateParent(
      selectedCommitmentDebitParentAccount,
      "DEBIT",
      l("Commitment parent", "Taahhut parent")
    );

    return {
      valid:
        Boolean(selectedCapitalCreditParentAccountId) &&
        Boolean(selectedCommitmentDebitParentAccountId) &&
        reasons.length === 0,
      reasons,
    };
  }, [
    l,
    selectedCapitalCreditParentAccount,
    selectedCapitalCreditParentAccountId,
    selectedCommitmentDebitParentAccount,
    selectedCommitmentDebitParentAccountId,
  ]);
  const hasShareholderParentMapping = parentMappingStatus.valid;

  const equityParentShareholderAccounts = useMemo(
    () =>
      selectedShareholderEntityAccounts.filter((row) => {
        const isEquity = String(row.account_type || "").toUpperCase() === "EQUITY";
        return (
          isEquity &&
          Boolean(row.is_active) &&
          Boolean(toNumber(row.id)) &&
          !isPostingEnabled(row)
        );
      }),
    [selectedShareholderEntityAccounts]
  );
  const equityCreditParentShareholderAccounts = useMemo(
    () =>
      equityParentShareholderAccounts.filter(
        (row) => getAccountNormalSide(row) === "CREDIT"
      ),
    [equityParentShareholderAccounts]
  );
  const equityDebitParentShareholderAccounts = useMemo(
    () =>
      equityParentShareholderAccounts.filter(
        (row) => getAccountNormalSide(row) === "DEBIT"
      ),
    [equityParentShareholderAccounts]
  );

  const equityLeafShareholderAccounts = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return [];
    }
    const parentIds = new Set(
      selectedShareholderEntityAccounts
        .filter(
          (row) =>
            Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId) &&
            Boolean(row.is_active)
        )
        .map((row) => toNumber(row.parent_account_id))
        .filter(Boolean)
    );
    return selectedShareholderEntityAccounts.filter((row) => {
      const isEquity = String(row.account_type || "").toUpperCase() === "EQUITY";
      const isActive = Boolean(row.is_active);
      const allowPosting = isPostingEnabled(row);
      const accountId = toNumber(row.id);
      if (!accountId) {
        return false;
      }
      return (
        isEquity &&
        isActive &&
        allowPosting &&
        !parentIds.has(accountId)
      );
    });
  }, [selectedShareholderEntityAccounts, selectedShareholderLegalEntityId]);
  const mappedCapitalCreditLeafAccounts = useMemo(() => {
    if (!selectedCapitalCreditParentAccountId) {
      return [];
    }
    return equityLeafShareholderAccounts.filter(
      (row) =>
        getAccountNormalSide(row) === "CREDIT" &&
        isDescendantAccount(
          toNumber(row.id),
          selectedCapitalCreditParentAccountId,
          selectedShareholderParentById
        )
    );
  }, [
    equityLeafShareholderAccounts,
    selectedCapitalCreditParentAccountId,
    selectedShareholderParentById,
  ]);
  const mappedCommitmentDebitLeafAccounts = useMemo(() => {
    if (!selectedCommitmentDebitParentAccountId) {
      return [];
    }
    return equityLeafShareholderAccounts.filter(
      (row) =>
        getAccountNormalSide(row) === "DEBIT" &&
        isDescendantAccount(
          toNumber(row.id),
          selectedCommitmentDebitParentAccountId,
          selectedShareholderParentById
        )
    );
  }, [
    equityLeafShareholderAccounts,
    selectedCommitmentDebitParentAccountId,
    selectedShareholderParentById,
  ]);

  const visibleShareholders = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return isActivationWorkspace ? workspaceShareholders : shareholders;
    }
    const sourceRows = isActivationWorkspace ? workspaceShareholders : shareholders;
    return sourceRows.filter(
      (row) =>
        Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId)
    );
  }, [
    isActivationWorkspace,
    shareholders,
    selectedShareholderLegalEntityId,
    workspaceShareholders,
  ]);
  const existingShareholderForForm = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return null;
    }
    const normalizedCode = String(shareholderForm.code || "")
      .trim()
      .toUpperCase();
    if (!normalizedCode) {
      return null;
    }
    return (
      visibleShareholders.find(
        (row) =>
          String(row.code || "")
            .trim()
            .toUpperCase() === normalizedCode
      ) || null
    );
  }, [selectedShareholderLegalEntityId, shareholderForm.code, visibleShareholders]);
  const formCommitmentIncreaseAmount = useMemo(() => {
    const parsed = Number(shareholderForm.committedCapital || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return normalizeAmount(parsed);
  }, [shareholderForm.committedCapital]);
  const formExistingCommittedCapitalAmount = useMemo(
    () => normalizeAmount(existingShareholderForForm?.committed_capital || 0),
    [existingShareholderForForm]
  );
  const formProjectedCommittedCapitalAmount = useMemo(
    () =>
      normalizeAmount(
        formExistingCommittedCapitalAmount + formCommitmentIncreaseAmount
      ),
    [formCommitmentIncreaseAmount, formExistingCommittedCapitalAmount]
  );
  const eligibleShareholdersForCommitmentIncrease = useMemo(
    () =>
      visibleShareholders.filter(
        (row) =>
          Boolean(toNumber(row.capital_sub_account_id)) &&
          Boolean(toNumber(row.commitment_debit_sub_account_id))
      ),
    [visibleShareholders]
  );
  const selectedCommitmentIncreaseShareholder = useMemo(
    () =>
      eligibleShareholdersForCommitmentIncrease.find(
        (row) =>
          toNumber(row.id) === toNumber(commitmentIncreaseForm.shareholderId)
      ) || null,
    [eligibleShareholdersForCommitmentIncrease, commitmentIncreaseForm.shareholderId]
  );
  const commitmentIncreaseAmount = useMemo(() => {
    const parsed = Number(commitmentIncreaseForm.increaseAmount || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return normalizeAmount(parsed);
  }, [commitmentIncreaseForm.increaseAmount]);
  const commitmentIncreaseCurrentCommittedCapital = useMemo(
    () => normalizeAmount(selectedCommitmentIncreaseShareholder?.committed_capital || 0),
    [selectedCommitmentIncreaseShareholder]
  );
  const commitmentIncreaseProjectedCommittedCapital = useMemo(
    () =>
      normalizeAmount(
        commitmentIncreaseCurrentCommittedCapital + commitmentIncreaseAmount
      ),
    [commitmentIncreaseAmount, commitmentIncreaseCurrentCommittedCapital]
  );
  const selectedEntityCommitmentQueueIds = useMemo(() => {
    const key = String(selectedShareholderLegalEntityId || "");
    const raw = commitmentBatchQueueByEntity?.[key];
    if (!Array.isArray(raw)) {
      return [];
    }
    return Array.from(new Set(raw.map((value) => toNumber(value)).filter(Boolean)));
  }, [commitmentBatchQueueByEntity, selectedShareholderLegalEntityId]);
  const selectedEntityCommitmentQueueIdSet = useMemo(
    () => new Set(selectedEntityCommitmentQueueIds),
    [selectedEntityCommitmentQueueIds]
  );
  const pendingBatchCommitmentShareholders = useMemo(() => {
    if (selectedEntityCommitmentQueueIds.length === 0) {
      return [];
    }
    const pendingIdSet = new Set(selectedEntityCommitmentQueueIds);
    return visibleShareholders.filter((row) => pendingIdSet.has(toNumber(row.id)));
  }, [selectedEntityCommitmentQueueIds, visibleShareholders]);
  const pendingBatchQueueCurrencyGroups = useMemo(() => {
    const byCurrency = new Map();
    for (const row of pendingBatchCommitmentShareholders) {
      const shareholderId = toNumber(row.id);
      if (!shareholderId) {
        continue;
      }
      const currencyCode = String(row.currency_code || "").trim().toUpperCase() || "-";
      if (!byCurrency.has(currencyCode)) {
        byCurrency.set(currencyCode, []);
      }
      byCurrency.get(currencyCode).push(shareholderId);
    }

    return Array.from(byCurrency.entries()).map(([currencyCode, ids]) => {
      const shareholderIds = Array.from(new Set(ids));
      return {
        currencyCode,
        shareholderIds,
        count: shareholderIds.length,
      };
    });
  }, [pendingBatchCommitmentShareholders]);
  const eligibleShareholdersForQueue = useMemo(
    () =>
      visibleShareholders.filter(
        (row) =>
          Number(row.committed_capital || 0) > 0 &&
          Boolean(toNumber(row.capital_sub_account_id)) &&
          Boolean(toNumber(row.commitment_debit_sub_account_id))
      ),
    [visibleShareholders]
  );
  const eligibleQueueCurrencyGroups = useMemo(() => {
    const byCurrency = new Map();
    for (const row of eligibleShareholdersForQueue) {
      const shareholderId = toNumber(row.id);
      if (!shareholderId) {
        continue;
      }
      const currencyCode = String(row.currency_code || "").trim().toUpperCase() || "-";
      if (!byCurrency.has(currencyCode)) {
        byCurrency.set(currencyCode, []);
      }
      byCurrency.get(currencyCode).push(shareholderId);
    }

    return Array.from(byCurrency.entries()).map(([currencyCode, ids]) => {
      const shareholderIds = Array.from(new Set(ids));
      return {
        currencyCode,
        shareholderIds,
        count: shareholderIds.length,
      };
    });
  }, [eligibleShareholdersForQueue]);
  const usedCapitalSubAccountIds = useMemo(
    () =>
      new Set(
        visibleShareholders
          .map((row) => toNumber(row.capital_sub_account_id))
          .filter(Boolean)
      ),
    [visibleShareholders]
  );
  const usedCommitmentDebitSubAccountIds = useMemo(
    () =>
      new Set(
        visibleShareholders
          .map((row) => toNumber(row.commitment_debit_sub_account_id))
          .filter(Boolean)
      ),
    [visibleShareholders]
  );
  const availableCapitalCreditShareholderAccounts = useMemo(
    () =>
      mappedCapitalCreditLeafAccounts.filter(
        (row) => !usedCapitalSubAccountIds.has(toNumber(row.id))
      ),
    [mappedCapitalCreditLeafAccounts, usedCapitalSubAccountIds]
  );
  const availableCommitmentDebitShareholderAccounts = useMemo(
    () =>
      mappedCommitmentDebitLeafAccounts.filter(
        (row) => !usedCommitmentDebitSubAccountIds.has(toNumber(row.id))
      ),
    [mappedCommitmentDebitLeafAccounts, usedCommitmentDebitSubAccountIds]
  );
  const hasMissingCreditEquitySubAccount =
    hasShareholderParentMapping &&
    availableCapitalCreditShareholderAccounts.length === 0;
  const hasMissingDebitEquitySubAccount =
    hasShareholderParentMapping &&
    availableCommitmentDebitShareholderAccounts.length === 0;
  const shareholdersWithCommittedCapital = useMemo(
    () =>
      visibleShareholders.filter((row) => Number(row.committed_capital || 0) > 0),
    [visibleShareholders]
  );
  const batchPreviewMixedCurrencyIssue = useMemo(
    () =>
      Boolean(
        batchPreviewData &&
        Array.isArray(batchPreviewData?.validation?.mixed_currency) &&
        batchPreviewData.validation.mixed_currency.length > 1
      ),
    [batchPreviewData]
  );
  const selectedShareholderSetupChecks = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return [];
    }
    return [
      {
        key: "parentMappings",
        label: l(
          "Parent mappings are valid (active, equity, correct side, header account)",
          "Parent eslemeleri gecerli (aktif, ozkaynak, dogru taraf, ust hesap)"
        ),
        ready: parentMappingStatus.valid,
        reasons: parentMappingStatus.reasons,
      },
      {
        key: "commitmentSubAccounts",
        label: l(
          "Commitment sub-accounts are assigned per shareholder",
          "Taahhut icin ortak alt hesaplari atanmis"
        ),
        ready: shareholdersWithCommittedCapital.every(
          (row) =>
            Boolean(toNumber(row.capital_sub_account_id)) &&
            Boolean(toNumber(row.commitment_debit_sub_account_id))
        ),
      },
      {
        key: "equitySubAccountPool",
        label: l(
          "Debit/credit sub-account pool exists for new shareholders",
          "Yeni ortaklar icin borc/alacak alt hesap havuzu mevcut"
        ),
        ready:
          hasShareholderParentMapping &&
          availableCapitalCreditShareholderAccounts.length > 0 &&
          availableCommitmentDebitShareholderAccounts.length > 0,
      },
      {
        key: "fiscalPeriods",
        label: l(
          "Fiscal period exists",
          "Mali donem mevcut"
        ),
        ready: periods.length > 0,
      },
      {
        key: "batchCurrency",
        label: l(
          "Batch queue uses one currency",
          "Toplu fis icin ayni para birimi"
        ),
        ready:
          pendingBatchCommitmentShareholders.length === 0 ||
          !batchPreviewMixedCurrencyIssue,
      },
    ];
  }, [
    availableCapitalCreditShareholderAccounts.length,
    availableCommitmentDebitShareholderAccounts.length,
    batchPreviewMixedCurrencyIssue,
    hasShareholderParentMapping,
    l,
    parentMappingStatus.reasons,
    parentMappingStatus.valid,
    pendingBatchCommitmentShareholders.length,
    periods.length,
    selectedShareholderLegalEntityId,
    shareholdersWithCommittedCapital,
  ]);
  const selectedShareholderMissingChecks = useMemo(
    () => selectedShareholderSetupChecks.filter((row) => !row.ready),
    [selectedShareholderSetupChecks]
  );
  const selectedShareholderLegalEntity = useMemo(
    () =>
      legalEntities.find(
        (row) =>
          Number(row.id) === Number(selectedShareholderLegalEntityId)
      ) || null,
    [legalEntities, selectedShareholderLegalEntityId]
  );
  const capitalFulfillmentLegalEntityId = toNumber(
    capitalFulfillmentForm.legalEntityId
  );
  const selectedBankControlParentReadiness = getModuleRow(
    "bankControlParent",
    capitalFulfillmentLegalEntityId
  );
  const capitalFulfillmentOperatingUnitId = toNumber(
    capitalFulfillmentForm.operatingUnitId
  );
  const capitalFulfillmentEntityAccounts = useMemo(
    () =>
      accounts.filter(
        (row) => Number(row.legal_entity_id) === Number(capitalFulfillmentLegalEntityId)
      ),
    [accounts, capitalFulfillmentLegalEntityId]
  );
  const capitalFulfillmentEntityParentIds = useMemo(() => {
    const next = new Set();
    for (const account of capitalFulfillmentEntityAccounts) {
      const parentId = toNumber(account.parent_account_id);
      if (parentId) {
        next.add(parentId);
      }
    }
    return next;
  }, [capitalFulfillmentEntityAccounts]);
  const capitalFulfillmentAssetAccounts = useMemo(
    () =>
      capitalFulfillmentEntityAccounts.filter((account) => {
        const accountId = toNumber(account.id);
        if (!accountId) {
          return false;
        }
        return (
          String(account.account_type || "").toUpperCase() === "ASSET" &&
          Boolean(account.is_active) &&
          isPostingEnabled(account) &&
          !capitalFulfillmentEntityParentIds.has(accountId)
        );
      }),
    [capitalFulfillmentEntityAccounts, capitalFulfillmentEntityParentIds]
  );
  const capitalFulfillmentEligibleShareholders = useMemo(
    () =>
      shareholders.filter(
        (row) =>
          Number(row.legal_entity_id) === Number(capitalFulfillmentLegalEntityId) &&
          Boolean(toNumber(row.capital_sub_account_id)) &&
          Boolean(toNumber(row.commitment_debit_sub_account_id))
      ),
    [shareholders, capitalFulfillmentLegalEntityId]
  );
  const selectedCapitalFulfillmentShareholder = useMemo(
    () =>
      capitalFulfillmentEligibleShareholders.find(
        (row) => toNumber(row.id) === toNumber(capitalFulfillmentForm.shareholderId)
      ) || null,
    [capitalFulfillmentEligibleShareholders, capitalFulfillmentForm.shareholderId]
  );
  const capitalFulfillmentAssetAccountOptions = useMemo(() => {
    const blockedIds = new Set(
      [
        toNumber(selectedCapitalFulfillmentShareholder?.capital_sub_account_id),
        toNumber(selectedCapitalFulfillmentShareholder?.commitment_debit_sub_account_id),
      ].filter(Boolean)
    );
    return capitalFulfillmentAssetAccounts.filter(
      (account) => !blockedIds.has(toNumber(account.id))
    );
  }, [capitalFulfillmentAssetAccounts, selectedCapitalFulfillmentShareholder]);
  const capitalFulfillmentBankGlAccountOptions = useMemo(
    () =>
      [...capitalFulfillmentAssetAccounts].sort((left, right) =>
        String(left?.code || "").localeCompare(String(right?.code || ""))
      ),
    [capitalFulfillmentAssetAccounts]
  );
  const capitalFulfillmentOperatingUnits = useMemo(
    () =>
      operatingUnits.filter(
        (row) => Number(row.legal_entity_id) === Number(capitalFulfillmentLegalEntityId)
      ),
    [operatingUnits, capitalFulfillmentLegalEntityId]
  );
  const selectedCapitalFulfillmentOperatingUnit = useMemo(
    () =>
      capitalFulfillmentOperatingUnits.find(
        (row) => toNumber(row.id) === capitalFulfillmentOperatingUnitId
      ) || null,
    [capitalFulfillmentOperatingUnitId, capitalFulfillmentOperatingUnits]
  );
  const capitalFulfillmentBankAccountOptions = useMemo(() => {
    return capitalFulfillmentBankAccounts.filter((row) => {
      if (Number(row.legal_entity_id) !== Number(capitalFulfillmentLegalEntityId)) {
        return false;
      }
      if (capitalFulfillmentOperatingUnitId) {
        return Number(row.operating_unit_id) === Number(capitalFulfillmentOperatingUnitId);
      }
      return !toNumber(row.operating_unit_id);
    });
  }, [
    capitalFulfillmentBankAccounts,
    capitalFulfillmentLegalEntityId,
    capitalFulfillmentOperatingUnitId,
  ]);
  const capitalFulfillmentCashRegisterOptions = useMemo(() => {
    return capitalFulfillmentCashRegisters.filter((row) => {
      if (Number(row.legal_entity_id) !== Number(capitalFulfillmentLegalEntityId)) {
        return false;
      }
      if (capitalFulfillmentOperatingUnitId) {
        return Number(row.operating_unit_id) === Number(capitalFulfillmentOperatingUnitId);
      }
      return !toNumber(row.operating_unit_id);
    });
  }, [
    capitalFulfillmentCashRegisters,
    capitalFulfillmentLegalEntityId,
    capitalFulfillmentOperatingUnitId,
  ]);
  const selectedCapitalFulfillmentCashRegister = useMemo(
    () =>
      capitalFulfillmentCashRegisterOptions.find(
        (row) => toNumber(row.id) === toNumber(capitalFulfillmentForm.cashRegisterId)
      ) || null,
    [capitalFulfillmentCashRegisterOptions, capitalFulfillmentForm.cashRegisterId]
  );
  const capitalFulfillmentCashSessionOptions = useMemo(() => {
    const registerId = toNumber(capitalFulfillmentForm.cashRegisterId);
    if (!registerId) {
      return [];
    }
    return capitalFulfillmentOpenCashSessions.filter(
      (row) => toNumber(row.cash_register_id) === registerId
    );
  }, [capitalFulfillmentForm.cashRegisterId, capitalFulfillmentOpenCashSessions]);
  const capitalFulfillmentCashSessionRequired =
    String(selectedCapitalFulfillmentCashRegister?.session_mode || "")
      .trim()
      .toUpperCase() === "REQUIRED";
  const capitalFulfillmentCashSessionMissingOpenSession =
    capitalFulfillmentCashSessionRequired &&
    toNumber(capitalFulfillmentForm.cashRegisterId) &&
    capitalFulfillmentCashSessionOptions.length === 0 &&
    !capitalFulfillmentCashSessionsLoading;
  const capitalFulfillmentCashSessionValueMissing =
    capitalFulfillmentCashSessionRequired &&
    !toNumber(capitalFulfillmentForm.cashSessionId);
  const capitalFulfillmentCanOpen = Boolean(
    selectedShareholderLegalEntityId &&
    canManageShareholderCapitalFulfillment &&
    (canReadBanks || canReadAccounts || canReadCashRegisters) &&
    eligibleShareholdersForCommitmentIncrease.length > 0
  );
  const capitalFulfillmentSelectedLegalEntity = useMemo(
    () => legalEntityById.get(capitalFulfillmentLegalEntityId) || null,
    [legalEntityById, capitalFulfillmentLegalEntityId]
  );
  const capitalFulfillmentNeedsBankSetup =
    capitalFulfillmentForm.destinationMode === "BANK_ACCOUNT" &&
    !capitalFulfillmentBankLoading &&
    !capitalFulfillmentBankError &&
    capitalFulfillmentLegalEntityId &&
    capitalFulfillmentBankAccountOptions.length === 0;
  const capitalFulfillmentOuReady =
    !selectedCapitalFulfillmentOperatingUnit ||
    Boolean(selectedCapitalFulfillmentOperatingUnit.capital_self_balancing_ready);
  const capitalFulfillmentOperationalModelLabel = useMemo(() => {
    const operationalModel = String(
      capitalFulfillmentPreview?.operational_model || ""
    ).toUpperCase();
    if (operationalModel === "DIRECT_OU_TARGETED") {
      return l("Direct OU-targeted", "Dogrudan OU hedefli");
    }
    if (operationalModel === "HQ_FIRST_CENTRAL_ONLY") {
      return l("Central-first / central-only", "Merkez once / sadece merkez");
    }
    return selectedCapitalFulfillmentOperatingUnit
      ? l("Direct OU-targeted", "Dogrudan OU hedefli")
      : l("Central-first / central-only", "Merkez once / sadece merkez");
  }, [capitalFulfillmentPreview?.operational_model, l, selectedCapitalFulfillmentOperatingUnit]);
  useEffect(() => {
    if (!isActivationWorkspace) {
      setActivationBankAccounts([]);
      setActivationBankAccountsError("");
      setActivationCashRegisters([]);
      setActivationCashRegistersError("");
      return undefined;
    }

    if (!activationFocusLegalEntityId) {
      setActivationBankAccounts([]);
      setActivationBankAccountsError("");
      setActivationCashRegisters([]);
      setActivationCashRegistersError("");
      return undefined;
    }

    let active = true;
    if (canReadBanks) {
      setActivationBankAccountsLoading(true);
      setActivationBankAccountsError("");
      listBankAccounts({ legalEntityId: activationFocusLegalEntityId })
        .then((response) => {
          if (!active) {
            return;
          }
          setActivationBankAccounts(Array.isArray(response?.rows) ? response.rows : []);
        })
        .catch((err) => {
          if (!active) {
            return;
          }
          setActivationBankAccounts([]);
          setActivationBankAccountsError(
            err?.response?.data?.message ||
              l(
                "Failed to load entity bank accounts for activation workspace.",
                "Aktivasyon alani icin entity banka hesaplari yuklenemedi."
              )
          );
        })
        .finally(() => {
          if (active) {
            setActivationBankAccountsLoading(false);
          }
        });
    } else {
      setActivationBankAccounts([]);
      setActivationBankAccountsError(
        l(
          "Need bank.accounts.read to review bank setup here.",
          "Burada banka kurulumunu incelemek icin bank.accounts.read gerekir."
        )
      );
    }

    if (canReadCashRegisters) {
      setActivationCashRegistersLoading(true);
      setActivationCashRegistersError("");
      listCashRegisters({ legalEntityId: activationFocusLegalEntityId })
        .then((response) => {
          if (!active) {
            return;
          }
          setActivationCashRegisters(Array.isArray(response?.rows) ? response.rows : []);
        })
        .catch((err) => {
          if (!active) {
            return;
          }
          setActivationCashRegisters([]);
          setActivationCashRegistersError(
            err?.response?.data?.message ||
              l(
                "Failed to load entity cash registers for activation workspace.",
                "Aktivasyon alani icin entity kasa tanimlari yuklenemedi."
              )
          );
        })
        .finally(() => {
          if (active) {
            setActivationCashRegistersLoading(false);
          }
        });
    } else {
      setActivationCashRegisters([]);
      setActivationCashRegistersError(
        l(
          "Need cash.register.read to review cash setup here.",
          "Burada kasa kurulumunu incelemek icin cash.register.read gerekir."
        )
      );
    }

    return () => {
      active = false;
    };
  }, [
    activationFocusLegalEntityId,
    canReadBanks,
    canReadCashRegisters,
    isActivationWorkspace,
    l,
  ]);
  useEffect(() => {
    if (!isActivationWorkspace || !activationFocusLegalEntityId) {
      return;
    }

    const legalEntityId = String(activationFocusLegalEntityId);
    const legalEntityCurrency = String(
      activationFocusLegalEntity?.functional_currency_code || "USD"
    ).toUpperCase();
    const existingCurrentAccountConfig =
      workspaceOperatingUnitCurrentAccountConfigs.find(
        (row) =>
          toNumber(row?.legal_entity_id) === Number(activationFocusLegalEntityId)
      ) || null;

    setUnitForm((prev) =>
      prev.legalEntityId === legalEntityId
        ? prev
        : {
            ...DEFAULT_UNIT_FORM,
            legalEntityId,
          }
    );
    setOperatingUnitCurrentAccountConfigForm((prev) => {
      if (
        prev.legalEntityId === legalEntityId &&
        existingCurrentAccountConfig &&
        toNumber(prev?.dueFromParentAccountId) ===
          toNumber(existingCurrentAccountConfig?.due_from_parent_account_id) &&
        toNumber(prev?.dueToParentAccountId) ===
          toNumber(existingCurrentAccountConfig?.due_to_parent_account_id)
      ) {
        return prev;
      }
      return buildOperatingUnitCurrentAccountConfigForm(
        legalEntityId,
        existingCurrentAccountConfig
      );
    });
    setUnitPartnerCurrentForm((prev) =>
      prev.legalEntityId === legalEntityId
        ? prev
        : {
            ...DEFAULT_UNIT_PARTNER_CURRENT_FORM,
            legalEntityId,
          }
    );
    setShareholderForm((prev) =>
      prev.legalEntityId === legalEntityId
        ? prev
        : {
            ...prev,
            legalEntityId,
            currencyCode: legalEntityCurrency || prev.currencyCode || "USD",
          }
    );
    setCapitalFulfillmentForm((prev) =>
      prev.legalEntityId === legalEntityId
        ? prev
        : {
            ...DEFAULT_CAPITAL_FULFILLMENT_FORM,
            legalEntityId,
            contributionDate: prev.contributionDate || todayIsoDate(),
          }
    );
  }, [
    activationFocusLegalEntity?.functional_currency_code,
    activationFocusLegalEntityId,
    isActivationWorkspace,
    workspaceOperatingUnitCurrentAccountConfigs,
  ]);
  useEffect(() => {
    if (!isActivationWorkspace) {
      return;
    }
    if (workspaceCalendarOptions.length === 0) {
      return;
    }
    const currentCalendarStillVisible = workspaceCalendarOptions.some(
      (row) => toNumber(row?.id) === toNumber(periodForm.calendarId)
    );
    if (currentCalendarStillVisible) {
      return;
    }
    setPeriodForm((prev) => ({
      ...prev,
      calendarId: String(workspaceCalendarOptions[0]?.id || ""),
    }));
  }, [isActivationWorkspace, periodForm.calendarId, workspaceCalendarOptions]);
  const activationReadyBankAccounts = useMemo(
    () =>
      activationBankAccounts.filter(
        (row) =>
          row?.is_active === undefined ||
          row?.is_active === null ||
          row?.is_active === true ||
          row?.is_active === 1 ||
          row?.is_active === "1"
      ),
    [activationBankAccounts]
  );
  const activationReadyCashRegisters = useMemo(
    () =>
      activationCashRegisters.filter(
        (row) => normalizeUpperText(row?.status || "ACTIVE") === "ACTIVE"
      ),
    [activationCashRegisters]
  );
  const activationOperatingUnitCurrentAccountReadiness = getModuleRow(
    "operatingUnitCurrentAccounts",
    activationFocusLegalEntityId
  );
  const activationShareholderReadiness = getModuleRow(
    "shareholderCommitment",
    activationFocusLegalEntityId
  );
  const activationBankControlParentReadiness = getModuleRow(
    "bankControlParent",
    activationFocusLegalEntityId
  );
  const activationLocalCloseReadiness = getModuleRow(
    "closeConsolidationWorkflow",
    activationFocusLegalEntityId
  );
  const activationChecklistItems = useMemo(() => {
    if (!activationFocusLegalEntityId) {
      return [];
    }

    return [
      {
        key: "books",
        title: l("Books and ledgers", "Defterler ve ledger yapisi"),
        ready: workspaceBooks.length > 0,
        detail:
          workspaceBooks.length > 0
            ? l(
                `${workspaceBooks.length} book(s) are linked to this legal entity.`,
                `Bu legal entity'ye bagli ${workspaceBooks.length} defter var.`
              )
            : l(
                "No book is linked to this legal entity yet. Finish local ledger activation in GL setup.",
                "Bu legal entity'ye bagli bir defter henuz yok. GL ayarlarinda yerel defter aktivasyonunu tamamlayin."
              ),
        actionPath: "/app/ayarlar/hesap-plani-ayarlari",
      },
      {
        key: "coas",
        title: l("Chart of accounts usage", "Hesap plani kullanim/mapping"),
        ready: workspaceCoas.length > 0,
        detail:
          workspaceCoas.length > 0
            ? l(
                `${workspaceCoas.length} chart-of-accounts row(s) are visible for this scope.`,
                `Bu kapsam icin ${workspaceCoas.length} hesap plani satiri gorunur.`
              )
            : l(
                "No chart-of-accounts row is visible for this legal entity yet.",
                "Bu legal entity icin henuz gorunen bir hesap plani satiri yok."
              ),
        actionPath: "/app/ayarlar/hesap-plani-ayarlari",
      },
      {
        key: "fiscal",
        title: l("Fiscal configuration", "Mali konfigurasyon"),
        ready: workspaceCalendarOptions.length > 0 && periods.length > 0,
        detail:
          workspaceCalendarOptions.length > 0 && periods.length > 0
            ? l(
                `${workspaceCalendarOptions.length} calendar option(s) and ${periods.length} fiscal period row(s) are available in this view.`,
                `Bu gorunumde ${workspaceCalendarOptions.length} takvim secenegi ve ${periods.length} mali donem satiri var.`
              )
            : l(
                "Calendar or fiscal-period setup is still incomplete for the current activation scope.",
                "Mevcut aktivasyon kapsami icin takvim veya mali donem kurulumu halen eksik."
              ),
      },
      {
        key: "bank",
        title: l("Bank setup", "Banka kurulumu"),
        ready: canReadBanks && activationReadyBankAccounts.length > 0,
        detail: activationBankAccountsLoading
          ? l(
              "Loading entity bank accounts for this activation scope...",
              "Bu aktivasyon kapsami icin entity banka hesaplari yukleniyor..."
            )
          : activationBankAccountsError
          ? activationBankAccountsError
          : canReadBanks
            ? activationReadyBankAccounts.length > 0
              ? l(
                  `${activationReadyBankAccounts.length} active bank account(s) are ready for this legal entity.`,
                  `Bu legal entity icin ${activationReadyBankAccounts.length} aktif banka hesabi hazir.`
                )
              : l(
                  "No active bank account is ready for this legal entity yet.",
                  "Bu legal entity icin henuz hazir aktif banka hesabi yok."
                )
            : l(
                "Bank readiness is hidden because bank.accounts.read is missing.",
                "bank.accounts.read olmadigi icin banka hazirligi gosterilemiyor."
              ),
        actionPath: "/app/banka-tanimla",
      },
      {
        key: "cash",
        title: l("Cash and register setup", "Kasa ve register kurulumu"),
        ready: canReadCashRegisters && activationReadyCashRegisters.length > 0,
        detail: activationCashRegistersLoading
          ? l(
              "Loading entity cash registers for this activation scope...",
              "Bu aktivasyon kapsami icin entity kasa register'lari yukleniyor..."
            )
          : activationCashRegistersError
          ? activationCashRegistersError
          : canReadCashRegisters
            ? activationReadyCashRegisters.length > 0
              ? l(
                  `${activationReadyCashRegisters.length} active register(s) are ready for this legal entity.`,
                  `Bu legal entity icin ${activationReadyCashRegisters.length} aktif register hazir.`
                )
              : l(
                  "No active cash register is ready for this legal entity yet.",
                  "Bu legal entity icin henuz hazir aktif kasa register'i yok."
                )
            : l(
                "Cash readiness is hidden because cash.register.read is missing.",
                "cash.register.read olmadigi icin kasa hazirligi gosterilemiyor."
              ),
        actionPath: "/app/kasa-tanimlari",
      },
      {
        key: "branches",
        title: l("Branches and operating units", "Subeler ve operasyon birimleri"),
        ready: workspaceOperatingUnits.length > 0,
        detail:
          workspaceOperatingUnits.length > 0
            ? l(
                `${workspaceOperatingUnits.length} operating unit(s) are configured in this legal entity.`,
                `Bu legal entity icinde ${workspaceOperatingUnits.length} operasyon birimi tanimli.`
              )
            : l(
                "No operating unit is configured in this legal entity yet.",
                "Bu legal entity icinde henuz operasyon birimi tanimli degil."
              ),
      },
      {
        key: "ouReadiness",
        title: l(
          "Self-balancing current-account readiness",
          "Self-balancing cari hesap hazirligi"
        ),
        ready: Boolean(
          activationOperatingUnitCurrentAccountReadiness?.ready ||
            activationOperatingUnitCurrentAccountReadiness?.applicable === false
        ),
        detail: activationOperatingUnitCurrentAccountReadiness
          ? formatOperatingUnitCurrentAccountBlocker(
              {
                ...activationOperatingUnitCurrentAccountReadiness,
                legalEntityId: activationFocusLegalEntityId,
                legalEntityCode: activationFocusLegalEntity?.code,
                legalEntityName: activationFocusLegalEntity?.name,
              },
              l
            )
          : l(
              "Current-account readiness has not been loaded for this legal entity yet.",
              "Bu legal entity icin cari hesap hazirligi henuz yuklenmedi."
            ),
      },
      {
        key: "shareholders",
        title: l("Shareholder and equity setup", "Ortak ve sermaye kurulumu"),
        ready: Boolean(activationShareholderReadiness?.ready || workspaceShareholders.length > 0),
        detail: activationShareholderReadiness?.ready
          ? l(
              "Shareholder commitment prerequisites are ready for this legal entity.",
              "Bu legal entity icin ortak taahhut on kosullari hazir."
            )
          : activationShareholderReadiness?.blockerCode
            ? l(
                `Module blocker: ${activationShareholderReadiness.blockerCode}.`,
                `Modul engeli: ${activationShareholderReadiness.blockerCode}.`
              )
            : workspaceShareholders.length > 0
              ? l(
                  `${workspaceShareholders.length} shareholder row(s) are already present in this legal entity.`,
                  `Bu legal entity icinde zaten ${workspaceShareholders.length} ortak satiri var.`
                )
              : l(
                  "No shareholder setup row is present for this legal entity yet.",
                  "Bu legal entity icin henuz ortak kurulum satiri yok."
                ),
      },
      {
        key: "localClose",
        title: l("Local readiness blockers", "Yerel hazirlik engelleri"),
        ready: Boolean(
          activationLocalCloseReadiness?.ready ||
            activationLocalCloseReadiness?.applicable === false
        ),
        detail: activationLocalCloseReadiness?.ready
          ? l(
              "Local close workflow prerequisites are already ready for this entity.",
              "Bu entity icin yerel kapanis workflow on kosullari zaten hazir."
            )
          : activationLocalCloseReadiness?.blockerCode
            ? l(
                `Local-close blocker: ${activationLocalCloseReadiness.blockerCode}.`,
                `Yerel kapanis engeli: ${activationLocalCloseReadiness.blockerCode}.`
              )
            : l(
                "Review local close prerequisites and other entity-level blockers from this workspace.",
                "Bu alandan yerel kapanis on kosullarini ve diger entity seviyesi engelleri inceleyin."
              ),
        actionPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
      },
      {
        key: "bankControlParent",
        title: l("Bank control-parent mapping", "Banka control-parent eslemesi"),
        ready: Boolean(
          activationBankControlParentReadiness?.ready ||
            activationBankControlParentReadiness?.applicable === false
        ),
        detail: activationBankControlParentReadiness?.ready
          ? l(
              "Bank control-parent readiness is already satisfied for this entity.",
              "Bu entity icin banka control-parent hazirligi zaten saglandi."
            )
          : activationBankControlParentReadiness?.blockerCode
            ? l(
                `Bank control-parent blocker: ${activationBankControlParentReadiness.blockerCode}.`,
                `Banka control-parent engeli: ${activationBankControlParentReadiness.blockerCode}.`
              )
            : l(
                "Review bank control-parent mapping if bank setup will be used here.",
                "Burada banka kurulumu kullanilacaksa banka control-parent eslemesini inceleyin."
              ),
      },
    ];
  }, [
    activationBankAccountsError,
    activationBankAccountsLoading,
    activationBankControlParentReadiness?.applicable,
    activationBankControlParentReadiness?.blockerCode,
    activationBankControlParentReadiness?.ready,
    activationFocusLegalEntity?.code,
    activationFocusLegalEntity?.name,
    activationFocusLegalEntityId,
    activationLocalCloseReadiness?.applicable,
    activationLocalCloseReadiness?.blockerCode,
    activationLocalCloseReadiness?.ready,
    activationOperatingUnitCurrentAccountReadiness,
    activationReadyBankAccounts.length,
    activationReadyCashRegisters.length,
    activationShareholderReadiness?.blockerCode,
    activationShareholderReadiness?.ready,
    activationCashRegistersError,
    activationCashRegistersLoading,
    canReadBanks,
    canReadCashRegisters,
    l,
    periods.length,
    workspaceBooks.length,
    workspaceCalendarOptions.length,
    workspaceCoas.length,
    workspaceOperatingUnits.length,
    workspaceShareholders.length,
  ]);
  useEffect(() => {
    if (
      !capitalFulfillmentModalOpen ||
      !canReadBanks ||
      capitalFulfillmentForm.destinationMode !== "BANK_ACCOUNT" ||
      !capitalFulfillmentLegalEntityId
    ) {
      if (!capitalFulfillmentModalOpen) {
        setCapitalFulfillmentBankAccounts([]);
        setCapitalFulfillmentBankError("");
      }
      return undefined;
    }

    let active = true;
    setCapitalFulfillmentBankLoading(true);
    setCapitalFulfillmentBankError("");

    listBankAccounts({
      legalEntityId: capitalFulfillmentLegalEntityId,
      operatingUnitId: capitalFulfillmentOperatingUnitId || undefined,
      isActive: true,
      limit: 300,
      offset: 0,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentBankAccounts(response?.rows || []);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentBankAccounts([]);
        setCapitalFulfillmentBankError(
          err?.response?.data?.message ||
          l("Failed to load bank accounts.", "Banka hesaplari yuklenemedi.")
        );
      })
      .finally(() => {
        if (active) {
          setCapitalFulfillmentBankLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    canReadBanks,
    capitalFulfillmentForm.destinationMode,
    capitalFulfillmentLegalEntityId,
    capitalFulfillmentModalOpen,
    capitalFulfillmentOperatingUnitId,
    l,
  ]);
  useEffect(() => {
    if (
      !capitalFulfillmentModalOpen ||
      !canReadCashRegisters ||
      capitalFulfillmentForm.destinationMode !== "CASH_REGISTER" ||
      !capitalFulfillmentLegalEntityId
    ) {
      if (!capitalFulfillmentModalOpen) {
        setCapitalFulfillmentCashRegisters([]);
        setCapitalFulfillmentCashRegistersError("");
        setCapitalFulfillmentOpenCashSessions([]);
        setCapitalFulfillmentCashSessionsError("");
      }
      return undefined;
    }

    let active = true;
    setCapitalFulfillmentCashRegistersLoading(true);
    setCapitalFulfillmentCashRegistersError("");

    listCashRegisters({
      legalEntityId: capitalFulfillmentLegalEntityId,
      status: "ACTIVE",
      limit: 300,
      offset: 0,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentCashRegisters(response?.rows || []);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentCashRegisters([]);
        setCapitalFulfillmentCashRegistersError(
          err?.response?.data?.message ||
          l("Failed to load cash registers.", "Kasalar yuklenemedi.")
        );
      })
      .finally(() => {
        if (active) {
          setCapitalFulfillmentCashRegistersLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    canReadCashRegisters,
    capitalFulfillmentForm.destinationMode,
    capitalFulfillmentLegalEntityId,
    capitalFulfillmentModalOpen,
    l,
  ]);
  useEffect(() => {
    if (
      !capitalFulfillmentModalOpen ||
      !canReadCashSessions ||
      capitalFulfillmentForm.destinationMode !== "CASH_REGISTER" ||
      !capitalFulfillmentCashSessionRequired ||
      !toNumber(capitalFulfillmentForm.cashRegisterId)
    ) {
      setCapitalFulfillmentOpenCashSessions([]);
      setCapitalFulfillmentCashSessionsError("");
      setCapitalFulfillmentCashSessionsLoading(false);
      return undefined;
    }

    let active = true;
    setCapitalFulfillmentCashSessionsLoading(true);
    setCapitalFulfillmentCashSessionsError("");

    listCashSessions({
      registerId: toNumber(capitalFulfillmentForm.cashRegisterId),
      status: "OPEN",
      limit: 300,
      offset: 0,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentOpenCashSessions(response?.rows || []);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setCapitalFulfillmentOpenCashSessions([]);
        setCapitalFulfillmentCashSessionsError(
          err?.response?.data?.message ||
          l("Failed to load open cash sessions.", "Acik kasa oturumlari yuklenemedi.")
        );
      })
      .finally(() => {
        if (active) {
          setCapitalFulfillmentCashSessionsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    canReadCashSessions,
    capitalFulfillmentCashSessionRequired,
    capitalFulfillmentForm.cashRegisterId,
    capitalFulfillmentForm.destinationMode,
    capitalFulfillmentModalOpen,
    l,
  ]);
  useEffect(() => {
    if (
      capitalFulfillmentForm.destinationMode !== "CASH_REGISTER" ||
      capitalFulfillmentCashSessionRequired
    ) {
      return;
    }
    if (!capitalFulfillmentForm.cashSessionId) {
      return;
    }
    updateCapitalFulfillmentForm({
      cashSessionId: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capitalFulfillmentCashSessionRequired, capitalFulfillmentForm.destinationMode]);
  useEffect(() => {
    if (capitalFulfillmentForm.destinationMode !== "CASH_REGISTER") {
      return;
    }
    const cashRegisterId = toNumber(capitalFulfillmentForm.cashRegisterId);
    if (!cashRegisterId) {
      return;
    }
    const registerStillVisible = capitalFulfillmentCashRegisterOptions.some(
      (row) => toNumber(row.id) === cashRegisterId
    );
    if (registerStillVisible) {
      return;
    }
    updateCapitalFulfillmentForm({
      cashRegisterId: "",
      cashSessionId: "",
    });
  }, [
    capitalFulfillmentCashRegisterOptions,
    capitalFulfillmentForm.cashRegisterId,
    capitalFulfillmentForm.destinationMode,
  ]);
  useEffect(() => {
    if (
      capitalFulfillmentForm.destinationMode !== "CASH_REGISTER" ||
      !capitalFulfillmentCashSessionRequired
    ) {
      return;
    }
    const cashSessionId = toNumber(capitalFulfillmentForm.cashSessionId);
    if (!cashSessionId) {
      return;
    }
    const sessionStillVisible = capitalFulfillmentCashSessionOptions.some(
      (row) => toNumber(row.id) === cashSessionId
    );
    if (sessionStillVisible) {
      return;
    }
    updateCapitalFulfillmentForm({
      cashSessionId: "",
    });
  }, [
    capitalFulfillmentCashSessionOptions,
    capitalFulfillmentCashSessionRequired,
    capitalFulfillmentForm.cashSessionId,
    capitalFulfillmentForm.destinationMode,
  ]);
  useEffect(() => {
    if (!selectedShareholderLegalEntityId) {
      setCapitalFulfillmentHistory([]);
      setCapitalFulfillmentHistoryError("");
      return;
    }
    loadCapitalFulfillmentHistory(selectedShareholderLegalEntityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShareholderLegalEntityId, canReadShareholders]);
  const selectedShareholderCommitmentReadiness = getModuleRow(
    "shareholderCommitment",
    selectedShareholderLegalEntityId
  );
  const shareholderCommitmentModuleNotReady = Boolean(
    selectedShareholderCommitmentReadiness &&
    !selectedShareholderCommitmentReadiness.ready
  );
  const shareholderSetupSteps = useMemo(() => {
    const queueCount = pendingBatchCommitmentShareholders.length;
    const previewReady =
      queueCount > 0 &&
      Boolean(batchPreviewData) &&
      !batchPreviewData?.validation?.has_blocking_errors &&
      Number(batchPreviewData?.included_shareholders?.length || 0) > 0;

    const stepDefinitions = [
      {
        key: "selectLegalEntity",
        label: l("Tuzel Kisi Sec", "Tuzel Kisi Sec"),
        done: Boolean(selectedShareholderLegalEntityId),
      },
      {
        key: "saveParentMapping",
        label: l(
          "Parent Hesap Eslemesi Kaydet",
          "Parent Hesap Eslemesi Kaydet"
        ),
        done: hasShareholderParentMapping,
      },
      {
        key: "autoProvisionSubAccounts",
        label: l(
          "Alt Hesaplari Otomatik Olustur",
          "Alt Hesaplari Otomatik Olustur"
        ),
        done:
          hasShareholderParentMapping &&
          !hasMissingCreditEquitySubAccount &&
          !hasMissingDebitEquitySubAccount,
      },
      {
        key: "saveShareholders",
        label: l(
          "Ortaklari Kaydet / Guncelle",
          "Ortaklari Kaydet / Guncelle"
        ),
        done: visibleShareholders.length > 0,
      },
      {
        key: "previewBatchJournal",
        label: l(
          "Toplu Taahhut Fisi Taslagi Olustur",
          "Toplu Taahhut Fisi Taslagi Olustur"
        ),
        done: queueCount === 0 ? true : previewReady,
      },
    ];

    const firstWaitingIndex = stepDefinitions.findIndex((step) => !step.done);
    return stepDefinitions.map((step, index) => ({
      ...step,
      status:
        step.done
          ? "DONE"
          : firstWaitingIndex === index
            ? "CURRENT"
            : "WAITING",
    }));
  }, [
    batchPreviewData,
    hasMissingCreditEquitySubAccount,
    hasMissingDebitEquitySubAccount,
    hasShareholderParentMapping,
    l,
    pendingBatchCommitmentShareholders.length,
    selectedShareholderLegalEntityId,
    visibleShareholders.length,
  ]);
  const nextShareholderSetupStep = useMemo(
    () =>
      shareholderSetupSteps.find((step) => step.status === "CURRENT") ||
      shareholderSetupSteps.find((step) => step.status !== "DONE") ||
      null,
    [shareholderSetupSteps]
  );
  const batchPreviewBlockingErrors = Array.isArray(
    batchPreviewData?.validation?.blocking_errors
  )
    ? batchPreviewData.validation.blocking_errors
    : [];
  const batchPreviewWarnings = Array.isArray(batchPreviewData?.validation?.warnings)
    ? batchPreviewData.validation.warnings
    : [];
  const batchPreviewIncludedRows = Array.isArray(
    batchPreviewData?.included_shareholders
  )
    ? batchPreviewData.included_shareholders
    : [];
  const batchPreviewSkippedRows = Array.isArray(
    batchPreviewData?.skipped_shareholders
  )
    ? batchPreviewData.skipped_shareholders
    : [];
  const batchPreviewHasBlockingErrors = Boolean(
    batchPreviewData?.validation?.has_blocking_errors ||
    batchPreviewBlockingErrors.length > 0
  );

  useEffect(() => {
    if (!selectedShareholderLegalEntityId) {
      setShareholderParentConfigForm({
        capitalCreditParentAccountId: "",
        commitmentDebitParentAccountId: "",
      });
      return;
    }
    setShareholderParentConfigForm({
      capitalCreditParentAccountId: selectedCapitalCreditParentAccountId
        ? String(selectedCapitalCreditParentAccountId)
        : "",
      commitmentDebitParentAccountId: selectedCommitmentDebitParentAccountId
        ? String(selectedCommitmentDebitParentAccountId)
        : "",
    });
  }, [
    selectedCapitalCreditParentAccountId,
    selectedCommitmentDebitParentAccountId,
    selectedShareholderLegalEntityId,
  ]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        SHAREHOLDER_BATCH_QUEUE_STORAGE_KEY
      );
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      const sanitized = Object.fromEntries(
        Object.entries(parsed).map(([entityId, ids]) => [
          String(entityId),
          Array.from(new Set((Array.isArray(ids) ? ids : []).map(toNumber).filter(Boolean))),
        ])
      );
      setCommitmentBatchQueueByEntity(sanitized);
    } catch {
      // Ignore localStorage parse failures.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHAREHOLDER_BATCH_QUEUE_STORAGE_KEY,
        JSON.stringify(commitmentBatchQueueByEntity || {})
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [commitmentBatchQueueByEntity]);

  useEffect(() => {
    const existingIdsByEntity = new Map();
    for (const row of shareholders) {
      const entityId = String(toNumber(row.legal_entity_id) || "");
      const shareholderId = toNumber(row.id);
      if (!entityId || !shareholderId) {
        continue;
      }
      if (!existingIdsByEntity.has(entityId)) {
        existingIdsByEntity.set(entityId, new Set());
      }
      existingIdsByEntity.get(entityId).add(shareholderId);
    }

    setCommitmentBatchQueueByEntity((prev) => {
      const next = {};
      let changed = false;
      for (const [entityId, ids] of Object.entries(prev || {})) {
        const existingIds = existingIdsByEntity.get(String(entityId)) || new Set();
        const filteredIds = Array.from(
          new Set((Array.isArray(ids) ? ids : []).map(toNumber).filter(Boolean))
        ).filter((id) => existingIds.has(id));
        if (filteredIds.length > 0) {
          next[String(entityId)] = filteredIds;
        }
        if (
          filteredIds.length !== (Array.isArray(ids) ? ids.length : 0) ||
          (filteredIds.length > 0 &&
            JSON.stringify(filteredIds) !==
            JSON.stringify(Array.isArray(ids) ? ids : []))
        ) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [shareholders]);

  useEffect(() => {
    setBatchPreviewData(null);
  }, [batchCommitmentDate, selectedShareholderLegalEntityId, selectedEntityCommitmentQueueIds]);

  useEffect(() => {
    if (!commitmentIncreaseModalOpen) {
      return;
    }
    const defaultShareholderId = toNumber(
      eligibleShareholdersForCommitmentIncrease[0]?.id
    );
    if (!defaultShareholderId) {
      setCommitmentIncreaseModalOpen(false);
      return;
    }
    if (!toNumber(commitmentIncreaseForm.shareholderId)) {
      setCommitmentIncreaseForm((prev) => ({
        ...prev,
        shareholderId: String(defaultShareholderId),
      }));
      return;
    }
    const exists = eligibleShareholdersForCommitmentIncrease.some(
      (row) => toNumber(row.id) === toNumber(commitmentIncreaseForm.shareholderId)
    );
    if (!exists) {
      setCommitmentIncreaseForm((prev) => ({
        ...prev,
        shareholderId: String(defaultShareholderId),
      }));
    }
  }, [
    commitmentIncreaseForm.shareholderId,
    commitmentIncreaseModalOpen,
    eligibleShareholdersForCommitmentIncrease,
  ]);

  const updateQueueForSelectedEntity = useCallback(
    (updater) => {
      const entityId = toNumber(selectedShareholderLegalEntityId);
      if (!entityId) {
        setError(l("Select legal entity first.", "Once istirak / bagli ortak secin."));
        return;
      }

      const key = String(entityId);
      setCommitmentBatchQueueByEntity((prev) => {
        const current = Array.from(
          new Set((prev?.[key] || []).map((value) => toNumber(value)).filter(Boolean))
        );
        const nextIdsRaw =
          typeof updater === "function" ? updater(current) : Array.isArray(updater) ? updater : [];
        const nextIds = Array.from(
          new Set((Array.isArray(nextIdsRaw) ? nextIdsRaw : []).map((value) => toNumber(value)).filter(Boolean))
        );
        const next = { ...(prev || {}) };
        if (nextIds.length > 0) {
          next[key] = nextIds;
        } else {
          delete next[key];
        }
        return next;
      });
    },
    [l, selectedShareholderLegalEntityId]
  );

  const handleQueueShareholderToggle = useCallback(
    (shareholderId, shouldQueue) => {
      const normalizedId = toNumber(shareholderId);
      if (!normalizedId) {
        return;
      }
      updateQueueForSelectedEntity((currentIds) => {
        const nextSet = new Set(currentIds);
        if (shouldQueue) {
          nextSet.add(normalizedId);
        } else {
          nextSet.delete(normalizedId);
        }
        return Array.from(nextSet);
      });
    },
    [updateQueueForSelectedEntity]
  );

  const handleQueueKeepOnlyCurrency = useCallback(
    (currencyCode) => {
      const selectedGroup = pendingBatchQueueCurrencyGroups.find(
        (group) => group.currencyCode === currencyCode
      );
      updateQueueForSelectedEntity(selectedGroup?.shareholderIds || []);
      setBatchPreviewData(null);
      setMessage(
        l(
          `Queue filtered to currency ${currencyCode}.`,
          `Kuyruk ${currencyCode} para birimine filtrelendi.`
        )
      );
    },
    [l, pendingBatchQueueCurrencyGroups, updateQueueForSelectedEntity]
  );

  function resetGroupForm() {
    setGroupForm({ code: "", name: "" });
    setGroupEditingCode("");
  }

  function handleGroupEdit(row) {
    const code = String(row?.code || "").trim();
    const name = String(row?.name || "").trim();
    if (!code) {
      return;
    }
    setGroupEditingCode(code);
    setGroupForm({ code, name });
    setError("");
    setMessage("");
  }

  function getRecommendedPolicyPackIdForCountryId(countryId) {
    const countryIso2 = normalizeUpperText(countryById.get(toNumber(countryId))?.iso2);
    return String((policyPacksByCountry.get(countryIso2) || [])[0]?.packId || "").trim();
  }

  function resetLegalEntityForm() {
    setEntityForm((prev) => ({
      ...prev,
      ...DEFAULT_ENTITY_FORM,
      groupCompanyId: prev.groupCompanyId,
      countryId: prev.countryId,
      functionalCurrencyCode: prev.functionalCurrencyCode || "USD",
      policyPackId: getRecommendedPolicyPackIdForCountryId(prev.countryId),
    }));
    setLegalEntityEditingCode("");
    setError("");
    setMessage("");
  }

  function handleOperatingUnitCurrentAccountConfigEntityChange(legalEntityId) {
    const selectedRow =
      operatingUnitCurrentAccountConfigs.find(
        (row) => String(row?.legal_entity_id || "") === String(legalEntityId || "")
      ) || null;
    setOperatingUnitCurrentAccountConfigForm(
      buildOperatingUnitCurrentAccountConfigForm(legalEntityId, selectedRow)
    );
    setError("");
    setMessage("");
  }

  function handleOperatingUnitCurrentAccountConfigEdit(row) {
    const legalEntityId = String(row?.legal_entity_id || "").trim();
    if (!legalEntityId) {
      return;
    }
    setOperatingUnitCurrentAccountConfigForm(
      buildOperatingUnitCurrentAccountConfigForm(legalEntityId, row)
    );
    setError("");
    setMessage("");
  }

  function resetUnitForm() {
    setUnitForm((prev) => ({
      ...DEFAULT_UNIT_FORM,
      legalEntityId: prev.legalEntityId || String(legalEntities[0]?.id || ""),
    }));
    setUnitEditingKey("");
    setError("");
    setMessage("");
  }

  function resetUnitPartnerCurrentForm() {
    setUnitPartnerCurrentForm((prev) => ({
      ...DEFAULT_UNIT_PARTNER_CURRENT_FORM,
      legalEntityId: prev.legalEntityId || String(legalEntities[0]?.id || ""),
    }));
    setUnitPartnerCurrentEditingKey("");
    setError("");
    setMessage("");
  }

  function handleLegalEntityEdit(row) {
    const code = String(row?.code || "").trim();
    if (!code) {
      return;
    }
    setLegalEntityEditingCode(code);
    setEntityForm((prev) => ({
      ...prev,
      groupCompanyId: String(row?.group_company_id || ""),
      code,
      name: String(row?.name || "").trim(),
      taxId: String(row?.tax_id || "").trim(),
      countryId: String(row?.country_id || ""),
      functionalCurrencyCode: String(row?.functional_currency_code || prev.functionalCurrencyCode || "USD")
        .trim()
        .toUpperCase(),
      status: normalizeUpperText(row?.status) || "INACTIVE",
      isIntercompanyEnabled:
        row?.is_intercompany_enabled === undefined
          ? true
          : Boolean(row?.is_intercompany_enabled),
      intercompanyPartnerRequired: Boolean(row?.intercompany_partner_required),
      policyPackId: getRecommendedPolicyPackIdForCountryId(row?.country_id),
      useCustomPaymentTerms: false,
      paymentTermsJson: "",
    }));
    setError("");
    setMessage("");
  }

  function handleOperatingUnitEdit(row) {
    const code = String(row?.code || "").trim();
    const legalEntityId = String(row?.legal_entity_id || "").trim();
    if (!code || !legalEntityId) {
      return;
    }
    setUnitEditingKey(`${legalEntityId}:${code}`);
    setUnitForm({
      ...DEFAULT_UNIT_FORM,
      legalEntityId,
      code,
      name: String(row?.name || "").trim(),
      unitType: String(row?.unit_type || "BRANCH").trim().toUpperCase() || "BRANCH",
      hasSubledger: Boolean(row?.has_subledger),
      centralDueFromAccountId: String(row?.central_due_from_account_id || ""),
      centralDueToAccountId: String(row?.central_due_to_account_id || ""),
      ouDueFromCentralAccountId: String(row?.ou_due_from_central_account_id || ""),
      ouDueToCentralAccountId: String(row?.ou_due_to_central_account_id || ""),
    });
    setError("");
    setMessage("");
  }

  function handleOperatingUnitPartnerCurrentEdit(row) {
    const legalEntityId = String(row?.legal_entity_id || "").trim();
    const operatingUnitId = String(row?.operating_unit_id || "").trim();
    const partnerOperatingUnitId = String(row?.partner_operating_unit_id || "").trim();
    if (!legalEntityId || !operatingUnitId || !partnerOperatingUnitId) {
      return;
    }
    setUnitPartnerCurrentEditingKey(`${operatingUnitId}:${partnerOperatingUnitId}`);
    setUnitPartnerCurrentForm({
      ...DEFAULT_UNIT_PARTNER_CURRENT_FORM,
      legalEntityId,
      operatingUnitId,
      partnerOperatingUnitId,
      dueFromAccountId: String(row?.due_from_account_id || ""),
      dueToAccountId: String(row?.due_to_account_id || ""),
    });
    setError("");
    setMessage("");
  }

  async function handleGroupSubmit(event) {
    event.preventDefault();
    if (!canUpsertGroupCompany) {
      setError(l("Missing permission: org.group_company.upsert", "Eksik yetki: org.group_company.upsert"));
      return;
    }

    const normalizedCode = String(groupForm.code || "").trim();
    const normalizedName = String(groupForm.name || "").trim();
    const isEditMode = Boolean(groupEditingCode);
    if (!normalizedCode || !normalizedName) {
      setError(l("Code and name are required.", "Kod ve ad zorunludur."));
      return;
    }

    setSaving("group");
    setError("");
    setMessage("");
    try {
      await upsertGroupCompany({
        code: normalizedCode,
        name: normalizedName,
      });
      resetGroupForm();
      setMessage(
        isEditMode
          ? l("Group company updated.", "Grup sirketi guncellendi.")
          : l("Group company saved.", "Grup sirketi kaydedildi.")
      );
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save group company.", "Grup sirketi kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleLegalEntitySubmit(event) {
    event.preventDefault();
    if (!canUpsertLegalEntity) {
      setError(l("Missing permission: org.legal_entity.upsert", "Eksik yetki: org.legal_entity.upsert"));
      return;
    }

    const groupCompanyId = toNumber(entityForm.groupCompanyId);
    const countryId = toNumber(entityForm.countryId);
    if (!groupCompanyId || !countryId) {
      setError(l("groupCompanyId and countryId are required.", "groupCompanyId ve countryId zorunludur."));
      return;
    }

    let paymentTermsPayload;
    if (entityForm.useCustomPaymentTerms) {
      const rawPaymentTerms = String(entityForm.paymentTermsJson || "").trim();
      if (!rawPaymentTerms) {
        setError(
          l(
            "Custom payment terms JSON is required when custom mode is enabled.",
            "Ozel odeme kosulu modu acikken custom JSON zorunludur."
          )
        );
        return;
      }

      try {
        const parsed = JSON.parse(rawPaymentTerms);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          setError(
            l(
              "Custom payment terms must be a non-empty JSON array.",
              "Ozel odeme kosullari bos olmayan bir JSON dizi olmali."
            )
          );
          return;
        }
        paymentTermsPayload = parsed;
      } catch {
        setError(
          l(
            "Custom payment terms JSON is invalid.",
            "Ozel odeme kosullari JSON formati gecersiz."
          )
        );
        return;
      }
    }

    const isEditMode = Boolean(legalEntityEditingCode);

    setSaving("entity");
    setError("");
    setMessage("");
    try {
      const response = await upsertLegalEntity({
        groupCompanyId,
        code: entityForm.code.trim(),
        name: entityForm.name.trim(),
        taxId: entityForm.taxId.trim() || undefined,
        countryId,
        functionalCurrencyCode: entityForm.functionalCurrencyCode
          .trim()
          .toUpperCase(),
        status: entityForm.status,
        isIntercompanyEnabled: Boolean(entityForm.isIntercompanyEnabled),
        intercompanyPartnerRequired: Boolean(entityForm.intercompanyPartnerRequired),
        autoProvisionDefaults: Boolean(entityForm.autoProvisionDefaults),
        policyPackId: entityForm.policyPackId.trim().toUpperCase() || undefined,
        ...(paymentTermsPayload ? { paymentTerms: paymentTermsPayload } : {}),
      });

      resetLegalEntityForm();
      const baseSuccessMessage = isEditMode
        ? l("Legal entity updated.", "Istirak / bagli ortak guncellendi.")
        : l("Legal entity saved.", "Istirak / bagli ortak kaydedildi.");
      const hasGlProvisioning = Boolean(response?.provisioning?.created);
      const hasPaymentTermProvisioning = Boolean(response?.paymentTermsProvisioning);
      if (hasGlProvisioning || hasPaymentTermProvisioning) {
        const created = response?.provisioning?.created || null;
        const accountTemplate = response?.provisioning?.accountTemplate || null;
        const paymentTermsProvisioning = response?.paymentTermsProvisioning || null;
        const hasCreatedCounts = Boolean(
          created &&
            [
              created.fiscalCalendars,
              created.fiscalPeriods,
              created.chartsOfAccounts,
              created.accounts,
              created.books,
            ].some((value) => Number(value || 0) > 0)
        );
        const templateSummary = accountTemplate
          ? l(
              `Account template: ${accountTemplate.packId || "BASELINE_DEFAULTS"}.`,
              `Hesap sablonu: ${accountTemplate.packId || "BASELINE_DEFAULTS"}.`
            )
          : "";
        const overwriteSummary = accountTemplate?.overwriteApplied
          ? l(
              `Existing CoA accounts cleared ${accountTemplate.clearedAccountCount} and replaced from the selected template.`,
              `Mevcut hesap plani hesaplari temizlendi ${accountTemplate.clearedAccountCount} ve secilen sablondan yeniden yuklendi.`
            )
          : accountTemplate?.skippedBecauseExistingAccounts
            ? l(
                `Existing CoA already has ${accountTemplate.existingAccountCount} accounts, so account seeding was skipped. Use Hesap Plani Olustur to merge or replace that CoA if needed.`,
                `Mevcut hesap planinda zaten ${accountTemplate.existingAccountCount} hesap var; bu nedenle hesap yukleme atlandi. Gerekirse bu hesap planini merge etmek veya degistirmek icin Hesap Plani Olustur sayfasini kullanin.`
              )
            : "";
        const glSummary = hasCreatedCounts
          ? l(
            `Defaults created: calendar ${created.fiscalCalendars}, periods ${created.fiscalPeriods}, CoA ${created.chartsOfAccounts}, accounts ${created.accounts}, books ${created.books}.`,
            `Varsayilanlar olusturuldu: takvim ${created.fiscalCalendars}, donem ${created.fiscalPeriods}, hesap plani ${created.chartsOfAccounts}, hesap ${created.accounts}, defter ${created.books}.`
          )
          : "";
        const paymentTermsSummary = paymentTermsProvisioning
          ? l(
            `Payment terms: created ${paymentTermsProvisioning.createdCount}, skipped ${paymentTermsProvisioning.skippedCount}.`,
            `Odeme kosullari: olusturulan ${paymentTermsProvisioning.createdCount}, atlanan ${paymentTermsProvisioning.skippedCount}.`
          )
          : "";
        const detailMessage = [
          templateSummary,
          overwriteSummary,
          glSummary,
          paymentTermsSummary,
        ]
          .filter(Boolean)
          .join(" ");
        setMessage(`${baseSuccessMessage} ${detailMessage}`.trim());
      } else {
        const lifecycleMessage =
          normalizeUpperText(response?.status) === "INACTIVE"
            ? l(
                " Saved as inactive, so tenant-wide readiness will ignore this entity until you activate it.",
                " Pasif kaydedildi; siz aktiflestirene kadar tenant geneli hazirlik bu entity'i dikkate almaz."
              )
            : "";
        setMessage(`${baseSuccessMessage}${lifecycleMessage}`);
      }
      refreshLookups();
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save legal entity.", "Istirak / bagli ortak kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleOperatingUnitCurrentAccountConfigSubmit(event) {
    event.preventDefault();
    if (!canUpsertLegalEntity) {
      setError(
        l(
          "Missing permission: org.legal_entity.upsert",
          "Eksik yetki: org.legal_entity.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(operatingUnitCurrentAccountConfigForm.legalEntityId);
    const dueFromParentAccountId = toNumber(
      operatingUnitCurrentAccountConfigForm.dueFromParentAccountId
    );
    const dueToParentAccountId = toNumber(
      operatingUnitCurrentAccountConfigForm.dueToParentAccountId
    );

    if (!legalEntityId || !dueFromParentAccountId || !dueToParentAccountId) {
      setError(
        l(
          "Select legal entity, Due From parent, and Due To parent first.",
          "Once legal entity, Alacak parent ve Borc parent hesaplarini secin."
        )
      );
      return;
    }
    if (dueFromParentAccountId === dueToParentAccountId) {
      setError(
        l(
          "Due To parent must be different from Due From parent.",
          "Borc parent hesabi, Alacak parent hesabindan farkli olmalidir."
        )
      );
      return;
    }

    setSaving("operating-unit-current-account-config");
    setError("");
    setMessage("");
    try {
      await upsertOperatingUnitCurrentAccountConfig({
        legalEntityId,
        dueFromParentAccountId,
        dueToParentAccountId,
        autoProvisionOnOperatingUnitCreate: Boolean(
          operatingUnitCurrentAccountConfigForm.autoProvisionOnOperatingUnitCreate
        ),
      });
      setMessage(
        l(
          "Operating unit current-account config saved.",
          "Operasyon birimi cari hesap konfigurasyonu kaydedildi."
        )
      );
      await Promise.all([loadCoreData(), refreshLegalEntity(legalEntityId)]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to save operating unit current-account config.",
            "Operasyon birimi cari hesap konfigurasyonu kaydedilemedi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleApplyOperatingUnitCurrentAccounts({
    legalEntityId,
    operatingUnitId = null,
  }) {
    if (!canUpsertAccounts || !canUpsertOperatingUnit) {
      setError(
        !canUpsertAccounts
          ? l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert")
          : l(
              "Missing permission: org.operating_unit.upsert",
              "Eksik yetki: org.operating_unit.upsert"
            )
      );
      return;
    }
    if (!toNumber(legalEntityId)) {
      setError(
        l(
          "Select legal entity first.",
          "Once legal entity secin."
        )
      );
      return;
    }

    setSaving("operating-unit-current-account-apply");
    setError("");
    setMessage("");
    try {
      const response = await applyOperatingUnitCurrentAccountConfig({
        legalEntityId,
        operatingUnitId: toNumber(operatingUnitId) || undefined,
        repairMissingOnly: true,
      });
      const baseSuccessMessage = toNumber(operatingUnitId)
        ? l(
            "Current-account delta applied for branch.",
            "Sube icin cari hesap deltasi uygulandi."
          )
        : l(
            "Saved current-account config applied to active branches.",
            "Kaydedilen cari hesap konfigurasyonu aktif subelere uygulandi."
          );
      const detailMessage = formatOperatingUnitCurrentAccountApplySummary(l, response);
      setMessage(detailMessage ? `${baseSuccessMessage} ${detailMessage}` : baseSuccessMessage);
      await Promise.all([loadCoreData(), refreshLegalEntity(legalEntityId)]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to apply saved current-account config.",
            "Kaydedilen cari hesap konfigurasyonu uygulanamadi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleOperatingUnitSubmit(event) {
    event.preventDefault();
    if (!canUpsertOperatingUnit) {
      setError(l("Missing permission: org.operating_unit.upsert", "Eksik yetki: org.operating_unit.upsert"));
      return;
    }

    const legalEntityId = toNumber(unitForm.legalEntityId);
    const centralDueFromAccountId = toNumber(unitForm.centralDueFromAccountId);
    const centralDueToAccountId = toNumber(unitForm.centralDueToAccountId);
    const ouDueFromCentralAccountId = toNumber(unitForm.ouDueFromCentralAccountId);
    const ouDueToCentralAccountId = toNumber(unitForm.ouDueToCentralAccountId);
    if (!legalEntityId) {
      setError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }
    const mappingFieldChecks = [
      {
        accountId: centralDueFromAccountId,
        rowField: "central_due_from_account_id",
        labelEn: "Central due-from account",
        labelTr: "Merkez alacak hesabi",
      },
      {
        accountId: centralDueToAccountId,
        rowField: "central_due_to_account_id",
        labelEn: "Central due-to account",
        labelTr: "Merkez borc hesabi",
      },
      {
        accountId: ouDueFromCentralAccountId,
        rowField: "ou_due_from_central_account_id",
        labelEn: "OU due-from-central account",
        labelTr: "OU merkezden alacak hesabi",
      },
      {
        accountId: ouDueToCentralAccountId,
        rowField: "ou_due_to_central_account_id",
        labelEn: "OU due-to-central account",
        labelTr: "OU merkeze borc hesabi",
      },
    ];
    for (const fieldCheck of mappingFieldChecks) {
      const conflictingUnit = fieldCheck.accountId
        ? (operatingUnits || []).find((row) => {
            const rowKey = `${row?.legal_entity_id || ""}:${String(row?.code || "").trim()}`;
            return (
              rowKey !== unitEditingKey &&
              toNumber(row?.legal_entity_id) === legalEntityId &&
              toNumber(row?.[fieldCheck.rowField]) === fieldCheck.accountId
            );
          })
        : null;
      if (conflictingUnit) {
        setError(
          l(
            `${fieldCheck.labelEn} is already assigned to operating unit ${formatOperatingUnitLabel(conflictingUnit)}. Use a branch-specific account.`,
            `${fieldCheck.labelTr} zaten ${formatOperatingUnitLabel(conflictingUnit)} operasyon birimine atanmis. Subeye ozel bir hesap kullanin.`
          )
        );
        return;
      }
    }

    setSaving("unit");
    setError("");
    setMessage("");
    try {
      const response = await upsertOperatingUnit({
        legalEntityId,
        code: unitForm.code.trim(),
        name: unitForm.name.trim(),
        unitType: unitForm.unitType,
        hasSubledger: Boolean(unitForm.hasSubledger),
        centralDueFromAccountId: centralDueFromAccountId || undefined,
        centralDueToAccountId: centralDueToAccountId || undefined,
        ouDueFromCentralAccountId: ouDueFromCentralAccountId || undefined,
        ouDueToCentralAccountId: ouDueToCentralAccountId || undefined,
      });
      const successMessage = unitEditingKey
        ? l("Operating unit updated.", "Operasyon birimi guncellendi.")
        : l("Operating unit saved.", "Operasyon birimi kaydedildi.");
      resetUnitForm();
      const provisioningMessage = formatOperatingUnitCreateProvisioningMessage(
        l,
        response?.currentAccountProvisioning
      );
      setMessage(
        provisioningMessage ? `${successMessage} ${provisioningMessage}`.trim() : successMessage
      );
      refreshLookups();
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save operating unit.", "Operasyon birimi kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleOperatingUnitPartnerCurrentSubmit(event) {
    event.preventDefault();
    if (!canUpsertOperatingUnit) {
      setError(
        l(
          "Missing permission: org.operating_unit.upsert",
          "Eksik yetki: org.operating_unit.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(unitPartnerCurrentForm.legalEntityId);
    const operatingUnitId = toNumber(unitPartnerCurrentForm.operatingUnitId);
    const partnerOperatingUnitId = toNumber(unitPartnerCurrentForm.partnerOperatingUnitId);
    const dueFromAccountId = toNumber(unitPartnerCurrentForm.dueFromAccountId);
    const dueToAccountId = toNumber(unitPartnerCurrentForm.dueToAccountId);
    if (!legalEntityId || !operatingUnitId || !partnerOperatingUnitId) {
      setError(
        l(
          "legalEntityId, operatingUnitId, and partnerOperatingUnitId are required.",
          "legalEntityId, operatingUnitId ve partnerOperatingUnitId zorunludur."
        )
      );
      return;
    }
    if (!dueFromAccountId || !dueToAccountId) {
      setError(
        l(
          "Both Due From Partner and Due To Partner accounts are required.",
          "Partnerden Alacak ve Partnere Borc hesaplarinin ikisi de zorunludur."
        )
      );
      return;
    }
    if (operatingUnitId === partnerOperatingUnitId) {
      setError(
        l(
          "Source and partner operating units must be different.",
          "Kaynak ve partner operasyon birimleri farkli olmalidir."
        )
      );
      return;
    }
    if (dueFromAccountId === dueToAccountId) {
      setError(
        l(
          "Due From Partner and Due To Partner accounts must be different.",
          "Partnerden Alacak ve Partnere Borc hesaplari farkli olmalidir."
        )
      );
      return;
    }

    const conflictingDueFromRow = (operatingUnitPartnerCurrentAccounts || []).find((row) => {
      const rowKey = `${row?.operating_unit_id || ""}:${row?.partner_operating_unit_id || ""}`;
      return (
        rowKey !== unitPartnerCurrentEditingKey &&
        toNumber(row?.legal_entity_id) === legalEntityId &&
        toNumber(row?.due_from_account_id) === dueFromAccountId
      );
    });
    if (conflictingDueFromRow) {
      setError(
        l(
          `Due From Partner account is already assigned to ${formatOperatingUnitLabel({
            code: conflictingDueFromRow.operating_unit_code,
            name: conflictingDueFromRow.operating_unit_name,
          })} -> ${formatOperatingUnitLabel({
            code: conflictingDueFromRow.partner_operating_unit_code,
            name: conflictingDueFromRow.partner_operating_unit_name,
          })}. Use a partner-specific account.`,
          `Partnerden Alacak hesabi zaten ${formatOperatingUnitLabel({
            code: conflictingDueFromRow.operating_unit_code,
            name: conflictingDueFromRow.operating_unit_name,
          })} -> ${formatOperatingUnitLabel({
            code: conflictingDueFromRow.partner_operating_unit_code,
            name: conflictingDueFromRow.partner_operating_unit_name,
          })} icin atanmis. Partnere ozel bir hesap kullanin.`
        )
      );
      return;
    }
    const conflictingDueToRow = (operatingUnitPartnerCurrentAccounts || []).find((row) => {
      const rowKey = `${row?.operating_unit_id || ""}:${row?.partner_operating_unit_id || ""}`;
      return (
        rowKey !== unitPartnerCurrentEditingKey &&
        toNumber(row?.legal_entity_id) === legalEntityId &&
        toNumber(row?.due_to_account_id) === dueToAccountId
      );
    });
    if (conflictingDueToRow) {
      setError(
        l(
          `Due To Partner account is already assigned to ${formatOperatingUnitLabel({
            code: conflictingDueToRow.operating_unit_code,
            name: conflictingDueToRow.operating_unit_name,
          })} -> ${formatOperatingUnitLabel({
            code: conflictingDueToRow.partner_operating_unit_code,
            name: conflictingDueToRow.partner_operating_unit_name,
          })}. Use a partner-specific account.`,
          `Partnere Borc hesabi zaten ${formatOperatingUnitLabel({
            code: conflictingDueToRow.operating_unit_code,
            name: conflictingDueToRow.operating_unit_name,
          })} -> ${formatOperatingUnitLabel({
            code: conflictingDueToRow.partner_operating_unit_code,
            name: conflictingDueToRow.partner_operating_unit_name,
          })} icin atanmis. Partnere ozel bir hesap kullanin.`
        )
      );
      return;
    }

    setSaving("unit-partner-current");
    setError("");
    setMessage("");
    try {
      await upsertOperatingUnitPartnerCurrentAccount({
        legalEntityId,
        operatingUnitId,
        partnerOperatingUnitId,
        dueFromAccountId,
        dueToAccountId,
      });
      const successMessage = unitPartnerCurrentEditingKey
        ? l("Branch pair current accounts updated.", "Sube cift cari hesaplari guncellendi.")
        : l("Branch pair current accounts saved.", "Sube cift cari hesaplari kaydedildi.");
      resetUnitPartnerCurrentForm();
      setMessage(successMessage);
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to save branch pair current accounts.",
          "Sube cift cari hesaplari kaydedilemedi."
        )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleShareholderParentConfigSubmit(event) {
    event.preventDefault();
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.shareholder.upsert",
          "Eksik yetki: org.shareholder.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    const capitalCreditParentAccountId = toNumber(
      shareholderParentConfigForm.capitalCreditParentAccountId
    );
    const commitmentDebitParentAccountId = toNumber(
      shareholderParentConfigForm.commitmentDebitParentAccountId
    );
    if (!legalEntityId || !capitalCreditParentAccountId || !commitmentDebitParentAccountId) {
      setError(
        l(
          "Select legal entity, capital credit parent, and commitment debit parent first.",
          "Once istirak / bagli ortak, sermaye alacak parent ve taahhut borc parent secin."
        )
      );
      return;
    }
    if (capitalCreditParentAccountId === commitmentDebitParentAccountId) {
      setError(
        l(
          "Commitment debit parent must be different from capital credit parent.",
          "Taahhut borc parent hesap, sermaye alacak parent hesaptan farkli olmalidir."
        )
      );
      return;
    }

    setSaving("shareholderConfig");
    setError("");
    setMessage("");
    try {
      await upsertShareholderJournalConfig({
        legalEntityId,
        capitalCreditParentAccountId,
        commitmentDebitParentAccountId,
      });
      setShareholderForm((prev) => ({
        ...prev,
        capitalSubAccountId: "",
        commitmentDebitSubAccountId: "",
      }));
      setMessage(
        l(
          "Shareholder parent account mapping saved.",
          "Ortak parent hesap eslesmesi kaydedildi."
        )
      );
      await Promise.all([loadCoreData(), refreshLegalEntity(legalEntityId)]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to save shareholder parent account mapping.",
          "Ortak parent hesap eslesmesi kaydedilemedi."
        )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleAutoCreateMissingShareholderSubAccounts() {
    if (!canUpsertAccounts) {
      setError(
        l(
          "Missing permission: gl.account.upsert",
          "Eksik yetki: gl.account.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    if (!legalEntityId) {
      setError(
        l(
          "Select legal entity first.",
          "Once istirak / bagli ortak secin."
        )
      );
      return;
    }

    const shareholderCode = String(shareholderForm.code || "").trim();
    const shareholderName = String(shareholderForm.name || "").trim();
    if (!shareholderCode || !shareholderName) {
      setError(
        l(
          "Enter shareholder code and name before auto setup.",
          "Otomatik kurulumdan once ortak kodu ve adini girin."
        )
      );
      return;
    }
    if (!hasMissingCreditEquitySubAccount && !hasMissingDebitEquitySubAccount) {
      setMessage(
        l(
          "No missing shareholder sub-account setup was detected.",
          "Eksik ortak alt hesap kurulumu tespit edilmedi."
        )
      );
      setAutoSubAccountSetupModalOpen(false);
      return;
    }

    setAutoSubAccountSetupSaving(true);
    setError("");
    setMessage("");

    try {
      const matchingShareholder = visibleShareholders.find(
        (row) => String(row.code || "").trim().toUpperCase() === shareholderCode.toUpperCase()
      );
      const response = await autoProvisionShareholderSubAccounts({
        legalEntityId,
        shareholderCode,
        shareholderName,
        shareholderId: toNumber(matchingShareholder?.id) || undefined,
      });
      const creditSubAccountId = toNumber(response?.capitalSubAccount?.id);
      const debitSubAccountId = toNumber(
        response?.commitmentDebitSubAccount?.id
      );
      if (!creditSubAccountId || !debitSubAccountId) {
        throw new Error(
          l(
            "Auto provisioning did not return both sub-accounts.",
            "Otomatik kurulum iki alt hesabi da donmedi."
          )
        );
      }

      setShareholderForm((prev) => ({
        ...prev,
        capitalSubAccountId: String(creditSubAccountId),
        commitmentDebitSubAccountId: String(debitSubAccountId),
      }));

      await loadCoreData();
      setMessage(
        l(
          "Shareholder sub-accounts are ready and pre-selected.",
          "Ortak alt hesaplari hazirlandi ve forma otomatik secildi."
        )
      );
      setAutoSubAccountSetupModalOpen(false);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        l(
          "Failed to auto-create shareholder sub-accounts.",
          "Ortak alt hesaplari otomatik olusturulamadi."
        )
      );
    } finally {
      setAutoSubAccountSetupSaving(false);
    }
  }

  async function handlePreviewBatchCommitmentJournal() {
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.shareholder.upsert",
          "Eksik yetki: org.shareholder.upsert"
        )
      );
      return null;
    }
    if (shareholderCommitmentModuleNotReady) {
      setError(
        l(
          "Shareholder commitment module setup is incomplete. Complete mappings in GL setup first.",
          "Ortak taahhut modul kurulumu eksik. Once GL ayarlarinda eslemeleri tamamlayin."
        )
      );
      return;
    }
    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    if (!legalEntityId) {
      setError(
        l("Select legal entity first.", "Once istirak / bagli ortak secin.")
      );
      return;
    }
    const shareholderIds = pendingBatchCommitmentShareholders
      .map((row) => toNumber(row.id))
      .filter(Boolean);
    if (shareholderIds.length === 0) {
      setError(
        l(
          "No queued shareholders found for batch commitment journal.",
          "Toplu taahhut yevmiyesi icin kuyrukta ortak bulunamadi."
        )
      );
      return;
    }

    setBatchPreviewLoading(true);
    setError("");
    try {
      const preview = await previewShareholderCommitmentBatchJournal({
        legalEntityId,
        shareholderIds,
        commitmentDate: batchCommitmentDate || undefined,
      });
      setBatchPreviewData(preview || null);
      return preview;
    } catch (err) {
      setBatchPreviewData(null);
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to load batch commitment preview.",
          "Toplu taahhut onizlemesi yuklenemedi."
        )
      );
      return null;
    } finally {
      setBatchPreviewLoading(false);
    }
  }

  async function handleCreateBatchCommitmentJournal() {
    if (batchCommitmentSaving) {
      return;
    }
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.shareholder.upsert",
          "Eksik yetki: org.shareholder.upsert"
        )
      );
      return;
    }
    if (shareholderCommitmentModuleNotReady) {
      setError(
        l(
          "Shareholder commitment module setup is incomplete. Complete mappings in GL setup first.",
          "Ortak taahhut modul kurulumu eksik. Once GL ayarlarinda eslemeleri tamamlayin."
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    if (!legalEntityId) {
      setError(
        l("Select legal entity first.", "Once istirak / bagli ortak secin.")
      );
      return;
    }

    const shareholderIds = pendingBatchCommitmentShareholders
      .map((row) => toNumber(row.id))
      .filter(Boolean);
    if (shareholderIds.length === 0) {
      setError(
        l(
          "No queued shareholders found for batch commitment journal.",
          "Toplu taahhut yevmiyesi icin kuyrukta ortak bulunamadi."
        )
      );
      return;
    }

    let preview = batchPreviewData;
    if (!preview || batchPreviewLoading) {
      preview = await handlePreviewBatchCommitmentJournal();
    }
    if (!preview) {
      return;
    }
    if (preview?.validation?.has_blocking_errors) {
      setError(
        l(
          "Fix preview validation errors before creating the batch journal.",
          "Toplu fis olusturmadan once onizleme dogrulama hatalarini duzeltin."
        )
      );
      return;
    }

    setBatchCommitmentSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await createShareholderCommitmentBatchJournal({
        legalEntityId,
        shareholderIds,
        commitmentDate: batchCommitmentDate || undefined,
      });

      const amountLabel = Number(response?.totalAmount || 0).toLocaleString(
        undefined,
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      );
      setMessage(
        l(
          "Batch commitment draft journal created.",
          "Toplu taahhut taslak yevmiyesi olusturuldu."
        )
      );
      setShareholderJournalModal({
        title: l(
          "Batch Commitment Journal Created",
          "Toplu Taahhut Yevmiye Kaydi Olusturuldu"
        ),
        message: l(
          `Draft journal ${response?.journalNo || "-"} created for ${response?.shareholderCount || shareholderIds.length} shareholders. Total amount: ${amountLabel}.`,
          `${response?.shareholderCount || shareholderIds.length} ortak icin ${response?.journalNo || "-"} numarali taslak fis olusturuldu. Toplam tutar: ${amountLabel}.`
        ),
        journalNo: response?.journalNo || "-",
        journalEntryId: response?.journalEntryId || "-",
        bookCode: response?.bookCode || "-",
        fiscalPeriodId: response?.fiscalPeriodId || "-",
      });

      const processedIds = Array.isArray(response?.processedShareholderIds)
        ? response.processedShareholderIds
        : shareholderIds;
      const processedIdSet = new Set(
        processedIds.map((value) => toNumber(value)).filter(Boolean)
      );
      setCommitmentBatchQueueByEntity((prev) => {
        const key = String(legalEntityId);
        const currentQueue = Array.from(
          new Set((prev?.[key] || []).map((value) => toNumber(value)).filter(Boolean))
        );
        const remainingQueue = currentQueue.filter((id) => !processedIdSet.has(id));
        const next = { ...(prev || {}) };
        if (remainingQueue.length > 0) {
          next[key] = remainingQueue;
        } else {
          delete next[key];
        }
        return next;
      });
      setBatchPreviewData(null);
      setBatchCommitmentModalOpen(false);
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to create batch commitment journal.",
          "Toplu taahhut yevmiyesi olusturulamadi."
        )
      );
    } finally {
      setBatchCommitmentSaving(false);
    }
  }

  function resetCapitalFulfillmentModal() {
    setCapitalFulfillmentModalOpen(false);
    setCapitalFulfillmentForm(DEFAULT_CAPITAL_FULFILLMENT_FORM);
    setCapitalFulfillmentPreview(null);
    setCapitalFulfillmentBankAccounts([]);
    setCapitalFulfillmentBankError("");
    setCapitalFulfillmentCreateBankModalOpen(false);
    setCapitalFulfillmentCreateBankForm(buildCapitalFulfillmentBankForm());
    setCapitalFulfillmentCreateBankSaving(false);
    setCapitalFulfillmentCreateBankError("");
    setCapitalFulfillmentCashRegisters([]);
    setCapitalFulfillmentCashRegistersError("");
    setCapitalFulfillmentOpenCashSessions([]);
    setCapitalFulfillmentCashSessionsError("");
    setCapitalFulfillmentBankLoading(false);
    setCapitalFulfillmentCashRegistersLoading(false);
    setCapitalFulfillmentCashSessionsLoading(false);
    setCapitalFulfillmentPreviewLoading(false);
    setCapitalFulfillmentSaving(false);
  }

  function closeCapitalFulfillmentCreateBankModal() {
    setCapitalFulfillmentCreateBankModalOpen(false);
    setCapitalFulfillmentCreateBankSaving(false);
    setCapitalFulfillmentCreateBankError("");
    setCapitalFulfillmentCreateBankForm(buildCapitalFulfillmentBankForm());
  }

  function openCapitalFulfillmentCreateBankModal() {
    if (!capitalFulfillmentLegalEntityId) {
      setError(
        l("Select legal entity first.", "Once legal entity secin.")
      );
      return;
    }
    if (!canWriteBanks) {
      setError(
        l(
          "Missing permission: bank.accounts.write",
          "Eksik yetki: bank.accounts.write"
        )
      );
      return;
    }

    const defaultCurrencyCode =
      String(
        capitalFulfillmentSelectedLegalEntity?.functional_currency_code ||
        currencySelectOptions[0]?.code ||
        "USD"
      )
        .trim()
        .toUpperCase() || "USD";

    setCapitalFulfillmentCreateBankError("");
    setCapitalFulfillmentCreateBankForm(
      buildCapitalFulfillmentBankForm(defaultCurrencyCode)
    );
    setCapitalFulfillmentCreateBankModalOpen(true);
  }

  function updateCapitalFulfillmentCreateBankForm(updater) {
    setCapitalFulfillmentCreateBankForm((prev) => {
      const next =
        typeof updater === "function" ? updater(prev) : { ...prev, ...(updater || {}) };
      return next;
    });
  }

  function updateCapitalFulfillmentForm(updater) {
    setCapitalFulfillmentForm((prev) => {
      const next =
        typeof updater === "function" ? updater(prev) : { ...prev, ...(updater || {}) };
      return next;
    });
    setCapitalFulfillmentPreview(null);
  }

  function openCapitalFulfillmentModal() {
    if (!canManageShareholderCapitalFulfillment) {
      setError(
        l(
          "Missing permission: org.shareholder.capital_fulfillment.upsert",
          "Eksik yetki: org.shareholder.capital_fulfillment.upsert"
        )
      );
      return;
    }
    if (!selectedShareholderLegalEntityId) {
      setError(
        l("Select legal entity first.", "Once istirak / bagli ortak secin.")
      );
      return;
    }
    if (eligibleShareholdersForCommitmentIncrease.length === 0) {
      setError(
        l(
          "No eligible shareholder found. Shareholder must have both capital and commitment sub-accounts.",
          "Uygun ortak bulunamadi. Ortakta hem sermaye hem taahhut alt hesap tanimli olmalidir."
        )
      );
      return;
    }

    const defaultMode = canReadBanks
      ? "BANK_ACCOUNT"
      : canReadCashRegisters
        ? "CASH_REGISTER"
        : "ASSET_GL";
    const defaultShareholderId = toNumber(
      eligibleShareholdersForCommitmentIncrease[0]?.id
    );

    setError("");
    setMessage("");
    setCapitalFulfillmentPreview(null);
    setCapitalFulfillmentBankError("");
    setCapitalFulfillmentCashRegistersError("");
    setCapitalFulfillmentCashSessionsError("");
    setCapitalFulfillmentForm({
      ...DEFAULT_CAPITAL_FULFILLMENT_FORM,
      legalEntityId: String(selectedShareholderLegalEntityId),
      shareholderId: defaultShareholderId ? String(defaultShareholderId) : "",
      destinationMode: defaultMode,
      contributionDate:
        shareholderForm.commitmentDate || new Date().toISOString().slice(0, 10),
    });
    setCapitalFulfillmentModalOpen(true);
  }

  async function handleCapitalFulfillmentCreateBank(event) {
    event.preventDefault();
    if (capitalFulfillmentCreateBankSaving) {
      return;
    }
    if (!canWriteBanks) {
      setCapitalFulfillmentCreateBankError(
        l(
          "Missing permission: bank.accounts.write",
          "Eksik yetki: bank.accounts.write"
        )
      );
      return;
    }

    const legalEntityId = toNumber(capitalFulfillmentForm.legalEntityId);
    const operatingUnitId = toNumber(capitalFulfillmentForm.operatingUnitId);
    const code = String(capitalFulfillmentCreateBankForm.code || "").trim();
    const name = String(capitalFulfillmentCreateBankForm.name || "").trim();
    const currencyCode = String(capitalFulfillmentCreateBankForm.currencyCode || "")
      .trim()
      .toUpperCase();
    const glAccountId = toNumber(capitalFulfillmentCreateBankForm.glAccountId);
    const autoProvisionControlParent = Boolean(
      capitalFulfillmentCreateBankForm.autoProvisionControlParent
    );
    const glAccountName = String(capitalFulfillmentCreateBankForm.glAccountName || "").trim();

    if (!legalEntityId) {
      setCapitalFulfillmentCreateBankError(
        l("Legal entity is required.", "Legal entity zorunludur.")
      );
      return;
    }
    if (!code) {
      setCapitalFulfillmentCreateBankError(
        l("Bank code is required.", "Banka kodu zorunludur.")
      );
      return;
    }
    if (!name) {
      setCapitalFulfillmentCreateBankError(
        l("Bank account name is required.", "Banka hesap adi zorunludur.")
      );
      return;
    }
    if (!currencyCode) {
      setCapitalFulfillmentCreateBankError(
        l("Currency is required.", "Para birimi zorunludur.")
      );
      return;
    }
    if (!autoProvisionControlParent && !glAccountId) {
      setCapitalFulfillmentCreateBankError(
        l(
          "Select a GL account or turn on control-parent auto-provisioning.",
          "Bir GL hesap secin veya kontrol-parent otomatik olusturmayi acin."
        )
      );
      return;
    }

    setCapitalFulfillmentCreateBankSaving(true);
    setCapitalFulfillmentCreateBankError("");
    try {
      const basePayload = {
        legalEntityId,
        operatingUnitId: operatingUnitId || undefined,
        code,
        name,
        currencyCode,
        bankName: String(capitalFulfillmentCreateBankForm.bankName || "").trim() || null,
        branchName: String(capitalFulfillmentCreateBankForm.branchName || "").trim() || null,
        iban: String(capitalFulfillmentCreateBankForm.iban || "").trim() || null,
        accountNo: String(capitalFulfillmentCreateBankForm.accountNo || "").trim() || null,
        isActive: Boolean(capitalFulfillmentCreateBankForm.isActive),
      };

      const response = autoProvisionControlParent
        ? await provisionBankAccountControlParentChild(
          {
            ...basePayload,
            glAccountName: glAccountName || undefined,
          },
          { idempotencyKey: generateProvisionIdempotencyKey() }
        )
        : await createBankAccount({
          ...basePayload,
          glAccountId,
        });

      const createdRow = response?.row || null;
      const createdBankAccountId = toNumber(createdRow?.id);
      if (createdRow) {
        setCapitalFulfillmentBankAccounts((prev) => {
          const next = Array.isArray(prev)
            ? prev.filter((row) => toNumber(row?.id) !== createdBankAccountId)
            : [];
          next.push(createdRow);
          next.sort((left, right) =>
            formatBankAccountOptionLabel(left).localeCompare(
              formatBankAccountOptionLabel(right)
            )
          );
          return next;
        });
      }
      if (createdBankAccountId) {
        updateCapitalFulfillmentForm({
          bankAccountId: String(createdBankAccountId),
        });
      }
      setCapitalFulfillmentBankError("");
      setCapitalFulfillmentCreateBankModalOpen(false);
      setCapitalFulfillmentCreateBankForm(buildCapitalFulfillmentBankForm());
      setMessage(
        autoProvisionControlParent
          ? l(
            "Bank account created, linked, and selected for this fulfillment.",
            "Banka hesabi olusturuldu, baglandi ve bu karsilama icin secildi."
          )
          : l(
            "Bank account created and selected for this fulfillment.",
            "Banka hesabi olusturuldu ve bu karsilama icin secildi."
          )
      );
    } catch (err) {
      setCapitalFulfillmentCreateBankError(
        err?.response?.data?.message ||
        err?.message ||
        l("Failed to create bank account.", "Banka hesabi olusturulamadi.")
      );
    } finally {
      setCapitalFulfillmentCreateBankSaving(false);
    }
  }

  function buildCapitalFulfillmentPayload() {
    if (!canManageShareholderCapitalFulfillment) {
      setError(
        l(
          "Missing permission: org.shareholder.capital_fulfillment.upsert",
          "Eksik yetki: org.shareholder.capital_fulfillment.upsert"
        )
      );
      return null;
    }

    const legalEntityId = toNumber(capitalFulfillmentForm.legalEntityId);
    const shareholderId = toNumber(capitalFulfillmentForm.shareholderId);
    const operatingUnitId = toNumber(capitalFulfillmentForm.operatingUnitId);
    const amount = Number(capitalFulfillmentForm.amount || 0);
    const contributionDate = String(
      capitalFulfillmentForm.contributionDate || ""
    ).trim();
    const destinationMode = String(
      capitalFulfillmentForm.destinationMode || ""
    ).trim()
      .toUpperCase();

    if (!legalEntityId || !shareholderId) {
      setError(
        l(
          "Select legal entity and shareholder first.",
          "Once legal entity ve ortak secin."
        )
      );
      return null;
    }
    if (!contributionDate) {
      setError(
        l(
          "Contribution date is required.",
          "Katki tarihi zorunludur."
        )
      );
      return null;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(
        l(
          "Fulfillment amount must be greater than 0.",
          "Karsilama tutari 0'dan buyuk olmalidir."
        )
      );
      return null;
    }
    if (operatingUnitId && !capitalFulfillmentOuReady) {
      setError(
        l(
          "Selected operating unit is missing internal current-account setup. Configure Central Due From OU and OU Due To Central on that operating unit first.",
          "Secilen operasyon biriminde ic cari hesap kurulumu eksik. Bu operasyon biriminde once Merkez OU Alacagi ve OU Merkeze Borc alanlarini tanimlayin."
        )
      );
      return null;
    }
    if (destinationMode === "BANK_ACCOUNT") {
      if (!canReadBanks) {
        setError(
          l(
            "Missing permission: bank.accounts.read",
            "Eksik yetki: bank.accounts.read"
          )
        );
        return null;
      }
      if (!toNumber(capitalFulfillmentForm.bankAccountId)) {
        setError(
          l(
            "Select a bank account destination first.",
            "Once banka hesabi hedefini secin."
          )
        );
        return null;
      }
    } else if (destinationMode === "CASH_REGISTER") {
      if (!canReadCashRegisters) {
        setError(
          l(
            "Missing permission: cash.register.read",
            "Eksik yetki: cash.register.read"
          )
        );
        return null;
      }
      if (!toNumber(capitalFulfillmentForm.cashRegisterId)) {
        setError(
          l(
            "Select a cash register destination first.",
            "Once kasa hedefini secin."
          )
        );
        return null;
      }
      if (capitalFulfillmentCashSessionMissingOpenSession) {
        setError(
          l(
            "Selected cash register requires an OPEN cash session. Open one from Cash Sessions first.",
            "Secili kasa icin OPEN durumunda bir kasa oturumu gerekir. Once Cash Sessions ekranindan acin."
          )
        );
        return null;
      }
      if (
        capitalFulfillmentCashSessionRequired &&
        !toNumber(capitalFulfillmentForm.cashSessionId)
      ) {
        setError(
          l(
            "Selected cash register requires an OPEN cash session.",
            "Secili kasa bir OPEN kasa oturumu gerektirir."
          )
        );
        return null;
      }
    } else if (destinationMode === "ASSET_GL") {
      if (!canReadAccounts) {
        setError(
          l("Missing permission: gl.account.read", "Eksik yetki: gl.account.read")
        );
        return null;
      }
      if (!toNumber(capitalFulfillmentForm.destinationAccountId)) {
        setError(
          l(
            "Select an asset GL destination first.",
            "Once varlik GL hedefini secin."
          )
        );
        return null;
      }
    } else {
      setError(
        l("Destination mode is invalid.", "Hedef modu gecersiz.")
      );
      return null;
    }

    return {
      legalEntityId,
      shareholderId,
      operatingUnitId: operatingUnitId || undefined,
      destinationMode,
      bankAccountId:
        destinationMode === "BANK_ACCOUNT"
          ? toNumber(capitalFulfillmentForm.bankAccountId)
          : undefined,
      cashRegisterId:
        destinationMode === "CASH_REGISTER"
          ? toNumber(capitalFulfillmentForm.cashRegisterId)
          : undefined,
      cashSessionId:
        destinationMode === "CASH_REGISTER"
          ? toNumber(capitalFulfillmentForm.cashSessionId) || undefined
          : undefined,
      destinationAccountId:
        destinationMode === "ASSET_GL"
          ? toNumber(capitalFulfillmentForm.destinationAccountId)
          : undefined,
      amount,
      contributionDate,
      note: String(capitalFulfillmentForm.note || "").trim() || undefined,
    };
  }

  async function handlePreviewCapitalFulfillment() {
    const payload = buildCapitalFulfillmentPayload();
    if (!payload) {
      return null;
    }

    setCapitalFulfillmentPreviewLoading(true);
    setError("");
    setMessage("");
    try {
      const preview = await previewShareholderCapitalFulfillment(payload);
      setCapitalFulfillmentPreview(preview || null);
      return preview || null;
    } catch (err) {
      setCapitalFulfillmentPreview(null);
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to load capital fulfillment preview.",
          "Sermaye karsilama onizlemesi yuklenemedi."
        )
      );
      return null;
    } finally {
      setCapitalFulfillmentPreviewLoading(false);
    }
  }

  async function handleCreateCapitalFulfillment() {
    if (capitalFulfillmentSaving) {
      return;
    }
    const payload = buildCapitalFulfillmentPayload();
    if (!payload) {
      return;
    }
    if (!capitalFulfillmentPreview) {
      setError(
        l(
          "Preview the fulfillment before posting.",
          "Post etmeden once karsilamayi onizleyin."
        )
      );
      return;
    }

    setCapitalFulfillmentSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await createShareholderCapitalFulfillment(payload);
      const preview = response?.preview || capitalFulfillmentPreview;
      const amountLabel = formatAmount(preview?.amount_base || payload.amount);
      const shouldOfferTransitShortcut =
        String(payload.destinationMode || "").toUpperCase() === "CASH_REGISTER" &&
        !toNumber(payload.operatingUnitId);
      const sourceCashRegisterId = toNumber(
        preview?.destination?.cash_register_id || payload.cashRegisterId
      );
      const branchRegisterOptions = shouldOfferTransitShortcut
        ? capitalFulfillmentCashRegisters
          .filter(
            (row) =>
              Number(row.legal_entity_id) === Number(payload.legalEntityId) &&
              toNumber(row.operating_unit_id) &&
              toNumber(row.id) !== sourceCashRegisterId
          )
          .sort((left, right) =>
            String(left?.code || "").localeCompare(String(right?.code || ""))
          )
          .map((row) => ({
            id: toNumber(row.id),
            code: String(row.code || "").trim(),
            name: String(row.name || "").trim(),
            operatingUnitCode: String(row.operating_unit_code || "").trim(),
            label: formatCashRegisterOptionLabel(row, l),
          }))
        : [];
      const defaultTargetRegisterId = toNumber(branchRegisterOptions[0]?.id);
      const selectedTargetRegister =
        branchRegisterOptions.find((row) => toNumber(row.id) === defaultTargetRegisterId) || null;
      setMessage(
        l(
          "Capital fulfillment posted.",
          "Sermaye karsilamasi post edildi."
        )
      );
      setShareholderJournalModal({
        title: l(
          "Capital Fulfillment Posted",
          "Sermaye Karsilamasi Post Edildi"
        ),
        message: l(
          `Journal ${response?.journalNo || "-"} posted for ${amountLabel}.`,
          `${response?.journalNo || "-"} numarali fis ${amountLabel} tutar ile post edildi.`
        ),
        journalNo: response?.journalNo || "-",
        journalEntryId: response?.journalEntryId || "-",
        bookCode: preview?.journal_context?.book_code || "-",
        fiscalPeriodId: preview?.journal_context?.fiscal_period_id || "-",
        transitShortcut:
          shouldOfferTransitShortcut && sourceCashRegisterId
            ? {
              fulfillmentId: toNumber(response?.fulfillmentId) || null,
              sourceRegisterId: sourceCashRegisterId,
              sourceRegisterCode: String(preview?.destination?.cash_register_code || "").trim(),
              sourceRegisterLabel:
                formatCashRegisterOptionLabel({
                  code: String(preview?.destination?.cash_register_code || "").trim(),
                  name: String(preview?.destination?.cash_register_name || "").trim(),
                  currency_code: String(preview?.currency_code || "").trim().toUpperCase(),
                  session_mode: "",
                  ownership_context_label: "Central",
                }) || "-",
              targetRegisterId: defaultTargetRegisterId
                ? String(defaultTargetRegisterId)
                : "",
              targetRegisterCode: String(selectedTargetRegister?.code || "").trim(),
              targetRegisterOptions: branchRegisterOptions,
              amountBase: preview?.amount_base || payload.amount || 0,
              currencyCode: String(preview?.currency_code || "").trim().toUpperCase(),
              bookDate: todayIsoDate(),
              referenceNo: `SCF-HQ-TRANSFER:${toNumber(response?.fulfillmentId) || "NEW"}`.slice(
                0,
                100
              ),
              description: l(
                `Central to branch cash transit for shareholder capital fulfillment ${response?.journalNo || "-"}`,
                `${response?.journalNo || "-"} icin merkezden subeye kasa transit transferi`
              ),
            }
            : null,
      });
      resetCapitalFulfillmentModal();
      await Promise.all([
        loadCoreData(),
        loadCapitalFulfillmentHistory(payload.legalEntityId),
      ]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to post capital fulfillment.",
          "Sermaye karsilamasi post edilemedi."
        )
      );
    } finally {
      setCapitalFulfillmentSaving(false);
    }
  }

  async function handleReverseCapitalFulfillment(row) {
    const fulfillmentId = toNumber(row?.id);
    if (!fulfillmentId) {
      setError(
        l(
          "Capital fulfillment id is missing.",
          "Sermaye karsilama id eksik."
        )
      );
      return;
    }
    if (!canManageShareholderCapitalFulfillment) {
      setError(
        l(
          "Missing permission: org.shareholder.capital_fulfillment.upsert",
          "Eksik yetki: org.shareholder.capital_fulfillment.upsert"
        )
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        `Reverse capital fulfillment ${row?.journal_no || `#${fulfillmentId}`}?`,
        `${row?.journal_no || `#${fulfillmentId}`} sermaye karsilamasi ters cevrilsin mi?`
      )
    );
    if (!confirmed) {
      return;
    }

    setCapitalFulfillmentReversingId(fulfillmentId);
    setError("");
    setMessage("");
    try {
      const response = await reverseShareholderCapitalFulfillment(fulfillmentId);
      setMessage(
        l(
          "Capital fulfillment reversed.",
          "Sermaye karsilamasi ters cevrildi."
        )
      );
      await Promise.all([
        loadCoreData(),
        loadCapitalFulfillmentHistory(capitalFulfillmentLegalEntityId),
      ]);
      const reversalJournalId = toNumber(response?.reversalJournalEntryId);
      if (reversalJournalId) {
        setShareholderJournalModal({
          title: l(
            "Capital Fulfillment Reversed",
            "Sermaye Karsilamasi Ters Cevrildi"
          ),
          message: l(
            `Reversal journal ${reversalJournalId} was posted.`,
            `${reversalJournalId} numarali ters kayit yevmiyesi post edildi.`
          ),
          journalNo: row?.reversal_journal_no || "-",
          journalEntryId: reversalJournalId,
          bookCode: "-",
          fiscalPeriodId: "-",
        });
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to reverse capital fulfillment.",
          "Sermaye karsilamasi ters cevrilemedi."
        )
      );
    } finally {
      setCapitalFulfillmentReversingId(null);
    }
  }

  function openCommitmentIncreaseModal() {
    if (!selectedShareholderLegalEntityId) {
      setError(
        l(
          "Select legal entity first.",
          "Once istirak / bagli ortak secin."
        )
      );
      return;
    }
    if (eligibleShareholdersForCommitmentIncrease.length === 0) {
      setError(
        l(
          "No eligible shareholder found. Shareholder must have both capital and commitment sub-accounts.",
          "Uygun ortak bulunamadi. Ortakta hem sermaye hem taahhut alt hesap tanimli olmalidir."
        )
      );
      return;
    }
    setError("");
    setCommitmentIncreaseForm({
      shareholderId: String(eligibleShareholdersForCommitmentIncrease[0].id),
      commitmentDate:
        shareholderForm.commitmentDate || new Date().toISOString().slice(0, 10),
      increaseAmount: "0",
    });
    setCommitmentIncreaseModalOpen(true);
  }

  async function handleCommitmentIncreaseSubmit(event) {
    event.preventDefault();
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.shareholder.upsert",
          "Eksik yetki: org.shareholder.upsert"
        )
      );
      return;
    }

    const selectedShareholder = selectedCommitmentIncreaseShareholder;
    if (!selectedShareholder) {
      setError(
        l(
          "Select an existing shareholder first.",
          "Once mevcut bir ortak secin."
        )
      );
      return;
    }

    const legalEntityId = toNumber(selectedShareholder.legal_entity_id);
    if (!legalEntityId) {
      setError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }

    const increaseAmount = Number(commitmentIncreaseForm.increaseAmount || 0);
    if (!Number.isFinite(increaseAmount) || increaseAmount <= 0) {
      setError(
        l(
          "Commitment increase must be greater than 0.",
          "Taahhut artisi 0'dan buyuk olmalidir."
        )
      );
      return;
    }

    const capitalSubAccountId = toNumber(selectedShareholder.capital_sub_account_id);
    const commitmentDebitSubAccountId = toNumber(
      selectedShareholder.commitment_debit_sub_account_id
    );
    if (!capitalSubAccountId || !commitmentDebitSubAccountId) {
      setError(
        l(
          "Selected shareholder is missing mapped sub-accounts.",
          "Secilen ortakta eslenmis alt hesaplar eksik."
        )
      );
      return;
    }

    const committedCapital = normalizeAmount(
      Number(selectedShareholder.committed_capital || 0) + increaseAmount
    );

    setSaving("shareholderIncrease");
    setError("");
    setMessage("");
    try {
      const response = await upsertShareholder({
        legalEntityId,
        code: String(selectedShareholder.code || "").trim(),
        name: String(selectedShareholder.name || "").trim(),
        shareholderType:
          String(selectedShareholder.shareholder_type || "INDIVIDUAL").toUpperCase(),
        taxId: selectedShareholder.tax_id
          ? String(selectedShareholder.tax_id).trim()
          : undefined,
        commitmentDate: commitmentIncreaseForm.commitmentDate || undefined,
        committedCapital,
        capitalSubAccountId,
        commitmentDebitSubAccountId,
        autoCommitmentJournal: false,
        currencyCode: String(selectedShareholder.currency_code || "USD")
          .trim()
          .toUpperCase(),
        status: String(selectedShareholder.status || "ACTIVE").toUpperCase(),
        notes: selectedShareholder.notes
          ? String(selectedShareholder.notes).trim()
          : undefined,
      });

      const savedShareholderId =
        toNumber(response?.id) || toNumber(selectedShareholder.id);
      const committedCapitalDelta = normalizeAmount(
        response?.committedCapitalDelta || 0
      );
      if (committedCapitalDelta > 0 && savedShareholderId) {
        setCommitmentBatchQueueByEntity((prev) => {
          const key = String(legalEntityId);
          const currentQueue = Array.from(
            new Set((prev?.[key] || []).map((value) => toNumber(value)).filter(Boolean))
          );
          if (!currentQueue.includes(savedShareholderId)) {
            currentQueue.push(savedShareholderId);
          }
          return {
            ...(prev || {}),
            [key]: currentQueue,
          };
        });
        setMessage(
          l(
            "Commitment increase saved and queued for batch commitment journal.",
            "Taahhut artisi kaydedildi ve toplu taahhut yevmiyesi icin kuyruga alindi."
          )
        );
      } else {
        setMessage(l("Commitment increase saved.", "Taahhut artisi kaydedildi."));
      }

      setCommitmentIncreaseModalOpen(false);
      setCommitmentIncreaseForm((prev) => ({
        ...prev,
        increaseAmount: "0",
      }));
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l(
          "Failed to save commitment increase.",
          "Taahhut artisi kaydedilemedi."
        )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleShareholderSubmit(event) {
    event.preventDefault();
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.shareholder.upsert",
          "Eksik yetki: org.shareholder.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    if (!legalEntityId) {
      setError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }
    const commitmentIncreaseAmount = Number(shareholderForm.committedCapital || 0);
    if (!Number.isFinite(commitmentIncreaseAmount) || commitmentIncreaseAmount < 0) {
      setError(
        l(
          "Commitment increase must be a non-negative number.",
          "Taahhut artisi 0 veya daha buyuk bir sayi olmalidir."
        )
      );
      return;
    }
    const normalizedShareholderCode = String(shareholderForm.code || "")
      .trim()
      .toUpperCase();
    const existingShareholder = visibleShareholders.find(
      (row) =>
        String(row.code || "")
          .trim()
          .toUpperCase() === normalizedShareholderCode
    );
    const previousCommittedCapital = normalizeAmount(
      existingShareholder?.committed_capital || 0
    );
    const committedCapital = normalizeAmount(
      previousCommittedCapital + commitmentIncreaseAmount
    );
    const capitalSubAccountId = toNumber(shareholderForm.capitalSubAccountId);
    const commitmentDebitSubAccountId = toNumber(
      shareholderForm.commitmentDebitSubAccountId
    );
    if (committedCapital > 0 && !hasShareholderParentMapping) {
      setError(
        parentMappingStatus?.reasons?.[0] ||
        l(
          "Save valid shareholder parent account mapping before entering commitment increase.",
          "Taahhut artisi girmeden once gecerli ortak parent hesap eslesmesini kaydedin."
        )
      );
      return;
    }
    if (committedCapital > 0 && !capitalSubAccountId) {
      setError(
        l(
          "Capital sub-account is required when committed capital is greater than 0.",
          "Taahhut toplam sermaye 0'dan buyukse sermaye alt hesap zorunludur."
        )
      );
      return;
    }
    if (committedCapital > 0 && !commitmentDebitSubAccountId) {
      setError(
        l(
          "Commitment debit sub-account is required when committed capital is greater than 0.",
          "Taahhut toplam sermaye 0'dan buyukse taahhut borc alt hesap zorunludur."
        )
      );
      return;
    }
    if (
      capitalSubAccountId &&
      commitmentDebitSubAccountId &&
      capitalSubAccountId === commitmentDebitSubAccountId
    ) {
      setError(
        l(
          "Commitment debit sub-account must be different from capital sub-account.",
          "Taahhut borc alt hesap, sermaye alt hesaptan farkli olmalidir."
        )
      );
      return;
    }

    setSaving("shareholder");
    setError("");
    setMessage("");
    try {
      const response = await upsertShareholder({
        legalEntityId,
        code: shareholderForm.code.trim(),
        name: shareholderForm.name.trim(),
        shareholderType: shareholderForm.shareholderType,
        taxId: shareholderForm.taxId.trim() || undefined,
        commitmentDate: shareholderForm.commitmentDate || undefined,
        committedCapital,
        capitalSubAccountId: capitalSubAccountId || undefined,
        commitmentDebitSubAccountId: commitmentDebitSubAccountId || undefined,
        autoCommitmentJournal: false,
        currencyCode: shareholderForm.currencyCode.trim().toUpperCase(),
        status: shareholderForm.status,
        notes: shareholderForm.notes.trim() || undefined,
      });

      setShareholderForm((prev) => ({
        ...prev,
        code: "",
        name: "",
        taxId: "",
        committedCapital: "0",
        capitalSubAccountId: "",
        commitmentDebitSubAccountId: "",
        notes: "",
      }));

      const savedShareholderId = toNumber(response?.id);
      const committedCapitalDelta = normalizeAmount(
        response?.committedCapitalDelta || 0
      );
      if (committedCapitalDelta > 0 && savedShareholderId) {
        setCommitmentBatchQueueByEntity((prev) => {
          const key = String(legalEntityId);
          const currentQueue = Array.from(
            new Set((prev?.[key] || []).map((value) => toNumber(value)).filter(Boolean))
          );
          if (!currentQueue.includes(savedShareholderId)) {
            currentQueue.push(savedShareholderId);
          }
          return {
            ...(prev || {}),
            [key]: currentQueue,
          };
        });
        setMessage(
          l(
            "Shareholder saved and queued for batch commitment journal.",
            "Ortak kaydedildi ve toplu taahhut yevmiyesi icin kuyruga alindi."
          )
        );
      } else {
        setMessage(l("Shareholder saved.", "Ortak kaydedildi."));
      }
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        l("Failed to save shareholder.", "Ortak kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function handleFiscalCalendarSubmit(event) {
    event.preventDefault();
    if (!canUpsertFiscalCalendar) {
      setError(l("Missing permission: org.fiscal_calendar.upsert", "Eksik yetki: org.fiscal_calendar.upsert"));
      return;
    }

    setSaving("calendar");
    setError("");
    setMessage("");
    try {
      await upsertFiscalCalendar({
        code: calendarForm.code.trim(),
        name: calendarForm.name.trim(),
        yearStartMonth: Number(calendarForm.yearStartMonth),
        yearStartDay: Number(calendarForm.yearStartDay),
      });
      setCalendarForm({
        code: "",
        name: "",
        yearStartMonth: 1,
        yearStartDay: 1,
      });
      setMessage(l("Fiscal calendar saved.", "Mali takvim kaydedildi."));
      refreshLookups();
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save fiscal calendar.", "Mali takvim kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleGeneratePeriods(event) {
    event.preventDefault();
    if (!canGenerateFiscalPeriods) {
      setError(l("Missing permission: org.fiscal_period.generate", "Eksik yetki: org.fiscal_period.generate"));
      return;
    }

    const calendarId = toNumber(periodForm.calendarId);
    const fiscalYear = toNumber(periodForm.fiscalYear);
    if (!calendarId || !fiscalYear) {
      setError(l("calendarId and fiscalYear are required.", "calendarId ve fiscalYear zorunludur."));
      return;
    }

    setSaving("periods");
    setError("");
    setMessage("");
    try {
      await generateFiscalPeriods({ calendarId, fiscalYear });
      setMessage(l("Fiscal periods generated.", "Mali donemler olusturuldu."));
      refreshLookups();
      await loadPeriods(calendarId, fiscalYear);
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to generate fiscal periods.", "Mali donemler olusturulamadi."));
    } finally {
      setSaving("");
    }
  }

  if (!canReadOrgTree && !canReadFiscalCalendars) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l(
          "You need `org.tree.read` and/or `org.fiscal_calendar.read` to use this page.",
          "Bu sayfayi kullanmak icin `org.tree.read` ve/veya `org.fiscal_calendar.read` yetkisi gerekir."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showTenantReadinessChecklist ? <TenantReadinessChecklist /> : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {isActivationWorkspace
            ? l("Entity Activation Workspace", "Entity Aktivasyon Alani")
            : l("Organization Management", "Organizasyon Yonetimi")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {isActivationWorkspace
            ? l(
                "Complete local legal-entity setup without tenant-wide onboarding noise. This workspace stays aligned to the current working legal entity context.",
                "Tenant geneli onboarding gurultusune girmeden yerel legal entity kurulumunu tamamlayin. Bu alan mevcut calisma legal entity baglamina hizali kalir."
              )
            : l(
                "Maintain company structure, branches, and fiscal structure after onboarding.",
                "Kurulumdan sonra sirket yapisini, subeleri ve mali yapilari yonetin."
              )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {isActivationWorkspace ? (
        <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-sky-950">
                {l("Local activation checklist", "Yerel aktivasyon kontrol listesi")}
              </div>
              <p className="mt-1 text-sm text-sky-900">
                {l(
                  "Tenant-wide onboarding readiness is intentionally hidden here. Only legal-entity-level setup blockers should drive the work.",
                  "Tenant geneli onboarding hazirligi burada bilincli olarak gizlenir. Isi yalnizca legal-entity seviyesi kurulum engelleri yonlendirmelidir."
                )}
              </p>
            </div>
            <span className="rounded-full border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900">
              {activationScopeLabel}
            </span>
          </div>

          {!activationFocusLegalEntityId && isScopedActivationWorkspace ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {activationWorkingContextResolved
                ? l(
                    "Select a working legal entity first. This workspace stays bounded to your current legal-entity context.",
                    "Once bir calisma legal entity'si secin. Bu alan mevcut legal-entity baglaminizla sinirli kalir."
                  )
                : l(
                    "Resolving your working legal entity context...",
                    "Calisma legal entity baglaminiz cozuluyor..."
                  )}
            </div>
          ) : null}

          {activationFocusLegalEntityId ? (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {activationChecklistItems.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-xl border border-sky-200 bg-white px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          item.ready
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.ready ? l("Ready", "Hazir") : l("Action", "Aksiyon")}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      {item.detail}
                    </p>
                    {item.actionPath ? (
                      <Link
                        to={item.actionPath}
                        className="mt-3 inline-flex text-xs font-semibold text-sky-800 hover:text-sky-950"
                      >
                        {l("Open relevant surface", "Ilgili ekrani ac")}
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Link
                  to="/app/ayarlar/organizasyon-yonetimi"
                  className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-semibold text-sky-900"
                >
                  {l("Open full organization view", "Tam organizasyon gorunumunu ac")}
                </Link>
                <Link
                  to="/app/ayarlar/hesap-plani-ayarlari"
                  className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-semibold text-sky-900"
                >
                  {l("Open GL setup", "GL ayarlarini ac")}
                </Link>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {showCentralStructureSections ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Group Companies", "Grup Sirketleri")}
          </h2>
          {groupEditingCode ? (
            <p className="mb-2 text-xs text-slate-600">
              {l(
                `Editing group ${groupEditingCode}. Group code is locked.`,
                `${groupEditingCode} grubu duzenleniyor. Grup kodu kilitli.`
              )}
            </p>
          ) : null}
          <form onSubmit={handleGroupSubmit} className="grid gap-2 md:grid-cols-4">
            <input
              value={groupForm.code}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, code: event.target.value }))
              }
              disabled={Boolean(groupEditingCode)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Code", "Kod")}
              required
            />
            <input
              value={groupForm.name}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Name", "Ad")}
              required
            />
            <button
              type="submit"
              disabled={saving === "group" || !canUpsertGroupCompany}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "group"
                ? l("Saving...", "Kaydediliyor...")
                : groupEditingCode
                  ? l("Update", "Guncelle")
                  : l("Save", "Kaydet")}
            </button>
            {groupEditingCode ? (
              <button
                type="button"
                onClick={resetGroupForm}
                disabled={saving === "group"}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 md:col-start-4"
              >
                {l("Cancel Edit", "Duzenlemeyi Iptal Et")}
              </button>
            ) : null}
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {(groups || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleGroupEdit(row)}
                        disabled={saving === "group" || !canUpsertGroupCompany}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {l("Edit", "Duzenle")}
                      </button>
                    </td>
                  </tr>
                ))}
                {groups.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-slate-500">
                      {l("No group companies found.", "Grup sirketi bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        {showCentralStructureSections ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Legal Entities", "Istirakler / Bagli Ortaklar")}
          </h2>
          {legalEntityEditingCode ? (
            <p className="mb-2 text-xs text-slate-600">
              {l(
                `Editing legal entity ${legalEntityEditingCode}. Entity code is locked.`,
                `${legalEntityEditingCode} istiraki / bagli ortagi duzenleniyor. Kod kilitli.`
              )}
            </p>
          ) : null}
          <form onSubmit={handleLegalEntitySubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={entityForm.groupCompanyId}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  groupCompanyId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select group company", "Grup sirketi secin")}</option>
              {groups.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={entityForm.code}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, code: event.target.value }))
              }
              disabled={Boolean(legalEntityEditingCode)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Entity code", "Birim kodu")}
              required
            />
            <input
              value={entityForm.name}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Entity name", "Birim adi")}
              required
            />

            <select
              value={entityForm.countryId}
              onChange={(event) => {
                const nextCountryId = event.target.value;
                const selectedCountry = countrySelectOptions.find(
                  (option) => String(option.id) === String(nextCountryId)
                );
                setEntityForm((prev) => {
                  const previousRecommendedPolicyPackId =
                    getRecommendedPolicyPackIdForCountryId(prev.countryId);
                  const nextRecommendedPolicyPackId =
                    getRecommendedPolicyPackIdForCountryId(nextCountryId);
                  const shouldAutoSwitchPolicyPack =
                    !normalizeUpperText(prev.policyPackId) ||
                    normalizeUpperText(prev.policyPackId) ===
                      normalizeUpperText(previousRecommendedPolicyPackId);

                  return {
                    ...prev,
                    countryId: nextCountryId,
                    functionalCurrencyCode:
                      selectedCountry?.defaultCurrencyCode ||
                      prev.functionalCurrencyCode,
                    policyPackId: shouldAutoSwitchPolicyPack
                      ? nextRecommendedPolicyPackId
                      : prev.policyPackId,
                  };
                });
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select country", "Ulke secin")}</option>
              {countrySelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={entityForm.functionalCurrencyCode}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  functionalCurrencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select currency", "Para birimi secin")}</option>
              {currencySelectOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={entityForm.status}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  status: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              {LEGAL_ENTITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getLegalEntityStatusLabel(status, l)}
                </option>
              ))}
            </select>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 px-3 py-3 text-sm md:col-span-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-cyan-950">
                    {l("Starter account template", "Baslangic hesap sablonu")}
                  </div>
                  <p className="mt-1 text-xs text-cyan-900">
                    {l(
                      "This template is used only when auto-create defaults is enabled below.",
                      "Bu sablon sadece asagidaki otomatik varsayilan olusturma secenegi aciksa kullanilir."
                    )}
                  </p>
                </div>
                {selectedEntityRecommendedPolicyPack ? (
                  <span className="rounded-full border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-900">
                    {l("Recommended", "Onerilen")}:{" "}
                    {selectedEntityRecommendedPolicyPack.packId}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <select
                  value={entityForm.policyPackId}
                  onChange={(event) =>
                    setEntityForm((prev) => ({
                      ...prev,
                      policyPackId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm md:col-span-2"
                >
                  <option value="">{l("Select policy pack", "Politika paketi secin")}</option>
                  {entitySelectablePolicyPackOptions.map((pack) => (
                    <option key={pack.packId} value={pack.packId}>
                      {pack.packId} - {pack.label} ({pack.countryIso2})
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm text-cyan-950">
                  <input
                    type="checkbox"
                    checked={showAllPolicyPackOptions}
                    onChange={(event) =>
                      setShowAllPolicyPackOptions(event.target.checked)
                    }
                  />
                  {l("Show all packs", "Tum paketleri goster")}
                </label>
              </div>

              <div className="mt-2 text-xs text-cyan-950">
                {selectedEntityPolicyPack
                  ? l(
                      `Selected pack: ${selectedEntityPolicyPack.packId}.`,
                      `Secili paket: ${selectedEntityPolicyPack.packId}.`
                    )
                  : l("No pack selected.", "Paket secilmedi.")}
                {selectedEntityRecommendedPolicyPack
                  ? ` ${l(
                      `Country recommendation: ${selectedEntityRecommendedPolicyPack.packId}.`,
                      `Ulke onerisi: ${selectedEntityRecommendedPolicyPack.packId}.`
                    )}`
                  : ""}
              </div>

              {selectedEntityPolicyPack &&
              normalizeUpperText(selectedEntityPolicyPack.countryIso2) !==
                selectedEntityCountryIso2 ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {l(
                    "You selected a cross-country template. This is allowed, but account defaults will come from that pack instead of the entity country recommendation.",
                    "Farkli ulkeye ait bir sablon sectiniz. Buna izin verilir, ancak hesap varsayilanlari birimin ulke onerisi yerine bu paketten gelir."
                  )}
                </div>
              ) : null}
            </div>

            <input
              value={entityForm.taxId}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, taxId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Tax ID (optional)", "Vergi No (opsiyonel)")}
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={entityForm.isIntercompanyEnabled}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    isIntercompanyEnabled: event.target.checked,
                  }))
                }
              />
              {l("Intercompany enabled", "Intercompany aktif")}
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={entityForm.intercompanyPartnerRequired}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    intercompanyPartnerRequired: event.target.checked,
                  }))
                }
              />
              {l("Partner required", "Karsi taraf zorunlu")}
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={entityForm.autoProvisionDefaults}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    autoProvisionDefaults: event.target.checked,
                  }))
                }
              />
              {l(
                "Auto-create defaults (calendar, periods, CoA, accounts, book)",
                "Varsayilanlari otomatik olustur (takvim, donemler, hesap plani, hesaplar, defter)"
              )}
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={entityForm.useCustomPaymentTerms}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    useCustomPaymentTerms: event.target.checked,
                  }))
                }
              />
              {l(
                "Use custom payment terms (JSON array)",
                "Ozel odeme kosulu kullan (JSON dizi)"
              )}
            </label>
            {entityForm.useCustomPaymentTerms ? (
              <textarea
                value={entityForm.paymentTermsJson}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    paymentTermsJson: event.target.value,
                  }))
                }
                rows={6}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono md:col-span-4"
                placeholder={`[
  {"code":"NET_30","name":"Net 30","dueDays":30},
  {"code":"NET_45","name":"Net 45","dueDays":45,"graceDays":2}
]`}
              />
            ) : null}
            <button
              type="submit"
              disabled={saving === "entity" || !canUpsertLegalEntity}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "entity"
                ? l("Saving...", "Kaydediliyor...")
                : legalEntityEditingCode
                  ? l("Update", "Guncelle")
                  : l("Save", "Kaydet")}
            </button>
            {legalEntityEditingCode ? (
              <button
                type="button"
                onClick={resetLegalEntityForm}
                disabled={saving === "entity"}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Cancel Edit", "Duzenlemeyi Iptal Et")}
              </button>
            ) : null}
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Group", "Grup")}</th>
                  <th className="px-3 py-2">{l("Country", "Ulke")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para birimi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {(legalEntities || []).map((row) => {
                  const groupCompany = groupCompanyById.get(
                    toNumber(row.group_company_id)
                  );
                  const country = countryById.get(toNumber(row.country_id));
                  const groupLabel = groupCompany
                    ? `${groupCompany.code} - ${groupCompany.name}`
                    : "-";
                  const countryLabel = country
                    ? `${country.iso2} - ${country.name}`
                    : "-";
                  const status = normalizeUpperText(row.status) || "ACTIVE";
                  const statusTone =
                    status === "INACTIVE"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900";
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.id}</td>
                      <td className="px-3 py-2">{row.code}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{groupLabel}</td>
                      <td className="px-3 py-2">{countryLabel}</td>
                      <td className="px-3 py-2">{row.functional_currency_code}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}
                        >
                          {getLegalEntityStatusLabel(status, l)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleLegalEntityEdit(row)}
                          disabled={saving === "entity" || !canUpsertLegalEntity}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {l("Edit", "Duzenle")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {workspaceLegalEntities.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-3 text-slate-500">
                      {l("No legal entities found.", "Istirak / bagli ortak bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Operating Units / Branches", "Operasyon Birimleri / Subeler")}
          </h2>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {l(
              "Saved current-account config and Repair missing only are the default path. The four account picks below stay available as advanced exception-mode manual overrides, with exact branch matches listed before same-entity fallback accounts.",
              "Kaydedilen cari hesap konfigurasyonu ve Sadece eksikleri onar varsayilan yoldur. Asagidaki dort hesap secimi gelismis istisna-modu manuel override olarak acik kalir; tam sube eslesmeleri ayni entity icindeki yedek hesaplardan once listelenir."
            )}
          </div>
          <form onSubmit={handleOperatingUnitSubmit} className="grid gap-2 md:grid-cols-6">
            <select
              value={unitForm.legalEntityId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                  centralDueFromAccountId: "",
                  centralDueToAccountId: "",
                  ouDueFromCentralAccountId: "",
                  ouDueToCentralAccountId: "",
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {workspaceLegalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={unitForm.code}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Unit code", "Birim kodu")}
              required
            />
            <input
              value={unitForm.name}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Unit name", "Birim adi")}
              required
            />
            <select
              value={unitForm.unitType}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, unitType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {UNIT_TYPES.map((unitType) => (
                <option key={unitType} value={unitType}>
                  {unitType}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={unitForm.hasSubledger}
                onChange={(event) =>
                  setUnitForm((prev) => ({
                    ...prev,
                    hasSubledger: event.target.checked,
                  }))
                }
              />
              {l("Has subledger", "Alt defter var")}
            </label>
            <select
              value={unitForm.centralDueFromAccountId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  centralDueFromAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
            >
              <option value="">
                {l("Central Due From OU (optional)", "Merkez OU Alacagi (opsiyonel)")}
              </option>
              {unitCentralDueFromAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <select
              value={unitForm.centralDueToAccountId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  centralDueToAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
            >
              <option value="">
                {l("Central Due To OU (optional)", "Merkez OU Borcu (opsiyonel)")}
              </option>
              {unitOuDueToCentralAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <select
              value={unitForm.ouDueFromCentralAccountId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  ouDueFromCentralAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
            >
              <option value="">
                {l("OU Due From Central (optional)", "OU Merkezden Alacak (opsiyonel)")}
              </option>
              {unitCentralDueFromAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <select
              value={unitForm.ouDueToCentralAccountId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  ouDueToCentralAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
            >
              <option value="">
                {l("OU Due To Central (optional)", "OU Merkeze Borc (opsiyonel)")}
              </option>
              {unitOuDueToCentralAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-6">
              <div>
                {l(
                  "For central/OU self-balancing, configure all four directional fields on this operating unit. The first pair keeps OU-targeted capital and central-to-OU flows backward-compatible; the reverse pair is required for cross-context collections and settlement splits.",
                  "Merkez/OU self-balancing icin bu operasyon biriminde dort yonlu alani tanimlayin. Ilk cift OU hedefli sermaye ve merkezden OU'ya akislarini geriye uyumlu tutar; ters yon cift ise contextler arasi tahsilat ve mutabakat bolunmesi icin gereklidir."
                )}
              </div>
              <div className="mt-1">
                {l(
                  "Central Due From OU must be an active, postable, leaf legal-entity account with ASSET type and DEBIT normal side.",
                  "Merkez OU Alacagi, ayni legal entity icinde aktif, post edilebilir, leaf bir hesap olmali; hesap tipi ASSET ve normal bakiye yonu DEBIT olmalidir."
                )}
              </div>
              <div className="mt-1">
                {l(
                  "OU Due To Central must be an active, postable, leaf legal-entity account with LIABILITY type and CREDIT normal side.",
                  "OU Merkeze Borc, ayni legal entity icinde aktif, post edilebilir, leaf bir hesap olmali; hesap tipi LIABILITY ve normal bakiye yonu CREDIT olmalidir."
                )}
              </div>
              <div className="mt-1">
                {l(
                  "Central Due To OU must be an active, postable, leaf legal-entity account with LIABILITY type and CREDIT normal side. OU Due From Central must be an active, postable, leaf legal-entity account with ASSET type and DEBIT normal side.",
                  "Merkez OU Borcu aktif, post edilebilir, leaf bir LIABILITY/CREDIT hesap olmali. OU Merkezden Alacak ise aktif, post edilebilir, leaf bir ASSET/DEBIT hesap olmali."
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6">
              <button
                type="submit"
                disabled={saving === "unit" || !canUpsertOperatingUnit}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "unit"
                  ? l("Saving...", "Kaydediliyor...")
                  : unitEditingKey
                    ? l("Update", "Guncelle")
                    : l("Save", "Kaydet")}
              </button>
              {unitEditingKey ? (
                <button
                  type="button"
                  onClick={resetUnitForm}
                  disabled={saving === "unit"}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {l("Cancel edit", "Duzenlemeyi iptal et")}
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Entity", "Istirak / Bagli Ortak")}</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tur")}</th>
                  <th className="px-3 py-2">{l("Subledger", "Alt Defter")}</th>
                  <th className="px-3 py-2">{l("Central Due From", "Merkez Alacagi")}</th>
                  <th className="px-3 py-2">{l("Central Due To", "Merkez Borcu")}</th>
                  <th className="px-3 py-2">{l("OU Due From Central", "OU Merkezden Alacak")}</th>
                  <th className="px-3 py-2">{l("OU Due To Central", "OU Merkeze Borc")}</th>
                  <th className="px-3 py-2">{l("Capital Ready", "Sermaye Hazir")}</th>
                  <th className="px-3 py-2">{l("Cross-Context Ready", "Contextler Arasi Hazir")}</th>
                  <th className="px-3 py-2">{l("Actions", "Islemler")}</th>
                </tr>
              </thead>
              <tbody>
                {workspaceOperatingUnits.map((row) => {
                  const legalEntity = legalEntityById.get(
                    toNumber(row.legal_entity_id)
                  );
                  const configSummary =
                    operatingUnitCurrentAccountConfigSummaryByEntityId.get(
                      toNumber(row.legal_entity_id)
                    ) || null;
                  const legalEntityLabel = legalEntity
                    ? `${legalEntity.code} - ${legalEntity.name}`
                    : "-";
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.id}</td>
                      <td className="px-3 py-2">{legalEntityLabel}</td>
                      <td className="px-3 py-2">{row.code}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.unit_type}</td>
                      <td className="px-3 py-2">{row.has_subledger ? l("Yes", "Evet") : l("No", "Hayir")}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">
                          {row.central_due_from_account_id
                            ? l("Configured", "Yapilandirildi")
                            : l("Missing", "Eksik")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.central_due_from_account_code
                            ? `${row.central_due_from_account_code} - ${row.central_due_from_account_name || ""}`.trim()
                            : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">
                          {row.central_due_to_account_id
                            ? l("Configured", "Yapilandirildi")
                            : l("Missing", "Eksik")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.central_due_to_account_code
                            ? `${row.central_due_to_account_code} - ${row.central_due_to_account_name || ""}`.trim()
                            : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">
                          {row.ou_due_from_central_account_id
                            ? l("Configured", "Yapilandirildi")
                            : l("Missing", "Eksik")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.ou_due_from_central_account_code
                            ? `${row.ou_due_from_central_account_code} - ${row.ou_due_from_central_account_name || ""}`.trim()
                            : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">
                          {row.ou_due_to_central_account_id
                            ? l("Configured", "Yapilandirildi")
                            : l("Missing", "Eksik")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.ou_due_to_central_account_code
                            ? `${row.ou_due_to_central_account_code} - ${row.ou_due_to_central_account_name || ""}`.trim()
                            : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.capital_self_balancing_ready
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                            }`}
                        >
                          {row.capital_self_balancing_ready
                            ? l("Ready", "Hazir")
                            : l("Missing setup", "Kurulum eksik")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.cross_context_self_balancing_ready
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                            }`}
                        >
                          {row.cross_context_self_balancing_ready
                            ? l("Ready", "Hazir")
                            : l("Missing setup", "Kurulum eksik")}
                        </span>
                        {configSummary?.configured && !row.cross_context_self_balancing_ready ? (
                          <div className="mt-1 text-[11px] text-amber-700">
                            {l(
                              "Drift: one or more of the four central <> branch mappings is still missing. Use saved-config repair for the safe default fix.",
                              "Drift: merkez <> sube arasindaki dort eslemeden biri veya birkaci halen eksik. Guvenli varsayilan duzeltme icin kaydedilen konfigurasyon onarimini kullanin."
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleOperatingUnitEdit(row)}
                            disabled={saving === "unit" || !canUpsertOperatingUnit}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {l("Edit", "Duzenle")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleApplyOperatingUnitCurrentAccounts({
                                legalEntityId: row.legal_entity_id,
                                operatingUnitId: row.id,
                              })
                            }
                            disabled={
                              saving === "operating-unit-current-account-apply" ||
                              !canUpsertAccounts ||
                              !canUpsertOperatingUnit
                            }
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {saving === "operating-unit-current-account-apply"
                              ? l("Applying...", "Uygulaniyor...")
                              : l(
                                  "Auto-provision current accounts",
                                  "Cari hesaplari otomatik provision et"
                                )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {workspaceOperatingUnits.length === 0 && !loading && (
                  <tr>
                    <td colSpan={13} className="px-3 py-3 text-slate-500">
                      {l("No operating units found.", "Operasyon birimi bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l(
              "OU Current-Account Config",
              "Operasyon Birimi Cari Hesap Konfigurasyonu"
            )}
          </h2>
          <p className="mb-3 text-xs text-slate-600">
            {l(
              "Choose one Due From parent and one Due To parent per legal entity. Saved config becomes the setup-time and branch-add auto-provision source; use active LEGAL_ENTITY accounts with matching ASSET/DEBIT and LIABILITY/CREDIT sides. If SaaP provisions child current accounts under a selected posting account, it will convert that account to non-postable automatically. After that, Repair missing only is the default review-and-fix action; the manual leaf-account forms below stay available only for exceptions.",
              "Her legal entity icin bir Alacak parent ve bir Borc parent secin. Kaydedilen konfigurasyon kurulum ve sonradan sube ekleme otomasyonunun kaynagi olur; ayni legal entity icindeki aktif ve uygun ASSET/DEBIT ile LIABILITY/CREDIT tarafa sahip hesaplari kullanin. SaaP secilen posting hesabin altina cari alt hesaplar acarsa o hesabi otomatik olarak post edilemeyen duruma cevirir. Bundan sonra varsayilan inceleme ve duzeltme aksiyonu Sadece eksikleri onar olur; asagidaki manuel leaf-hesap formlari sadece istisnalar icin acik kalir."
            )}
          </p>
          <form
            onSubmit={handleOperatingUnitCurrentAccountConfigSubmit}
            className="grid gap-2 md:grid-cols-5"
          >
            <select
              value={operatingUnitCurrentAccountConfigForm.legalEntityId}
              onChange={(event) =>
                handleOperatingUnitCurrentAccountConfigEntityChange(event.target.value)
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {workspaceLegalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <select
              value={operatingUnitCurrentAccountConfigForm.dueFromParentAccountId}
              onChange={(event) =>
                setOperatingUnitCurrentAccountConfigForm((prev) => ({
                  ...prev,
                  dueFromParentAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              disabled={!canReadAccounts}
              required
            >
              <option value="">
                {canReadAccounts
                  ? l(
                      "Due From parent (ASSET/DEBIT candidate)",
                      "Alacak parent (ASSET/DEBIT adayi)"
                    )
                  : l("Need gl.account.read", "gl.account.read yetkisi gerekli")}
              </option>
              {operatingUnitCurrentDueFromParentOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountOptionLabel(account)}
                </option>
              ))}
            </select>
            <select
              value={operatingUnitCurrentAccountConfigForm.dueToParentAccountId}
              onChange={(event) =>
                setOperatingUnitCurrentAccountConfigForm((prev) => ({
                  ...prev,
                  dueToParentAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              disabled={!canReadAccounts}
              required
            >
              <option value="">
                {canReadAccounts
                  ? l(
                      "Due To parent (LIABILITY/CREDIT candidate)",
                      "Borc parent (LIABILITY/CREDIT adayi)"
                    )
                  : l("Need gl.account.read", "gl.account.read yetkisi gerekli")}
              </option>
              {operatingUnitCurrentDueToParentOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountOptionLabel(account)}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-3">
              <input
                type="checkbox"
                checked={Boolean(
                  operatingUnitCurrentAccountConfigForm.autoProvisionOnOperatingUnitCreate
                )}
                onChange={(event) =>
                  setOperatingUnitCurrentAccountConfigForm((prev) => ({
                    ...prev,
                    autoProvisionOnOperatingUnitCreate: event.target.checked,
                  }))
                }
              />
              {l(
                "Auto-provision when a new branch is created",
                "Yeni sube olusturulunca otomatik provision et"
              )}
            </label>
            <div className="flex items-center gap-2 md:col-span-2">
              <button
                type="submit"
                disabled={
                  saving === "operating-unit-current-account-config" ||
                  !canUpsertLegalEntity
                }
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "operating-unit-current-account-config"
                  ? l("Saving...", "Kaydediliyor...")
                  : l("Save config", "Konfigurasyonu kaydet")}
              </button>
            </div>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("Entity", "Legal Entity")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Drift / Notes", "Drift / Notlar")}</th>
                  <th className="px-3 py-2">{l("Due From Parent", "Alacak Parent")}</th>
                  <th className="px-3 py-2">{l("Due To Parent", "Borc Parent")}</th>
                  <th className="px-3 py-2">{l("Auto-provision", "Oto-provision")}</th>
                  <th className="px-3 py-2">{l("Last Applied", "Son Uygulama")}</th>
                  <th className="px-3 py-2">{l("Actions", "Islemler")}</th>
                </tr>
              </thead>
              <tbody>
                {workspaceOperatingUnitCurrentAccountConfigs.map((row) => {
                  const readinessRow = getModuleRow(
                    "operatingUnitCurrentAccounts",
                    toNumber(row?.legal_entity_id)
                  );
                  const configured =
                    toNumber(row?.due_from_parent_account_id) &&
                    toNumber(row?.due_to_parent_account_id);
                  const summary =
                    operatingUnitCurrentAccountConfigSummaryByEntityId.get(
                      toNumber(row?.legal_entity_id)
                    ) || summarizeOperatingUnitCurrentAccountConfigDrift(
                      row,
                      operatingUnits,
                      operatingUnitPartnerCurrentAccounts
                    );
                  const statusTone = !configured
                    ? "bg-amber-100 text-amber-700"
                    : readinessRow?.applicable === false
                      ? "bg-slate-100 text-slate-700"
                      : readinessRow?.ready
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700";
                  const statusLabel = !configured
                    ? l("Missing", "Eksik")
                    : readinessRow?.applicable === false
                      ? l("Not required yet", "Henuz gerekli degil")
                      : readinessRow?.blockerCode === "CONFIG_SAVED_NOT_APPLIED"
                        ? l("Apply pending", "Uygulama bekliyor")
                        : readinessRow?.ready
                          ? l("Ready", "Hazir")
                          : l("Needs review", "Inceleme gerekli");
                  return (
                    <tr
                      key={`ou-current-account-config-${row?.legal_entity_id || "missing"}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">
                        {String(row?.legal_entity_code || "").trim()
                          ? `${row.legal_entity_code} - ${row.legal_entity_name || ""}`.trim()
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone}`}
                        >
                          {statusLabel}
                        </span>
                        <div className="mt-1 text-xs text-slate-500">
                            {summary.currentAccountSetupExpected
                              ? l(
                                  `${summary.effectiveActiveOperatingUnitCount} active branches are in cross-context scope.`,
                                  `Capraz-context kapsaminda ${summary.effectiveActiveOperatingUnitCount} aktif sube var.`
                                )
                            : l(
                                "Cross-context setup is not required yet because this legal entity has zero or one active branch in scope.",
                                "Bu legal entity kapsaminda sifir veya tek aktif sube oldugu icin capraz-context kurulum henuz gerekli degil."
                              )}
                        </div>
                        {readinessRow ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {formatOperatingUnitCurrentAccountBlocker(
                              {
                                ...readinessRow,
                                legalEntityId: row?.legal_entity_id,
                                legalEntityCode: row?.legal_entity_code,
                                legalEntityName: row?.legal_entity_name,
                              },
                              l
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {!configured ? (
                          <div className="text-xs text-slate-500">
                            {l(
                              "Save the parent config first to enable repair and drift checks.",
                              "Onarim ve drift kontrollerini acmak icin once parent konfigurasyonunu kaydedin."
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1 text-xs text-slate-600">
                            <div>
                              {l(
                                `OU rows missing one or more of four central <> branch mappings: ${summary.missingCentralMappingOperatingUnitCount}`,
                                `Merkez <> sube arasindaki dort eslemeden biri veya daha fazlasi eksik OU satiri: ${summary.missingCentralMappingOperatingUnitCount}`
                              )}
                            </div>
                            <div>
                              {l(
                                `Branch-pair directions missing: ${summary.missingPartnerDirectionCount} / ${summary.expectedPartnerDirectionCount}`,
                                `Eksik sube-cifti yonu: ${summary.missingPartnerDirectionCount} / ${summary.expectedPartnerDirectionCount}`
                              )}
                            </div>
                            {summary.configChangedSinceLastApply ? (
                              <div className="font-medium text-amber-700">
                                {l(
                                  "Config changed after the last successful apply.",
                                  "Konfigurasyon son basarili uygulamadan sonra degisti."
                                )}
                              </div>
                            ) : null}
                            {summary.legalEntityStillNotReady ? (
                              <div className="font-medium text-amber-700">
                                {l(
                                  "Saved config exists, but this legal entity is still not fully ready.",
                                  "Kaydedilen konfigurasyon var, ancak bu legal entity halen tam hazir degil."
                                )}
                              </div>
                            ) : !summary.hasDrift ? (
                              <div className="font-medium text-emerald-700">
                                {l(
                                  "Saved config and mappings are aligned.",
                                  "Kaydedilen konfigurasyon ve eslemeler hizali."
                                )}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row?.due_from_parent_account_code
                          ? `${row.due_from_parent_account_code} - ${row.due_from_parent_account_name || ""}`.trim()
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {row?.due_to_parent_account_code
                          ? `${row.due_to_parent_account_code} - ${row.due_to_parent_account_name || ""}`.trim()
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {configured
                          ? row?.auto_provision_on_operating_unit_create
                            ? l("Enabled", "Acik")
                            : l("Disabled", "Kapali")
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {formatTimestampLabel(row?.last_applied_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleOperatingUnitCurrentAccountConfigEdit(row)}
                            disabled={saving === "operating-unit-current-account-config"}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {l("Edit", "Duzenle")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleApplyOperatingUnitCurrentAccounts({
                                legalEntityId: row.legal_entity_id,
                              })
                            }
                            disabled={
                              !configured ||
                              saving === "operating-unit-current-account-apply" ||
                              !canUpsertAccounts ||
                              !canUpsertOperatingUnit
                            }
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {saving === "operating-unit-current-account-apply"
                              ? l("Applying...", "Uygulaniyor...")
                              : l(
                                  "Repair missing only",
                                  "Sadece eksikleri onar"
                                )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {workspaceOperatingUnitCurrentAccountConfigs.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-3 text-slate-500">
                      {l(
                        "No legal entities found for OU current-account config.",
                        "OU cari hesap konfigurasyonu icin legal entity bulunamadi."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l(
              "Branch Pair Current Accounts",
              "Sube Cift Cari Hesaplari"
            )}
          </h2>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {l(
              "This manual branch-pair form is advanced exception mode. Use saved-config automation and Repair missing only first; if you must override, exact branch-pair matches are listed before same-entity fallback accounts.",
              "Bu manuel sube-cifti formu gelismis istisna modudur. Once kaydedilen konfigurasyon otomasyonunu ve Sadece eksikleri onar aksiyonunu kullanin; override zorunluysa tam sube-cifti eslesmeleri ayni entity icindeki yedek hesaplardan once listelenir."
            )}
          </div>
          <form
            onSubmit={handleOperatingUnitPartnerCurrentSubmit}
            className="grid gap-2 md:grid-cols-6"
          >
            <select
              value={unitPartnerCurrentForm.legalEntityId}
              onChange={(event) =>
                setUnitPartnerCurrentForm((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                  operatingUnitId: "",
                  partnerOperatingUnitId: "",
                  dueFromAccountId: "",
                  dueToAccountId: "",
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {workspaceLegalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <select
              value={unitPartnerCurrentForm.operatingUnitId}
              onChange={(event) =>
                setUnitPartnerCurrentForm((prev) => ({
                  ...prev,
                  operatingUnitId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Source branch", "Kaynak sube")}</option>
              {selectedUnitPartnerCurrentOperatingUnits.map((row) => (
                <option key={row.id} value={row.id}>
                  {formatOperatingUnitLabel(row)}
                </option>
              ))}
            </select>
            <select
              value={unitPartnerCurrentForm.partnerOperatingUnitId}
              onChange={(event) =>
                setUnitPartnerCurrentForm((prev) => ({
                  ...prev,
                  partnerOperatingUnitId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Partner branch", "Partner sube")}</option>
              {selectedUnitPartnerCurrentOperatingUnits.map((row) => (
                <option key={row.id} value={row.id}>
                  {formatOperatingUnitLabel(row)}
                </option>
              ))}
            </select>
            <select
              value={unitPartnerCurrentForm.dueFromAccountId}
              onChange={(event) =>
                setUnitPartnerCurrentForm((prev) => ({
                  ...prev,
                  dueFromAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">
                {l("Due From Partner OU", "Partnerden Alacak OU")}
              </option>
              {unitPartnerCurrentDueFromAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <select
              value={unitPartnerCurrentForm.dueToAccountId}
              onChange={(event) =>
                setUnitPartnerCurrentForm((prev) => ({
                  ...prev,
                  dueToAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">
                {l("Due To Partner OU", "Partnere Borc OU")}
              </option>
              {unitPartnerCurrentDueToAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatRankedOperatingUnitCurrentAccountOptionLabel(account, l)}
                </option>
              ))}
            </select>
            <div className="text-xs text-slate-500 md:col-span-6">
              {l(
                "Configure direct branch-pair current accounts for branch-to-branch cash transfers only when the saved-config path is not enough. Save both directions separately when cash can move both ways.",
                "Dogrudan sube cift cari hesaplarini sadece kaydedilen konfigurasyon yolu yeterli olmadiginda tanimlayin. Nakit iki yone de gidecekse iki yonu ayri ayri kaydedin."
              )}
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6">
              <button
                type="submit"
                disabled={saving === "unit-partner-current" || !canUpsertOperatingUnit}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "unit-partner-current"
                  ? l("Saving...", "Kaydediliyor...")
                  : unitPartnerCurrentEditingKey
                    ? l("Update", "Guncelle")
                    : l("Save", "Kaydet")}
              </button>
              {unitPartnerCurrentEditingKey ? (
                <button
                  type="button"
                  onClick={resetUnitPartnerCurrentForm}
                  disabled={saving === "unit-partner-current"}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {l("Cancel edit", "Duzenlemeyi iptal et")}
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Entity", "Istirak / Bagli Ortak")}</th>
                  <th className="px-3 py-2">{l("Source Branch", "Kaynak Sube")}</th>
                  <th className="px-3 py-2">{l("Partner Branch", "Partner Sube")}</th>
                  <th className="px-3 py-2">{l("Due From Partner", "Partnerden Alacak")}</th>
                  <th className="px-3 py-2">{l("Due To Partner", "Partnere Borc")}</th>
                  <th className="px-3 py-2">{l("Actions", "Islemler")}</th>
                </tr>
              </thead>
              <tbody>
                {workspaceOperatingUnitPartnerCurrentAccounts.map((row) => {
                  const legalEntity = legalEntityById.get(toNumber(row.legal_entity_id));
                  const legalEntityLabel = legalEntity
                    ? `${legalEntity.code} - ${legalEntity.name}`
                    : "-";
                  return (
                    <tr
                      key={`${row.id}-${row.operating_unit_id}-${row.partner_operating_unit_id}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">{row.id}</td>
                      <td className="px-3 py-2">{legalEntityLabel}</td>
                      <td className="px-3 py-2">
                        {formatOperatingUnitLabel({
                          code: row.operating_unit_code,
                          name: row.operating_unit_name,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        {formatOperatingUnitLabel({
                          code: row.partner_operating_unit_code,
                          name: row.partner_operating_unit_name,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        {row.due_from_account_code
                          ? `${row.due_from_account_code} - ${row.due_from_account_name || ""}`.trim()
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {row.due_to_account_code
                          ? `${row.due_to_account_code} - ${row.due_to_account_name || ""}`.trim()
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleOperatingUnitPartnerCurrentEdit(row)}
                          disabled={saving === "unit-partner-current" || !canUpsertOperatingUnit}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {l("Edit", "Duzenle")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {workspaceOperatingUnitPartnerCurrentAccounts.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-slate-500">
                      {l(
                        "No branch pair current accounts found.",
                        "Sube cift cari hesabi bulunamadi."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {shareholderCardExpanded && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/45"
            onClick={() => setShareholderCardExpanded(false)}
          />
        )}

        <section
          className={`border border-slate-200 bg-white p-4 ${shareholderCardExpanded
            ? "fixed inset-4 z-50 overflow-auto rounded-xl shadow-2xl"
            : "relative rounded-xl"
            }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              {l("Shareholders", "Ortaklar")}
            </h2>
            <button
              type="button"
              onClick={() => setShareholderCardExpanded((value) => !value)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              title={
                shareholderCardExpanded
                  ? l("Exit expanded view", "Genis gorunumden cik")
                  : l("Expand card", "Karti genislet")
              }
              aria-label={
                shareholderCardExpanded
                  ? l("Exit expanded view", "Genis gorunumden cik")
                  : l("Expand card", "Karti genislet")
              }
            >
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                aria-hidden="true"
              >
                {shareholderCardExpanded ? (
                  <path
                    d="M7.5 4.5H4.5v3m8-3h3v3m-8 8h-3v-3m8 3h3v-3M4.5 7.5l4-4m7 4l-4-4m-7 9l4 4m7-4l-4 4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M7.5 4.5H4.5v3m8-3h3v3m-8 8h-3v-3m8 3h3v-3M8 8l-3.5-3.5m7 3.5l3.5-3.5M8 12l-3.5 3.5m7-3.5l3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </button>
          </div>
          {selectedShareholderLegalEntityId ? (
            isScopedCapitalFulfillmentOperator ? (
              <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <div className="text-xs font-semibold text-sky-900">
                  {l(
                    "Capital fulfillment workspace",
                    "Sermaye karsilama calisma alani"
                  )}
                </div>
                <p className="mt-1 text-xs text-sky-800">
                  {l(
                    "Tenant-wide onboarding readiness does not block your scoped work here. Posting follows legal-entity prerequisites only.",
                    "Tenant geneli onboarding hazirligi burada sizin scope'lu calismanizi bloklamaz. Posting sadece legal entity on kosullarina gore ilerler."
                  )}
                </p>
                <div className="mt-2 grid gap-1 text-xs text-sky-900 md:grid-cols-2">
                  <div className="rounded border border-sky-200 bg-white px-2 py-1">
                    {l(
                      "Shareholder must have capital and commitment sub-accounts.",
                      "Ortaga sermaye ve taahhut alt hesaplari tanimli olmalidir."
                    )}
                  </div>
                  <div className="rounded border border-sky-200 bg-white px-2 py-1">
                    {l(
                      "Contribution date must be inside an OPEN fiscal period.",
                      "Katki tarihi OPEN durumundaki mali donem icinde olmalidir."
                    )}
                  </div>
                  <div className="rounded border border-sky-200 bg-white px-2 py-1">
                    {l(
                      "Selected bank, cash, or asset destination must be available in this legal entity.",
                      "Secilen banka, kasa veya varlik hedefi bu legal entity icinde kullanilabilir olmalidir."
                    )}
                  </div>
                  <div className="rounded border border-sky-200 bg-white px-2 py-1">
                    {l(
                      "OU-targeted posting still requires internal current-account readiness.",
                      "OU hedefli posting icin ic cari hesap hazirligi yine gereklidir."
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openCapitalFulfillmentModal}
                    disabled={!capitalFulfillmentCanOpen}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {l("Record capital fulfillment", "Sermaye karsilamasi kaydet")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">
                  {l(
                    "Kurulum Adimlari / Next Recommended Action",
                    "Kurulum Adimlari / Sonraki Onerilen Aksiyon"
                  )}
                </div>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  {shareholderSetupSteps.map((step) => (
                    <div
                      key={step.key}
                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      <span className="text-slate-700">{step.label}</span>
                      <span
                        className={`rounded px-2 py-0.5 font-semibold ${step.status === "DONE"
                          ? "bg-emerald-100 text-emerald-700"
                          : step.status === "CURRENT"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-slate-100 text-slate-700"
                          }`}
                      >
                        {step.status === "DONE"
                          ? l("Done", "Tamam")
                          : step.status === "CURRENT"
                            ? l("Current", "Siradaki")
                            : l("Waiting", "Bekliyor")}
                      </span>
                    </div>
                  ))}
                </div>
                {nextShareholderSetupStep ? (
                  <div className="mt-2 rounded border border-sky-200 bg-sky-50 px-2 py-2 text-xs text-sky-900">
                    <span className="font-semibold">
                      {l("Next recommended action:", "Sonraki onerilen aksiyon:")}
                    </span>{" "}
                    {nextShareholderSetupStep.label}
                  </div>
                ) : null}
                {selectedShareholderCommitmentReadiness ? (
                  <div
                    className={`mt-2 rounded border px-2 py-2 text-xs ${selectedShareholderCommitmentReadiness.ready
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {l(
                          "Module readiness: shareholder commitment",
                          "Modul hazirligi: ortak taahhut"
                        )}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 font-semibold ${selectedShareholderCommitmentReadiness.ready
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-800"
                          }`}
                      >
                        {selectedShareholderCommitmentReadiness.ready
                          ? l("READY", "HAZIR")
                          : l("NOT READY", "HAZIR DEGIL")}
                      </span>
                    </div>
                    {!selectedShareholderCommitmentReadiness.ready ? (
                      <>
                        {Array.isArray(
                          selectedShareholderCommitmentReadiness.missingPurposeCodes
                        ) &&
                          selectedShareholderCommitmentReadiness.missingPurposeCodes.length > 0 ? (
                          <p className="mt-1">
                            {l("Missing purpose codes:", "Eksik amac kodlari:")}{" "}
                            {selectedShareholderCommitmentReadiness.missingPurposeCodes.join(
                              ", "
                            )}
                          </p>
                        ) : null}
                        {Array.isArray(
                          selectedShareholderCommitmentReadiness.invalidMappings
                        ) &&
                          selectedShareholderCommitmentReadiness.invalidMappings.length > 0 ? (
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {selectedShareholderCommitmentReadiness.invalidMappings.map(
                              (row, index) => (
                                <li key={`shareholder-readiness-invalid-${index}`}>
                                  {String(row?.purposeCode || "-")}:{" "}
                                  {formatShareholderReadinessReason(row?.reason, l)}
                                </li>
                              )
                            )}
                          </ul>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
                            className="rounded border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900"
                          >
                            {l("Fix manually", "Elle duzelt")}
                          </Link>
                          <Link
                            to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
                            className="rounded border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900"
                          >
                            {l("Use template", "Sablon kullan")}
                          </Link>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("shareholder-parent-mapping-form")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                  >
                    {l("Parent eslemeye git", "Parent eslemeye git")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutoSubAccountSetupModalOpen(true)}
                    disabled={
                      !canUpsertAccounts ||
                      !hasShareholderParentMapping ||
                      (!hasMissingCreditEquitySubAccount &&
                        !hasMissingDebitEquitySubAccount)
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {l("Otomatik alt hesap olustur", "Otomatik alt hesap olustur")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("shareholder-form-block")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                  >
                    {l("Ortak ekle", "Ortak ekle")}
                  </button>
                  <button
                    type="button"
                    onClick={openCommitmentIncreaseModal}
                    disabled={
                      !canUpsertShareholder ||
                      eligibleShareholdersForCommitmentIncrease.length === 0
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {l("Sermaye taahhut arttirimi", "Sermaye taahhut arttirimi")}
                  </button>
                  <button
                    type="button"
                    onClick={openCapitalFulfillmentModal}
                    disabled={!capitalFulfillmentCanOpen}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {l("Record capital fulfillment", "Sermaye karsilamasi kaydet")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setBatchCommitmentDate(
                        shareholderForm.commitmentDate ||
                        new Date().toISOString().slice(0, 10)
                      );
                      setBatchCommitmentModalOpen(true);
                      await handlePreviewBatchCommitmentJournal();
                    }}
                    disabled={
                      !canUpsertShareholder ||
                      pendingBatchCommitmentShareholders.length === 0 ||
                      shareholderCommitmentModuleNotReady
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {l("Toplu fis onizle", "Toplu fis onizle")}
                  </button>
                </div>
                <div className="mt-3 grid gap-1 md:grid-cols-2">
                  {selectedShareholderSetupChecks.map((check) => (
                    <div
                      key={check.key}
                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                    >
                      <span className="text-slate-700">{check.label}</span>
                      <span
                        className={`rounded px-2 py-0.5 font-semibold ${check.ready
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-800"
                          }`}
                      >
                        {check.ready ? l("OK", "Tamam") : l("Missing", "Eksik")}
                      </span>
                    </div>
                  ))}
                </div>
                {selectedShareholderMissingChecks.length > 0 ? (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900">
                    <div className="font-semibold">
                      {l(
                        "System notice: complete missing setup before relying on automatic commitment journals.",
                        "Sistem uyarisi: otomatik taahhut yevmiyesine gecmeden once eksik kurulumlari tamamlayin."
                      )}
                    </div>
                    {parentMappingStatus.reasons.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {parentMappingStatus.reasons.slice(0, 3).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          document
                            .getElementById("shareholder-form-block")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900"
                      >
                        {l("Go to shareholder form", "Ortak formuna git")}
                      </button>
                      <Link
                        to="/app/ayarlar/hesap-plani-ayarlari"
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900"
                      >
                        {l("Open GL setup", "GL ayarlarini ac")}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs text-emerald-800">
                    {l(
                      "System notice: setup is complete for automatic capital commitment draft journals.",
                      "Sistem bildirimi: otomatik sermaye taahhut taslak yevmiyesi icin kurulum tamamlandi."
                    )}
                  </div>
                )}
              </div>
            )
          ) : null}
          {selectedShareholderLegalEntityId ? (
            <form
              id="shareholder-parent-mapping-form"
              onSubmit={handleShareholderParentConfigSubmit}
              className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="text-xs font-semibold text-slate-700">
                {l(
                  "Shareholder parent account mapping (per legal entity)",
                  "Ortak parent hesap eslesmesi (legal entity bazli)"
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {l(
                  "Select non-postable header parent accounts used by shareholder sub-accounts. Example (TR): capital credit parent 500, commitment debit parent 501.",
                  "Ortak alt hesaplarinin baglanacagi post edilemeyen ust parent hesaplari secin. Ornek (TR): sermaye alacak parent 500, taahhut borc parent 501."
                )}
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <select
                  value={shareholderParentConfigForm.capitalCreditParentAccountId}
                  onChange={(event) =>
                    setShareholderParentConfigForm((prev) => ({
                      ...prev,
                      capitalCreditParentAccountId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  disabled={!canReadAccounts}
                >
                  <option value="">
                    {canReadAccounts
                      ? l(
                        "Capital credit parent (CREDIT/EQUITY)",
                        "Sermaye alacak parent (CREDIT/EQUITY)"
                      )
                      : l("Need gl.account.read", "gl.account.read yetkisi gerekli")}
                  </option>
                  {equityCreditParentShareholderAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </option>
                  ))}
                </select>
                <select
                  value={shareholderParentConfigForm.commitmentDebitParentAccountId}
                  onChange={(event) =>
                    setShareholderParentConfigForm((prev) => ({
                      ...prev,
                      commitmentDebitParentAccountId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  disabled={!canReadAccounts}
                >
                  <option value="">
                    {canReadAccounts
                      ? l(
                        "Commitment debit parent (DEBIT/EQUITY)",
                        "Taahhut borc parent (DEBIT/EQUITY)"
                      )
                      : l("Need gl.account.read", "gl.account.read yetkisi gerekli")}
                  </option>
                  {equityDebitParentShareholderAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={saving === "shareholderConfig" || !canUpsertShareholder}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {saving === "shareholderConfig"
                    ? l("Saving...", "Kaydediliyor...")
                    : l("Save Parent Mapping", "Parent Eslesmesini Kaydet")}
                </button>
              </div>
            </form>
          ) : null}
          {pendingBatchCommitmentShareholders.length > 0 ? (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 text-xs text-indigo-900">
              <div className="font-semibold">
                {l(
                  "Batch commitment journal queue",
                  "Toplu taahhut yevmiye kuyrugu"
                )}
              </div>
              <p className="mt-1">
                {l(
                  `${pendingBatchCommitmentShareholders.length} shareholder(s) queued for one draft journal entry.`,
                  `${pendingBatchCommitmentShareholders.length} ortak tek bir taslak yevmiye fisine alinmak uzere kuyrukta.`
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setBatchCommitmentDate(
                      shareholderForm.commitmentDate ||
                      new Date().toISOString().slice(0, 10)
                    );
                    setBatchCommitmentModalOpen(true);
                    await handlePreviewBatchCommitmentJournal();
                  }}
                  disabled={shareholderCommitmentModuleNotReady}
                  className="rounded border border-indigo-300 bg-white px-2.5 py-1 font-semibold text-indigo-900 disabled:opacity-50"
                >
                  {l(
                    "Create one batch commitment journal",
                    "Tek bir toplu taahhut yevmiyesi olustur"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => updateQueueForSelectedEntity([])}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700"
                >
                  {l("Clear queue", "Kuyrugu temizle")}
                </button>
              </div>
              {pendingBatchQueueCurrencyGroups.length > 1 ? (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-900">
                  <div className="font-semibold">
                    {l(
                      "Mixed currencies in queue. Keep one currency per batch.",
                      "Kuyrukta birden fazla para birimi var. Batch icin tek para birimi birakin."
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pendingBatchQueueCurrencyGroups.map((group) => (
                      <button
                        key={`queue-currency-${group.currencyCode}`}
                        type="button"
                        onClick={() => handleQueueKeepOnlyCurrency(group.currencyCode)}
                        className="rounded border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-900"
                      >
                        {l(
                          `Keep only ${group.currencyCode} (${group.count})`,
                          `Sadece ${group.currencyCode} (${group.count}) birak`
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {selectedShareholderLegalEntityId ? (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-700">
                    {l(
                      "Capital fulfillment history",
                      "Sermaye karsilama gecmisi"
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {l(
                      "Posted and reversed fulfillments for the selected legal entity.",
                      "Secilen legal entity icin post edilen ve ters cevrilen karsilamalar."
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadCapitalFulfillmentHistory(selectedShareholderLegalEntityId)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                >
                  {l("Reload", "Yenile")}
                </button>
              </div>
              {capitalFulfillmentHistoryError ? (
                <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-700">
                  {capitalFulfillmentHistoryError}
                </div>
              ) : null}
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-white text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5">{l("Date", "Tarih")}</th>
                      <th className="px-2 py-1.5">{l("Shareholder", "Ortak")}</th>
                      <th className="px-2 py-1.5">{l("Amount", "Tutar")}</th>
                      <th className="px-2 py-1.5">OU</th>
                      <th className="px-2 py-1.5">{l("Destination type", "Hedef tipi")}</th>
                      <th className="px-2 py-1.5">{l("Destination", "Hedef")}</th>
                      <th className="px-2 py-1.5">{l("Status", "Durum")}</th>
                      <th className="px-2 py-1.5">{l("Original journal", "Ilk yevmiye")}</th>
                      <th className="px-2 py-1.5">{l("Reversal journal", "Ters cevirme yevmiyesi")}</th>
                      <th className="px-2 py-1.5">{l("Action", "Islem")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capitalFulfillmentHistory.map((row) => {
                      const fulfillmentId = toNumber(row.id);
                      const isReversing = capitalFulfillmentReversingId === fulfillmentId;
                      const isCashRegisterDestination =
                        String(row.destination_mode || "").toUpperCase() ===
                        "CASH_REGISTER";
                      const showSeparateCashJournal =
                        isCashRegisterDestination &&
                        toNumber(row.cash_journal_entry_id) &&
                        toNumber(row.cash_journal_entry_id) !==
                        toNumber(row.journal_entry_id);
                      const showSeparateCashReversalJournal =
                        isCashRegisterDestination &&
                        toNumber(row.cash_reversal_journal_entry_id) &&
                        toNumber(row.cash_reversal_journal_entry_id) !==
                        toNumber(row.reversal_journal_entry_id);
                      return (
                        <tr
                          key={`capital-fulfillment-history-${row.id}`}
                          className="border-t border-slate-200"
                        >
                          <td className="px-2 py-1.5">{row.contribution_date || "-"}</td>
                          <td className="px-2 py-1.5">
                            {[row.shareholder_code, row.shareholder_name]
                              .filter(Boolean)
                              .join(" - ") || "-"}
                          </td>
                          <td className="px-2 py-1.5">
                            {formatAmount(row.amount_base || 0)} {row.currency_code || ""}
                          </td>
                          <td className="px-2 py-1.5">
                            {row.operating_unit_code || l("Central", "Merkezi")}
                          </td>
                          <td className="px-2 py-1.5">{row.destination_mode || "-"}</td>
                          <td className="px-2 py-1.5">
                            {formatCapitalFulfillmentDestination(row)}
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${String(row.status || "").toUpperCase() === "REVERSED"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700"
                                }`}
                            >
                              {row.status || "-"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="font-mono text-[11px] text-slate-800">
                              {row.journal_no || row.journal_entry_id || "-"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              ID {row.journal_entry_id || "-"}
                            </div>
                            {isCashRegisterDestination && row.cash_transaction_id ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                {l("Cash txn", "Kasa islemi")}:{" "}
                                <span className="font-mono text-slate-800">
                                  {row.cash_transaction_no || row.cash_transaction_id}
                                </span>
                              </div>
                            ) : null}
                            {showSeparateCashJournal ? (
                              <div className="text-[11px] text-slate-500">
                                {l("Cash journal", "Kasa yevmiyesi")}:{" "}
                                <span className="font-mono text-slate-800">
                                  {row.cash_journal_no || row.cash_journal_entry_id}
                                </span>
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5">
                            {row.reversal_journal_entry_id ? (
                              <>
                                <div className="font-mono text-[11px] text-slate-800">
                                  {row.reversal_journal_no || row.reversal_journal_entry_id}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  ID {row.reversal_journal_entry_id}
                                </div>
                                {isCashRegisterDestination && row.cash_reversal_transaction_id ? (
                                  <div className="mt-1 text-[11px] text-slate-500">
                                    {l("Reverse cash txn", "Ters kasa islemi")}:{" "}
                                    <span className="font-mono text-slate-800">
                                      {row.cash_reversal_transaction_no ||
                                        row.cash_reversal_transaction_id}
                                    </span>
                                  </div>
                                ) : null}
                                {showSeparateCashReversalJournal ? (
                                  <div className="text-[11px] text-slate-500">
                                    {l("Cash reversal journal", "Kasa ters yevmiyesi")}:{" "}
                                    <span className="font-mono text-slate-800">
                                      {row.cash_reversal_journal_no ||
                                        row.cash_reversal_journal_entry_id}
                                    </span>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => handleReverseCapitalFulfillment(row)}
                              disabled={
                                !canManageShareholderCapitalFulfillment ||
                                !fulfillmentId ||
                                String(row.status || "").toUpperCase() === "REVERSED" ||
                                isReversing
                              }
                              className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
                            >
                              {isReversing
                                ? l("Reversing...", "Ters cevriliyor...")
                                : l("Reverse", "Ters cevir")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {capitalFulfillmentHistory.length === 0 && !capitalFulfillmentHistoryLoading ? (
                      <tr>
                        <td colSpan={10} className="px-2 py-3 text-slate-500">
                          {l(
                            "No capital fulfillment history found for the selected legal entity.",
                            "Secilen legal entity icin sermaye karsilama gecmisi bulunamadi."
                          )}
                        </td>
                      </tr>
                    ) : null}
                    {capitalFulfillmentHistoryLoading ? (
                      <tr>
                        <td colSpan={10} className="px-2 py-3 text-slate-500">
                          {l(
                            "Loading capital fulfillment history...",
                            "Sermaye karsilama gecmisi yukleniyor..."
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {selectedShareholderLegalEntityId &&
            canReadAccounts &&
            (hasMissingCreditEquitySubAccount || hasMissingDebitEquitySubAccount) ? (
            <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-3 text-xs text-cyan-900">
              <div className="font-semibold">
                {l(
                  "Sub-account setup module",
                  "Alt hesap kurulum modulu"
                )}
              </div>
              <p className="mt-1">
                {l(
                  "No available mapped shareholder sub-account remains for this legal entity.",
                  "Bu istirak / bagli ortak icin eslenmis kullanilabilir ortak alt hesap kalmadi."
                )}
              </p>
              <div className="mt-2 space-y-1">
                {hasMissingCreditEquitySubAccount ? (
                  <div>
                    {l(
                      `Missing: no available CREDIT leaf sub-account under ${selectedCapitalCreditParentAccount?.code || "-"}.`,
                      `${selectedCapitalCreditParentAccount?.code || "-"} altinda kullanilabilir CREDIT leaf alt hesap yok.`
                    )}
                  </div>
                ) : null}
                {hasMissingDebitEquitySubAccount ? (
                  <div>
                    {l(
                      `Missing: no available DEBIT leaf sub-account under ${selectedCommitmentDebitParentAccount?.code || "-"}.`,
                      `${selectedCommitmentDebitParentAccount?.code || "-"} altinda kullanilabilir DEBIT leaf alt hesap yok.`
                    )}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canUpsertAccounts ? (
                  <button
                    type="button"
                    onClick={() => setAutoSubAccountSetupModalOpen(true)}
                    className="rounded border border-cyan-300 bg-white px-2.5 py-1 font-semibold text-cyan-900"
                  >
                    {l(
                      "Auto-create missing sub-accounts",
                      "Eksik alt hesaplari otomatik olustur"
                    )}
                  </button>
                ) : (
                  <span className="rounded border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900">
                    {l(
                      "Need gl.account.upsert permission for auto setup",
                      "Otomatik kurulum icin gl.account.upsert yetkisi gerekli"
                    )}
                  </span>
                )}
                <Link
                  to="/app/ayarlar/hesap-plani-ayarlari"
                  className="rounded border border-cyan-300 bg-white px-2.5 py-1 font-semibold text-cyan-900"
                >
                  {l("Open GL setup", "GL ayarlarini ac")}
                </Link>
              </div>
            </div>
          ) : null}
          <form
            id="shareholder-form-block"
            onSubmit={handleShareholderSubmit}
            className="grid gap-2 md:grid-cols-4"
          >
            <select
              value={shareholderForm.legalEntityId}
              onChange={(event) => {
                const nextLegalEntityId = event.target.value;
                const selectedEntity = legalEntities.find(
                  (row) => String(row.id) === String(nextLegalEntityId)
                );
                const defaultCurrency = String(
                  selectedEntity?.functional_currency_code || ""
                ).toUpperCase();
                setShareholderForm((prev) => ({
                  ...prev,
                  legalEntityId: nextLegalEntityId,
                  capitalSubAccountId: "",
                  commitmentDebitSubAccountId: "",
                  currencyCode: defaultCurrency || prev.currencyCode,
                }));
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {workspaceLegalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.code}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Shareholder code", "Ortak kodu")}
              required
            />
            <input
              value={shareholderForm.name}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Shareholder name", "Ortak adi")}
              required
            />

            <select
              value={shareholderForm.shareholderType}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  shareholderType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SHAREHOLDER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getShareholderTypeLabel(type, l)}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.taxId}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, taxId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Tax ID (optional)", "Vergi No (opsiyonel)")}
            />
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              {l(
                "Ownership % is auto-calculated from committed capital for all shareholders in this legal entity.",
                "Sahiplik %, bu legal entity icindeki tum ortaklar icin taahhut edilen sermayeye gore otomatik hesaplanir."
              )}
            </div>
            <select
              value={shareholderForm.capitalSubAccountId}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  capitalSubAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!canReadAccounts || !hasShareholderParentMapping}
            >
              <option value="">
                {canReadAccounts
                  ? !hasShareholderParentMapping
                    ? l(
                      "Save parent mapping first",
                      "Once parent eslesmesini kaydedin"
                    )
                    : availableCapitalCreditShareholderAccounts.length > 0
                      ? l(
                        `Capital credit sub-account (child of ${selectedCapitalCreditParentAccount?.code || "-"})`,
                        `${selectedCapitalCreditParentAccount?.code || "-"} altinda sermaye alacak alt hesap`
                      )
                      : l(
                        "No available mapped capital credit sub-account found",
                        "Eslenmis kullanilabilir sermaye alacak alt hesap bulunamadi"
                      )
                  : l(
                    "Need gl.account.read",
                    "gl.account.read yetkisi gerekli"
                  )}
              </option>
              {availableCapitalCreditShareholderAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <select
              value={shareholderForm.commitmentDebitSubAccountId}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  commitmentDebitSubAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!canReadAccounts || !hasShareholderParentMapping}
            >
              <option value="">
                {canReadAccounts
                  ? !hasShareholderParentMapping
                    ? l(
                      "Save parent mapping first",
                      "Once parent eslesmesini kaydedin"
                    )
                    : availableCommitmentDebitShareholderAccounts.length > 0
                      ? l(
                        `Commitment debit sub-account (child of ${selectedCommitmentDebitParentAccount?.code || "-"})`,
                        `${selectedCommitmentDebitParentAccount?.code || "-"} altinda taahhut borc alt hesap`
                      )
                      : l(
                        "No available mapped commitment debit sub-account found",
                        "Eslenmis kullanilabilir taahhut borc alt hesap bulunamadi"
                      )
                  : l(
                    "Need gl.account.read",
                    "gl.account.read yetkisi gerekli"
                  )}
              </option>
              {availableCommitmentDebitShareholderAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <select
              value={shareholderForm.currencyCode}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  currencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select currency", "Para birimi secin")}</option>
              {currencySelectOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={shareholderForm.commitmentDate}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  commitmentDate: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              title={l("Commitment date", "Taahhut tarihi")}
              required
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={shareholderForm.committedCapital}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  committedCapital: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l(
                "Commitment increase (this entry)",
                "Taahhut artisi (bu kayit)"
              )}
            />
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 md:col-span-2">
              {existingShareholderForForm
                ? l(
                  `Existing committed total: ${formatAmount(
                    formExistingCommittedCapitalAmount
                  )}. This entry increase: ${formatAmount(
                    formCommitmentIncreaseAmount
                  )}. New committed total: ${formatAmount(
                    formProjectedCommittedCapitalAmount
                  )}.`,
                  `Mevcut taahhut toplami: ${formatAmount(
                    formExistingCommittedCapitalAmount
                  )}. Bu kayit artisi: ${formatAmount(
                    formCommitmentIncreaseAmount
                  )}. Yeni taahhut toplami: ${formatAmount(
                    formProjectedCommittedCapitalAmount
                  )}.`
                )
                : l(
                  "Enter only the increase amount. For a new shareholder, this becomes the initial commitment.",
                  "Sadece artis tutarini girin. Yeni ortakta bu tutar ilk taahhut olur."
                )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {l(
                "Paid capital is auto-calculated from posted journals that credit the mapped commitment debit sub-account (e.g. 501.xx).",
                "Odenen sermaye, eslenen taahhut borc alt hesabini (orn. 501.xx) alacaklandiran post edilmis yevmiye kayitlarindan otomatik hesaplanir."
              )}
            </div>
            <select
              value={shareholderForm.status}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  status: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SHAREHOLDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getShareholderStatusLabel(status, l)}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.notes}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, notes: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Notes (optional)", "Notlar (opsiyonel)")}
            />
            <button
              type="submit"
              disabled={saving === "shareholder" || !canUpsertShareholder}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "shareholder"
                ? l("Saving...", "Kaydediliyor...")
                : l("Save Shareholder", "Ortagi Kaydet")}
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                updateQueueForSelectedEntity(
                  eligibleShareholdersForQueue.map((row) => toNumber(row.id)).filter(Boolean)
                )
              }
              disabled={eligibleShareholdersForQueue.length === 0}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              {l(
                `Queue all eligible (${eligibleShareholdersForQueue.length})`,
                `Uygunlarin hepsini kuyruga ekle (${eligibleShareholdersForQueue.length})`
              )}
            </button>
            {eligibleQueueCurrencyGroups.map((group) => (
              <button
                key={`eligible-currency-${group.currencyCode}`}
                type="button"
                onClick={() => updateQueueForSelectedEntity(group.shareholderIds)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700"
              >
                {l(
                  `Queue ${group.currencyCode} (${group.count})`,
                  `${group.currencyCode} (${group.count}) kuyruga ekle`
                )}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Entity", "Birim")}</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tur")}</th>
                  <th className="px-3 py-2">{l("Ownership %", "Sahiplik %")}</th>
                  <th className="px-3 py-2">
                    {l("Capital Sub-Account", "Sermaye Alt Hesap")}
                  </th>
                  <th className="px-3 py-2">
                    {l(
                      "Commitment Debit Sub-Account",
                      "Taahhut Borc Alt Hesap"
                    )}
                  </th>
                  <th className="px-3 py-2">{l("Committed", "Taahhut")}</th>
                  <th className="px-3 py-2">{l("Paid", "Odenen")}</th>
                  <th className="px-3 py-2">{l("Unpaid", "Kalan")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para birimi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Queue", "Kuyruk")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleShareholders.map((row) => {
                  console.log("Rendering shareholder row", { row });
                  const shareholderId = toNumber(row.id);
                  const isQueued = selectedEntityCommitmentQueueIdSet.has(shareholderId);
                  const legalEntity = legalEntityById.get(
                    toNumber(row.legal_entity_id)
                  );
                  const legalEntityLabel = legalEntity
                    ? `${legalEntity.code} - ${legalEntity.name}`
                    : "-";
                  const hasMappedSubAccounts =
                    Boolean(toNumber(row.capital_sub_account_id)) &&
                    Boolean(toNumber(row.commitment_debit_sub_account_id));
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.id}</td>
                      <td className="px-3 py-2">{legalEntityLabel}</td>
                      <td className="px-3 py-2">{row.code}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">
                        {getShareholderTypeLabel(row.shareholder_type, l)}
                      </td>
                      <td className="px-3 py-2">
                        {row.ownership_pct === null || row.ownership_pct === undefined
                          ? "-"
                          : Number(row.ownership_pct).toFixed(4)}
                      </td>
                      <td className="px-3 py-2">
                        {row.capital_sub_account_code
                          ? row.capital_sub_account_name
                            ? `${row.capital_sub_account_code} - ${row.capital_sub_account_name}`
                            : row.capital_sub_account_code
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {row.commitment_debit_sub_account_code
                          ? row.commitment_debit_sub_account_name
                            ? `${row.commitment_debit_sub_account_code} - ${row.commitment_debit_sub_account_name}`
                            : row.commitment_debit_sub_account_code
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {Number(row.committed_capital || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        {Number(row.paid_capital || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        {Number(row.unpaid_capital || 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2">{row.currency_code}</td>
                      <td className="px-3 py-2">
                        {getShareholderStatusLabel(row.status, l)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleQueueShareholderToggle(shareholderId, !isQueued)
                          }
                          disabled={!shareholderId || !hasMappedSubAccounts}
                          className={`rounded border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${isQueued
                            ? "border-rose-300 bg-rose-50 text-rose-800"
                            : "border-slate-300 bg-white text-slate-700"
                            }`}
                        >
                          {isQueued
                            ? l("Remove", "Kuyruktan cikar")
                            : l("Add", "Kuyruga ekle")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleShareholders.length === 0 && !loading && (
                  <tr>
                    <td colSpan={14} className="px-3 py-3 text-slate-500">
                      {l("No shareholders found.", "Ortak bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Fiscal Calendars and Periods", "Mali Takvimler ve Donemler")}
          </h2>

          <form onSubmit={handleFiscalCalendarSubmit} className="grid gap-2 md:grid-cols-5">
            <input
              value={calendarForm.code}
              onChange={(event) =>
                setCalendarForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Calendar code", "Takvim kodu")}
              required
            />
            <input
              value={calendarForm.name}
              onChange={(event) =>
                setCalendarForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Calendar name", "Takvim adi")}
              required
            />
            <input
              type="number"
              min={1}
              max={12}
              value={calendarForm.yearStartMonth}
              onChange={(event) =>
                setCalendarForm((prev) => ({
                  ...prev,
                  yearStartMonth: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Start month", "Baslangic ayi")}
              required
            />
            <input
              type="number"
              min={1}
              max={31}
              value={calendarForm.yearStartDay}
              onChange={(event) =>
                setCalendarForm((prev) => ({
                  ...prev,
                  yearStartDay: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Start day", "Baslangic gunu")}
              required
            />
            <button
              type="submit"
              disabled={saving === "calendar" || !canUpsertFiscalCalendar}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-5"
            >
              {saving === "calendar" ? l("Saving...", "Kaydediliyor...") : l("Save Calendar", "Takvimi Kaydet")}
            </button>
          </form>

          <form onSubmit={handleGeneratePeriods} className="mt-3 grid gap-2 md:grid-cols-4">
            <select
              value={periodForm.calendarId}
              onChange={(event) =>
                setPeriodForm((prev) => ({ ...prev, calendarId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select calendar", "Takvim secin")}</option>
              {workspaceCalendarOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={2000}
              value={periodForm.fiscalYear}
              onChange={(event) =>
                setPeriodForm((prev) => ({ ...prev, fiscalYear: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Fiscal year", "Mali yil")}
            />
            <button
              type="button"
              onClick={() => loadPeriods(periodForm.calendarId, periodForm.fiscalYear)}
              disabled={!canReadFiscalPeriods}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              {l("Reload Periods", "Donemleri Yeniden Yukle")}
            </button>
            <button
              type="submit"
              disabled={saving === "periods" || !canGenerateFiscalPeriods}
              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "periods" ? l("Generating...", "Olusturuluyor...") : l("Generate 12 Periods", "12 Donem Olustur")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Year", "Yil")}</th>
                  <th className="px-3 py-2">{l("Period", "Donem")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Start", "Baslangic")}</th>
                  <th className="px-3 py-2">{l("End", "Bitis")}</th>
                </tr>
              </thead>
              <tbody>
                {(periods || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.fiscal_year}</td>
                    <td className="px-3 py-2">{row.period_no}</td>
                    <td className="px-3 py-2">{row.period_name}</td>
                    <td className="px-3 py-2">{row.start_date}</td>
                    <td className="px-3 py-2">{row.end_date}</td>
                  </tr>
                ))}
                {periods.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      {l("No periods found for selected filters.", "Secilen filtreler icin donem bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {capitalFulfillmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {l(
                    "Record Capital Fulfillment",
                    "Sermaye Karsilamasi Kaydet"
                  )}
                </h3>
                <p className="mt-1 text-sm text-slate-700">
                  {l(
                    "This is a post-setup action. If the bank destination is missing, create it here without leaving the fulfillment flow, then preview and post.",
                    "Bu islem kurulum sonrasi bir aksiyondur. Banka hedefi eksikse karsilama akisindan cikmadan burada olusturun, sonra onizleyip post edin."
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={resetCapitalFulfillmentModal}
                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
              >
                {l("Close", "Kapat")}
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Legal entity", "Legal entity")}
                </span>
                <select
                  value={capitalFulfillmentForm.legalEntityId}
                  onChange={(event) => {
                    const nextLegalEntityId = event.target.value;
                    const nextEligibleShareholders = shareholders.filter(
                      (row) =>
                        Number(row.legal_entity_id) === Number(nextLegalEntityId) &&
                        Boolean(toNumber(row.capital_sub_account_id)) &&
                        Boolean(toNumber(row.commitment_debit_sub_account_id))
                    );
                    updateCapitalFulfillmentForm({
                      legalEntityId: nextLegalEntityId,
                      shareholderId: nextEligibleShareholders[0]?.id
                        ? String(nextEligibleShareholders[0].id)
                        : "",
                      destinationMode: canReadBanks
                        ? "BANK_ACCOUNT"
                        : canReadCashRegisters
                          ? "CASH_REGISTER"
                          : "ASSET_GL",
                      bankAccountId: "",
                      cashRegisterId: "",
                      cashSessionId: "",
                      destinationAccountId: "",
                      operatingUnitId: "",
                    });
                    setCapitalFulfillmentBankError("");
                    setCapitalFulfillmentCashRegistersError("");
                    setCapitalFulfillmentCashSessionsError("");
                  }}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                >
                  <option value="">
                    {l("Select legal entity", "Legal entity secin")}
                  </option>
                  {workspaceLegalEntities.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Shareholder", "Ortak")}
                </span>
                <select
                  value={capitalFulfillmentForm.shareholderId}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({
                      shareholderId: event.target.value,
                      destinationAccountId: "",
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                >
                  <option value="">
                    {l("Select shareholder", "Ortak secin")}
                  </option>
                  {capitalFulfillmentEligibleShareholders.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Contribution date", "Katki tarihi")}
                </span>
                <input
                  type="date"
                  value={capitalFulfillmentForm.contributionDate}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({
                      contributionDate: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Amount", "Tutar")}
                </span>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={capitalFulfillmentForm.amount}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({ amount: event.target.value })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  placeholder={l("Fulfillment amount", "Karsilama tutari")}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Destination mode", "Hedef modu")}
                </span>
                <select
                  value={capitalFulfillmentForm.destinationMode}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({
                      destinationMode: event.target.value,
                      bankAccountId: "",
                      cashRegisterId: "",
                      cashSessionId: "",
                      destinationAccountId: "",
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                >
                  {canReadBanks ? (
                    <option value="BANK_ACCOUNT">
                      {l("Bank account", "Banka hesabi")}
                    </option>
                  ) : null}
                  {canReadCashRegisters ? (
                    <option value="CASH_REGISTER">
                      {l("Cash register", "Kasa")}
                    </option>
                  ) : null}
                  {canReadAccounts ? (
                    <option value="ASSET_GL">
                      {l("Asset GL", "Varlik GL")}
                    </option>
                  ) : null}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Operating unit (optional)", "Operasyon birimi (opsiyonel)")}
                </span>
                <select
                  value={capitalFulfillmentForm.operatingUnitId}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({
                      operatingUnitId: event.target.value,
                      bankAccountId: "",
                      cashRegisterId: "",
                      cashSessionId: "",
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">
                    {l("Central", "Merkez")}
                  </option>
                  {capitalFulfillmentOperatingUnits.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}{" "}
                      {row.capital_self_balancing_ready
                        ? l("(ready)", "(hazir)")
                        : l("(setup missing)", "(kurulum eksik)")}
                    </option>
                  ))}
                </select>
              </label>

              {capitalFulfillmentForm.destinationMode === "BANK_ACCOUNT" ? (
                <div className="block md:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="block text-[11px] font-semibold text-slate-600">
                      {l("Bank account destination", "Banka hesabi hedefi")}
                    </span>
                    {capitalFulfillmentNeedsBankSetup && canWriteBanks ? (
                      <button
                        type="button"
                        onClick={openCapitalFulfillmentCreateBankModal}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        {l("Create bank", "Banka olustur")}
                      </button>
                    ) : null}
                  </div>
                  <select
                    value={capitalFulfillmentForm.bankAccountId}
                    onChange={(event) =>
                      updateCapitalFulfillmentForm({
                        bankAccountId: event.target.value,
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                    disabled={!canReadBanks || capitalFulfillmentBankLoading}
                    required
                  >
                    <option value="">
                      {capitalFulfillmentBankLoading
                        ? l("Loading bank accounts...", "Banka hesaplari yukleniyor...")
                        : l("Select bank account", "Banka hesabi secin")}
                    </option>
                    {capitalFulfillmentBankAccountOptions.map((row) => (
                      <option key={row.id} value={row.id}>
                        {formatBankAccountOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : capitalFulfillmentForm.destinationMode === "CASH_REGISTER" ? (
                <>
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                      {l("Cash register destination", "Kasa hedefi")}
                    </span>
                    <select
                      value={capitalFulfillmentForm.cashRegisterId}
                      onChange={(event) =>
                        updateCapitalFulfillmentForm({
                          cashRegisterId: event.target.value,
                          cashSessionId: "",
                        })
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                      disabled={!canReadCashRegisters || capitalFulfillmentCashRegistersLoading}
                      required
                    >
                      <option value="">
                        {capitalFulfillmentCashRegistersLoading
                          ? l("Loading cash registers...", "Kasalar yukleniyor...")
                          : l("Select cash register", "Kasa secin")}
                      </option>
                      {capitalFulfillmentCashRegisterOptions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {formatCashRegisterOptionLabel(row, l)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {capitalFulfillmentCashSessionRequired ? (
                    <label className="block md:col-span-2">
                      <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                        {l("Open cash session", "Acik kasa oturumu")} *
                      </span>
                      <select
                        value={capitalFulfillmentForm.cashSessionId}
                        onChange={(event) =>
                          updateCapitalFulfillmentForm({
                            cashSessionId: event.target.value,
                          })
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                        disabled={
                          !canReadCashSessions || capitalFulfillmentCashSessionsLoading
                        }
                        required
                      >
                        <option value="">
                          {capitalFulfillmentCashSessionsLoading
                            ? l("Loading open sessions...", "Acik oturumlar yukleniyor...")
                            : l("Select open session", "Acik oturum secin")}
                        </option>
                        {capitalFulfillmentCashSessionOptions.map((row) => (
                          <option key={row.id} value={row.id}>
                            {formatCashSessionOptionLabel(row, l)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                    {l("Asset GL destination", "Varlik GL hedefi")}
                  </span>
                  <select
                    value={capitalFulfillmentForm.destinationAccountId}
                    onChange={(event) =>
                      updateCapitalFulfillmentForm({
                        destinationAccountId: event.target.value,
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                    disabled={!canReadAccounts}
                    required
                  >
                    <option value="">
                      {l("Select asset account", "Varlik hesabi secin")}
                    </option>
                    {capitalFulfillmentAssetAccountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {formatAccountOptionLabel(account)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block md:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Note (optional)", "Not (opsiyonel)")}
                </span>
                <input
                  value={capitalFulfillmentForm.note}
                  onChange={(event) =>
                    updateCapitalFulfillmentForm({ note: event.target.value })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  placeholder={l(
                    "Example: capital fulfillment after bank setup",
                    "Ornek: banka kurulumu sonrasi sermaye karsilamasi"
                  )}
                />
              </label>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <div className="font-semibold text-slate-900">
                  {l("Operational model", "Operasyon modeli")}
                </div>
                <div className="mt-1">{capitalFulfillmentOperationalModelLabel}</div>
                <div className="mt-2 text-slate-600">
                  {capitalFulfillmentForm.destinationMode === "CASH_REGISTER"
                    ? selectedCapitalFulfillmentOperatingUnit
                      ? l(
                        "Selected OU uses a two-layer flow: the branch cash receipt posts in the cash subledger, and a separate central capital journal credits the shareholder commitment account.",
                        "Secilen OU iki katmanli akis kullanir: sube kasa tahsilati kasa alt defterinde post edilir, ortak taahhut hesabini alacaklayan ayri bir merkezi sermaye yevmiyesi olusur."
                      )
                      : l(
                        "Central means central cash-register fulfillment. The posted cash journal itself credits the shareholder commitment account.",
                        "Merkez secimi merkezi kasa uzerinden karsilama yapilacagi anlamina gelir. Post edilen kasa yevmiyesi ortak taahhut hesabini dogrudan alacaklar."
                      )
                    : selectedCapitalFulfillmentOperatingUnit
                      ? l(
                        "Selected OU means direct OU-targeted fulfillment with self-balancing internal current lines.",
                        "Secilen OU, ic cari hesap satirlari ile dogrudan OU hedefli karsilama anlamina gelir."
                      )
                      : l(
                        "Central means central fulfillment first. Later central -> OU allocation can be posted separately.",
                        "Merkez secimi once merkezi karsilama yapilacagi anlamina gelir. Sonra merkez -> OU dagitimi ayri post edilebilir."
                      )}
                </div>
              </div>
              <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <div className="font-semibold">
                  {l("Accounting note", "Muhasebe notu")}
                </div>
                <div className="mt-1">
                  {capitalFulfillmentForm.destinationMode === "CASH_REGISTER"
                    ? selectedCapitalFulfillmentOperatingUnit
                      ? l(
                        "Branch cash mode stores two linked postings: the branch cash transaction for the register movement and a separate central journal for paid-capital recognition.",
                        "Sube kasa modu iki bagli posting saklar: kasa hareketi icin sube kasa islemi ve odenen sermayenin taninmasi icin ayri bir merkezi yevmiye."
                      )
                      : l(
                        "Central cash mode preserves paid capital by crediting the shareholder commitment account inside the posted cash journal.",
                        "Merkezi kasa modu, post edilen kasa yevmiyesinde ortak taahhut hesabini alacaklandirarak odenen sermayeyi korur."
                      )
                    : l(
                      "Paid capital updates because the shareholder commitment debit sub-account is credited in the posted journal.",
                      "Odenen sermaye, post edilen yevmiyede ortak taahhut borc alt hesabina alacak yazildigi icin guncellenir."
                    )}
                </div>
              </div>
            </div>

            {selectedCapitalFulfillmentOperatingUnit && !capitalFulfillmentOuReady ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {l(
                  "Selected operating unit is not capital-self-balancing ready. Configure Central Due From OU and OU Due To Central on that operating unit first.",
                  "Secilen operasyon birimi sermaye icin self-balancing hazir degil. Bu operasyon biriminde once Merkez OU Alacagi ve OU Merkeze Borc alanlarini tanimlayin."
                )}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "BANK_ACCOUNT" &&
              capitalFulfillmentBankError ? (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {capitalFulfillmentBankError}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "CASH_REGISTER" &&
              capitalFulfillmentCashRegistersError ? (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {capitalFulfillmentCashRegistersError}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "CASH_REGISTER" &&
              capitalFulfillmentCashSessionsError ? (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {capitalFulfillmentCashSessionsError}
              </div>
            ) : null}

            {capitalFulfillmentNeedsBankSetup ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {selectedCapitalFulfillmentOperatingUnit
                  ? l(
                    canWriteBanks
                      ? "No active bank account found for the selected legal entity and OU. Use Create bank to define the branch bank here."
                      : "No active bank account found for the selected legal entity and OU. A user with bank account write permission must create the branch bank first.",
                    canWriteBanks
                      ? "Secilen legal entity ve OU icin aktif banka hesabi bulunamadi. Sube bankasini burada tanimlamak icin Banka olustur'u kullanin."
                      : "Secilen legal entity ve OU icin aktif banka hesabi bulunamadi. Sube bankasini once banka hesap yazma yetkisi olan bir kullanici tanimlamalidir."
                  )
                  : l(
                    canWriteBanks
                      ? "No central active bank account found for the selected legal entity. Use Create bank to define the central bank here."
                      : "No central active bank account found for the selected legal entity. A user with bank account write permission must create the central bank first.",
                    canWriteBanks
                      ? "Secilen legal entity icin merkezi aktif banka hesabi bulunamadi. Merkez bankasini burada tanimlamak icin Banka olustur'u kullanin."
                      : "Secilen legal entity icin merkezi aktif banka hesabi bulunamadi. Merkez bankasini once banka hesap yazma yetkisi olan bir kullanici tanimlamalidir."
                  )}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "CASH_REGISTER" &&
              !capitalFulfillmentCashRegistersLoading &&
              capitalFulfillmentLegalEntityId &&
              capitalFulfillmentCashRegisterOptions.length === 0 ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {selectedCapitalFulfillmentOperatingUnit
                  ? l(
                    "No active cash register was found for the selected legal entity and OU. Create the branch cash register first.",
                    "Secilen legal entity ve OU icin aktif kasa bulunamadi. Once sube kasasini olusturun."
                  )
                  : l(
                    "No active central cash register was found for the selected legal entity. Create a central cash register first.",
                    "Secilen legal entity icin aktif merkezi kasa bulunamadi. Once merkez kasasini olusturun."
                  )}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "CASH_REGISTER" &&
              capitalFulfillmentCashSessionMissingOpenSession ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {l(
                  "Selected cash register has session_mode=REQUIRED but no OPEN session exists. Open one from Cash Sessions first.",
                  "Secilen kasada session_mode=REQUIRED ancak OPEN durumunda oturum yok. Once Cash Sessions ekranindan bir oturum acin."
                )}
              </div>
            ) : null}

            {capitalFulfillmentForm.destinationMode === "CASH_REGISTER" &&
              capitalFulfillmentCashSessionValueMissing &&
              !capitalFulfillmentCashSessionMissingOpenSession ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {l(
                  "This cash register requires an OPEN cash session. Select one before preview/post.",
                  "Bu kasa bir OPEN kasa oturumu gerektirir. Onizleme/post oncesi birini secin."
                )}
              </div>
            ) : null}

            {capitalFulfillmentPreview ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {l("Preview", "Onizleme")}
                  </div>
                  <div className="text-xs text-slate-600">
                    {l("Contribution kind", "Katki turu")}:{" "}
                    <span className="font-semibold text-slate-900">
                      {capitalFulfillmentPreview.contribution_kind || "-"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-700 md:grid-cols-3">
                  <div>
                    <span className="font-semibold">
                      {l("Legal entity", "Legal entity")}:
                    </span>{" "}
                    {capitalFulfillmentSelectedLegalEntity
                      ? `${capitalFulfillmentSelectedLegalEntity.code} - ${capitalFulfillmentSelectedLegalEntity.name}`
                      : "-"}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {l("Shareholder", "Ortak")}:
                    </span>{" "}
                    {selectedCapitalFulfillmentShareholder
                      ? `${selectedCapitalFulfillmentShareholder.code} - ${selectedCapitalFulfillmentShareholder.name}`
                      : "-"}
                  </div>
                  <div>
                    <span className="font-semibold">{l("Amount", "Tutar")}:</span>{" "}
                    {formatAmount(capitalFulfillmentPreview.amount_base)}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {l("Destination", "Hedef")}:
                    </span>{" "}
                    {capitalFulfillmentPreview?.destination?.display_name || "-"}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {l("OU", "OU")}:
                    </span>{" "}
                    {capitalFulfillmentPreview?.operating_unit?.code || l("None", "Yok")}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {l("Journal total", "Fis toplami")}:
                    </span>{" "}
                    {formatAmount(
                      capitalFulfillmentPreview?.totals?.total_debit_base || 0
                    )}
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-white text-left text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5">#</th>
                        <th className="px-2 py-1.5">{l("Account", "Hesap")}</th>
                        <th className="px-2 py-1.5">{l("OU", "OU")}</th>
                        <th className="px-2 py-1.5">{l("Debit", "Borc")}</th>
                        <th className="px-2 py-1.5">{l("Credit", "Alacak")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(capitalFulfillmentPreview.lines || []).map((line) => (
                        <tr
                          key={`capital-fulfillment-preview-${line.line_no}`}
                          className="border-t border-slate-200"
                        >
                          <td className="px-2 py-1.5">{line.line_no}</td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-slate-900">
                              {[line.account_code, line.account_name]
                                .filter(Boolean)
                                .join(" - ") || "-"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {line.description || "-"}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {line.operating_unit_code || l("Central", "Merkezi")}
                          </td>
                          <td className="px-2 py-1.5">
                            {line.debit_base
                              ? formatAmount(line.debit_base)
                              : "-"}
                          </td>
                          <td className="px-2 py-1.5">
                            {line.credit_base
                              ? formatAmount(line.credit_base)
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={resetCapitalFulfillmentModal}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="button"
                onClick={handlePreviewCapitalFulfillment}
                disabled={capitalFulfillmentPreviewLoading || capitalFulfillmentSaving}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {capitalFulfillmentPreviewLoading
                  ? l("Previewing...", "Onizleniyor...")
                  : l("Preview fulfillment", "Karsilamayi onizle")}
              </button>
              <button
                type="button"
                onClick={handleCreateCapitalFulfillment}
                disabled={
                  capitalFulfillmentSaving ||
                  capitalFulfillmentPreviewLoading ||
                  !capitalFulfillmentPreview
                }
                className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {capitalFulfillmentSaving
                  ? l("Posting...", "Post ediliyor...")
                  : l("Post fulfillment", "Karsilamayi post et")}
              </button>
            </div>
          </div>
        </div>
      )}

      {capitalFulfillmentCreateBankModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {l("Create bank account", "Banka hesabi olustur")}
                </h3>
                <p className="mt-1 text-sm text-slate-700">
                  {l(
                    "Define the missing bank destination here and stay in the capital fulfillment flow.",
                    "Eksik banka hedefini burada tanimlayin ve sermaye karsilama akisinda kalin."
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCapitalFulfillmentCreateBankModal}
                disabled={capitalFulfillmentCreateBankSaving}
                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Close", "Kapat")}
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <div>
                <span className="font-semibold text-slate-900">
                  {l("Legal entity", "Legal entity")}:
                </span>{" "}
                {capitalFulfillmentSelectedLegalEntity
                  ? `${capitalFulfillmentSelectedLegalEntity.code} - ${capitalFulfillmentSelectedLegalEntity.name}`
                  : "-"}
              </div>
              <div className="mt-1">
                <span className="font-semibold text-slate-900">
                  {l("Ownership context", "Sahiplik baglami")}:
                </span>{" "}
                {selectedCapitalFulfillmentOperatingUnit
                  ? `${selectedCapitalFulfillmentOperatingUnit.code} - ${selectedCapitalFulfillmentOperatingUnit.name}`
                  : l("Central", "Merkez")}
              </div>
            </div>

            {capitalFulfillmentCreateBankError ? (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {capitalFulfillmentCreateBankError}
              </div>
            ) : null}

            <form
              onSubmit={handleCapitalFulfillmentCreateBank}
              className="mt-3 grid gap-3 md:grid-cols-2"
            >
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Code", "Kod")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.code}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      code: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  placeholder="BANK_TRY_MAIN"
                  disabled={capitalFulfillmentCreateBankSaving}
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Currency", "Para birimi")}
                </span>
                <select
                  value={capitalFulfillmentCreateBankForm.currencyCode}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      currencyCode: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={capitalFulfillmentCreateBankSaving}
                  required
                >
                  <option value="">
                    {l("Select currency", "Para birimi secin")}
                  </option>
                  {currencySelectOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block md:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Name", "Ad")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.name}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      name: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  placeholder={l("Main bank account", "Ana banka hesabi")}
                  disabled={capitalFulfillmentCreateBankSaving}
                  required
                />
              </label>

              {selectedBankControlParentReadiness ? (
                <div
                  className={`rounded-md border px-3 py-2 text-[11px] md:col-span-2 ${selectedBankControlParentReadiness.ready
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                >
                  <div className="font-semibold">
                    {l("Bank control-parent readiness", "Banka kontrol-parent hazirligi")}
                  </div>
                  <p className="mt-1">
                    {selectedBankControlParentReadiness.ready
                      ? l(
                        "BANK_CONTROL_PARENT is configured for this legal entity.",
                        "Bu legal entity icin BANK_CONTROL_PARENT yapilandirildi."
                      )
                      : l(
                        "BANK_CONTROL_PARENT setup is incomplete. Configure the bank control parent in GL Setup before relying on automatic child creation.",
                        "BANK_CONTROL_PARENT kurulumu eksik. Otomatik cocuk hesap olusturmaya guvenmeden once GL Setup ekraninda banka kontrol-parent hesabini tanimlayin."
                      )}
                  </p>
                </div>
              ) : null}

              <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 md:col-span-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-cyan-900">
                  <input
                    type="checkbox"
                    checked={Boolean(capitalFulfillmentCreateBankForm.autoProvisionControlParent)}
                    onChange={(event) =>
                      updateCapitalFulfillmentCreateBankForm({
                        autoProvisionControlParent: event.target.checked,
                        glAccountId: event.target.checked
                          ? ""
                          : capitalFulfillmentCreateBankForm.glAccountId,
                      })
                    }
                    disabled={
                      capitalFulfillmentCreateBankSaving || !canReadAccounts
                    }
                  />
                  {l(
                    "Auto-create a control-parent child GL account and link it",
                    "Kontrol-parent altinda GL cocuk hesabi otomatik olustur ve bagla"
                  )}
                </label>
                <p className="mt-1 text-[11px] text-cyan-800">
                  {l(
                    "Recommended when this scope has no bank destination yet. The system provisions a child under the configured bank control parent and links it automatically.",
                    "Bu kapsama ait banka hedefi henuz yoksa onerilir. Sistem yapilandirilmis banka kontrol-parent hesabi altinda bir cocuk hesap olusturur ve otomatik baglar."
                  )}
                </p>
                {!canReadAccounts ? (
                  <p className="mt-2 text-[11px] text-amber-700">
                    {l(
                      "Manual GL selection is unavailable without gl.account.read. Auto-provision remains available.",
                      "gl.account.read olmadan manuel GL secimi kullanilamaz. Otomatik olusturma kullanilmaya devam eder."
                    )}
                  </p>
                ) : null}
                {capitalFulfillmentCreateBankForm.autoProvisionControlParent ? (
                  <label className="mt-3 block">
                    <span className="mb-1 block text-[11px] font-semibold text-cyan-900">
                      {l("Child GL name (optional)", "Cocuk GL adi (opsiyonel)")}
                    </span>
                    <input
                      value={capitalFulfillmentCreateBankForm.glAccountName}
                      onChange={(event) =>
                        updateCapitalFulfillmentCreateBankForm({
                          glAccountName: event.target.value,
                        })
                      }
                      className="w-full rounded border border-cyan-300 bg-white px-2 py-1.5 text-xs"
                      placeholder={l(
                        "If empty, bank account name is used",
                        "Bos ise banka hesap adi kullanilir"
                      )}
                      disabled={capitalFulfillmentCreateBankSaving}
                    />
                  </label>
                ) : null}
              </div>

              {!capitalFulfillmentCreateBankForm.autoProvisionControlParent ? (
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                    {l("GL account", "GL hesap")}
                  </span>
                  <select
                    value={capitalFulfillmentCreateBankForm.glAccountId}
                    onChange={(event) =>
                      updateCapitalFulfillmentCreateBankForm({
                        glAccountId: event.target.value,
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                    disabled={capitalFulfillmentCreateBankSaving || !canReadAccounts}
                    required={!capitalFulfillmentCreateBankForm.autoProvisionControlParent}
                  >
                    <option value="">
                      {capitalFulfillmentBankGlAccountOptions.length > 0
                        ? l("Select GL account", "GL hesap secin")
                        : l("No eligible GL account found", "Uygun GL hesap bulunamadi")}
                    </option>
                    {capitalFulfillmentBankGlAccountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {formatAccountOptionLabel(account)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {l(
                      "Only ACTIVE, postable, leaf ASSET accounts are listed. In strict mode, keep auto-provision on or choose a child account under the configured bank control parent.",
                      "Sadece AKTIF, post edilebilir, yaprak ASSET hesaplar listelenir. Strict modda otomatik olusturmayi acik tutun veya yapilandirilmis banka kontrol-parent hesabi altindan bir cocuk hesap secin."
                    )}
                  </p>
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Bank name", "Banka adi")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.bankName}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      bankName: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={capitalFulfillmentCreateBankSaving}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Branch name", "Sube adi")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.branchName}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      branchName: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={capitalFulfillmentCreateBankSaving}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("IBAN", "IBAN")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.iban}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      iban: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={capitalFulfillmentCreateBankSaving}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Account no", "Hesap no")}
                </span>
                <input
                  value={capitalFulfillmentCreateBankForm.accountNo}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      accountNo: event.target.value,
                    })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  disabled={capitalFulfillmentCreateBankSaving}
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(capitalFulfillmentCreateBankForm.isActive)}
                  onChange={(event) =>
                    updateCapitalFulfillmentCreateBankForm({
                      isActive: event.target.checked,
                    })
                  }
                  disabled={capitalFulfillmentCreateBankSaving}
                />
                {l("Create as active", "Aktif olarak olustur")}
              </label>

              <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={closeCapitalFulfillmentCreateBankModal}
                  disabled={capitalFulfillmentCreateBankSaving}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                >
                  {l("Cancel", "Iptal")}
                </button>
                <button
                  type="submit"
                  disabled={!canWriteBanks || capitalFulfillmentCreateBankSaving}
                  className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {capitalFulfillmentCreateBankSaving
                    ? l("Creating...", "Olusturuluyor...")
                    : capitalFulfillmentCreateBankForm.autoProvisionControlParent
                      ? l(
                        "Create bank (control parent auto)",
                        "Banka olustur (kontrol-parent otomatik)"
                      )
                      : l("Create bank", "Banka olustur")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {commitmentIncreaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {l(
                "Sermaye Taahhut Arttirimi",
                "Sermaye Taahhut Arttirimi"
              )}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {l(
                "Select existing shareholder and enter only increase amount. Accounts are auto-used from shareholder mapping.",
                "Mevcut ortagi secin ve sadece artis tutarini girin. Hesaplar ortak eslesmesinden otomatik kullanilir."
              )}
            </p>

            <form
              onSubmit={handleCommitmentIncreaseSubmit}
              className="mt-3 grid gap-2 md:grid-cols-2"
            >
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Shareholder", "Ortak")}
                </span>
                <select
                  value={commitmentIncreaseForm.shareholderId}
                  onChange={(event) =>
                    setCommitmentIncreaseForm((prev) => ({
                      ...prev,
                      shareholderId: event.target.value,
                    }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                >
                  <option value="">
                    {l("Select shareholder", "Ortak secin")}
                  </option>
                  {eligibleShareholdersForCommitmentIncrease.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Commitment date", "Taahhut tarihi")}
                </span>
                <input
                  type="date"
                  value={commitmentIncreaseForm.commitmentDate}
                  onChange={(event) =>
                    setCommitmentIncreaseForm((prev) => ({
                      ...prev,
                      commitmentDate: event.target.value,
                    }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  {l("Increase amount", "Artis tutari")}
                </span>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={commitmentIncreaseForm.increaseAmount}
                  onChange={(event) =>
                    setCommitmentIncreaseForm((prev) => ({
                      ...prev,
                      increaseAmount: event.target.value,
                    }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                  required
                />
              </label>
              <div className="rounded border border-sky-200 bg-sky-50 px-2 py-2 text-xs text-sky-900">
                {l(
                  `Current committed total: ${formatAmount(
                    commitmentIncreaseCurrentCommittedCapital
                  )}. New projected total: ${formatAmount(
                    commitmentIncreaseProjectedCommittedCapital
                  )}.`,
                  `Mevcut taahhut toplami: ${formatAmount(
                    commitmentIncreaseCurrentCommittedCapital
                  )}. Yeni taahhut toplami: ${formatAmount(
                    commitmentIncreaseProjectedCommittedCapital
                  )}.`
                )}
              </div>
            </form>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>
                {l("Legal Entity", "Istirak / bagli ortak")}:{" "}
                <span className="font-mono">
                  {selectedShareholderLegalEntity
                    ? `${selectedShareholderLegalEntity.code} - ${selectedShareholderLegalEntity.name}`
                    : "-"}
                </span>
              </div>
              <div>
                {l("Capital sub-account", "Sermaye alt hesap")}:{" "}
                <span className="font-mono">
                  {selectedCommitmentIncreaseShareholder?.capital_sub_account_code
                    ? selectedCommitmentIncreaseShareholder.capital_sub_account_name
                      ? `${selectedCommitmentIncreaseShareholder.capital_sub_account_code} - ${selectedCommitmentIncreaseShareholder.capital_sub_account_name}`
                      : selectedCommitmentIncreaseShareholder.capital_sub_account_code
                    : "-"}
                </span>
              </div>
              <div>
                {l("Commitment debit sub-account", "Taahhut borc alt hesap")}:{" "}
                <span className="font-mono">
                  {selectedCommitmentIncreaseShareholder?.commitment_debit_sub_account_code
                    ? selectedCommitmentIncreaseShareholder.commitment_debit_sub_account_name
                      ? `${selectedCommitmentIncreaseShareholder.commitment_debit_sub_account_code} - ${selectedCommitmentIncreaseShareholder.commitment_debit_sub_account_name}`
                      : selectedCommitmentIncreaseShareholder.commitment_debit_sub_account_code
                    : "-"}
                </span>
              </div>
              <div>
                {l("Currency", "Para birimi")}:{" "}
                <span className="font-mono">
                  {selectedCommitmentIncreaseShareholder?.currency_code || "-"}
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCommitmentIncreaseModalOpen(false)}
                disabled={saving === "shareholderIncrease"}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="button"
                onClick={handleCommitmentIncreaseSubmit}
                disabled={
                  saving === "shareholderIncrease" ||
                  !selectedCommitmentIncreaseShareholder
                }
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === "shareholderIncrease"
                  ? l("Saving...", "Kaydediliyor...")
                  : l("Kaydet ve kuyruga ekle", "Kaydet ve kuyruga ekle")}
              </button>
            </div>
          </div>
        </div>
      )}

      {batchCommitmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-5xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {l(
                "Create one batch commitment journal",
                "Tek bir toplu taahhut yevmiyesi olustur"
              )}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {l(
                "All queued shareholders will be posted into one draft journal entry.",
                "Kuyruktaki tum ortaklar tek bir taslak yevmiye fisinde olusturulacak."
              )}
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>
                {l("Legal Entity", "Istirak / bagli ortak")}:{" "}
                <span className="font-mono">
                  {selectedShareholderLegalEntity
                    ? `${selectedShareholderLegalEntity.code} - ${selectedShareholderLegalEntity.name}`
                    : "-"}
                </span>
              </div>
              <div>
                {l("Queued shareholders", "Kuyruktaki ortaklar")}:{" "}
                <span className="font-mono">
                  {pendingBatchCommitmentShareholders.length}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block min-w-55 flex-1">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                    {l("Commitment date", "Taahhut tarihi")}
                  </span>
                  <input
                    type="date"
                    value={batchCommitmentDate}
                    onChange={(event) => setBatchCommitmentDate(event.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                    required
                  />
                </label>
                <button
                  type="button"
                  onClick={handlePreviewBatchCommitmentJournal}
                  disabled={
                    batchPreviewLoading ||
                    batchCommitmentSaving ||
                    shareholderCommitmentModuleNotReady
                  }
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                >
                  {batchPreviewLoading
                    ? l("Loading preview...", "Onizleme yukleniyor...")
                    : l("Refresh preview", "Onizlemeyi yenile")}
                </button>
              </div>
            </div>

            {batchPreviewBlockingErrors.length > 0 ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <div className="font-semibold">
                  {l(
                    "Blocking validation errors",
                    "Engelleyici dogrulama hatalari"
                  )}
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {batchPreviewBlockingErrors.map((errorItem, index) => (
                    <li key={`${errorItem.code || "ERR"}-${index}`}>
                      {errorItem.message || errorItem.code || "-"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {batchPreviewWarnings.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-semibold">{l("Warnings", "Uyarilar")}</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {batchPreviewWarnings.map((warningItem, index) => (
                    <li key={`${warningItem.code || "WARN"}-${index}`}>
                      {warningItem.message || warningItem.code || "-"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
              <div className="mb-2 text-xs font-semibold text-slate-700">
                {l("Preview rows", "Onizleme satirlari")}
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1">{l("Code / Name", "Kod / Ad")}</th>
                      <th className="px-2 py-1">{l("Currency", "Para birimi")}</th>
                      <th className="px-2 py-1">{l("Committed", "Taahhut edilen")}</th>
                      <th className="px-2 py-1">
                        {l("Already journaled", "Daha once fislenen")}
                      </th>
                      <th className="px-2 py-1">{l("Delta", "Bu islem delta")}</th>
                      <th className="px-2 py-1">{l("Debit account", "Borc hesap")}</th>
                      <th className="px-2 py-1">{l("Credit account", "Alacak hesap")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreviewIncludedRows.map((row) => (
                      <tr
                        key={`preview-row-${row.shareholder_id}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-2 py-1">
                          {row.code || "-"} - {row.name || "-"}
                        </td>
                        <td className="px-2 py-1">{row.currency_code || "-"}</td>
                        <td className="px-2 py-1">
                          {Number(row.committed_capital || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-2 py-1">
                          {Number(row.already_journaled_amount || 0).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {Number(row.delta_amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-2 py-1">
                          {row.debit_account_code
                            ? `${row.debit_account_code} - ${row.debit_account_name || ""}`
                            : "-"}
                        </td>
                        <td className="px-2 py-1">
                          {row.credit_account_code
                            ? `${row.credit_account_code} - ${row.credit_account_name || ""}`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                    {batchPreviewIncludedRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-2 py-2 text-center text-slate-500"
                        >
                          {batchPreviewLoading
                            ? l("Loading preview...", "Onizleme yukleniyor...")
                            : l("No includable rows in preview.", "Onizlemede dahil satir yok.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 grid gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 md:grid-cols-3">
                <div>
                  {l("Total debit", "Toplam borc")}:{" "}
                  <span className="font-mono">
                    {Number(batchPreviewData?.totals?.total_debit || 0).toLocaleString(
                      undefined,
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }
                    )}
                  </span>
                </div>
                <div>
                  {l("Total credit", "Toplam alacak")}:{" "}
                  <span className="font-mono">
                    {Number(batchPreviewData?.totals?.total_credit || 0).toLocaleString(
                      undefined,
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }
                    )}
                  </span>
                </div>
                <div>
                  {l("Currency", "Para birimi")}:{" "}
                  <span className="font-mono">
                    {batchPreviewData?.totals?.currency_code || "-"}
                  </span>
                </div>
              </div>
            </div>

            {batchPreviewSkippedRows.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-semibold">{l("Skipped rows", "Atlananlar")}</div>
                <div className="mt-1 max-h-32 space-y-1 overflow-auto">
                  {batchPreviewSkippedRows.map((row) => (
                    <div key={`skipped-${row.shareholder_id}`}>
                      {row.code || row.shareholder_id}: {row.skipped_reason || "-"}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBatchCommitmentModalOpen(false);
                  setBatchPreviewData(null);
                }}
                disabled={batchCommitmentSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="button"
                onClick={handleCreateBatchCommitmentJournal}
                disabled={
                  batchCommitmentSaving ||
                  batchPreviewLoading ||
                  batchPreviewHasBlockingErrors ||
                  batchPreviewIncludedRows.length === 0 ||
                  shareholderCommitmentModuleNotReady
                }
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {batchCommitmentSaving
                  ? l("Creating...", "Olusturuluyor...")
                  : l("Create batch journal", "Toplu fis olustur")}
              </button>
            </div>
          </div>
        </div>
      )}

      {autoSubAccountSetupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {l(
                "Auto setup for missing shareholder sub-accounts",
                "Eksik ortak alt hesaplari icin otomatik kurulum"
              )}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {l(
                "This action will create missing shareholder sub-accounts under mapped parent accounts and pre-fill the shareholder form.",
                "Bu islem eslenmis parent hesaplar altinda eksik ortak alt hesaplarini olusturur ve ortak formunda otomatik secer."
              )}
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>
                {l("Legal Entity", "Istirak / bagli ortak")}:{" "}
                <span className="font-mono">
                  {selectedShareholderLegalEntity
                    ? `${selectedShareholderLegalEntity.code} - ${selectedShareholderLegalEntity.name}`
                    : "-"}
                </span>
              </div>
              <div>
                {l("Shareholder", "Ortak")}:{" "}
                <span className="font-mono">
                  {String(shareholderForm.code || "").trim() || "-"} -{" "}
                  {String(shareholderForm.name || "").trim() || "-"}
                </span>
              </div>
              <div className="mt-1">
                {hasMissingCreditEquitySubAccount ? (
                  <div>
                    {l(
                      `Will create: CREDIT leaf sub-account under ${selectedCapitalCreditParentAccount?.code || "-"}`,
                      `${selectedCapitalCreditParentAccount?.code || "-"} altinda CREDIT leaf alt hesap olusturulacak`
                    )}
                  </div>
                ) : null}
                {hasMissingDebitEquitySubAccount ? (
                  <div>
                    {l(
                      `Will create: DEBIT leaf sub-account under ${selectedCommitmentDebitParentAccount?.code || "-"}`,
                      `${selectedCommitmentDebitParentAccount?.code || "-"} altinda DEBIT leaf alt hesap olusturulacak`
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAutoSubAccountSetupModalOpen(false)}
                disabled={autoSubAccountSetupSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="button"
                onClick={handleAutoCreateMissingShareholderSubAccounts}
                disabled={autoSubAccountSetupSaving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {autoSubAccountSetupSaving
                  ? l("Creating...", "Olusturuluyor...")
                  : l("Confirm and Create", "Onayla ve Olustur")}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareholderJournalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {shareholderJournalModal.title}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {shareholderJournalModal.message}
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>
                {l("Journal No", "Fis No")}:{" "}
                <span className="font-mono">{shareholderJournalModal.journalNo}</span>
              </div>
              <div>
                {l("Journal ID", "Fis ID")}:{" "}
                <span className="font-mono">
                  {shareholderJournalModal.journalEntryId}
                </span>
              </div>
              <div>
                {l("Book", "Defter")}:{" "}
                <span className="font-mono">{shareholderJournalModal.bookCode}</span>
              </div>
              <div>
                {l("Fiscal Period ID", "Mali Donem ID")}:{" "}
                <span className="font-mono">
                  {shareholderJournalModal.fiscalPeriodId}
                </span>
              </div>
            </div>
            {shareholderJournalModal.transitShortcut ? (
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                <div className="font-semibold text-sky-950">
                  {l("Central -> Branch cash transit", "Merkez -> Sube kasa transiti")}
                </div>
                <p className="mt-1">
                  {l(
                    "If this cash was received in the central register first, open the existing cash transit workflow with source register and amount prefilled.",
                    "Nakit once merkez kasasina alindiyse, kaynak kasa ve tutari onceden doldurulmus mevcut kasa transit akisina gecin."
                  )}
                </p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <span className="font-semibold">
                      {l("Source register", "Kaynak kasa")}:
                    </span>{" "}
                    {shareholderJournalModal.transitShortcut.sourceRegisterLabel}
                  </div>
                  <div>
                    <span className="font-semibold">{l("Amount", "Tutar")}:</span>{" "}
                    {formatAmount(shareholderJournalModal.transitShortcut.amountBase || 0)}{" "}
                    {shareholderJournalModal.transitShortcut.currencyCode || ""}
                  </div>
                </div>
                {shareholderJournalModal.transitShortcut.targetRegisterOptions?.length ? (
                  <>
                    <label className="mt-3 block">
                      <span className="mb-1 block font-semibold text-sky-950">
                        {l("Target branch register", "Hedef sube kasasi")}
                      </span>
                      <select
                        value={shareholderJournalModal.transitShortcut.targetRegisterId || ""}
                        onChange={(event) =>
                          setShareholderJournalModal((prev) => {
                            if (!prev?.transitShortcut) {
                              return prev;
                            }
                            const nextTargetRegister =
                              prev.transitShortcut.targetRegisterOptions.find(
                                (row) =>
                                  String(row.id) === String(event.target.value || "")
                              ) || null;
                            return {
                              ...prev,
                              transitShortcut: {
                                ...prev.transitShortcut,
                                targetRegisterId: event.target.value,
                                targetRegisterCode: String(
                                  nextTargetRegister?.code || ""
                                ).trim(),
                              },
                            };
                          })
                        }
                        className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-xs text-slate-800"
                      >
                        <option value="">
                          {l("Select branch register", "Sube kasasi secin")}
                        </option>
                        {shareholderJournalModal.transitShortcut.targetRegisterOptions.map(
                          (row) => (
                            <option key={`capital-fulfillment-transit-${row.id}`} value={row.id}>
                              {row.label}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                    <div className="mt-2 text-sky-950">
                      {l(
                        "This shortcut opens the existing cash transfer form. Review book date/session before creating the transfer.",
                        "Bu kisayol mevcut kasa transfer formunu acar. Transferi olusturmadan once tarih/oturum alanlarini gozden gecirin."
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    {l(
                      "No active branch cash register is available for this legal entity yet. Create one first, then use the existing cash transit workflow.",
                      "Bu legal entity icin henuz aktif sube kasasi yok. Once birini olusturun, sonra mevcut kasa transit akisina gecin."
                    )}
                  </div>
                )}
              </div>
            ) : null}
            <div
              className={`mt-4 flex gap-2 ${shareholderJournalModal.transitShortcut
                ? "justify-between"
                : "justify-end"
                }`}
            >
              {shareholderJournalModal.transitShortcut?.targetRegisterId ? (
                <Link
                  to={buildCapitalFulfillmentTransitShortcutPath(
                    shareholderJournalModal.transitShortcut
                  )}
                  onClick={() => setShareholderJournalModal(null)}
                  className="rounded-lg border border-sky-300 bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  {l("Open cash transit transfer", "Kasa transit transfer ac")}
                </Link>
              ) : shareholderJournalModal.transitShortcut ? (
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400"
                >
                  {l("Open cash transit transfer", "Kasa transit transfer ac")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShareholderJournalModal(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
