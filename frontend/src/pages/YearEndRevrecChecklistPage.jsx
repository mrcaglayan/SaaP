import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listLegalEntities } from "../api/orgAdmin.js";
import { getRevenuePostingMappingSetup } from "../api/revenueRecognition.js";
import { useI18n } from "../i18n/useI18n.js";

const REVREC_REQUIRED_FAMILIES = Object.freeze([
  "DEFREV",
  "PREPAID_EXPENSE",
  "ACCRUED_REVENUE",
  "ACCRUED_EXPENSE",
]);

const RECLASS_CHECKS = Object.freeze([
  {
    key: "defrev-long-short",
    titleEn: "Deferred revenue long/short mapping",
    titleTr: "Ertelenmis gelir uzun/kisa esleme",
    longPurposeCode: "DEFREV_LONG_LIABILITY",
    shortPurposeCode: "DEFREV_SHORT_LIABILITY",
    expectedLongPrefix: "480",
    expectedShortPrefix: "380",
  },
  {
    key: "prepaid-long-short",
    titleEn: "Prepaid expense long/short mapping",
    titleTr: "Pesin gider uzun/kisa esleme",
    longPurposeCode: "PREPAID_EXP_LONG_ASSET",
    shortPurposeCode: "PREPAID_EXP_SHORT_ASSET",
    expectedLongPrefix: "280",
    expectedShortPrefix: "180",
  },
  {
    key: "accr-rev-long-short",
    titleEn: "Accrued revenue long/short mapping",
    titleTr: "Gelir tahakkuku uzun/kisa esleme",
    longPurposeCode: "ACCR_REV_LONG_ASSET",
    shortPurposeCode: "ACCR_REV_SHORT_ASSET",
    expectedLongPrefix: "281",
    expectedShortPrefix: "181",
  },
  {
    key: "accr-exp-long-short",
    titleEn: "Accrued expense long/short mapping",
    titleTr: "Gider tahakkuku uzun/kisa esleme",
    longPurposeCode: "ACCR_EXP_LONG_LIABILITY",
    shortPurposeCode: "ACCR_EXP_SHORT_LIABILITY",
    expectedLongPrefix: "481",
    expectedShortPrefix: "381",
  },
]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.message || error?.response?.data?.message || fallback).trim();
  const requestId = String(error?.requestId || error?.response?.data?.requestId || "").trim();
  return requestId ? `${message || fallback} (requestId: ${requestId})` : message || fallback;
}

function buildLegalEntityLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(row?.id || "");
}

function getMappingByPurpose(setupStatus) {
  const byPurpose = new Map();
  for (const familyRow of Array.isArray(setupStatus?.families) ? setupStatus.families : []) {
    for (const mapping of Array.isArray(familyRow?.purposeMappings) ? familyRow.purposeMappings : []) {
      const purposeCode = toUpper(mapping?.purposeCode);
      if (!purposeCode) {
        continue;
      }
      byPurpose.set(purposeCode, mapping);
    }
  }
  return byPurpose;
}

function getMissingPurposeCodes(setupStatus) {
  const missing = new Set();
  for (const familyRow of Array.isArray(setupStatus?.families) ? setupStatus.families : []) {
    for (const purposeCode of Array.isArray(familyRow?.missingPurposeCodes)
      ? familyRow.missingPurposeCodes
      : []) {
      const normalized = toUpper(purposeCode);
      if (normalized) {
        missing.add(normalized);
      }
    }
  }
  return Array.from(missing.values());
}

function statusBadgeClass(status) {
  if (status === "PASS") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "WARN") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-rose-100 text-rose-700";
}

