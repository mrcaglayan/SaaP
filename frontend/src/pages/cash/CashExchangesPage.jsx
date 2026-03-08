import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCashExchangeBatch,
  getCashExchangeBatch,
  listCashExchangeBatches,
  listCashRegisters,
  postCashExchangeBatch,
  reverseCashExchangeBatch,
} from "../../api/cashAdmin.js";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import { listJournalPurposeAccounts } from "../../api/glPurposeMappings.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import Combobox from "../../components/Combobox.jsx";
import MoneyText from "../../components/MoneyText.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import { resolveContextBaseCurrencyCode } from "../../utils/money.js";
import CashControlModeBanner from "./CashControlModeBanner.jsx";

const EXCHANGE_STATUSES = ["DRAFT", "POSTED", "REVERSED", "CANCELLED"];
const CASH_EXCHANGE_CLEARING_PURPOSE_CODE = "CASH_EXCHANGE_CLEARING";
const EXCHANGE_POSTING_MODE_CLEARING = "CLEARING";
const EXCHANGE_POSTING_MODE_DIRECT = "DIRECT";

const INITIAL_FILTERS = {
  legalEntityId: "",
  sourceRegisterId: "",
  targetRegisterId: "",
  status: "",
  createdDateFrom: "",
  createdDateTo: "",
};

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

function generateIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `cash-exchange-${globalThis.crypto.randomUUID()}`;
  }
  return `cash-exchange-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildCreateDefaultForm() {
  return {
    sourceRegisterId: "",
    targetRegisterId: "",
    sourceCashSessionId: "",
    targetCashSessionId: "",
    postingMode: EXCHANGE_POSTING_MODE_CLEARING,
    clearingAccountId: "",
    sourceAmountTxn: "",
    targetAmountTxn: "",
    txnDatetime: toDateTimeLocalInput(),
    bookDate: todayIsoDate(),
    fxRate: "",
    fxRateSource: "",
    fxRateDate: "",
    providerRef: "",
    feeAmountTxn: "",
    feeAmountBase: "",
    feeAccountId: "",
    spreadReferenceRate: "",
    spreadRateDelta: "",
    spreadAmountBase: "",
    description: "",
    referenceNo: "",
    note: "",
    idempotencyKey: generateIdempotencyKey(),
  };
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalPositiveNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeExchangePostingMode(value) {
  return toUpper(value) === EXCHANGE_POSTING_MODE_DIRECT
    ? EXCHANGE_POSTING_MODE_DIRECT
    : EXCHANGE_POSTING_MODE_CLEARING;
}

function isDirectExchangePostingMode(value) {
  return normalizeExchangePostingMode(value) === EXCHANGE_POSTING_MODE_DIRECT;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function toRegisterLabel(row) {
  return `${row?.code || row?.id || "-"} - ${row?.name || "-"}`;
}

function toLegalEntityLabel(row) {
  return `${row?.code || row?.id || "-"} - ${row?.name || "-"}`;
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeAccountCode(value) {
  return String(value || "").trim().toUpperCase();
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

function formatAccountSummary(code, name, id) {
  const parts = [String(code || "").trim(), String(name || "").trim()].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" - ");
  }
  const resolvedId = toPositiveInt(id);
  return resolvedId ? `#${resolvedId}` : "-";
}

function buildPurposeMappingMap(rows) {
  const byPurposeCode = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const purposeCode = toUpper(row?.purposeCode || row?.purpose_code);
    if (!purposeCode) {
      continue;
    }
    byPurposeCode[purposeCode] = row;
  }
  return byPurposeCode;
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

