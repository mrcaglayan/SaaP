
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  createFixedAssetRun,
  deleteFixedAssetRun,
  getFixedAssetRun,
  listFixedAssetRuns,
  postFixedAssetRun,
  previewFixedAssetRun,
  reprocessFixedAssetRun,
  reverseFixedAssetRun,
} from "../../api/fixedAssets.js";
function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function normalizeText(value) {
  return String(value || "").trim();
}
function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}
function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10) || "-";
}
function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}
function formatNumber(value) {
  if (value == null) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function buildPeriodLabel(period) {
  if (!period) return "-";
  const fiscalYear = period.fiscal_year ?? period.fiscalYear ?? "";
  const periodNo = String(period.period_no ?? period.periodNo ?? "").padStart(2, "0");
  const periodName = normalizeText(period.period_name ?? period.periodName);
  const startDate = formatDate(period.start_date ?? period.startDate);
  const endDate = formatDate(period.end_date ?? period.endDate);
  return `FY${fiscalYear} P${periodNo}${periodName ? ` - ${periodName}` : ""} (${startDate} .. ${endDate})`;
}
function buildLegalEntityLabel(rows, legalEntityId) {
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!normalizedLegalEntityId) return "-";
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => parsePositiveInt(row?.id) === normalizedLegalEntityId
  );
  const code = normalizeText(match?.code);
  const name = normalizeText(match?.name);
  if (code && name) return `${code} - ${name}`;
  if (code) return code;
  if (name) return name;
  return `#${normalizedLegalEntityId}`;
}
function buildRunScopeForm(workingContext) {
  return {
    fiscalPeriodId: String(parsePositiveInt(workingContext?.fiscalPeriodId) || ""),
    postingDate: "",
  };
}
function buildPostForm(run) {
  return {
    postingDate: normalizeText(run?.postingDate),
  };
}
function buildStatusBadgeClass(status) {
  const normalizedStatus = normalizeText(status).toUpperCase();
  if (normalizedStatus === "POSTED") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (normalizedStatus === "REVERSED") {
    return "bg-amber-100 text-amber-800";
  }
  if (normalizedStatus === "DRAFT") {
    return "bg-slate-100 text-slate-700";
  }
  if (normalizedStatus === "READY") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (normalizedStatus === "SKIPPED") {
    return "bg-blue-100 text-blue-800";
  }
  if (normalizedStatus === "ERROR") {
    return "bg-rose-100 text-rose-800";
  }
  return "bg-slate-100 text-slate-700";
}
function buildAllocationSummary(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "-";
  }
  return segments.map((segment) => {
    const type = normalizeText(segment?.allocationType) || "ALLOC";
    const operatingUnitId = parsePositiveInt(segment?.operatingUnitId);
    const fromDate = formatDate(segment?.fromDate);
    const toDate = formatDate(segment?.toDate);
    const eligibleDays = Number(segment?.eligibleDays || 0);
    const ouText = operatingUnitId ? ` OU#${operatingUnitId}` : "";
    return `${type}${ouText} ${fromDate}..${toDate} (${eligibleDays}d)`;
  }).join(" | ");
}
function DetailField({ label, value, mono = false, children = null }) {
  const content = children == null
    ? (value == null || value === "" ? "-" : value)
    : children;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 ${mono ? "font-mono" : ""}`}>
        {content}
      </dd>
    </div>
  );
}
function SummaryStat({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value == null || value === "" ? "-" : value}
      </p>
    </div>
  );
}
function RunRowsTable({ rows, l }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-500">
        {l("No run lines found.", "Run satiri bulunamadi.")}
      </p>
    );
  }
  return (
    <div className="mt-3 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2">{l("Line", "Satir")}</th>
            <th className="px-2 py-2">{l("Asset", "Demirbas")}</th>
            <th className="px-2 py-2">{l("Asset Status", "Demirbas Durumu")}</th>
            <th className="px-2 py-2">{l("Run Status", "Run Durumu")}</th>
            <th className="px-2 py-2 text-right">{l("Eligible Days", "Hak Edilen Gun")}</th>
            <th className="px-2 py-2 text-right">{l("Planned Base", "Planlanan Baz")}</th>
            <th className="px-2 py-2">{l("Detail", "Detay")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const lineNo = Number(row?.lineNo || index + 1);
            const status = normalizeText(row?.status).toUpperCase();
            const detailText =
              normalizeText(row?.errorMessage) ||
              normalizeText(row?.skipReasonText) ||
              (parsePositiveInt(row?.postedTransactionId)
                ? `postedTransactionId=${parsePositiveInt(row?.postedTransactionId)}`
                : "-");
            const allocationSegments = Array.isArray(row?.allocations) && row.allocations.length > 0
              ? row.allocations
              : (Array.isArray(row?.allocationSegments) ? row.allocationSegments : []);
            const assetLabel = [
              normalizeText(row?.assetNo),
              normalizeText(row?.assetName),
            ].filter(Boolean).join(" - ") || `#${parsePositiveInt(row?.assetId) || "?"}`;
            return (
              <tr key={`${row?.id || row?.assetId || "line"}-${lineNo}`} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="px-2 py-2 font-mono text-xs">{lineNo}</td>
                <td className="px-2 py-2">
                  <div className="font-medium text-slate-900">{assetLabel}</div>
                  <div className="text-xs text-slate-500">
                    assetId={parsePositiveInt(row?.assetId) || "-"} | period={row?.periodKey || "-"}
                  </div>
                </td>
                <td className="px-2 py-2">{row?.assetStatus || "-"}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${buildStatusBadgeClass(status)}`}>
                    {status || "-"}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono">{Number(row?.eligibleDays || 0)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatNumber(row?.plannedAmountBase)}</td>
                <td className="px-2 py-2">
                  <div className="text-xs text-slate-700">{detailText}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {l("Allocations", "Dagilimlar")}: {buildAllocationSummary(allocationSegments)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export default function FixedAssetDepreciationRunsPage() {
  const { l } = useI18n();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const {
    workingContext,
    fiscalPeriods,
    legalEntities,
    loadingFiscalPeriods,
  } = useWorkingContext();
  const [searchParams] = useSearchParams();
  const canRead = hasPermission("fixed_assets.depreciation.run") || hasPermission("fixed_assets.read");
  const canRunDepreciation = hasPermission("fixed_assets.depreciation.run");
  const canReverseDepreciation = hasPermission("fixed_assets.depreciation.reverse");
  const canReadJournals = hasPermission("gl.journal.read");
  const queryRunId = parsePositiveInt(searchParams.get("runId"));
  const workingLegalEntityId = parsePositiveInt(workingContext?.legalEntityId);
  const [scopeForm, setScopeForm] = useState(() => buildRunScopeForm(workingContext));
  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [pageMessage, setPageMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [focusedRun, setFocusedRun] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [postForm, setPostForm] = useState(() => buildPostForm(null));
  const [postSaving, setPostSaving] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [reprocessSaving, setReprocessSaving] = useState(false);
  const [reverseSaving, setReverseSaving] = useState(false);
  const [detailActionMessage, setDetailActionMessage] = useState("");
  const [detailActionError, setDetailActionError] = useState("");
  useEffect(() => {
    const fallbackFiscalPeriodId = parsePositiveInt(workingContext?.fiscalPeriodId);
    if (!fallbackFiscalPeriodId) {
      return;
    }
    setScopeForm((prev) => {
      if (parsePositiveInt(prev.fiscalPeriodId)) {
        return prev;
      }
      return {
        ...prev,
        fiscalPeriodId: String(fallbackFiscalPeriodId),
      };
    });
  }, [workingContext?.fiscalPeriodId]);
  useEffect(() => {
    setPreviewResult(null);
    setPreviewError("");
    setPageError("");
  }, [scopeForm.fiscalPeriodId, scopeForm.postingDate, workingLegalEntityId]);
  useEffect(() => {
    if (!canRead || queryRunId) {
      setRuns([]);
      return;
    }
    if (!workingLegalEntityId) {
      setRuns([]);
      return;
    }
    let active = true;
    (async () => {
      setRunsLoading(true);
      setRunsError("");
      try {
        const response = await listFixedAssetRuns({ legalEntityId: workingLegalEntityId });
        if (!active) return;
        setRuns(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) return;
        setRuns([]);
        setRunsError(normalizeApiError(error, l("Failed to load runs.", "Runlar yuklenemedi.")));
      } finally {
        if (active) {
          setRunsLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [canRead, queryRunId, workingLegalEntityId, l]);
  useEffect(() => {
    if (!canRead || !queryRunId) {
      setFocusedRun(null);
      return;
    }
    let active = true;
    (async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const response = await getFixedAssetRun(queryRunId);
        if (!active) return;
        setFocusedRun(response?.row || response || null);
      } catch (error) {
        if (!active) return;
        setFocusedRun(null);
        setDetailError(normalizeApiError(error, l("Failed to load run.", "Run yuklenemedi.")));
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [canRead, queryRunId, l]);
  useEffect(() => {
    setPostForm(buildPostForm(focusedRun));
    setDetailActionMessage("");
    setDetailActionError("");
  }, [focusedRun]);
  function resetDetailActionFeedback() {
    setDetailActionMessage("");
    setDetailActionError("");
  }
  async function handlePreviewRun() {
    const fiscalPeriodId = parsePositiveInt(scopeForm.fiscalPeriodId);
    if (!workingLegalEntityId) {
      setPreviewError(
        l(
          "Select a legal entity in working context before previewing depreciation.",
          "Amortisman onizlemeden once calisma baglaminda bir tuzel kisilik secin."
        )
      );
      return;
    }
    if (!fiscalPeriodId) {
      setPreviewError(
        l("Select a fiscal period first.", "Once bir mali donem secin.")
      );
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    setPageError("");
    try {
      const response = await previewFixedAssetRun({
        legalEntityId: workingLegalEntityId,
        fiscalPeriodId,
        postingDate: normalizeText(scopeForm.postingDate) || undefined,
      });
      setPreviewResult(response || null);
      setPageMessage(
        l("Depreciation preview refreshed.", "Amortisman onizlemesi yenilendi.")
      );
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(
        normalizeApiError(
          error,
          l("Failed to preview depreciation run.", "Amortisman onizlemesi alinamadi.")
        )
      );
    } finally {
      setPreviewLoading(false);
    }
  }
  async function handleCreateDraftRun() {
    const fiscalPeriodId = parsePositiveInt(scopeForm.fiscalPeriodId);
    if (!workingLegalEntityId) {
      setPageError(
        l(
          "Select a legal entity in working context before creating a depreciation run.",
          "Amortisman runu olusturmadan once calisma baglaminda bir tuzel kisilik secin."
        )
      );
      return;
    }
    if (!fiscalPeriodId) {
      setPageError(l("Select a fiscal period first.", "Once bir mali donem secin."));
      return;
    }
    setDraftSaving(true);
    setPageError("");
    setPageMessage("");
    try {
      const response = await createFixedAssetRun({
        legalEntityId: workingLegalEntityId,
        fiscalPeriodId,
        postingDate: normalizeText(scopeForm.postingDate) || undefined,
      });
      const createdRunId = parsePositiveInt(response?.id);
      const createdRunStatus = normalizeText(response?.status).toUpperCase();
      if (!createdRunId) {
        throw new Error(
          l("Create response is missing run id.", "Olusturma yanitinda run id yok.")
        );
      }
      setPageMessage(
        createdRunStatus === "SKIPPED"
          ? l(
            `Depreciation run saved as SKIPPED. id=${createdRunId}`,
            `Amortisman runu SKIPPED olarak kaydedildi. id=${createdRunId}`
          )
          : l(
            `Depreciation draft created. id=${createdRunId}`,
            `Amortisman taslagi olusturuldu. id=${createdRunId}`
          )
      );
      navigate(`/app/demirbas-amortisman-islemleri?runId=${createdRunId}`);
    } catch (error) {
      setPageError(
        normalizeApiError(
          error,
          l("Failed to create depreciation run.", "Amortisman runu olusturulamadi.")
        )
      );
    } finally {
      setDraftSaving(false);
    }
  }
  async function handlePostRun() {
    if (!queryRunId) {
      setDetailActionError(l("Run id is missing.", "Run id eksik."));
      return;
    }
    setPostSaving(true);
    resetDetailActionFeedback();
    try {
      const response = await postFixedAssetRun(queryRunId, {
        postingDate: normalizeText(postForm.postingDate) || undefined,
      });
      setFocusedRun(response?.row || response || null);
      setDetailActionMessage(
        l("Depreciation run posted successfully.", "Amortisman runu basariyla postalandi.")
      );
    } catch (error) {
      setDetailActionError(
        normalizeApiError(error, l("Failed to post run.", "Run postalanamadi."))
      );
    } finally {
      setPostSaving(false);
    }
  }
  async function handleDeleteDraftRun() {
    if (!queryRunId) {
      setDetailActionError(l("Run id is missing.", "Run id eksik."));
      return;
    }
    setDeleteSaving(true);
    resetDetailActionFeedback();
    try {
      await deleteFixedAssetRun(queryRunId);
      const deleteLabel = normalizeText(focusedRun?.status).toUpperCase() === "SKIPPED"
        ? l("Skipped run deleted.", "Atlanan run silindi.")
        : l("Depreciation draft deleted.", "Amortisman taslagi silindi.");
      setPageMessage(
        `${deleteLabel} id=${queryRunId}`
      );
      navigate("/app/demirbas-amortisman-islemleri", { replace: true });
    } catch (error) {
      setDetailActionError(
        normalizeApiError(error, l("Failed to delete run.", "Run silinemedi."))
      );
    } finally {
      setDeleteSaving(false);
    }
  }
  async function handleReprocessRun() {
    if (!queryRunId) {
      setDetailActionError(l("Run id is missing.", "Run id eksik."));
      return;
    }
    setReprocessSaving(true);
    resetDetailActionFeedback();
    try {
      const response = await reprocessFixedAssetRun(queryRunId);
      const newRunId = parsePositiveInt(response?.id);
      const nextStatus = normalizeText(response?.status).toUpperCase();
      if (!newRunId) {
        throw new Error(
          l("Reprocess response is missing run id.", "Yeniden isleme yanitinda run id yok.")
        );
      }
      setPageMessage(
        nextStatus === "SKIPPED"
          ? l(
            `Skipped run reprocessed and remains SKIPPED. id=${newRunId}`,
            `Atlanan run yeniden islendi ve SKIPPED olarak kaldi. id=${newRunId}`
          )
          : l(
            `Skipped run reprocessed. New run id=${newRunId}`,
            `Atlanan run yeniden islendi. Yeni run id=${newRunId}`
          )
      );
      navigate(`/app/demirbas-amortisman-islemleri?runId=${newRunId}`, { replace: true });
    } catch (error) {
      setDetailActionError(
        normalizeApiError(
          error,
          l("Failed to reprocess skipped run.", "Atlanan run yeniden islenemedi.")
        )
      );
    } finally {
      setReprocessSaving(false);
    }
  }
  async function handleReverseRun() {
    if (!queryRunId) {
      setDetailActionError(l("Run id is missing.", "Run id eksik."));
      return;
    }
    setReverseSaving(true);
    resetDetailActionFeedback();
    try {
      const response = await reverseFixedAssetRun(queryRunId);
      setFocusedRun(response?.row || response || null);
      setDetailActionMessage(
        l("Depreciation run reversed successfully.", "Amortisman runu basariyla ters kayitlandi.")
      );
    } catch (error) {
      setDetailActionError(
        normalizeApiError(error, l("Failed to reverse run.", "Run ters kayitlanamadi."))
      );
    } finally {
      setReverseSaving(false);
    }
  }
  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.depreciation.run", "Eksik yetki: fixed_assets.depreciation.run")}
        </p>
      </div>
    );
  }
  const legalEntityLabel = buildLegalEntityLabel(legalEntities, workingLegalEntityId);
  const selectedPeriod = (Array.isArray(fiscalPeriods) ? fiscalPeriods : []).find(
    (row) => parsePositiveInt(row?.id) === parsePositiveInt(scopeForm.fiscalPeriodId)
  );
  const previewHasBlockingErrors = Number(previewResult?.summary?.errorCount || 0) > 0;
  const previewWillSaveSkippedRun = Number(previewResult?.summary?.readyAssetCount || 0) === 0
    && Number(previewResult?.summary?.skippedAssetCount || 0) > 0
    && Number(previewResult?.summary?.errorCount || 0) === 0;
  if (!queryRunId) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {l("Depreciation Runs", "Amortisman Run Listesi")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Preview the month-end depreciation impact, create a run, then open it for posting, reprocessing, or reversal.",
              "Ay sonu amortisman etkisini onizleyin, bir run olusturun, sonra runu acip postalayin, yeniden isleyin veya ters kayitlayin."
            )}
          </p>
          {!canRunDepreciation ? (
            <p className="mt-2 text-xs text-amber-700">
              {l(
                "Read-only access - you do not have depreciation run permissions.",
                "Salt okunur erisim - amortisman run yetkiniz yok."
              )}
            </p>
          ) : null}
        </section>
        {pageError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
            <p className="text-sm text-rose-700">{pageError}</p>
          </div>
        ) : null}
        {pageMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <p className="text-sm text-emerald-700">{pageMessage}</p>
          </div>
        ) : null}
        {canRunDepreciation ? (
          <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Create Depreciation Run", "Amortisman Runu Olustur")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "This is the next month-end step after activation. Choose the fiscal period, preview the eligible assets, then create a run.",
                "Aktiflestirme sonrasi bir sonraki ay sonu adimi budur. Mali donemi secin, uygun demirbaslari onizleyin, sonra bir run olusturun."
              )}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <SummaryStat
                label={l("Legal Entity", "Tuzel Kisilik")}
                value={legalEntityLabel}
              />
              <SummaryStat
                label={l("Working Period", "Calisma Donemi")}
                value={selectedPeriod ? buildPeriodLabel(selectedPeriod) : l("Not selected", "Secili degil")}
              />
              <SummaryStat
                label={l("Custom Posting Date", "Ozel Kayit Tarihi")}
                value={normalizeText(scopeForm.postingDate) || l("Auto from period", "Donemden otomatik")}
              />
            </div>
            {!workingLegalEntityId ? (
              <p className="mt-4 text-sm text-amber-700">
                {l(
                  "Select a legal entity from the working context bar first.",
                  "Once calisma baglami cubugundan bir tuzel kisilik secin."
                )}
              </p>
            ) : null}
            {workingLegalEntityId && !loadingFiscalPeriods && (!Array.isArray(fiscalPeriods) || fiscalPeriods.length === 0) ? (
              <p className="mt-4 text-sm text-amber-700">
                {l(
                  "No fiscal periods are loaded in working context. Select a fiscal calendar/period first.",
                  "Calisma baglaminda mali donem yuklu degil. Once mali takvim/donem secin."
                )}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
                {l("Fiscal Period", "Mali Donem")}
                <select
                  className="mt-1 w-full rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                  value={scopeForm.fiscalPeriodId}
                  onChange={(event) =>
                    setScopeForm((prev) => ({
                      ...prev,
                      fiscalPeriodId: event.target.value,
                    }))
                  }
                  disabled={!canRunDepreciation || loadingFiscalPeriods}
                >
                  <option value="">{l("Select fiscal period", "Mali donem secin")}</option>
                  {(Array.isArray(fiscalPeriods) ? fiscalPeriods : []).map((period) => (
                    <option key={`fa-depr-period-${period.id}`} value={period.id}>
                      {buildPeriodLabel(period)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
                {l("Posting Date Override", "Kayit Tarihi Override")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                  value={scopeForm.postingDate}
                  onChange={(event) =>
                    setScopeForm((prev) => ({
                      ...prev,
                      postingDate: event.target.value,
                    }))
                  }
                  disabled={!canRunDepreciation}
                />
              </label>
            </div>
            {previewError ? (
              <p className="mt-3 text-sm text-rose-700">{previewError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="cursor-pointer rounded-md border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handlePreviewRun}
                disabled={!canRunDepreciation || previewLoading || draftSaving}
              >
                {previewLoading ? l("Previewing...", "Onizleniyor...") : l("Preview", "Onizle")}
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleCreateDraftRun}
                disabled={!canRunDepreciation || draftSaving || previewLoading || previewHasBlockingErrors}
              >
                {draftSaving
                  ? l("Creating...", "Olusturuluyor...")
                  : previewWillSaveSkippedRun
                    ? l("Create Skipped Run", "Atlanan Run Olustur")
                    : l("Create Draft Run", "Taslak Run Olustur")}
              </button>
            </div>
            {previewHasBlockingErrors ? (
              <p className="mt-3 text-sm text-rose-700">
                {l(
                  "Draft creation is blocked until the preview errors are resolved. Depreciation periods must be posted in sequence.",
                  "Onizleme hatalari cozulmeden taslak olusturma engellenir. Amortisman donemleri sirali post edilmelidir."
                )}
              </p>
            ) : null}
            {previewWillSaveSkippedRun ? (
              <p className="mt-3 text-sm text-cyan-700">
                {l(
                  "No eligible depreciation lines exist for this period. Creating the run will save it as SKIPPED with no journal entry.",
                  "Bu donem icin uygun amortisman satiri yok. Runu olusturmak, runu yevmiye fis olmadan SKIPPED olarak kaydeder."
                )}
              </p>
            ) : null}
          </section>
        ) : null}
        {previewResult ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Preview Result", "Onizleme Sonucu")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {previewResult.periodKey || "-"} | {formatDate(previewResult.postingDate)}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {l("Excluded low-value assets", "Dislanan dusuk degerli demirbaslar")}: {Number(previewResult.excludedLowValueAssetCount || 0)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <SummaryStat label={l("Assets", "Demirbas")} value={previewResult.summary?.assetCount ?? 0} />
              <SummaryStat label={l("Ready", "Hazir")} value={previewResult.summary?.readyAssetCount ?? 0} />
              <SummaryStat label={l("Skipped", "Atlanan")} value={previewResult.summary?.skippedAssetCount ?? 0} />
              <SummaryStat label={l("Errors", "Hata")} value={previewResult.summary?.errorCount ?? 0} />
              <SummaryStat label={l("Planned Txn", "Planlanan Islem")} value={formatNumber(previewResult.summary?.totalPlannedAmountTxn)} mono />
              <SummaryStat label={l("Planned Base", "Planlanan Baz")} value={formatNumber(previewResult.summary?.totalPlannedAmountBase)} mono />
            </div>
            <RunRowsTable rows={previewResult.rows} l={l} />
          </section>
        ) : null}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Existing Runs", "Mevcut Runlar")}
          </h2>
          {runsError ? (
            <p className="mt-3 text-sm text-rose-700">{runsError}</p>
          ) : null}
          {runsLoading ? (
            <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p>
          ) : runs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              {l("No depreciation runs found.", "Amortisman runu bulunamadi.")}
            </p>
          ) : (
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">{l("ID", "ID")}</th>
                    <th className="px-2 py-2">{l("Period", "Donem")}</th>
                    <th className="px-2 py-2">{l("Status", "Durum")}</th>
                    <th className="px-2 py-2 text-right">{l("Assets", "Demirbas")}</th>
                    <th className="px-2 py-2 text-right">{l("Planned Base", "Planlanan Baz")}</th>
                    <th className="px-2 py-2">{l("Created At", "Olusturma")}</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const runStatus = normalizeText(run?.status).toUpperCase();
                    return (
                      <tr key={`fa-depr-run-${run.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-xs">{run.id}</td>
                        <td className="px-2 py-1.5">{run.periodKey || run.period_key || "-"}</td>
                        <td className="px-2 py-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${buildStatusBadgeClass(runStatus)}`}>
                            {runStatus || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{Number(run.assetCount || run.asset_count || 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(run.totalPlannedAmountBase ?? run.total_planned_amount_base)}</td>
                        <td className="px-2 py-1.5">{formatDate(run.createdAt || run.created_at)}</td>
                        <td className="px-2 py-1.5">
                          <Link
                            to={`/app/demirbas-amortisman-islemleri?runId=${run.id}`}
                            className="text-xs font-medium text-cyan-700 hover:underline"
                          >
                            {l("Open", "Ac")}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }
  if (detailLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Loading run...", "Run yukleniyor...")}</p>
      </div>
    );
  }
  if (detailError) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <p className="text-sm text-rose-700">{detailError}</p>
        </div>
        <Link to="/app/demirbas-amortisman-islemleri" className="text-sm text-cyan-700 hover:underline">
          {l("Back to runs", "Run listesine don")}
        </Link>
      </div>
    );
  }
  if (!focusedRun) return null;
  const runStatus = normalizeText(focusedRun.status).toUpperCase();
  const canPostRun = canRunDepreciation && runStatus === "DRAFT";
  const canDeleteDraftRun = canRunDepreciation && runStatus === "DRAFT";
  const canDeleteSkippedRun = canRunDepreciation && runStatus === "SKIPPED";
  const canReprocessRun = canRunDepreciation && runStatus === "SKIPPED";
  const canReverseRun = canReverseDepreciation && runStatus === "POSTED";
  const postedJournalEntryId = parsePositiveInt(
    focusedRun.postedJournalEntryId || focusedRun.posted_journal_entry_id
  );
  const reversalJournalEntryId = parsePositiveInt(
    focusedRun.reversalJournalEntryId || focusedRun.reversal_journal_entry_id
  );
  return (
    <div className="space-y-4">
      <Link to="/app/demirbas-amortisman-islemleri" className="text-sm text-cyan-700 hover:underline">
        {l("Back to runs", "Run listesine don")}
      </Link>
      {pageMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm text-emerald-700">{pageMessage}</p>
        </div>
      ) : null}
      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Depreciation Run Detail", "Amortisman Run Detayi")} #{queryRunId}
          </h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${buildStatusBadgeClass(runStatus)}`}>
            {runStatus || "-"}
          </span>
        </div>
        <dl className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-4">
          <DetailField label={l("Period", "Donem")} value={focusedRun.periodKey} />
          <DetailField label={l("Legal Entity", "Tuzel Kisilik")} value={buildLegalEntityLabel(legalEntities, focusedRun.legalEntityId || focusedRun.legal_entity_id)} />
          <DetailField label={l("Book ID", "Defter ID")} value={focusedRun.bookId || focusedRun.book_id} mono />
          <DetailField label={l("Posting Date", "Kayit Tarihi")} value={formatDate(focusedRun.postingDate || focusedRun.posting_date)} />
          <DetailField label={l("Created At", "Olusturma")} value={formatDateTime(focusedRun.createdAt || focusedRun.created_at)} />
          <DetailField label={l("Posted At", "Post Tarihi")} value={formatDateTime(focusedRun.postedAt || focusedRun.posted_at)} />
          <DetailField label={l("Reversed At", "Ters Kayit Tarihi")} value={formatDateTime(focusedRun.reversedAt || focusedRun.reversed_at)} />
          <DetailField label={l("Posted Journal", "Post Yevmiye")}>
            {postedJournalEntryId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-slate-900">{postedJournalEntryId}</span>
                {canReadJournals ? (
                  <Link
                    to={`/app/mahsup-islemleri?journalId=${postedJournalEntryId}`}
                    className="text-xs font-medium text-cyan-700 hover:underline"
                  >
                    {l("Open journal", "Yevmiyeyi ac")}
                  </Link>
                ) : null}
              </div>
            ) : (
              "-"
            )}
          </DetailField>
          <DetailField label={l("Reversal Journal", "Ters Kayit Yevmiye")}>
            {reversalJournalEntryId ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-slate-900">{reversalJournalEntryId}</span>
                {canReadJournals ? (
                  <Link
                    to={`/app/mahsup-islemleri?journalId=${reversalJournalEntryId}`}
                    className="text-xs font-medium text-cyan-700 hover:underline"
                  >
                    {l("Open journal", "Yevmiyeyi ac")}
                  </Link>
                ) : null}
              </div>
            ) : (
              "-"
            )}
          </DetailField>
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{l("Run Summary", "Run Ozeti")}</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryStat label={l("Assets", "Demirbas")} value={focusedRun.assetCount ?? 0} />
          <SummaryStat label={l("Posted", "Postalanan")} value={focusedRun.postedAssetCount ?? 0} />
          <SummaryStat label={l("Skipped", "Atlanan")} value={focusedRun.skippedAssetCount ?? 0} />
          <SummaryStat label={l("Errors", "Hata")} value={focusedRun.errorCount ?? 0} />
          <SummaryStat label={l("Planned Base", "Planlanan Baz")} value={formatNumber(focusedRun.totalPlannedAmountBase)} mono />
          <SummaryStat label={l("Posted Base", "Postalanan Baz")} value={formatNumber(focusedRun.totalPostedAmountBase)} mono />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label={l("Line Count", "Satir Sayisi")} value={focusedRun.lineCount ?? 0} />
          <SummaryStat label={l("Allocation Rows", "Dagilim Satirlari")} value={focusedRun.allocationRowCount ?? 0} />
          <SummaryStat label={l("Fiscal Period ID", "Mali Donem ID")} value={focusedRun.fiscalPeriodId ?? "-"} mono />
          <SummaryStat label={l("Period Convention", "Donem Konvansiyonu")} value={focusedRun.periodConvention || "-"} />
        </div>
      </section>
      {canPostRun || canDeleteDraftRun || canDeleteSkippedRun || canReprocessRun || canReverseRun ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{l("Available Actions", "Mevcut Aksiyonlar")}</h3>
          {detailActionError ? (
            <p className="mt-3 text-sm text-rose-700">{detailActionError}</p>
          ) : null}
          {detailActionMessage ? (
            <p className="mt-3 text-sm text-emerald-700">{detailActionMessage}</p>
          ) : null}
          {canPostRun ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                {l("Post Draft Run", "Taslak Runu Postala")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                  {l("Posting Date Override", "Kayit Tarihi Override")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    value={postForm.postingDate}
                    onChange={(event) =>
                      setPostForm((prev) => ({
                        ...prev,
                        postingDate: event.target.value,
                      }))
                    }
                    disabled={postSaving}
                  />
                </label>
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {l("Resolved Run Period", "Cozulen Run Donemi")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{focusedRun.periodKey || "-"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handlePostRun}
                  disabled={postSaving || deleteSaving || reprocessSaving}
                >
                  {postSaving ? l("Posting...", "Postalaniyor...") : l("Post Run", "Runu Postala")}
                </button>
                {canDeleteDraftRun ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleDeleteDraftRun}
                    disabled={deleteSaving || postSaving || reprocessSaving}
                  >
                    {deleteSaving ? l("Deleting...", "Siliniyor...") : l("Delete Draft", "Taslagi Sil")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {canReprocessRun || canDeleteSkippedRun ? (
            <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
                {l("Skipped Run Actions", "Atlanan Run Aksiyonlari")}
              </p>
              <p className="mt-2 text-sm text-cyan-950">
                {l(
                  "Use reprocess only after correcting the asset or lifecycle data. Reprocess is blocked when the fiscal period is closed or a later non-reversed run already exists.",
                  "Yeniden islemeyi yalnizca demirbas veya yasam dongusu verisi duzeltildikten sonra kullanin. Mali donem kapaliysa veya daha sonraki terslenmemis bir run varsa yeniden isleme engellenir."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canReprocessRun ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleReprocessRun}
                    disabled={reprocessSaving || deleteSaving || postSaving}
                  >
                    {reprocessSaving ? l("Reprocessing...", "Yeniden isleniyor...") : l("Reprocess Run", "Runu Yeniden Isle")}
                  </button>
                ) : null}
                {canDeleteSkippedRun ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleDeleteDraftRun}
                    disabled={deleteSaving || reprocessSaving || postSaving}
                  >
                    {deleteSaving ? l("Deleting...", "Siliniyor...") : l("Delete Skipped Run", "Atlanan Runu Sil")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {canReverseRun ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                {l("Reverse Posted Run", "Postalanmis Runu Ters Kayitla")}
              </p>
              <p className="mt-2 text-sm text-amber-950">
                {l(
                  "Reverse only when there is no later lifecycle or later posted depreciation conflict on the affected assets.",
                  "Sadece etkilenen demirbaslarda daha sonraki bir yasam dongusu veya daha sonraki postalanmis amortisman cakismasi yoksa ters kayit yapin."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleReverseRun}
                  disabled={reverseSaving}
                >
                  {reverseSaving ? l("Reversing...", "Ters kayitlaniyor...") : l("Reverse Run", "Runu Ters Kayitla")}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="text-xs text-amber-700">
          {l(
            "Read-only access - you do not have run actions for this run state.",
            "Salt okunur erisim - bu run durumunda run aksiyon yetkiniz yok."
          )}
        </p>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{l("Run Lines", "Run Satirlari")}</h3>
        <RunRowsTable rows={focusedRun.lines} l={l} />
      </section>
    </div>
  );
}
