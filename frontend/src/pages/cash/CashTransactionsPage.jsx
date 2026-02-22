import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  cancelCashTransaction,
  createCashTransaction,
  listCashRegisters,
  listCashSessions,
  listCashTransactions,
  postCashTransaction,
  reverseCashTransaction,
} from "../../api/cashAdmin.js";
import { listAccounts } from "../../api/glAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import CashControlModeBanner from "./CashControlModeBanner.jsx";

const MANUAL_TXN_TYPES = [
  "RECEIPT",
  "PAYOUT",
  "DEPOSIT_TO_BANK",
  "WITHDRAWAL_FROM_BANK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
];
const FILTER_TXN_TYPES = [...MANUAL_TXN_TYPES, "VARIANCE"];
const TXN_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REVERSED", "CANCELLED"];
const CANCELLABLE_STATUSES = new Set(["DRAFT", "SUBMITTED"]);
const POSTABLE_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED"]);
const COUNTERPARTY_TYPES = ["CUSTOMER", "VENDOR", "EMPLOYEE", "LEGAL_ENTITY", "OTHER"];
const SOURCE_DOC_TYPES = [
  "AP_PAYMENT",
  "AR_RECEIPT",
  "EXPENSE_CLAIM",
  "PETTY_CASH_VOUCHER",
  "BANK_DEPOSIT_SLIP",
  "OTHER",
];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

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
    return globalThis.crypto.randomUUID();
  }
  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "-";
  }
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
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

function resolvePresetTxnType(pathname) {
  const normalized = String(pathname || "");
  if (normalized.startsWith("/app/tediye-islemleri")) {
    return "PAYOUT";
  }
  if (normalized.startsWith("/app/tahsilat-islemleri")) {
    return "RECEIPT";
  }
  return null;
}

function buildInitialForm(presetTxnType) {
  return {
    registerId: "",
    cashSessionId: "",
    txnType: presetTxnType || "RECEIPT",
    txnDatetime: toDateTimeLocalInput(),
    bookDate: todayIsoDate(),
    amount: "",
    currencyCode: "",
    description: "",
    referenceNo: "",
    sourceDocType: "",
    sourceDocId: "",
    counterpartyType: "",
    counterpartyId: "",
    counterAccountId: "",
    counterCashRegisterId: "",
  };
}

function buildInitialFilters(presetTxnType) {
  return {
    registerId: "",
    sessionId: "",
    txnType: presetTxnType || "",
    status: "",
    bookDateFrom: "",
    bookDateTo: "",
  };
}

function statusClassName(status) {
  const normalized = toUpper(status);
  if (normalized === "POSTED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "REVERSED") {
    return "bg-violet-100 text-violet-700";
  }
  if (normalized === "CANCELLED") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "APPROVED" || normalized === "SUBMITTED") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-slate-200 text-slate-700";
}

function normalizeErrorMessage(value) {
  return String(value || "").trim();
}

function extractRequestId(err) {
  return (
    err?.response?.data?.requestId ||
    err?.response?.headers?.["x-request-id"] ||
    null
  );
}

function mapTransactionErrorMessage(rawMessage, t) {
  const message = normalizeErrorMessage(rawMessage);
  if (!message) {
    return "";
  }

  const lower = message.toLowerCase();
  if (lower.includes("registerid not found for tenant")) {
    return t("cashTransactions.errorsMapped.registerNotFound");
  }
  if (lower.includes("cashsessionid not found for tenant")) {
    return t("cashTransactions.errorsMapped.sessionNotFound");
  }
  if (lower.includes("cashsessionid must belong to registerid")) {
    return t("cashTransactions.errorsMapped.sessionRegisterMismatch");
  }
  if (lower.includes("cashsessionid must be open")) {
    return t("cashTransactions.errorsMapped.sessionNotOpen");
  }
  if (lower.includes("countercashregisterid not found for tenant")) {
    return t("cashTransactions.errorsMapped.counterRegisterNotFound");
  }
  if (lower.includes("counteraccountid")) {
    return t("cashTransactions.errorsMapped.counterAccountInvalid");
  }
  if (lower.includes("an open cash session is required for this register")) {
    return t("cashTransactions.errors.sessionRequiredNoOpen");
  }
  if (lower.includes("posting requires an open cash session")) {
    return t("cashTransactions.errorsMapped.postRequiresOpenSession");
  }
  if (lower.includes("posting requires cash_session_id to be open")) {
    return t("cashTransactions.errorsMapped.sessionNotOpen");
  }
  if (lower.includes("cash register is not active")) {
    return t("cashTransactions.errors.registerInactive");
  }
  if (lower.includes("transaction currency must match register currency")) {
    return t("cashTransactions.errorsMapped.currencyMismatchGeneric");
  }
  if (lower.includes("amount exceeds register max_txn_amount")) {
    return t("cashTransactions.errorsMapped.maxAmountExceededGeneric");
  }
  if (lower.includes("only draft or submitted transactions can be cancelled")) {
    return t("cashTransactions.errors.cancelStatusInvalid");
  }
  if (lower.includes("only draft, submitted, or approved transactions can be posted")) {
    return t("cashTransactions.errors.postStatusInvalid");
  }
  if (lower.includes("only posted transactions can be reversed")) {
    return t("cashTransactions.errors.reverseStatusInvalid");
  }
  if (lower.includes("reversal transactions cannot be reversed")) {
    return t("cashTransactions.errors.reverseReversalNotAllowed");
  }
  if (lower.includes("cash transaction not found")) {
    return t("cashTransactions.errorsMapped.transactionNotFound");
  }
  if (lower.includes("overridereason is required when overridecashcontrol=true")) {
    return t("cashTransactions.errors.overrideReasonRequired");
  }
  if (lower.includes("duplicate transaction idempotency key")) {
    return t("cashTransactions.errorsMapped.idempotencyDuplicate");
  }
  if (lower.includes("can only be system-generated")) {
    return t("cashTransactions.errorsMapped.systemGeneratedOnly");
  }

  return "";
}

