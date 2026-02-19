import { useEffect, useMemo, useState } from "react";
import {
  closePeriod,
  createJournal,
  getJournal,
  getTrialBalance,
  listAccounts,
  listBooks,
  listJournals,
  postJournal,
  reverseJournal,
} from "../api/glAdmin.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";

const JOURNAL_SOURCE_TYPES = [
  "MANUAL",
  "SYSTEM",
  "INTERCOMPANY",
  "ELIMINATION",
  "ADJUSTMENT",
];
const JOURNAL_STATUSES = ["DRAFT", "POSTED", "REVERSED"];
const PERIOD_STATUSES = ["OPEN", "SOFT_CLOSED", "HARD_CLOSED"];

function toInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalInt(value) {
  if (value === undefined || value === null || value === "") return null;
  return toInt(value);
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

function createLine(defaultCurrencyCode = "USD", defaultAccountId = "", defaultUnitId = "") {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: defaultAccountId,
    operatingUnitId: defaultUnitId,
    counterpartyLegalEntityId: "",
    description: "",
    currencyCode: defaultCurrencyCode,
    amountTxn: "0",
    debitBase: "0",
    creditBase: "0",
    taxCode: "",
  };
}

export default function JournalWorkbenchPage() {
  const { hasPermission } = useAuth();

  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canReadJournals = hasPermission("gl.journal.read");
  const canCreate = hasPermission("gl.journal.create");
  const canPost = hasPermission("gl.journal.post");
  const canReverse = hasPermission("gl.journal.reverse");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const canClosePeriod = hasPermission("gl.period.close");

  const today = new Date().toISOString().slice(0, 10);

  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [entities, setEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [units, setUnits] = useState([]);
  const [periods, setPeriods] = useState([]);

  const [journal, setJournal] = useState({
    legalEntityId: "",
    bookId: "",
    fiscalPeriodId: "",
    entryDate: today,
    documentDate: today,
    currencyCode: "USD",
    sourceType: "MANUAL",
    description: "",
    referenceNo: "",
  });
  const [lines, setLines] = useState([createLine(), createLine()]);

  const [postId, setPostId] = useState("");
  const [reverseForm, setReverseForm] = useState({
    journalId: "",
    reversalPeriodId: "",
    autoPost: true,
    reason: "",
  });

  const [tbForm, setTbForm] = useState({ bookId: "", fiscalPeriodId: "" });
  const [tbRows, setTbRows] = useState([]);

  const [periodForm, setPeriodForm] = useState({
    bookId: "",
    periodId: "",
    status: "SOFT_CLOSED",
    note: "",
  });

  const [historyFilters, setHistoryFilters] = useState({
    legalEntityId: "",
    bookId: "",
    fiscalPeriodId: "",
    status: "",
    limit: "50",
    offset: "0",
  });
  const [historyPeriods, setHistoryPeriods] = useState([]);
  const [loadingHistoryPeriods, setLoadingHistoryPeriods] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [selectedJournalId, setSelectedJournalId] = useState("");
  const [selectedJournal, setSelectedJournal] = useState(null);

  const selectedLegalEntityId = toInt(journal.legalEntityId);
  const selectedBookId = toInt(journal.bookId);

  const lineTotals = useMemo(() => {
    const totals = lines.reduce(
      (acc, line) => {
        acc.debit += toAmount(line.debitBase);
        acc.credit += toAmount(line.creditBase);
        return acc;
      },
      { debit: 0, credit: 0 }
    );
    return { ...totals, balanced: Math.abs(totals.debit - totals.credit) < 0.0001 };
  }, [lines]);

  const tbTotals = useMemo(() => {
    return tbRows.reduce(
      (acc, row) => {
        acc.debit += toAmount(row.debit_total);
        acc.credit += toAmount(row.credit_total);
        acc.balance += toAmount(row.balance);
        return acc;
      },
      { debit: 0, credit: 0, balance: 0 }
    );
  }, [tbRows]);

  const historyLimit = toInt(historyFilters.limit) || 50;
  const historyOffset =
    Number.isInteger(Number(historyFilters.offset)) && Number(historyFilters.offset) >= 0
      ? Number(historyFilters.offset)
      : 0;
  const historyPage = Math.floor(historyOffset / historyLimit) + 1;
  const historyHasPrev = historyOffset > 0;
  const historyHasNext = historyOffset + historyRows.length < historyTotal;

  useEffect(() => {
    let cancelled = false;
    async function loadRefs() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) return;
      setLoadingRefs(true);
      setError("");
      try {
        const [entityRes, bookRes, accountRes, unitRes] = await Promise.all([
          canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
          canReadBooks
            ? listBooks(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
          canReadAccounts
            ? listAccounts(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
          canReadOrgTree
            ? listOperatingUnits(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) return;
        const entityRows = entityRes?.rows || [];
        const bookRows = bookRes?.rows || [];
        const accountRows = accountRes?.rows || [];
        const unitRows = unitRes?.rows || [];
        setEntities(entityRows);
        setBooks(bookRows);
        setAccounts(accountRows);
        setUnits(unitRows);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || "Failed to load references.");
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    }
    loadRefs();
    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, canReadBooks, canReadAccounts, selectedLegalEntityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadPeriodsByBook() {
      if (!canReadPeriods || !selectedBookId) {
        setPeriods([]);
        return;
      }
      const book = books.find((row) => Number(row.id) === selectedBookId);
      const calendarId = toInt(book?.calendar_id);
      if (!calendarId) {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      try {
        const res = await listFiscalPeriods(calendarId);
        if (cancelled) return;
        const rows = res?.rows || [];
        setPeriods(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || "Failed to load fiscal periods.");
        }
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    }
    loadPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, selectedBookId, books]);

  useEffect(() => {
    setJournal((prev) => {
      const currentEntityId = toInt(prev.legalEntityId);
      const currentBookId = toInt(prev.bookId);
      const nextEntityId =
        currentEntityId && (entities.length === 0 || hasId(entities, currentEntityId))
          ? String(currentEntityId)
          : String(entities[0]?.id || prev.legalEntityId || "");
      const nextBookId =
        currentBookId && (books.length === 0 || hasId(books, currentBookId))
          ? String(currentBookId)
          : String(books[0]?.id || prev.bookId || "");
      return { ...prev, legalEntityId: nextEntityId, bookId: nextBookId };
    });

    setTbForm((prev) => {
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setPeriodForm((prev) => {
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setHistoryFilters((prev) => {
      const currentEntityId = toInt(prev.legalEntityId);
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        legalEntityId:
          currentEntityId && (entities.length === 0 || hasId(entities, currentEntityId))
            ? String(currentEntityId)
            : String(entities[0]?.id || prev.legalEntityId || ""),
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setLines((prev) =>
      prev.map((line, index) => ({
        ...line,
        accountId:
          line.accountId || String(accounts[index]?.id || accounts[0]?.id || ""),
        operatingUnitId: line.operatingUnitId || String(units[0]?.id || ""),
        currencyCode: line.currencyCode || journal.currencyCode || "USD",
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, books, accounts, units]);

  useEffect(() => {
    setJournal((prev) => {
      const periodId = toInt(prev.fiscalPeriodId);
      if (periodId && hasId(periods, periodId)) return prev;
      return { ...prev, fiscalPeriodId: String(periods[0]?.id || prev.fiscalPeriodId || "") };
    });
    setTbForm((prev) => {
      const periodId = toInt(prev.fiscalPeriodId);
      if (periodId && hasId(periods, periodId)) return prev;
      return { ...prev, fiscalPeriodId: String(periods[0]?.id || prev.fiscalPeriodId || "") };
    });
    setPeriodForm((prev) => {
      const periodId = toInt(prev.periodId);
      if (periodId && hasId(periods, periodId)) return prev;
      return { ...prev, periodId: String(periods[0]?.id || prev.periodId || "") };
    });
  }, [periods]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistoryPeriodsByBook() {
      const historyBookId = toInt(historyFilters.bookId);
      if (!canReadPeriods || !historyBookId) {
        setHistoryPeriods([]);
        setHistoryFilters((prev) => ({
          ...prev,
          fiscalPeriodId: "",
        }));
        return;
      }

      const book = books.find((row) => Number(row.id) === historyBookId);
      const calendarId = toInt(book?.calendar_id);
      if (!calendarId) {
        setHistoryPeriods([]);
        setHistoryFilters((prev) => ({
          ...prev,
          fiscalPeriodId: "",
        }));
        return;
      }

      setLoadingHistoryPeriods(true);
      try {
        const res = await listFiscalPeriods(calendarId);
        if (cancelled) return;

        const rows = res?.rows || [];
        setHistoryPeriods(rows);
        setHistoryFilters((prev) => {
          const periodId = toInt(prev.fiscalPeriodId);
          if (periodId && hasId(rows, periodId)) {
            return prev;
          }
          return {
            ...prev,
            fiscalPeriodId: "",
          };
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message || "Failed to load history period options."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingHistoryPeriods(false);
        }
      }
    }

    loadHistoryPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, books, historyFilters.bookId]);

  async function fetchJournalHistory(filters = historyFilters) {
    if (!canReadJournals) return;
    setLoadingHistory(true);
    setError("");
    try {
      const params = {
        legalEntityId: toInt(filters.legalEntityId) || undefined,
        bookId: toInt(filters.bookId) || undefined,
        fiscalPeriodId: toInt(filters.fiscalPeriodId) || undefined,
        status: filters.status || undefined,
        limit: toInt(filters.limit) || 50,
        offset:
          Number.isInteger(Number(filters.offset)) && Number(filters.offset) >= 0
            ? Number(filters.offset)
            : 0,
      };
      const res = await listJournals(params);
      setHistoryRows(res?.rows || []);
      setHistoryTotal(Number(res?.total || 0));
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load journal history.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function onApplyHistoryFilters(event) {
    event.preventDefault();
    const nextFilters = {
      ...historyFilters,
      offset: "0",
    };
    setHistoryFilters(nextFilters);
    await fetchJournalHistory(nextFilters);
  }

  async function onChangeHistoryPage(direction) {
    const nextOffset = Math.max(0, historyOffset + direction * historyLimit);
    const nextFilters = {
      ...historyFilters,
      offset: String(nextOffset),
    };
    setHistoryFilters(nextFilters);
    await fetchJournalHistory(nextFilters);
  }

  async function loadJournalDetail(journalId) {
    const parsedId = toInt(journalId);
    if (!parsedId || !canReadJournals) return;
    setSaving("journalDetail");
    setError("");
    try {
      const res = await getJournal(parsedId);
      setSelectedJournalId(String(parsedId));
      setSelectedJournal(res?.row || null);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load journal detail.");
    } finally {
      setSaving("");
    }
  }

  function updateLine(lineId, field, value) {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line))
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      createLine(
        journal.currencyCode || "USD",
        String(accounts[0]?.id || ""),
        String(units[0]?.id || "")
      ),
    ]);
  }

  function removeLine(lineId) {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((line) => line.id !== lineId);
    });
  }

  async function onCreateJournal(event) {
    event.preventDefault();
    if (!canCreate) {
      setError("Missing permission: gl.journal.create");
      return;
    }

    const legalEntityId = toInt(journal.legalEntityId);
    const bookId = toInt(journal.bookId);
    const fiscalPeriodId = toInt(journal.fiscalPeriodId);
    if (!legalEntityId || !bookId || !fiscalPeriodId) {
      setError("legalEntityId, bookId and fiscalPeriodId are required.");
      return;
    }
    if (lines.length < 2) {
      setError("At least 2 lines are required.");
      return;
    }

    const payloadLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const row = lines[index];
      const accountId = toInt(row.accountId);
      if (!accountId) {
        setError(`Line ${index + 1}: accountId is required.`);
        return;
      }

      const operatingUnitId = toOptionalInt(row.operatingUnitId);
      if (row.operatingUnitId && !operatingUnitId) {
        setError(`Line ${index + 1}: operatingUnitId must be a positive integer.`);
        return;
      }

      const counterpartyLegalEntityId = toOptionalInt(row.counterpartyLegalEntityId);
      if (row.counterpartyLegalEntityId && !counterpartyLegalEntityId) {
        setError(
          `Line ${index + 1}: counterpartyLegalEntityId must be a positive integer.`
        );
        return;
      }

      const debitBase = toAmount(row.debitBase);
      const creditBase = toAmount(row.creditBase);
      if (debitBase < 0 || creditBase < 0) {
        setError(`Line ${index + 1}: debit/credit cannot be negative.`);
        return;
      }
      if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
        setError(
          `Line ${index + 1}: exactly one side must be > 0 (debit or credit).`
        );
        return;
      }

      payloadLines.push({
        accountId,
        operatingUnitId: operatingUnitId || undefined,
        counterpartyLegalEntityId: counterpartyLegalEntityId || undefined,
        description: row.description.trim() || undefined,
        currencyCode: String(row.currencyCode || journal.currencyCode || "USD")
          .trim()
          .toUpperCase(),
        amountTxn: toAmount(row.amountTxn),
        debitBase,
        creditBase,
        taxCode: row.taxCode.trim() || undefined,
      });
    }

    const totalDebit = payloadLines.reduce((sum, row) => sum + row.debitBase, 0);
    const totalCredit = payloadLines.reduce((sum, row) => sum + row.creditBase, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      setError("Journal is not balanced.");
      return;
    }

    setSaving("createJournal");
    setError("");
    setMessage("");
    try {
      const res = await createJournal({
        legalEntityId,
        bookId,
        fiscalPeriodId,
        entryDate: journal.entryDate,
        documentDate: journal.documentDate,
        currencyCode: journal.currencyCode.trim().toUpperCase(),
        sourceType: journal.sourceType,
        description: journal.description.trim() || undefined,
        referenceNo: journal.referenceNo.trim() || undefined,
        lines: payloadLines,
      });

      const createdId = String(res?.journalEntryId || "");
      setPostId(createdId);
      setReverseForm((prev) => ({ ...prev, journalId: createdId }));
      setMessage(
        `Draft journal created. ID: ${res?.journalEntryId || "-"}, No: ${res?.journalNo || "-"}`
      );

      if (canReadJournals) {
        await fetchJournalHistory({ ...historyFilters, offset: "0" });
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create journal.");
    } finally {
      setSaving("");
    }
  }

  async function onPostJournal(event) {
    event.preventDefault();
    if (!canPost) {
      setError("Missing permission: gl.journal.post");
      return;
    }

    const journalId = toInt(postId);
    if (!journalId) {
      setError("journalId is required.");
      return;
    }

    setSaving("postJournal");
    setError("");
    setMessage("");
    try {
      const res = await postJournal(journalId);
      setMessage(res?.posted ? "Journal posted." : "Journal not posted.");
      if (canReadJournals) {
        await fetchJournalHistory();
        if (selectedJournalId === String(journalId)) {
          await loadJournalDetail(journalId);
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to post journal.");
    } finally {
      setSaving("");
    }
  }

  async function onReverseJournal(event) {
    event.preventDefault();
    if (!canReverse) {
      setError("Missing permission: gl.journal.reverse");
      return;
    }

    const journalId = toInt(reverseForm.journalId);
    if (!journalId) {
      setError("journalId is required.");
      return;
    }

    const reversalPeriodId = toOptionalInt(reverseForm.reversalPeriodId);
    if (reverseForm.reversalPeriodId && !reversalPeriodId) {
      setError("reversalPeriodId must be a positive integer.");
      return;
    }

    setSaving("reverseJournal");
    setError("");
    setMessage("");
    try {
      const res = await reverseJournal(journalId, {
        reversalPeriodId: reversalPeriodId || undefined,
        autoPost: Boolean(reverseForm.autoPost),
        reason: reverseForm.reason.trim() || undefined,
      });
      setMessage(
        `Journal reversed. Original: ${journalId}, Reversal: ${res?.reversalJournalId || "-"}`
      );
      if (canReadJournals) {
        await fetchJournalHistory();
        if (selectedJournalId === String(journalId)) {
          await loadJournalDetail(journalId);
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to reverse journal.");
    } finally {
      setSaving("");
    }
  }

  async function onTrialBalance(event) {
    event.preventDefault();
    if (!canReadTrialBalance) {
      setError("Missing permission: gl.trial_balance.read");
      return;
    }

    const bookId = toInt(tbForm.bookId);
    const fiscalPeriodId = toInt(tbForm.fiscalPeriodId);
    if (!bookId || !fiscalPeriodId) {
      setError("bookId and fiscalPeriodId are required.");
      return;
    }

    setSaving("trialBalance");
    setError("");
    setMessage("");
    try {
      const res = await getTrialBalance({ bookId, fiscalPeriodId });
      setTbRows(res?.rows || []);
      setMessage("Trial balance loaded.");
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load trial balance.");
    } finally {
      setSaving("");
    }
  }

  async function onUpdatePeriodStatus(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError("Missing permission: gl.period.close");
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError("bookId and periodId are required.");
      return;
    }

    setSaving("periodStatus");
    setError("");
    setMessage("");
    try {
      const res = await closePeriod(bookId, periodId, {
        status: periodForm.status,
        note: periodForm.note.trim() || undefined,
      });
      setMessage(
        `Period status updated: ${res?.previousStatus || "-"} -> ${res?.status || "-"}`
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update period status.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Journal Workbench</h1>
        <p className="mt-1 text-sm text-slate-600">
          Assisted journal lines with account/unit pickers, posting/reversal, trial balance, period status, and journal history.
        </p>
      </div>

      {(loadingRefs || loadingPeriods) && <div className="text-xs text-slate-500">Loading references...</div>}
      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Create Draft Journal</h2>
        <form onSubmit={onCreateJournal} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <input type="number" min={1} value={journal.legalEntityId} onChange={(event) => setJournal((prev) => ({ ...prev, legalEntityId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Legal entity ID" required />
            <input type="number" min={1} value={journal.bookId} onChange={(event) => setJournal((prev) => ({ ...prev, bookId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Book ID" required />
            <input type="number" min={1} value={journal.fiscalPeriodId} onChange={(event) => setJournal((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Fiscal period ID" required />
            <input value={journal.currencyCode} onChange={(event) => setJournal((prev) => ({ ...prev, currencyCode: event.target.value.toUpperCase() }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Currency" maxLength={3} required />
            <input type="date" value={journal.entryDate} onChange={(event) => setJournal((prev) => ({ ...prev, entryDate: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            <input type="date" value={journal.documentDate} onChange={(event) => setJournal((prev) => ({ ...prev, documentDate: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            <select value={journal.sourceType} onChange={(event) => setJournal((prev) => ({ ...prev, sourceType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
              {JOURNAL_SOURCE_TYPES.map((sourceType) => <option key={sourceType} value={sourceType}>{sourceType}</option>)}
            </select>
            <input value={journal.referenceNo} onChange={(event) => setJournal((prev) => ({ ...prev, referenceNo: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Reference no" />
            <input value={journal.description} onChange={(event) => setJournal((prev) => ({ ...prev, description: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-4" placeholder="Description" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2">Unit</th>
                  <th className="px-2 py-2">Counterparty LE</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Currency</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Debit</th>
                  <th className="px-2 py-2">Credit</th>
                  <th className="px-2 py-2">Tax</th>
                  <th className="px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 text-slate-500">{index + 1}</td>
                    <td className="px-2 py-2">
                      {accounts.length > 0 ? (
                        <select value={line.accountId} onChange={(event) => updateLine(line.id, "accountId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" required>
                          <option value="">Account</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                        </select>
                      ) : (
                        <input type="number" min={1} value={line.accountId} onChange={(event) => updateLine(line.id, "accountId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="Account ID" required />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {units.length > 0 ? (
                        <select value={line.operatingUnitId} onChange={(event) => updateLine(line.id, "operatingUnitId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">-</option>
                          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}
                        </select>
                      ) : (
                        <input type="number" min={1} value={line.operatingUnitId} onChange={(event) => updateLine(line.id, "operatingUnitId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="Unit ID" />
                      )}
                    </td>
                    <td className="px-2 py-2"><input type="number" min={1} value={line.counterpartyLegalEntityId} onChange={(event) => updateLine(line.id, "counterpartyLegalEntityId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="Optional" /></td>
                    <td className="px-2 py-2"><input value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.currencyCode} onChange={(event) => updateLine(line.id, "currencyCode", event.target.value.toUpperCase())} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" maxLength={3} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.amountTxn} onChange={(event) => updateLine(line.id, "amountTxn", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.debitBase} onChange={(event) => updateLine(line.id, "debitBase", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.creditBase} onChange={(event) => updateLine(line.id, "creditBase", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.taxCode} onChange={(event) => updateLine(line.id, "taxCode", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><button type="button" onClick={() => removeLine(line.id)} disabled={lines.length <= 2} className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={addLine} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Add Line</button>
            <div className="text-xs text-slate-700">Debit: {formatAmount(lineTotals.debit)} | Credit: {formatAmount(lineTotals.credit)} | <span className={lineTotals.balanced ? "text-emerald-700" : "text-rose-700"}>{lineTotals.balanced ? "Balanced" : "Not Balanced"}</span></div>
            <button type="submit" disabled={saving === "createJournal" || !canCreate} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "createJournal" ? "Creating..." : "Create Draft"}</button>
          </div>
        </form>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onPostJournal} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Post Journal</h2>
          <input type="number" min={1} value={postId} onChange={(event) => setPostId(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Journal ID" required />
          <button type="submit" disabled={saving === "postJournal" || !canPost} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "postJournal" ? "Posting..." : "Post"}</button>
        </form>

        <form onSubmit={onReverseJournal} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Reverse Journal</h2>
          <input type="number" min={1} value={reverseForm.journalId} onChange={(event) => setReverseForm((prev) => ({ ...prev, journalId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Journal ID" required />
          <input type="number" min={1} value={reverseForm.reversalPeriodId} onChange={(event) => setReverseForm((prev) => ({ ...prev, reversalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Reversal period ID (optional)" />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reverseForm.autoPost} onChange={(event) => setReverseForm((prev) => ({ ...prev, autoPost: event.target.checked }))} />Auto-post reversal</label>
          <input value={reverseForm.reason} onChange={(event) => setReverseForm((prev) => ({ ...prev, reason: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Reason (optional)" />
          <button type="submit" disabled={saving === "reverseJournal" || !canReverse} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "reverseJournal" ? "Reversing..." : "Reverse"}</button>
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onTrialBalance} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Trial Balance</h2>
          <input type="number" min={1} value={tbForm.bookId} onChange={(event) => setTbForm((prev) => ({ ...prev, bookId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Book ID" required />
          <input type="number" min={1} value={tbForm.fiscalPeriodId} onChange={(event) => setTbForm((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Fiscal period ID" required />
          <button type="submit" disabled={saving === "trialBalance" || !canReadTrialBalance} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "trialBalance" ? "Loading..." : "Run"}</button>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">Account</th><th className="px-2 py-2">Debit</th><th className="px-2 py-2">Credit</th><th className="px-2 py-2">Balance</th></tr></thead>
              <tbody>
                {tbRows.map((row) => <tr key={row.account_id} className="border-t border-slate-100"><td className="px-2 py-2">{row.account_code} - {row.account_name}</td><td className="px-2 py-2">{formatAmount(row.debit_total)}</td><td className="px-2 py-2">{formatAmount(row.credit_total)}</td><td className="px-2 py-2">{formatAmount(row.balance)}</td></tr>)}
                {tbRows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">No trial balance rows.</td></tr>}
              </tbody>
              {tbRows.length > 0 && <tfoot><tr className="border-t bg-slate-50 font-semibold text-slate-700"><td className="px-2 py-2">Totals</td><td className="px-2 py-2">{formatAmount(tbTotals.debit)}</td><td className="px-2 py-2">{formatAmount(tbTotals.credit)}</td><td className="px-2 py-2">{formatAmount(tbTotals.balance)}</td></tr></tfoot>}
            </table>
          </div>
        </form>

        <form onSubmit={onUpdatePeriodStatus} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Period Status</h2>
          <input type="number" min={1} value={periodForm.bookId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, bookId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Book ID" required />
          <input type="number" min={1} value={periodForm.periodId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, periodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Period ID" required />
          <select value={periodForm.status} onChange={(event) => setPeriodForm((prev) => ({ ...prev, status: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">{PERIOD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
          <input value={periodForm.note} onChange={(event) => setPeriodForm((prev) => ({ ...prev, note: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Note (optional)" />
          <button type="submit" disabled={saving === "periodStatus" || !canClosePeriod} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "periodStatus" ? "Saving..." : "Update"}</button>
        </form>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Journal History</h2>
          <button
            type="button"
            onClick={() => fetchJournalHistory()}
            disabled={loadingHistory || !canReadJournals}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingHistory ? "Loading..." : "Load Journals"}
          </button>
        </div>

        <form onSubmit={onApplyHistoryFilters} className="grid gap-2 md:grid-cols-6">
          <select
            value={historyFilters.legalEntityId}
            onChange={(event) =>
              setHistoryFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All legal entities</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.code} - {entity.name}
              </option>
            ))}
          </select>
          <select
            value={historyFilters.bookId}
            onChange={(event) =>
              setHistoryFilters((prev) => ({ ...prev, bookId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All books</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.code} - {book.name}
              </option>
            ))}
          </select>
          <select
            value={historyFilters.fiscalPeriodId}
            onChange={(event) =>
              setHistoryFilters((prev) => ({
                ...prev,
                fiscalPeriodId: event.target.value,
              }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            disabled={loadingHistoryPeriods}
          >
            <option value="">All periods</option>
            {historyPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.fiscal_year}-P{String(period.period_no).padStart(2, "0")} ({period.period_name})
              </option>
            ))}
          </select>
          <select
            value={historyFilters.status}
            onChange={(event) =>
              setHistoryFilters((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {JOURNAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            value={historyFilters.limit}
            onChange={(event) =>
              setHistoryFilters((prev) => ({ ...prev, limit: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
          <button
            type="submit"
            disabled={loadingHistory || !canReadJournals}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Apply Filters
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Total rows: {historyTotal}</span>
          <span>Page {historyPage}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeHistoryPage(-1)}
              disabled={!historyHasPrev || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => onChangeHistoryPage(1)}
              disabled={!historyHasNext || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Debit</th>
                  <th className="px-3 py-2">Credit</th>
                  <th className="px-3 py-2">Lines</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.id} className={`border-t border-slate-100 ${selectedJournalId === String(row.id) ? "bg-cyan-50/50" : ""}`}>
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.journal_no}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.entry_date}</td>
                    <td className="px-3 py-2">{formatAmount(row.total_debit_base)}</td>
                    <td className="px-3 py-2">{formatAmount(row.total_credit_base)}</td>
                    <td className="px-3 py-2">{row.line_count}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => loadJournalDetail(row.id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">View</button>
                    </td>
                  </tr>
                ))}
                {historyRows.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">No journal rows loaded.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-700">Journal Detail</h3>
            {!selectedJournal && <p className="mt-2 text-xs text-slate-500">Select a journal row to load detail and lines.</p>}
            {selectedJournal && (
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                <div>ID: {selectedJournal.id}</div>
                <div>No: {selectedJournal.journal_no}</div>
                <div>Status: {selectedJournal.status}</div>
                <div>Entity: {selectedJournal.legal_entity_code}</div>
                <div>Book: {selectedJournal.book_code}</div>
                <div>Period: {selectedJournal.fiscal_year}-P{String(selectedJournal.period_no || "").padStart(2, "0")}</div>
                <div>Lines: {(selectedJournal.lines || []).length}</div>
                <div className="max-h-52 overflow-auto rounded border border-slate-200">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Account</th><th className="px-2 py-1.5">Debit</th><th className="px-2 py-1.5">Credit</th></tr></thead>
                    <tbody>
                      {(selectedJournal.lines || []).map((line) => (
                        <tr key={line.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">{line.line_no}</td>
                          <td className="px-2 py-1.5">{line.account_code} - {line.account_name}</td>
                          <td className="px-2 py-1.5">{formatAmount(line.debit_base)}</td>
                          <td className="px-2 py-1.5">{formatAmount(line.credit_base)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
