import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closePeriod,
  createJournal,
  getJournal,
  listPeriodCloseRuns,
  getTrialBalance,
  listAccounts,
  listBooks,
  listJournals,
  postJournal,
  reopenPeriodClose,
  reverseJournal,
  runPeriodClose,
} from "../api/glAdmin.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";

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
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);

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
  const [periodCloseForm, setPeriodCloseForm] = useState({
    closeStatus: "SOFT_CLOSED",
    retainedEarningsAccountId: "",
    note: "",
    reopenReason: "",
  });
  const [periodCloseRuns, setPeriodCloseRuns] = useState([]);

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
  const trialBalanceBookId = toInt(tbForm.bookId);
  const periodActionBookId = toInt(periodForm.bookId);
  const canUseTbPeriodLookup =
    periods.length > 0 && trialBalanceBookId && trialBalanceBookId === selectedBookId;
  const canUsePeriodActionLookup =
    periods.length > 0 && periodActionBookId && periodActionBookId === selectedBookId;

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
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load references.", "Referanslar yuklenemedi."));
        }
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    }
    loadRefs();
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
          setError(
            err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    }
    loadPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, selectedBookId, books, l]);

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
            err?.response?.data?.message ||
              l("Failed to load history period options.", "Gecmis donem secenekleri yuklenemedi.")
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
  }, [canReadPeriods, books, historyFilters.bookId, l]);

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
      setError(err?.response?.data?.message || l("Failed to load journal history.", "Fis gecmisi yuklenemedi."));
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
      setError(err?.response?.data?.message || l("Failed to load journal detail.", "Fis detayi yuklenemedi."));
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
      setError(l("Missing permission: gl.journal.create", "Eksik yetki: gl.journal.create"));
      return;
    }

    const legalEntityId = toInt(journal.legalEntityId);
    const bookId = toInt(journal.bookId);
    const fiscalPeriodId = toInt(journal.fiscalPeriodId);
    if (!legalEntityId || !bookId || !fiscalPeriodId) {
      setError(
        l(
          "legalEntityId, bookId and fiscalPeriodId are required.",
          "legalEntityId, bookId ve fiscalPeriodId zorunludur."
        )
      );
      return;
    }
    if (lines.length < 2) {
      setError(l("At least 2 lines are required.", "En az 2 satir gereklidir."));
      return;
    }

    const payloadLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const row = lines[index];
      const accountId = toInt(row.accountId);
      if (!accountId) {
        setError(l(`Line ${index + 1}: accountId is required.`, `Satir ${index + 1}: accountId zorunludur.`));
        return;
      }

      const operatingUnitId = toOptionalInt(row.operatingUnitId);
      if (row.operatingUnitId && !operatingUnitId) {
        setError(
          l(
            `Line ${index + 1}: operatingUnitId must be a positive integer.`,
            `Satir ${index + 1}: operatingUnitId pozitif bir tam sayi olmali.`
          )
        );
        return;
      }

      const counterpartyLegalEntityId = toOptionalInt(row.counterpartyLegalEntityId);
      if (row.counterpartyLegalEntityId && !counterpartyLegalEntityId) {
        setError(
          l(
            `Line ${index + 1}: counterpartyLegalEntityId must be a positive integer.`,
            `Satir ${index + 1}: counterpartyLegalEntityId pozitif bir tam sayi olmali.`
          )
        );
        return;
      }

      const debitBase = toAmount(row.debitBase);
      const creditBase = toAmount(row.creditBase);
      if (debitBase < 0 || creditBase < 0) {
        setError(
          l(
            `Line ${index + 1}: debit/credit cannot be negative.`,
            `Satir ${index + 1}: borc/alacak negatif olamaz.`
          )
        );
        return;
      }
      if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
        setError(
          l(
            `Line ${index + 1}: exactly one side must be > 0 (debit or credit).`,
            `Satir ${index + 1}: yalnizca bir taraf > 0 olmali (borc veya alacak).`
          )
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
      setError(l("Journal is not balanced.", "Fis dengede degil."));
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
        l(
          `Draft journal created. ID: ${res?.journalEntryId || "-"}, No: ${res?.journalNo || "-"}`,
          `Taslak fis olusturuldu. ID: ${res?.journalEntryId || "-"}, No: ${res?.journalNo || "-"}`
        )
      );

      if (canReadJournals) {
        await fetchJournalHistory({ ...historyFilters, offset: "0" });
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to create journal.", "Fis olusturulamadi."));
    } finally {
      setSaving("");
    }
  }

  async function onPostJournal(event) {
    event.preventDefault();
    if (!canPost) {
      setError(l("Missing permission: gl.journal.post", "Eksik yetki: gl.journal.post"));
      return;
    }

    const journalId = toInt(postId);
    if (!journalId) {
      setError(l("journalId is required.", "journalId zorunludur."));
      return;
    }

    setSaving("postJournal");
    setError("");
    setMessage("");
    try {
      const res = await postJournal(journalId);
      setMessage(
        res?.posted ? l("Journal posted.", "Fis post edildi.") : l("Journal not posted.", "Fis post edilmedi.")
      );
      if (canReadJournals) {
        await fetchJournalHistory();
        if (selectedJournalId === String(journalId)) {
          await loadJournalDetail(journalId);
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to post journal.", "Fis post edilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function onReverseJournal(event) {
    event.preventDefault();
    if (!canReverse) {
      setError(l("Missing permission: gl.journal.reverse", "Eksik yetki: gl.journal.reverse"));
      return;
    }

    const journalId = toInt(reverseForm.journalId);
    if (!journalId) {
      setError(l("journalId is required.", "journalId zorunludur."));
      return;
    }

    const reversalPeriodId = toOptionalInt(reverseForm.reversalPeriodId);
    if (reverseForm.reversalPeriodId && !reversalPeriodId) {
      setError(l("reversalPeriodId must be a positive integer.", "reversalPeriodId pozitif bir tam sayi olmali."));
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
        l(
          `Journal reversed. Original: ${journalId}, Reversal: ${res?.reversalJournalId || "-"}`,
          `Fis ters kaydedildi. Orijinal: ${journalId}, Ters Kayit: ${res?.reversalJournalId || "-"}`
        )
      );
      if (canReadJournals) {
        await fetchJournalHistory();
        if (selectedJournalId === String(journalId)) {
          await loadJournalDetail(journalId);
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to reverse journal.", "Fis ters kaydi yapilamadi."));
    } finally {
      setSaving("");
    }
  }

  async function onTrialBalance(event) {
    event.preventDefault();
    if (!canReadTrialBalance) {
      setError(l("Missing permission: gl.trial_balance.read", "Eksik yetki: gl.trial_balance.read"));
      return;
    }

    const bookId = toInt(tbForm.bookId);
    const fiscalPeriodId = toInt(tbForm.fiscalPeriodId);
    if (!bookId || !fiscalPeriodId) {
      setError(l("bookId and fiscalPeriodId are required.", "bookId ve fiscalPeriodId zorunludur."));
      return;
    }

    setSaving("trialBalance");
    setError("");
    setMessage("");
    try {
      const res = await getTrialBalance({ bookId, fiscalPeriodId });
      setTbRows(res?.rows || []);
      setMessage(l("Trial balance loaded.", "Mizan yuklendi."));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load trial balance.", "Mizan yuklenemedi."));
    } finally {
      setSaving("");
    }
  }

  async function onUpdatePeriodStatus(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
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
        l(
          `Period status updated: ${res?.previousStatus || "-"} -> ${res?.status || "-"}`,
          `Donem durumu guncellendi: ${res?.previousStatus || "-"} -> ${res?.status || "-"}`
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to update period status.", "Donem durumu guncellenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onLoadPeriodCloseRuns() {
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    setSaving("periodCloseRuns");
    setError("");
    try {
      const res = await listPeriodCloseRuns({
        bookId,
        fiscalPeriodId: periodId,
        includeLines: true,
      });
      setPeriodCloseRuns(res?.rows || []);
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to load period close runs.", "Donem kapanis calismalari yuklenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onExecutePeriodClose(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    const retainedEarningsAccountId = toOptionalInt(
      periodCloseForm.retainedEarningsAccountId
    );
    if (periodCloseForm.retainedEarningsAccountId && !retainedEarningsAccountId) {
      setError(
        l(
          "retainedEarningsAccountId must be a positive integer.",
          "retainedEarningsAccountId pozitif bir tam sayi olmali."
        )
      );
      return;
    }

    setSaving("periodCloseRun");
    setError("");
    setMessage("");
    try {
      const res = await runPeriodClose(bookId, periodId, {
        closeStatus: periodCloseForm.closeStatus,
        retainedEarningsAccountId: retainedEarningsAccountId || undefined,
        note: periodCloseForm.note.trim() || undefined,
      });

      const runId = res?.run?.id || "-";
      const carryLineCount = Number(res?.carryForwardLineCount || 0);
      const yearEndLineCount = Number(res?.yearEndLineCount || 0);
      setMessage(
        res?.idempotent
          ? l(
              `Period close idempotent hit. Run #${runId} reused.`,
              `Donem kapanis idempotent sonuc verdi. #${runId} tekrar kullanildi.`
            )
          : l(
              `Period close completed. Run #${runId}, carry lines=${carryLineCount}, year-end lines=${yearEndLineCount}.`,
              `Donem kapanis tamamlandi. Run #${runId}, devir satirlari=${carryLineCount}, yil sonu satirlari=${yearEndLineCount}.`
            )
      );

      await onLoadPeriodCloseRuns();
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to execute period close run.", "Donem kapanis calismasi baslatilamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onReopenPeriodClose(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    const reason = periodCloseForm.reopenReason.trim();
    if (!reason) {
      setError(l("reopen reason is required.", "yeniden acma nedeni zorunludur."));
      return;
    }

    setSaving("periodReopen");
    setError("");
    setMessage("");
    try {
      const res = await reopenPeriodClose(bookId, periodId, { reason });
      const reversalIds = Array.isArray(res?.reversalJournalEntryIds)
        ? res.reversalJournalEntryIds
        : [];
      setMessage(
        l(
          `Period reopened. Reversal journals: ${reversalIds.length > 0 ? reversalIds.join(", ") : "none"}.`,
          `Donem yeniden acildi. Ters fisler: ${reversalIds.length > 0 ? reversalIds.join(", ") : "yok"}.`
        )
      );
      await onLoadPeriodCloseRuns();
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to reopen period close run.", "Donem kapanis calismasi yeniden acilamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{l("Journal Workbench", "Fis Calisma Ekrani")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Assisted journal lines with account/unit pickers, posting/reversal, trial balance, period status, and journal history.",
            "Hesap/birim secicileri, post/ters kayit, mizan, donem durumu ve fis gecmisi ile destekli fis satirlari."
          )}
        </p>
      </div>

      {(loadingRefs || loadingPeriods) && (
        <div className="text-xs text-slate-500">{l("Loading references...", "Referanslar yukleniyor...")}</div>
      )}
      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Create Draft Journal", "Taslak Fis Olustur")}</h2>
        <form onSubmit={onCreateJournal} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            {entities.length > 0 ? (
              <select value={journal.legalEntityId} onChange={(event) => setJournal((prev) => ({ ...prev, legalEntityId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.code} - {entity.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={journal.legalEntityId} onChange={(event) => setJournal((prev) => ({ ...prev, legalEntityId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Legal entity ID", "Istirak / bagli ortak ID")} required />
            )}
            {books.length > 0 ? (
              <select value={journal.bookId} onChange={(event) => setJournal((prev) => ({ ...prev, bookId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">{l("Select book", "Defter secin")}</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.code} - {book.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={journal.bookId} onChange={(event) => setJournal((prev) => ({ ...prev, bookId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Book ID", "Defter ID")} required />
            )}
            {periods.length > 0 ? (
              <select value={journal.fiscalPeriodId} onChange={(event) => setJournal((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">{l("Select fiscal period", "Mali donem secin")}</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.fiscal_year}-P{String(period.period_no).padStart(2, "0")} ({period.period_name})
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={journal.fiscalPeriodId} onChange={(event) => setJournal((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Fiscal period ID", "Mali donem ID")} required />
            )}
            <input value={journal.currencyCode} onChange={(event) => setJournal((prev) => ({ ...prev, currencyCode: event.target.value.toUpperCase() }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Currency", "Para birimi")} maxLength={3} required />
            <input type="date" value={journal.entryDate} onChange={(event) => setJournal((prev) => ({ ...prev, entryDate: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            <input type="date" value={journal.documentDate} onChange={(event) => setJournal((prev) => ({ ...prev, documentDate: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required />
            <select value={journal.sourceType} onChange={(event) => setJournal((prev) => ({ ...prev, sourceType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
              {JOURNAL_SOURCE_TYPES.map((sourceType) => <option key={sourceType} value={sourceType}>{sourceType}</option>)}
            </select>
            <input value={journal.referenceNo} onChange={(event) => setJournal((prev) => ({ ...prev, referenceNo: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Reference no", "Referans no")} />
            <input value={journal.description} onChange={(event) => setJournal((prev) => ({ ...prev, description: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-4" placeholder={l("Description", "Aciklama")} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">{l("Account", "Hesap")}</th>
                  <th className="px-2 py-2">{l("Unit", "Birim")}</th>
                  <th className="px-2 py-2">{l("Counterparty LE", "Karsi taraf HU")}</th>
                  <th className="px-2 py-2">{l("Description", "Aciklama")}</th>
                  <th className="px-2 py-2">{l("Currency", "Para birimi")}</th>
                  <th className="px-2 py-2">{l("Amount", "Tutar")}</th>
                  <th className="px-2 py-2">{l("Debit", "Borc")}</th>
                  <th className="px-2 py-2">{l("Credit", "Alacak")}</th>
                  <th className="px-2 py-2">{l("Tax", "Vergi")}</th>
                  <th className="px-2 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 text-slate-500">{index + 1}</td>
                    <td className="px-2 py-2">
                      {accounts.length > 0 ? (
                        <select value={line.accountId} onChange={(event) => updateLine(line.id, "accountId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" required>
                          <option value="">{l("Account", "Hesap")}</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                        </select>
                      ) : (
                        <input type="number" min={1} value={line.accountId} onChange={(event) => updateLine(line.id, "accountId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder={l("Account ID", "Hesap ID")} required />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {units.length > 0 ? (
                        <select value={line.operatingUnitId} onChange={(event) => updateLine(line.id, "operatingUnitId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">-</option>
                          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}
                        </select>
                      ) : (
                        <input type="number" min={1} value={line.operatingUnitId} onChange={(event) => updateLine(line.id, "operatingUnitId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder={l("Unit ID", "Birim ID")} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {entities.length > 0 ? (
                        <select value={line.counterpartyLegalEntityId} onChange={(event) => updateLine(line.id, "counterpartyLegalEntityId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {entities.map((entity) => (
                            <option key={entity.id} value={entity.id}>
                              {entity.code} - {entity.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input type="number" min={1} value={line.counterpartyLegalEntityId} onChange={(event) => updateLine(line.id, "counterpartyLegalEntityId", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder={l("Optional", "Opsiyonel")} />
                      )}
                    </td>
                    <td className="px-2 py-2"><input value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.currencyCode} onChange={(event) => updateLine(line.id, "currencyCode", event.target.value.toUpperCase())} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" maxLength={3} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.amountTxn} onChange={(event) => updateLine(line.id, "amountTxn", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.debitBase} onChange={(event) => updateLine(line.id, "debitBase", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.creditBase} onChange={(event) => updateLine(line.id, "creditBase", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.taxCode} onChange={(event) => updateLine(line.id, "taxCode", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><button type="button" onClick={() => removeLine(line.id)} disabled={lines.length <= 2} className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50">{l("Remove", "Kaldir")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={addLine} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{l("Add Line", "Satir Ekle")}</button>
            <div className="text-xs text-slate-700">{l("Debit", "Borc")}: {formatAmount(lineTotals.debit)} | {l("Credit", "Alacak")}: {formatAmount(lineTotals.credit)} | <span className={lineTotals.balanced ? "text-emerald-700" : "text-rose-700"}>{lineTotals.balanced ? l("Balanced", "Dengeli") : l("Not Balanced", "Dengede Degil")}</span></div>
            <button type="submit" disabled={saving === "createJournal" || !canCreate} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "createJournal" ? l("Creating...", "Olusturuluyor...") : l("Create Draft", "Taslak Olustur")}</button>
          </div>
        </form>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onPostJournal} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Post Journal", "Fisi Post Et")}</h2>
          <input type="number" min={1} value={postId} onChange={(event) => setPostId(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Journal ID", "Fis ID")} required />
          <button type="submit" disabled={saving === "postJournal" || !canPost} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "postJournal" ? l("Posting...", "Post ediliyor...") : l("Post", "Post Et")}</button>
        </form>

        <form onSubmit={onReverseJournal} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Reverse Journal", "Ters Fis Kaydi")}</h2>
          <input type="number" min={1} value={reverseForm.journalId} onChange={(event) => setReverseForm((prev) => ({ ...prev, journalId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Journal ID", "Fis ID")} required />
          {periods.length > 0 ? (
            <select value={reverseForm.reversalPeriodId} onChange={(event) => setReverseForm((prev) => ({ ...prev, reversalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="">{l("Reversal period (optional)", "Ters kayit donemi (opsiyonel)")}</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.fiscal_year}-P{String(period.period_no).padStart(2, "0")} ({period.period_name})
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={1} value={reverseForm.reversalPeriodId} onChange={(event) => setReverseForm((prev) => ({ ...prev, reversalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Reversal period ID (optional)", "Ters kayit donem ID (opsiyonel)")} />
          )}
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reverseForm.autoPost} onChange={(event) => setReverseForm((prev) => ({ ...prev, autoPost: event.target.checked }))} />{l("Auto-post reversal", "Ters kaydi otomatik post et")}</label>
          <input value={reverseForm.reason} onChange={(event) => setReverseForm((prev) => ({ ...prev, reason: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Reason (optional)", "Neden (opsiyonel)")} />
          <button type="submit" disabled={saving === "reverseJournal" || !canReverse} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "reverseJournal" ? l("Reversing...", "Ters kayit yapiliyor...") : l("Reverse", "Ters Kayit")}</button>
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onTrialBalance} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Trial Balance", "Mizan")}</h2>
          {books.length > 0 ? (
            <select value={tbForm.bookId} onChange={(event) => setTbForm((prev) => ({ ...prev, bookId: event.target.value, fiscalPeriodId: "" }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select book", "Defter secin")}</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.code} - {book.name}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={1} value={tbForm.bookId} onChange={(event) => setTbForm((prev) => ({ ...prev, bookId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Book ID", "Defter ID")} required />
          )}
          {canUseTbPeriodLookup ? (
            <select value={tbForm.fiscalPeriodId} onChange={(event) => setTbForm((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select fiscal period", "Mali donem secin")}</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.fiscal_year}-P{String(period.period_no).padStart(2, "0")} ({period.period_name})
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={1} value={tbForm.fiscalPeriodId} onChange={(event) => setTbForm((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Fiscal period ID", "Mali donem ID")} required />
          )}
          <button type="submit" disabled={saving === "trialBalance" || !canReadTrialBalance} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "trialBalance" ? l("Loading...", "Yukleniyor...") : l("Run", "Calistir")}</button>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">{l("Account", "Hesap")}</th><th className="px-2 py-2">{l("Debit", "Borc")}</th><th className="px-2 py-2">{l("Credit", "Alacak")}</th><th className="px-2 py-2">{l("Balance", "Bakiye")}</th></tr></thead>
              <tbody>
                {tbRows.map((row) => <tr key={row.account_id} className="border-t border-slate-100"><td className="px-2 py-2">{row.account_code} - {row.account_name}</td><td className="px-2 py-2">{formatAmount(row.debit_total)}</td><td className="px-2 py-2">{formatAmount(row.credit_total)}</td><td className="px-2 py-2">{formatAmount(row.balance)}</td></tr>)}
                {tbRows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">{l("No trial balance rows.", "Mizan satiri yok.")}</td></tr>}
              </tbody>
              {tbRows.length > 0 && <tfoot><tr className="border-t bg-slate-50 font-semibold text-slate-700"><td className="px-2 py-2">{l("Totals", "Toplamlar")}</td><td className="px-2 py-2">{formatAmount(tbTotals.debit)}</td><td className="px-2 py-2">{formatAmount(tbTotals.credit)}</td><td className="px-2 py-2">{formatAmount(tbTotals.balance)}</td></tr></tfoot>}
            </table>
          </div>
        </form>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Period Status & Auto Close", "Donem Durumu ve Otomatik Kapanis")}</h2>

          <form onSubmit={onUpdatePeriodStatus} className="grid gap-2 md:grid-cols-2">
            {books.length > 0 ? (
              <select value={periodForm.bookId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, bookId: event.target.value, periodId: "" }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">{l("Select book", "Defter secin")}</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.code} - {book.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={periodForm.bookId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, bookId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Book ID", "Defter ID")} required />
            )}
            {canUsePeriodActionLookup ? (
              <select value={periodForm.periodId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, periodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">{l("Select period", "Donem secin")}</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.fiscal_year}-P{String(period.period_no).padStart(2, "0")} ({period.period_name})
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={periodForm.periodId} onChange={(event) => setPeriodForm((prev) => ({ ...prev, periodId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Period ID", "Donem ID")} required />
            )}
            <select value={periodForm.status} onChange={(event) => setPeriodForm((prev) => ({ ...prev, status: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">{PERIOD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
            <input value={periodForm.note} onChange={(event) => setPeriodForm((prev) => ({ ...prev, note: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Manual status note (optional)", "Elle durum notu (opsiyonel)")} />
            <button type="submit" disabled={saving === "periodStatus" || !canClosePeriod} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">{saving === "periodStatus" ? l("Saving...", "Kaydediliyor...") : l("Update Status", "Durumu Guncelle")}</button>
          </form>

          <form onSubmit={onExecutePeriodClose} className="grid gap-2 md:grid-cols-2">
            <select value={periodCloseForm.closeStatus} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, closeStatus: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              {["SOFT_CLOSED", "HARD_CLOSED"].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {accounts.length > 0 ? (
              <select value={periodCloseForm.retainedEarningsAccountId} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, retainedEarningsAccountId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
                <option value="">{l("Retained earnings account (year-end optional)", "Gecmis yil kar/zarar hesabi (yil sonu opsiyonel)")}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={periodCloseForm.retainedEarningsAccountId} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, retainedEarningsAccountId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Retained earnings account ID (year-end)", "Gecmis yil kar/zarar hesap ID (yil sonu)")} />
            )}
            <input value={periodCloseForm.note} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, note: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder={l("Auto close note (optional)", "Otomatik kapanis notu (opsiyonel)")} />
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <button type="submit" disabled={saving === "periodCloseRun" || !canClosePeriod} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "periodCloseRun" ? l("Running...", "Calisiyor...") : l("Run Auto Close", "Otomatik Kapanisi Calistir")}</button>
              <button type="button" onClick={onLoadPeriodCloseRuns} disabled={saving === "periodCloseRuns" || !canClosePeriod} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">{saving === "periodCloseRuns" ? l("Loading...", "Yukleniyor...") : l("Load Close Runs", "Kapanis Calismalarini Yukle")}</button>
            </div>
          </form>

          <form onSubmit={onReopenPeriodClose} className="grid gap-2 md:grid-cols-2">
            <input value={periodCloseForm.reopenReason} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, reopenReason: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder={l("Reopen reason (required)", "Yeniden acma nedeni (zorunlu)")} required />
            <button type="submit" disabled={saving === "periodReopen" || !canClosePeriod} className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">{saving === "periodReopen" ? l("Reopening...", "Yeniden aciliyor...") : l("Reopen Last Close Run", "Son Kapanis Calismasini Yeniden Ac")}</button>
          </form>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">{l("Run", "Calisma")}</th>
                  <th className="px-2 py-2">{l("Status", "Durum")}</th>
                  <th className="px-2 py-2">{l("Close", "Kapanis")}</th>
                  <th className="px-2 py-2">{l("Year-End", "Yil Sonu")}</th>
                  <th className="px-2 py-2">{l("Carry JRN", "Devir Fisi")}</th>
                  <th className="px-2 py-2">{l("Y/E JRN", "Y/S Fisi")}</th>
                  <th className="px-2 py-2">{l("Lines", "Satirlar")}</th>
                </tr>
              </thead>
              <tbody>
                {periodCloseRuns.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">{row.closeStatus}</td>
                    <td className="px-2 py-2">{row.yearEndClosed ? l("Yes", "Evet") : l("No", "Hayir")}</td>
                    <td className="px-2 py-2">{row.carryForwardJournalEntryId || "-"}</td>
                    <td className="px-2 py-2">{row.yearEndJournalEntryId || "-"}</td>
                    <td className="px-2 py-2">{Array.isArray(row.lines) ? row.lines.length : 0}</td>
                  </tr>
                ))}
                {periodCloseRuns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-slate-500">
                      {l("No period close runs loaded.", "Donem kapanis calismasi yuklenmedi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{l("Journal History", "Fis Gecmisi")}</h2>
          <button
            type="button"
            onClick={() => fetchJournalHistory()}
            disabled={loadingHistory || !canReadJournals}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingHistory ? l("Loading...", "Yukleniyor...") : l("Load Journals", "Fisleri Yukle")}
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
            <option value="">{l("All legal entities", "Tum istirakler / bagli ortaklar")}</option>
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
            <option value="">{l("All books", "Tum defterler")}</option>
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
            <option value="">{l("All periods", "Tum donemler")}</option>
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
            <option value="">{l("All statuses", "Tum durumlar")}</option>
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
            {l("Apply Filters", "Filtreleri Uygula")}
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{l("Total rows", "Toplam satir")}: {historyTotal}</span>
          <span>{l("Page", "Sayfa")} {historyPage}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeHistoryPage(-1)}
              disabled={!historyHasPrev || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              {l("Prev", "Onceki")}
            </button>
            <button
              type="button"
              onClick={() => onChangeHistoryPage(1)}
              disabled={!historyHasNext || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              {l("Next", "Sonraki")}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("No", "No")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Date", "Tarih")}</th>
                  <th className="px-3 py-2">{l("Debit", "Borc")}</th>
                  <th className="px-3 py-2">{l("Credit", "Alacak")}</th>
                  <th className="px-3 py-2">{l("Lines", "Satirlar")}</th>
                  <th className="px-3 py-2">{l("Action", "Islem")}</th>
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
                      <button type="button" onClick={() => loadJournalDetail(row.id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">{l("View", "Goruntule")}</button>
                    </td>
                  </tr>
                ))}
                {historyRows.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">{l("No journal rows loaded.", "Fis satiri yuklenmedi.")}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-700">{l("Journal Detail", "Fis Detayi")}</h3>
            {!selectedJournal && <p className="mt-2 text-xs text-slate-500">{l("Select a journal row to load detail and lines.", "Detay ve satirlari yuklemek icin bir fis satiri secin.")}</p>}
            {selectedJournal && (
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                <div>ID: {selectedJournal.id}</div>
                <div>{l("No", "No")}: {selectedJournal.journal_no}</div>
                <div>{l("Status", "Durum")}: {selectedJournal.status}</div>
                <div>{l("Entity", "Birim")}: {selectedJournal.legal_entity_code}</div>
                <div>{l("Book", "Defter")}: {selectedJournal.book_code}</div>
                <div>{l("Period", "Donem")}: {selectedJournal.fiscal_year}-P{String(selectedJournal.period_no || "").padStart(2, "0")}</div>
                <div>{l("Lines", "Satirlar")}: {(selectedJournal.lines || []).length}</div>
                <div className="max-h-52 overflow-auto rounded border border-slate-200">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{l("Account", "Hesap")}</th><th className="px-2 py-1.5">{l("Debit", "Borc")}</th><th className="px-2 py-1.5">{l("Credit", "Alacak")}</th></tr></thead>
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