export default function YearEndRevrecChecklistPage() {
  const { language } = useI18n();
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [runningChecks, setRunningChecks] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [legalEntityId, setLegalEntityId] = useState("");
  const [setupStatus, setSetupStatus] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);

  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);

  const selectedLegalEntityId = toPositiveInt(legalEntityId);

  useEffect(() => {
    async function loadLookups() {
      setLoadingLookups(true);
      setError("");
      try {
        const response = await listLegalEntities();
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setLegalEntities(rows);
        setLegalEntityId((prev) => {
          const prevId = toPositiveInt(prev);
          if (prevId && rows.some((row) => toPositiveInt(row?.id) === prevId)) {
            return String(prevId);
          }
          return String(toPositiveInt(rows[0]?.id) || "");
        });
      } catch (err) {
        setLegalEntities([]);
        setLegalEntityId("");
        setError(
          normalizeApiError(
            err,
            l("Failed to load legal entities.", "Legal entity listesi yuklenemedi.")
          )
        );
      } finally {
        setLoadingLookups(false);
      }
    }

    loadLookups();
  }, [l]);

  async function runChecks(entityIdInput = selectedLegalEntityId) {
    const targetEntityId = toPositiveInt(entityIdInput);
    if (!targetEntityId) {
      setSetupStatus(null);
      setCheckedAt(null);
      return;
    }

    setRunningChecks(true);
    setError("");
    setMessage("");
    try {
      const response = await getRevenuePostingMappingSetup({ legalEntityId: targetEntityId });
      setSetupStatus(response || null);
      const now = new Date();
      setCheckedAt(now.toISOString());
      if (response?.ready) {
        setMessage(
          l(
            "REVREC mapping baseline is ready for this legal entity.",
            "Bu legal entity icin REVREC esleme baz cizgisi hazir."
          )
        );
      }
    } catch (err) {
      setSetupStatus(null);
      setCheckedAt(null);
      setError(
        normalizeApiError(
          err,
          l("Failed to run REVREC year-end checks.", "REVREC yil sonu kontrolleri calistirilamadi.")
        )
      );
    } finally {
      setRunningChecks(false);
    }
  }

  useEffect(() => {
    if (!selectedLegalEntityId) {
      setSetupStatus(null);
      setCheckedAt(null);
      return;
    }
    runChecks(selectedLegalEntityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLegalEntityId]);

  const familyRows = useMemo(
    () => (Array.isArray(setupStatus?.families) ? setupStatus.families : []),
    [setupStatus]
  );

  const familyStatusRows = useMemo(() => {
    return REVREC_REQUIRED_FAMILIES.map((familyCode) => {
      const row =
        familyRows.find(
          (candidate) => toUpper(candidate?.accountFamily) === toUpper(familyCode)
        ) || null;
      const missingCount = Array.isArray(row?.missingPurposeCodes)
        ? row.missingPurposeCodes.length
        : 0;
      return {
        familyCode,
        ready: Boolean(row?.ready),
        missingCount,
        missingPurposeCodes: Array.isArray(row?.missingPurposeCodes)
          ? row.missingPurposeCodes
          : [],
      };
    });
  }, [familyRows]);

  const mappingByPurpose = useMemo(() => getMappingByPurpose(setupStatus), [setupStatus]);

  const reclassRows = useMemo(() => {
    return RECLASS_CHECKS.map((check) => {
      const longMapping = mappingByPurpose.get(check.longPurposeCode) || null;
      const shortMapping = mappingByPurpose.get(check.shortPurposeCode) || null;
      const longId = toPositiveInt(longMapping?.accountId);
      const shortId = toPositiveInt(shortMapping?.accountId);
      const longCode = String(longMapping?.accountCode || "").trim();
      const shortCode = String(shortMapping?.accountCode || "").trim();

      if (!longId || !shortId) {
        return {
          ...check,
          status: "FAIL",
          detail: l(
            "Missing long/short account mapping.",
            "Uzun/kisa hesap eslemelerinden en az biri eksik."
          ),
          longCode,
          shortCode,
        };
      }

      if (longId === shortId) {
        return {
          ...check,
          status: "FAIL",
          detail: l(
            "Long and short accounts must be different.",
            "Uzun ve kisa hesap ayni olamaz."
          ),
          longCode,
          shortCode,
        };
      }

      const prefixWarnings = [];
      if (longCode && !longCode.startsWith(check.expectedLongPrefix)) {
        prefixWarnings.push(
          l(
            `Long account usually starts with ${check.expectedLongPrefix}.`,
            `Uzun hesap genelde ${check.expectedLongPrefix} ile baslar.`
          )
        );
      }
      if (shortCode && !shortCode.startsWith(check.expectedShortPrefix)) {
        prefixWarnings.push(
          l(
            `Short account usually starts with ${check.expectedShortPrefix}.`,
            `Kisa hesap genelde ${check.expectedShortPrefix} ile baslar.`
          )
        );
      }

      if (prefixWarnings.length > 0) {
        return {
          ...check,
          status: "WARN",
          detail: prefixWarnings.join(" "),
          longCode,
          shortCode,
        };
      }

      return {
        ...check,
        status: "PASS",
        detail: l("Mapped and separated correctly.", "Eslemeler ayrik ve dogru."),
        longCode,
        shortCode,
      };
    });
  }, [mappingByPurpose, l]);

  const missingPurposeCodes = useMemo(() => getMissingPurposeCodes(setupStatus), [setupStatus]);

  const summary = useMemo(() => {
    const total = familyStatusRows.length + reclassRows.length;
    let passed = 0;
    let warning = 0;
    let failed = 0;

    for (const row of familyStatusRows) {
      if (row.ready) {
        passed += 1;
      } else {
        failed += 1;
      }
    }
    for (const row of reclassRows) {
      if (row.status === "PASS") {
        passed += 1;
      } else if (row.status === "WARN") {
        warning += 1;
      } else {
        failed += 1;
      }
    }

    return { total, passed, warning, failed };
  }, [familyStatusRows, reclassRows]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {l("Year-End REVREC Control", "Yil Sonu REVREC Kontrol")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Validate deferred/prepaid/accrual purpose mappings before period close.",
                "Donem kapanisi oncesi ertelenmis/pesin/tahakkuk amac eslemelerini dogrulayin."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={legalEntityId}
              onChange={(event) => setLegalEntityId(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={loadingLookups}
            >
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {buildLegalEntityLabel(entity)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => runChecks(selectedLegalEntityId)}
              disabled={runningChecks || !selectedLegalEntityId}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {runningChecks
                ? l("Running checks...", "Kontroller calisiyor...")
                : l("Run checks", "Kontrolleri calistir")}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{l("Total checks", "Toplam kontrol")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{summary.total}</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <div className="text-[11px] uppercase text-emerald-700">{l("Passed", "Gecti")}</div>
            <div className="mt-1 text-base font-semibold text-emerald-800">{summary.passed}</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[11px] uppercase text-amber-700">{l("Warnings", "Uyarilar")}</div>
            <div className="mt-1 text-base font-semibold text-amber-800">{summary.warning}</div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <div className="text-[11px] uppercase text-rose-700">{l("Failed", "Basarisiz")}</div>
            <div className="mt-1 text-base font-semibold text-rose-800">{summary.failed}</div>
          </div>
        </div>

        {checkedAt ? (
          <p className="mt-2 text-xs text-slate-500">
            {l("Last check", "Son kontrol")}:{" "}
            <span className="font-mono">{checkedAt.replace("T", " ").slice(0, 19)}</span>
          </p>
        ) : null}

        {message ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">
          {l("Family readiness baseline", "Aile bazli hazirlik")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {l(
            "Each account family must have complete purpose mappings before running year-end actions.",
            "Yil sonu islemleri oncesi her hesap ailesi icin amac eslemeleri tam olmali."
          )}
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">{l("Family", "Aile")}</th>
                <th className="px-3 py-2">{l("Status", "Durum")}</th>
                <th className="px-3 py-2">{l("Missing purpose codes", "Eksik amac kodlari")}</th>
              </tr>
            </thead>
            <tbody>
              {familyStatusRows.map((row) => {
                const statusText = row.ready ? l("READY", "HAZIR") : l("MISSING", "EKSIK");
                const badgeClass = row.ready
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-rose-100 text-rose-700";
                return (
                  <tr key={row.familyCode} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{row.familyCode}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                        {statusText}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {row.missingPurposeCodes.length > 0
                        ? row.missingPurposeCodes.join(", ")
                        : l("None", "Yok")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">
          {l("Long/short reclass integrity", "Uzun/kisa aktarim butunlugu")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {l(
            "Long and short purpose accounts must both exist and be mapped to different postable accounts.",
            "Uzun ve kisa amac hesaplari mevcut olmali ve farkli postlanabilir hesaplara eslenmeli."
          )}
        </p>

        <div className="mt-3 grid gap-2">
          {reclassRows.map((row) => (
            <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">
                  {l(row.titleEn, row.titleTr)}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                    row.status
                  )}`}
                >
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{row.detail}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {l("Long", "Uzun")} ({row.longPurposeCode}): {row.longCode || "-"} | {l("Short", "Kisa")} ({row.shortPurposeCode}): {row.shortCode || "-"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          {l("Year-end operation reminders", "Yil sonu islem hatirlatmalari")}
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
          <li>{l("Run/validate 480 -> 380 and 280 -> 180 reclass entries.", "480 -> 380 ve 280 -> 180 aktarim kayitlarini calistirin/dogrulayin.")}</li>
          <li>{l("Run/validate 281 -> 181 and 481 -> 381 reclass entries.", "281 -> 181 ve 481 -> 381 aktarim kayitlarini calistirin/dogrulayin.")}</li>
          <li>{l("Review open accrual/deferred balances before period close run.", "Donem kapanisi oncesi acik tahakkuk/ertelenmis bakiyeleri gozden gecirin.")}</li>
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Link
            to="/app/ayarlar/hesap-plani-ayarlari"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
          >
            {l("Open GL Setup", "GL Kurulumunu Ac")}
          </Link>
          <Link
            to="/app/gelecek-yillar-gelirleri"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
          >
            {l("Open REVREC Module", "REVREC Modulu Ac")}
          </Link>
        </div>
      </section>

      {missingPurposeCodes.length > 0 ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-800">
            {l("Blocking missing mappings", "Engelleyici eksik eslemeler")}
          </h2>
          <p className="mt-1 text-xs text-rose-700">
            {l(
              "These purpose codes are missing/invalid and will block stable year-end REVREC posting:",
              "Bu amac kodlari eksik/gecersiz oldugu icin yil sonu REVREC kayitlarini bloke eder:"
            )}
          </p>
          <p className="mt-2 font-mono text-xs text-rose-900">{missingPurposeCodes.join(", ")}</p>
        </section>
      ) : null}
    </div>
  );
}
