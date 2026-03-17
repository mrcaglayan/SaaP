import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { importPayrollRunCsv, listPayrollRuns } from "../../api/payrollRuns.js";
import { useAuth } from "../../auth/useAuth.js";

const SAMPLE_CSV = [
  "employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay",
  "E001,Alice Doe,ADM,1000.00,100.00,50.00,25.00,1175.00,100.00,50.00,25.00,80.00,40.00,1000.00",
  "E002,Bob Doe,SCH,1200.00,0.00,0.00,0.00,1200.00,120.00,60.00,20.00,90.00,45.00,1000.00",
  "E003,Carol Doe,SCH,900.00,50.00,0.00,0.00,950.00,90.00,40.00,20.00,70.00,35.00,800.00",
].join("\n");

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const asString = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) {
    return asString.slice(0, 10);
  }
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
}

function resolveLegalEntityCurrencyCode(legalEntity) {
  return normalizeCurrencyCode(
    legalEntity?.functional_currency_code || legalEntity?.functionalCurrencyCode || ""
  );
}

function InfoHint({ text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-600"
        title={text}
        aria-label={text}
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden w-72 -translate-y-1/2 rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

export default function PayrollRunImportPage() {
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const canImport = hasPermission("payroll.runs.import");
  const canReadOrg = hasPermission("org.tree.read");
  const canReadRuns = hasPermission("payroll.runs.read");
  const previousLegalEntityIdRef = useRef("");

  const [legalEntities, setLegalEntities] = useState([]);
  const [correctionShells, setCorrectionShells] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [loadingShells, setLoadingShells] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");
  const [shellLookupWarning, setShellLookupWarning] = useState("");
  const [resultRun, setResultRun] = useState(null);
  const [useExistingShell, setUseExistingShell] = useState(false);
  const [form, setForm] = useState({
    targetRunId: "",
    legalEntityId: "",
    providerCode: "OUTSOURCED_PAYROLL_X",
    payrollPeriod: "",
    payDate: "",
    currencyCode: "",
    sourceBatchRef: "",
    originalFilename: "",
    csvText: "",
  });

  const legalEntityOptions = useMemo(
    () =>
      [...(legalEntities || [])].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [legalEntities]
  );
  const selectedLegalEntity = useMemo(
    () =>
      legalEntityOptions.find((row) => String(row?.id || "") === String(form.legalEntityId || "")) ||
      null,
    [form.legalEntityId, legalEntityOptions]
  );
  const selectedLegalEntityCurrencyCode = useMemo(
    () => resolveLegalEntityCurrencyCode(selectedLegalEntity),
    [selectedLegalEntity]
  );
  const correctionShellOptions = useMemo(
    () =>
      [...(correctionShells || [])]
        .filter((row) =>
          ["OFF_CYCLE", "RETRO"].includes(String(row?.run_type || "").toUpperCase())
        )
        .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0)),
    [correctionShells]
  );

  useEffect(() => {
    const targetRunId =
      searchParams.get("targetRunId") || searchParams.get("target_run_id") || "";
    const legalEntityId =
      searchParams.get("legalEntityId") || searchParams.get("legal_entity_id") || "";
    if (!targetRunId && !legalEntityId) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      targetRunId: prev.targetRunId || targetRunId,
      legalEntityId: prev.legalEntityId || legalEntityId,
    }));
    if (targetRunId) {
      setUseExistingShell(true);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    if (!canReadOrg) {
      setLegalEntities([]);
      setLookupWarning(canImport ? "org.tree.read yok: legalEntityId manuel girin." : "");
      return undefined;
    }
    (async () => {
      setLoadingLookups(true);
      try {
        const res = await listLegalEntities({ limit: 500, offset: 0 });
        if (!cancelled) {
          setLegalEntities(res?.rows || []);
          setLookupWarning("");
        }
      } catch (err) {
        if (!cancelled) {
          setLegalEntities([]);
          setLookupWarning(err?.response?.data?.message || "Legal entity listesi yuklenemedi");
        }
      } finally {
        if (!cancelled) {
          setLoadingLookups(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canImport, canReadOrg]);

  useEffect(() => {
    if (form.targetRunId || form.legalEntityId || legalEntityOptions.length === 0) {
      return;
    }
    setForm((prev) => ({ ...prev, legalEntityId: String(legalEntityOptions[0]?.id || "") }));
  }, [form.targetRunId, form.legalEntityId, legalEntityOptions]);

  useEffect(() => {
    if (toPositiveInt(form.targetRunId)) {
      previousLegalEntityIdRef.current = String(form.legalEntityId || "").trim();
      return;
    }
    const selectedLegalEntityId = String(form.legalEntityId || "").trim();
    if (!selectedLegalEntityId) {
      previousLegalEntityIdRef.current = "";
      return;
    }
    if (!selectedLegalEntityCurrencyCode) {
      previousLegalEntityIdRef.current = selectedLegalEntityId;
      return;
    }
    const previousLegalEntityId = previousLegalEntityIdRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    const currentCurrency = normalizeCurrencyCode(form.currencyCode);
    const shouldSyncCurrency = !currentCurrency || legalEntityChanged;
    previousLegalEntityIdRef.current = selectedLegalEntityId;
    if (!shouldSyncCurrency || currentCurrency === selectedLegalEntityCurrencyCode) {
      return;
    }
    setForm((prev) => {
      if (String(prev.legalEntityId || "").trim() !== selectedLegalEntityId) {
        return prev;
      }
      const prevCurrency = normalizeCurrencyCode(prev.currencyCode);
      if (!legalEntityChanged && prevCurrency) {
        return prev;
      }
      return {
        ...prev,
        currencyCode: selectedLegalEntityCurrencyCode,
      };
    });
  }, [form.currencyCode, form.legalEntityId, form.targetRunId, selectedLegalEntityCurrencyCode]);

  useEffect(() => {
    if (form.csvText) {
      return;
    }
    setForm((prev) => ({ ...prev, csvText: SAMPLE_CSV }));
  }, [form.csvText]);

  useEffect(() => {
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    if (!form.payrollPeriod) {
      setForm((prev) => ({ ...prev, payrollPeriod: firstDay }));
    }
    if (!form.payDate) {
      setForm((prev) => ({ ...prev, payDate: firstDay }));
    }
  }, [form.payDate, form.payrollPeriod]);

  useEffect(() => {
    let cancelled = false;
    if (!useExistingShell) {
      setCorrectionShells([]);
      setShellLookupWarning("");
      return undefined;
    }
    if (!canReadRuns) {
      setCorrectionShells([]);
      setShellLookupWarning("payroll.runs.read yok: correction shell secimi icin run ID manuel girin.");
      return undefined;
    }

    (async () => {
      setLoadingShells(true);
      try {
        const res = await listPayrollRuns({
          limit: 200,
          offset: 0,
          status: "DRAFT",
        });
        if (!cancelled) {
          setCorrectionShells(res?.rows || []);
          setShellLookupWarning("");
        }
      } catch (err) {
        if (!cancelled) {
          setCorrectionShells([]);
          setShellLookupWarning(err?.response?.data?.message || "Correction shell listesi yuklenemedi");
        }
      } finally {
        if (!cancelled) {
          setLoadingShells(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadRuns, useExistingShell]);

  function handleTargetShellChange(value) {
    const nextId = String(value || "");
    const selectedShell =
      correctionShellOptions.find((row) => String(row?.id || "") === nextId) || null;
    setForm((prev) => ({
      ...prev,
      targetRunId: nextId,
      legalEntityId: selectedShell ? String(selectedShell.legal_entity_id || "") : prev.legalEntityId,
      providerCode: selectedShell ? String(selectedShell.provider_code || "") : prev.providerCode,
      payrollPeriod: selectedShell ? formatDate(selectedShell.payroll_period) : prev.payrollPeriod,
      payDate: selectedShell ? formatDate(selectedShell.pay_date) : prev.payDate,
      currencyCode: selectedShell
        ? String(selectedShell.currency_code || "")
        : selectedLegalEntityCurrencyCode || prev.currencyCode,
    }));
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setForm((prev) => ({
        ...prev,
        originalFilename: file.name || prev.originalFilename,
        csvText: text,
      }));
    } catch {
      setError("CSV dosyasi okunamadi");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canImport) {
      setError("Missing permission: payroll.runs.import");
      return;
    }

    const targetRunId = toPositiveInt(form.targetRunId);
    const legalEntityId = toPositiveInt(form.legalEntityId);
    if (!targetRunId && !legalEntityId) {
      setError("legalEntityId veya targetRunId gerekli");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    setResultRun(null);
    try {
      const res = await importPayrollRunCsv({
        targetRunId: targetRunId || undefined,
        legalEntityId: legalEntityId || undefined,
        providerCode: String(form.providerCode || "").trim().toUpperCase(),
        payrollPeriod: form.payrollPeriod,
        payDate: form.payDate,
        currencyCode: String(form.currencyCode || "").trim().toUpperCase(),
        sourceBatchRef: String(form.sourceBatchRef || "").trim() || null,
        originalFilename: String(form.originalFilename || "").trim() || "payroll.csv",
        csvText: String(form.csvText || ""),
      });
      setResultRun(res?.row || null);
      setMessage(
        targetRunId ? `Payroll CSV correction shell #${targetRunId} icine aktarildi` : "Payroll CSV iceri aktarildi"
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Payroll import basarisiz");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bordro Import</h1>
          <p className="mt-1 text-sm text-slate-600">
            PR-P01: Provider CSV → Payroll subledger run (GL accrual yok, sadece import + audit).
          </p>
        </div>
        <Link
          to="/app/payroll-runs"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          Bordro Runlari
        </Link>
      </div>

      <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        Bu rolloutta provider baglanti / preview ekranlari bilerek acik degil. Su an bordro akisi
        dogrudan CSV import ile yurur. Buradaki <code>Provider Code</code> alani bugun canli
        provider secimi degil, kaynak / audit etiketi olarak kullanilir.
      </div>

      {!canImport ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Missing permission: <code>payroll.runs.import</code>
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Import Formu</h2>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    originalFilename: prev.originalFilename || "payroll-sample.csv",
                    csvText: SAMPLE_CSV,
                  }))
                }
              >
                Ornek CSV
              </button>
            </div>

            {lookupWarning ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                {lookupWarning}
              </div>
            ) : null}

            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Normal aylik importta yeni payroll run olusturulur. Mevcut bir <code>DRAFT</code>{" "}
              correction shell icine import yapacaksan asagidaki advanced secenegi ac.
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 rounded border border-slate-200 bg-white px-3 py-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={useExistingShell}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseExistingShell(checked);
                      if (!checked) {
                        setForm((prev) => ({
                          ...prev,
                          targetRunId: "",
                          currencyCode: selectedLegalEntityCurrencyCode || prev.currencyCode,
                        }));
                      }
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">
                      Import into existing draft correction shell
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Sadece correction, off-cycle veya retro duzeltme senaryolarinda kullan. Ilk
                      normal bordro importunda kapali birak.
                    </span>
                  </span>
                </label>

                {useExistingShell ? (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      Draft Correction Shell
                    </label>
                    {canReadRuns ? (
                      <select
                        value={form.targetRunId}
                        onChange={(e) => handleTargetShellChange(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        disabled={loadingShells}
                      >
                        <option value="">
                          {loadingShells ? "Loading shells..." : "Uygun DRAFT shell secin"}
                        </option>
                        {correctionShellOptions.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.run_no} | {row.run_type} | {row.entity_code} | {formatDate(row.payroll_period)} |{" "}
                            {row.provider_code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={form.targetRunId}
                        onChange={(e) => setForm((prev) => ({ ...prev, targetRunId: e.target.value }))}
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        placeholder="Mevcut DRAFT shell run id"
                      />
                    )}
                    <div className="mt-1 text-[11px] text-slate-500">
                      Bu alan doluysa sistem yeni run acmaz; CSV'yi mevcut <code>DRAFT</code>{" "}
                      correction shell icine aktarir. Yalniz <code>OFF_CYCLE</code> ve{" "}
                      <code>RETRO</code> shell'ler uygundur.
                    </div>
                    {shellLookupWarning ? (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {shellLookupWarning}
                      </div>
                    ) : null}
                    {canReadRuns && !loadingShells && correctionShellOptions.length === 0 ? (
                      <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        Secilebilir correction shell yok. Once Bordro Run Detay ekranindan bir{" "}
                        <code>OFF_CYCLE</code> veya <code>RETRO</code> shell olustur.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Legal Entity</label>
                {canReadOrg ? (
                  <select
                    value={form.legalEntityId}
                    onChange={(e) => setForm((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    disabled={loadingLookups || submitting || Boolean(toPositiveInt(form.targetRunId))}
                  >
                    <option value="">Secin</option>
                    {legalEntityOptions.map((le) => (
                      <option key={le.id} value={le.id}>
                        {le.code} - {le.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.legalEntityId}
                    onChange={(e) => setForm((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="legalEntityId"
                    disabled={Boolean(toPositiveInt(form.targetRunId))}
                  />
                )}
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span>Provider Code</span>
                  <InfoHint text="Bu alan canli provider baglantisi secmez; importun hangi payroll saglayicisindan veya hangi kaynak sistemden geldigini etiketlemek icin kullanilir. Run kaydinda audit izi, filtreleme, arama ve ayni donemde farkli provider/source importlarini birbirinden ayirmak icin saklanir. Correction shell importunda bu kod secilen shell ile ayni olmali; normal importta ise tutar hesaplamasindan cok kaynak kimligi anlamina gelir." />
                </label>
                <input
                  value={form.providerCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, providerCode: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="OUTSOURCED_PAYROLL_X"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Payroll Period</label>
                <input
                  type="date"
                  value={form.payrollPeriod}
                  onChange={(e) => setForm((prev) => ({ ...prev, payrollPeriod: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Pay Date</label>
                <input
                  type="date"
                  value={form.payDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, payDate: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Currency</label>
                <input
                  value={form.currencyCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, currencyCode: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="TRY"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span>Source Batch Ref (opsiyonel)</span>
                  <InfoHint text="Providerin kendi batch / file referansini burada saklarsin. Bu alan hesaplama yapmaz ve tutarlari etkilemez; esas amaci audit, destek incelemesi ve provider mutabakatidir. Ayni donemde birden fazla payroll dosyasi geldiyse hangi importun hangi provider batchinden geldigini ayirt etmek, dis sistemdeki kaynaga geri donmek ve support ekipleriyle ortak bir referans uzerinden konusmak icin kullanilir." />
                </label>
                <input
                  value={form.sourceBatchRef}
                  onChange={(e) => setForm((prev) => ({ ...prev, sourceBatchRef: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="PROV-BATCH-2026-02"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">CSV File</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Original Filename
                </label>
                <input
                  value={form.originalFilename}
                  onChange={(e) => setForm((prev) => ({ ...prev, originalFilename: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="payroll.csv"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">CSV Icerik</label>
              <textarea
                rows={14}
                value={form.csvText}
                onChange={(e) => setForm((prev) => ({ ...prev, csvText: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <button
              type="submit"
              disabled={!canImport || submitting}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? "Iceri aktariliyor..." : "Payroll CSV Import"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Sonuc</h2>
          {!resultRun ? (
            <div className="mt-3 text-sm text-slate-600">Heniz import yapilmadi.</div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <strong>Run:</strong>{" "}
                <Link className="underline" to={`/app/payroll-runs/${resultRun.id}`}>
                  {resultRun.run_no}
                </Link>
              </div>
              <div>
                <strong>Durum:</strong> {resultRun.status}
              </div>
              <div>
                <strong>Entity:</strong> {resultRun.entity_code}
              </div>
              <div>
                <strong>Provider:</strong> {resultRun.provider_code}
              </div>
              <div>
                <strong>Rows:</strong> {resultRun.line_count_total} / Inserted:{" "}
                {resultRun.line_count_inserted} / Dup: {resultRun.line_count_duplicates}
              </div>
              <div>
                <strong>Employees:</strong> {resultRun.employee_count}
              </div>
              <div>
                <strong>Gross:</strong> {formatAmount(resultRun.total_gross_pay)}
              </div>
              <div>
                <strong>Net:</strong> {formatAmount(resultRun.total_net_pay)}
              </div>
            </div>
          )}
          <div className="mt-4 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            PR-P01 kapsami: import + payroll subledger detail + audit. Tahakkuk/GL posting PR-P02.
          </div>
        </section>
      </div>
    </div>
  );
}
