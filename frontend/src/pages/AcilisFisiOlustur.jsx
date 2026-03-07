import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Combobox from "../components/Combobox.jsx";
import {
  createJournal,
  getTrialBalance,
  listAccounts,
  listBooks,
  postJournal,
} from "../api/glAdmin.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
  listShareholders,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
import { useModuleReadiness } from "../readiness/useModuleReadiness.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function hasId(rows, id) {
  return rows.some((row) => Number(row.id) === Number(id));
}

function toDateOnly(value) {
  return String(value || "").trim().slice(0, 10);
}

function isIsoDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function findPeriodByDate(periods, targetDate) {
  if (!isIsoDateOnly(targetDate)) {
    return null;
  }
  for (const row of periods || []) {
    const startDate = toDateOnly(row?.start_date);
    const endDate = toDateOnly(row?.end_date);
    if (!isIsoDateOnly(startDate) || !isIsoDateOnly(endDate)) {
      continue;
    }
    if (targetDate >= startDate && targetDate <= endDate) {
      return row;
    }
  }
  return null;
}

function formatPeriodLabel(row) {
  if (!row) {
    return "";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function createLine(options = {}) {
  const { followsFirstUnit = false } = options;
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: "",
    operatingUnitId: "",
    followsFirstUnit: Boolean(followsFirstUnit),
    subledgerReferenceNo: "",
    counterpartyLegalEntityId: "",
    description: "",
    debitBase: "0",
    creditBase: "0",
  };
}

function sanitizeRefSegment(value, fallback = "GEN") {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized || fallback;
}

export default function AcilisFisiOlustur() {
  const { hasPermission } = useAuth();
  const { getModuleRow } = useModuleReadiness();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const canCreateJournal = hasPermission("gl.journal.create");
  const canPostJournal = hasPermission("gl.journal.post");
  const canOverrideCashControl = hasPermission("cash.override.post");

  const today = new Date().toISOString().slice(0, 10);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingAccountBalances, setLoadingAccountBalances] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [shareholders, setShareholders] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [accountBalanceRows, setAccountBalanceRows] = useState([]);

  const [form, setForm] = useState({
    legalEntityId: "",
    bookId: "",
    periodDate: "",
    documentDate: today,
    currencyCode: "USD",
    referenceNo: "",
    description: l("Opening entry", "Acilis fisi"),
    autoPost: true,
    overrideCashControl: false,
    overrideReason: "",
  });
  const [lines, setLines] = useState([createLine(), createLine({ followsFirstUnit: true })]);
  const [lineAmountFocusById, setLineAmountFocusById] = useState({});
  const formRef = useRef(null);

  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const selectedBookId = toPositiveInt(form.bookId);
  const selectedShareholderCommitmentReadiness = getModuleRow(
    "shareholderCommitment",
    selectedLegalEntityId
  );
  const _shareholderCommitmentModuleNotReady = Boolean(
    selectedShareholderCommitmentReadiness &&
    !selectedShareholderCommitmentReadiness.ready
  );
  const unitsById = useMemo(() => {
    const map = new Map();
    for (const unit of operatingUnits) {
      const unitId = toPositiveInt(unit.id);
      if (!unitId) {
        continue;
      }
      map.set(unitId, unit);
    }
    return map;
  }, [operatingUnits]);
  const postableAccounts = useMemo(() => {
    const parentIds = new Set(
      accounts
        .map((row) => toPositiveInt(row.parent_account_id))
        .filter(Boolean)
    );
    return accounts.filter((row) => {
      const accountId = toPositiveInt(row.id);
      if (!accountId) {
        return false;
      }
      const allowPosting = !(
        row.allow_posting === false ||
        row.allow_posting === 0 ||
        row.allow_posting === "0"
      );
      return allowPosting && !parentIds.has(accountId);
    });
  }, [accounts]);
  const resolvedFiscalPeriod = useMemo(
    () => findPeriodByDate(periods, toDateOnly(form.periodDate)),
    [periods, form.periodDate]
  );
  const resolvedFiscalPeriodId = toPositiveInt(resolvedFiscalPeriod?.id);
  const accountBalanceById = useMemo(() => {
    const map = new Map();
    for (const row of accountBalanceRows || []) {
      const accountId = toPositiveInt(row?.account_id);
      if (!accountId) {
        continue;
      }
      map.set(accountId, Number(row?.balance || 0));
    }
    return map;
  }, [accountBalanceRows]);
  const postableAccountOptions = useMemo(
    () =>
      postableAccounts.map((account) => {
        const accountId = toPositiveInt(account.id);
        const hasBalanceContext =
          Boolean(canReadTrialBalance) &&
          Boolean(selectedBookId) &&
          Boolean(resolvedFiscalPeriodId);
        return {
          value: String(account.id),
          label: `${account.code} - ${account.name}`,
          description: String(account.account_type || "").toUpperCase(),
          accountType: String(account.account_type || "").toUpperCase(),
          balance: hasBalanceContext
            ? Number(accountBalanceById.get(accountId) || 0)
            : null,
        };
      }),
    [
      postableAccounts,
      canReadTrialBalance,
      selectedBookId,
      resolvedFiscalPeriodId,
      accountBalanceById,
    ]
  );
  const renderAccountOption = useCallback(
    ({ option, isHighlighted, isSelected, disabled }) => {
      const balanceText =
        option?.balance === null
          ? l("Period required", "Donem gerekli")
          : `${formatAmount(option.balance)} ${String(form.currencyCode || "").toUpperCase()}`;
      const rowClass = disabled
        ? "cursor-not-allowed text-slate-400"
        : isHighlighted
          ? "bg-cyan-50 text-cyan-900"
          : isSelected
            ? "bg-slate-100 text-slate-900"
            : "text-slate-700 hover:bg-slate-50";

      return (
        <div className={`rounded px-2 py-1.5 ${rowClass}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate">{option?.label || "-"}</div>
              <div className="mt-0.5 truncate text-[10px] text-slate-500">
                {option?.accountType || l("Account", "Hesap")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] font-semibold text-slate-700">{balanceText}</div>
              <div className="text-[10px] text-slate-500">{l("Balance", "Bakiye")}</div>
            </div>
          </div>
        </div>
      );
    },
    [l, form.currencyCode]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) {
        setLegalEntities([]);
        setBooks([]);
        setAccounts([]);
        setOperatingUnits([]);
        setShareholders([]);
        return;
      }

      setLoadingRefs(true);
      setError("");

      try {
        const [entityRes, bookRes, accountRes, unitRes, shareholdersRes] = await Promise.all([
          canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
          canReadBooks
            ? listBooks(
              selectedLegalEntityId
                ? { legalEntityId: selectedLegalEntityId }
                : {}
            )
            : Promise.resolve({ rows: [] }),
          canReadAccounts
            ? listAccounts(
              selectedLegalEntityId
                ? { legalEntityId: selectedLegalEntityId }
                : {}
            )
            : Promise.resolve({ rows: [] }),
          canReadOrgTree
            ? listOperatingUnits(
              selectedLegalEntityId
                ? { legalEntityId: selectedLegalEntityId }
                : {}
            )
            : Promise.resolve({ rows: [] }),
          canReadOrgTree
            ? listShareholders(
              selectedLegalEntityId
                ? { legalEntityId: selectedLegalEntityId }
                : {}
            )
            : Promise.resolve({ rows: [] }),
        ]);

        if (cancelled) {
          return;
        }

        const entityRows = entityRes?.rows || [];
        const bookRows = bookRes?.rows || [];
        const accountRows = accountRes?.rows || [];
        const unitRows = unitRes?.rows || [];
        const shareholderRows = shareholdersRes?.rows || [];

        setLegalEntities(entityRows);
        setBooks(bookRows);
        setAccounts(accountRows);
        setOperatingUnits(unitRows);
        setShareholders(shareholderRows);

        setForm((prev) => {
          const next = { ...prev };

          const currentEntityId = toPositiveInt(prev.legalEntityId);
          if (!currentEntityId || !hasId(entityRows, currentEntityId)) {
            next.legalEntityId = entityRows[0] ? String(entityRows[0].id) : "";
          }

          const currentBookId = toPositiveInt(prev.bookId);
          if (!currentBookId || !hasId(bookRows, currentBookId)) {
            next.bookId = bookRows[0] ? String(bookRows[0].id) : "";
          }

          const nextBookId = toPositiveInt(next.bookId);
          const selectedBook = bookRows.find(
            (row) => Number(row.id) === Number(nextBookId)
          );
          if (selectedBook?.base_currency_code) {
            next.currencyCode = String(selectedBook.base_currency_code).toUpperCase();
          }

          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load references.", "Referanslar yuklenemedi."));
        }
      } finally {
        if (!cancelled) {
          setLoadingRefs(false);
        }
      }
    }

    loadReferences();
    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, canReadBooks, canReadAccounts, selectedLegalEntityId, l]);

  useEffect(() => {
    let cancelled = false;

    async function loadPeriodsByBook() {
      if (!canReadPeriods || !selectedBookId) {
        setPeriods([]);
        return;
      }

      const book = books.find((row) => Number(row.id) === Number(selectedBookId));
      const calendarId = toPositiveInt(book?.calendar_id);
      if (!calendarId) {
        setPeriods([]);
        return;
      }

      setLoadingPeriods(true);
      try {
        const res = await listFiscalPeriods(calendarId);
        if (cancelled) {
          return;
        }

        setPeriods(res?.rows || []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPeriods(false);
        }
      }
    }

    loadPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, books, selectedBookId, l]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccountBalances() {
      if (!canReadTrialBalance || !selectedBookId || !resolvedFiscalPeriodId) {
        setAccountBalanceRows([]);
        return;
      }

      setLoadingAccountBalances(true);
      try {
        const res = await getTrialBalance({
          bookId: selectedBookId,
          fiscalPeriodId: resolvedFiscalPeriodId,
          includeRollup: false,
        });
        if (cancelled) {
          return;
        }
        setAccountBalanceRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch {
        if (!cancelled) {
          setAccountBalanceRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingAccountBalances(false);
        }
      }
    }

    loadAccountBalances();
    return () => {
      cancelled = true;
    };
  }, [canReadTrialBalance, selectedBookId, resolvedFiscalPeriodId]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.debit += toAmount(line.debitBase);
        acc.credit += toAmount(line.creditBase);
        return acc;
      },
      { debit: 0, credit: 0 }
    );
  }, [lines]);
  const selectedEntityShareholders = useMemo(
    () =>
      shareholders.filter(
        (row) => Number(row.legal_entity_id) === Number(selectedLegalEntityId)
      ),
    [selectedLegalEntityId, shareholders]
  );
  const selectedEntityShareholdersWithCommittedCapital = useMemo(
    () =>
      selectedEntityShareholders.filter(
        (row) => Number(row.committed_capital || 0) > 0
      ),
    [selectedEntityShareholders]
  );
  const selectedEntityEquityAccounts = useMemo(
    () =>
      accounts.filter((row) => {
        const sameEntity =
          Number(row.legal_entity_id) === Number(selectedLegalEntityId);
        const isActive = Boolean(row.is_active);
        const isEquity = String(row.account_type || "").toUpperCase() === "EQUITY";
        const allowPosting = !(
          row.allow_posting === false ||
          row.allow_posting === 0 ||
          row.allow_posting === "0"
        );
        return sameEntity && isActive && isEquity && allowPosting;
      }),
    [accounts, selectedLegalEntityId]
  );
  const commitmentSetupChecks = useMemo(() => {
    if (!selectedLegalEntityId) {
      return [];
    }
    return [
      {
        key: "shareholderMaster",
        label: l("Shareholder master exists", "Ortak ana verisi mevcut"),
        ready: selectedEntityShareholders.length > 0,
      },
      {
        key: "commitmentSubAccounts",
        label: l(
          "Each committed shareholder has debit and capital sub-accounts",
          "Taahhutu olan her ortak icin borc ve sermaye alt hesabi tanimli"
        ),
        ready: selectedEntityShareholdersWithCommittedCapital.every(
          (row) =>
            Boolean(toPositiveInt(row.commitment_debit_sub_account_id)) &&
            Boolean(toPositiveInt(row.capital_sub_account_id))
        ),
      },
      {
        key: "equitySubAccount",
        label: l(
          "Capital equity sub-account exists",
          "Sermaye icin equity alt hesap mevcut"
        ),
        ready: selectedEntityEquityAccounts.length > 0,
      },
      {
        key: "periods",
        label: l(
          "Fiscal periods are generated",
          "Mali donemler olusturulmus"
        ),
        ready: periods.length > 0,
      },
    ];
  }, [
    l,
    periods.length,
    selectedEntityEquityAccounts.length,
    selectedEntityShareholdersWithCommittedCapital,
    selectedEntityShareholders.length,
    selectedLegalEntityId,
  ]);
  const _missingCommitmentSetupChecks = useMemo(
    () => commitmentSetupChecks.filter((check) => !check.ready),
    [commitmentSetupChecks]
  );
  const isBalanced =
    Math.abs(totals.debit - totals.credit) < 0.0001 && totals.debit > 0;

  const canSubmit =
    canCreateJournal &&
    isBalanced &&
    lines.length >= 2 &&
    !submitting &&
    Boolean(String(form.periodDate || "").trim()) &&
    Boolean(resolvedFiscalPeriodId);
  const canCopyFirstUnitToAll = Boolean(toPositiveInt(lines[0]?.operatingUnitId));

  useEffect(() => {
    function handleKeyDown(event) {
      const isSaveShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        String(event.key || "").toLowerCase() === "s";
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      if (canSubmit && formRef.current) {
        formRef.current.requestSubmit();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [canSubmit]);

  function setFormField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function addLine() {
    setLines((prev) => {
      const nextLine = createLine();
      const inheritedOperatingUnitId = String(prev[0]?.operatingUnitId || "");
      const inheritedUnitId = toPositiveInt(inheritedOperatingUnitId);
      if (!inheritedUnitId) {
        return [...prev, nextLine];
      }

      const inheritedUnit = unitsById.get(inheritedUnitId) || null;
      const requiresSubledgerReference = Boolean(inheritedUnit?.has_subledger);
      return [
        ...prev,
        {
          ...nextLine,
          operatingUnitId: inheritedOperatingUnitId,
          subledgerReferenceNo: requiresSubledgerReference
            ? buildSubledgerReferenceNo(nextLine.id, inheritedOperatingUnitId)
            : "",
        },
      ];
    });
  }

  function removeLine(lineId) {
    setLines((prev) => {
      if (prev.length <= 2) {
        return prev;
      }
      return prev.filter((line) => line.id !== lineId);
    });
  }

  function updateLine(lineId, field, value) {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line))
    );
  }

  function handleDescriptionFillDown(event, index, lineId) {
    const isFillDown = (event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "d";
    if (!isFillDown) {
      return;
    }
    event.preventDefault();
    if (index <= 0) {
      return;
    }

    setLines((prev) => {
      const sourceDescription = String(prev[index - 1]?.description || "");
      return prev.map((line) =>
        line.id === lineId ? { ...line, description: sourceDescription } : line
      );
    });
  }

  function formatInputAmount(value) {
    const rounded = Math.round(Math.max(0, Number(value || 0)) * 100) / 100;
    return rounded.toFixed(2);
  }

  function resolveLineBalanceAmount(accountIdRaw) {
    if (
      !canReadTrialBalance ||
      !selectedBookId ||
      !resolvedFiscalPeriodId ||
      loadingAccountBalances
    ) {
      return null;
    }
    const accountId = toPositiveInt(accountIdRaw);
    if (!accountId) {
      return null;
    }
    const balance = Number(accountBalanceById.get(accountId) || 0);
    return Number.isFinite(balance) ? balance : null;
  }

  function resolveLineApplySide(lineId, preferredSide = "") {
    const normalizedPreferredSide = String(preferredSide || "").trim().toLowerCase();
    if (normalizedPreferredSide === "debit" || normalizedPreferredSide === "credit") {
      return normalizedPreferredSide;
    }
    const focusedSide = String(lineAmountFocusById[lineId] || "")
      .trim()
      .toLowerCase();
    if (focusedSide === "debit" || focusedSide === "credit") {
      return focusedSide;
    }
    return "debit";
  }

  function applyBalanceToLine(lineId, preferredSide = "") {
    const side = resolveLineApplySide(lineId, preferredSide);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        const balance = resolveLineBalanceAmount(line.accountId);
        if (balance === null) {
          return line;
        }
        const absolute = Math.abs(balance);
        return {
          ...line,
          debitBase: formatInputAmount(side === "debit" ? absolute : 0),
          creditBase: formatInputAmount(side === "credit" ? absolute : 0),
        };
      })
    );
  }

  function handleBalanceShortcut(event, lineId, side) {
    const key = String(event.key || "").toLowerCase();
    if (event.altKey && key === "k") {
      event.preventDefault();
      applyBalanceToLine(lineId, side);
      return;
    }

    const isBalanceShortcut = event.altKey && key === "b";
    if (!isBalanceShortcut) {
      return;
    }
    event.preventDefault();

    setLines((prev) => {
      const lineIndex = prev.findIndex((line) => line.id === lineId);
      if (lineIndex < 0) {
        return prev;
      }

      const currentLine = prev[lineIndex];
      const currentDebit = toAmount(currentLine.debitBase);
      const currentCredit = toAmount(currentLine.creditBase);
      const totalDebit = prev.reduce((sum, line) => sum + toAmount(line.debitBase), 0);
      const totalCredit = prev.reduce((sum, line) => sum + toAmount(line.creditBase), 0);
      const baseDebit = totalDebit - currentDebit;
      const baseCredit = totalCredit - currentCredit;

      let nextDebit = 0;
      let nextCredit = 0;

      if (side === "debit") {
        nextDebit = Math.max(0, baseCredit - baseDebit);
      } else {
        nextCredit = Math.max(0, baseDebit - baseCredit);
      }

      return prev.map((line) =>
        line.id === lineId
          ? {
            ...line,
            debitBase: formatInputAmount(nextDebit),
            creditBase: formatInputAmount(nextCredit),
          }
          : line
      );
    });
  }

  function buildSubledgerReferenceNo(lineId, operatingUnitIdRaw) {
    const operatingUnitId = toPositiveInt(operatingUnitIdRaw);
    const unit = operatingUnitId ? unitsById.get(operatingUnitId) : null;
    const unitCode = sanitizeRefSegment(unit?.code, `OU${operatingUnitId || "0"}`);
    const dateSeed = toDateOnly(form.documentDate || form.periodDate || today).replaceAll("-", "");
    const lineSeed = sanitizeRefSegment(String(lineId || "").slice(-10), "LINE");
    return `SLR-${unitCode}-${dateSeed}-${lineSeed}`.slice(0, 100);
  }

  function applyOperatingUnitSelection(line, lineId, nextOperatingUnitId) {
    const unitId = toPositiveInt(nextOperatingUnitId);
    const selectedUnit = unitId ? unitsById.get(unitId) || null : null;
    const hasSubledger = Boolean(selectedUnit?.has_subledger);
    const currentSubledgerReferenceNo = String(line.subledgerReferenceNo || "").trim();

    if (!unitId) {
      return {
        ...line,
        operatingUnitId: nextOperatingUnitId,
        subledgerReferenceNo: "",
      };
    }

    if (hasSubledger && !currentSubledgerReferenceNo) {
      return {
        ...line,
        operatingUnitId: nextOperatingUnitId,
        subledgerReferenceNo: buildSubledgerReferenceNo(lineId, unitId),
      };
    }

    return {
      ...line,
      operatingUnitId: nextOperatingUnitId,
    };
  }

  function handleLineOperatingUnitChange(lineId, nextOperatingUnitId) {
    setLines((prev) => {
      const lineIndex = prev.findIndex((line) => line.id === lineId);
      if (lineIndex < 0) {
        return prev;
      }

      const isFirstLine = lineIndex === 0;
      const next = prev.map((line, index) => {
        if (line.id !== lineId) {
          return line;
        }
        const updated = applyOperatingUnitSelection(line, lineId, nextOperatingUnitId);
        if (index === 1 && !isFirstLine) {
          return {
            ...updated,
            followsFirstUnit: false,
          };
        }
        return updated;
      });

      const secondLine = next[1];
      if (isFirstLine && secondLine?.followsFirstUnit) {
        next[1] = applyOperatingUnitSelection(secondLine, secondLine.id, nextOperatingUnitId);
      }

      return next;
    });
  }

  function copyFirstLineOperatingUnitToAll() {
    setLines((prev) => {
      const firstOperatingUnitId = String(prev[0]?.operatingUnitId || "");
      const firstUnitId = toPositiveInt(firstOperatingUnitId);
      if (!firstUnitId) {
        return prev;
      }

      const firstUnit = unitsById.get(firstUnitId) || null;
      const requiresSubledgerReference = Boolean(firstUnit?.has_subledger);
      return prev.map((line) => {
        const currentSubledgerReferenceNo = String(line.subledgerReferenceNo || "").trim();
        return {
          ...line,
          operatingUnitId: firstOperatingUnitId,
          subledgerReferenceNo: requiresSubledgerReference
            ? currentSubledgerReferenceNo || buildSubledgerReferenceNo(line.id, firstOperatingUnitId)
            : "",
        };
      });
    });
  }

  function formatLineAccountBalance(accountIdRaw) {
    if (!canReadTrialBalance) {
      return l("No permission", "Yetki yok");
    }
    if (!resolvedFiscalPeriodId) {
      return l("Select period date", "Donem tarihi secin");
    }
    if (loadingAccountBalances) {
      return l("Loading...", "Yukleniyor...");
    }

    const accountId = toPositiveInt(accountIdRaw);
    const balance = accountId ? Number(accountBalanceById.get(accountId) || 0) : 0;
    return `${formatAmount(balance)} ${String(form.currencyCode || "").toUpperCase()}`;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canCreateJournal) {
      setError(l("Missing permission: gl.journal.create", "Eksik yetki: gl.journal.create"));
      return;
    }

    const legalEntityId = toPositiveInt(form.legalEntityId);
    const bookId = toPositiveInt(form.bookId);
    const fiscalPeriodId = resolvedFiscalPeriodId;
    const periodDate = String(form.periodDate || "").trim();
    if (!legalEntityId || !bookId) {
      setError(l("Legal entity and book are required.", "Istirak / bagli ortak ve defter zorunludur."));
      return;
    }
    if (!periodDate) {
      setError(l("Period date is required.", "Donem tarihi zorunludur."));
      return;
    }
    if (!fiscalPeriodId) {
      setError(
        l(
          "No fiscal period matches the selected period date.",
          "Secilen donem tarihine uyan mali donem bulunamadi."
        )
      );
      return;
    }
    if (lines.length < 2) {
      setError(l("At least two lines are required.", "En az iki satir gereklidir."));
      return;
    }
    if (form.overrideCashControl && !canOverrideCashControl) {
      setError(l("Missing permission: cash.override.post", "Eksik yetki: cash.override.post"));
      return;
    }
    if (form.overrideCashControl && !String(form.overrideReason || "").trim()) {
      setError(
        l(
          "Override reason is required when cash-control override is enabled.",
          "Cash-control override acik oldugunda override nedeni zorunludur."
        )
      );
      return;
    }

    const normalizedLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineLabel = `Line ${i + 1}`;
      const accountId = toPositiveInt(line.accountId);
      if (!accountId) {
        setError(
          l(
            `${lineLabel}: account is required.`,
            `Satir ${i + 1}: hesap zorunludur.`
          )
        );
        return;
      }
      const operatingUnitId = toPositiveInt(line.operatingUnitId);
      if (line.operatingUnitId && !operatingUnitId) {
        setError(
          l(
            `${lineLabel}: operating unit must be a positive integer.`,
            `Satir ${i + 1}: birim pozitif bir tam sayi olmali.`
          )
        );
        return;
      }
      const selectedUnit = operatingUnitId ? unitsById.get(operatingUnitId) || null : null;
      const requiresSubledgerReference = Boolean(selectedUnit?.has_subledger);
      const subledgerReferenceNo = String(line.subledgerReferenceNo || "").trim();
      if (subledgerReferenceNo && !operatingUnitId) {
        setError(
          l(
            `${lineLabel}: subledger reference requires operating unit.`,
            `Satir ${i + 1}: alt defter referansi icin birim secilmelidir.`
          )
        );
        return;
      }
      if (requiresSubledgerReference && !subledgerReferenceNo) {
        setError(
          l(
            `${lineLabel}: subledger reference is required for selected unit.`,
            `Satir ${i + 1}: secilen birim icin alt defter referansi zorunludur.`
          )
        );
        return;
      }
      if (subledgerReferenceNo.length > 100) {
        setError(
          l(
            `${lineLabel}: subledger reference must be at most 100 characters.`,
            `Satir ${i + 1}: alt defter referansi en fazla 100 karakter olabilir.`
          )
        );
        return;
      }

      const debitBase = toAmount(line.debitBase);
      const creditBase = toAmount(line.creditBase);
      if (debitBase < 0 || creditBase < 0) {
        setError(
          l(
            `${lineLabel}: debit/credit cannot be negative.`,
            `Satir ${i + 1}: borc/alacak negatif olamaz.`
          )
        );
        return;
      }
      if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
        setError(
          l(
            `${lineLabel}: enter either debit or credit.`,
            `Satir ${i + 1}: yalnizca borc veya alacak girin.`
          )
        );
        return;
      }

      normalizedLines.push({
        accountId,
        operatingUnitId: operatingUnitId || undefined,
        subledgerReferenceNo: subledgerReferenceNo || undefined,
        counterpartyLegalEntityId:
          toPositiveInt(line.counterpartyLegalEntityId) || undefined,
        description: line.description.trim() || undefined,
        currencyCode: String(form.currencyCode || "USD").toUpperCase(),
        amountTxn: debitBase > 0 ? debitBase : -creditBase,
        debitBase,
        creditBase,
      });
    }

    const totalDebit = normalizedLines.reduce((sum, line) => sum + line.debitBase, 0);
    const totalCredit = normalizedLines.reduce((sum, line) => sum + line.creditBase, 0);
    if (Math.abs(totalDebit - totalCredit) >= 0.0001) {
      setError(l("Entry is not balanced.", "Fis dengede degil."));
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    setResult(null);

    try {
      const payload = {
        legalEntityId,
        bookId,
        fiscalPeriodId,
        entryDate: periodDate,
        documentDate: form.documentDate,
        currencyCode: String(form.currencyCode || "USD").toUpperCase(),
        sourceType: "MANUAL",
        referenceNo: form.referenceNo.trim() || undefined,
        description: form.description.trim() || undefined,
        overrideCashControl: Boolean(form.overrideCashControl),
        overrideReason: form.overrideCashControl
          ? String(form.overrideReason || "").trim()
          : undefined,
        lines: normalizedLines,
      };

      const createResult = await createJournal(payload);
      const journalEntryId = Number(createResult?.journalEntryId || 0);
      const journalNo = createResult?.journalNo || null;

      let posted = false;
      if (form.autoPost && canPostJournal && journalEntryId) {
        const postResult = await postJournal(journalEntryId, {
          overrideCashControl: Boolean(form.overrideCashControl),
          overrideReason: form.overrideCashControl
            ? String(form.overrideReason || "").trim()
            : undefined,
        });
        posted = Boolean(postResult?.posted);
      }

      setResult({
        journalEntryId,
        journalNo,
        posted,
      });
      if (form.autoPost && canPostJournal) {
        setMessage(
          posted
            ? l("Opening entry created and posted.", "Acilis fisi olusturuldu ve post edildi.")
            : l(
              "Opening entry created; posting did not complete.",
              "Acilis fisi olusturuldu; post islemi tamamlanamadi."
            )
        );
      } else if (form.autoPost && !canPostJournal) {
        setMessage(
          l(
            "Opening entry created as draft (missing gl.journal.post permission).",
            "Acilis fisi taslak olarak olusturuldu (gl.journal.post yetkisi eksik)."
          )
        );
      } else {
        setMessage(l("Opening entry created as draft.", "Acilis fisi taslak olarak olusturuldu."));
      }

      setLines([createLine(), createLine({ followsFirstUnit: true })]);
      setForm((prev) => ({
        ...prev,
        referenceNo: "",
        description: l("Opening entry", "Acilis fisi"),
        autoPost: true,
        overrideCashControl: false,
        overrideReason: "",
      }));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to create opening entry.", "Acilis fisi olusturulamadi."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full min-h-0 p-4">
      <div className="flex h-full min-h-0 flex-col gap-3">
        <header>
        </header>
        {!canCreateJournal && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {l("Missing permission:", "Eksik yetki:")} <span className="font-mono">gl.journal.create</span>
          </div>
        )}
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

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <section className="min-h-45 shrink-0 basis-1/5 overflow-auto rounded-xl border border-slate-200 bg-white px-4">
            <div className="grid items-start gap-0.5 md:grid-cols-4">
              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Legal entity", "Istirak / bagli ortak")}
                </span>
                <select
                  value={form.legalEntityId}
                  onChange={(event) => setFormField("legalEntityId", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  required
                  disabled={!canReadOrgTree || loadingRefs}
                >
                  <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
                  {legalEntities.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Book", "Defter")}
                </span>
                <select
                  value={form.bookId}
                  onChange={(event) => setFormField("bookId", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  required
                  disabled={!canReadBooks || loadingRefs}
                >
                  <option value="">{l("Select book", "Defter secin")}</option>
                  {books.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Resolved fiscal period", "Eslesen mali donem")}
                </span>
                <div
                  className="flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700"
                  title={
                    loadingPeriods
                      ? l("Loading periods...", "Donemler yukleniyor...")
                      : resolvedFiscalPeriod
                        ? formatPeriodLabel(resolvedFiscalPeriod)
                        : l("Select period date to resolve", "Eslestirmek icin donem tarihi secin")
                  }
                >
                  <span className="block truncate">
                    {loadingPeriods
                      ? l("Loading periods...", "Donemler yukleniyor...")
                      : resolvedFiscalPeriod
                        ? formatPeriodLabel(resolvedFiscalPeriod)
                        : l("Select period date to resolve", "Eslestirmek icin donem tarihi secin")}
                  </span>
                </div>
                {!loadingPeriods &&
                  String(form.periodDate || "").trim() &&
                  !resolvedFiscalPeriod ? (
                  <div className="px-1 text-xs text-rose-600">
                    {l(
                      "No matching fiscal period for selected period date.",
                      "Secilen donem tarihi icin eslesen mali donem yok."
                    )}
                  </div>
                ) : null}
              </div>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Currency", "Para birimi")}
                </span>
                <input
                  value={form.currencyCode}
                  onChange={(event) =>
                    setFormField("currencyCode", event.target.value.toUpperCase())
                  }
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  maxLength={3}
                  placeholder={l("Currency", "Para birimi")}
                  required
                />
              </label>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Period date (donem tarihi)", "Donem tarihi (muhasebe/posting)")}
                </span>
                <input
                  type="date"
                  value={form.periodDate}
                  onChange={(event) => setFormField("periodDate", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  required
                />
              </label>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Document date", "Belge tarihi")}
                </span>
                <input
                  type="date"
                  value={form.documentDate}
                  onChange={(event) => setFormField("documentDate", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  required
                />
              </label>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Reference no", "Referans no")}
                </span>
                <input
                  value={form.referenceNo}
                  onChange={(event) => setFormField("referenceNo", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  placeholder={l("Reference no", "Referans no")}
                />
              </label>

              <label className="space-y-0.5">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Posting behavior", "Post davranisi")}
                </span>
                <span className="inline-flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.autoPost}
                    onChange={(event) => setFormField("autoPost", event.target.checked)}
                    disabled={!canPostJournal}
                  />
                  {l("Auto-post", "Otomatik post et")}
                </span>
              </label>

              <label className="space-y-0.5 md:col-span-2">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Cash control override", "Cash control override")}
                </span>
                <span className="inline-flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.overrideCashControl}
                    onChange={(event) => setFormField("overrideCashControl", event.target.checked)}
                    disabled={!canOverrideCashControl}
                  />
                  {l(
                    "Allow direct posting to cash-controlled account",
                    "Cash-controlled hesaba dogrudan post etmeye izin ver"
                  )}
                </span>
              </label>

              {form.overrideCashControl ? (
                <label className="space-y-0.5 md:col-span-2">
                  <span className="px-1 text-[10px] text-slate-500">
                    {l("Override reason (required)", "Override nedeni (zorunlu)")}
                  </span>
                  <input
                    value={form.overrideReason}
                    onChange={(event) => setFormField("overrideReason", event.target.value)}
                    className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                    placeholder={l("Provide override reason", "Override nedeni girin")}
                    required={form.overrideCashControl}
                  />
                </label>
              ) : null}

              <label className="space-y-0.5 md:col-span-4">
                <span className="px-1 text-[10px] text-slate-500">
                  {l("Description", "Aciklama")}
                </span>
                <input
                  value={form.description}
                  onChange={(event) => setFormField("description", event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                  placeholder={l("Description", "Aciklama")}
                />
              </label>
            </div>
          </section>

          <div className="min-h-0 basis-4/5 flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <section className="min-h-0 flex flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-700">{l("Lines", "Satirlar")}</h2>
                  <div className="text-[11px] text-slate-500">
                    {canReadTrialBalance
                      ? resolvedFiscalPeriodId
                        ? loadingAccountBalances
                          ? l("Account balances loading...", "Hesap bakiyeleri yukleniyor...")
                          : l("Account balances shown for resolved period", "Hesap bakiyeleri eslesen donem icin gosteriliyor")
                        : l("Select period date to load balances", "Bakiyeleri gormek icin donem tarihi secin")
                      : l("Balance preview requires gl.trial_balance.read", "Bakiye onizlemesi icin gl.trial_balance.read gerekir")}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {l(
                      "Shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+D fill-down description, Alt+B auto-balance focused Debit/Credit cell, Alt+K apply balance to focused Debit/Credit input.",
                      "Kisayollar: Ctrl/Cmd+S kaydet, Ctrl/Cmd+D aciklama kopyalar, Alt+B odaktaki Borc/Alacak hucresini otomatik dengeler, Alt+K bakiyeyi odaktaki Borc/Alacak alanina yazar."
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyFirstLineOperatingUnitToAll}
                    disabled={!canCopyFirstUnitToAll || lines.length <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {l("Copy first unit to all", "Ilk birimi tum satirlara kopyala")}
                  </button>
                  <button
                    type="button"
                    onClick={addLine}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {l("Add line", "Satir ekle")}
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <div className="overflow">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{l("Account", "Hesap")}</th>
                        <th className="px-3 py-2">{l("Unit", "Birim")}</th>
                        <th className="px-3 py-2">{l("Subledger Ref", "Alt Defter Ref")}</th>
                        <th className="px-3 py-2">{l("Counterparty", "Karsi taraf")}</th>
                        <th className="px-3 py-2">{l("Description", "Aciklama")}</th>
                        <th className="px-3 py-2">{l("Debit", "Borc")}</th>
                        <th className="px-3 py-2">{l("Credit", "Alacak")}</th>
                        <th className="px-3 py-2">{l("Action", "Islem")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr key={line.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <Combobox
                              value={line.accountId || null}
                              options={postableAccountOptions}
                              disabled={!canReadAccounts}
                              clearable={false}
                              placeholder={l("Search/select account", "Hesap ara/sec")}
                              noOptionsText={l("No account found.", "Hesap bulunamadi.")}
                              inputClassName="px-2 py-1.5 pr-14 text-xs"
                              listClassName="text-xs"
                              optionClassName="text-xs"
                              renderOption={renderAccountOption}
                              onChange={(nextValue) =>
                                updateLine(
                                  line.id,
                                  "accountId",
                                  nextValue ? String(nextValue) : ""
                                )
                              }
                            />
                            <div className="mt-1 text-[10px] text-slate-500">
                              {l("Balance", "Bakiye")}:{" "}
                              <span className="font-medium text-slate-700">
                                {formatLineAccountBalance(line.accountId)}
                              </span>
                              <button
                                type="button"
                                onClick={() => applyBalanceToLine(line.id)}
                                disabled={
                                  !toPositiveInt(line.accountId) ||
                                  !canReadTrialBalance ||
                                  !resolvedFiscalPeriodId ||
                                  loadingAccountBalances
                                }
                                className="ml-2 rounded border border-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                                title={l(
                                  "Apply account balance to focused debit/credit input (Alt+K)",
                                  "Hesap bakiyesini odaktaki borc/alacak alanina uygula (Alt+K)"
                                )}
                              >
                                {l("Apply", "Uygula")}
                              </button>
                            </div>
                          </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.operatingUnitId}
                            onChange={(event) => handleLineOperatingUnitChange(line.id, event.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                            disabled={!canReadOrgTree}
                          >
                              <option value="">{l("Optional", "Opsiyonel")}</option>
                              {operatingUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.code} - {unit.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={line.subledgerReferenceNo || ""}
                              onChange={(event) =>
                                updateLine(line.id, "subledgerReferenceNo", event.target.value)
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                              placeholder={
                                (unitsById.get(toPositiveInt(line.operatingUnitId))?.has_subledger ?? false)
                                  ? l("Required", "Zorunlu")
                                  : l("Optional", "Opsiyonel")
                              }
                              required={unitsById.get(toPositiveInt(line.operatingUnitId))?.has_subledger ?? false}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={line.counterpartyLegalEntityId}
                              onChange={(event) =>
                                updateLine(
                                  line.id,
                                  "counterpartyLegalEntityId",
                                  event.target.value
                                )
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                              disabled={!canReadOrgTree}
                            >
                              <option value="">{l("Optional", "Opsiyonel")}</option>
                              {legalEntities.map((entity) => (
                                <option key={entity.id} value={entity.id}>
                                  {entity.code} - {entity.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                          <input
                            value={line.description}
                            onChange={(event) =>
                              updateLine(line.id, "description", event.target.value)
                            }
                            onKeyDown={(event) => handleDescriptionFillDown(event, index, line.id)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                            placeholder={l(
                              `Line ${index + 1} description`,
                                `Satir ${index + 1} aciklamasi`
                              )}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.debitBase}
                              onChange={(event) =>
                                updateLine(line.id, "debitBase", event.target.value)
                              }
                              onFocus={() =>
                                setLineAmountFocusById((prev) => ({
                                  ...prev,
                                  [line.id]: "debit",
                                }))
                              }
                              onKeyDown={(event) => handleBalanceShortcut(event, line.id, "debit")}
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-xs"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.creditBase}
                              onChange={(event) =>
                                updateLine(line.id, "creditBase", event.target.value)
                              }
                              onFocus={() =>
                                setLineAmountFocusById((prev) => ({
                                  ...prev,
                                  [line.id]: "credit",
                                }))
                              }
                              onKeyDown={(event) => handleBalanceShortcut(event, line.id, "credit")}
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-xs"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              disabled={lines.length <= 2}
                              className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                            >
                              {l("Remove", "Kaldir")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {result && (
              <section className="border-t border-slate-200 px-4 py-3 text-sm">
                <h2 className="mb-2 font-semibold text-slate-800">{l("Last Created Entry", "Son Olusturulan Fis")}</h2>
                <div className="grid gap-1 text-slate-700">
                  <div>
                    {l("Journal ID:", "Fis ID:")} <span className="font-mono">{result.journalEntryId || "-"}</span>
                  </div>
                  <div>
                    {l("Journal No:", "Fis No:")} <span className="font-mono">{result.journalNo || "-"}</span>
                  </div>
                  <div>{l("Status:", "Durum:")} {result.posted ? "POSTED" : "DRAFT"}</div>
                </div>
              </section>
            )}
            <div className="shrink-0 border-t border-slate-200 bg-slate-50/95 backdrop-blur">
              <div className="flex items-center justify-end gap-4 px-4 py-2 text-xs font-semibold text-slate-700">
                <span className="mr-auto">{l("Totals", "Toplamlar")}</span>
                <span>
                  {l("Debit", "Borc")}: {formatAmount(totals.debit)}
                </span>
                <span>
                  {l("Credit", "Alacak")}: {formatAmount(totals.credit)}
                </span>
                {isBalanced ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    {l("Balanced", "Dengeli")}
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                    {l("Not balanced", "Dengede degil")}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-4 py-2.5">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  title={l(
                    "Save opening entry (Ctrl/Cmd+S)",
                    "Acilis fisini kaydet (Ctrl/Cmd+S)"
                  )}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting
                    ? l("Saving...", "Kaydediliyor...")
                    : form.autoPost && canPostJournal
                      ? l("Create and Post", "Olustur ve Post Et")
                      : l("Create Draft", "Taslak Olustur")}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

