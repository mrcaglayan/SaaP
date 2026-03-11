import { useEffect, useMemo, useState } from "react";
import {
  listCashRegisters,
  setCashRegisterStatus,
  upsertCashRegister,
} from "../../api/cashAdmin.js";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import Combobox from "../../components/Combobox.jsx";
import {
  listCountries,
  listCurrencies,
  listLegalEntities,
  listOperatingUnits,
} from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useWorkingContextDefaults } from "../../context/useWorkingContextDefaults.js";
import { useToastMessage } from "../../hooks/useToastMessage.js";
import { useI18n } from "../../i18n/useI18n.js";
import CashControlModeBanner from "./CashControlModeBanner.jsx";

const REGISTER_TYPES = ["VAULT", "DRAWER", "TILL"];
const SESSION_MODES = ["REQUIRED", "OPTIONAL", "NONE"];
const REGISTER_STATUSES = ["ACTIVE", "INACTIVE"];
const OWNERSHIP_SCOPES = ["CENTRAL", "OPERATING_UNIT"];

const EMPTY_FORM = {
  id: "",
  code: "",
  name: "",
  registerType: "DRAWER",
  sessionMode: "",
  legalEntityId: "",
  ownershipScope: "OPERATING_UNIT",
  operatingUnitId: "",
  accountId: "",
  currencyCode: "",
  allowNegative: false,
  varianceGainAccountId: "",
  varianceLossAccountId: "",
  maxTxnAmount: "",
  requiresApprovalOverAmount: "",
  status: "ACTIVE",
};

// Ownership scope should remain an explicit operator decision on this page.
const CASH_REGISTER_CONTEXT_MAPPINGS = [{ stateKey: "legalEntityId" }];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeOwnershipScope(value, fallbackOperatingUnitId = null) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "CENTRAL" || normalized === "OPERATING_UNIT") {
    return normalized;
  }
  return toPositiveInt(fallbackOperatingUnitId) ? "OPERATING_UNIT" : "CENTRAL";
}

function resolveOwnershipMeta(row, t) {
  const scope = normalizeOwnershipScope(
    row?.ownership_scope ?? row?.ownershipScope,
    row?.operating_unit_id ?? row?.operatingUnitId
  );
  const isCentral = scope === "CENTRAL";
  const contextLabel = isCentral
    ? t("cashRegisters.values.centralHq")
    : String(
        row?.ownership_context_label ||
          row?.ownershipContextLabel ||
          [
            row?.operating_unit_code || row?.operatingUnitCode || row?.operating_unit_id,
            row?.operating_unit_name || row?.operatingUnitName,
          ]
            .filter(Boolean)
            .join(" - ") ||
          "-"
      );
  return {
    scope,
    label: isCentral
      ? t("cashRegisters.values.ownershipCentral")
      : t("cashRegisters.values.ownershipOperatingUnit"),
    contextLabel,
    badgeClass: isCentral
      ? "bg-slate-900 text-white"
      : "bg-cyan-100 text-cyan-800",
  };
}

