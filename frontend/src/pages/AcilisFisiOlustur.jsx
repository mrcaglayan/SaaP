import { useEffect, useMemo, useState } from "react";
import {
  createJournal,
  listAccounts,
  listBooks,
  postJournal,
} from "../api/glAdmin.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";

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

function createLine() {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: "",
    operatingUnitId: "",
    counterpartyLegalEntityId: "",
    description: "",
    debitBase: "0",
    creditBase: "0",
  };
}

export default function AcilisFisiOlustur() {
  const { hasPermission } = useAuth();
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canCreateJournal = hasPermission("gl.journal.create");
  const canPostJournal = hasPermission("gl.journal.post");

  const today = new Date().toISOString().slice(0, 10);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [periods, setPeriods] = useState([]);

  const [form, setForm] = useState({
    legalEntityId: "",
    bookId: "",
    fiscalPeriodId: "",
    entryDate: today,
    documentDate: today,
    currencyCode: "USD",
    referenceNo: "",
    description: "Opening entry",
    autoPost: true,
  });
  const [lines, setLines] = useState([createLine(), createLine()]);

  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const selectedBookId = toPositiveInt(form.bookId);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) {
        setLegalEntities([]);
        setBooks([]);
        setAccounts([]);
        setOperatingUnits([]);
        return;
      }

      setLoadingRefs(true);
      setError("");

      try {
        const [entityRes, bookRes, accountRes, unitRes] = await Promise.all([
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
        ]);

        if (cancelled) {
          return;
        }

        const entityRows = entityRes?.rows || [];
        const bookRows = bookRes?.rows || [];
        const accountRows = accountRes?.rows || [];
        const unitRows = unitRes?.rows || [];

        setLegalEntities(entityRows);
        setBooks(bookRows);
        setAccounts(accountRows);
        setOperatingUnits(unitRows);

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
          setError(err?.response?.data?.message || "Failed to load references.");
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
  }, [canReadOrgTree, canReadBooks, canReadAccounts, selectedLegalEntityId]);

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
          setError(err?.response?.data?.message || "Failed to load fiscal periods.");
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
  }, [canReadPeriods, books, selectedBookId]);

  useEffect(() => {
    setForm((prev) => {
      const currentPeriodId = toPositiveInt(prev.fiscalPeriodId);
      if (currentPeriodId && hasId(periods, currentPeriodId)) {
        return prev;
      }

      const latestPeriod = periods[periods.length - 1];
      return {
        ...prev,
        fiscalPeriodId: latestPeriod ? String(latestPeriod.id) : "",
      };
    });
  }, [periods]);

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

  const isBalanced =
    Math.abs(totals.debit - totals.credit) < 0.0001 && totals.debit > 0;

  const canSubmit = canCreateJournal && isBalanced && lines.length >= 2 && !submitting;

  function setFormField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function addLine() {
    setLines((prev) => [...prev, createLine()]);
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

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canCreateJournal) {
      setError("Missing permission: gl.journal.create");
      return;
    }

    const legalEntityId = toPositiveInt(form.legalEntityId);
    const bookId = toPositiveInt(form.bookId);
    const fiscalPeriodId = toPositiveInt(form.fiscalPeriodId);
    if (!legalEntityId || !bookId || !fiscalPeriodId) {
      setError("Legal entity, book, and fiscal period are required.");
      return;
    }
    if (lines.length < 2) {
      setError("At least two lines are required.");
      return;
    }

    const normalizedLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineLabel = `Line ${i + 1}`;
      const accountId = toPositiveInt(line.accountId);
      if (!accountId) {
        setError(`${lineLabel}: account is required.`);
        return;
      }

      const debitBase = toAmount(line.debitBase);
      const creditBase = toAmount(line.creditBase);
      if (debitBase < 0 || creditBase < 0) {
        setError(`${lineLabel}: debit/credit cannot be negative.`);
        return;
      }
      if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
        setError(`${lineLabel}: enter either debit or credit.`);
        return;
      }

      normalizedLines.push({
        accountId,
        operatingUnitId: toPositiveInt(line.operatingUnitId) || undefined,
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
      setError("Entry is not balanced.");
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
        entryDate: form.entryDate,
        documentDate: form.documentDate,
        currencyCode: String(form.currencyCode || "USD").toUpperCase(),
        sourceType: "MANUAL",
        referenceNo: form.referenceNo.trim() || undefined,
        description: form.description.trim() || undefined,
        lines: normalizedLines,
      };

      const createResult = await createJournal(payload);
      const journalEntryId = Number(createResult?.journalEntryId || 0);
      const journalNo = createResult?.journalNo || null;

      let posted = false;
      if (form.autoPost && canPostJournal && journalEntryId) {
        const postResult = await postJournal(journalEntryId);
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
            ? "Opening entry created and posted."
            : "Opening entry created; posting did not complete."
        );
      } else if (form.autoPost && !canPostJournal) {
        setMessage("Opening entry created as draft (missing gl.journal.post permission).");
      } else {
        setMessage("Opening entry created as draft.");
      }

      setLines([createLine(), createLine()]);
      setForm((prev) => ({
        ...prev,
        referenceNo: "",
        description: "Opening entry",
      }));
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to create opening entry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Acilis Fisi Olustur</h1>
        <p className="mt-1 text-sm text-slate-600">
          Open a balanced opening entry with optional immediate posting.
        </p>
      </header>

      {!canCreateJournal && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Missing permission: <span className="font-mono">gl.journal.create</span>
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

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-700">Document Header</h2>
            <span className="text-xs text-slate-500">
              {loadingRefs ? "Loading references..." : "Ready"}
            </span>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <select
              value={form.legalEntityId}
              onChange={(event) => setFormField("legalEntityId", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
              disabled={!canReadOrgTree || loadingRefs}
            >
              <option value="">Select legal entity</option>
              {legalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>

            <select
              value={form.bookId}
              onChange={(event) => setFormField("bookId", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
              disabled={!canReadBooks || loadingRefs}
            >
              <option value="">Select book</option>
              {books.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>

            <select
              value={form.fiscalPeriodId}
              onChange={(event) => setFormField("fiscalPeriodId", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
              disabled={!canReadPeriods || loadingPeriods}
            >
              <option value="">{loadingPeriods ? "Loading periods..." : "Select period"}</option>
              {periods.map((row) => (
                <option key={row.id} value={row.id}>
                  FY{row.fiscal_year} P{String(row.period_no).padStart(2, "0")} -{" "}
                  {row.period_name}
                </option>
              ))}
            </select>

            <input
              value={form.currencyCode}
              onChange={(event) =>
                setFormField("currencyCode", event.target.value.toUpperCase())
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              maxLength={3}
              placeholder="Currency"
              required
            />

            <input
              type="date"
              value={form.entryDate}
              onChange={(event) => setFormField("entryDate", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              type="date"
              value={form.documentDate}
              onChange={(event) => setFormField("documentDate", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              value={form.referenceNo}
              onChange={(event) => setFormField("referenceNo", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Reference no"
            />

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.autoPost}
                onChange={(event) => setFormField("autoPost", event.target.checked)}
                disabled={!canPostJournal}
              />
              Auto-post
            </label>

            <input
              value={form.description}
              onChange={(event) => setFormField("description", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-4"
              placeholder="Description"
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Lines</h2>
            <button
              type="button"
              onClick={addLine}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Add line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Counterparty</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Debit</th>
                  <th className="px-3 py-2">Credit</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <select
                        value={line.accountId}
                        onChange={(event) =>
                          updateLine(line.id, "accountId", event.target.value)
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                        required
                        disabled={!canReadAccounts}
                      >
                        <option value="">Select account</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} - {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={line.operatingUnitId}
                        onChange={(event) =>
                          updateLine(line.id, "operatingUnitId", event.target.value)
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                        disabled={!canReadOrgTree}
                      >
                        <option value="">Optional</option>
                        {operatingUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.code} - {unit.name}
                          </option>
                        ))}
                      </select>
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
                        <option value="">Optional</option>
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
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                        placeholder={`Line ${index + 1} description`}
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
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                  <td className="px-3 py-2" colSpan={4}>
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right">{formatAmount(totals.debit)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(totals.credit)}</td>
                  <td className="px-3 py-2 text-xs">
                    {isBalanced ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">
                        Balanced
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                        Not balanced
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Posting requires <span className="font-mono">gl.journal.post</span>.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting
              ? "Saving..."
              : form.autoPost && canPostJournal
              ? "Create and Post"
              : "Create Draft"}
          </button>
        </div>
      </form>

      {result && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-slate-800">Last Created Entry</h2>
          <div className="grid gap-1 text-slate-700">
            <div>
              Journal ID: <span className="font-mono">{result.journalEntryId || "-"}</span>
            </div>
            <div>
              Journal No: <span className="font-mono">{result.journalNo || "-"}</span>
            </div>
            <div>Status: {result.posted ? "POSTED" : "DRAFT"}</div>
          </div>
        </section>
      )}
    </div>
  );
}
