import { useEffect, useState } from "react";
import {
  listAccounts,
  listBooks,
  listCoas,
  upsertAccount,
  upsertAccountMapping,
  upsertBook,
  upsertCoa,
} from "../../api/glAdmin.js";
import { listFiscalCalendars, listLegalEntities } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const BOOK_TYPES = ["LOCAL", "GROUP"];
const COA_SCOPES = ["LEGAL_ENTITY", "GROUP"];
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const NORMAL_SIDES = ["DEBIT", "CREDIT"];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function GlSetupPage() {
  const { hasPermission } = useAuth();
  const canReadLegalEntities = hasPermission("org.tree.read");
  const canReadCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadCoas = hasPermission("gl.coa.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertBooks = hasPermission("gl.book.upsert");
  const canUpsertCoas = hasPermission("gl.coa.upsert");
  const canUpsertAccounts = hasPermission("gl.account.upsert");
  const canUpsertMappings = hasPermission("gl.account_mapping.upsert");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [legalEntities, setLegalEntities] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [books, setBooks] = useState([]);
  const [coas, setCoas] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [bookForm, setBookForm] = useState({
    legalEntityId: "",
    calendarId: "",
    code: "",
    name: "",
    bookType: "LOCAL",
    baseCurrencyCode: "USD",
  });
  const [coaForm, setCoaForm] = useState({
    scope: "LEGAL_ENTITY",
    legalEntityId: "",
    code: "",
    name: "",
  });
  const [accountForm, setAccountForm] = useState({
    coaId: "",
    code: "",
    name: "",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
    parentAccountId: "",
  });
  const [mappingForm, setMappingForm] = useState({
    sourceAccountId: "",
    targetAccountId: "",
    mappingType: "LOCAL_TO_GROUP",
  });

  async function loadData() {
    setLoading(true);
    setError("");

    const updates = {
      legalEntities,
      calendars,
      books,
      coas,
      accounts,
    };

    try {
      const tasks = [];

      if (canReadLegalEntities) {
        tasks.push(
          listLegalEntities().then((response) => {
            updates.legalEntities = response?.rows || [];
          })
        );
      }

      if (canReadCalendars) {
        tasks.push(
          listFiscalCalendars().then((response) => {
            updates.calendars = response?.rows || [];
          })
        );
      }

      if (canReadBooks) {
        tasks.push(
          listBooks().then((response) => {
            updates.books = response?.rows || [];
          })
        );
      }

      if (canReadCoas) {
        tasks.push(
          listCoas().then((response) => {
            updates.coas = response?.rows || [];
          })
        );
      }

      if (canReadAccounts) {
        tasks.push(
          listAccounts({ includeInactive: true }).then((response) => {
            updates.accounts = response?.rows || [];
          })
        );
      }

      await Promise.all(tasks);

      setLegalEntities(updates.legalEntities);
      setCalendars(updates.calendars);
      setBooks(updates.books);
      setCoas(updates.coas);
      setAccounts(updates.accounts);

      setBookForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
        calendarId: prev.calendarId || String(updates.calendars[0]?.id || ""),
      }));
      setCoaForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
      }));
      setAccountForm((prev) => ({
        ...prev,
        coaId: prev.coaId || String(updates.coas[0]?.id || ""),
      }));
      setMappingForm((prev) => ({
        ...prev,
        sourceAccountId:
          prev.sourceAccountId || String(updates.accounts[0]?.id || ""),
        targetAccountId:
          prev.targetAccountId || String(updates.accounts[1]?.id || updates.accounts[0]?.id || ""),
      }));
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load GL setup data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canReadLegalEntities,
    canReadCalendars,
    canReadBooks,
    canReadCoas,
    canReadAccounts,
  ]);

  async function handleBookSubmit(event) {
    event.preventDefault();
    if (!canUpsertBooks) {
      setError("Missing permission: gl.book.upsert");
      return;
    }

    const legalEntityId = toPositiveInt(bookForm.legalEntityId);
    const calendarId = toPositiveInt(bookForm.calendarId);
    if (!legalEntityId || !calendarId) {
      setError("legalEntityId and calendarId are required.");
      return;
    }

    setSaving("book");
    setError("");
    setMessage("");
    try {
      await upsertBook({
        legalEntityId,
        calendarId,
        code: bookForm.code.trim(),
        name: bookForm.name.trim(),
        bookType: bookForm.bookType,
        baseCurrencyCode: bookForm.baseCurrencyCode.trim().toUpperCase(),
      });
      setBookForm((prev) => ({ ...prev, code: "", name: "" }));
      setMessage("Book saved.");
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save book.");
    } finally {
      setSaving("");
    }
  }

  async function handleCoaSubmit(event) {
    event.preventDefault();
    if (!canUpsertCoas) {
      setError("Missing permission: gl.coa.upsert");
      return;
    }

    const legalEntityId = toPositiveInt(coaForm.legalEntityId);
    if (coaForm.scope === "LEGAL_ENTITY" && !legalEntityId) {
      setError("legalEntityId is required when scope is LEGAL_ENTITY.");
      return;
    }

    setSaving("coa");
    setError("");
    setMessage("");
    try {
      await upsertCoa({
        scope: coaForm.scope,
        legalEntityId: coaForm.scope === "LEGAL_ENTITY" ? legalEntityId : undefined,
        code: coaForm.code.trim(),
        name: coaForm.name.trim(),
      });
      setCoaForm((prev) => ({ ...prev, code: "", name: "" }));
      setMessage("Chart of accounts saved.");
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save CoA.");
    } finally {
      setSaving("");
    }
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    if (!canUpsertAccounts) {
      setError("Missing permission: gl.account.upsert");
      return;
    }

    const coaId = toPositiveInt(accountForm.coaId);
    if (!coaId) {
      setError("coaId is required.");
      return;
    }

    setSaving("account");
    setError("");
    setMessage("");
    try {
      await upsertAccount({
        coaId,
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        accountType: accountForm.accountType,
        normalSide: accountForm.normalSide,
        allowPosting: Boolean(accountForm.allowPosting),
        parentAccountId: toPositiveInt(accountForm.parentAccountId) || undefined,
      });
      setAccountForm((prev) => ({ ...prev, code: "", name: "", parentAccountId: "" }));
      setMessage("Account saved.");
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save account.");
    } finally {
      setSaving("");
    }
  }

  async function handleMappingSubmit(event) {
    event.preventDefault();
    if (!canUpsertMappings) {
      setError("Missing permission: gl.account_mapping.upsert");
      return;
    }

    const sourceAccountId = toPositiveInt(mappingForm.sourceAccountId);
    const targetAccountId = toPositiveInt(mappingForm.targetAccountId);
    if (!sourceAccountId || !targetAccountId) {
      setError("sourceAccountId and targetAccountId are required.");
      return;
    }

    setSaving("mapping");
    setError("");
    setMessage("");
    try {
      await upsertAccountMapping({
        sourceAccountId,
        targetAccountId,
        mappingType: mappingForm.mappingType,
      });
      setMessage("Account mapping saved.");
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save mapping.");
    } finally {
      setSaving("");
    }
  }

  if (!canReadBooks && !canReadCoas && !canReadAccounts) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        You need GL read permissions (`gl.book.read`, `gl.coa.read`, `gl.account.read`)
        to use this page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TenantReadinessChecklist />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">GL Setup</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage books, charts of accounts, accounts, and account mappings.
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

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Books</h2>
          <form onSubmit={handleBookSubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={bookForm.legalEntityId}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select legal entity</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} - {entity.name}
                </option>
              ))}
            </select>
            <select
              value={bookForm.calendarId}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, calendarId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select calendar</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.code} - {calendar.name}
                </option>
              ))}
            </select>
            <select
              value={bookForm.bookType}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, bookType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {BOOK_TYPES.map((bookType) => (
                <option key={bookType} value={bookType}>
                  {bookType}
                </option>
              ))}
            </select>
            <input
              value={bookForm.code}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Book code"
              required
            />
            <input
              value={bookForm.name}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Book name"
              required
            />
            <input
              value={bookForm.baseCurrencyCode}
              onChange={(event) =>
                setBookForm((prev) => ({
                  ...prev,
                  baseCurrencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Base currency (e.g. USD)"
              maxLength={3}
              required
            />
            <button
              type="submit"
              disabled={saving === "book" || !canUpsertBooks}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-3"
            >
              {saving === "book" ? "Saving..." : "Save Book"}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Calendar</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr key={book.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{book.id}</td>
                    <td className="px-3 py-2">{book.code}</td>
                    <td className="px-3 py-2">{book.name}</td>
                    <td className="px-3 py-2">{book.legal_entity_id}</td>
                    <td className="px-3 py-2">{book.calendar_id}</td>
                  </tr>
                ))}
                {books.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-slate-500">
                      No books found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Charts of Accounts
          </h2>
          <form onSubmit={handleCoaSubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={coaForm.scope}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, scope: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {COA_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>
            <select
              value={coaForm.legalEntityId}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={coaForm.scope !== "LEGAL_ENTITY"}
            >
              <option value="">Select legal entity</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} - {entity.name}
                </option>
              ))}
            </select>
            <input
              value={coaForm.code}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="CoA code"
              required
            />
            <input
              value={coaForm.name}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder="CoA name"
              required
            />
            <button
              type="submit"
              disabled={saving === "coa" || !canUpsertCoas}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "coa" ? "Saving..." : "Save CoA"}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Entity</th>
                </tr>
              </thead>
              <tbody>
                {coas.map((coa) => (
                  <tr key={coa.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{coa.id}</td>
                    <td className="px-3 py-2">{coa.code}</td>
                    <td className="px-3 py-2">{coa.name}</td>
                    <td className="px-3 py-2">{coa.scope}</td>
                    <td className="px-3 py-2">{coa.legal_entity_id || "-"}</td>
                  </tr>
                ))}
                {coas.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-slate-500">
                      No CoA rows found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Accounts</h2>
          <form onSubmit={handleAccountSubmit} className="grid gap-2 md:grid-cols-4">
            <select
              value={accountForm.coaId}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, coaId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select CoA</option>
              {coas.map((coa) => (
                <option key={coa.id} value={coa.id}>
                  {coa.code} - {coa.name}
                </option>
              ))}
            </select>
            <input
              value={accountForm.code}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Account code"
              required
            />
            <input
              value={accountForm.name}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Account name"
              required
            />
            <select
              value={accountForm.accountType}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  accountType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType} value={accountType}>
                  {accountType}
                </option>
              ))}
            </select>
            <select
              value={accountForm.normalSide}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  normalSide: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {NORMAL_SIDES.map((normalSide) => (
                <option key={normalSide} value={normalSide}>
                  {normalSide}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={accountForm.parentAccountId}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  parentAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Parent account ID (optional)"
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={accountForm.allowPosting}
                onChange={(event) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    allowPosting: event.target.checked,
                  }))
                }
              />
              Allow posting
            </label>
            <button
              type="submit"
              disabled={saving === "account" || !canUpsertAccounts}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "account" ? "Saving..." : "Save Account"}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">CoA</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Side</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{account.id}</td>
                    <td className="px-3 py-2">{account.coa_id}</td>
                    <td className="px-3 py-2">{account.code}</td>
                    <td className="px-3 py-2">{account.name}</td>
                    <td className="px-3 py-2">{account.account_type}</td>
                    <td className="px-3 py-2">{account.normal_side}</td>
                  </tr>
                ))}
                {accounts.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      No accounts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Account Mapping
          </h2>
          <form onSubmit={handleMappingSubmit} className="grid gap-2 md:grid-cols-4">
            <select
              value={mappingForm.sourceAccountId}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  sourceAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">Select source account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <select
              value={mappingForm.targetAccountId}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  targetAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">Select target account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <input
              value={mappingForm.mappingType}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  mappingType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Mapping type"
            />
            <button
              type="submit"
              disabled={saving === "mapping" || !canUpsertMappings}
              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "mapping" ? "Saving..." : "Save Mapping"}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Backend currently provides upsert for mappings. Listing mappings is not
            exposed yet.
          </p>
        </section>
      </div>
    </div>
  );
}