function statusClassName(status) {
  const normalized = toUpper(status);
  if (normalized === "POSTED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "DRAFT") {
    return "bg-sky-100 text-sky-700";
  }
  if (normalized === "REVERSED") {
    return "bg-violet-100 text-violet-700";
  }
  if (normalized === "CANCELLED") {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-slate-200 text-slate-700";
}

function extractErrorMessage(error, fallback) {
  return String(error?.response?.data?.message || error?.message || fallback);
}

function extractRequestId(error) {
  return (
    error?.response?.data?.requestId ||
    error?.response?.headers?.["x-request-id"] ||
    null
  );
}

function resolveStoredFxRate(row) {
  const directRate = Number(row?.fxRate);
  if (Number.isFinite(directRate) && directRate > 0) {
    return directRate;
  }
  const sourceAmount = Number(row?.sourceAmountTxn);
  const targetAmount = Number(row?.targetAmountTxn);
  if (Number.isFinite(sourceAmount) && sourceAmount > 0 && Number.isFinite(targetAmount) && targetAmount > 0) {
    return Number((targetAmount / sourceAmount).toFixed(10));
  }
  return null;
}

function buildFxDisplay(row, mode) {
  const storedRate = resolveStoredFxRate(row);
  if (!storedRate) {
    return null;
  }
  const sourceCurrencyCode = toUpper(row?.sourceCurrencyCode);
  const targetCurrencyCode = toUpper(row?.targetCurrencyCode);
  if (!sourceCurrencyCode || !targetCurrencyCode) {
    return null;
  }

  if (mode === "TARGET_TO_SOURCE") {
    return {
      baseCurrencyCode: targetCurrencyCode,
      quoteCurrencyCode: sourceCurrencyCode,
      rate: Number((1 / storedRate).toFixed(10)),
    };
  }

  return {
    baseCurrencyCode: sourceCurrencyCode,
    quoteCurrencyCode: targetCurrencyCode,
    rate: Number(storedRate.toFixed(10)),
  };
}

export default function CashExchangesPage() {
  const { hasPermission } = useAuth();
  const { t } = useI18n();
  const canRead = hasPermission("cash.txn.read");
  const canCreate = hasPermission("cash.txn.create");
  const canReverse = hasPermission("cash.txn.reverse");
  const canUpsertAccounts = hasPermission("gl.account.upsert");

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [rows, setRows] = useState([]);
  const [registerRows, setRegisterRows] = useState([]);
  const [legalEntityRows, setLegalEntityRows] = useState([]);
  const [accountRows, setAccountRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [postSubmittingBatchId, setPostSubmittingBatchId] = useState(null);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [warning, setWarning] = useState("");
  const [message, setMessage] = useState("");
  const [createForm, setCreateForm] = useState(() => buildCreateDefaultForm());
  const [cashPurposeMappingsByPurpose, setCashPurposeMappingsByPurpose] = useState({});
  const [clearingAccountLookupQuery, setClearingAccountLookupQuery] = useState("");
  const [clearingInlineChildParentAccountId, setClearingInlineChildParentAccountId] =
    useState("");
  const [clearingInlineChildCode, setClearingInlineChildCode] = useState("");
  const [clearingInlineChildName, setClearingInlineChildName] = useState("");
  const [clearingInlineChildSaving, setClearingInlineChildSaving] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState(null);
  const [postSourceSessionByBatchId, setPostSourceSessionByBatchId] = useState({});
  const [postTargetSessionByBatchId, setPostTargetSessionByBatchId] = useState({});
  const [reverseReasonByBatchId, setReverseReasonByBatchId] = useState({});
  const [fxDisplayMode, setFxDisplayMode] = useState("TARGET_TO_SOURCE");
  const lastSuggestedClearingAccountIdRef = useRef(null);

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedCreateSourceRegisterId = toPositiveInt(createForm.sourceRegisterId);

  const selectedSourceRegister = useMemo(
    () =>
      registerRows.find((row) => toPositiveInt(row?.id) === selectedCreateSourceRegisterId) ||
      null,
    [registerRows, selectedCreateSourceRegisterId]
  );

  const selectedCreateLegalEntityId = toPositiveInt(selectedSourceRegister?.legal_entity_id);
  const createPostingMode = normalizeExchangePostingMode(createForm.postingMode);
  const createIsDirectPostingMode = createPostingMode === EXCHANGE_POSTING_MODE_DIRECT;

  const legalEntityOptions = useMemo(() => {
    const map = new Map();
    for (const row of registerRows) {
      const legalEntityId = toPositiveInt(row?.legal_entity_id);
      if (!legalEntityId || map.has(legalEntityId)) {
        continue;
      }
      map.set(legalEntityId, {
        id: legalEntityId,
        code: row?.legal_entity_code || String(legalEntityId),
        name: row?.legal_entity_name || "-",
      });
    }
    return [...map.values()].sort((a, b) =>
      String(a.code || "").localeCompare(String(b.code || ""))
    );
  }, [registerRows]);

  const registerOptions = useMemo(() => {
    return registerRows
      .filter((row) => {
        if (!selectedLegalEntityId) {
          return true;
        }
        return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
      })
      .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || "")));
  }, [registerRows, selectedLegalEntityId]);

  const createRegisterOptions = useMemo(() => {
    return [...registerRows].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [registerRows]);

  const accountOptions = useMemo(() => {
    return accountRows
      .filter((row) => {
        const allowPosting =
          row?.allow_posting === 1 || row?.allowPosting === true || row?.allow_posting === true;
        const isActive = row?.is_active === 1 || row?.isActive === true || row?.is_active === true;
        if (!allowPosting || !isActive) {
          return false;
        }
        if (!selectedCreateLegalEntityId) {
          return true;
        }
        return toPositiveInt(row?.legal_entity_id || row?.legalEntityId) === selectedCreateLegalEntityId;
      })
      .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || "")));
  }, [accountRows, selectedCreateLegalEntityId]);

  const selectedClearingAccountId = toPositiveInt(createForm.clearingAccountId);
  const defaultExchangeClearingAccountId = toPositiveInt(
    cashPurposeMappingsByPurpose[CASH_EXCHANGE_CLEARING_PURPOSE_CODE]?.accountId ||
      cashPurposeMappingsByPurpose[CASH_EXCHANGE_CLEARING_PURPOSE_CODE]?.account_id
  );
  const selectedClearingAccountOption = useMemo(
    () =>
      resolveSelectedAccountOption(accountOptions, accountRows, selectedClearingAccountId),
    [accountOptions, accountRows, selectedClearingAccountId]
  );
  const selectedClearingAccountLegalEntityId = toPositiveInt(
    selectedClearingAccountOption?.legal_entity_id ?? selectedClearingAccountOption?.legalEntityId
  );
  const clearingAccountPickerRows = useMemo(
    () => buildAccountPickerRows(accountOptions, selectedClearingAccountOption),
    [accountOptions, selectedClearingAccountOption]
  );
  const clearingAccountLookupOptions = useMemo(
    () => buildAccountLookupOptions(clearingAccountPickerRows),
    [clearingAccountPickerRows]
  );
  const selectedFeeAccountId = toPositiveInt(createForm.feeAccountId);
  const selectedFeeAccountOption = useMemo(
    () => resolveSelectedAccountOption(accountOptions, accountRows, selectedFeeAccountId),
    [accountOptions, accountRows, selectedFeeAccountId]
  );
  const selectedFeeAccountLegalEntityId = toPositiveInt(
    selectedFeeAccountOption?.legal_entity_id ?? selectedFeeAccountOption?.legalEntityId
  );
  const detailBatch = selectedBatchDetail?.batch || null;
  const detailBaseCurrencyCode = resolveContextBaseCurrencyCode({
    legalEntityRows,
    legalEntityId: detailBatch?.legalEntityId || detailBatch?.legal_entity_id,
  });

  const parentAccountOptions = useMemo(() => {
    const filtered = accountRows.filter((row) => {
      const isActive = parseDbBoolean(row?.is_active ?? row?.isActive);
      if (!isActive) {
        return false;
      }
      if (!selectedCreateLegalEntityId) {
        return true;
      }
      return (
        toPositiveInt(row?.legal_entity_id ?? row?.legalEntityId) ===
        selectedCreateLegalEntityId
      );
    });
    return [...filtered].sort((a, b) =>
      String(a?.code || "").localeCompare(String(b?.code || ""))
    );
  }, [accountRows, selectedCreateLegalEntityId]);

  const parentAccountLookupOptions = useMemo(
    () =>
      parentAccountOptions.map((row) => ({
        value: String(row?.id || ""),
        label: formatAccountOptionLabel(row),
        description: [
          normalizeAccountCode(row?.account_type),
          normalizeAccountCode(row?.normal_side),
        ]
          .filter(Boolean)
          .join(" | "),
      })),
    [parentAccountOptions]
  );

  const selectedEntityAccountByCode = useMemo(() => {
    const byCode = new Map();
    for (const row of accountRows) {
      if (
        selectedCreateLegalEntityId &&
        toPositiveInt(row?.legal_entity_id ?? row?.legalEntityId) !==
          selectedCreateLegalEntityId
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
  }, [accountRows, selectedCreateLegalEntityId]);

  const clearingSearchCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(clearingAccountLookupQuery),
    [clearingAccountLookupQuery]
  );
  const exactClearingCodeMatchAccount = useMemo(
    () =>
      clearingSearchCodeCandidate
        ? selectedEntityAccountByCode.get(clearingSearchCodeCandidate) || null
        : null,
    [clearingSearchCodeCandidate, selectedEntityAccountByCode]
  );
  const showInlineClearingChildCreate =
    Boolean(String(clearingAccountLookupQuery || "").trim()) &&
    !exactClearingCodeMatchAccount;

  const selectedClearingInlineParentAccount = useMemo(() => {
    const parentAccountId = toPositiveInt(clearingInlineChildParentAccountId);
    if (!parentAccountId) {
      return null;
    }
    return (
      parentAccountOptions.find((row) => toPositiveInt(row?.id) === parentAccountId) ||
      null
    );
  }, [clearingInlineChildParentAccountId, parentAccountOptions]);

  const suggestedNextClearingChildCode = useMemo(
    () => buildNextChildAccountCode(accountRows, selectedClearingInlineParentAccount),
    [accountRows, selectedClearingInlineParentAccount]
  );

  const exchangeRows = useMemo(
    () => [...rows].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0)),
    [rows]
  );

  const loadBatchDetail = useCallback(
    async (batchId) => {
      const resolvedBatchId = toPositiveInt(batchId);
      if (!resolvedBatchId || !canRead) {
        setSelectedBatchDetail(null);
        return;
      }
      setDetailLoading(true);
      try {
        const detail = await getCashExchangeBatch(resolvedBatchId);
        setSelectedBatchDetail(detail || null);
      } catch (err) {
        setSelectedBatchDetail(null);
        setError(extractErrorMessage(err, "Cash exchange detail could not be loaded."));
        setErrorRequestId(extractRequestId(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [canRead]
  );

  const loadData = useCallback(
    async (nextFilters = INITIAL_FILTERS) => {
      if (!canRead) {
        setRows([]);
        setRegisterRows([]);
        setLegalEntityRows([]);
        setAccountRows([]);
        return;
      }

      setLoading(true);
      setError("");
      setErrorRequestId(null);
      setWarning("");

      const query = {
        legalEntityId: toPositiveInt(nextFilters.legalEntityId) || undefined,
        sourceRegisterId: toPositiveInt(nextFilters.sourceRegisterId) || undefined,
        targetRegisterId: toPositiveInt(nextFilters.targetRegisterId) || undefined,
        status: nextFilters.status || undefined,
        createdDateFrom: nextFilters.createdDateFrom || undefined,
        createdDateTo: nextFilters.createdDateTo || undefined,
        limit: 200,
        offset: 0,
      };

      const [exchangeResult, registerResult, legalEntityResult, accountResult] =
        await Promise.allSettled([
        listCashExchangeBatches(query),
        listCashRegisters({ limit: 500, offset: 0 }),
        listLegalEntities(),
        listAccounts({ limit: 1000, offset: 0 }),
      ]);

      try {
        if (exchangeResult.status !== "fulfilled") {
          throw exchangeResult.reason;
        }

        const warnings = [];

        if (registerResult.status === "fulfilled") {
          setRegisterRows(Array.isArray(registerResult.value?.rows) ? registerResult.value.rows : []);
        } else {
          setRegisterRows([]);
          warnings.push(
            extractErrorMessage(registerResult.reason, "Cash register lookup is unavailable.")
          );
        }

        if (legalEntityResult.status === "fulfilled") {
          setLegalEntityRows(
            Array.isArray(legalEntityResult.value?.rows) ? legalEntityResult.value.rows : []
          );
        } else {
          setLegalEntityRows([]);
          warnings.push(
            extractErrorMessage(
              legalEntityResult.reason,
              "Legal entity currency lookup is unavailable."
            )
          );
        }

        if (accountResult.status === "fulfilled") {
          setAccountRows(Array.isArray(accountResult.value?.rows) ? accountResult.value.rows : []);
        } else {
          setAccountRows([]);
          warnings.push(extractErrorMessage(accountResult.reason, "GL account lookup is unavailable."));
        }

        const nextRows = Array.isArray(exchangeResult.value?.rows) ? exchangeResult.value.rows : [];
        setRows(nextRows);

        if (warnings.length > 0) {
          setWarning(warnings.join(" "));
        }
      } catch (err) {
        setRows([]);
        setError(extractErrorMessage(err, "Cash exchanges could not be loaded."));
        setErrorRequestId(extractRequestId(err));
      } finally {
        setLoading(false);
      }
    },
    [canRead]
  );

  useEffect(() => {
    loadData(INITIAL_FILTERS);
  }, [loadData]);

  useEffect(() => {
    if (!selectedBatchId) {
      setSelectedBatchDetail(null);
      return;
    }
    loadBatchDetail(selectedBatchId);
  }, [selectedBatchId, loadBatchDetail]);

  useEffect(() => {
    setClearingAccountLookupQuery("");
    setClearingInlineChildParentAccountId("");
    setClearingInlineChildCode("");
    setClearingInlineChildName("");
  }, [selectedCreateLegalEntityId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCashPurposeMappings() {
      if (!selectedCreateLegalEntityId) {
        setCashPurposeMappingsByPurpose({});
        return;
      }
      try {
        const response = await listJournalPurposeAccounts({
          legalEntityId: selectedCreateLegalEntityId,
          moduleKey: "CASH",
        });
        if (cancelled) {
          return;
        }
        setCashPurposeMappingsByPurpose(buildPurposeMappingMap(response?.rows || []));
      } catch {
        if (!cancelled) {
          setCashPurposeMappingsByPurpose({});
        }
      }
    }

    loadCashPurposeMappings();
    return () => {
      cancelled = true;
    };
  }, [selectedCreateLegalEntityId]);

  useEffect(() => {
    const previousSuggestedClearingAccountId = toPositiveInt(
      lastSuggestedClearingAccountIdRef.current
    );
    const nextSuggestedClearingAccountId = defaultExchangeClearingAccountId;

    if (!selectedCreateLegalEntityId) {
      lastSuggestedClearingAccountIdRef.current = null;
      return;
    }

    setCreateForm((prev) => {
      const currentClearingAccountId = toPositiveInt(prev.clearingAccountId);
      const currentBelongsToSelectedLegalEntity =
        !currentClearingAccountId ||
        selectedClearingAccountLegalEntityId === selectedCreateLegalEntityId;

      if (!currentBelongsToSelectedLegalEntity) {
        return {
          ...prev,
          clearingAccountId: nextSuggestedClearingAccountId
            ? String(nextSuggestedClearingAccountId)
            : "",
        };
      }

      if (!nextSuggestedClearingAccountId) {
        if (
          previousSuggestedClearingAccountId &&
          currentClearingAccountId === previousSuggestedClearingAccountId
        ) {
          return {
            ...prev,
            clearingAccountId: "",
          };
        }
        return prev;
      }

      if (
        !currentClearingAccountId ||
        (previousSuggestedClearingAccountId &&
          currentClearingAccountId === previousSuggestedClearingAccountId)
      ) {
        if (currentClearingAccountId === nextSuggestedClearingAccountId) {
          return prev;
        }
        return {
          ...prev,
          clearingAccountId: String(nextSuggestedClearingAccountId),
        };
      }

      return prev;
    });

    lastSuggestedClearingAccountIdRef.current = nextSuggestedClearingAccountId
      ? String(nextSuggestedClearingAccountId)
      : null;
  }, [
    defaultExchangeClearingAccountId,
    selectedClearingAccountLegalEntityId,
    selectedCreateLegalEntityId,
  ]);

  useEffect(() => {
    if (!selectedCreateLegalEntityId) {
      return;
    }
    setCreateForm((prev) => {
      const currentFeeAccountId = toPositiveInt(prev.feeAccountId);
      if (
        !currentFeeAccountId ||
        selectedFeeAccountLegalEntityId === selectedCreateLegalEntityId
      ) {
        return prev;
      }
      return {
        ...prev,
        feeAccountId: "",
      };
    });
  }, [selectedCreateLegalEntityId, selectedFeeAccountLegalEntityId]);

  useEffect(() => {
    if (!showInlineClearingChildCreate) {
      return;
    }
    setClearingInlineChildCode((prev) => prev || clearingSearchCodeCandidate);
    setClearingInlineChildName(
      (prev) => prev || String(clearingAccountLookupQuery || "").trim()
    );
  }, [
    showInlineClearingChildCreate,
    clearingSearchCodeCandidate,
    clearingAccountLookupQuery,
  ]);

  useEffect(() => {
    if (!showInlineClearingChildCreate || !suggestedNextClearingChildCode) {
      return;
    }
    setClearingInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(clearingSearchCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedNextClearingChildCode;
      }
      return prev;
    });
  }, [
    showInlineClearingChildCreate,
    suggestedNextClearingChildCode,
    clearingSearchCodeCandidate,
  ]);

  useEffect(() => {
    if (
      !showInlineClearingChildCreate ||
      toPositiveInt(clearingInlineChildParentAccountId)
    ) {
      return;
    }
    const candidateCode = normalizeAccountCode(
      clearingInlineChildCode || clearingSearchCodeCandidate
    );
    if (!candidateCode) {
      return;
    }
    const bestParent = findBestParentAccount(candidateCode, parentAccountOptions);
    if (toPositiveInt(bestParent?.id)) {
      setClearingInlineChildParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineClearingChildCreate,
    clearingInlineChildParentAccountId,
    clearingInlineChildCode,
    clearingSearchCodeCandidate,
    parentAccountOptions,
  ]);

  const getPostingModeLabel = useCallback(
    (value) =>
      normalizeExchangePostingMode(value) === EXCHANGE_POSTING_MODE_DIRECT
        ? t("cashExchanges.postingModes.direct", "DIRECT (safe-to-safe)")
        : t("cashExchanges.postingModes.clearing", "CLEARING (108.xx / staged)"),
    [t]
  );

  const getClearingUsageLabel = useCallback(
    (row) => {
      if (isDirectExchangePostingMode(row?.postingMode || row?.posting_mode)) {
        return t("cashExchanges.values.noClearing", "No clearing");
      }
      return formatAccountSummary(
        row?.clearingAccountCode || row?.clearing_account_code,
        row?.clearingAccountName || row?.clearing_account_name,
        row?.clearingAccountId || row?.clearing_account_id
      );
    },
    [t]
  );

  const getFeeAccountLabel = useCallback(
    (row) => {
      const summary = formatAccountSummary(
        row?.feeAccountCode || row?.fee_account_code,
        row?.feeAccountName || row?.fee_account_name,
        row?.feeAccountId || row?.fee_account_id
      );
      return summary === "-"
        ? t("cashExchanges.values.noCommissionAccount", "No commission account")
        : summary;
    },
    [t]
  );

  async function handleCreateClearingChildAccount() {
    if (!canUpsertAccounts) {
      setError("Missing permission: gl.account.upsert");
      setErrorRequestId(null);
      return;
    }
    if (!selectedCreateLegalEntityId) {
      setError("Select source register first to resolve legal entity.");
      setErrorRequestId(null);
      return;
    }

    const parentAccountId = toPositiveInt(clearingInlineChildParentAccountId);
    const parentAccount =
      parentAccountOptions.find((row) => toPositiveInt(row?.id) === parentAccountId) ||
      null;
    if (!parentAccountId || !parentAccount) {
      setError("Parent account is required.");
      setErrorRequestId(null);
      return;
    }

    const childCode = normalizeAccountCode(
      clearingInlineChildCode || clearingSearchCodeCandidate
    );
    const childName = String(clearingInlineChildName || "").trim();
    if (!childCode) {
      setError("Child account code is required.");
      setErrorRequestId(null);
      return;
    }
    if (!childName) {
      setError("Child account name is required.");
      setErrorRequestId(null);
      return;
    }

    const parentCode = normalizeAccountCode(parentAccount?.code);
    if (parentCode && childCode === parentCode) {
      setError("Child account code cannot be same as parent account code.");
      setErrorRequestId(null);
      return;
    }

    const existingAccount = selectedEntityAccountByCode.get(childCode) || null;
    const existingAccountId = toPositiveInt(existingAccount?.id);
    if (existingAccountId) {
      setCreateForm((prev) => ({ ...prev, clearingAccountId: String(existingAccountId) }));
      setClearingAccountLookupQuery("");
      setError("");
      setMessage(`Account ${childCode} already exists and was selected.`);
      return;
    }

    const coaId = toPositiveInt(parentAccount?.coa_id ?? parentAccount?.coaId);
    if (!coaId) {
      setError("Selected parent account has no valid CoA.");
      setErrorRequestId(null);
      return;
    }

    const accountType = normalizeAccountCode(
      parentAccount?.account_type ?? parentAccount?.accountType
    ) || "ASSET";
    const normalSide = normalizeAccountCode(
      parentAccount?.normal_side ?? parentAccount?.normalSide
    ) || "DEBIT";

    setClearingInlineChildSaving(true);
    setError("");
    setErrorRequestId(null);
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
        limit: 1000,
        offset: 0,
      });
      const refreshedRows = Array.isArray(refreshResponse?.rows)
        ? refreshResponse.rows
        : [];
      setAccountRows(refreshedRows);

      const resolvedRow =
        refreshedRows.find((row) => normalizeAccountCode(row?.code) === childCode) ||
        null;
      const resolvedId = responseId || toPositiveInt(resolvedRow?.id);
      if (resolvedId) {
        setCreateForm((prev) => ({ ...prev, clearingAccountId: String(resolvedId) }));
      }
      setClearingAccountLookupQuery("");
      setClearingInlineChildCode("");
      setClearingInlineChildName("");
      setMessage(`Clearing sub account ${childCode} created and selected.`);
    } catch (err) {
      setError(extractErrorMessage(err, "Clearing sub account could not be created."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setClearingInlineChildSaving(false);
    }
  }

  function handleSelectBatch(batchId) {
    const resolvedBatchId = toPositiveInt(batchId);
    setSelectedBatchId(resolvedBatchId);
  }

  function handleApplyFilters(event) {
    event.preventDefault();
    if (
      filters.createdDateFrom &&
      filters.createdDateTo &&
      filters.createdDateFrom > filters.createdDateTo
    ) {
      setError("createdDateFrom cannot be greater than createdDateTo.");
      setErrorRequestId(null);
      return;
    }
    setMessage("");
    loadData(filters);
  }

  function handleClearFilters() {
    setFilters(INITIAL_FILTERS);
    setMessage("");
    setError("");
    setErrorRequestId(null);
    loadData(INITIAL_FILTERS);
  }

  async function handleCreateExchange(event) {
    event.preventDefault();
    if (!canCreate) {
      setError(t("cashExchanges.errors.missingCreatePermission", "Missing permission: cash.txn.create"));
      setErrorRequestId(null);
      return;
    }

    const sourceRegisterId = toPositiveInt(createForm.sourceRegisterId);
    const targetRegisterId = toPositiveInt(createForm.targetRegisterId);
    const postingMode = normalizeExchangePostingMode(createForm.postingMode);
    const clearingAccountId = toPositiveInt(createForm.clearingAccountId);
    const sourceAmountTxn = toOptionalPositiveNumber(createForm.sourceAmountTxn);
    const targetAmountTxn = toOptionalPositiveNumber(createForm.targetAmountTxn);
    const fxRate = toOptionalPositiveNumber(createForm.fxRate);
    const feeAmountTxn = toOptionalPositiveNumber(createForm.feeAmountTxn);
    const feeAmountBase = toOptionalPositiveNumber(createForm.feeAmountBase);
    const feeAccountId = toPositiveInt(createForm.feeAccountId);
    const spreadReferenceRate = toOptionalPositiveNumber(createForm.spreadReferenceRate);
    const spreadAmountBase = toOptionalPositiveNumber(createForm.spreadAmountBase);
    const spreadRateDelta =
      createForm.spreadRateDelta === undefined ||
      createForm.spreadRateDelta === null ||
      createForm.spreadRateDelta === ""
        ? undefined
        : Number(createForm.spreadRateDelta);

    if (!sourceRegisterId || !targetRegisterId) {
      setError(
        t(
          "cashExchanges.errors.registersRequired",
          "sourceRegisterId and targetRegisterId are required."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (sourceRegisterId === targetRegisterId) {
      setError(
        t(
          "cashExchanges.errors.registersMustDiffer",
          "sourceRegisterId and targetRegisterId must be different."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (!sourceAmountTxn || Number.isNaN(sourceAmountTxn) || !targetAmountTxn || Number.isNaN(targetAmountTxn)) {
      setError(
        t(
          "cashExchanges.errors.amountsRequired",
          "sourceAmountTxn and targetAmountTxn must be positive numbers."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (!String(createForm.idempotencyKey || "").trim()) {
      setError(t("cashExchanges.errors.idempotencyRequired", "idempotencyKey is required."));
      setErrorRequestId(null);
      return;
    }
    if (fxRate !== null && Number.isNaN(fxRate)) {
      setError(t("cashExchanges.errors.fxRateInvalid", "FX rate must be a positive number."));
      setErrorRequestId(null);
      return;
    }
    if (feeAmountTxn !== null && Number.isNaN(feeAmountTxn)) {
      setError(
        t(
          "cashExchanges.errors.commissionAmountTxnInvalid",
          "Commission amount (txn) must be a positive number."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (feeAmountBase !== null && Number.isNaN(feeAmountBase)) {
      setError(
        t(
          "cashExchanges.errors.commissionAmountBaseInvalid",
          "Commission amount (base) must be a positive number."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (spreadReferenceRate !== null && Number.isNaN(spreadReferenceRate)) {
      setError(
        t(
          "cashExchanges.errors.spreadReferenceRateInvalid",
          "Spread reference rate must be a positive number."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (spreadAmountBase !== null && Number.isNaN(spreadAmountBase)) {
      setError(
        t(
          "cashExchanges.errors.spreadAmountBaseInvalid",
          "Spread amount (base) must be a positive number."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (spreadRateDelta !== undefined && !Number.isFinite(spreadRateDelta)) {
      setError(
        t(
          "cashExchanges.errors.spreadRateDeltaInvalid",
          "Spread rate delta must be numeric."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (feeAmountTxn && !feeAccountId) {
      setError(
        t(
          "cashExchanges.errors.commissionAccountRequired",
          "Commission account is required when commission amount is provided."
        )
      );
      setErrorRequestId(null);
      return;
    }
    if (!feeAmountTxn && feeAccountId) {
      setError(
        t(
          "cashExchanges.errors.commissionAmountRequired",
          "Commission amount is required when commission account is provided."
        )
      );
      setErrorRequestId(null);
      return;
    }

    const payload = {
      sourceRegisterId,
      targetRegisterId,
      postingMode,
      sourceCashSessionId: toPositiveInt(createForm.sourceCashSessionId) || undefined,
      targetCashSessionId: toPositiveInt(createForm.targetCashSessionId) || undefined,
      clearingAccountId:
        postingMode === EXCHANGE_POSTING_MODE_CLEARING
          ? clearingAccountId || undefined
          : undefined,
      txnDatetime: createForm.txnDatetime || undefined,
      bookDate: createForm.bookDate || undefined,
      sourceAmountTxn,
      targetAmountTxn,
      fxRate: fxRate || undefined,
      fxRateSource: String(createForm.fxRateSource || "").trim() || undefined,
      fxRateDate: createForm.fxRateDate || undefined,
      providerRef: String(createForm.providerRef || "").trim() || undefined,
      feeAmountTxn: feeAmountTxn || undefined,
      feeAmountBase: feeAmountBase || undefined,
      feeAccountId: feeAccountId || undefined,
      spreadReferenceRate: spreadReferenceRate || undefined,
      spreadRateDelta,
      spreadAmountBase: spreadAmountBase || undefined,
      description: String(createForm.description || "").trim() || undefined,
      referenceNo: String(createForm.referenceNo || "").trim() || undefined,
      note: String(createForm.note || "").trim() || undefined,
      idempotencyKey: String(createForm.idempotencyKey || "").trim(),
    };

    setCreateSubmitting(true);
    setError("");
    setErrorRequestId(null);
    setMessage("");

    try {
      const response = await createCashExchangeBatch(payload);
      const batchId = toPositiveInt(response?.batch?.id);
      setMessage(
        batchId
          ? t(
              "cashExchanges.messages.savedWithId",
              "Cash exchange batch #{{id}} saved successfully.",
              { id: batchId }
            )
          : t("cashExchanges.messages.saved", "Cash exchange batch saved successfully.")
      );
      await loadData(filters);
      if (batchId) {
        setSelectedBatchId(batchId);
      }
      setCreateForm((prev) => ({
        ...buildCreateDefaultForm(),
        sourceRegisterId: prev.sourceRegisterId || "",
        targetRegisterId: prev.targetRegisterId || "",
        postingMode: prev.postingMode || EXCHANGE_POSTING_MODE_CLEARING,
        clearingAccountId: prev.clearingAccountId || "",
      }));
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          t("cashExchanges.errors.create", "Cash exchange could not be created.")
        )
      );
      setErrorRequestId(extractRequestId(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleReverseExchange(batchId) {
    const resolvedBatchId = toPositiveInt(batchId);
    if (!canReverse) {
      setError("Missing permission: cash.txn.reverse");
      setErrorRequestId(null);
      return;
    }
    if (!resolvedBatchId) {
      setError("batchId is required for reverse.");
      setErrorRequestId(null);
      return;
    }
    const reverseReason = String(reverseReasonByBatchId[String(resolvedBatchId)] || "").trim();
    if (!reverseReason) {
      setError("reverseReason is required.");
      setErrorRequestId(null);
      return;
    }

    setReverseSubmitting(true);
    setError("");
    setErrorRequestId(null);
    setMessage("");
    try {
      const response = await reverseCashExchangeBatch(resolvedBatchId, { reverseReason });
      const reversedBatchId = toPositiveInt(response?.batch?.id) || resolvedBatchId;
      setMessage(`Cash exchange batch #${reversedBatchId} reversed successfully.`);
      setReverseReasonByBatchId((prev) => ({ ...prev, [String(resolvedBatchId)]: "" }));
      await loadData(filters);
      setSelectedBatchId(reversedBatchId);
    } catch (err) {
      setError(extractErrorMessage(err, "Cash exchange reverse failed."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setReverseSubmitting(false);
    }
  }

  async function handlePostExchange(batchId) {
    const resolvedBatchId = toPositiveInt(batchId);
    if (!canCreate) {
      setError("Missing permission: cash.txn.create");
      setErrorRequestId(null);
      return;
    }
    if (!resolvedBatchId) {
      setError("batchId is required for post.");
      setErrorRequestId(null);
      return;
    }

    const sourceSessionInput = postSourceSessionByBatchId[String(resolvedBatchId)] || "";
    const targetSessionInput = postTargetSessionByBatchId[String(resolvedBatchId)] || "";
    const payload = {};
    const sourceCashSessionId = toPositiveInt(sourceSessionInput);
    const targetCashSessionId = toPositiveInt(targetSessionInput);
    if (String(sourceSessionInput || "").trim() && !sourceCashSessionId) {
      setError("sourceCashSessionId must be a positive integer.");
      setErrorRequestId(null);
      return;
    }
    if (String(targetSessionInput || "").trim() && !targetCashSessionId) {
      setError("targetCashSessionId must be a positive integer.");
      setErrorRequestId(null);
      return;
    }
    if (sourceCashSessionId) {
      payload.sourceCashSessionId = sourceCashSessionId;
    }
    if (targetCashSessionId) {
      payload.targetCashSessionId = targetCashSessionId;
    }

    setPostSubmittingBatchId(resolvedBatchId);
    setError("");
    setErrorRequestId(null);
    setMessage("");
    try {
      const response = await postCashExchangeBatch(resolvedBatchId, payload);
      const postedBatchId = toPositiveInt(response?.batch?.id) || resolvedBatchId;
      setMessage(`Cash exchange batch #${postedBatchId} posted successfully.`);
      setPostSourceSessionByBatchId((prev) => ({
        ...prev,
        [String(resolvedBatchId)]: "",
      }));
      setPostTargetSessionByBatchId((prev) => ({
        ...prev,
        [String(resolvedBatchId)]: "",
      }));
      await loadData(filters);
      setSelectedBatchId(postedBatchId);
    } catch (err) {
      setError(extractErrorMessage(err, "Cash exchange post failed."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setPostSubmittingBatchId(null);
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: `cash.txn.read`
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CashControlModeBanner />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Cash Exchanges</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage explicit FX exchange batches between cash registers.
        </p>

        {error ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
            {errorRequestId ? <span className="ml-2 text-xs">(requestId: {errorRequestId})</span> : null}
          </div>
        ) : null}
        {warning ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {warning}
          </div>
        ) : null}
        {message ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <form className="mt-4 grid gap-2 md:grid-cols-7" onSubmit={handleApplyFilters}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Legal Entity
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.legalEntityId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
            >
              <option value="">All</option>
              {legalEntityOptions.map((row) => (
                <option key={`cash-ex-legal-entity-${row.id}`} value={row.id}>
                  {toLegalEntityLabel(row)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Source Register
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.sourceRegisterId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, sourceRegisterId: event.target.value }))
              }
            >
              <option value="">All</option>
              {registerOptions.map((row) => (
                <option key={`cash-ex-source-register-${row.id}`} value={row.id}>
                  {toRegisterLabel(row)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Target Register
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.targetRegisterId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, targetRegisterId: event.target.value }))
              }
            >
              <option value="">All</option>
              {registerOptions.map((row) => (
                <option key={`cash-ex-target-register-${row.id}`} value={row.id}>
                  {toRegisterLabel(row)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="">All</option>
              {EXCHANGE_STATUSES.map((status) => (
                <option key={`cash-ex-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Created From
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.createdDateFrom}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdDateFrom: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Created To
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.createdDateTo}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdDateTo: event.target.value }))
              }
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Loading..." : "Apply"}
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={handleClearFilters}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("cashExchanges.sections.exchangeBatches", "Exchange Batches")}
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-600">FX View</span>
            <button
              type="button"
              className={`rounded border px-2 py-1 font-semibold ${
                fxDisplayMode === "TARGET_TO_SOURCE"
                  ? "border-cyan-300 bg-cyan-50 text-cyan-700"
                  : "border-slate-300 text-slate-700"
              }`}
              onClick={() => setFxDisplayMode("TARGET_TO_SOURCE")}
            >
              1 Target = Source
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 font-semibold ${
                fxDisplayMode === "SOURCE_TO_TARGET"
                  ? "border-cyan-300 bg-cyan-50 text-cyan-700"
                  : "border-slate-300 text-slate-700"
              }`}
              onClick={() => setFxDisplayMode("SOURCE_TO_TARGET")}
            >
              1 Source = Target
            </button>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">FX</th>
                <th className="px-3 py-2">Fee / Spread</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {exchangeRows.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const reverseReason = reverseReasonByBatchId[String(rowId || 0)] || "";
                const postSourceSessionId =
                  postSourceSessionByBatchId[String(rowId || 0)] || "";
                const postTargetSessionId =
                  postTargetSessionByBatchId[String(rowId || 0)] || "";
                const canPostRow = canCreate && toUpper(row?.status) === "DRAFT";
                const canReverseRow = canReverse && toUpper(row?.status) === "POSTED";
                const rowPostSubmitting = postSubmittingBatchId === rowId;
                const fxDisplay = buildFxDisplay(row, fxDisplayMode);
                const rowBaseCurrencyCode = resolveContextBaseCurrencyCode({
                  legalEntityRows,
                  legalEntityId: row?.legalEntityId || row?.legal_entity_id,
                });
                return (
                  <tr
                    key={`cash-exchange-row-${row?.id}`}
                    className={`border-t border-slate-100 ${
                      rowId && selectedBatchId === rowId ? "bg-cyan-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-semibold text-cyan-700 hover:underline"
                        onClick={() => handleSelectBatch(row?.id)}
                      >
                        #{row?.id || "-"}
                      </button>
                      <div className="mt-1 text-xs text-slate-600">
                        {getPostingModeLabel(row?.postingMode || row?.posting_mode)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <div className="font-medium">
                          {row?.sourceRegisterCode || row?.sourceRegisterId || "-"}
                        </div>
                        <div className="text-slate-600">
                          <MoneyText
                            amount={row?.sourceAmountTxn}
                            currencyCode={row?.sourceCurrencyCode}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <div className="font-medium">
                          {row?.targetRegisterCode || row?.targetRegisterId || "-"}
                        </div>
                        <div className="text-slate-600">
                          <MoneyText
                            amount={row?.targetAmountTxn}
                            currencyCode={row?.targetCurrencyCode}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        {fxDisplay
                          ? `1 ${fxDisplay.baseCurrencyCode} = ${fxDisplay.rate.toFixed(10)} ${fxDisplay.quoteCurrencyCode}`
                          : "-"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {row?.fxRateSource || "-"} / {row?.fxRateDate || "-"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {t("cashExchanges.values.clearingUsage", "Clearing")}:{" "}
                        {getClearingUsageLabel(row)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        {t("cashExchanges.values.commissionAmount", "Commission")}:{" "}
                        <MoneyText
                          amount={row?.feeAmountBase}
                          currencyCode={rowBaseCurrencyCode}
                        />
                      </div>
                      <div>
                        {t("cashExchanges.values.spreadAmount", "Spread")}:{" "}
                        <MoneyText
                          amount={row?.spreadAmountBase}
                          currencyCode={rowBaseCurrencyCode}
                        />
                      </div>
                      <div className="text-xs text-slate-600">
                        {t("cashExchanges.values.commissionAccount", "Commission Account")}:{" "}
                        {getFeeAccountLabel(row)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                          row?.status
                        )}`}
                      >
                        {row?.status || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row?.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        {canPostRow ? (
                          <>
                            <input
                              type="number"
                              min="1"
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                              placeholder="Source session (optional)"
                              value={postSourceSessionId}
                              onChange={(event) =>
                                setPostSourceSessionByBatchId((prev) => ({
                                  ...prev,
                                  [String(rowId || 0)]: event.target.value,
                                }))
                              }
                              disabled={rowPostSubmitting}
                            />
                            <input
                              type="number"
                              min="1"
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                              placeholder="Target session (optional)"
                              value={postTargetSessionId}
                              onChange={(event) =>
                                setPostTargetSessionByBatchId((prev) => ({
                                  ...prev,
                                  [String(rowId || 0)]: event.target.value,
                                }))
                              }
                              disabled={rowPostSubmitting}
                            />
                            <button
                              type="button"
                              className="w-full rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                              onClick={() => handlePostExchange(rowId)}
                              disabled={rowPostSubmitting}
                            >
                              {rowPostSubmitting ? "Posting..." : "Post Draft"}
                            </button>
                          </>
                        ) : null}
                        {canReverseRow ? (
                          <>
                            <input
                              type="text"
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                              placeholder="Reverse reason"
                              value={reverseReason}
                              onChange={(event) =>
                                setReverseReasonByBatchId((prev) => ({
                                  ...prev,
                                  [String(rowId || 0)]: event.target.value,
                                }))
                              }
                              disabled={reverseSubmitting}
                            />
                            <button
                              type="button"
                              className="w-full rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                              onClick={() => handleReverseExchange(rowId)}
                              disabled={reverseSubmitting}
                            >
                              {reverseSubmitting ? "Reversing..." : "Reverse"}
                            </button>
                          </>
                        ) : null}
                        {!canPostRow && !canReverseRow ? (
                          <span className="text-xs text-slate-500">-</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {exchangeRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-slate-500">
                    {loading
                      ? t("cashExchanges.table.loading", "Loading exchange batches...")
                      : t("cashExchanges.table.empty", "No exchange batches found.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("cashExchanges.sections.createExchangeBatch", "Create Exchange Batch")}
        </h2>
        {!canCreate ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t(
              "cashExchanges.errors.missingCreatePermission",
              "Missing permission: cash.txn.create"
            )}
          </div>
        ) : null}
        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleCreateExchange}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Source Register
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.sourceRegisterId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, sourceRegisterId: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            >
              <option value="">Select</option>
              {createRegisterOptions.map((row) => (
                <option key={`cash-ex-create-source-${row.id}`} value={row.id}>
                  {toRegisterLabel(row)} ({toUpper(row?.currency_code)})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Target Register
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.targetRegisterId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, targetRegisterId: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            >
              <option value="">Select</option>
              {createRegisterOptions.map((row) => (
                <option key={`cash-ex-create-target-${row.id}`} value={row.id}>
                  {toRegisterLabel(row)} ({toUpper(row?.currency_code)})
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-4">
            <span>{t("cashExchanges.form.postingMode", "Posting Mode")}</span>
            <div className="mt-2 inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-1">
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                  createPostingMode === EXCHANGE_POSTING_MODE_CLEARING
                    ? "bg-cyan-600 text-white"
                    : "text-slate-700"
                }`}
                onClick={() =>
                  setCreateForm((prev) => ({
                    ...prev,
                    postingMode: EXCHANGE_POSTING_MODE_CLEARING,
                  }))
                }
                disabled={!canCreate || createSubmitting}
              >
                {t("cashExchanges.postingModes.clearing", "CLEARING (108.xx / staged)")}
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                  createPostingMode === EXCHANGE_POSTING_MODE_DIRECT
                    ? "bg-cyan-600 text-white"
                    : "text-slate-700"
                }`}
                onClick={() =>
                  setCreateForm((prev) => ({
                    ...prev,
                    postingMode: EXCHANGE_POSTING_MODE_DIRECT,
                  }))
                }
                disabled={!canCreate || createSubmitting}
              >
                {t("cashExchanges.postingModes.direct", "DIRECT (safe-to-safe)")}
              </button>
            </div>
            <p className="mt-2 text-[11px] font-normal normal-case tracking-normal text-slate-500">
              {createIsDirectPostingMode
                ? t(
                    "cashExchanges.form.directModeHelp",
                    "Direct mode posts target safe vs source safe without 108 clearing."
                  )
                : t(
                    "cashExchanges.form.clearingModeHelp",
                    "Use staged clearing when the exchange needs 108.xx transit or controlled completion."
                  )}
            </p>
          </div>

          {createIsDirectPostingMode ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 md:col-span-2">
              <div className="font-semibold uppercase tracking-wide text-slate-700">
                {t("cashExchanges.form.clearingAccount", "Clearing Account")}
              </div>
              <p>
                {t(
                  "cashExchanges.form.directModeNoClearing",
                  "No clearing account is used in direct mode."
                )}
              </p>
            </div>
          ) : (
          <div className="space-y-2 text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            <span>{t("cashExchanges.form.clearingAccount", "Clearing Account")}</span>
            <Combobox
              value={createForm.clearingAccountId || null}
              options={clearingAccountLookupOptions}
              disabled={!canCreate || createSubmitting || !selectedCreateLegalEntityId}
              placeholder={
                selectedCreateLegalEntityId
                  ? t(
                      "cashExchanges.form.searchClearingAccount",
                      "Search clearing account code/name"
                    )
                  : t(
                      "cashExchanges.form.selectSourceRegisterFirst",
                      "Select source register first"
                    )
              }
              noOptionsText={t(
                "cashExchanges.form.noClearingAccounts",
                "No clearing accounts found."
              )}
              onInputChange={(nextValue, meta) => {
                const reason = String(meta?.reason || "").trim().toLowerCase();
                if (reason === "input" || reason === "clear") {
                  setClearingAccountLookupQuery(nextValue);
                  setClearingInlineChildParentAccountId("");
                  setClearingInlineChildCode("");
                  setClearingInlineChildName(String(nextValue || "").trim());
                }
              }}
              onChange={(nextValue) => {
                setCreateForm((prev) => ({
                  ...prev,
                  clearingAccountId: nextValue ? String(nextValue) : "",
                }));
                setClearingAccountLookupQuery("");
                setClearingInlineChildParentAccountId("");
                setClearingInlineChildCode("");
                setClearingInlineChildName("");
              }}
            />
            <p className="text-[11px] font-normal normal-case tracking-normal text-slate-500">
              {t(
                "cashExchanges.form.clearingAccountHelp",
                "If CASH_EXCHANGE_CLEARING is configured in GL setup it prefills here. Tip: 108.xx under 108 is a good fit for staged exchange clearing."
              )}
            </p>
            {showInlineClearingChildCreate ? (
              <div className="space-y-2 rounded-md border border-cyan-200 bg-cyan-50 p-2">
                <p className="text-xs font-normal normal-case tracking-normal text-cyan-800">
                  No exact account found for "
                  {String(clearingSearchCodeCandidate || clearingAccountLookupQuery || "").trim()}
                  ". Create a child account below.
                </p>
                <Combobox
                  value={clearingInlineChildParentAccountId || null}
                  options={parentAccountLookupOptions}
                  disabled={!canCreate || createSubmitting || clearingInlineChildSaving}
                  placeholder="Select parent account"
                  noOptionsText="No parent accounts found."
                  onChange={(nextValue) =>
                    setClearingInlineChildParentAccountId(nextValue ? String(nextValue) : "")
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={clearingInlineChildCode}
                    onChange={(event) =>
                      setClearingInlineChildCode(normalizeAccountCode(event.target.value))
                    }
                    className="rounded border border-cyan-300 bg-white px-2 py-1.5 text-xs font-normal"
                    placeholder="Child account code"
                    maxLength={60}
                  />
                  <input
                    value={clearingInlineChildName}
                    onChange={(event) => setClearingInlineChildName(event.target.value)}
                    className="rounded border border-cyan-300 bg-white px-2 py-1.5 text-xs font-normal"
                    placeholder="New child account name"
                    maxLength={255}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setClearingInlineChildCode(clearingSearchCodeCandidate)}
                    disabled={!clearingSearchCodeCandidate}
                    className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                  >
                    Use searched code
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearingInlineChildCode(suggestedNextClearingChildCode)}
                    disabled={!suggestedNextClearingChildCode || !selectedClearingInlineParentAccount}
                    className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                  >
                    Use next child code
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateClearingChildAccount}
                    disabled={
                      !canCreate ||
                      createSubmitting ||
                      clearingInlineChildSaving ||
                      !canUpsertAccounts
                    }
                    className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                  >
                    {clearingInlineChildSaving ? "Creating child..." : "Create child account"}
                  </button>
                </div>
                {!canUpsertAccounts ? (
                  <p className="text-[11px] font-normal normal-case tracking-normal text-amber-700">
                    Missing permission: gl.account.upsert
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          )}

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Book Date
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.bookDate}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, bookDate: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Transaction Datetime
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.txnDatetime}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, txnDatetime: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Source Amount (Txn)
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.sourceAmountTxn}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, sourceAmountTxn: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Target Amount (Txn)
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.targetAmountTxn}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, targetAmountTxn: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            FX Rate (optional)
            <input
              type="number"
              min="0"
              step="0.0000000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.fxRate}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, fxRate: event.target.value }))}
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Source Session (optional)
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.sourceCashSessionId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, sourceCashSessionId: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Target Session (optional)
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.targetCashSessionId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, targetCashSessionId: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Provider Ref (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.providerRef}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, providerRef: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t("cashExchanges.form.commissionAmountTxn", "Commission Amount (Txn)")}
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.feeAmountTxn}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, feeAmountTxn: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t("cashExchanges.form.commissionAmountBase", "Commission Amount (Base)")}
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.feeAmountBase}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, feeAmountBase: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {t("cashExchanges.form.commissionAccount", "Commission Account")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.feeAccountId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, feeAccountId: event.target.value }))
              }
              disabled={!canCreate || createSubmitting || !selectedCreateLegalEntityId}
            >
              <option value="">
                {t("cashExchanges.form.selectCommissionAccount", "Select")}
              </option>
              {accountOptions.map((row) => (
                <option key={`cash-ex-create-fee-account-${row.id}`} value={row.id}>
                  {formatAccountOptionLabel(row)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-slate-500">
              {t(
                "cashExchanges.form.commissionHelp",
                "Commission is optional. When entered, a commission account is required."
              )}
            </p>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t("cashExchanges.form.spreadReferenceRate", "Spread Reference Rate")}
            <input
              type="number"
              min="0"
              step="0.0000000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.spreadReferenceRate}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  spreadReferenceRate: event.target.value,
                }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t("cashExchanges.form.spreadRateDelta", "Spread Rate Delta")}
            <input
              type="number"
              step="0.0000000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.spreadRateDelta}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, spreadRateDelta: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t("cashExchanges.form.spreadAmountBase", "Spread Amount (Base)")}
            <input
              type="number"
              min="0"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.spreadAmountBase}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, spreadAmountBase: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Reference No (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.referenceNo}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, referenceNo: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            Description (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.description}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, description: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            Note (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.note}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, note: event.target.value }))}
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            Idempotency Key
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.idempotencyKey}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, idempotencyKey: event.target.value }))
              }
              disabled={!canCreate || createSubmitting}
            />
          </label>

          <div className="md:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canCreate || createSubmitting}
            >
              {createSubmitting
                ? t("cashExchanges.actions.saving", "Saving...")
                : t("cashExchanges.actions.create", "Create Exchange")}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("cashExchanges.sections.selectedBatchDetail", "Selected Batch Detail")}
        </h2>
        {!selectedBatchId ? (
          <p className="mt-2 text-sm text-slate-600">
            {t(
              "cashExchanges.detail.selectPrompt",
              "Select a batch number from the table to inspect linked transactions."
            )}
          </p>
        ) : detailLoading ? (
          <p className="mt-2 text-sm text-slate-600">
            {t("cashExchanges.detail.loading", "Loading batch detail...")}
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.postingMode", "Posting Mode")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {getPostingModeLabel(detailBatch?.postingMode || detailBatch?.posting_mode)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.clearingUsage", "Clearing Usage")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {detailBatch ? getClearingUsageLabel(detailBatch) : "-"}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.commissionAccount", "Commission Account")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {detailBatch ? getFeeAccountLabel(detailBatch) : "-"}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.commissionAmount", "Commission Amount")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  <MoneyText
                    amount={detailBatch?.feeAmountBase}
                    currencyCode={detailBaseCurrencyCode}
                  />
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.spreadAmount", "Spread Amount")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  <MoneyText
                    amount={detailBatch?.spreadAmountBase}
                    currencyCode={detailBaseCurrencyCode}
                  />
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.sourceRegister", "Source Register")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatAccountSummary(
                    detailBatch?.sourceRegisterCode,
                    detailBatch?.sourceRegisterName,
                    detailBatch?.sourceRegisterId
                  )}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.targetRegister", "Target Register")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatAccountSummary(
                    detailBatch?.targetRegisterCode,
                    detailBatch?.targetRegisterName,
                    detailBatch?.targetRegisterId
                  )}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("cashExchanges.detail.exchangeTransactions", "Exchange Transactions")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {t("cashExchanges.detail.sourceTxn", "Out")}: #
                  {selectedBatchDetail?.exchangeOutTransaction?.id || "-"} /{" "}
                  {t("cashExchanges.detail.targetTxn", "In")}: #
                  {selectedBatchDetail?.exchangeInTransaction?.id || "-"}
                </div>
              </div>
            </div>
            <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                {t("cashExchanges.detail.rawJson", "Raw JSON")}
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(selectedBatchDetail || {}, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}