function toTransactionErrorState(err, t, fallbackKey) {
  const requestId = extractRequestId(err);
  const rawMessage = normalizeErrorMessage(
    err?.response?.data?.message || err?.message
  );
  const mappedMessage = mapTransactionErrorMessage(rawMessage, t);
  const fallbackMessage = t(fallbackKey);
  return {
    message: mappedMessage || (rawMessage ? `${fallbackMessage} (${rawMessage})` : fallbackMessage),
    requestId,
  };
}

export default function CashTransactionsPage() {
  const { pathname } = useLocation();
  const { hasPermission } = useAuth();
  const { t } = useI18n();

  const presetTxnType = useMemo(() => resolvePresetTxnType(pathname), [pathname]);
  const canRead = hasPermission("cash.txn.read");
  const canCreate = hasPermission("cash.txn.create");
  const canPost = hasPermission("cash.txn.post");
  const canCancel = hasPermission("cash.txn.cancel");
  const canReverse = hasPermission("cash.txn.reverse");
  const canOverridePost = hasPermission("cash.override.post");
  const canReadAccounts = hasPermission("gl.account.read");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [message, setMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");

  const [rows, setRows] = useState([]);
  const [registers, setRegisters] = useState([]);
  const [openSessions, setOpenSessions] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [filters, setFilters] = useState(buildInitialFilters(presetTxnType));
  const [form, setForm] = useState(buildInitialForm(presetTxnType));
  const [actionForm, setActionForm] = useState(null);

  const registerOptions = useMemo(
    () =>
      [...registers].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [registers]
  );
  const accountOptions = useMemo(
    () =>
      [...accounts]
        .filter((row) => parseDbBoolean(row?.allow_posting) && parseDbBoolean(row?.is_active))
        .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || ""))),
    [accounts]
  );
  const selectedRegister = useMemo(() => {
    const registerId = toPositiveInt(form.registerId);
    if (!registerId) {
      return null;
    }
    return registers.find((row) => toPositiveInt(row?.id) === registerId) || null;
  }, [form.registerId, registers]);
  const selectedRegisterOpenSessions = useMemo(() => {
    const registerId = toPositiveInt(form.registerId);
    if (!registerId) {
      return [];
    }
    return openSessions.filter(
      (row) => toPositiveInt(row?.cash_register_id) === registerId
    );
  }, [form.registerId, openSessions]);
  const selectedActionRow = useMemo(() => {
    const transactionId = toPositiveInt(actionForm?.transactionId);
    if (!transactionId) {
      return null;
    }
    return rows.find((row) => toPositiveInt(row?.id) === transactionId) || null;
  }, [actionForm?.transactionId, rows]);
  const canFilterByTxnType = !presetTxnType;
  const effectiveTxnTypeFilter = presetTxnType || filters.txnType || "";

  const createWarnings = useMemo(() => {
    const warnings = [];
    const normalizedTxnType = toUpper(form.txnType);
    const amount = toOptionalNumber(form.amount);

    if (selectedRegister && toUpper(selectedRegister.status) !== "ACTIVE") {
      warnings.push(t("cashTransactions.warnings.registerInactive"));
    }

    if (
      selectedRegister &&
      String(form.currencyCode || "").trim() &&
      toUpper(form.currencyCode) !== toUpper(selectedRegister.currency_code)
    ) {
      warnings.push(
        t("cashTransactions.warnings.currencyMismatch", {
          registerCurrency: selectedRegister.currency_code || "-",
        })
      );
    }

    const maxTxnAmount = Number(selectedRegister?.max_txn_amount || 0);
    if (selectedRegister && Number.isFinite(amount) && maxTxnAmount > 0 && amount > maxTxnAmount) {
      warnings.push(
        t("cashTransactions.warnings.maxAmountExceeded", {
          max: formatAmount(maxTxnAmount),
        })
      );
    }

    if (selectedRegister && toUpper(selectedRegister.session_mode) === "NONE") {
      warnings.push(t("cashTransactions.warnings.sessionModeNone"));
    }

    if (
      selectedRegister &&
      toUpper(selectedRegister.session_mode) === "REQUIRED" &&
      !toPositiveInt(form.cashSessionId) &&
      selectedRegisterOpenSessions.length === 0
    ) {
      warnings.push(t("cashTransactions.warnings.sessionRequiredNoOpen"));
    }

    if (
      (normalizedTxnType === "TRANSFER_IN" || normalizedTxnType === "TRANSFER_OUT") &&
      !toPositiveInt(form.counterCashRegisterId)
    ) {
      warnings.push(t("cashTransactions.errors.counterRegisterRequired"));
    }

    if (
      (normalizedTxnType === "DEPOSIT_TO_BANK" ||
        normalizedTxnType === "WITHDRAWAL_FROM_BANK") &&
      !toPositiveInt(form.counterAccountId)
    ) {
      warnings.push(t("cashTransactions.errors.counterAccountRequired"));
    }

    return warnings;
  }, [
    form.amount,
    form.cashSessionId,
    form.counterAccountId,
    form.counterCashRegisterId,
    form.currencyCode,
    form.txnType,
    selectedRegister,
    selectedRegisterOpenSessions.length,
    t,
  ]);

  const transactionRows = useMemo(
    () => [...rows].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0)),
    [rows]
  );

  function toListQuery(nextFilters) {
    return {
      limit: 200,
      offset: 0,
      registerId: toPositiveInt(nextFilters.registerId) || undefined,
      sessionId: toPositiveInt(nextFilters.sessionId) || undefined,
      txnType: presetTxnType || nextFilters.txnType || undefined,
      status: nextFilters.status || undefined,
      bookDateFrom: nextFilters.bookDateFrom || undefined,
      bookDateTo: nextFilters.bookDateTo || undefined,
    };
  }

  async function loadPageData(nextFilters = filters) {
    if (!canRead) {
      setRows([]);
      setRegisters([]);
      setOpenSessions([]);
      setAccounts([]);
      return;
    }

    setLoading(true);
    setError("");
    setErrorRequestId(null);
    setLookupWarning("");
    try {
      const accountPromise = canReadAccounts
        ? listAccounts({ includeInactive: true, limit: 600 })
        : Promise.resolve({ rows: [] });
      const [listResult, registerResult, sessionResult, accountResult] =
        await Promise.allSettled([
          listCashTransactions(toListQuery(nextFilters)),
          listCashRegisters({ limit: 300, offset: 0 }),
          listCashSessions({ status: "OPEN", limit: 300, offset: 0 }),
          accountPromise,
        ]);

      if (listResult.status !== "fulfilled") {
        throw listResult.reason;
      }

      const warnings = [];

      if (registerResult.status === "fulfilled") {
        setRegisters(registerResult.value?.rows || []);
      } else {
        setRegisters([]);
        warnings.push(
          registerResult.reason?.response?.data?.message ||
            t("cashTransactions.warnings.registerLookupUnavailable")
        );
      }

      if (sessionResult.status === "fulfilled") {
        setOpenSessions(sessionResult.value?.rows || []);
      } else {
        setOpenSessions([]);
        warnings.push(
          sessionResult.reason?.response?.data?.message ||
            t("cashTransactions.warnings.sessionLookupUnavailable")
        );
      }

      if (accountResult.status === "fulfilled") {
        setAccounts(accountResult.value?.rows || []);
      } else {
        setAccounts([]);
        warnings.push(
          accountResult.reason?.response?.data?.message ||
            t("cashTransactions.warnings.accountLookupUnavailable")
        );
      }

      setRows(listResult.value?.rows || []);
      setLookupWarning(warnings.join(" "));
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.load");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setFilters(buildInitialFilters(presetTxnType));
    setForm(buildInitialForm(presetTxnType));
    setActionForm(null);
  }, [presetTxnType]);

  useEffect(() => {
    loadPageData(buildInitialFilters(presetTxnType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, presetTxnType, canReadAccounts]);

  useEffect(() => {
    if (!canCreate) {
      return;
    }
    if (toPositiveInt(form.registerId)) {
      return;
    }
    if (!registerOptions.length) {
      return;
    }
    const defaultRegister = registerOptions.find(
      (row) => toUpper(row?.status) === "ACTIVE"
    );
    setForm((prev) => {
      const registerId = String(defaultRegister?.id || registerOptions[0]?.id || "");
      const nextRegister =
        registerOptions.find((row) => String(row.id) === registerId) || null;
      return {
        ...prev,
        registerId,
        currencyCode: toUpper(nextRegister?.currency_code),
      };
    });
  }, [canCreate, form.registerId, registerOptions]);

  function clearMessages() {
    setError("");
    setErrorRequestId(null);
    setMessage("");
    setInfoMessage("");
  }

  function setSimpleError(message) {
    setError(message);
    setErrorRequestId(null);
  }

  function handleRegisterChange(nextRegisterId) {
    const nextRegister =
      registers.find((row) => String(row.id) === String(nextRegisterId)) || null;
    setForm((prev) => ({
      ...prev,
      registerId: String(nextRegisterId || ""),
      cashSessionId: "",
      currencyCode: nextRegister ? toUpper(nextRegister.currency_code) : prev.currencyCode,
      counterCashRegisterId:
        toPositiveInt(nextRegisterId) &&
        toPositiveInt(prev.counterCashRegisterId) === toPositiveInt(nextRegisterId)
          ? ""
          : prev.counterCashRegisterId,
    }));
  }

  function handleTxnTypeChange(nextTxnType) {
    const normalized = toUpper(nextTxnType);
    const isTransfer = normalized === "TRANSFER_IN" || normalized === "TRANSFER_OUT";
    const isBank =
      normalized === "DEPOSIT_TO_BANK" || normalized === "WITHDRAWAL_FROM_BANK";

    setForm((prev) => ({
      ...prev,
      txnType: normalized,
      counterCashRegisterId: isTransfer ? prev.counterCashRegisterId : "",
      counterAccountId: isBank ? prev.counterAccountId : "",
    }));
  }

  async function handleCreateTransaction(event) {
    event.preventDefault();
    clearMessages();

    if (!canCreate) {
      setSimpleError(t("cashTransactions.errors.missingCreatePermission"));
      return;
    }

    const registerId = toPositiveInt(form.registerId);
    const cashSessionId = toPositiveInt(form.cashSessionId);
    const counterAccountId = toPositiveInt(form.counterAccountId);
    const counterCashRegisterId = toPositiveInt(form.counterCashRegisterId);
    const counterpartyId = toPositiveInt(form.counterpartyId);
    const amount = toOptionalNumber(form.amount);
    const txnType = toUpper(form.txnType);
    const currencyCode = toUpper(form.currencyCode);
    const txnDatetime = String(form.txnDatetime || "").trim();
    const bookDate = String(form.bookDate || "").trim();

    if (!registerId) {
      setSimpleError(t("cashTransactions.errors.registerRequired"));
      return;
    }
    if (!txnDatetime) {
      setSimpleError(t("cashTransactions.errors.txnDatetimeRequired"));
      return;
    }
    if (!bookDate) {
      setSimpleError(t("cashTransactions.errors.bookDateRequired"));
      return;
    }
    if (amount === null) {
      setSimpleError(t("cashTransactions.errors.amountRequired"));
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setSimpleError(t("cashTransactions.errors.amountInvalid"));
      return;
    }
    if (!currencyCode || currencyCode.length !== 3) {
      setSimpleError(t("cashTransactions.errors.currencyRequired"));
      return;
    }
    if (!MANUAL_TXN_TYPES.includes(txnType)) {
      setSimpleError(t("cashTransactions.errors.invalidTxnType"));
      return;
    }
    if ((txnType === "TRANSFER_IN" || txnType === "TRANSFER_OUT") && !counterCashRegisterId) {
      setSimpleError(t("cashTransactions.errors.counterRegisterRequired"));
      return;
    }
    if (
      (txnType === "DEPOSIT_TO_BANK" || txnType === "WITHDRAWAL_FROM_BANK") &&
      !counterAccountId
    ) {
      setSimpleError(t("cashTransactions.errors.counterAccountRequired"));
      return;
    }
    if (counterCashRegisterId && counterCashRegisterId === registerId) {
      setSimpleError(t("cashTransactions.errors.counterRegisterSame"));
      return;
    }

    if (selectedRegister) {
      if (toUpper(selectedRegister.status) !== "ACTIVE") {
        setSimpleError(t("cashTransactions.errors.registerInactive"));
        return;
      }
      if (toUpper(selectedRegister.currency_code) !== currencyCode) {
        setSimpleError(
          t("cashTransactions.errors.currencyMismatch", {
            registerCurrency: selectedRegister.currency_code || "-",
          })
        );
        return;
      }
      const maxTxnAmount = Number(selectedRegister.max_txn_amount || 0);
      if (maxTxnAmount > 0 && amount > maxTxnAmount) {
        setSimpleError(
          t("cashTransactions.errors.maxAmountExceeded", {
            max: formatAmount(maxTxnAmount),
          })
        );
        return;
      }
      if (
        toUpper(selectedRegister.session_mode) === "REQUIRED" &&
        !cashSessionId &&
        selectedRegisterOpenSessions.length === 0
      ) {
        setSimpleError(t("cashTransactions.errors.sessionRequiredNoOpen"));
        return;
      }
    }

    setCreating(true);
    try {
      const response = await createCashTransaction({
        registerId,
        cashSessionId: cashSessionId || undefined,
        txnType,
        txnDatetime,
        bookDate,
        amount,
        currencyCode,
        description: String(form.description || "").trim() || undefined,
        referenceNo: String(form.referenceNo || "").trim() || undefined,
        sourceDocType: String(form.sourceDocType || "").trim() || undefined,
        sourceDocId: String(form.sourceDocId || "").trim() || undefined,
        counterpartyType: String(form.counterpartyType || "").trim() || undefined,
        counterpartyId: counterpartyId || undefined,
        counterAccountId: counterAccountId || undefined,
        counterCashRegisterId: counterCashRegisterId || undefined,
        idempotencyKey: generateIdempotencyKey(),
      });

      if (response?.idempotentReplay) {
        setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
      } else {
        setMessage(t("cashTransactions.messages.created"));
      }

      setForm((prev) => ({
        ...prev,
        cashSessionId: "",
        amount: "",
        description: "",
        referenceNo: "",
        sourceDocType: "",
        sourceDocId: "",
        counterpartyType: "",
        counterpartyId: "",
        counterAccountId: "",
        counterCashRegisterId: "",
      }));
      await loadPageData(filters);
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.create");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setCreating(false);
    }
  }

  function openActionForm(type, row) {
    clearMessages();
    const transactionId = toPositiveInt(row?.id);
    if (!transactionId) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }

    if (type === "post" && !canPost) {
      setSimpleError(t("cashTransactions.errors.missingPostPermission"));
      return;
    }
    if (type === "cancel" && !canCancel) {
      setSimpleError(t("cashTransactions.errors.missingCancelPermission"));
      return;
    }
    if (type === "reverse" && !canReverse) {
      setSimpleError(t("cashTransactions.errors.missingReversePermission"));
      return;
    }

    setActionForm({
      type,
      transactionId: String(transactionId),
      overrideCashControl: false,
      overrideReason: "",
      cancelReason: "",
      reverseReason: "",
    });
  }

  async function handleActionSubmit(event) {
    event.preventDefault();
    clearMessages();

    const transactionId = toPositiveInt(actionForm?.transactionId);
    if (!transactionId) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }

    const row = selectedActionRow;
    if (!row) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }

    setActionSaving(true);
    try {
      if (actionForm.type === "post") {
        if (!canPost) {
          throw new Error(t("cashTransactions.errors.missingPostPermission"));
        }
        if (!POSTABLE_STATUSES.has(toUpper(row.status))) {
          throw new Error(t("cashTransactions.errors.postStatusInvalid"));
        }

        const overrideCashControl = actionForm.overrideCashControl === true;
        const overrideReason = String(actionForm.overrideReason || "").trim();
        if (overrideCashControl && !canOverridePost) {
          throw new Error(t("cashTransactions.errors.missingOverridePermission"));
        }
        if (overrideCashControl && !overrideReason) {
          throw new Error(t("cashTransactions.errors.overrideReasonRequired"));
        }

        const response = await postCashTransaction(transactionId, {
          overrideCashControl,
          overrideReason: overrideCashControl ? overrideReason : undefined,
        });
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
        } else {
          setMessage(t("cashTransactions.messages.posted"));
        }
      } else if (actionForm.type === "cancel") {
        if (!CANCELLABLE_STATUSES.has(toUpper(row.status))) {
          throw new Error(t("cashTransactions.errors.cancelStatusInvalid"));
        }
        const cancelReason = String(actionForm.cancelReason || "").trim();
        if (!cancelReason) {
          throw new Error(t("cashTransactions.errors.cancelReasonRequired"));
        }
        await cancelCashTransaction(transactionId, { cancelReason });
        setMessage(t("cashTransactions.messages.cancelled"));
      } else if (actionForm.type === "reverse") {
        if (toUpper(row.status) !== "POSTED") {
          throw new Error(t("cashTransactions.errors.reverseStatusInvalid"));
        }
        if (toPositiveInt(row.reversal_of_transaction_id)) {
          throw new Error(t("cashTransactions.errors.reverseReversalNotAllowed"));
        }
        const reverseReason = String(actionForm.reverseReason || "").trim();
        if (!reverseReason) {
          throw new Error(t("cashTransactions.errors.reverseReasonRequired"));
        }
        const response = await reverseCashTransaction(transactionId, { reverseReason });
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
        } else {
          setMessage(
            t("cashTransactions.messages.reversed", {
              reversalId: response?.reversal?.id || "-",
            })
          );
        }
      }

      setActionForm(null);
      await loadPageData(filters);
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setActionSaving(false);
    }
  }

  function canPostRow(row) {
    return POSTABLE_STATUSES.has(toUpper(row?.status));
  }

  function canCancelRow(row) {
    return CANCELLABLE_STATUSES.has(toUpper(row?.status));
  }

  function canReverseRow(row) {
    if (toUpper(row?.status) !== "POSTED") {
      return false;
    }
    if (toPositiveInt(row?.reversal_of_transaction_id)) {
      return false;
    }
    return true;
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t("cashTransactions.errors.missingReadPermission")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {presetTxnType === "PAYOUT"
            ? t("cashTransactions.presetTitles.payout")
            : presetTxnType === "RECEIPT"
            ? t("cashTransactions.presetTitles.receipt")
            : t("cashTransactions.presetTitles.all")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("cashTransactions.subtitle")}</p>
      </div>

      <CashControlModeBanner />

      {presetTxnType === "PAYOUT" ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.presetNotices.payout")}
        </div>
      ) : null}
      {presetTxnType === "RECEIPT" ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.presetNotices.receipt")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p>{error}</p>
          {errorRequestId ? (
            <p className="mt-1 text-xs font-medium text-rose-700">
              {t("cashTransactions.errors.requestId", { requestId: errorRequestId })}
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {infoMessage ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {infoMessage}
        </div>
      ) : null}
      {lookupWarning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {lookupWarning}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {t("cashTransactions.sections.filters")}
        </h2>
        <form
          className="grid gap-2 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            loadPageData(filters);
          }}
        >
          {registerOptions.length > 0 ? (
            <select
              value={filters.registerId}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  registerId: event.target.value,
                  sessionId: "",
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.placeholders.allRegisters")}</option>
              {registerOptions.map((row) => (
                <option key={`filter-register-${row.id}`} value={row.id}>
                  {`${row.code || row.id} - ${row.name || "-"}`}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              value={filters.registerId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, registerId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.registerId")}
            />
          )}

          <input
            type="number"
            min={1}
            value={filters.sessionId}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, sessionId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("cashTransactions.form.sessionId")}
          />

          {canFilterByTxnType ? (
            <select
              value={filters.txnType}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, txnType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.placeholders.allTypes")}</option>
              {FILTER_TXN_TYPES.map((txnType) => (
                <option key={`filter-txn-type-${txnType}`} value={txnType}>
                  {txnType}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={effectiveTxnTypeFilter}
              readOnly
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            />
          )}

          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{t("cashTransactions.placeholders.allStatuses")}</option>
            {TXN_STATUSES.map((status) => (
              <option key={`filter-status-${status}`} value={status}>
                {status}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={filters.bookDateFrom}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, bookDateFrom: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={filters.bookDateTo}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, bookDateTo: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="md:col-span-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("cashTransactions.actions.applyFilters")}
            </button>
            <button
              type="button"
              onClick={() => {
                const reset = buildInitialFilters(presetTxnType);
                setFilters(reset);
                loadPageData(reset);
              }}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("cashTransactions.actions.clearFilters")}
            </button>
            <button
              type="button"
              onClick={() => loadPageData(filters)}
              disabled={loading}
              className="rounded-lg border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
            >
              {loading
                ? t("cashTransactions.actions.loading")
                : t("cashTransactions.actions.refresh")}
            </button>
          </div>
        </form>
      </section>

      {canCreate ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t("cashTransactions.sections.create")}
          </h2>
          <form onSubmit={handleCreateTransaction} className="grid gap-2 md:grid-cols-3">
            {registerOptions.length > 0 ? (
              <select
                value={form.registerId}
                onChange={(event) => handleRegisterChange(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">{t("cashTransactions.placeholders.register")}</option>
                {registerOptions.map((row) => (
                  <option key={`form-register-${row.id}`} value={row.id}>
                    {`${row.code || row.id} - ${row.name || "-"}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.registerId}
                onChange={(event) => handleRegisterChange(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashTransactions.form.registerId")}
                required
              />
            )}

            {selectedRegisterOpenSessions.length > 0 ? (
              <select
                value={form.cashSessionId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">{t("cashTransactions.placeholders.sessionOptional")}</option>
                {selectedRegisterOpenSessions.map((session) => (
                  <option key={`form-session-${session.id}`} value={session.id}>
                    {`#${session.id} - ${session.cash_register_code || session.cash_register_id}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.cashSessionId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashTransactions.form.cashSessionIdOptional")}
              />
            )}

            <select
              value={form.txnType}
              onChange={(event) => handleTxnTypeChange(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!canFilterByTxnType}
            >
              {(presetTxnType ? [presetTxnType] : MANUAL_TXN_TYPES).map((txnType) => (
                <option key={`form-txn-type-${txnType}`} value={txnType}>
                  {txnType}
                </option>
              ))}
            </select>

            <input
              type="datetime-local"
              value={form.txnDatetime}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, txnDatetime: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              type="date"
              value={form.bookDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, bookDate: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              type="number"
              min="0.000001"
              step="0.000001"
              value={form.amount}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, amount: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.amount")}
              required
            />

            <input
              value={form.currencyCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currencyCode: toUpper(event.target.value) }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.currencyCode")}
              maxLength={3}
              required
            />

            <input
              value={form.referenceNo}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, referenceNo: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.referenceNoOptional")}
              maxLength={100}
            />

            <input
              value={form.sourceDocId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sourceDocId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.sourceDocIdOptional")}
              maxLength={80}
            />

            <select
              value={form.sourceDocType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sourceDocType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.form.sourceDocTypeOptional")}</option>
              {SOURCE_DOC_TYPES.map((value) => (
                <option key={`source-doc-type-${value}`} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <select
              value={form.counterpartyType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, counterpartyType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.form.counterpartyTypeOptional")}</option>
              {COUNTERPARTY_TYPES.map((value) => (
                <option key={`counterparty-type-${value}`} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              value={form.counterpartyId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, counterpartyId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.counterpartyIdOptional")}
            />

            {(toUpper(form.txnType) === "DEPOSIT_TO_BANK" ||
              toUpper(form.txnType) === "WITHDRAWAL_FROM_BANK") &&
            accountOptions.length > 0 ? (
              <select
                value={form.counterAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, counterAccountId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">{t("cashTransactions.placeholders.counterAccount")}</option>
                {accountOptions.map((account) => (
                  <option key={`counter-account-${account.id}`} value={account.id}>
                    {`${account.code || account.id} - ${account.name || "-"}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.counterAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, counterAccountId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashTransactions.form.counterAccountIdOptional")}
                required={
                  toUpper(form.txnType) === "DEPOSIT_TO_BANK" ||
                  toUpper(form.txnType) === "WITHDRAWAL_FROM_BANK"
                }
              />
            )}

            {toUpper(form.txnType) === "TRANSFER_IN" || toUpper(form.txnType) === "TRANSFER_OUT" ? (
              registerOptions.length > 0 ? (
                <select
                  value={form.counterCashRegisterId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      counterCashRegisterId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">{t("cashTransactions.placeholders.counterRegister")}</option>
                  {registerOptions
                    .filter((row) => String(row.id) !== String(form.registerId))
                    .map((row) => (
                      <option key={`counter-register-${row.id}`} value={row.id}>
                        {`${row.code || row.id} - ${row.name || "-"}`}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={form.counterCashRegisterId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      counterCashRegisterId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("cashTransactions.form.counterCashRegisterIdOptional")}
                  required
                />
              )
            ) : (
              <input
                type="text"
                readOnly
                value={t("cashTransactions.values.notApplicable")}
                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
            )}

            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
              placeholder={t("cashTransactions.form.descriptionOptional")}
              maxLength={500}
            />

            <div className="md:col-span-3 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {creating
                  ? t("cashTransactions.actions.creating")
                  : t("cashTransactions.actions.create")}
              </button>
            </div>
          </form>

          {createWarnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <ul className="list-disc pl-5">
                {createWarnings.map((warning, index) => (
                  <li key={`cash-txn-warning-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.readOnlyNotice")}
        </div>
      )}

      {actionForm ? (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-cyan-800">
            {t("cashTransactions.sections.action")}
          </h2>
          <form onSubmit={handleActionSubmit} className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs text-slate-700 md:col-span-2">
              {t("cashTransactions.selectedTransactionSummary", {
                id: selectedActionRow?.id || "-",
                txnNo: selectedActionRow?.txn_no || "-",
                status: selectedActionRow?.status || "-",
              })}
            </div>

            {actionForm.type === "post" ? (
              <>
                {canOverridePost ? (
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={actionForm.overrideCashControl === true}
                      onChange={(event) =>
                        setActionForm((prev) => ({
                          ...prev,
                          overrideCashControl: event.target.checked,
                        }))
                      }
                    />
                    {t("cashTransactions.form.overrideCashControl")}
                  </label>
                ) : null}
                {actionForm.overrideCashControl ? (
                  <textarea
                    value={actionForm.overrideReason}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        overrideReason: event.target.value,
                      }))
                    }
                    className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                    placeholder={t("cashTransactions.form.overrideReason")}
                    maxLength={500}
                    required
                  />
                ) : null}
              </>
            ) : null}

            {actionForm.type === "cancel" ? (
              <textarea
                value={actionForm.cancelReason}
                onChange={(event) =>
                  setActionForm((prev) => ({
                    ...prev,
                    cancelReason: event.target.value,
                  }))
                }
                className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={t("cashTransactions.form.cancelReason")}
                maxLength={255}
                required
              />
            ) : null}

            {actionForm.type === "reverse" ? (
              <textarea
                value={actionForm.reverseReason}
                onChange={(event) =>
                  setActionForm((prev) => ({
                    ...prev,
                    reverseReason: event.target.value,
                  }))
                }
                className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={t("cashTransactions.form.reverseReason")}
                maxLength={255}
                required
              />
            ) : null}

            <div className="md:col-span-2 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={actionSaving}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionSaving
                  ? t("cashTransactions.actions.saving")
                  : t("cashTransactions.actions.submitAction")}
              </button>
              <button
                type="button"
                onClick={() => setActionForm(null)}
                disabled={actionSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {t("cashTransactions.actions.cancelAction")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {t("cashTransactions.sections.list")}
        </h2>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">{t("cashTransactions.table.id")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.txnNo")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.txnType")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.status")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.register")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.session")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.bookDate")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.amount")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.currency")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.counterAccount")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.counterRegister")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.postedJournal")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.overrideReason")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.createdAt")}</th>
                <th className="px-3 py-2">{t("cashTransactions.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {transactionRows.map((row) => {
                const rowStatus = toUpper(row.status);
                const rowIsPosted = rowStatus === "POSTED";
                return (
                  <tr
                    key={`cash-transaction-row-${row.id}`}
                    className={`border-t border-slate-100 ${rowIsPosted ? "bg-slate-50/60" : ""}`}
                  >
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.txn_no || "-"}</td>
                    <td className="px-3 py-2">{row.txn_type || "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                          row.status
                        )}`}
                      >
                        {rowStatus || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {(row.cash_register_code || row.cash_register_id) + " - " +
                        (row.cash_register_name || "-")}
                    </td>
                    <td className="px-3 py-2">{row.cash_session_id || "-"}</td>
                    <td className="px-3 py-2">{row.book_date || "-"}</td>
                    <td className="px-3 py-2">{formatAmount(row.amount)}</td>
                    <td className="px-3 py-2">{row.currency_code || "-"}</td>
                    <td className="px-3 py-2">
                      {row.counter_account_id
                        ? `${row.counter_account_code || row.counter_account_id} - ${
                            row.counter_account_name || "-"
                          }`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {row.counter_cash_register_id
                        ? `${row.counter_cash_register_code || row.counter_cash_register_id} - ${
                            row.counter_cash_register_name || "-"
                          }`
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {row.posted_journal_entry_id || row.postedJournalEntryId || "-"}
                    </td>
                    <td className="px-3 py-2">
                      {row.override_reason || row.overrideReason || "-"}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {canPost && canPostRow(row) ? (
                          <button
                            type="button"
                            onClick={() => openActionForm("post", row)}
                            className="rounded-md border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                          >
                            {t("cashTransactions.actions.preparePost")}
                          </button>
                        ) : null}
                        {canCancel && canCancelRow(row) ? (
                          <button
                            type="button"
                            onClick={() => openActionForm("cancel", row)}
                            className="rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            {t("cashTransactions.actions.prepareCancel")}
                          </button>
                        ) : null}
                        {canReverse && canReverseRow(row) ? (
                          <button
                            type="button"
                            onClick={() => openActionForm("reverse", row)}
                            className="rounded-md border border-violet-300 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                          >
                            {t("cashTransactions.actions.prepareReverse")}
                          </button>
                        ) : null}
                        {!canPostRow(row) && !canCancelRow(row) && !canReverseRow(row) ? (
                          <span className="text-slate-400">{t("cashTransactions.values.readOnly")}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {loading ? (
                <tr>
                  <td colSpan={15} className="px-3 py-3 text-slate-500">
                    {t("cashTransactions.loading")}
                  </td>
                </tr>
              ) : null}
              {!loading && transactionRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-3 py-3 text-slate-500">
                    {t("cashTransactions.empty")}
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
