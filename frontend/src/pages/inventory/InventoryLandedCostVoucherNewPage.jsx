
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import { listItemCards } from "../../api/itemCards.js";
import {
  createInventoryLandedCostVoucher,
  listInventoryLandedCostSourceLineLookup,
  listInventoryLandedCostTargetLookup,
  listInventoryWarehouses,
  previewInventoryLandedCostVoucher,
} from "../../api/inventory.js";
const AMOUNT_TOLERANCE = 0.01;const STEP_KEYS = [1, 2, 3, 4];
function normalizeText(value) {
  return String(value || "").trim();
}
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function roundAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000000) / 1000000;
}
function parseAmountInput(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundAmount(parsed) : 0;
}
function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}
function mapLegalEntityOption(row) {
  const id = String(toPositiveInt(row?.id) || "");
  if (!id) {
    return null;
  }
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value: id,
    label: code && name ? `${code} - ${name}` : code || name || `#${id}`,
  };
}
function getOwnershipLabel(row, l) {
  const scope = String(row?.ownershipScope || row?.anchorOwnershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(
      row?.operatingUnitCode
      || row?.anchorOperatingUnitCode
      || row?.operating_unit_code
    );
    const name = normalizeText(
      row?.operatingUnitName
      || row?.anchorOperatingUnitName
      || row?.operating_unit_name
    );
    const operatingUnitId =
      toPositiveInt(row?.operatingUnitId)
      || toPositiveInt(row?.anchorOperatingUnitId)
      || toPositiveInt(row?.operating_unit_id);
    return code && name
      ? `${code} - ${name}`
      : code || name || `${l("Operating unit", "Isletme birimi")} #${operatingUnitId || "-"}`;
  }
  return l("Central", "Merkez");
}
function getContextKey(row) {
  const scope = String(row?.ownershipScope || row?.anchorOwnershipScope || "CENTRAL")
    .trim()
    .toUpperCase();
  const operatingUnitId =
    toPositiveInt(row?.operatingUnitId)
    || toPositiveInt(row?.anchorOperatingUnitId)
    || "";
  return `${scope}:${operatingUnitId || ""}`;
}
function getFormContextKey(form) {
  return `${String(form?.ownershipScope || "CENTRAL").trim().toUpperCase()}:${
    toPositiveInt(form?.operatingUnitId) || ""
  }`;
}
function getSourceDisabledReasonLabel(code, l) {
  switch (String(code || "").trim().toUpperCase()) {
    case "TRACK40_CHARGE_LINE":
      return l("Charge line from Track 40", "Track 40 dagitim satiri");
    case "TAX_LINE_NOT_ELIGIBLE":
      return l("Tax line not eligible", "Vergi satiri uygun degil");
    case "NON_STANDARD_LINE_NOT_ELIGIBLE":
      return l("Non-standard line not eligible", "Standart olmayan satir uygun degil");
    case "STOCK_AFFECTING_LINE_NOT_ELIGIBLE":
      return l("Stock-affecting line not eligible", "Stok etkili satir uygun degil");
    case "FIXED_ASSET_LINE_NOT_ELIGIBLE":
      return l("Fixed asset line not eligible", "Sabit kiymet satiri uygun degil");
    case "NO_REMAINING_UNAPPLIED_AMOUNT":
      return l("No remaining unapplied amount", "Kalan uygulanabilir tutar yok");
    case "WRONG_LEGAL_ENTITY":
      return l("Wrong legal entity", "Yanlis tuzel kisilik");
    case "SOURCE_DOCUMENT_UNDER_REVERSAL":
      return l("Source document under reversal", "Kaynak belge ters kayit surecinde");
    default:
      return normalizeText(code) || l("Not eligible", "Uygun degil");
  }
}
function getBlockedReasonLabel(code, l) {
  switch (String(code || "").trim().toUpperCase()) {
    case "CROSS_CONTEXT_DESCENDANT":
      return l(
        "Transfer descendant leaves the selected context",
        "Transfer devam katmani secili baglamin disina cikiyor"
      );
    case "OUT_OF_SCOPE_CONSUMPTION":
      return l(
        "Consumed quantity exists outside the selected context",
        "Secili baglam disinda tuketim mevcut"
      );
    default:
      return normalizeText(code) || l("Blocked", "Bloklu");
  }
}
function createDefaultForm(workingContext) {
  return {
    legalEntityId: String(toPositiveInt(workingContext?.legalEntityId) || ""),
    postingDate: todayDateOnly(),
    ownershipScope: "CENTRAL",
    operatingUnitId: "",
    note: "",
  };
}
function createDefaultSourceFilters() {
  return {
    postingDateFrom: "",
    postingDateTo: "",
    vendor: "",
    currencyCode: "",
    search: "",
    onlyRemainingUnapplied: false,
  };
}
function createDefaultTargetFilters() {
  return {
    receiptDateFrom: "",
    receiptDateTo: "",
    itemCardId: "",
    warehouseId: "",
    search: "",
    sameLegalEntityOnly: true,
    matchSelectedContextOnly: true,
  };
}
function deriveLocalManualAllocations(targets, totalAmount) {
  const selectedTargets = Array.isArray(targets) ? targets : [];
  if (selectedTargets.length === 0) {
    return {};
  }
  const equalBase = roundAmount(totalAmount / selectedTargets.length);
  let remaining = roundAmount(totalAmount);
  const next = {};
  selectedTargets.forEach((target, index) => {
    const targetId = String(target.sourceStockLinkId);
    const amount =
      index === selectedTargets.length - 1 ? remaining : Math.min(equalBase, remaining);
    next[targetId] = String(roundAmount(amount));
    remaining = roundAmount(remaining - amount);
  });
  return next;
}
function StepPill({ active, complete, index, label, onClick }) {
  const className = active
    ? "border-slate-900 bg-slate-900 text-white"
    : complete
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-white text-slate-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${className}`}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold">
        {index}
      </span>
      <span className="truncate text-sm font-semibold">{label}</span>
    </button>
  );
}
function SummaryBlock({ label, value, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-slate-900">{value ?? children ?? "-"}</div>
    </div>
  );
}
function Badge({ tone = "slate", children }) {
  const className =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}
export default function InventoryLandedCostVoucherNewPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { workingContext, legalEntities: workingContextLegalEntities } = useWorkingContext();
  const canRead = hasPermission("inventory.read");
  const canUpsert = hasPermission("inventory.upsert");
  const canReadItemCards = hasPermission("item.card.read");
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState(() => createDefaultForm(workingContext));
  const [sourceFilters, setSourceFilters] = useState(createDefaultSourceFilters);
  const [targetFilters, setTargetFilters] = useState(createDefaultTargetFilters);
  const [allocationMethod, setAllocationMethod] = useState("EQUAL");
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [itemCardRows, setItemCardRows] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [targetRows, setTargetRows] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [dependencyError, setDependencyError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [selectedSourcesById, setSelectedSourcesById] = useState({});
  const [selectedTargetsById, setSelectedTargetsById] = useState({});
  const [manualAllocatedInputs, setManualAllocatedInputs] = useState({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedPreviewTargetId, setSelectedPreviewTargetId] = useState("");
  const [expandedTargetIds, setExpandedTargetIds] = useState([]);
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );
  const selectedSources = useMemo(
    () => Object.values(selectedSourcesById),
    [selectedSourcesById]
  );
  const selectedTargets = useMemo(
    () => Object.values(selectedTargetsById),
    [selectedTargetsById]
  );
  const selectedSourceAmountBase = useMemo(
    () =>
      roundAmount(
        selectedSources.reduce(
          (sum, row) => sum + parseAmountInput(row.appliedAmountBaseInput ?? row.remainingUnappliedAmountBase),
          0
        )
      ),
    [selectedSources]
  );
  const manualAllocatedTotalBase = useMemo(
    () =>
      roundAmount(
        selectedTargets.reduce(
          (sum, row) => sum + parseAmountInput(manualAllocatedInputs[String(row.sourceStockLinkId)]),
          0
        )
      ),
    [manualAllocatedInputs, selectedTargets]
  );
  const formContextKey = useMemo(() => getFormContextKey(form), [form]);
  const selectedTargetContextKeys = useMemo(
    () => Array.from(new Set(selectedTargets.map((row) => getContextKey(row)))),
    [selectedTargets]
  );
  const hasMixedTargetContexts = selectedTargetContextKeys.length > 1;
  const hasSelectedTargetOutsideFormContext = selectedTargets.some(
    (row) => getContextKey(row) !== formContextKey
  );
  const previewTargets = Array.isArray(previewResult?.targets) ? previewResult.targets : [];
  const previewSelectedTarget =
    previewTargets.find(
      (row) => String(row.sourceStockLinkId) === String(selectedPreviewTargetId)
    ) || previewTargets[0] || null;
  const previewHasTransferDescendant = previewTargets.some((target) =>
    (target.descendantLayerAllocations || []).some(
      (row) =>
        toPositiveInt(row?.resolvedInventoryMovementId)
        && toPositiveInt(row?.resolvedInventoryMovementId)
          !== toPositiveInt(target?.sourceAnchorInventoryMovementId)
    )
  );
  const previewHasBlockedContextAmount =
    roundAmount(previewResult?.targetSummary?.totalBlockedAmountBase || 0) > AMOUNT_TOLERANCE / 100;
  const stickyWarnings = useMemo(() => {
    const warnings = [];
    if (hasMixedTargetContexts || hasSelectedTargetOutsideFormContext) {
      warnings.push(
        l(
          "Selected targets span multiple ownership contexts.",
          "Secili hedefler birden fazla sahiplik baglamina yayiliyor."
        )
      );
    }
    if (previewHasBlockedContextAmount) {
      warnings.push(
        l(
          "Part of the landed-cost allocation falls outside the voucher context.",
          "Dagitimin bir kismi voucher baglaminin disinda kaliyor."
        )
      );
    }
    if (previewHasTransferDescendant) {
      warnings.push(
        l(
          "Transfer-aware descendant layers were included in the resolved preview.",
          "Cozumlenen onizlem transfer farkindalikli inen katmanlari iceriyor."
        )
      );
    }
    if (previewError) {
      warnings.push(previewError);
    }
    return warnings;
  }, [
    hasMixedTargetContexts,
    hasSelectedTargetOutsideFormContext,
    l,
    previewError,
    previewHasBlockedContextAmount,
    previewHasTransferDescendant,
  ]);
  useEffect(() => {
    setForm((current) => ({
      ...current,
      legalEntityId:
        current.legalEntityId || String(toPositiveInt(workingContext?.legalEntityId) || ""),
      operatingUnitId:
        current.ownershipScope === "OPERATING_UNIT"
          ? current.operatingUnitId || String(toPositiveInt(workingContext?.operatingUnitId) || "")
          : "",
    }));
  }, [workingContext]);
  useEffect(() => {
    let active = true;
    async function loadOperatingUnitOptions() {
      const legalEntityId = toPositiveInt(form.legalEntityId);
      if (!legalEntityId) {
        setOperatingUnits([]);
        return;
      }
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
        });
        if (!active) {
          return;
        }
        setOperatingUnits(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (active) {
          setOperatingUnits([]);
        }
      }
    }
    void loadOperatingUnitOptions();
    return () => {
      active = false;
    };
  }, [form.legalEntityId]);
  useEffect(() => {
    let active = true;
    async function loadDependencies() {
      const legalEntityId = toPositiveInt(form.legalEntityId);
      if (!canRead || !legalEntityId) {
        setWarehouseRows([]);
        setItemCardRows([]);
        return;
      }
      setDependencyError("");
      try {
        const [warehouseResponse, itemCardResponse] = await Promise.all([
          listInventoryWarehouses({
            legalEntityId,
            status: "ACTIVE",
            limit: 500,
            offset: 0,
          }),
          canReadItemCards
            ? listItemCards({
                legalEntityId,
                status: "ACTIVE",
                limit: 500,
                offset: 0,
              })
            : Promise.resolve({ rows: [] }),
        ]);
        if (!active) {
          return;
        }
        setWarehouseRows(Array.isArray(warehouseResponse?.rows) ? warehouseResponse.rows : []);
        setItemCardRows(Array.isArray(itemCardResponse?.rows) ? itemCardResponse.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setWarehouseRows([]);
        setItemCardRows([]);
        setDependencyError(
          normalizeApiError(
            error,
            l("Failed to load landed-cost dependencies.", "Stok maliyet bagimliliklari yuklenemedi.")
          )
        );
      }
    }
    void loadDependencies();
    return () => {
      active = false;
    };
  }, [canRead, canReadItemCards, form.legalEntityId, l]);
  useEffect(() => {
    let active = true;
    async function loadSourceRows() {
      const legalEntityId = toPositiveInt(form.legalEntityId);
      if (!canRead || !legalEntityId) {
        setSourceRows([]);
        setSourceLoading(false);
        return;
      }
      setSourceLoading(true);
      setSourceError("");
      try {
        const response = await listInventoryLandedCostSourceLineLookup({
          legalEntityId,
          postingDateFrom: sourceFilters.postingDateFrom || undefined,
          postingDateTo: sourceFilters.postingDateTo || undefined,
          vendor: sourceFilters.vendor || undefined,
          currencyCode: sourceFilters.currencyCode || undefined,
          search: sourceFilters.search || undefined,
          onlyRemainingUnapplied: sourceFilters.onlyRemainingUnapplied ? "true" : undefined,
          limit: 200,
        });
        if (!active) {
          return;
        }
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setSourceRows(nextRows);
        setSelectedSourcesById((current) => {
          const next = { ...current };
          nextRows.forEach((row) => {
            const key = String(row.sourceCariDocumentLineId);
            if (next[key]) {
              next[key] = { ...row, ...next[key] };
            }
          });
          return next;
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setSourceRows([]);
        setSourceError(
          normalizeApiError(
            error,
            l(
              "Failed to load eligible posted AP source lines.",
              "Uygun kaydedilmis AP kaynak satirlari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setSourceLoading(false);
        }
      }
    }
    void loadSourceRows();
    return () => {
      active = false;
    };
  }, [canRead, form.legalEntityId, l, sourceFilters]);
  useEffect(() => {
    let active = true;
    async function loadTargetRows() {
      const legalEntityId = toPositiveInt(form.legalEntityId);
      if (!canRead || !legalEntityId) {
        setTargetRows([]);
        setTargetLoading(false);
        return;
      }
      setTargetLoading(true);
      setTargetError("");
      try {
        const response = await listInventoryLandedCostTargetLookup({
          legalEntityId,
          ownershipScope: form.ownershipScope,
          operatingUnitId:
            form.ownershipScope === "OPERATING_UNIT" ? form.operatingUnitId || undefined : undefined,
          receiptDateFrom: targetFilters.receiptDateFrom || undefined,
          receiptDateTo: targetFilters.receiptDateTo || undefined,
          itemCardId: targetFilters.itemCardId || undefined,
          warehouseId: targetFilters.warehouseId || undefined,
          search: targetFilters.search || undefined,
          matchSelectedContextOnly: targetFilters.matchSelectedContextOnly ? "true" : undefined,
          limit: 200,
        });
        if (!active) {
          return;
        }
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setTargetRows(nextRows);
        setSelectedTargetsById((current) => {
          const next = { ...current };
          nextRows.forEach((row) => {
            const key = String(row.sourceStockLinkId);
            if (next[key]) {
              next[key] = { ...row, ...next[key] };
            }
          });
          return next;
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setTargetRows([]);
        setTargetError(
          normalizeApiError(
            error,
            l(
              "Failed to load posted receipt targets.",
              "Kaydedilmis kabul hedefleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setTargetLoading(false);
        }
      }
    }
    void loadTargetRows();
    return () => {
      active = false;
    };
  }, [
    canRead,
    form.legalEntityId,
    form.operatingUnitId,
    form.ownershipScope,
    l,
    targetFilters,
  ]);
  function invalidatePreview() {
    setPreviewResult(null);
    setPreviewError("");
    setSubmitError("");
  }
  function updateForm(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "ownershipScope" && value !== "OPERATING_UNIT") {
        next.operatingUnitId = "";
      }
      if (field === "ownershipScope" && value === "OPERATING_UNIT" && !next.operatingUnitId) {
        next.operatingUnitId = String(toPositiveInt(workingContext?.operatingUnitId) || "");
      }
      return next;
    });
    if (field === "legalEntityId") {
      setSelectedSourcesById({});
      setSelectedTargetsById({});
      setManualAllocatedInputs({});
      setSourceFilters(createDefaultSourceFilters());
      setTargetFilters(createDefaultTargetFilters());
      setCurrentStep(1);
      invalidatePreview();
      return;
    }
    if (field === "ownershipScope" || field === "operatingUnitId" || field === "postingDate") {
      setSelectedTargetsById({});
      setManualAllocatedInputs({});
      if (currentStep > 2) {
        setCurrentStep(2);
      }
      invalidatePreview();
    }
  }
  function updateSourceFilter(field, value) {
    setSourceFilters((current) => ({ ...current, [field]: value }));
  }
  function updateTargetFilter(field, value) {
    setTargetFilters((current) => ({ ...current, [field]: value }));
  }
  function toggleSourceRow(row) {
    const key = String(row.sourceCariDocumentLineId);
    setSelectedSourcesById((current) => {
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = {
          ...row,
          appliedAmountBaseInput: String(roundAmount(row.remainingUnappliedAmountBase || 0)),
        };
      }
      return next;
    });
    if (currentStep > 1) {
      setCurrentStep(1);
    }
    invalidatePreview();
  }
  function updateSelectedSourceAmount(sourceLineId, value) {
    const key = String(sourceLineId);
    setSelectedSourcesById((current) => ({
      ...current,
      [key]: {
        ...current[key],
        appliedAmountBaseInput: value,
      },
    }));
    invalidatePreview();
  }
  function toggleTargetRow(row) {
    const key = String(row.sourceStockLinkId);
    setSelectedTargetsById((current) => {
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = { ...row };
      }
      return next;
    });
    setExpandedTargetIds((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : current
    );
    if (allocationMethod === "MANUAL") {
      setManualAllocatedInputs((current) => {
        const next = { ...current };
        if (next[key]) {
          delete next[key];
        } else {
          next[key] = "0";
        }
        return next;
      });
    }
    if (currentStep > 2) {
      setCurrentStep(2);
    }
    invalidatePreview();
  }
  function updateManualAllocation(targetId, value) {
    setManualAllocatedInputs((current) => ({
      ...current,
      [String(targetId)]: value,
    }));
    invalidatePreview();
  }
  function handleResetManualEdits() {
    if (previewTargets.length > 0) {
      const next = {};
      previewTargets.forEach((row) => {
        next[String(row.sourceStockLinkId)] = String(roundAmount(row.allocatedAmountBase || 0));
      });
      setManualAllocatedInputs(next);
    } else {
      setManualAllocatedInputs(deriveLocalManualAllocations(selectedTargets, selectedSourceAmountBase));
    }
    invalidatePreview();
  }
  function handleAllocationMethodChange(value) {
    setAllocationMethod(value);
    if (value === "MANUAL") {
      setManualAllocatedInputs((current) => {
        if (Object.keys(current).length > 0) {
          return current;
        }
        if (previewTargets.length > 0) {
          const next = {};
          previewTargets.forEach((row) => {
            next[String(row.sourceStockLinkId)] = String(roundAmount(row.allocatedAmountBase || 0));
          });
          return next;
        }
        return deriveLocalManualAllocations(selectedTargets, selectedSourceAmountBase);
      });
    }
    invalidatePreview();
  }
  function validateStepOne() {
    if (!canRead) {
      return l("Missing permission: inventory.read", "Eksik yetki: inventory.read");
    }
    if (!toPositiveInt(form.legalEntityId)) {
      return l("Select a legal entity first.", "Once bir tuzel kisilik secin.");
    }
    if (!normalizeText(form.postingDate)) {
      return l("Posting date is required.", "Kayit tarihi zorunludur.");
    }
    if (String(form.ownershipScope || "").toUpperCase() === "OPERATING_UNIT" && !toPositiveInt(form.operatingUnitId)) {
      return l("Select an operating unit for the voucher context.", "Voucher baglami icin bir isletme birimi secin.");
    }
    if (selectedSources.length === 0) {
      return l("Select at least one source AP line.", "En az bir kaynak AP satiri secin.");
    }
    const invalidSource = selectedSources.find(
      (row) => parseAmountInput(row.appliedAmountBaseInput) <= 0
    );
    if (invalidSource) {
      return l(
        "Every selected source line must have a positive applied amount.",
        "Her secili kaynak satirinda pozitif uygulanacak tutar bulunmalidir."
      );
    }
    return "";
  }
  function validateStepTwo() {
    const stepOneError = validateStepOne();
    if (stepOneError) {
      return stepOneError;
    }
    if (selectedTargets.length === 0) {
      return l("Select at least one target receipt.", "En az bir hedef kabul secin.");
    }
    if (hasMixedTargetContexts || hasSelectedTargetOutsideFormContext) {
      return l(
        "Selected targets span multiple ownership contexts. Create separate vouchers per context.",
        "Secili hedefler birden fazla sahiplik baglamina yayiliyor. Her baglam icin ayri voucher olusturun."
      );
    }
    return "";
  }
  function buildPreviewPayload() {
    const stepTwoError = validateStepTwo();
    if (stepTwoError) {
      throw new Error(stepTwoError);
    }
    const payload = {
      legalEntityId: toPositiveInt(form.legalEntityId),
      postingDate: form.postingDate,
      ownershipScope: form.ownershipScope,
      operatingUnitId:
        form.ownershipScope === "OPERATING_UNIT" ? toPositiveInt(form.operatingUnitId) : null,
      allocationMethod,
      sourceLines: selectedSources.map((row) => ({
        sourceCariDocumentLineId: row.sourceCariDocumentLineId,
        appliedAmountBase: parseAmountInput(row.appliedAmountBaseInput),
      })),
      targets: selectedTargets.map((row) => {
        const target = {
          sourceStockLinkId: row.sourceStockLinkId,
        };
        if (allocationMethod === "MANUAL") {
          target.allocatedAmountBase = parseAmountInput(
            manualAllocatedInputs[String(row.sourceStockLinkId)]
          );
        }
        return target;
      }),
    };
    if (allocationMethod === "MANUAL") {
      const manualTotal = roundAmount(
        payload.targets.reduce((sum, row) => sum + Number(row.allocatedAmountBase || 0), 0)
      );
      if (Math.abs(manualTotal - selectedSourceAmountBase) > AMOUNT_TOLERANCE) {
        throw new Error(
          l(
            "Manual target allocations must equal the selected source amount.",
            "Manuel hedef dagitim toplami secili kaynak tutarina esit olmalidir."
          )
        );
      }
    }
    return payload;
  }
  async function handlePreviewRecalculate({ moveToStepFour = false } = {}) {
    setPreviewLoading(true);
    setPreviewError("");
    setSubmitError("");
    try {
      const payload = buildPreviewPayload();
      const response = await previewInventoryLandedCostVoucher(payload);
      setPreviewResult(response || null);
      const firstTargetId = response?.targets?.[0]?.sourceStockLinkId;
      setSelectedPreviewTargetId(firstTargetId ? String(firstTargetId) : "");
      if (moveToStepFour) {
        setCurrentStep(4);
      } else {
        setCurrentStep(3);
      }
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(
        normalizeApiError(
          error,
          l("Preview could not be calculated.", "Onizleme hesaplanamadi.")
        )
      );
      setCurrentStep(3);
    } finally {
      setPreviewLoading(false);
    }
  }
  async function handlePostVoucher() {
    if (!canUpsert) {
      setSubmitError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }
    if (!previewResult) {
      setSubmitError(
        l(
          "Recalculate preview before posting the voucher.",
          "Voucher kaydindan once onizlemeyi yeniden hesaplayin."
        )
      );
      return;
    }
    if (previewHasBlockedContextAmount) {
      setSubmitError(
        l(
          "Posting is blocked because part of the selection falls outside the voucher context.",
          "Secimin bir kismi voucher baglaminin disina dustugu icin kayit bloklandi."
        )
      );
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const payload = {
        ...buildPreviewPayload(),
        note: normalizeText(form.note) || undefined,
      };
      const response = await createInventoryLandedCostVoucher(payload);
      navigate(`/app/stok-maliyet-voucherleri/${response?.voucherId}`);
    } catch (error) {
      setSubmitError(
        normalizeApiError(
          error,
          l("Voucher could not be posted.", "Voucher kaydi yapilamadi.")
        )
      );
    } finally {
      setSubmitting(false);
    }
  }
  function handleStepClick(step) {
    if (step === 1) {
      setCurrentStep(1);
      return;
    }
    if (step === 2) {
      const error = validateStepOne();
      if (error) {
        setSourceError(error);
        setCurrentStep(1);
        return;
      }
      setSourceError("");
      setCurrentStep(2);
      return;
    }
    if (step === 3) {
      const error = validateStepTwo();
      if (error) {
        setTargetError(error);
        setCurrentStep(2);
        return;
      }
      setTargetError("");
      void handlePreviewRecalculate();
      return;
    }
    if (step === 4) {
      const error = validateStepTwo();
      if (error) {
        setTargetError(error);
        setCurrentStep(2);
        return;
      }
      setTargetError("");
      if (!previewResult) {
        void handlePreviewRecalculate({ moveToStepFour: true });
        return;
      }
      setCurrentStep(4);
    }
  }
  const previewCards = previewTargets.map((target) => ({
    ...target,
    baseRow: selectedTargetsById[String(target.sourceStockLinkId)] || null,
  }));
  const totalAllocatedBase = roundAmount(
    previewResult?.targetSummary?.totalAllocatedAmountBase
    || (allocationMethod === "MANUAL" ? manualAllocatedTotalBase : selectedSourceAmountBase)
  );
  const totalCapitalizedBase = roundAmount(
    previewResult?.targetSummary?.totalCapitalizationAmountBase || 0
  );
  const totalConsumedBase = roundAmount(
    previewResult?.targetSummary?.totalExpenseAdjustmentAmountBase || 0
  );
  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4">
        <div className="space-y-2">
          <div className="text-sm text-slate-500">
            <Link className="hover:text-slate-700" to="/app/stok-maliyet-voucherleri">
              {l("Inventory / Landed Cost Vouchers", "Stoklar / Stok Maliyet Voucherleri")}
            </Link>
            <span className="px-2 text-slate-300">/</span>
            <span className="text-slate-700">{l("New", "Yeni")}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {l("New Landed Cost Voucher", "Yeni Stok Maliyet Voucheri")}
          </h1>
          <p className="text-sm text-slate-500">
            {l(
              "Build a separate posted-cost allocation onto already received stock.",
              "Ayrica gelen maliyeti zaten kabul edilmis stoklara dagitin."
            )}
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <StepPill
            index="1"
            label={l("Source AP Lines", "Kaynak AP Satirlari")}
            active={currentStep === 1}
            complete={currentStep > 1}
            onClick={() => handleStepClick(1)}
          />
          <StepPill
            index="2"
            label={l("Target Receipts", "Hedef Kabuller")}
            active={currentStep === 2}
            complete={currentStep > 2}
            onClick={() => handleStepClick(2)}
          />
          <StepPill
            index="3"
            label={l("Allocation Preview", "Dagitim Onizleme")}
            active={currentStep === 3}
            complete={currentStep > 3}
            onClick={() => handleStepClick(3)}
          />
          <StepPill
            index="4"
            label={l("Review & Post", "Gozden Gecir ve Kaydet")}
            active={currentStep === 4}
            complete={false}
            onClick={() => handleStepClick(4)}
          />
        </div>
      </div>
      {!canRead ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l("Missing permission: inventory.read", "Eksik yetki: inventory.read")}
        </div>
      ) : null}
      {dependencyError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {dependencyError}
        </div>
      ) : null}
      {!canUpsert ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l(
            "You can review and preview this workflow, but posting actions require inventory.upsert.",
            "Bu akisi inceleyebilir ve onizleyebilirsiniz; ancak kaydetme islemleri inventory.upsert gerektirir."
          )}
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Legal Entity", "Tuzel kisilik")}
                </span>
                <select
                  value={form.legalEntityId}
                  onChange={(event) => updateForm("legalEntityId", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                >
                  <option value="">{l("Select legal entity", "Tuzel kisilik secin")}</option>
                  {legalEntityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Posting Date", "Kayit tarihi")}
                </span>
                <input
                  type="date"
                  value={form.postingDate}
                  onChange={(event) => updateForm("postingDate", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Ownership Context", "Sahiplik baglami")}
                </span>
                <select
                  value={form.ownershipScope}
                  onChange={(event) => updateForm("ownershipScope", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                >
                  <option value="CENTRAL">{l("Central", "Merkez")}</option>
                  <option value="OPERATING_UNIT">{l("Operating Unit", "Isletme birimi")}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Operating Unit", "Isletme birimi")}
                </span>
                <select
                  value={form.operatingUnitId}
                  disabled={form.ownershipScope !== "OPERATING_UNIT"}
                  onChange={(event) => updateForm("operatingUnitId", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">{l("Select operating unit", "Isletme birimi secin")}</option>
                  {operatingUnits.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code && row.name ? `${row.code} - ${row.name}` : row.code || row.name || `#${row.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block md:col-span-2 xl:col-span-1">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Note", "Not")}
                </span>
                <textarea
                  rows={1}
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder={l("Optional posting note", "Opsiyonel kayit notu")}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>
            </div>
          </section>
          {currentStep === 1 ? (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Eligible Posted AP Source Lines", "Uygun Kaydedilmis AP Kaynak Satirlari")}
                </h2>
                <p className="text-sm text-slate-500">
                  {l(
                    "Pick the posted AP bill lines that will be reclassified into landed cost.",
                    "Stok maliyetine yeniden siniflandirilacak kaydedilmis AP fatura satirlarini secin."
                  )}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Vendor", "Tedarikci")}
                  </span>
                  <input
                    value={sourceFilters.vendor}
                    onChange={(event) => updateSourceFilter("vendor", event.target.value)}
                    placeholder={l("Vendor name or code", "Tedarikci adi veya kodu")}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Bill Date From", "Fatura tarihi baslangic")}
                  </span>
                  <input
                    type="date"
                    value={sourceFilters.postingDateFrom}
                    onChange={(event) => updateSourceFilter("postingDateFrom", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Bill Date To", "Fatura tarihi bitis")}
                  </span>
                  <input
                    type="date"
                    value={sourceFilters.postingDateTo}
                    onChange={(event) => updateSourceFilter("postingDateTo", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Currency", "Para birimi")}
                  </span>
                  <input
                    value={sourceFilters.currencyCode}
                    onChange={(event) => updateSourceFilter("currencyCode", event.target.value.toUpperCase())}
                    placeholder="USD"
                    maxLength={3}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Search", "Arama")}
                  </span>
                  <input
                    value={sourceFilters.search}
                    onChange={(event) => updateSourceFilter("search", event.target.value)}
                    placeholder={l("Bill no, vendor, line description", "Fatura no, tedarikci, satir aciklamasi")}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sourceFilters.onlyRemainingUnapplied}
                  onChange={(event) => updateSourceFilter("onlyRemainingUnapplied", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span>{l("Show only lines with remaining unapplied amount", "Yalniz kalan uygulanabilir tutari olan satirlari goster")}</span>
              </label>
              {sourceError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {sourceError}
                </div>
              ) : null}
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{l("Pick", "Sec")}</th>
                        <th className="px-4 py-3">{l("Bill No", "Fatura no")}</th>
                        <th className="px-4 py-3">{l("Vendor", "Tedarikci")}</th>
                        <th className="px-4 py-3">{l("Bill Date", "Fatura tarihi")}</th>
                        <th className="px-4 py-3">{l("Currency", "PB")}</th>
                        <th className="px-4 py-3">{l("Description", "Aciklama")}</th>
                        <th className="px-4 py-3 text-right">{l("Remaining", "Kalan")}</th>
                        <th className="px-4 py-3 text-right">{l("Apply", "Uygula")}</th>
                        <th className="px-4 py-3">{l("Reason", "Neden")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sourceLoading ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("Loading source lines...", "Kaynak satirlari yukleniyor...")}
                          </td>
                        </tr>
                      ) : sourceRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("No source lines matched the current filters.", "Mevcut filtrelerle eslesen kaynak satir bulunmadi.")}
                          </td>
                        </tr>
                      ) : (
                        sourceRows.map((row) => {
                          const selected = Boolean(selectedSourcesById[String(row.sourceCariDocumentLineId)]);
                          const selectedRow = selectedSourcesById[String(row.sourceCariDocumentLineId)];
                          const disabled = !row.eligible;
                          return (
                            <tr key={row.sourceCariDocumentLineId} className={disabled ? "bg-slate-50/50" : "hover:bg-slate-50"}>
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={disabled}
                                  onChange={() => toggleSourceRow(row)}
                                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="px-4 py-3 text-slate-700">{row.billNo || "-"}</td>
                              <td className="px-4 py-3 text-slate-700">{row.vendorName || row.vendorCode || "-"}</td>
                              <td className="px-4 py-3 text-slate-700">{row.documentDate || "-"}</td>
                              <td className="px-4 py-3 text-slate-700">{row.currencyCode || "-"}</td>
                              <td className="px-4 py-3 text-slate-700">{row.lineDescription || "-"}</td>
                              <td className="px-4 py-3 text-right text-slate-900">
                                <MoneyText amount={row.remainingUnappliedAmountBase} showCurrency={false} />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  disabled={!selected}
                                  value={selected ? selectedRow?.appliedAmountBaseInput ?? "" : ""}
                                  onChange={(event) =>
                                    updateSelectedSourceAmount(row.sourceCariDocumentLineId, event.target.value)
                                  }
                                  className="w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-sm text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                />
                              </td>
                              <td className="px-4 py-3">
                                {disabled ? (
                                  <Badge tone="amber">
                                    {getSourceDisabledReasonLabel(row.disabledReasonCode, l)}
                                  </Badge>
                                ) : (
                                  <Badge tone="emerald">{l("Eligible", "Uygun")}</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => handleStepClick(2)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  {l("Continue to Target Receipts", "Hedef kabullere devam et")}
                </button>
              </div>
            </section>
          ) : null}
          {currentStep === 2 ? (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Target Receipts", "Hedef Kabuller")}
                </h2>
                <p className="text-sm text-slate-500">
                  {l(
                    "Choose the posted receipt anchors that should receive the landed-cost allocation.",
                    "Stok maliyet dagitimini alacak kaydedilmis kabul kayitlarini secin."
                  )}
                </p>
              </div>
              {hasMixedTargetContexts || hasSelectedTargetOutsideFormContext ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {l(
                    "Selected targets span multiple ownership contexts. Create separate vouchers per context.",
                    "Secili hedefler birden fazla sahiplik baglamina yayiliyor. Her baglam icin ayri voucher olusturun."
                  )}
                </div>
              ) : null}
              {targetError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {targetError}
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Receipt Date From", "Kabul tarihi baslangic")}
                  </span>
                  <input
                    type="date"
                    value={targetFilters.receiptDateFrom}
                    onChange={(event) => updateTargetFilter("receiptDateFrom", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Receipt Date To", "Kabul tarihi bitis")}
                  </span>
                  <input
                    type="date"
                    value={targetFilters.receiptDateTo}
                    onChange={(event) => updateTargetFilter("receiptDateTo", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Item", "Stok")}
                  </span>
                  <select
                    value={targetFilters.itemCardId}
                    disabled={!canReadItemCards}
                    onChange={(event) => updateTargetFilter("itemCardId", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">{l("All items", "Tum stoklar")}</option>
                    {itemCardRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.code && row.name ? `${row.code} - ${row.name}` : row.code || row.name || `#${row.id}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Warehouse", "Depo")}
                  </span>
                  <select
                    value={targetFilters.warehouseId}
                    onChange={(event) => updateTargetFilter("warehouseId", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  >
                    <option value="">{l("All warehouses", "Tum depolar")}</option>
                    {warehouseRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.code && row.name ? `${row.code} - ${row.name}` : row.code || row.name || `#${row.id}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {l("Receipt Ref Search", "Kabul ref arama")}
                  </span>
                  <input
                    value={targetFilters.search}
                    onChange={(event) => updateTargetFilter("search", event.target.value)}
                    placeholder={l("Receipt, item, warehouse", "Kabul, stok, depo")}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="inline-flex items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={targetFilters.sameLegalEntityOnly}
                    disabled
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <span>
                    {l(
                      "Show only receipts with same legal entity",
                      "Yalniz ayni tuzel kisilige ait kabulleri goster"
                    )}
                  </span>
                </label>
                <label className="inline-flex items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={targetFilters.matchSelectedContextOnly}
                    onChange={(event) =>
                      updateTargetFilter("matchSelectedContextOnly", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <span>
                    {l(
                      "Show only receipts matching selected context",
                      "Yalniz secili baglama uyan kabulleri goster"
                    )}
                  </span>
                </label>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{l("Pick", "Sec")}</th>
                        <th className="px-4 py-3">{l("Receipt Ref", "Kabul ref")}</th>
                        <th className="px-4 py-3">{l("Item", "Stok")}</th>
                        <th className="px-4 py-3">{l("Warehouse", "Depo")}</th>
                        <th className="px-4 py-3 text-right">{l("Qty Received", "Alinan mik.")}</th>
                        <th className="px-4 py-3 text-right">{l("On Hand", "Elde kalan")}</th>
                        <th className="px-4 py-3 text-right">{l("Consumed", "Tuketilen")}</th>
                        <th className="px-4 py-3">{l("Context", "Baglam")}</th>
                        <th className="px-4 py-3">{l("Notes", "Notlar")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {targetLoading ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("Loading target receipts...", "Hedef kabuller yukleniyor...")}
                          </td>
                        </tr>
                      ) : targetRows.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("No posted receipts matched the current filters.", "Mevcut filtrelerle eslesen kayitli kabul bulunmadi.")}
                          </td>
                        </tr>
                      ) : (
                        targetRows.map((row) => {
                          const selected = Boolean(selectedTargetsById[String(row.sourceStockLinkId)]);
                          return (
                            <tr key={row.sourceStockLinkId} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleTargetRow(row)}
                                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                                />
                              </td>
                              <td className="px-4 py-3 text-slate-700">{row.receiptRef || "-"}</td>
                              <td className="px-4 py-3 text-slate-700">
                                {row.itemCode && row.itemName ? `${row.itemCode} - ${row.itemName}` : row.itemCode || row.itemName || "-"}
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                {row.warehouseCode && row.warehouseName
                                  ? `${row.warehouseCode} - ${row.warehouseName}`
                                  : row.warehouseCode || row.warehouseName || "-"}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {roundAmount(row.qtyReceived || 0)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-900">
                                {roundAmount(row.currentOnHandQuantity || 0)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-500">
                                {roundAmount(row.currentConsumedQuantity || 0)}
                              </td>
                              <td className="px-4 py-3 text-slate-700">{getOwnershipLabel(row, l)}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  {(row.blockedReasonCodes || []).map((code) => (
                                    <Badge key={code} tone="amber">
                                      {getBlockedReasonLabel(code, l)}
                                    </Badge>
                                  ))}
                                  {(row.blockedReasonCodes || []).length === 0 ? (
                                    <span className="text-xs text-slate-500">
                                      {l("No additional context blocker", "Ek baglam blokaji yok")}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                  {l("Back to Sources", "Kaynaklara don")}
                </button>
                <button
                  type="button"
                  onClick={() => handleStepClick(3)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  {l("Continue to Preview", "Onizlemeye devam et")}
                </button>
              </div>
            </section>
          ) : null}
          {currentStep === 3 ? (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {l("Allocation Preview", "Dagitim Onizleme")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {l(
                      "Preview splits landed cost into on-hand capitalization and consumed adjustment.",
                      "Onizleme stok maliyetini elde kalan aktifleştirme ve tuketilen duzeltmesine ayirir."
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      {l("Allocation Method", "Dagitim yontemi")}
                    </span>
                    <select
                      value={allocationMethod}
                      onChange={(event) => handleAllocationMethodChange(event.target.value)}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                    >
                      <option value="EQUAL">{l("Equal", "Esit")}</option>
                      <option value="BY_AMOUNT">{l("By Amount", "Tutara gore")}</option>
                      <option value="BY_QTY">{l("By Quantity", "Miktara gore")}</option>
                      <option value="MANUAL">{l("Manual", "Manuel")}</option>
                    </select>
                  </label>
                  {allocationMethod === "MANUAL" ? (
                    <button
                      type="button"
                      onClick={handleResetManualEdits}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                    >
                      {l("Reset Manual Edits", "Manuel duzenlemeleri sifirla")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handlePreviewRecalculate()}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    {previewLoading
                      ? l("Recalculating...", "Yeniden hesaplanıyor...")
                      : l("Recalculate Preview", "Onizlemeyi yeniden hesapla")}
                  </button>
                </div>
              </div>
              {previewHasTransferDescendant ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                  {l(
                    "Transfer-aware descendant layers were resolved in this preview. Expand a target row to inspect the descendant layer split.",
                    "Bu onizlemede transfer farkindalikli inen katmanlar cozuldu. Inen katman dagitimini incelemek icin hedef satirini genisletin."
                  )}
                </div>
              ) : null}
              {previewHasBlockedContextAmount ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {l(
                    "Part of the selected receipt economics falls outside the voucher context, so posting remains blocked.",
                    "Secilen kabul ekonomisinin bir kismi voucher baglaminin disina dustugu icin kayit bloklu kalir."
                  )}
                </div>
              ) : null}
              {previewError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {previewError}
                </div>
              ) : null}
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{l("Expand", "Ac")}</th>
                        <th className="px-4 py-3">{l("Receipt Ref", "Kabul ref")}</th>
                        <th className="px-4 py-3">{l("Item", "Stok")}</th>
                        <th className="px-4 py-3 text-right">{l("Qty Basis", "Miktar baz")}</th>
                        <th className="px-4 py-3 text-right">{l("Original Value", "Ilk deger")}</th>
                        <th className="px-4 py-3 text-right">{l("Allocated", "Dagitilan")}</th>
                        <th className="px-4 py-3 text-right">{l("On Hand", "Elde kalan")}</th>
                        <th className="px-4 py-3 text-right">{l("Consumed", "Tuketilen")}</th>
                        <th className="px-4 py-3">{l("Context", "Baglam")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewLoading ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("Calculating preview...", "Onizleme hesaplanıyor...")}
                          </td>
                        </tr>
                      ) : previewCards.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            {l("Run preview to inspect target allocations.", "Hedef dagitimlarini incelemek icin onizleme calistirin.")}
                          </td>
                        </tr>
                      ) : (
                        previewCards.map((row) => {
                          const expanded = expandedTargetIds.includes(String(row.sourceStockLinkId));
                          return (
                            <>
                              <tr
                                key={row.sourceStockLinkId}
                                className="cursor-pointer hover:bg-slate-50"
                                onClick={() => setSelectedPreviewTargetId(String(row.sourceStockLinkId))}
                              >
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setExpandedTargetIds((current) =>
                                        current.includes(String(row.sourceStockLinkId))
                                          ? current.filter((value) => value !== String(row.sourceStockLinkId))
                                          : [...current, String(row.sourceStockLinkId)]
                                      );
                                      setSelectedPreviewTargetId(String(row.sourceStockLinkId));
                                    }}
                                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"
                                  >
                                    {expanded ? l("Hide", "Gizle") : l("Show", "Goster")}
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{row.documentNo || row.baseRow?.receiptRef || "-"}</td>
                                <td className="px-4 py-3 text-slate-700">
                                  {row.itemCardCode && row.itemCardName
                                    ? `${row.itemCardCode} - ${row.itemCardName}`
                                    : row.itemCardCode || row.itemCardName || "-"}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-700">{roundAmount(row.quantityBasis || 0)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">
                                  <MoneyText amount={row.baseRow?.originalReceiptValueBase || 0} showCurrency={false} />
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {allocationMethod === "MANUAL" ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.000001"
                                      value={manualAllocatedInputs[String(row.sourceStockLinkId)] ?? String(roundAmount(row.allocatedAmountBase || 0))}
                                      onChange={(event) =>
                                        updateManualAllocation(row.sourceStockLinkId, event.target.value)
                                      }
                                      className="w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                  ) : (
                                    <MoneyText amount={row.allocatedAmountBase} showCurrency={false} />
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-900">
                                  <MoneyText amount={row.onHandAllocatedAmountBase} showCurrency={false} />
                                </td>
                                <td className="px-4 py-3 text-right text-slate-500">
                                  <MoneyText amount={row.consumedAllocatedAmountBase} showCurrency={false} />
                                </td>
                                <td className="px-4 py-3 text-slate-700">{getOwnershipLabel(row.baseRow || row, l)}</td>
                              </tr>
                              {expanded ? (
                                <tr key={`details-${row.sourceStockLinkId}`} className="bg-slate-50/70">
                                  <td colSpan={9} className="px-4 py-4">
                                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                                        <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
                                          <tr>
                                            <th className="px-3 py-2">{l("Resolved Movement Ref", "Cozumlenen hareket ref")}</th>
                                            <th className="px-3 py-2">{l("Resolved Cost Layer Ref", "Cozumlenen maliyet katmani ref")}</th>
                                            <th className="px-3 py-2">{l("Descendant Path", "Inen yol")}</th>
                                            <th className="px-3 py-2">{l("Role", "Rol")}</th>
                                            <th className="px-3 py-2 text-right">{l("Qty Snapshot", "Miktar anlik")}</th>
                                            <th className="px-3 py-2 text-right">{l("Allocated Amount", "Dagitilan tutar")}</th>
                                            <th className="px-3 py-2">{l("Notes", "Notlar")}</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {(row.descendantLayerAllocations || []).map((allocation) => (
                                            <tr key={`${row.sourceStockLinkId}-${allocation.resolvedCostLayerId}-${allocation.allocationRole}`}>
                                              <td className="px-3 py-2 text-slate-700">{`MV #${allocation.resolvedInventoryMovementId || "-"}`}</td>
                                              <td className="px-3 py-2 text-slate-700">{`CL #${allocation.resolvedCostLayerId || "-"}`}</td>
                                              <td className="px-3 py-2 text-slate-700">
                                                {toPositiveInt(allocation.resolvedInventoryMovementId)
                                                  === toPositiveInt(row.sourceAnchorInventoryMovementId)
                                                  ? l("Anchor receipt layer", "Kaynak kabul katmani")
                                                  : l("Transfer-aware descendant receipt layer", "Transfer farkindalikli inen kabul katmani")}
                                              </td>
                                              <td className="px-3 py-2 text-slate-700">
                                                {allocation.allocationRole === "ON_HAND"
                                                  ? l("On Hand", "Elde kalan")
                                                  : l("Consumed", "Tuketilen")}
                                              </td>
                                              <td className="px-3 py-2 text-right text-slate-700">{roundAmount(allocation.quantitySnapshot || 0)}</td>
                                              <td className="px-3 py-2 text-right text-slate-900">
                                                <MoneyText amount={allocation.allocatedAmountBase} showCurrency={false} />
                                              </td>
                                              <td className="px-3 py-2 text-slate-500">
                                                {allocation.warehouseCode || allocation.warehouseName
                                                  ? `${allocation.warehouseCode || ""}${allocation.warehouseCode && allocation.warehouseName ? " - " : ""}${allocation.warehouseName || ""}`
                                                  : l("Resolved through current inventory state", "Guncel stok durumundan cozuldu")}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                    {l("Resolved Layer Allocation Detail", "Cozumlenen Katman Dagitim Detayi")}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {previewSelectedTarget?.documentNo || previewSelectedTarget?.baseRow?.receiptRef || "-"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{l("Source Anchor Receipt", "Kaynak kabul")}</th>
                        <th className="px-3 py-2">{l("Resolved Receipt / Movement", "Cozumlenen kabul / hareket")}</th>
                        <th className="px-3 py-2">{l("Cost Layer", "Maliyet katmani")}</th>
                        <th className="px-3 py-2">{l("Role", "Rol")}</th>
                        <th className="px-3 py-2 text-right">{l("Qty Snapshot", "Miktar anlik")}</th>
                        <th className="px-3 py-2 text-right">{l("Allocated Amount", "Dagitilan tutar")}</th>
                        <th className="px-3 py-2 text-right">{l("Remaining Adjusted Qty", "Kalan duzeltilmis mik.")}</th>
                        <th className="px-3 py-2 text-right">{l("Remaining Adjusted Amount", "Kalan duzeltilmis tutar")}</th>
                        <th className="px-3 py-2">{l("Open Status", "Acik durum")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewSelectedTarget ? (
                        (previewSelectedTarget.descendantLayerAllocations || []).map((allocation) => {
                          const isOnHand = String(allocation.allocationRole || "").toUpperCase() === "ON_HAND";
                          const remainingAdjustedQuantity = isOnHand ? roundAmount(allocation.quantitySnapshot || 0) : 0;
                          const remainingAdjustedAmountBase = isOnHand
                            ? roundAmount(allocation.allocatedAmountBase || 0)
                            : 0;
                          return (
                            <tr key={`${previewSelectedTarget.sourceStockLinkId}-${allocation.resolvedCostLayerId}-${allocation.allocationRole}`}>
                              <td className="px-3 py-2 text-slate-700">
                                {(previewSelectedTarget.documentNo || previewSelectedTarget.baseRow?.receiptRef || "-")
                                  + ` / MV #${previewSelectedTarget.sourceAnchorInventoryMovementId || "-"}`}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{`MV #${allocation.resolvedInventoryMovementId || "-"}`}</td>
                              <td className="px-3 py-2 text-slate-700">{`CL #${allocation.resolvedCostLayerId || "-"}`}</td>
                              <td className="px-3 py-2 text-slate-700">
                                {isOnHand ? l("On Hand", "Elde kalan") : l("Consumed", "Tuketilen")}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">
                                {roundAmount(allocation.quantitySnapshot || 0)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-900">
                                <MoneyText amount={allocation.allocatedAmountBase} showCurrency={false} />
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">{remainingAdjustedQuantity}</td>
                              <td className="px-3 py-2 text-right text-slate-900">
                                <MoneyText amount={remainingAdjustedAmountBase} showCurrency={false} />
                              </td>
                              <td className="px-3 py-2">
                                <Badge tone={isOnHand ? "emerald" : "slate"}>
                                  {isOnHand ? l("Open", "Acik") : l("Closed", "Kapali")}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                            {l("Select a target row or run preview to inspect layer detail.", "Katman detayini incelemek icin bir hedef satiri secin veya onizleme calistirin.")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                  {l("Back to Targets", "Hedeflere don")}
                </button>
                <button
                  type="button"
                  onClick={() => handleStepClick(4)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  {l("Review & Post", "Gozden Gecir ve Kaydet")}
                </button>
              </div>
            </section>
          ) : null}
          {currentStep === 4 ? (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {l("Review & Post", "Gozden Gecir ve Kaydet")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "Review the context, source summary, target allocation, and journal impact before posting.",
                      "Kaydetmeden once baglam, kaynak ozeti, hedef dagitimi ve yevmiye etkisini gozden gecirin."
                    )}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <SummaryBlock label={l("Header Summary", "Baslik Ozeti")}>
                  <div className="space-y-1">
                    <div>{legalEntityOptions.find((option) => option.value === String(form.legalEntityId))?.label || "-"}</div>
                    <div>{form.postingDate || "-"}</div>
                    <div>{getOwnershipLabel(form, l)}</div>
                    <div className="text-slate-500">{normalizeText(form.note) || l("No note", "Not yok")}</div>
                  </div>
                </SummaryBlock>
                <SummaryBlock label={l("Source Summary", "Kaynak Ozeti")}>
                  <div className="space-y-1">
                    <div>{l("Selected lines", "Secili satirlar")}: {selectedSources.length}</div>
                    <div>
                      {l("Applied amount", "Uygulanan tutar")}:{" "}
                      <MoneyText amount={selectedSourceAmountBase} showCurrency={false} />
                    </div>
                  </div>
                </SummaryBlock>
                <SummaryBlock label={l("Target Summary", "Hedef Ozeti")}>
                  <div className="space-y-1">
                    <div>{l("Selected targets", "Secili hedefler")}: {selectedTargets.length}</div>
                    <div>
                      {l("Allocated", "Dagitilan")}: <MoneyText amount={totalAllocatedBase} showCurrency={false} />
                    </div>
                    <div>
                      {l("Capitalized", "Aktiflesen")}: <MoneyText amount={totalCapitalizedBase} showCurrency={false} />
                    </div>
                    <div>
                      {l("Consumed adjustment", "Tuketilen duzeltmesi")}:{" "}
                      <MoneyText amount={totalConsumedBase} showCurrency={false} />
                    </div>
                  </div>
                </SummaryBlock>
                <SummaryBlock label={l("Journal Impact Preview", "Yevmiye Etki Onizlemesi")}>
                  <div className="space-y-2">
                    <div>
                      {l("Net debit / credit", "Net borc / alacak")}:{" "}
                      <MoneyText amount={selectedSourceAmountBase} showCurrency={false} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setJournalPreviewOpen((current) => !current)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400"
                    >
                      {journalPreviewOpen ? l("Hide Journal Summary", "Yevmiye ozetini gizle") : l("Open Journal Summary", "Yevmiye ozetini ac")}
                    </button>
                    {journalPreviewOpen ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div>
                          {l("Debit inventory", "Borc stok varligi")}:{" "}
                          <MoneyText amount={totalCapitalizedBase} showCurrency={false} />
                        </div>
                        <div>
                          {l("Debit consumed adjustment", "Borc tuketilen duzeltmesi")}:{" "}
                          <MoneyText amount={totalConsumedBase} showCurrency={false} />
                        </div>
                        <div>
                          {l("Credit AP source reclass", "Alacak AP kaynak yeniden siniflandirma")}:{" "}
                          <MoneyText amount={selectedSourceAmountBase} showCurrency={false} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SummaryBlock>
              </div>
              {stickyWarnings.length > 0 || submitError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="font-semibold">{l("Warnings / Blockers", "Uyarilar / Blokajlar")}</div>
                  <ul className="mt-2 list-disc pl-5">
                    {stickyWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                    {submitError ? <li>{submitError}</li> : null}
                  </ul>
                </div>
              ) : null}
              <div className="sticky bottom-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-slate-500">
                    {l(
                      "Save Draft stays visible for the workflow, but draft persistence is not available in this frontend step.",
                      "Akis icin Taslak Kaydet gorunur; ancak bu frontend adiminda taslak kaliciligi mevcut degildir."
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled
                      title={l("Draft save is not available in this step.", "Taslak kaydetme bu adimda mevcut degildir.")}
                      className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400"
                    >
                      {l("Save Draft", "Taslak Kaydet")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                    >
                      {l("Back to Preview", "Onizlemeye don")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePostVoucher()}
                      disabled={!canUpsert || submitting || previewHasBlockedContextAmount || !previewResult}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                        canUpsert && !submitting && !previewHasBlockedContextAmount && previewResult
                          ? "bg-slate-900 text-white hover:bg-slate-700"
                          : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                      }`}
                    >
                      {submitting
                        ? l("Posting Voucher...", "Voucher kaydediliyor...")
                        : l("Post Voucher", "Voucher Kaydet")}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {l("Sticky Summary", "Sabit Ozet")}
              </h2>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {l("Legal Entity", "Tuzel kisilik")}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {legalEntityOptions.find((option) => option.value === String(form.legalEntityId))?.label || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {l("Context", "Baglam")}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{getOwnershipLabel(form, l)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {l("Operating Unit", "Isletme birimi")}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {String(form.ownershipScope || "").toUpperCase() === "OPERATING_UNIT"
                      ? getOwnershipLabel(form, l)
                      : l("Not applicable", "Uygulanmaz")}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <SummaryBlock label={l("Source Lines", "Kaynak Satirlari")} value={selectedSources.length} />
                  <SummaryBlock label={l("Source Amount", "Kaynak Tutari")}>
                    <MoneyText amount={selectedSourceAmountBase} showCurrency={false} />
                  </SummaryBlock>
                  <SummaryBlock label={l("Target Count", "Hedef Sayisi")} value={selectedTargets.length} />
                  <SummaryBlock label={l("Total Allocated", "Toplam Dagitilan")}>
                    <MoneyText amount={totalAllocatedBase} showCurrency={false} />
                  </SummaryBlock>
                  <SummaryBlock label={l("Capitalized", "Aktiflesen")}>
                    <MoneyText amount={totalCapitalizedBase} showCurrency={false} />
                  </SummaryBlock>
                  <SummaryBlock label={l("Consumed Adjustment", "Tuketilen Duzeltmesi")}>
                    <MoneyText amount={totalConsumedBase} showCurrency={false} />
                  </SummaryBlock>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {l("Warnings / Blockers", "Uyarilar / Blokajlar")}
              </h2>
              <div className="mt-4 space-y-2">
                {stickyWarnings.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    {l("No active warning.", "Aktif uyari yok.")}
                  </div>
                ) : (
                  stickyWarnings.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      {warning}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
