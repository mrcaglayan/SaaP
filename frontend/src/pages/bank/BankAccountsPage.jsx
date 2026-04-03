import { useEffect, useMemo, useState } from "react";
import {
  activateBankAccount,
  createBankAccount,
  deactivateBankAccount,
  listBankAccounts,
  provisionBankAccountControlParentChild,
  updateBankAccount,
} from "../../api/bankAccounts.js";
import {
  listBankConnectors,
  syncBankConnectorStatements,
  testBankConnectorConnection,
} from "../../api/bankConnectors.js";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import { listJournalPurposeAccounts } from "../../api/glPurposeMappings.js";
import Combobox from "../../components/Combobox.jsx";
import {
  SensitiveFieldEditHint,
  SensitiveFieldsNotice,
  SensitiveFieldValue,
} from "../../components/security/SensitiveFieldValue.jsx";
import { listCurrencies, listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import {
  buildSensitiveUpdateValue,
  filterMaskedFieldSummary,
  getSensitiveValueState,
  isRestrictedSensitiveState,
  isRestrictedSensitiveValue,
} from "../../utils/sensitiveFieldUi.js";

const EMPTY_FORM = {
  id: "",
  legalEntityId: "",
  operatingUnitId: "",
  code: "",
  name: "",
  currencyCode: "",
  glAccountId: "",
  bankName: "",
  branchName: "",
  iban: "",
  accountNo: "",
  isActive: true,
};

const EMPTY_BANK_SENSITIVE_STATE = Object.freeze({
  iban: "empty",
  accountNo: "empty",
});

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getAccountId(row) {
  return toPositiveInt(row?.id);
}

function getAccountCode(row) {
  return normalizeAccountCode(row?.code);
}

function getAccountName(row) {
  return String(row?.name || "").trim();
}

function getAccountType(row) {
  return normalizeAccountCode(row?.account_type ?? row?.accountType);
}

function getAccountNormalSide(row) {
  return normalizeAccountCode(row?.normal_side ?? row?.normalSide);
}

function getAccountIsActive(row) {
  return parseDbBoolean(row?.is_active ?? row?.isActive);
}

function getAccountAllowPosting(row) {
  return parseDbBoolean(row?.allow_posting ?? row?.allowPosting);
}

function getAccountParentId(row) {
  return toPositiveInt(row?.parent_account_id ?? row?.parentAccountId);
}

function getAccountCoaId(row) {
  return toPositiveInt(row?.coa_id ?? row?.coaId);
}

function getAccountLegalEntityId(row) {
  return toPositiveInt(row?.legal_entity_id ?? row?.legalEntityId);
}

function formatAccountOptionLabel(row) {
  const code = getAccountCode(row);
  const name = getAccountName(row);
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(getAccountId(row) || "-");
}

function formatAccountOptionDescription(row) {
  const breadcrumb = String(
    row?.account_breadcrumb_codes ||
      row?.account_breadcrumb_names ||
      row?.account_breadcrumb ||
      row?.accountBreadcrumbCodes ||
      row?.accountBreadcrumbNames ||
      row?.accountBreadcrumb ||
      ""
  ).trim();
  if (breadcrumb) {
    return breadcrumb;
  }
  return [getAccountType(row), getAccountNormalSide(row)].filter(Boolean).join(" | ");
}

function formatPurposeMappingAccountLabel(row) {
  const code = String(row?.accountCode ?? row?.account_code ?? "").trim();
  const name = String(row?.accountName ?? row?.account_name ?? "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || "";
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
  const parentCode = getAccountCode(parentAccount);
  const parentAccountId = getAccountId(parentAccount);
  if (!parentCode || !parentAccountId) {
    return "";
  }

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const existingCodes = new Set(normalizedRows.map((row) => getAccountCode(row)).filter(Boolean));
  const parsedChildren = normalizedRows
    .filter((row) => getAccountParentId(row) === parentAccountId)
    .map((row) => parseChildCodeSequence(getAccountCode(row), parentCode))
    .filter(Boolean);

  const maxSequence = parsedChildren.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.value || 0)),
    0
  );
  const width = Math.max(
    2,
    parsedChildren.reduce((maxWidth, row) => Math.max(maxWidth, Number(row?.width || 0)), 0)
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
  for (const row of parentAccountOptions || []) {
    const parentCode = getAccountCode(row);
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
    if (!bestParent || parentCode.length > getAccountCode(bestParent).length) {
      bestParent = row;
    }
  }
  return bestParent;
}

function generateProvisionIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `bank-provision-control-parent-${globalThis.crypto.randomUUID()}`;
  }
  return `bank-provision-control-parent-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function mapRowToForm(row) {
  const sensitiveState = {
    iban: getSensitiveValueState(row?.iban, { hiddenWhenMissing: true }),
    accountNo: getSensitiveValueState(row?.account_no, { hiddenWhenMissing: true }),
  };
  return {
    id: String(row?.id || ""),
    legalEntityId: String(row?.legal_entity_id || ""),
    operatingUnitId: String(row?.operating_unit_id || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    currencyCode: String(row?.currency_code || "").toUpperCase(),
    glAccountId: String(row?.gl_account_id || ""),
    bankName: String(row?.bank_name || ""),
    branchName: String(row?.branch_name || ""),
    iban: isRestrictedSensitiveState(sensitiveState.iban) ? "" : String(row?.iban || ""),
    accountNo: isRestrictedSensitiveState(sensitiveState.accountNo)
      ? ""
      : String(row?.account_no || ""),
    isActive: parseDbBoolean(row?.is_active),
  };
}

export default function BankAccountsPage() {
  const { hasPermission, isVisibilityNarrowed, maskedFields } = useAuth();
  const { getModuleRow } = useModuleReadiness();
  const canRead = hasPermission("bank.accounts.read");
  const canWrite = hasPermission("bank.accounts.write");
  const canReadConnectors = hasPermission("bank.connectors.read");
  const canSyncConnectors = hasPermission("bank.connectors.sync");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertAccounts = hasPermission("gl.account.upsert");

  const [rows, setRows] = useState([]);
  const [connectorRows, setConnectorRows] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters] = useState({
    legalEntityId: "",
    operatingUnitId: "",
    isActive: "",
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [autoProvisionControlParent, setAutoProvisionControlParent] = useState(false);
  const [provisionGlAccountName, setProvisionGlAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null);
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorActionBusy, setConnectorActionBusy] = useState({ testId: null, syncId: null });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [connectorError, setConnectorError] = useState("");
  const [connectorMessage, setConnectorMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");
  const [bankControlParentMapping, setBankControlParentMapping] = useState(null);
  const [glAccountLookupQuery, setGlAccountLookupQuery] = useState("");
  const [inlineChildParentAccountId, setInlineChildParentAccountId] = useState("");
  const [inlineChildCode, setInlineChildCode] = useState("");
  const [inlineChildName, setInlineChildName] = useState("");
  const [inlineChildSaving, setInlineChildSaving] = useState(false);
  const [formSensitiveState, setFormSensitiveState] = useState(EMPTY_BANK_SENSITIVE_STATE);
  const [formSensitivePreview, setFormSensitivePreview] = useState({
    iban: "",
    accountNo: "",
  });

  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const selectedBankControlParentReadiness = getModuleRow(
    "bankControlParent",
    selectedLegalEntityId
  );
  const selectedFilterLegalEntityId = toPositiveInt(filters.legalEntityId);

  const legalEntityOptions = useMemo(
    () =>
      [...legalEntities].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [legalEntities]
  );

  const currencyOptions = useMemo(
    () =>
      [...currencies].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [currencies]
  );

  const operatingUnitOptions = useMemo(() => {
    const filtered = operatingUnits.filter((row) => {
      if (String(row?.status || "").toUpperCase() !== "ACTIVE") {
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
  }, [operatingUnits, selectedLegalEntityId]);

  const filterOperatingUnitOptions = useMemo(() => {
    const filtered = operatingUnits.filter((row) => {
      if (String(row?.status || "").toUpperCase() !== "ACTIVE") {
        return false;
      }
      if (!selectedFilterLegalEntityId) {
        return true;
      }
      return toPositiveInt(row?.legal_entity_id) === selectedFilterLegalEntityId;
    });
    return [...filtered].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [operatingUnits, selectedFilterLegalEntityId]);

  const glAccountOptions = useMemo(() => {
    const filtered = accounts.filter((row) => {
      if (!getAccountIsActive(row) || !getAccountAllowPosting(row)) {
        return false;
      }
      if (String(row?.scope || "").toUpperCase() !== "LEGAL_ENTITY") {
        return false;
      }
      if (getAccountType(row) !== "ASSET") {
        return false;
      }
      if (!selectedLegalEntityId) {
        return true;
      }
      return getAccountLegalEntityId(row) === selectedLegalEntityId;
    });
    return [...filtered].sort((a, b) =>
      getAccountCode(a).localeCompare(getAccountCode(b))
    );
  }, [accounts, selectedLegalEntityId]);

  const selectedGlAccountId = toPositiveInt(form.glAccountId);
  const selectedGlAccountOption = useMemo(
    () =>
      glAccountOptions.find((row) => getAccountId(row) === selectedGlAccountId) ||
      accounts.find((row) => getAccountId(row) === selectedGlAccountId) ||
      null,
    [accounts, glAccountOptions, selectedGlAccountId]
  );
  const glAccountPickerRows = useMemo(() => {
    if (!selectedGlAccountOption) {
      return glAccountOptions;
    }
    const selectedId = getAccountId(selectedGlAccountOption);
    const alreadyInRows = glAccountOptions.some((row) => getAccountId(row) === selectedId);
    return alreadyInRows ? glAccountOptions : [selectedGlAccountOption, ...glAccountOptions];
  }, [glAccountOptions, selectedGlAccountOption]);
  const glAccountLookupOptions = useMemo(
    () =>
      glAccountPickerRows.map((row) => ({
        value: String(getAccountId(row) || ""),
        label: formatAccountOptionLabel(row),
        description: formatAccountOptionDescription(row),
      })),
    [glAccountPickerRows]
  );
  const parentAccountOptions = useMemo(() => {
    const filtered = accounts.filter((row) => {
      if (!getAccountIsActive(row)) {
        return false;
      }
      if (getAccountType(row) !== "ASSET") {
        return false;
      }
      if (!selectedLegalEntityId) {
        return true;
      }
      return getAccountLegalEntityId(row) === selectedLegalEntityId;
    });
    return [...filtered].sort((a, b) => getAccountCode(a).localeCompare(getAccountCode(b)));
  }, [accounts, selectedLegalEntityId]);
  const parentAccountLookupOptions = useMemo(
    () =>
      parentAccountOptions.map((row) => ({
        value: String(getAccountId(row) || ""),
        label: formatAccountOptionLabel(row),
        description: formatAccountOptionDescription(row),
      })),
    [parentAccountOptions]
  );
  const configuredControlParentAccountId = toPositiveInt(
    bankControlParentMapping?.accountId ?? bankControlParentMapping?.account_id
  );
  const configuredControlParentAccount = useMemo(
    () =>
      parentAccountOptions.find(
        (row) => getAccountId(row) === configuredControlParentAccountId
      ) || null,
    [configuredControlParentAccountId, parentAccountOptions]
  );
  const configuredControlParentLabel = useMemo(
    () =>
      formatPurposeMappingAccountLabel(bankControlParentMapping) ||
      formatAccountOptionLabel(configuredControlParentAccount),
    [bankControlParentMapping, configuredControlParentAccount]
  );
  const selectedEntityAccountByCode = useMemo(() => {
    const byCode = new Map();
    for (const row of accounts) {
      if (selectedLegalEntityId && getAccountLegalEntityId(row) !== selectedLegalEntityId) {
        continue;
      }
      const code = getAccountCode(row);
      if (!code || byCode.has(code)) {
        continue;
      }
      byCode.set(code, row);
    }
    return byCode;
  }, [accounts, selectedLegalEntityId]);
  const glAccountCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(glAccountLookupQuery),
    [glAccountLookupQuery]
  );
  const exactCodeMatchAccount = useMemo(() => {
    if (!glAccountCodeCandidate) {
      return null;
    }
    const row = selectedEntityAccountByCode.get(glAccountCodeCandidate) || null;
    if (!row) {
      return null;
    }
    if (!getAccountIsActive(row) || !getAccountAllowPosting(row)) {
      return null;
    }
    if (getAccountType(row) !== "ASSET") {
      return null;
    }
    return row;
  }, [glAccountCodeCandidate, selectedEntityAccountByCode]);
  const hasTypedSearchText = Boolean(String(glAccountLookupQuery || "").trim());
  const showInlineChildCreate =
    !autoProvisionControlParent &&
    Boolean(selectedLegalEntityId) &&
    hasTypedSearchText &&
    !exactCodeMatchAccount;
  const selectedInlineParentAccount = useMemo(
    () =>
      parentAccountOptions.find(
        (row) => getAccountId(row) === toPositiveInt(inlineChildParentAccountId)
      ) || null,
    [parentAccountOptions, inlineChildParentAccountId]
  );
  const suggestedNextChildCode = useMemo(
    () => buildNextChildAccountCode(accounts, selectedInlineParentAccount),
    [accounts, selectedInlineParentAccount]
  );
  const bankMaskedFieldSummary = useMemo(
    () => filterMaskedFieldSummary(maskedFields, ["iban", "account_no", "accountNo"]),
    [maskedFields]
  );
  const hasRestrictedBankRows = useMemo(
    () =>
      rows.some(
        (row) =>
          isRestrictedSensitiveValue(row?.iban, { hiddenWhenMissing: true }) ||
          isRestrictedSensitiveValue(row?.account_no, { hiddenWhenMissing: true })
      ),
    [rows]
  );
  const showSensitiveBankNotice =
    isVisibilityNarrowed ||
    bankMaskedFieldSummary.length > 0 ||
    hasRestrictedBankRows ||
    isRestrictedSensitiveState(formSensitiveState.iban) ||
    isRestrictedSensitiveState(formSensitiveState.accountNo);

  useEffect(() => {
    if (form.id) {
      return;
    }
    if (!form.legalEntityId && legalEntityOptions.length > 0) {
      setForm((prev) => ({
        ...prev,
        legalEntityId: String(legalEntityOptions[0]?.id || ""),
      }));
    }
  }, [form.id, form.legalEntityId, legalEntityOptions]);

  useEffect(() => {
    if (form.id) {
      return;
    }
    if (!form.currencyCode && currencyOptions.length > 0) {
      setForm((prev) => ({
        ...prev,
        currencyCode: String(currencyOptions[0]?.code || "").toUpperCase(),
      }));
    }
  }, [currencyOptions, form.currencyCode, form.id]);

  useEffect(() => {
    setGlAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
  }, [form.legalEntityId]);

  useEffect(() => {
    if (!autoProvisionControlParent) {
      return;
    }
    setGlAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
  }, [autoProvisionControlParent]);

  useEffect(() => {
    let active = true;
    if (!canReadAccounts || !selectedLegalEntityId) {
      setBankControlParentMapping(null);
      return undefined;
    }

    listJournalPurposeAccounts({
      legalEntityId: selectedLegalEntityId,
      moduleKey: "BANK",
    })
      .then((response) => {
        if (!active) {
          return;
        }
        const row =
          (response?.rows || []).find(
            (entry) =>
              String(entry?.purposeCode || entry?.purpose_code || "").trim().toUpperCase() ===
              "BANK_CONTROL_PARENT"
          ) || null;
        setBankControlParentMapping(row);
      })
      .catch(() => {
        if (active) {
          setBankControlParentMapping(null);
        }
      });

    return () => {
      active = false;
    };
  }, [canReadAccounts, selectedLegalEntityId]);

  useEffect(() => {
    if (!showInlineChildCreate) {
      return;
    }
    setInlineChildCode((prev) => prev || glAccountCodeCandidate);
    setInlineChildName(
      (prev) =>
        prev || String(glAccountLookupQuery || "").trim() || String(form.name || "").trim()
    );
  }, [showInlineChildCreate, glAccountCodeCandidate, glAccountLookupQuery, form.name]);
  useEffect(() => {
    if (!showInlineChildCreate || !suggestedNextChildCode) {
      return;
    }
    setInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(glAccountCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedNextChildCode;
      }
      return prev;
    });
  }, [showInlineChildCreate, suggestedNextChildCode, glAccountCodeCandidate]);

  useEffect(() => {
    if (!showInlineChildCreate || toPositiveInt(inlineChildParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(inlineChildCode || glAccountCodeCandidate);
    const bestParent = candidateCode
      ? findBestParentAccount(candidateCode, parentAccountOptions) ||
        configuredControlParentAccount ||
        null
      : configuredControlParentAccount ||
        parentAccountOptions[0] ||
        null;
    if (getAccountId(bestParent)) {
      setInlineChildParentAccountId(String(getAccountId(bestParent)));
    }
  }, [
    showInlineChildCreate,
    inlineChildParentAccountId,
    inlineChildCode,
    glAccountCodeCandidate,
    configuredControlParentAccount,
    parentAccountOptions,
  ]);

  async function loadRows(nextFilters = filters) {
    if (!canRead) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await listBankAccounts({
        limit: 200,
        offset: 0,
        legalEntityId: toPositiveInt(nextFilters.legalEntityId) || undefined,
        operatingUnitId: toPositiveInt(nextFilters.operatingUnitId) || undefined,
        isActive:
          nextFilters.isActive === ""
            ? undefined
            : nextFilters.isActive === "true",
      });
      setRows(response?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load bank accounts");
    } finally {
      setLoading(false);
    }
  }

  async function loadConnectors() {
    if (!canReadConnectors) {
      setConnectorRows([]);
      return;
    }

    setConnectorLoading(true);
    setConnectorError("");
    try {
      const response = await listBankConnectors({ limit: 100, offset: 0 });
      setConnectorRows(response?.rows || []);
    } catch (err) {
      setConnectorError(err?.response?.data?.message || "Failed to load bank connectors");
    } finally {
      setConnectorLoading(false);
    }
  }

  async function loadLookups() {
    if (!canRead && !canWrite) {
      setLookupWarning("");
      return;
    }

    const warnings = [];

    if (canReadOrgTree) {
      try {
        const [leRes, ouRes, curRes] = await Promise.all([
          listLegalEntities(),
          listOperatingUnits(),
          listCurrencies(),
        ]);
        setLegalEntities(leRes?.rows || []);
        setOperatingUnits(ouRes?.rows || []);
        setCurrencies(curRes?.rows || []);
      } catch (err) {
        warnings.push(err?.response?.data?.message || "Org/currency lookups could not be loaded");
        setLegalEntities([]);
        setOperatingUnits([]);
        setCurrencies([]);
      }
    } else {
      warnings.push("Missing permission: org.tree.read (legal entity/currency lookups)");
      setLegalEntities([]);
      setOperatingUnits([]);
      setCurrencies([]);
    }

    if (canReadAccounts) {
      try {
        const accountsRes = await listAccounts({ includeInactive: true });
        setAccounts(accountsRes?.rows || []);
      } catch (err) {
        warnings.push(err?.response?.data?.message || "GL account lookup could not be loaded");
        setAccounts([]);
      }
    } else {
      warnings.push("Missing permission: gl.account.read (GL account lookup)");
      setAccounts([]);
    }

    setLookupWarning(warnings.join(" | "));
  }

  useEffect(() => {
    loadRows();
    loadConnectors();
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, canWrite, canReadConnectors, canReadOrgTree, canReadAccounts]);

  function resetForm() {
    setForm((prev) => ({
      ...EMPTY_FORM,
      legalEntityId: prev.legalEntityId && !form.id ? prev.legalEntityId : "",
      operatingUnitId: "",
      currencyCode: prev.currencyCode && !form.id ? prev.currencyCode : "",
    }));
    setAutoProvisionControlParent(false);
    setProvisionGlAccountName("");
    setGlAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setFormSensitiveState(EMPTY_BANK_SENSITIVE_STATE);
    setFormSensitivePreview({ iban: "", accountNo: "" });
  }

  function startEdit(row) {
    setMessage("");
    setError("");
    setFormSensitiveState({
      iban: getSensitiveValueState(row?.iban, { hiddenWhenMissing: true }),
      accountNo: getSensitiveValueState(row?.account_no, { hiddenWhenMissing: true }),
    });
    setFormSensitivePreview({
      iban: String(row?.iban || ""),
      accountNo: String(row?.account_no || ""),
    });
    setForm(mapRowToForm(row));
    setAutoProvisionControlParent(false);
    setProvisionGlAccountName("");
    setGlAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
  }

  function buildCommonPayloadFromForm() {
    const legalEntityId = toPositiveInt(form.legalEntityId);
    const operatingUnitId = toPositiveInt(form.operatingUnitId);
    if (!legalEntityId) {
      throw new Error("legalEntityId is required");
    }
    const payload = {
      legalEntityId,
      operatingUnitId: operatingUnitId || undefined,
      code: String(form.code || "").trim(),
      name: String(form.name || "").trim(),
      currencyCode: String(form.currencyCode || "").trim().toUpperCase(),
      bankName: String(form.bankName || "").trim() || null,
      branchName: String(form.branchName || "").trim() || null,
      isActive: Boolean(form.isActive),
    };

    // Restricted values are rendered replacement-only in the form so operators
    // do not overwrite stored sensitive data with masked placeholders.
    const ibanValue = buildSensitiveUpdateValue(form.iban, formSensitiveState.iban);
    const accountNoValue = buildSensitiveUpdateValue(form.accountNo, formSensitiveState.accountNo);
    if (ibanValue !== undefined) {
      payload.iban = ibanValue;
    }
    if (accountNoValue !== undefined) {
      payload.accountNo = accountNoValue;
    }
    return payload;
  }

  function buildCreatePayloadFromForm() {
    const base = buildCommonPayloadFromForm();
    const glAccountId = toPositiveInt(form.glAccountId);
    if (!glAccountId) {
      throw new Error("glAccountId is required");
    }
    return {
      ...base,
      glAccountId,
    };
  }

  function buildProvisionPayloadFromForm() {
    const base = buildCommonPayloadFromForm();
    const glAccountName = String(provisionGlAccountName || "").trim();
    return {
      ...base,
      glAccountName: glAccountName || undefined,
    };
  }

  async function handleCreateInlineChildGlAccount() {
    if (!canUpsertAccounts) {
      setError("Missing permission: gl.account.upsert");
      return;
    }
    if (!selectedLegalEntityId) {
      setError("legalEntityId is required");
      return;
    }

    const parentAccountId = toPositiveInt(inlineChildParentAccountId);
    const parentAccount =
      parentAccountOptions.find((row) => getAccountId(row) === parentAccountId) || null;
    if (!parentAccountId || !parentAccount) {
      setError("Parent account is required");
      return;
    }

    const childCode = normalizeAccountCode(inlineChildCode || glAccountCodeCandidate);
    const childName = String(inlineChildName || "").trim();
    if (!childCode) {
      setError("Child account code is required");
      return;
    }
    if (!childName) {
      setError("Child account name is required");
      return;
    }

    const parentCode = getAccountCode(parentAccount);
    if (parentCode && childCode === parentCode) {
      setError("Child account code must differ from parent account code");
      return;
    }

    const existingAccount = selectedEntityAccountByCode.get(childCode) || null;
    const existingAccountId = getAccountId(existingAccount);
    if (existingAccountId && getAccountType(existingAccount) === "ASSET") {
      setForm((prev) => ({ ...prev, glAccountId: String(existingAccountId) }));
      setGlAccountLookupQuery("");
      setInlineChildParentAccountId("");
      setInlineChildCode("");
      setInlineChildName("");
      setError("");
      setMessage(`Existing account selected: ${childCode}`);
      return;
    }

    const coaId = getAccountCoaId(parentAccount);
    if (!coaId) {
      setError("Selected parent account has no coaId");
      return;
    }
    const normalSide = getAccountNormalSide(parentAccount) || "DEBIT";

    setInlineChildSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await upsertAccount({
        coaId,
        code: childCode,
        name: childName,
        accountType: "ASSET",
        normalSide,
        allowPosting: true,
        parentAccountId,
      });
      const responseId = toPositiveInt(response?.id ?? response?.row?.id);

      const accountsRes = await listAccounts({ includeInactive: true });
      const refreshedRows = accountsRes?.rows || [];
      setAccounts(refreshedRows);

      const resolvedRow =
        refreshedRows.find(
          (row) =>
            getAccountCode(row) === childCode &&
            getAccountType(row) === "ASSET" &&
            (selectedLegalEntityId ? getAccountLegalEntityId(row) === selectedLegalEntityId : true)
        ) || null;
      const resolvedId = responseId || getAccountId(resolvedRow);
      if (resolvedId) {
        setForm((prev) => ({ ...prev, glAccountId: String(resolvedId) }));
      }

      setGlAccountLookupQuery("");
      setInlineChildParentAccountId("");
      setInlineChildCode("");
      setInlineChildName("");
      setMessage(`Child account created: ${childCode} (parent ${parentCode || "-"})`);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Child account create failed");
    } finally {
      setInlineChildSaving(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canWrite) {
      setError("Missing permission: bank.accounts.write");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (form.id) {
        const payload = buildCreatePayloadFromForm();
        await updateBankAccount(form.id, payload);
        setMessage("Bank account updated");
      } else if (autoProvisionControlParent) {
        const payload = buildProvisionPayloadFromForm();
        const idempotencyKey = generateProvisionIdempotencyKey();
        const response = await provisionBankAccountControlParentChild(payload, { idempotencyKey });
        const provisionedCode = String(response?.glAccount?.code || "").trim();
        setMessage(
          provisionedCode
            ? `Bank account + control-parent child created (${provisionedCode})`
            : "Bank account + control-parent child created"
        );
      } else {
        const payload = buildCreatePayloadFromForm();
        await createBankAccount(payload);
        setMessage("Bank account created");
      }
      resetForm();
      await loadRows();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(row, nextActive) {
    if (!canWrite) {
      setError("Missing permission: bank.accounts.write");
      return;
    }

    const bankAccountId = toPositiveInt(row?.id);
    if (!bankAccountId) {
      setError("Invalid bankAccountId");
      return;
    }

    setStatusBusyId(bankAccountId);
    setError("");
    setMessage("");
    try {
      if (nextActive) {
        await activateBankAccount(bankAccountId);
        setMessage("Bank account activated");
      } else {
        await deactivateBankAccount(bankAccountId);
        setMessage("Bank account deactivated");
      }
      await loadRows();
      if (String(form.id || "") === String(bankAccountId)) {
        setForm((prev) => ({ ...prev, isActive: Boolean(nextActive) }));
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Status update failed");
    } finally {
      setStatusBusyId(null);
    }
  }

  async function handleConnectorTest(row) {
    if (!canSyncConnectors) {
      setConnectorError("Missing permission: bank.connectors.sync");
      return;
    }
    const connectorId = toPositiveInt(row?.id);
    if (!connectorId) {
      setConnectorError("Invalid connectorId");
      return;
    }
    setConnectorActionBusy((prev) => ({ ...prev, testId: connectorId }));
    setConnectorError("");
    setConnectorMessage("");
    try {
      const response = await testBankConnectorConnection(connectorId);
      setConnectorMessage(
        response?.result?.ok
          ? `Connector test ok (${row?.connector_code || connectorId})`
          : `Connector test completed (${row?.connector_code || connectorId})`
      );
      await loadConnectors();
    } catch (err) {
      setConnectorError(err?.response?.data?.message || "Connector test failed");
    } finally {
      setConnectorActionBusy((prev) => ({ ...prev, testId: null }));
    }
  }

  async function handleConnectorSync(row) {
    if (!canSyncConnectors) {
      setConnectorError("Missing permission: bank.connectors.sync");
      return;
    }
    const connectorId = toPositiveInt(row?.id);
    if (!connectorId) {
      setConnectorError("Invalid connectorId");
      return;
    }
    setConnectorActionBusy((prev) => ({ ...prev, syncId: connectorId }));
    setConnectorError("");
    setConnectorMessage("");
    try {
      const response = await syncBankConnectorStatements(connectorId, {});
      const syncStatus = response?.sync_run?.status || "DONE";
      setConnectorMessage(
        `Connector sync completed (${row?.connector_code || connectorId}) - ${syncStatus}`
      );
      await loadConnectors();
    } catch (err) {
      setConnectorError(err?.response?.data?.message || "Connector sync failed");
    } finally {
      setConnectorActionBusy((prev) => ({ ...prev, syncId: null }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Banka Tanimla</h1>
        <p className="mt-1 text-sm text-slate-600">
          Banka hesap ana verisi ve GL hesap baglantisi (PR-B01).
        </p>
      </div>

      {!canRead ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Missing permission: <code>bank.accounts.read</code>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {lookupWarning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {lookupWarning}
        </div>
      ) : null}
      <SensitiveFieldsNotice
        visible={showSensitiveBankNotice}
        title="Sensitive bank identifiers may be restricted on this page."
        description="Masked values follow row-scope visibility rules. If an edited IBAN or account number is restricted, leave the input blank to keep the stored value or enter a replacement."
        fieldSummary={bankMaskedFieldSummary}
      />

      {selectedLegalEntityId && selectedBankControlParentReadiness ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            selectedBankControlParentReadiness.ready
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="font-semibold">Bank control-parent readiness</div>
          {selectedBankControlParentReadiness.ready ? (
            <p className="mt-1">
              {configuredControlParentLabel
                ? `Configured bank control parent: ${configuredControlParentLabel}`
                : "BANK_CONTROL_PARENT is configured for this legal entity."}
            </p>
          ) : (
            <p className="mt-1">
              Configure <code>BANK_CONTROL_PARENT</code> in GL Setup before relying on
              control-parent provisioning. Manual bank creation can still use a selected GL child
              account.
            </p>
          )}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {form.id ? "Banka Hesabi Duzenle" : "Yeni Banka Hesabi"}
            </h2>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setError("");
                setMessage("");
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              disabled={saving}
            >
              Temizle
            </button>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Legal Entity</label>
              <select
                value={form.legalEntityId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    legalEntityId: event.target.value,
                    operatingUnitId: "",
                    glAccountId: "",
                  }))
                }
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                disabled={!canWrite || saving || !canReadOrgTree}
                required
              >
                <option value="">Secin</option>
                {legalEntityOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Code</label>
                <input
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="BANK_TRY_MAIN"
                  disabled={!canWrite || saving}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Currency</label>
                <select
                  value={form.currencyCode}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, currencyCode: event.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving || !canReadOrgTree}
                  required
                >
                  <option value="">Secin</option>
                  {currencyOptions.map((row) => (
                    <option key={row.code} value={row.code}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Ana Banka Hesabi"
                disabled={!canWrite || saving}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Operating Unit (Optional)
              </label>
              <select
                value={form.operatingUnitId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                }
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                disabled={!canWrite || saving || !canReadOrgTree}
              >
                <option value="">Secin (Opsiyonel)</option>
                {operatingUnitOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
            </div>

            {!form.id ? (
              <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-cyan-900">
                  <input
                    type="checkbox"
                    checked={autoProvisionControlParent}
                    onChange={(event) => {
                      const nextChecked = event.target.checked;
                      setAutoProvisionControlParent(nextChecked);
                      if (nextChecked) {
                        setForm((prev) => ({ ...prev, glAccountId: "" }));
                      }
                    }}
                    disabled={!canWrite || saving}
                  />
                  Auto-create a bank control-parent child GL account and link automatically
                </label>
                <p className="mt-1 text-xs text-cyan-800">
                  Uses one-click provisioning under the configured bank control parent
                  {configuredControlParentLabel ? ` (${configuredControlParentLabel})` : ""}.
                </p>
                {autoProvisionControlParent ? (
                  <div className="mt-2">
                    <label className="mb-1 block text-xs font-medium text-cyan-900">
                      Child GL Name (Optional)
                    </label>
                    <input
                      value={provisionGlAccountName}
                      onChange={(event) => setProvisionGlAccountName(event.target.value)}
                      className="w-full rounded border border-cyan-300 bg-white px-2 py-1.5 text-sm"
                      placeholder="If empty, bank account name is used"
                      disabled={!canWrite || saving}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">GL Account</label>
              {canReadAccounts ? (
                <div className="space-y-2">
                  <Combobox
                    value={form.glAccountId || null}
                    options={glAccountLookupOptions}
                    disabled={
                      !canWrite ||
                      saving ||
                      !selectedLegalEntityId ||
                      (!form.id && autoProvisionControlParent)
                    }
                    placeholder={
                      !selectedLegalEntityId
                        ? "Select legal entity first"
                        : !form.id && autoProvisionControlParent
                          ? "Auto-provisioning enabled (manual select disabled)"
                          : "Search GL account code/name"
                    }
                    noOptionsText="No GL accounts found."
                    onInputChange={(nextValue, meta) => {
                      const reason = String(meta?.reason || "").trim().toLowerCase();
                      if (reason === "input" || reason === "clear") {
                        setGlAccountLookupQuery(nextValue);
                        setInlineChildParentAccountId("");
                        setInlineChildCode("");
                        setInlineChildName(String(nextValue || "").trim());
                      }
                    }}
                    onChange={(nextValue) => {
                      setForm((prev) => ({
                        ...prev,
                        glAccountId: nextValue ? String(nextValue) : "",
                      }));
                      setGlAccountLookupQuery("");
                      setInlineChildParentAccountId("");
                      setInlineChildCode("");
                      setInlineChildName("");
                    }}
                  />
                  {showInlineChildCreate ? (
                    <div className="space-y-2 rounded-md border border-cyan-200 bg-cyan-50 p-2">
                      <p className="text-xs text-cyan-800">
                        No exact account found for "
                        {String(glAccountCodeCandidate || glAccountLookupQuery || "").trim()}".
                        Create a child account below.
                      </p>
                      <Combobox
                        value={inlineChildParentAccountId || null}
                        options={parentAccountLookupOptions}
                        disabled={saving || inlineChildSaving}
                        placeholder="Select parent account"
                        noOptionsText="No parent accounts found."
                        onChange={(nextValue) =>
                          setInlineChildParentAccountId(nextValue ? String(nextValue) : "")
                        }
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={inlineChildCode}
                          onChange={(event) =>
                            setInlineChildCode(normalizeAccountCode(event.target.value))
                          }
                          className="rounded border border-cyan-300 bg-white px-2 py-1.5 text-xs"
                          placeholder="Child account code"
                          maxLength={60}
                        />
                        <input
                          value={inlineChildName}
                          onChange={(event) => setInlineChildName(event.target.value)}
                          className="rounded border border-cyan-300 bg-white px-2 py-1.5 text-xs"
                          placeholder="New child account name"
                          maxLength={255}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setInlineChildCode(glAccountCodeCandidate)}
                          disabled={!glAccountCodeCandidate}
                          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100"
                        >
                          Use searched code
                        </button>
                        <button
                          type="button"
                          onClick={() => setInlineChildCode(suggestedNextChildCode)}
                          disabled={!suggestedNextChildCode || !selectedInlineParentAccount}
                          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                        >
                          Use next child code
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateInlineChildGlAccount}
                          disabled={inlineChildSaving || saving || !canUpsertAccounts}
                          className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                        >
                          {inlineChildSaving ? "Creating child..." : "Create child account"}
                        </button>
                      </div>
                      {!canUpsertAccounts ? (
                        <p className="text-[11px] text-amber-700">
                          Missing permission: gl.account.upsert
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <input
                  type="number"
                  min="1"
                  value={form.glAccountId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, glAccountId: event.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving || (!form.id && autoProvisionControlParent)}
                  required={form.id || !autoProvisionControlParent}
                />
              )}
              <p className="mt-1 text-xs text-slate-500">
                {!form.id && autoProvisionControlParent
                  ? "GL account is generated automatically under the configured bank control parent."
                  : "Only ACTIVE, postable, LEGAL_ENTITY-scoped ASSET accounts are listed. In strict mode, the selected account must be a child under the configured bank control parent."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Bank Name</label>
                <input
                  value={form.bankName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, bankName: event.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Branch Name</label>
                <input
                  value={form.branchName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, branchName: event.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">IBAN</label>
                <input
                  value={form.iban}
                  onChange={(event) => setForm((prev) => ({ ...prev, iban: event.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving}
                  placeholder={
                    isRestrictedSensitiveState(formSensitiveState.iban)
                      ? "Enter new IBAN only if you want to replace the stored value"
                      : ""
                  }
                />
                <SensitiveFieldEditHint
                  fieldLabel="IBAN"
                  state={formSensitiveState.iban}
                  previewValue={formSensitivePreview.iban}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Account No</label>
                <input
                  value={form.accountNo}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, accountNo: event.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={!canWrite || saving}
                  placeholder={
                    isRestrictedSensitiveState(formSensitiveState.accountNo)
                      ? "Enter new account number only if you want to replace the stored value"
                      : ""
                  }
                />
                <SensitiveFieldEditHint
                  fieldLabel="Account number"
                  state={formSensitiveState.accountNo}
                  previewValue={formSensitivePreview.accountNo}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form.isActive)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                }
                disabled={!canWrite || saving}
              />
              Active
            </label>

            <button
              type="submit"
              disabled={!canWrite || saving}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Kaydediliyor..."
                : form.id
                  ? "Guncelle"
                  : autoProvisionControlParent
                    ? "Olustur (Kontrol Parent Otomatik)"
                    : "Olustur"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Banka Hesaplari</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadRows(filters)}
                disabled={loading || !canRead}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
              >
                {loading ? "Yukleniyor..." : "Filtrele"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const reset = { legalEntityId: "", operatingUnitId: "", isActive: "" };
                  setFilters(reset);
                  loadRows(reset);
                }}
                disabled={loading || !canRead}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
              >
                Temizle
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <select
              value={filters.legalEntityId}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                  operatingUnitId: "",
                }))
              }
              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
              disabled={!canRead || !canReadOrgTree}
            >
              <option value="">Tum Legal Entity</option>
              {legalEntityOptions.map((row) => (
                <option key={`filter-le-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>

            <select
              value={filters.operatingUnitId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, operatingUnitId: event.target.value }))
              }
              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
              disabled={!canRead || !canReadOrgTree}
            >
              <option value="">Tum Operating Unit</option>
              {filterOperatingUnitOptions.map((row) => (
                <option key={`filter-ou-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>

            <select
              value={filters.isActive}
              onChange={(event) => setFilters((prev) => ({ ...prev, isActive: event.target.value }))}
              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
              disabled={!canRead}
            >
              <option value="">Tum Durumlar</option>
              <option value="true">ACTIVE</option>
              <option value="false">INACTIVE</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">LE</th>
                  <th className="px-2 py-2">OU</th>
                  <th className="px-2 py-2">Currency</th>
                  <th className="px-2 py-2">GL</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowId = toPositiveInt(row?.id);
                  const active = parseDbBoolean(row?.is_active);
                  return (
                    <tr key={rowId || row.code} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2 font-medium text-slate-800">{row.code}</td>
                      <td className="px-2 py-2 text-slate-700">
                        <div>{row.name}</div>
                        {(row.bank_name || row.branch_name) && (
                          <div className="text-xs text-slate-500">
                            {[row.bank_name, row.branch_name].filter(Boolean).join(" / ")}
                          </div>
                        )}
                        <div className="mt-1 space-y-1 text-xs">
                          <div className="flex flex-wrap items-center gap-2 text-slate-500">
                            <span className="min-w-10 uppercase tracking-wide text-slate-400">IBAN</span>
                            <SensitiveFieldValue value={row.iban} hiddenWhenMissing monospace />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-slate-500">
                            <span className="min-w-10 uppercase tracking-wide text-slate-400">Acct</span>
                            <SensitiveFieldValue
                              value={row.account_no}
                              hiddenWhenMissing
                              monospace
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-slate-700">
                        {row.legal_entity_code || "-"}
                        {row.legal_entity_name ? (
                          <div className="text-xs text-slate-500">{row.legal_entity_name}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-700">
                        {row.operating_unit_id
                          ? `${row.operating_unit_code || row.operating_unit_id}${
                              row.operating_unit_name ? ` - ${row.operating_unit_name}` : ""
                            }`
                          : "-"}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{row.currency_code}</td>
                      <td className="px-2 py-2 text-slate-700">
                        {row.gl_account_code || "-"}
                        {row.gl_account_name ? (
                          <div className="text-xs text-slate-500">{row.gl_account_name}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            disabled={!canWrite || saving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusChange(row, !active)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            disabled={!canWrite || statusBusyId === rowId}
                          >
                            {statusBusyId === rowId
                              ? "..."
                              : active
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-sm text-slate-500">
                      {loading ? "Yukleniyor..." : "Banka hesabi bulunamadi."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Bank Connectors (B05)</h2>
            <p className="mt-1 text-xs text-slate-600">
              Live bank connectivity adapter list + test/sync actions. Connector CRUD/mapping APIs are
              ready under <code>/api/v1/bank/connectors</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={loadConnectors}
            disabled={!canReadConnectors || connectorLoading}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
          >
            {connectorLoading ? "Yukleniyor..." : "Yenile"}
          </button>
        </div>

        {!canReadConnectors ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Missing permission: <code>bank.connectors.read</code>
          </div>
        ) : null}

        {connectorError ? (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {connectorError}
          </div>
        ) : null}

        {connectorMessage ? (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {connectorMessage}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Provider</th>
                <th className="px-2 py-2">LE</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Sync</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connectorRows.map((row) => {
                const connectorId = toPositiveInt(row?.id);
                const testBusy = connectorActionBusy.testId === connectorId;
                const syncBusy = connectorActionBusy.syncId === connectorId;
                return (
                  <tr key={connectorId || row.connector_code} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-800">{row.connector_code}</div>
                      <div className="text-xs text-slate-500">{row.connector_name}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      <div>{row.provider_code}</div>
                      <div className="text-xs text-slate-500">{row.connector_type}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {row.legal_entity_code || "-"}
                      {row.legal_entity_name ? (
                        <div className="text-xs text-slate-500">{row.legal_entity_name}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                        {row.status || "-"}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">
                        Links: {Number(row.account_link_count || 0)}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      <div>{row.sync_mode || "-"}</div>
                      {row.last_sync_at ? <div>Last: {String(row.last_sync_at)}</div> : null}
                      {row.next_sync_at ? <div>Next: {String(row.next_sync_at)}</div> : null}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleConnectorTest(row)}
                          disabled={!canSyncConnectors || testBusy || syncBusy}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                        >
                          {testBusy ? "..." : "Test"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConnectorSync(row)}
                          disabled={!canSyncConnectors || testBusy || syncBusy}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                        >
                          {syncBusy ? "..." : "Sync Now"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {connectorRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-sm text-slate-500">
                    {connectorLoading ? "Yukleniyor..." : "Connector bulunamadi (B05)."}
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