function parseBreadcrumbCodes(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function formatAccountOptionLabel(account) {
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  const breadcrumbCodes = parseBreadcrumbCodes(account?.account_breadcrumb_codes);
  const parentPath = breadcrumbCodes.slice(0, -1).join(" > ");
  const baseLabel = [code, name].filter(Boolean).join(" - ");
  return parentPath ? `${parentPath} > ${baseLabel}` : baseLabel;
}

function normalizeAccountCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseChildCodeSequence(code, parentCode) {
  const normalizedCode = normalizeAccountCode(code);
  const normalizedParentCode = normalizeAccountCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }

  let suffix = "";
  if (normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(`${normalizedParentCode}-`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(normalizedParentCode)) {
    suffix = normalizedCode.slice(normalizedParentCode.length);
  } else {
    return null;
  }

  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const value = Number(suffix);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return {
    value,
    width: suffix.length,
  };
}

function buildNextChildAccountCode(rows, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentAccountId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentAccountId) {
    return "";
  }

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const existingCodes = new Set(
    normalizedRows
      .map((row) => normalizeAccountCode(row?.code))
      .filter(Boolean)
  );
  const parsedChildren = normalizedRows
    .filter(
      (row) =>
        toPositiveInt(row?.parent_account_id ?? row?.parentAccountId) ===
        parentAccountId
    )
    .map((row) => parseChildCodeSequence(row?.code, parentCode))
    .filter(Boolean);

  const maxSequence = parsedChildren.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.value || 0)),
    0
  );
  const width = Math.max(
    2,
    parsedChildren.reduce(
      (maxWidth, row) => Math.max(maxWidth, Number(row?.width || 0)),
      0
    )
  );

  let next = Math.max(1, maxSequence + 1);
  while (next <= 999999) {
    const candidate = `${parentCode}.${String(next).padStart(width, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    next += 1;
  }
  return "";
}

function resolveSelectedAccountOption(accountOptions, allAccounts, selectedAccountId) {
  if (!selectedAccountId) {
    return null;
  }
  return (
    accountOptions.find((row) => toPositiveInt(row?.id) === selectedAccountId) ||
    allAccounts.find((row) => toPositiveInt(row?.id) === selectedAccountId) ||
    null
  );
}

function buildAccountPickerRows(accountOptions, selectedAccountOption) {
  if (!selectedAccountOption) {
    return accountOptions;
  }
  const selectedId = toPositiveInt(selectedAccountOption?.id);
  if (!selectedId) {
    return accountOptions;
  }
  const alreadyPresent = accountOptions.some(
    (row) => toPositiveInt(row?.id) === selectedId
  );
  return alreadyPresent ? accountOptions : [selectedAccountOption, ...accountOptions];
}

function buildAccountLookupOptions(rows) {
  return rows.map((row) => ({
    value: String(row?.id || ""),
    label: formatAccountOptionLabel(row),
    description: [normalizeAccountCode(row?.account_type), normalizeAccountCode(row?.normal_side)]
      .filter(Boolean)
      .join(" | "),
  }));
}

function deriveSearchCodeCandidate(value) {
  const normalized = normalizeAccountCode(value);
  if (!normalized || /\s/.test(normalized)) {
    return "";
  }
  return normalized;
}

function findBestParentAccount(candidateCode, parentAccountOptions) {
  if (!candidateCode) {
    return null;
  }
  let bestParent = null;
  for (const row of parentAccountOptions) {
    const parentCode = normalizeAccountCode(row?.code);
    if (!parentCode || candidateCode === parentCode) {
      continue;
    }
    const matchesPrefix =
      candidateCode.startsWith(`${parentCode}.`) ||
      candidateCode.startsWith(`${parentCode}-`) ||
      candidateCode.startsWith(parentCode);
    if (!matchesPrefix) {
      continue;
    }
    if (
      !bestParent ||
      parentCode.length > normalizeAccountCode(bestParent?.code).length
    ) {
      bestParent = row;
    }
  }
  return bestParent;
}

function mapRowToForm(row) {
  return {
    id: String(row?.id || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    registerType: String(row?.register_type || "DRAWER").toUpperCase(),
    sessionMode: String(row?.session_mode || "REQUIRED").toUpperCase(),
    legalEntityId: String(row?.legal_entity_id || ""),
    ownershipScope: normalizeOwnershipScope(
      row?.ownership_scope ?? row?.ownershipScope,
      row?.operating_unit_id ?? row?.operatingUnitId
    ),
    operatingUnitId: String(row?.operating_unit_id || ""),
    accountId: String(row?.account_id || ""),
    currencyCode: String(row?.currency_code || "").toUpperCase(),
    allowNegative: parseDbBoolean(row?.allow_negative),
    varianceGainAccountId: String(row?.variance_gain_account_id || ""),
    varianceLossAccountId: String(row?.variance_loss_account_id || ""),
    maxTxnAmount:
      row?.max_txn_amount === null || row?.max_txn_amount === undefined
        ? ""
        : String(row.max_txn_amount),
    requiresApprovalOverAmount:
      row?.requires_approval_over_amount === null ||
      row?.requires_approval_over_amount === undefined
        ? ""
        : String(row.requires_approval_over_amount),
    status: String(row?.status || "ACTIVE").toUpperCase(),
  };
}

export default function CashRegistersPage() {
  const { hasPermission } = useAuth();
  const { t } = useI18n();
  const canReadRegisters = hasPermission("cash.register.read");
  const canUpsertRegisters = hasPermission("cash.register.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertAccounts = hasPermission("gl.account.upsert");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useToastMessage("", { toastType: "success" });
  const [lookupWarning, setLookupWarning] = useState("");

  const [rows, setRows] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [countries, setCountries] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [currencySeedEntityId, setCurrencySeedEntityId] = useState("");
  const [accountLookupQuery, setAccountLookupQuery] = useState("");
  const [inlineChildParentAccountId, setInlineChildParentAccountId] = useState("");
  const [inlineChildCode, setInlineChildCode] = useState("");
  const [inlineChildName, setInlineChildName] = useState("");
  const [inlineChildSaving, setInlineChildSaving] = useState(false);
  const [varianceGainLookupQuery, setVarianceGainLookupQuery] = useState("");
  const [varianceGainInlineChildParentAccountId, setVarianceGainInlineChildParentAccountId] =
    useState("");
  const [varianceGainInlineChildCode, setVarianceGainInlineChildCode] = useState("");
  const [varianceGainInlineChildName, setVarianceGainInlineChildName] = useState("");
  const [varianceGainInlineChildSaving, setVarianceGainInlineChildSaving] = useState(false);
  const [varianceLossLookupQuery, setVarianceLossLookupQuery] = useState("");
  const [varianceLossInlineChildParentAccountId, setVarianceLossInlineChildParentAccountId] =
    useState("");
  const [varianceLossInlineChildCode, setVarianceLossInlineChildCode] = useState("");
  const [varianceLossInlineChildName, setVarianceLossInlineChildName] = useState("");
  const [varianceLossInlineChildSaving, setVarianceLossInlineChildSaving] = useState(false);

  useWorkingContextDefaults(setForm, CASH_REGISTER_CONTEXT_MAPPINGS, [
    form.legalEntityId,
  ]);

  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const normalizedOwnershipScope = normalizeOwnershipScope(
    form.ownershipScope,
    form.operatingUnitId
  );
  const isOperatingUnitOwned = normalizedOwnershipScope === "OPERATING_UNIT";

  const legalEntityOptions = useMemo(
    () =>
      [...legalEntities].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [legalEntities]
  );
  const selectedLegalEntity = useMemo(
    () =>
      legalEntities.find(
        (row) => toPositiveInt(row?.id) === selectedLegalEntityId
      ) || null,
    [legalEntities, selectedLegalEntityId]
  );
  const countryDefaultCurrencyCodeById = useMemo(() => {
    const byId = new Map();
    for (const row of countries) {
      const countryId = toPositiveInt(row?.id);
      const defaultCurrencyCode = String(row?.default_currency_code || "")
        .trim()
        .toUpperCase();
      if (!countryId || !defaultCurrencyCode || byId.has(countryId)) {
        continue;
      }
      byId.set(countryId, defaultCurrencyCode);
    }
    return byId;
  }, [countries]);
  const selectedLegalEntityCountryDefaultCurrencyCode = useMemo(() => {
    const countryId = toPositiveInt(selectedLegalEntity?.country_id);
    if (!countryId) {
      return "";
    }
    return String(countryDefaultCurrencyCodeById.get(countryId) || "");
  }, [selectedLegalEntity, countryDefaultCurrencyCodeById]);
  const selectedLegalEntityFunctionalCurrencyCode = String(
    selectedLegalEntity?.functional_currency_code || ""
  )
    .trim()
    .toUpperCase();

  const operatingUnitOptions = useMemo(() => {
    const filtered = operatingUnits.filter((row) => {
      if (!selectedLegalEntityId) {
        return true;
      }
      return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
    });
    return [...filtered].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [operatingUnits, selectedLegalEntityId]);

  const accountOptions = useMemo(() => {
    const filtered = accounts.filter((row) => {
      if (!parseDbBoolean(row?.is_active) || !parseDbBoolean(row?.allow_posting)) {
        return false;
      }
      if (!selectedLegalEntityId) {
        return true;
      }
      return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
    });
    return [...filtered].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [accounts, selectedLegalEntityId]);
  const selectedAccountId = toPositiveInt(form.accountId);
  const selectedAccountOption = useMemo(() => {
    return resolveSelectedAccountOption(accountOptions, accounts, selectedAccountId);
  }, [accountOptions, accounts, selectedAccountId]);
  const accountPickerRows = useMemo(() => {
    return buildAccountPickerRows(accountOptions, selectedAccountOption);
  }, [accountOptions, selectedAccountOption]);
  const accountLookupOptions = useMemo(
    () => buildAccountLookupOptions(accountPickerRows),
    [accountPickerRows]
  );
  const selectedVarianceGainAccountId = toPositiveInt(form.varianceGainAccountId);
  const selectedVarianceGainAccountOption = useMemo(
    () =>
      resolveSelectedAccountOption(
        accountOptions,
        accounts,
        selectedVarianceGainAccountId
      ),
    [accountOptions, accounts, selectedVarianceGainAccountId]
  );
  const varianceGainAccountPickerRows = useMemo(
    () => buildAccountPickerRows(accountOptions, selectedVarianceGainAccountOption),
    [accountOptions, selectedVarianceGainAccountOption]
  );
  const varianceGainAccountLookupOptions = useMemo(
    () => buildAccountLookupOptions(varianceGainAccountPickerRows),
    [varianceGainAccountPickerRows]
  );
  const selectedVarianceLossAccountId = toPositiveInt(form.varianceLossAccountId);
  const selectedVarianceLossAccountOption = useMemo(
    () =>
      resolveSelectedAccountOption(
        accountOptions,
        accounts,
        selectedVarianceLossAccountId
      ),
    [accountOptions, accounts, selectedVarianceLossAccountId]
  );
  const varianceLossAccountPickerRows = useMemo(
    () => buildAccountPickerRows(accountOptions, selectedVarianceLossAccountOption),
    [accountOptions, selectedVarianceLossAccountOption]
  );
  const varianceLossAccountLookupOptions = useMemo(
    () => buildAccountLookupOptions(varianceLossAccountPickerRows),
    [varianceLossAccountPickerRows]
  );
  const parentAccountOptions = useMemo(() => {
    const filtered = accounts.filter((row) => {
      if (!parseDbBoolean(row?.is_active)) {
        return false;
      }
      if (!selectedLegalEntityId) {
        return true;
      }
      return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
    });
    return [...filtered].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [accounts, selectedLegalEntityId]);
  const parentAccountLookupOptions = useMemo(
    () =>
      parentAccountOptions.map((row) => ({
        value: String(row?.id || ""),
        label: formatAccountOptionLabel(row),
      })),
    [parentAccountOptions]
  );
  const selectedEntityAccountByCode = useMemo(() => {
    const byCode = new Map();
    for (const row of accounts) {
      if (
        selectedLegalEntityId &&
        toPositiveInt(row?.legal_entity_id) !== selectedLegalEntityId
      ) {
        continue;
      }
      const code = normalizeAccountCode(row?.code);
      if (!code || byCode.has(code)) {
        continue;
      }
      byCode.set(code, row);
    }
    return byCode;
  }, [accounts, selectedLegalEntityId]);
  const accountSearchCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(accountLookupQuery),
    [accountLookupQuery]
  );
  const exactCodeMatchAccount = useMemo(
    () =>
      accountSearchCodeCandidate
        ? selectedEntityAccountByCode.get(accountSearchCodeCandidate) || null
        : null,
    [accountSearchCodeCandidate, selectedEntityAccountByCode]
  );
  const hasAccountLookupQueryText = Boolean(String(accountLookupQuery || "").trim());
  const showInlineChildCreate =
    hasAccountLookupQueryText && !exactCodeMatchAccount;
  const varianceGainSearchCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(varianceGainLookupQuery),
    [varianceGainLookupQuery]
  );
  const exactVarianceGainCodeMatchAccount = useMemo(
    () =>
      varianceGainSearchCodeCandidate
        ? selectedEntityAccountByCode.get(varianceGainSearchCodeCandidate) || null
        : null,
    [varianceGainSearchCodeCandidate, selectedEntityAccountByCode]
  );
  const hasVarianceGainLookupQueryText = Boolean(String(varianceGainLookupQuery || "").trim());
  const showVarianceGainInlineChildCreate =
    hasVarianceGainLookupQueryText && !exactVarianceGainCodeMatchAccount;
  const varianceLossSearchCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(varianceLossLookupQuery),
    [varianceLossLookupQuery]
  );
  const exactVarianceLossCodeMatchAccount = useMemo(
    () =>
      varianceLossSearchCodeCandidate
        ? selectedEntityAccountByCode.get(varianceLossSearchCodeCandidate) || null
        : null,
    [varianceLossSearchCodeCandidate, selectedEntityAccountByCode]
  );
  const hasVarianceLossLookupQueryText = Boolean(String(varianceLossLookupQuery || "").trim());
  const showVarianceLossInlineChildCreate =
    hasVarianceLossLookupQueryText && !exactVarianceLossCodeMatchAccount;
  const selectedInlineParentAccount = useMemo(() => {
    const selectedParentId = toPositiveInt(inlineChildParentAccountId);
    if (!selectedParentId) {
      return null;
    }
    return (
      parentAccountOptions.find((row) => toPositiveInt(row?.id) === selectedParentId) ||
      null
    );
  }, [inlineChildParentAccountId, parentAccountOptions]);
  const suggestedNextChildCode = useMemo(
    () => buildNextChildAccountCode(accounts, selectedInlineParentAccount),
    [accounts, selectedInlineParentAccount]
  );
  const selectedVarianceGainInlineParentAccount = useMemo(() => {
    const selectedParentId = toPositiveInt(varianceGainInlineChildParentAccountId);
    if (!selectedParentId) {
      return null;
    }
    return (
      parentAccountOptions.find((row) => toPositiveInt(row?.id) === selectedParentId) ||
      null
    );
  }, [varianceGainInlineChildParentAccountId, parentAccountOptions]);
  const suggestedVarianceGainNextChildCode = useMemo(
    () => buildNextChildAccountCode(accounts, selectedVarianceGainInlineParentAccount),
    [accounts, selectedVarianceGainInlineParentAccount]
  );
  const selectedVarianceLossInlineParentAccount = useMemo(() => {
    const selectedParentId = toPositiveInt(varianceLossInlineChildParentAccountId);
    if (!selectedParentId) {
      return null;
    }
    return (
      parentAccountOptions.find((row) => toPositiveInt(row?.id) === selectedParentId) ||
      null
    );
  }, [varianceLossInlineChildParentAccountId, parentAccountOptions]);
  const suggestedVarianceLossNextChildCode = useMemo(
    () => buildNextChildAccountCode(accounts, selectedVarianceLossInlineParentAccount),
    [accounts, selectedVarianceLossInlineParentAccount]
  );

  const currencyOptions = useMemo(
    () =>
      [...currencies].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [currencies]
  );

  useEffect(() => {
    if (form.id) {
      return;
    }
    if (!form.legalEntityId && legalEntityOptions.length > 0) {
      setForm((prev) => ({
        ...prev,
        legalEntityId: String(legalEntityOptions[0].id || ""),
      }));
    }
  }, [form.id, form.legalEntityId, legalEntityOptions]);

  useEffect(() => {
    if (form.id) {
      return;
    }
    const selectedEntityKey = String(selectedLegalEntityId || "");
    if (!selectedEntityKey) {
      if (!form.currencyCode && currencyOptions.length > 0) {
        setForm((prev) => ({
          ...prev,
          currencyCode: String(currencyOptions[0].code || "").toUpperCase(),
        }));
      }
      return;
    }

    const preferredCurrencyCode =
      selectedLegalEntityCountryDefaultCurrencyCode ||
      selectedLegalEntityFunctionalCurrencyCode ||
      String(currencyOptions[0]?.code || "").toUpperCase();
    if (!preferredCurrencyCode) {
      return;
    }
    if (
      currencySeedEntityId === selectedEntityKey &&
      String(form.currencyCode || "").trim().toUpperCase()
    ) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      currencyCode: preferredCurrencyCode,
    }));
    setCurrencySeedEntityId(selectedEntityKey);
  }, [
    currencyOptions,
    form.currencyCode,
    form.id,
    selectedLegalEntityId,
    selectedLegalEntityCountryDefaultCurrencyCode,
    selectedLegalEntityFunctionalCurrencyCode,
    currencySeedEntityId,
  ]);

  useEffect(() => {
    if (!isOperatingUnitOwned && String(form.operatingUnitId || "").trim()) {
      setForm((prev) => ({ ...prev, operatingUnitId: "" }));
    }
  }, [form.operatingUnitId, isOperatingUnitOwned]);

  useEffect(() => {
    if (!isOperatingUnitOwned) {
      return;
    }
    const currentOperatingUnitId = toPositiveInt(form.operatingUnitId);
    if (!currentOperatingUnitId) {
      return;
    }
    const existsInScope = operatingUnitOptions.some(
      (row) => toPositiveInt(row?.id) === currentOperatingUnitId
    );
    if (!existsInScope) {
      setForm((prev) => ({ ...prev, operatingUnitId: "" }));
    }
  }, [form.operatingUnitId, isOperatingUnitOwned, operatingUnitOptions]);

  useEffect(() => {
    setAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setVarianceGainLookupQuery("");
    setVarianceGainInlineChildParentAccountId("");
    setVarianceGainInlineChildCode("");
    setVarianceGainInlineChildName("");
    setVarianceLossLookupQuery("");
    setVarianceLossInlineChildParentAccountId("");
    setVarianceLossInlineChildCode("");
    setVarianceLossInlineChildName("");
  }, [form.legalEntityId]);

  useEffect(() => {
    if (!showInlineChildCreate) {
      return;
    }
    setInlineChildCode((prev) => prev || accountSearchCodeCandidate);
    setInlineChildName(
      (prev) =>
        prev || String(accountLookupQuery || "").trim() || String(form.name || "").trim()
    );
  }, [showInlineChildCreate, accountSearchCodeCandidate, accountLookupQuery, form.name]);
  useEffect(() => {
    if (!showInlineChildCreate || !suggestedNextChildCode) {
      return;
    }
    setInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(accountSearchCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedNextChildCode;
      }
      return prev;
    });
  }, [showInlineChildCreate, suggestedNextChildCode, accountSearchCodeCandidate]);

  useEffect(() => {
    if (!showInlineChildCreate || toPositiveInt(inlineChildParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(
      inlineChildCode || accountSearchCodeCandidate
    );
    if (!candidateCode) {
      return;
    }
    let bestParent = null;
    for (const row of parentAccountOptions) {
      const parentCode = normalizeAccountCode(row?.code);
      if (!parentCode || candidateCode === parentCode) {
        continue;
      }
      const matchesPrefix =
        candidateCode.startsWith(`${parentCode}.`) ||
        candidateCode.startsWith(`${parentCode}-`) ||
        candidateCode.startsWith(parentCode);
      if (!matchesPrefix) {
        continue;
      }
      if (
        !bestParent ||
        parentCode.length > normalizeAccountCode(bestParent?.code).length
      ) {
        bestParent = row;
      }
    }
    if (toPositiveInt(bestParent?.id)) {
      setInlineChildParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineChildCreate,
    inlineChildParentAccountId,
    inlineChildCode,
    accountSearchCodeCandidate,
    parentAccountOptions,
  ]);
  useEffect(() => {
    if (!showVarianceGainInlineChildCreate) {
      return;
    }
    setVarianceGainInlineChildCode((prev) => prev || varianceGainSearchCodeCandidate);
    setVarianceGainInlineChildName(
      (prev) =>
        prev ||
        String(varianceGainLookupQuery || "").trim() ||
        String(form.name || "").trim()
    );
  }, [
    showVarianceGainInlineChildCreate,
    varianceGainSearchCodeCandidate,
    varianceGainLookupQuery,
    form.name,
  ]);
  useEffect(() => {
    if (!showVarianceGainInlineChildCreate || !suggestedVarianceGainNextChildCode) {
      return;
    }
    setVarianceGainInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(varianceGainSearchCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedVarianceGainNextChildCode;
      }
      return prev;
    });
  }, [
    showVarianceGainInlineChildCreate,
    suggestedVarianceGainNextChildCode,
    varianceGainSearchCodeCandidate,
  ]);

  useEffect(() => {
    if (
      !showVarianceGainInlineChildCreate ||
      toPositiveInt(varianceGainInlineChildParentAccountId)
    ) {
      return;
    }
    const candidateCode = normalizeAccountCode(
      varianceGainInlineChildCode || varianceGainSearchCodeCandidate
    );
    if (!candidateCode) {
      return;
    }
    const bestParent = findBestParentAccount(candidateCode, parentAccountOptions);
    if (toPositiveInt(bestParent?.id)) {
      setVarianceGainInlineChildParentAccountId(String(bestParent.id));
    }
  }, [
    showVarianceGainInlineChildCreate,
    varianceGainInlineChildParentAccountId,
    varianceGainInlineChildCode,
    varianceGainSearchCodeCandidate,
    parentAccountOptions,
  ]);

  useEffect(() => {
    if (!showVarianceLossInlineChildCreate) {
      return;
    }
    setVarianceLossInlineChildCode((prev) => prev || varianceLossSearchCodeCandidate);
    setVarianceLossInlineChildName(
      (prev) =>
        prev ||
        String(varianceLossLookupQuery || "").trim() ||
        String(form.name || "").trim()
    );
  }, [
    showVarianceLossInlineChildCreate,
    varianceLossSearchCodeCandidate,
    varianceLossLookupQuery,
    form.name,
  ]);
  useEffect(() => {
    if (!showVarianceLossInlineChildCreate || !suggestedVarianceLossNextChildCode) {
      return;
    }
    setVarianceLossInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(varianceLossSearchCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedVarianceLossNextChildCode;
      }
      return prev;
    });
  }, [
    showVarianceLossInlineChildCreate,
    suggestedVarianceLossNextChildCode,
    varianceLossSearchCodeCandidate,
  ]);

  useEffect(() => {
    if (
      !showVarianceLossInlineChildCreate ||
      toPositiveInt(varianceLossInlineChildParentAccountId)
    ) {
      return;
    }
    const candidateCode = normalizeAccountCode(
      varianceLossInlineChildCode || varianceLossSearchCodeCandidate
    );
    if (!candidateCode) {
      return;
    }
    const bestParent = findBestParentAccount(candidateCode, parentAccountOptions);
    if (toPositiveInt(bestParent?.id)) {
      setVarianceLossInlineChildParentAccountId(String(bestParent.id));
    }
  }, [
    showVarianceLossInlineChildCreate,
    varianceLossInlineChildParentAccountId,
    varianceLossInlineChildCode,
    varianceLossSearchCodeCandidate,
    parentAccountOptions,
  ]);

  async function loadRegisters() {
    if (!canReadRegisters) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await listCashRegisters({ limit: 200, offset: 0 });
      setRows(response?.rows || []);
    } catch (err) {
      setError(
        err?.response?.data?.message || t("cashRegisters.errors.loadRegisters")
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadLookups() {
    if (!canUpsertRegisters) {
      setLegalEntities([]);
      setCountries([]);
      setOperatingUnits([]);
      setAccounts([]);
      setCurrencies([]);
      setLookupWarning("");
      return;
    }

    const warnings = [];

    if (canReadOrgTree) {
      try {
        const [legalEntityRes, countryRes, operatingUnitRes, currencyRes] =
          await Promise.all([
          listLegalEntities(),
          listCountries(),
          listOperatingUnits(),
          listCurrencies(),
        ]);
        setLegalEntities(legalEntityRes?.rows || []);
        setCountries(countryRes?.rows || []);
        setOperatingUnits(operatingUnitRes?.rows || []);
        setCurrencies(currencyRes?.rows || []);
      } catch (err) {
        setLegalEntities([]);
        setCountries([]);
        setOperatingUnits([]);
        setCurrencies([]);
        warnings.push(err?.response?.data?.message || t("cashRegisters.errors.loadOrgLookups"));
      }
    } else {
      warnings.push(t("cashRegisters.errors.missingOrgLookupPermission"));
      setLegalEntities([]);
      setCountries([]);
      setOperatingUnits([]);
      setCurrencies([]);
    }

    if (canReadAccounts) {
      try {
        const accountRes = await listAccounts({
          includeInactive: true,
          legalEntityId: selectedLegalEntityId || undefined,
          limit: 1000,
        });
        setAccounts(accountRes?.rows || []);
      } catch (err) {
        setAccounts([]);
        warnings.push(
          err?.response?.data?.message || t("cashRegisters.errors.loadAccountLookups")
        );
      }
    } else {
      warnings.push(t("cashRegisters.errors.missingAccountLookupPermission"));
      setAccounts([]);
    }

    setLookupWarning(warnings.join(" "));
  }

  useEffect(() => {
    loadRegisters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadRegisters]);

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUpsertRegisters, canReadOrgTree, canReadAccounts, selectedLegalEntityId]);

  function resetForm() {
    setForm((prev) => ({
      ...EMPTY_FORM,
      legalEntityId: prev.id
        ? String(legalEntityOptions[0]?.id || "")
        : prev.legalEntityId || String(legalEntityOptions[0]?.id || ""),
      currencyCode: "",
    }));
    setCurrencySeedEntityId("");
    setAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setVarianceGainLookupQuery("");
    setVarianceGainInlineChildParentAccountId("");
    setVarianceGainInlineChildCode("");
    setVarianceGainInlineChildName("");
    setVarianceLossLookupQuery("");
    setVarianceLossInlineChildParentAccountId("");
    setVarianceLossInlineChildCode("");
    setVarianceLossInlineChildName("");
  }

  function handleEdit(row) {
    setForm(mapRowToForm(row));
    setCurrencySeedEntityId(String(row?.legal_entity_id || ""));
    setAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setVarianceGainLookupQuery("");
    setVarianceGainInlineChildParentAccountId("");
    setVarianceGainInlineChildCode("");
    setVarianceGainInlineChildName("");
    setVarianceLossLookupQuery("");
    setVarianceLossInlineChildParentAccountId("");
    setVarianceLossInlineChildCode("");
    setVarianceLossInlineChildName("");
    setError("");
    setMessage("");
  }

  async function createChildAccountForField({
    targetField,
    parentAccountIdValue,
    inlineCodeValue,
    fallbackSearchCode,
    inlineNameValue,
    setPickerSaving,
    clearPickerInputs,
  }) {
    if (!canUpsertAccounts) {
      setError(t("cashRegisters.errors.missingAccountUpsertPermission"));
      return;
    }

    const legalEntityId = selectedLegalEntityId;
    if (!legalEntityId) {
      setError(t("cashRegisters.errors.requiredEntityAccount"));
      return;
    }

    const parentAccountId = toPositiveInt(parentAccountIdValue);
    const parentAccount =
      parentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === parentAccountId
      ) || null;
    if (!parentAccountId || !parentAccount) {
      setError(t("cashRegisters.errors.parentAccountRequired"));
      return;
    }

    const childCode = normalizeAccountCode(inlineCodeValue || fallbackSearchCode);
    const childName = String(inlineNameValue || "").trim();
    if (!childCode) {
      setError(t("cashRegisters.errors.childAccountCodeRequired"));
      return;
    }
    if (!childName) {
      setError(t("cashRegisters.errors.childAccountNameRequired"));
      return;
    }

    const parentCode = normalizeAccountCode(parentAccount?.code);
    if (parentCode && childCode === parentCode) {
      setError(t("cashRegisters.errors.childAccountCodeParentConflict"));
      return;
    }

    const existingAccount = selectedEntityAccountByCode.get(childCode) || null;
    const existingAccountId = toPositiveInt(existingAccount?.id);
    if (existingAccountId) {
      setForm((prev) => ({ ...prev, [targetField]: String(existingAccountId) }));
      setError("");
      setMessage(
        t("cashRegisters.messages.accountExistsSelected", {
          code: childCode,
        })
      );
      return;
    }

    const coaId = toPositiveInt(parentAccount?.coa_id ?? parentAccount?.coaId);
    if (!coaId) {
      setError(t("cashRegisters.errors.childAccountParentCoaMissing"));
      return;
    }
    const accountType =
      normalizeAccountCode(
        parentAccount?.account_type ?? parentAccount?.accountType
      ) || "ASSET";
    const normalSide =
      normalizeAccountCode(parentAccount?.normal_side ?? parentAccount?.normalSide) ||
      "DEBIT";

    setPickerSaving(true);
    setError("");
    setMessage("");
    try {
      const upsertResponse = await upsertAccount({
        coaId,
        code: childCode,
        name: childName,
        accountType,
        normalSide,
        allowPosting: true,
        parentAccountId,
      });
      const responseId = toPositiveInt(upsertResponse?.id ?? upsertResponse?.row?.id);

      const refreshResponse = await listAccounts({
        includeInactive: true,
        legalEntityId: legalEntityId || undefined,
        limit: 1000,
      });
      const refreshedRows = refreshResponse?.rows || [];
      setAccounts(refreshedRows);

      const resolvedRow =
        refreshedRows.find((row) => normalizeAccountCode(row?.code) === childCode) ||
        null;
      const resolvedId = responseId || toPositiveInt(resolvedRow?.id);
      if (resolvedId) {
        setForm((prev) => ({ ...prev, [targetField]: String(resolvedId) }));
      }

      clearPickerInputs();
      setMessage(
        t("cashRegisters.messages.childAccountCreatedAndSelected", {
          code: childCode,
          parentCode: parentCode || "-",
        })
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("cashRegisters.errors.createChildAccount")
      );
    } finally {
      setPickerSaving(false);
    }
  }

  async function handleCreateChildAccountFromPicker() {
    await createChildAccountForField({
      targetField: "accountId",
      parentAccountIdValue: inlineChildParentAccountId,
      inlineCodeValue: inlineChildCode,
      fallbackSearchCode: accountSearchCodeCandidate,
      inlineNameValue: inlineChildName,
      setPickerSaving: setInlineChildSaving,
      clearPickerInputs: () => {
        setAccountLookupQuery("");
        setInlineChildCode("");
        setInlineChildName("");
      },
    });
  }

  async function handleCreateVarianceGainChildAccountFromPicker() {
    await createChildAccountForField({
      targetField: "varianceGainAccountId",
      parentAccountIdValue: varianceGainInlineChildParentAccountId,
      inlineCodeValue: varianceGainInlineChildCode,
      fallbackSearchCode: varianceGainSearchCodeCandidate,
      inlineNameValue: varianceGainInlineChildName,
      setPickerSaving: setVarianceGainInlineChildSaving,
      clearPickerInputs: () => {
        setVarianceGainLookupQuery("");
        setVarianceGainInlineChildCode("");
        setVarianceGainInlineChildName("");
      },
    });
  }

  async function handleCreateVarianceLossChildAccountFromPicker() {
    await createChildAccountForField({
      targetField: "varianceLossAccountId",
      parentAccountIdValue: varianceLossInlineChildParentAccountId,
      inlineCodeValue: varianceLossInlineChildCode,
      fallbackSearchCode: varianceLossSearchCodeCandidate,
      inlineNameValue: varianceLossInlineChildName,
      setPickerSaving: setVarianceLossInlineChildSaving,
      clearPickerInputs: () => {
        setVarianceLossLookupQuery("");
        setVarianceLossInlineChildCode("");
        setVarianceLossInlineChildName("");
      },
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canUpsertRegisters) {
      setError(t("cashRegisters.errors.missingUpsertPermission"));
      return;
    }

    const legalEntityId = toPositiveInt(form.legalEntityId);
    const accountId = toPositiveInt(form.accountId);
    const operatingUnitId = isOperatingUnitOwned ? toPositiveInt(form.operatingUnitId) : null;
    const varianceGainAccountId = toPositiveInt(form.varianceGainAccountId);
    const varianceLossAccountId = toPositiveInt(form.varianceLossAccountId);
    const maxTxnAmount = toOptionalAmount(form.maxTxnAmount);
    const requiresApprovalOverAmount = toOptionalAmount(form.requiresApprovalOverAmount);

    if (!form.code.trim() || !form.name.trim()) {
      setError(t("cashRegisters.errors.requiredCodeName"));
      return;
    }
    if (!String(form.sessionMode || "").trim()) {
      setError(t("cashRegisters.errors.requiredSessionMode"));
      return;
    }
    if (!legalEntityId || !accountId) {
      setError(t("cashRegisters.errors.requiredEntityAccount"));
      return;
    }
    if (!String(form.currencyCode || "").trim()) {
      setError(t("cashRegisters.errors.requiredCurrency"));
      return;
    }
    if (isOperatingUnitOwned && !operatingUnitId) {
      setError(t("cashRegisters.errors.operatingUnitRequiredForOwnership"));
      return;
    }
    if (Number.isNaN(maxTxnAmount) || Number.isNaN(requiresApprovalOverAmount)) {
      setError(t("cashRegisters.errors.invalidAmount"));
      return;
    }

    const payload = {
      legalEntityId,
      ownershipScope: normalizedOwnershipScope,
      operatingUnitId,
      accountId,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      registerType: form.registerType,
      sessionMode: form.sessionMode,
      currencyCode: form.currencyCode.trim().toUpperCase(),
      status: form.status,
      allowNegative: Boolean(form.allowNegative),
      varianceGainAccountId,
      varianceLossAccountId,
      maxTxnAmount,
      requiresApprovalOverAmount,
    };
    const editingId = toPositiveInt(form.id);
    if (editingId) {
      payload.id = editingId;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await upsertCashRegister(payload);
      setMessage(
        editingId
          ? t("cashRegisters.messages.updated")
          : t("cashRegisters.messages.created")
      );
      resetForm();
      await loadRegisters();
    } catch (err) {
      setError(err?.response?.data?.message || t("cashRegisters.errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(row) {
    if (!canUpsertRegisters) {
      return;
    }
    const rowId = toPositiveInt(row?.id);
    if (!rowId) {
      return;
    }

    const currentStatus = String(row?.status || "").toUpperCase();
    const targetStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    setUpdatingStatusId(rowId);
    setError("");
    setMessage("");
    try {
      await setCashRegisterStatus(rowId, { status: targetStatus });
      setMessage(
        t("cashRegisters.messages.statusUpdated", {
          code: row?.code || rowId,
          status: targetStatus,
        })
      );
      await loadRegisters();
    } catch (err) {
      setError(
        err?.response?.data?.message || t("cashRegisters.errors.statusUpdate")
      );
    } finally {
      setUpdatingStatusId(null);
    }
  }

  function renderInlineChildCreatePanel({
    codeCandidate,
    searchText,
    parentAccountIdValue,
    onParentChange,
    childCodeValue,
    onChildCodeChange,
    childNameValue,
    onChildNameChange,
    onUseTypedCode,
    onUseNextCode,
    suggestedNextCode,
    hasSelectedParent,
    onCreateChild,
    creating,
  }) {
    const displayQuery = String(codeCandidate || searchText || "").trim();
    const canUseTypedCode = Boolean(String(codeCandidate || "").trim());
    return (
      <div className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2">
        <p className="text-xs text-cyan-800">
          {displayQuery
            ? t("cashRegisters.accountPicker.codeNotFoundHint", {
                code: displayQuery,
              })
            : "No exact account found. Create a child account below."}
        </p>
        <Combobox
          value={parentAccountIdValue || null}
          options={parentAccountLookupOptions}
          disabled={saving || creating || !selectedLegalEntityId}
          placeholder={t("cashRegisters.accountPicker.parentPlaceholder")}
          noOptionsText={t("cashRegisters.accountPicker.parentNoOptions")}
          onChange={(nextValue) => onParentChange(nextValue ? String(nextValue) : "")}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={childCodeValue}
            onChange={(event) =>
              onChildCodeChange(normalizeAccountCode(event.target.value))
            }
            className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-xs"
            placeholder={t("cashRegisters.accountPicker.childCodePlaceholder")}
            maxLength={60}
          />
          <input
            value={childNameValue}
            onChange={(event) => onChildNameChange(event.target.value)}
            className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-xs"
            placeholder={t("cashRegisters.accountPicker.childNamePlaceholder")}
            maxLength={255}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onUseTypedCode}
            disabled={!canUseTypedCode}
            className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100"
          >
            {t("cashRegisters.accountPicker.useTypedCode")}
          </button>
          <button
            type="button"
            onClick={onUseNextCode}
            disabled={!suggestedNextCode || !hasSelectedParent}
            className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
          >
            {t("cashRegisters.accountPicker.useNextCode")}
          </button>
          <button
            type="button"
            onClick={onCreateChild}
            disabled={creating || saving || !canUpsertAccounts}
            className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
          >
            {creating
              ? t("cashRegisters.accountPicker.creatingChild")
              : t("cashRegisters.accountPicker.createChild")}
          </button>
        </div>
        {!canUpsertAccounts ? (
          <p className="text-[11px] text-amber-700">
            {t("cashRegisters.accountPicker.missingUpsertPermissionHint")}
          </p>
        ) : null}
      </div>
    );
  }

  if (!canReadRegisters) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t("cashRegisters.errors.missingReadPermission")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("cashRegisters.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("cashRegisters.subtitle")}
        </p>
      </div>

      <CashControlModeBanner />

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {lookupWarning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {lookupWarning}
        </div>
      ) : null}

      {canUpsertRegisters ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              {form.id
                ? t("cashRegisters.sections.edit")
                : t("cashRegisters.sections.create")}
            </h2>
            {form.id ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("cashRegisters.actions.cancelEdit")}
              </button>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="grid gap-2 md:grid-cols-3">
            <input
              value={form.code}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashRegisters.form.code")}
              maxLength={60}
              required
            />
            <input
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashRegisters.form.name")}
              maxLength={255}
              required
            />
            <select
              value={form.registerType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, registerType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {REGISTER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <select
              value={form.sessionMode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sessionMode: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{t("cashRegisters.placeholders.sessionMode")}</option>
              {SESSION_MODES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            {legalEntityOptions.length > 0 ? (
              <select
                value={form.legalEntityId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    legalEntityId: event.target.value,
                    operatingUnitId: "",
                    accountId: "",
                    varianceGainAccountId: "",
                    varianceLossAccountId: "",
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">{t("cashRegisters.placeholders.legalEntity")}</option>
                {legalEntityOptions.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.code} - {entity.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.legalEntityId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashRegisters.form.legalEntityId")}
                required
              />
            )}

            <div className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("cashRegisters.form.ownershipScope")}
              </div>
              <div className="flex flex-wrap gap-2">
                {OWNERSHIP_SCOPES.map((scope) => {
                  const selected = normalizedOwnershipScope === scope;
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          ownershipScope: scope,
                          operatingUnitId:
                            scope === "CENTRAL" ? "" : prev.operatingUnitId,
                        }))
                      }
                      className={[
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {scope === "CENTRAL"
                        ? t("cashRegisters.values.ownershipCentral")
                        : t("cashRegisters.values.ownershipOperatingUnit")}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {isOperatingUnitOwned
                  ? t("cashRegisters.form.ownershipOperatingUnitHelp")
                  : t("cashRegisters.form.ownershipCentralHelp")}
              </p>
            </div>

            {currencyOptions.length > 0 ? (
              <select
                value={form.currencyCode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    currencyCode: String(event.target.value || "").toUpperCase(),
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">{t("cashRegisters.placeholders.currencyCode")}</option>
                {currencyOptions.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.currencyCode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    currencyCode: event.target.value.toUpperCase(),
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashRegisters.form.currencyCode")}
                maxLength={3}
                required
              />
            )}

            {isOperatingUnitOwned ? (
              operatingUnitOptions.length > 0 ? (
                <select
                  value={form.operatingUnitId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">{t("cashRegisters.placeholders.operatingUnit")}</option>
                  {operatingUnitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} - {unit.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={form.operatingUnitId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("cashRegisters.form.operatingUnitIdRequired")}
                  required
                />
              )
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <div className="font-medium text-slate-700">
                  {t("cashRegisters.values.centralHq")}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t("cashRegisters.form.operatingUnitHiddenForCentral")}
                </div>
              </div>
            )}

            {canReadAccounts ? (
              <div className="space-y-2 md:col-span-2">
                <Combobox
                  value={form.accountId || null}
                  options={accountLookupOptions}
                  disabled={saving || !canReadAccounts || !selectedLegalEntityId}
                  placeholder={
                    selectedLegalEntityId
                      ? t("cashRegisters.accountPicker.searchPlaceholder")
                      : t("cashRegisters.accountPicker.selectLegalEntityFirst")
                  }
                  noOptionsText={t("cashRegisters.accountPicker.noOptions")}
                  onInputChange={(nextValue, meta) => {
                    if (meta?.reason === "input" || meta?.reason === "clear") {
                      setAccountLookupQuery(nextValue);
                      setInlineChildName(String(nextValue || "").trim());
                    }
                  }}
                  onChange={(nextValue) => {
                    setForm((prev) => ({
                      ...prev,
                      accountId: nextValue ? String(nextValue) : "",
                    }));
                    setAccountLookupQuery("");
                  }}
                />
                <p className="text-[11px] text-slate-500">
                  {t("cashRegisters.accountPicker.searchHelp")}
                </p>
                {showInlineChildCreate ? (
                  renderInlineChildCreatePanel({
                    codeCandidate: accountSearchCodeCandidate,
                    searchText: accountLookupQuery,
                    parentAccountIdValue: inlineChildParentAccountId,
                    onParentChange: setInlineChildParentAccountId,
                    childCodeValue: inlineChildCode,
                    onChildCodeChange: setInlineChildCode,
                    childNameValue: inlineChildName,
                    onChildNameChange: setInlineChildName,
                    onUseTypedCode: () =>
                      setInlineChildCode(accountSearchCodeCandidate),
                    onUseNextCode: () => setInlineChildCode(suggestedNextChildCode),
                    suggestedNextCode: suggestedNextChildCode,
                    hasSelectedParent: Boolean(selectedInlineParentAccount),
                    onCreateChild: handleCreateChildAccountFromPicker,
                    creating: inlineChildSaving,
                  })
                ) : null}
              </div>
            ) : (
              <input
                type="number"
                min={1}
                value={form.accountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, accountId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashRegisters.form.accountId")}
                required
              />
            )}

            {canReadAccounts ? (
              <div className="space-y-2">
                <Combobox
                  value={form.varianceGainAccountId || null}
                  options={varianceGainAccountLookupOptions}
                  disabled={saving || !canReadAccounts || !selectedLegalEntityId}
                  placeholder={
                    selectedLegalEntityId
                      ? t("cashRegisters.placeholders.varianceGainAccount")
                      : t("cashRegisters.accountPicker.selectLegalEntityFirst")
                  }
                  noOptionsText={t("cashRegisters.accountPicker.noOptions")}
                  onInputChange={(nextValue, meta) => {
                    if (meta?.reason === "input" || meta?.reason === "clear") {
                      setVarianceGainLookupQuery(nextValue);
                      setVarianceGainInlineChildName(String(nextValue || "").trim());
                    }
                  }}
                  onChange={(nextValue) => {
                    setForm((prev) => ({
                      ...prev,
                      varianceGainAccountId: nextValue ? String(nextValue) : "",
                    }));
                    setVarianceGainLookupQuery("");
                  }}
                />
                {showVarianceGainInlineChildCreate
                  ? renderInlineChildCreatePanel({
                      codeCandidate: varianceGainSearchCodeCandidate,
                      searchText: varianceGainLookupQuery,
                      parentAccountIdValue: varianceGainInlineChildParentAccountId,
                      onParentChange: setVarianceGainInlineChildParentAccountId,
                      childCodeValue: varianceGainInlineChildCode,
                      onChildCodeChange: setVarianceGainInlineChildCode,
                      childNameValue: varianceGainInlineChildName,
                      onChildNameChange: setVarianceGainInlineChildName,
                      onUseTypedCode: () =>
                        setVarianceGainInlineChildCode(varianceGainSearchCodeCandidate),
                      onUseNextCode: () =>
                        setVarianceGainInlineChildCode(suggestedVarianceGainNextChildCode),
                      suggestedNextCode: suggestedVarianceGainNextChildCode,
                      hasSelectedParent: Boolean(selectedVarianceGainInlineParentAccount),
                      onCreateChild: handleCreateVarianceGainChildAccountFromPicker,
                      creating: varianceGainInlineChildSaving,
                    })
                  : null}
              </div>
            ) : (
              <input
                type="number"
                min={1}
                value={form.varianceGainAccountId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    varianceGainAccountId: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashRegisters.form.varianceGainAccountIdOptional")}
              />
            )}

            {canReadAccounts ? (
              <div className="space-y-2">
                <Combobox
                  value={form.varianceLossAccountId || null}
                  options={varianceLossAccountLookupOptions}
                  disabled={saving || !canReadAccounts || !selectedLegalEntityId}
                  placeholder={
                    selectedLegalEntityId
                      ? t("cashRegisters.placeholders.varianceLossAccount")
                      : t("cashRegisters.accountPicker.selectLegalEntityFirst")
                  }
                  noOptionsText={t("cashRegisters.accountPicker.noOptions")}
                  onInputChange={(nextValue, meta) => {
                    if (meta?.reason === "input" || meta?.reason === "clear") {
                      setVarianceLossLookupQuery(nextValue);
                      setVarianceLossInlineChildName(String(nextValue || "").trim());
                    }
                  }}
                  onChange={(nextValue) => {
                    setForm((prev) => ({
                      ...prev,
                      varianceLossAccountId: nextValue ? String(nextValue) : "",
                    }));
                    setVarianceLossLookupQuery("");
                  }}
                />
                {showVarianceLossInlineChildCreate
                  ? renderInlineChildCreatePanel({
                      codeCandidate: varianceLossSearchCodeCandidate,
                      searchText: varianceLossLookupQuery,
                      parentAccountIdValue: varianceLossInlineChildParentAccountId,
                      onParentChange: setVarianceLossInlineChildParentAccountId,
                      childCodeValue: varianceLossInlineChildCode,
                      onChildCodeChange: setVarianceLossInlineChildCode,
                      childNameValue: varianceLossInlineChildName,
                      onChildNameChange: setVarianceLossInlineChildName,
                      onUseTypedCode: () =>
                        setVarianceLossInlineChildCode(varianceLossSearchCodeCandidate),
                      onUseNextCode: () =>
                        setVarianceLossInlineChildCode(suggestedVarianceLossNextChildCode),
                      suggestedNextCode: suggestedVarianceLossNextChildCode,
                      hasSelectedParent: Boolean(selectedVarianceLossInlineParentAccount),
                      onCreateChild: handleCreateVarianceLossChildAccountFromPicker,
                      creating: varianceLossInlineChildSaving,
                    })
                  : null}
              </div>
            ) : (
              <input
                type="number"
                min={1}
                value={form.varianceLossAccountId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    varianceLossAccountId: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashRegisters.form.varianceLossAccountIdOptional")}
              />
            )}

            <input
              type="number"
              min="0.000001"
              step="0.000001"
              value={form.maxTxnAmount}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, maxTxnAmount: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashRegisters.form.maxTxnAmountOptional")}
            />
            <input
              type="number"
              min="0"
              step="0.000001"
              value={form.requiresApprovalOverAmount}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  requiresApprovalOverAmount: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashRegisters.form.requiresApprovalOverAmountOptional")}
            />
            <select
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {REGISTER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(form.allowNegative)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    allowNegative: event.target.checked,
                  }))
                }
              />
              {t("cashRegisters.form.allowNegative")}
            </label>

            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving
                ? t("cashRegisters.actions.saving")
                : form.id
                ? t("cashRegisters.actions.update")
                : t("cashRegisters.actions.create")}
            </button>
          </form>
        </section>
      ) : (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashRegisters.readOnlyNotice")}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {t("cashRegisters.sections.list")}
          </h2>
          <button
            type="button"
            onClick={loadRegisters}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading
              ? t("cashRegisters.actions.loading")
              : t("cashRegisters.actions.refresh")}
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">{t("cashRegisters.table.code")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.name")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.ownership")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.registerType")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.sessionMode")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.legalEntity")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.operatingUnit")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.account")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.currency")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.allowNegative")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.status")}</th>
                <th className="px-3 py-2">{t("cashRegisters.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const rowStatus = String(row?.status || "").toUpperCase();
                const ownershipMeta = resolveOwnershipMeta(row, t);
                const isStatusBusy = rowId && updatingStatusId === rowId;
                const statusBadgeClass =
                  rowStatus === "ACTIVE"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-700";

                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${ownershipMeta.badgeClass}`}
                      >
                        {ownershipMeta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.register_type}</td>
                    <td className="px-3 py-2">{row.session_mode}</td>
                    <td className="px-3 py-2">
                      {row.legal_entity_code || row.legal_entity_id} -{" "}
                      {row.legal_entity_name || "-"}
                    </td>
                    <td className="px-3 py-2">{ownershipMeta.contextLabel}</td>
                    <td className="px-3 py-2">
                      {row.account_code || row.account_id} - {row.account_name || "-"}
                    </td>
                    <td className="px-3 py-2">{row.currency_code || "-"}</td>
                    <td className="px-3 py-2">
                      {parseDbBoolean(row.allow_negative)
                        ? t("cashRegisters.values.yes")
                        : t("cashRegisters.values.no")}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass}`}
                      >
                        {rowStatus || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {canUpsertRegisters ? (
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => handleEdit(row)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {t("cashRegisters.actions.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(row)}
                            disabled={isStatusBusy}
                            className="rounded-md border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                          >
                            {isStatusBusy
                              ? t("cashRegisters.actions.saving")
                              : rowStatus === "ACTIVE"
                              ? t("cashRegisters.actions.deactivate")
                              : t("cashRegisters.actions.activate")}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-3 text-slate-500">
                    {t("cashRegisters.empty")}
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-3 text-slate-500">
                    {t("cashRegisters.loading")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
