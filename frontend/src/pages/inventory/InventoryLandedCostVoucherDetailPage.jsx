
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import {
  getInventoryLandedCostVoucher,
  reverseInventoryLandedCostVoucher,
} from "../../api/inventory.js";
import { resolveSourceLinkDestination } from "../../utils/journalSourceLinkDestinations.js";

const EMPTY_ROWS = Object.freeze([]);

function normalizeText(value) {
  return String(value || "").trim();
}
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}
function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "REVERSED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    case "REVERSAL_BLOCKED":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "DRAFT":
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}
function getStatusLabel(value, l) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return l("Posted", "Kaydedildi");
    case "REVERSED":
      return l("Reversed", "Ters kaydedildi");
    case "REVERSAL_BLOCKED":
      return l("Reversal Blocked", "Ters kayit bloklu");
    case "DRAFT":
    default:
      return l("Draft", "Taslak");
  }
}
function getOwnershipLabel(row, l) {
  const scope = String(row?.ownershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.operatingUnitCode);
    const name = normalizeText(row?.operatingUnitName);
    return code && name
      ? `${code} - ${name}`
      : code || name || `${l("Operating unit", "Isletme birimi")} #${row?.operatingUnitId || "-"}`;
  }
  return l("Central", "Merkez");
}
function getAllocationRoleLabel(value, l) {
  return String(value || "").trim().toUpperCase() === "CONSUMED"
    ? l("Consumed", "Tuketilen")
    : l("On hand", "Eldeki");
}
function getOpenStatusLabel(value, l) {
  return String(value || "").trim().toUpperCase() === "OPEN"
    ? l("Open", "Acik")
    : l("Closed", "Kapali");
}
function getConsumptionStatusLabel(value, l) {
  switch (String(value || "").trim().toUpperCase()) {
    case "RESTORED":
      return l("Restored", "Geri yuklendi");
    case "CARRY_FORWARDED":
      return l("Carry-forwarded", "Devredildi");
    case "ACTIVE":
    default:
      return l("Active", "Aktif");
  }
}
function getDependencyTypeLabel(value, l) {
  return String(value || "").trim().toUpperCase() === "TRANSFER"
    ? l("Transfer", "Transfer")
    : l("Issue", "Cikis");
}
function buildJournalRoute(journalEntryId) {
  const normalized = toPositiveInt(journalEntryId);
  return normalized ? `/app/mahsup-islemleri?journalId=${normalized}` : null;
}
function buildCariDocumentRoute(documentId) {
  const normalized = toPositiveInt(documentId);
  return normalized ? `/app/cari-belgeler?documentId=${normalized}` : null;
}
function buildMovementRoute(legalEntityId, movementId) {
  const normalizedMovementId = toPositiveInt(movementId);
  if (!normalizedMovementId) {
    return null;
  }
  const params = new URLSearchParams();
  const normalizedLegalEntityId = toPositiveInt(legalEntityId);
  if (normalizedLegalEntityId) {
    params.set("legalEntityId", String(normalizedLegalEntityId));
  }
  params.set("movementId", String(normalizedMovementId));
  return `/app/stok-yansitma-islemleri?${params.toString()}`;
}
function SummaryStat({ label, value, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value ?? children ?? "-"}</div>
    </div>
  );
}
function SectionCard({ title, subtitle, children, actions = null }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}
function EmptyState({ message }) {
  return <div className="p-5 text-sm text-slate-500">{message}</div>;
}
export default function InventoryLandedCostVoucherDetailPage() {
  const { voucherId } = useParams();
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const canRead = hasPermission("inventory.read");
  const canLandedCostUpsert = hasPermission("inventory.landed_cost.upsert");
  const canReadJournal = hasPermission("gl.journal.read");
  const canReadCari = hasPermission("cari.doc.read");
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [voucher, setVoucher] = useState(null);
  const [activeTab, setActiveTab] = useState("SUMMARY");
  const [selectedLayerAllocationId, setSelectedLayerAllocationId] = useState(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseForm, setReverseForm] = useState({
    reversalDate: todayDateOnly(),
    reverseReason: "",
  });
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const normalizedVoucherId = useMemo(() => toPositiveInt(voucherId), [voucherId]);
  const uiStatus = normalizeText(voucher?.uiStatus || voucher?.status || "DRAFT");
  const sourceRows = useMemo(
    () => (Array.isArray(voucher?.sources) ? voucher.sources : EMPTY_ROWS),
    [voucher?.sources]
  );
  const targetRows = useMemo(
    () => (Array.isArray(voucher?.targets) ? voucher.targets : EMPTY_ROWS),
    [voucher?.targets]
  );
  const layerAllocationRows = useMemo(
    () => (Array.isArray(voucher?.layerAllocations) ? voucher.layerAllocations : EMPTY_ROWS),
    [voucher?.layerAllocations]
  );
  const consumptionRows = useMemo(
    () => (
      Array.isArray(voucher?.landedCostConsumptions)
        ? voucher.landedCostConsumptions
        : EMPTY_ROWS
    ),
    [voucher?.landedCostConsumptions]
  );
  const reversalDependencies = useMemo(
    () => (
      Array.isArray(voucher?.reversalDependencies)
        ? voucher.reversalDependencies
        : EMPTY_ROWS
    ),
    [voucher?.reversalDependencies]
  );
  const postedJournal = voucher?.journalAudit?.postedJournal || null;
  const reversalJournal = voucher?.journalAudit?.reversalJournal || null;
  const canOpenReverseDrawer =
    canLandedCostUpsert && String(voucher?.status || "").toUpperCase() === "POSTED";
  const canSubmitReverse =
    canOpenReverseDrawer && !voucher?.hasReversalDependencies;
  const openJournalRoute = buildJournalRoute(voucher?.postedJournalEntryId);
  const journalSourceLinks = useMemo(
    () => (Array.isArray(postedJournal?.sourceLinks) ? postedJournal.sourceLinks : EMPTY_ROWS),
    [postedJournal?.sourceLinks]
  );
  const journalReverseBlock = postedJournal?.reverseBlock || null;
  const consumptionsByAllocationId = useMemo(() => {
    const map = new Map();
    for (const row of consumptionRows) {
      const allocationId = toPositiveInt(row?.voucherLayerAllocationId);
      if (!allocationId) {
        continue;
      }
      const bucket = map.get(allocationId) || [];
      bucket.push(row);
      map.set(allocationId, bucket);
    }
    return map;
  }, [consumptionRows]);
  const selectedLayerAllocation = useMemo(() => {
    return (
      layerAllocationRows.find(
        (row) => toPositiveInt(row?.voucherLayerAllocationId) === selectedLayerAllocationId
      ) || null
    );
  }, [layerAllocationRows, selectedLayerAllocationId]);
  const selectedLayerConsumptions = useMemo(() => {
    return consumptionsByAllocationId.get(selectedLayerAllocationId) || [];
  }, [consumptionsByAllocationId, selectedLayerAllocationId]);
  useEffect(() => {
    let active = true;
    async function loadVoucher() {
      if (!canRead) {
        setPageError(l("Missing permission: inventory.read", "Eksik yetki: inventory.read"));
        setVoucher(null);
        return;
      }
      if (!normalizedVoucherId) {
        setPageError(l("Voucher id is invalid.", "Voucher kimligi gecersiz."));
        setVoucher(null);
        return;
      }
      setLoading(true);
      setPageError("");
      try {
        const response = await getInventoryLandedCostVoucher(normalizedVoucherId);
        if (!active) {
          return;
        }
        setVoucher(response || null);
      } catch (error) {
        if (!active) {
          return;
        }
        setPageError(
          normalizeApiError(
            error,
            l(
              "Failed to load landed-cost voucher detail.",
              "Stok maliyet voucher detayi yuklenemedi."
            )
          )
        );
        setVoucher(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void loadVoucher();
    return () => {
      active = false;
    };
  }, [canRead, l, normalizedVoucherId]);
  useEffect(() => {
    const validIds = new Set(
      layerAllocationRows
        .map((row) => toPositiveInt(row?.voucherLayerAllocationId))
        .filter(Boolean)
    );
    if (validIds.size === 0) {
      setSelectedLayerAllocationId(null);
      return;
    }
    if (selectedLayerAllocationId && validIds.has(selectedLayerAllocationId)) {
      return;
    }
    setSelectedLayerAllocationId(
      toPositiveInt(layerAllocationRows[0]?.voucherLayerAllocationId)
    );
  }, [layerAllocationRows, selectedLayerAllocationId]);
  async function reloadVoucher() {
    if (!canRead || !normalizedVoucherId) {
      return;
    }
    const response = await getInventoryLandedCostVoucher(normalizedVoucherId);
    setVoucher(response || null);
  }
  async function handleReverseConfirm() {
    if (!canLandedCostUpsert) {
      setReverseError(
        l(
          "Missing permission: inventory.landed_cost.upsert",
          "Eksik yetki: inventory.landed_cost.upsert"
        )
      );
      return;
    }
    if (!canSubmitReverse) {
      return;
    }
    setReverseSubmitting(true);
    setReverseError("");
    try {
      await reverseInventoryLandedCostVoucher(normalizedVoucherId, reverseForm);
      setReverseOpen(false);
      await reloadVoucher();
    } catch (error) {
      setReverseError(
        normalizeApiError(
          error,
          l("Failed to reverse voucher.", "Voucher ters kaydi yapilamadi.")
        )
      );
    } finally {
      setReverseSubmitting(false);
    }
  }
  function renderMoney(amount) {
    return <MoneyText amount={amount || 0} showCurrency={false} />;
  }
  function renderSourceLinesTab() {
    return (
      <SectionCard
        title={l("Source AP Lines", "Kaynak AP satirlari")}
        subtitle={l(
          "Posted AP lines reclassified into inventory capitalization and consumed adjustment.",
          "Envanter aktiflestirme ve tuketilen duzeltmesine tasinan kayda alinmis AP satirlari."
        )}
      >
        {sourceRows.length === 0 ? (
          <EmptyState
            message={l(
              "No source AP lines are linked to this voucher.",
              "Bu voucher ile bagli kaynak AP satiri yok."
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{l("Bill No", "Fatura no")}</th>
                  <th className="px-4 py-3">{l("Vendor", "Tedarikci")}</th>
                  <th className="px-4 py-3">{l("AP Line", "AP satiri")}</th>
                  <th className="px-4 py-3">{l("Posting Account", "Kayit hesabi")}</th>
                  <th className="px-4 py-3 text-right">{l("Applied Base", "Uygulanan baz")}</th>
                  <th className="px-4 py-3 text-right">{l("Applied Txn", "Uygulanan islem")}</th>
                  <th className="px-4 py-3">{l("Currency", "Para birimi")}</th>
                  <th className="px-4 py-3 text-right">{l("Remaining", "Kalan")}</th>
                  <th className="px-4 py-3">{l("Drillback", "Drillback")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sourceRows.map((row) => {
                  const documentRoute = buildCariDocumentRoute(row.sourceCariDocumentId);
                  return (
                    <tr key={row.voucherSourceId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.billNo || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.vendorName || row.vendorCode || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{row.lineDescription || "-"}</div>
                        <div className="text-xs text-slate-500">
                          {l("Line", "Satir")} #{row.lineNo || "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.postingAccountCode
                          ? `${row.postingAccountCode} - ${row.postingAccountName || ""}`.trim()
                          : row.postingAccountName || "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {renderMoney(row.appliedAmountBase)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {renderMoney(row.appliedAmountTxn)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.currencyCode || "-"}</td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {renderMoney(row.remainingUnappliedAmountBase)}
                      </td>
                      <td className="px-4 py-3">
                        {documentRoute && canReadCari ? (
                          <Link
                            className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                            to={documentRoute}
                          >
                            {l("Open Bill", "Faturayi ac")}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {canReadCari
                              ? l("Unavailable", "Yok")
                              : l("Missing cari.doc.read", "Eksik cari.doc.read")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    );
  }
  function renderTargetsTab() {
    return (
      <SectionCard
        title={l("Target Receipts", "Hedef girisler")}
        subtitle={l(
          "Receipt targets keep source receipt cost, same-document charges, and later landed-cost voucher adjustments distinct.",
          "Hedef girisler; kaynak giris maliyetini, ayni belge masraflarini ve sonraki maliyet voucher duzeltmelerini ayri tutar."
        )}
      >
        {targetRows.length === 0 ? (
          <EmptyState
            message={l(
              "No target receipts are linked to this voucher.",
              "Bu voucher ile bagli hedef giris yok."
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{l("Receipt Ref", "Giris ref")}</th>
                  <th className="px-4 py-3">{l("Item", "Stok")}</th>
                  <th className="px-4 py-3">{l("Warehouse", "Depo")}</th>
                  <th className="px-4 py-3">{l("Context", "Baglam")}</th>
                  <th className="px-4 py-3">{l("Operating Unit", "Isletme birimi")}</th>
                  <th className="px-4 py-3 text-right">{l("Allocated", "Dagitilan")}</th>
                  <th className="px-4 py-3 text-right">{l("On Hand", "Eldeki")}</th>
                  <th className="px-4 py-3 text-right">{l("Consumed", "Tuketilen")}</th>
                  <th className="px-4 py-3">{l("Drillback", "Drillback")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {targetRows.map((row) => {
                  const movementRoute = buildMovementRoute(
                    voucher?.legalEntityId,
                    row.sourceAnchorInventoryMovementId
                  );
                  return (
                    <tr key={row.voucherTargetId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">
                        <div>{row.receiptRef || "-"}</div>
                        <div className="text-xs text-slate-500">{row.receiptDate || "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.itemCode ? `${row.itemCode} - ${row.itemName || ""}`.trim() : row.itemName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.warehouseCode
                          ? `${row.warehouseCode} - ${row.warehouseName || ""}`.trim()
                          : row.warehouseName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.ownershipScope === "OPERATING_UNIT"
                          ? l("Operating unit", "Isletme birimi")
                          : l("Central", "Merkez")}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.operatingUnitCode
                          ? `${row.operatingUnitCode} - ${row.operatingUnitName || ""}`.trim()
                          : row.operatingUnitName || "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {renderMoney(row.allocatedAmountBase)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {renderMoney(row.onHandAllocatedAmountBase)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {renderMoney(row.consumedAllocatedAmountBase)}
                      </td>
                      <td className="px-4 py-3">
                        {movementRoute ? (
                          <Link
                            className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                            to={movementRoute}
                          >
                            {l("Open Movement", "Hareketi ac")}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">{l("Unavailable", "Yok")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    );
  }
  function renderLayerAllocationsTab() {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          {l(
            "Transfer-aware layer allocations show where original receipt economics stayed on hand, where they were already consumed, and where later transfer carry-forward recreated open landed-cost balances.",
            "Transfer-bilincli katman dagilimlari; kaynak giris ekonomisinin nerede elde kaldigini, nerede tuketildigini ve sonraki transfer devrinin nerede acik maliyet bakiyesi olusturdugunu gosterir."
          )}
        </div>
        <SectionCard
          title={l("Layer Allocations", "Katman dagilimlari")}
          subtitle={l(
            "Expert view of anchor receipt, resolved descendant movement, and additive landed-cost open balance state.",
            "Kaynak giris, cozulmus alt hareket ve ek maliyet acik bakiye durumunun uzman gorunumu."
          )}
        >
          {layerAllocationRows.length === 0 ? (
            <EmptyState
              message={l(
                "No layer allocations are stored for this voucher.",
                "Bu voucher icin saklanan katman dagilimi yok."
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("Anchor Receipt", "Kaynak giris")}</th>
                    <th className="px-4 py-3">{l("Resolved Movement", "Cozulen hareket")}</th>
                    <th className="px-4 py-3">{l("Cost Layer", "Maliyet katmani")}</th>
                    <th className="px-4 py-3">{l("Origin Allocation", "Kaynak dagilim")}</th>
                    <th className="px-4 py-3">{l("Role", "Rol")}</th>
                    <th className="px-4 py-3 text-right">{l("Qty Snapshot", "Miktar anlik")}</th>
                    <th className="px-4 py-3 text-right">{l("Allocated", "Dagitilan")}</th>
                    <th className="px-4 py-3 text-right">{l("Remaining Qty", "Kalan miktar")}</th>
                    <th className="px-4 py-3 text-right">{l("Remaining Amount", "Kalan tutar")}</th>
                    <th className="px-4 py-3">{l("Open Status", "Acik durum")}</th>
                    <th className="px-4 py-3">{l("Detail", "Detay")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {layerAllocationRows.map((row) => {
                    const active = row.voucherLayerAllocationId === selectedLayerAllocationId;
                    return (
                      <tr
                        key={row.voucherLayerAllocationId}
                        className={active ? "bg-slate-50" : "hover:bg-slate-50"}
                      >
                        <td className="px-4 py-3 text-slate-700">
                          <div>{row.sourceAnchorMovementRef || "-"}</div>
                          <div className="text-xs text-slate-500">{row.sourceAnchorMovementDate || "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{row.resolvedMovementRef || "-"}</div>
                          <div className="text-xs text-slate-500">
                            {row.descendantKind === "ANCHOR"
                              ? l("Anchor receipt", "Kaynak giris")
                              : l("Transfer descendant", "Transfer alt hareketi")}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">#{row.resolvedCostLayerId || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {row.originLayerAllocationId ? `#${row.originLayerAllocationId}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {getAllocationRoleLabel(row.allocationRole, l)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">{row.quantitySnapshot || 0}</td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          {renderMoney(row.allocatedAmountBase)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {row.remainingAdjustedQuantity || 0}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {renderMoney(row.remainingAdjustedAmountBase)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {getOpenStatusLabel(row.openStatus, l)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedLayerAllocationId(row.voucherLayerAllocationId)}
                            className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                          >
                            {active ? l("Selected", "Secili") : l("Open Detail", "Detayi ac")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <SectionCard
          title={l("Layer Allocation Drawer", "Katman dagilim cekmecesi")}
          subtitle={l(
            "Descendant path, carry-forward evidence, and linked landed-cost consumptions for the selected layer allocation.",
            "Secili katman dagilimi icin alt yol, devir kaniti ve bagli maliyet tuketimleri."
          )}
        >
          {!selectedLayerAllocation ? (
            <EmptyState
              message={l(
                "Select a layer allocation row to inspect detail.",
                "Detayi incelemek icin bir katman dagilimi satiri secin."
              )}
            />
          ) : (
            <div className="space-y-5 p-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryStat
                  label={l("Source Anchor", "Kaynak bag")}
                  value={selectedLayerAllocation.sourceAnchorMovementRef || "-"}
                />
                <SummaryStat
                  label={l("Resolved Movement", "Cozulen hareket")}
                  value={selectedLayerAllocation.resolvedMovementRef || "-"}
                />
                <SummaryStat
                  label={l("Cost Layer", "Maliyet katmani")}
                  value={
                    selectedLayerAllocation.resolvedCostLayerId
                      ? `#${selectedLayerAllocation.resolvedCostLayerId}`
                      : "-"
                  }
                />
                <SummaryStat
                  label={l("Open Status", "Acik durum")}
                  value={getOpenStatusLabel(selectedLayerAllocation.openStatus, l)}
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {l("Descendant Path", "Alt yol")}
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {selectedLayerAllocation.descendantPath || "-"}
                  </p>
                  <div className="mt-3 text-xs text-slate-500">
                    {selectedLayerAllocation.originLayerAllocationId
                      ? l(
                          `Carry-forward originated from layer allocation #${selectedLayerAllocation.originLayerAllocationId}.`,
                          `Devir, #${selectedLayerAllocation.originLayerAllocationId} katman dagilimindan uretildi.`
                        )
                      : selectedLayerAllocation.descendantKind === "ANCHOR"
                        ? l(
                            "This allocation stayed on the anchor receipt movement.",
                            "Bu dagilim kaynak giris hareketinde kaldi."
                          )
                        : l(
                            "This allocation resolved onto a transfer descendant movement.",
                            "Bu dagilim bir transfer alt hareketine cozuldu."
                          )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {l("Carry-Forward Notes", "Devir notlari")}
                  </div>
                  {selectedLayerConsumptions.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">
                      {l(
                        "No landed-cost consumption has been recorded against this layer allocation yet.",
                        "Bu katman dagilimina karsi henuz maliyet tuketimi kaydedilmedi."
                      )}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {selectedLayerConsumptions.map((row) => (
                        <li key={row.landedCostConsumptionId} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div>
                            {row.carryForwardReceiptMovementRef
                              ? l(
                                  `Carry-forward recreated at ${row.carryForwardReceiptMovementRef}.`,
                                  `Devir bakiyesi ${row.carryForwardReceiptMovementRef} hareketinde yeniden olusturuldu.`
                                )
                              : l(
                                  "Consumption stayed on the consuming movement without transfer carry-forward.",
                                  "Tuketim, transfer devri olmadan tuketen harekette kaldi."
                                )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {l("Status", "Durum")}: {getConsumptionStatusLabel(row.status, l)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                  {l("Linked Landed-Cost Consumptions", "Bagli maliyet tuketimleri")}
                </div>
                {selectedLayerConsumptions.length === 0 ? (
                  <EmptyState
                    message={l(
                      "No landed-cost consumptions are linked to the selected layer allocation.",
                      "Secili katman dagilimina bagli maliyet tuketimi yok."
                    )}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">{l("Consuming Movement", "Tuketen hareket")}</th>
                          <th className="px-4 py-3 text-right">{l("Qty", "Miktar")}</th>
                          <th className="px-4 py-3 text-right">{l("Amount", "Tutar")}</th>
                          <th className="px-4 py-3">{l("Carry-Forward Receipt", "Devir girisi")}</th>
                          <th className="px-4 py-3">{l("Status", "Durum")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedLayerConsumptions.map((row) => (
                          <tr key={row.landedCostConsumptionId}>
                            <td className="px-4 py-3 text-slate-700">{row.consumingMovementRef || "-"}</td>
                            <td className="px-4 py-3 text-right text-slate-900">{row.quantityConsumed || 0}</td>
                            <td className="px-4 py-3 text-right text-slate-900">
                              {renderMoney(row.allocatedAmountBaseConsumed)}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {row.carryForwardReceiptMovementRef || "-"}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {getConsumptionStatusLabel(row.status, l)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    );
  }
  function renderConsumptionsTab() {
    return (
      <SectionCard
        title={l("Landed-Cost Consumptions", "Maliyet tuketimleri")}
        subtitle={l(
          "Later issue and transfer valuation consume additive landed-cost balances alongside the original FIFO cost layers.",
          "Sonraki cikis ve transfer degerlemesi, orijinal FIFO katmanlarina ek olarak maliyet bakiyelerini tuketir."
        )}
      >
        {consumptionRows.length === 0 ? (
          <EmptyState
            message={l(
              "No landed-cost consumptions have been recorded for this voucher.",
              "Bu voucher icin maliyet tuketimi kaydedilmedi."
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{l("Voucher Layer Allocation", "Voucher katman dagilimi")}</th>
                  <th className="px-4 py-3">{l("Consuming Movement", "Tuketen hareket")}</th>
                  <th className="px-4 py-3">{l("Transfer Ref", "Transfer ref")}</th>
                  <th className="px-4 py-3 text-right">{l("Qty Consumed", "Tuketilen miktar")}</th>
                  <th className="px-4 py-3 text-right">{l("Amount Consumed", "Tuketilen tutar")}</th>
                  <th className="px-4 py-3">{l("Carry-Forward Receipt", "Devir girisi")}</th>
                  <th className="px-4 py-3">{l("Carry-Forward Layer", "Devir katmani")}</th>
                  <th className="px-4 py-3">{l("Status", "Durum")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consumptionRows.map((row) => (
                  <tr key={row.landedCostConsumptionId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">
                      <div>#{row.voucherLayerAllocationId || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {getAllocationRoleLabel(row.allocationRole, l)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.consumingMovementRef || "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{row.transferNo || "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-900">{row.quantityConsumed || 0}</td>
                    <td className="px-4 py-3 text-right text-slate-900">
                      {renderMoney(row.allocatedAmountBaseConsumed)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.carryForwardReceiptMovementRef || "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.carryForwardCostLayerId ? `#${row.carryForwardCostLayerId}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {getConsumptionStatusLabel(row.status, l)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    );
  }
  function renderJournalAuditTab() {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat
            label={l("Source Link Type", "Kaynak bag turu")}
            value={voucher?.journalAudit?.sourceLinkType || "-"}
          />
          <SummaryStat
            label={l("Posted Journal", "Kaydedilen yevmiye")}
            value={postedJournal?.journalNo || "-"}
          />
          <SummaryStat
            label={l("Reversal Journal", "Ters yevmiye")}
            value={reversalJournal?.journalNo || "-"}
          />
          <SummaryStat
            label={l("Source Document Blocker", "Kaynak belge blok durumu")}
            value={
              voucher?.journalAudit?.sourceDocumentBlockerState?.isBlocked
                ? l("Active", "Aktif")
                : l("Cleared", "Temiz")
            }
          />
        </div>
        {journalReverseBlock?.isBlocked ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {l(
              "Direct GL reversal stays blocked while this journal is linked to the landed-cost voucher workflow. Reverse from the voucher, not from Journal Workbench.",
              "Bu yevmiye stok maliyet voucher akisina bagli oldugu icin dogrudan GL ters kaydi bloklu kalir. Ters kaydi yevmiye ekranindan degil, voucher akisindan yapin."
            )}
          </div>
        ) : null}
        <SectionCard
          title={l("Journal & Audit", "Yevmiye ve denetim")}
          subtitle={l(
            "Journal drillback, source-link evidence, reversal blocker visibility, and audit timestamps.",
            "Yevmiye drillback, kaynak bag kaniti, ters kayit blok gorunumu ve denetim zamanlari."
          )}
        >
          <div className="space-y-5 p-5">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {l("Journal Lineage", "Yevmiye baglanti zinciri")}
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div>
                    {l("Posted Journal", "Kaydedilen yevmiye")}:{" "}
                    {postedJournal?.journalNo || "-"}
                    {buildJournalRoute(postedJournal?.journalEntryId) && canReadJournal ? (
                      <>
                        {" "}
                        <Link
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                          to={buildJournalRoute(postedJournal?.journalEntryId)}
                        >
                          {l("Open Journal", "Yevmiyeyi ac")}
                        </Link>
                      </>
                    ) : null}
                  </div>
                  <div>
                    {l("Reversal Journal", "Ters yevmiye")}: {reversalJournal?.journalNo || "-"}
                  </div>
                  <div>
                    {l("Book", "Defter")}:{" "}
                    {postedJournal?.bookCode
                      ? `${postedJournal.bookCode} - ${postedJournal.bookName || ""}`.trim()
                      : postedJournal?.bookName || "-"}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {l("Audit Timestamps", "Denetim zamanlari")}
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div>{l("Created", "Olusturuldu")}: {voucher?.journalAudit?.auditTimestamps?.createdAt || "-"}</div>
                  <div>{l("Updated", "Guncellendi")}: {voucher?.journalAudit?.auditTimestamps?.updatedAt || "-"}</div>
                  <div>{l("Posted", "Kaydedildi")}: {voucher?.journalAudit?.auditTimestamps?.postedAt || "-"}</div>
                  <div>{l("Reversed", "Ters kaydedildi")}: {voucher?.journalAudit?.auditTimestamps?.reversedAt || "-"}</div>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {l("Source Document Blocker State", "Kaynak belge blok durumu")}
              </div>
              <p className="mt-2 text-sm text-slate-700">
                {voucher?.journalAudit?.sourceDocumentBlockerState?.isBlocked
                  ? l(
                      `AP source document reversal stays blocked while this voucher remains active. Documents: ${voucher?.journalAudit?.sourceDocumentBlockerState?.blockedDocumentCount || 0}, source lines: ${voucher?.journalAudit?.sourceDocumentBlockerState?.blockedSourceLineCount || 0}.`,
                      `Bu voucher aktif kaldigi surece AP kaynak belge ters kaydi bloklu kalir. Belgeler: ${voucher?.journalAudit?.sourceDocumentBlockerState?.blockedDocumentCount || 0}, kaynak satirlar: ${voucher?.journalAudit?.sourceDocumentBlockerState?.blockedSourceLineCount || 0}.`
                    )
                  : l(
                      "No active source application remains. AP source document reversal blockers are cleared.",
                      "Aktif kaynak uygulamasi kalmadi. AP kaynak belge ters kayit bloklari temizlendi."
                    )}
              </p>
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title={l("Journal Debit / Credit Grid", "Yevmiye borc / alacak gridi")}
          subtitle={l(
            "Context and operating-unit visibility stay explicit on landed-cost voucher journals.",
            "Maliyet voucher yevmiyelerinde baglam ve isletme birimi gorunurlugu acik kalir."
          )}
        >
          {!postedJournal?.lines?.length ? (
            <EmptyState
              message={l(
                "No posted journal lines are available for this voucher.",
                "Bu voucher icin kaydedilen yevmiye satiri yok."
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("Line", "Satir")}</th>
                    <th className="px-4 py-3">{l("Account", "Hesap")}</th>
                    <th className="px-4 py-3">{l("Context / OU", "Baglam / IB")}</th>
                    <th className="px-4 py-3">{l("Description", "Aciklama")}</th>
                    <th className="px-4 py-3 text-right">{l("Debit", "Borc")}</th>
                    <th className="px-4 py-3 text-right">{l("Credit", "Alacak")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {postedJournal.lines.map((row) => (
                    <tr key={row.journalLineId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">#{row.lineNo || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.accountCode
                          ? `${row.accountCode} - ${row.accountName || ""}`.trim()
                          : row.accountName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.operatingUnitCode
                          ? `${l("Operating unit", "Isletme birimi")}: ${row.operatingUnitCode}${row.operatingUnitName ? ` - ${row.operatingUnitName}` : ""}`
                          : getOwnershipLabel(voucher, l)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.description || "-"}</td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {renderMoney(row.debitBase)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {renderMoney(row.creditBase)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <SectionCard
          title={l("Journal Source Links", "Yevmiye kaynak baglari")}
          subtitle={l(
            "Source-link type stays canonical as STOCK_LANDED_COST_VOUCHER for drillback and reverse-block handling.",
            "Drillback ve ters kayit blok yonlendirmesi icin kaynak bag turu STOCK_LANDED_COST_VOUCHER olarak kanonik kalir."
          )}
        >
          {journalSourceLinks.length === 0 ? (
            <EmptyState
              message={l(
                "No journal source links are attached to the posted journal.",
                "Kaydedilen yevmiyeye bagli kaynak bag yok."
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("Source Type", "Kaynak turu")}</th>
                    <th className="px-4 py-3">{l("Source Id", "Kaynak id")}</th>
                    <th className="px-4 py-3">{l("Link Role", "Bag rolu")}</th>
                    <th className="px-4 py-3">{l("Destination", "Hedef")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journalSourceLinks.map((row) => {
                    const destinationRoute = resolveSourceLinkDestination(row) || row?.destination?.route || null;
                    return (
                      <tr key={row.id || `${row.source_ref_type}-${row.source_ref_id}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-700">{row.source_ref_type || row.sourceRefType || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.source_ref_id || row.sourceRefId || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.link_role || row.linkRole || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {destinationRoute ? (
                            <Link
                              className="font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                              to={destinationRoute}
                            >
                              {destinationRoute}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
        <SectionCard
          title={l("Voucher Reversal Blockers", "Voucher ters kayit bloklari")}
          subtitle={l(
            "Reversal blocks only when later downstream dependency exists on a capitalized landed-cost slice.",
            "Ters kayit yalnizca aktiflesen maliyet dilimi uzerinde sonraki bagimlilik varsa bloklanir."
          )}
        >
          {reversalDependencies.length === 0 ? (
            <EmptyState
              message={l(
                "No downstream dependency is currently blocking voucher reversal.",
                "Su anda voucher ters kaydini bloklayan sonraki bagimlilik yok."
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("Resolved Cost Layer", "Cozulen maliyet katmani")}</th>
                    <th className="px-4 py-3">{l("Dependent Movement", "Bagimli hareket")}</th>
                    <th className="px-4 py-3">{l("Dependency Type", "Bagimlilik tipi")}</th>
                    <th className="px-4 py-3">{l("Date", "Tarih")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reversalDependencies.map((row, index) => (
                    <tr
                      key={`${row.voucherLayerAllocationId}-${row.dependentMovementId}-${index}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 text-slate-700">
                        #{row.resolvedCostLayerId || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.dependentMovementType || "-"} #{row.dependentMovementId || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {getDependencyTypeLabel(row.dependencyType, l)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.dependentMovementDate || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    );
  }
  function renderSummaryTab() {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            title={l("Voucher Summary", "Voucher ozeti")}
            subtitle={l(
              "Separate AP extra costs were distributed after receipt without rewriting the historical receipt rows.",
              "Ayrik AP ek maliyetleri, gecmis giris satirlari yeniden yazilmadan alim sonrasi dagitildi."
            )}
          >
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <SummaryStat label={l("Source Amount", "Kaynak tutari")}>
                {renderMoney(voucher?.sourceSummary?.totalAppliedAmountBase)}
              </SummaryStat>
              <SummaryStat label={l("Capitalized", "Aktiflesen")}>
                {renderMoney(voucher?.targetSummary?.totalCapitalizedAmountBase)}
              </SummaryStat>
              <SummaryStat label={l("Consumed", "Tuketilen")}>
                {renderMoney(voucher?.targetSummary?.totalConsumedAmountBase)}
              </SummaryStat>
              <SummaryStat label={l("Remaining Source Balance", "Kalan kaynak bakiye")}>
                {renderMoney(voucher?.sourceSummary?.totalRemainingUnappliedAmountBase)}
              </SummaryStat>
            </div>
          </SectionCard>
          <SectionCard
            title={l("Lifecycle", "Yasam dongusu")}
            subtitle={l(
              "Voucher history, actor visibility, and journal linkage.",
              "Voucher gecmisi, kullanici gorunurlugu ve yevmiye baglantisi."
            )}
          >
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">{l("Created / Posted", "Olusturan / Kaydeden")}</div>
                <div className="mt-2">
                  {voucher?.createdByName || "-"}
                  <div className="text-xs text-slate-500">{voucher?.createdAt || "-"}</div>
                </div>
                <div className="mt-3">
                  {postedJournal?.journalNo || "-"}
                  <div className="text-xs text-slate-500">{voucher?.postedAt || "-"}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">{l("Reversal", "Ters kayit")}</div>
                <div className="mt-2">
                  {voucher?.reversedByName || "-"}
                  <div className="text-xs text-slate-500">{voucher?.reversedAt || "-"}</div>
                </div>
                <div className="mt-3">
                  {reversalJournal?.journalNo || "-"}
                  <div className="text-xs text-slate-500">{reversalJournal?.entryDate || "-"}</div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            title={l("Journal Summary", "Yevmiye ozeti")}
            subtitle={l(
              "Posted journal remains the canonical financial posting for the voucher.",
              "Kaydedilen yevmiye, voucher icin kanonik finansal kayit olarak kalir."
            )}
          >
            <div className="space-y-4 p-5 text-sm text-slate-700">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-semibold text-slate-900">{postedJournal?.journalNo || "-"}</div>
                <div className="mt-2 text-slate-700">{postedJournal?.description || "-"}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Debit", "Borc")}</div>
                    <div className="mt-1 font-medium text-slate-900">
                      {renderMoney(postedJournal?.totalDebitBase)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Credit", "Alacak")}</div>
                    <div className="mt-1 font-medium text-slate-900">
                      {renderMoney(postedJournal?.totalCreditBase)}
                    </div>
                  </div>
                </div>
              </div>
              {voucher?.note ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{l("Note", "Not")}</div>
                  <p className="mt-2 text-slate-700">{voucher.note}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>
          <SectionCard
            title={l("Inventory Reporting Semantics", "Stok raporlama semantigi")}
            subtitle={l(
              "Reporting keeps original receipt cost, same-document charge cost, and cross-document landed-cost voucher adjustments explicit.",
              "Raporlama; orijinal giris maliyetini, ayni belge masraf maliyetini ve belge-disinda maliyet voucher duzeltmelerini acik ayirir."
            )}
          >
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-semibold text-slate-900">
                  {l("Original Receipt Cost", "Orijinal giris maliyeti")}
                </div>
                <p className="mt-2">
                  {l(
                    "Physical receipt valuation remains on the original inventory movement and cost layer history.",
                    "Fiziksel giris degerlemesi, orijinal stok hareketi ve maliyet katmani gecmisinde kalir."
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-semibold text-slate-900">
                  {l("Same-Document Charge Cost", "Ayni belge masraf maliyeti")}
                </div>
                <p className="mt-2">
                  {l(
                    "Track 40 same-document charges stay separate from this later landed-cost voucher adjustment workflow.",
                    "Track 40 ayni belge masraflari, bu sonraki maliyet voucher duzeltme akisindan ayri kalir."
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-semibold text-slate-900">
                  {l("Cross-Document Voucher Adjustment", "Belge-disinda voucher duzeltmesi")}
                </div>
                <p className="mt-2">
                  {l(
                    "Inventory value includes landed-cost voucher adjustments additively on top of the original receipt economics.",
                    "Stok degeri, orijinal giris ekonomisinin uzerine ek olarak maliyet voucher duzeltmelerini icerir."
                  )}
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
        {voucher?.hasReversalDependencies ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {l(
              "This voucher currently has downstream dependency on a capitalized landed-cost slice. Reversal stays blocked until those later issue or transfer dependencies are removed.",
              "Bu voucher su anda aktiflesen maliyet dilimi uzerinde sonraki bagimliliga sahip. Bu sonraki cikis veya transfer bagimliliklari kaldirilana kadar ters kayit bloklu kalir."
            )}
          </div>
        ) : null}
      </div>
    );
  }
  function renderActiveTab() {
    switch (activeTab) {
      case "SOURCE_LINES":
        return renderSourceLinesTab();
      case "TARGETS":
        return renderTargetsTab();
      case "LAYERS":
        return renderLayerAllocationsTab();
      case "CONSUMPTIONS":
        return renderConsumptionsTab();
      case "JOURNAL_AUDIT":
        return renderJournalAuditTab();
      case "SUMMARY":
      default:
        return renderSummaryTab();
    }
  }
  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-slate-500">
            <Link className="hover:text-slate-700" to="/app/stok-maliyet-voucherleri">
              {l("Inventory / Landed Cost Vouchers", "Stoklar / Stok Maliyet Voucherleri")}
            </Link>
            <span className="px-2 text-slate-300">/</span>
            <span className="text-slate-700">{voucher?.voucherNo || `#${voucherId || "-"}`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              {voucher?.voucherNo || l("Landed Cost Voucher", "Stok Maliyet Voucheri")}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                uiStatus
              )}`}
            >
              {getStatusLabel(uiStatus, l)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {l(
              "Transfer-aware drillback and audit detail for cross-document stock landed-cost adjustments.",
              "Belge-disinda stok maliyet duzeltmeleri icin transfer-bilincli drillback ve denetim detayi."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
            to="/app/stok-maliyet-voucherleri"
          >
            {l("Back to list", "Listeye don")}
          </Link>
          {openJournalRoute && canReadJournal ? (
            <Link
              className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
              to={openJournalRoute}
            >
              {l("Open Journal", "Yevmiyeyi ac")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title={
                canReadJournal
                  ? l("No posted journal is linked yet.", "Henuz bagli kayitli yevmiye yok.")
                  : l("Missing permission: gl.journal.read", "Eksik yetki: gl.journal.read")
              }
              className="inline-flex cursor-not-allowed items-center rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
            >
              {l("Open Journal", "Yevmiyeyi ac")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setReverseOpen(true)}
            disabled={!canOpenReverseDrawer}
            title={
              !canLandedCostUpsert
                ? l(
                    "Missing permission: inventory.landed_cost.upsert",
                    "Eksik yetki: inventory.landed_cost.upsert"
                  )
                : String(voucher?.status || "").toUpperCase() !== "POSTED"
                  ? l("Only posted vouchers can be reversed.", "Yalniz kaydedilmis voucher terslenebilir.")
                  : ""
            }
            className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold ${
              canOpenReverseDrawer
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
            }`}
          >
            {l("Reverse Voucher", "Voucher ters kaydi")}
          </button>
        </div>
      </div>
      {!canRead ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l("Missing permission: inventory.read", "Eksik yetki: inventory.read")}
        </div>
      ) : null}
      {canRead && !canLandedCostUpsert && String(voucher?.status || "").toUpperCase() === "POSTED" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l(
            "You can open this detail page with inventory.read, but Reverse and any later mutating detail actions require inventory.landed_cost.upsert.",
            "Bu detay sayfasini inventory.read ile acabilirsiniz; ancak Reverse ve sonraki tum degistirici detay islemleri inventory.landed_cost.upsert gerektirir."
          )}
        </div>
      ) : null}
      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {pageError}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {l("Loading voucher detail...", "Voucher detayi yukleniyor...")}
        </div>
      ) : null}
      {!loading && voucher ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryStat label={l("Posting Date", "Kayit tarihi")} value={voucher.postingDate} />
            <SummaryStat
              label={l("Legal Entity", "Tuzel kisilik")}
              value={
                voucher.legalEntityCode
                  ? `${voucher.legalEntityCode} - ${voucher.legalEntityName || ""}`.trim()
                  : voucher.legalEntityName || "-"
              }
            />
            <SummaryStat label={l("Context", "Baglam")} value={getOwnershipLabel(voucher, l)} />
            <SummaryStat label={l("Operating Unit", "Isletme birimi")}>
              {voucher.operatingUnitCode
                ? `${voucher.operatingUnitCode} - ${voucher.operatingUnitName || ""}`.trim()
                : voucher.operatingUnitName || "-"}
            </SummaryStat>
            <SummaryStat label={l("Source Amount", "Kaynak tutari")}>
              {renderMoney(voucher?.sourceSummary?.totalAppliedAmountBase)}
            </SummaryStat>
            <SummaryStat label={l("Capitalized", "Aktiflesen")}>
              {renderMoney(voucher?.targetSummary?.totalCapitalizedAmountBase)}
            </SummaryStat>
            <SummaryStat label={l("Consumed", "Tuketilen")}>
              {renderMoney(voucher?.targetSummary?.totalConsumedAmountBase)}
            </SummaryStat>
            <SummaryStat
              label={l("Source Lines / Targets", "Kaynak satir / hedef")}
              value={`${voucher?.sourceSummary?.lineCount || 0} / ${voucher?.targetSummary?.targetCount || 0}`}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <TabButton active={activeTab === "SUMMARY"} onClick={() => setActiveTab("SUMMARY")}>
              {l("Summary", "Ozet")}
            </TabButton>
            <TabButton
              active={activeTab === "SOURCE_LINES"}
              onClick={() => setActiveTab("SOURCE_LINES")}
            >
              {l("Source AP Lines", "Kaynak AP satirlari")}
            </TabButton>
            <TabButton active={activeTab === "TARGETS"} onClick={() => setActiveTab("TARGETS")}>
              {l("Target Receipts", "Hedef girisler")}
            </TabButton>
            <TabButton active={activeTab === "LAYERS"} onClick={() => setActiveTab("LAYERS")}>
              {l("Layer Allocations", "Katman dagilimlari")}
            </TabButton>
            <TabButton
              active={activeTab === "CONSUMPTIONS"}
              onClick={() => setActiveTab("CONSUMPTIONS")}
            >
              {l("Landed-Cost Consumptions", "Maliyet tuketimleri")}
            </TabButton>
            <TabButton
              active={activeTab === "JOURNAL_AUDIT"}
              onClick={() => setActiveTab("JOURNAL_AUDIT")}
            >
              {l("Journal & Audit", "Yevmiye ve denetim")}
            </TabButton>
          </div>
          {renderActiveTab()}
        </>
      ) : null}
      {reverseOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30">
          <button
            type="button"
            aria-label={l("Close reverse drawer", "Ters kayit cekmecesini kapat")}
            className="flex-1 cursor-default"
            onClick={() => setReverseOpen(false)}
          />
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-slate-950">
                  {l("Reverse Landed Cost Voucher", "Stok Maliyet Voucher Ters Kaydi")}
                </h2>
                <p className="text-sm text-slate-500">
                  {l(
                    "Review voucher state, blocker detail, and journal linkage before reversing.",
                    "Ters kayit oncesi voucher durumunu, blok detayini ve yevmiye baglantisini inceleyin."
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReverseOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                {l("Close", "Kapat")}
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryStat label={l("Voucher No", "Voucher no")} value={voucher?.voucherNo || "-"} />
                <SummaryStat label={l("Status", "Durum")} value={getStatusLabel(uiStatus, l)} />
                <SummaryStat label={l("Capitalized", "Aktiflesen")}>
                  {renderMoney(voucher?.targetSummary?.totalCapitalizedAmountBase)}
                </SummaryStat>
                <SummaryStat label={l("Consumed", "Tuketilen")}>
                  {renderMoney(voucher?.targetSummary?.totalConsumedAmountBase)}
                </SummaryStat>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">{l("Journal Ref", "Yevmiye ref")}</div>
                <div className="mt-2">{voucher?.postedJournalNo || postedJournal?.journalNo || "-"}</div>
              </div>
              {!canLandedCostUpsert ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {l(
                    "Missing permission: inventory.landed_cost.upsert. You can review reversal readiness here, but you cannot submit the reverse action.",
                    "Eksik yetki: inventory.landed_cost.upsert. Ters kayit hazirligini burada inceleyebilirsiniz ancak islemi gonderemezsiniz."
                  )}
                </div>
              ) : null}
              {voucher?.hasReversalDependencies ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <div className="font-semibold text-rose-900">
                    {l("Reversal Blocked", "Ters kayit bloklu")}
                  </div>
                  <p className="mt-2">
                    {l(
                      "Later downstream dependency exists on a capitalized landed-cost slice. Reverse remains blocked until those later issue or transfer dependencies are unwound.",
                      "Aktiflesen maliyet dilimi uzerinde sonraki bagimlilik mevcut. Bu sonraki cikis veya transfer bagimliliklari cozulmeden ters kayit bloklu kalir."
                    )}
                  </p>
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-rose-200 bg-white">
                    <table className="min-w-full divide-y divide-rose-100 text-sm">
                      <thead className="bg-rose-50 text-left text-xs font-semibold uppercase tracking-wide text-rose-700">
                        <tr>
                          <th className="px-4 py-3">{l("Resolved Cost Layer", "Cozulen maliyet katmani")}</th>
                          <th className="px-4 py-3">{l("Dependent Movement", "Bagimli hareket")}</th>
                          <th className="px-4 py-3">{l("Dependency Type", "Bagimlilik tipi")}</th>
                          <th className="px-4 py-3">{l("Date", "Tarih")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-100">
                        {reversalDependencies.map((row, index) => (
                          <tr key={`${row.voucherLayerAllocationId}-${row.dependentMovementId}-${index}`}>
                            <td className="px-4 py-3 text-slate-700">#{row.resolvedCostLayerId || "-"}</td>
                            <td className="px-4 py-3 text-slate-700">
                              {row.dependentMovementType || "-"} #{row.dependentMovementId || "-"}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {getDependencyTypeLabel(row.dependencyType, l)}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{row.dependentMovementDate || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {l(
                    "This voucher is currently eligible for reversal. Both the capitalized and consumed adjustment portions can be unwound from the current state.",
                    "Bu voucher su anda ters kayit icin uygun. Hem aktiflesen hem de tuketilen duzeltme bolumu mevcut durumdan geri alinabilir."
                  )}
                </div>
              )}
              {reverseError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {reverseError}
                </div>
              ) : null}
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="reversalDate">
                    {l("Reversal Date", "Ters kayit tarihi")}
                  </label>
                  <input
                    id="reversalDate"
                    type="date"
                    value={reverseForm.reversalDate}
                    onChange={(event) =>
                      setReverseForm((previous) => ({
                        ...previous,
                        reversalDate: event.target.value,
                      }))
                    }
                    disabled={!canSubmitReverse || reverseSubmitting}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="reverseReason">
                    {l("Reverse Reason", "Ters kayit nedeni")}
                  </label>
                  <textarea
                    id="reverseReason"
                    rows={4}
                    value={reverseForm.reverseReason}
                    onChange={(event) =>
                      setReverseForm((previous) => ({
                        ...previous,
                        reverseReason: event.target.value,
                      }))
                    }
                    disabled={!canSubmitReverse || reverseSubmitting}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    placeholder={l(
                      "Optional reason for audit trail",
                      "Denetim izi icin opsiyonel neden"
                    )}
                  />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setReverseOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
              >
                {l("Close", "Kapat")}
              </button>
              <button
                type="button"
                onClick={handleReverseConfirm}
                disabled={!canSubmitReverse || reverseSubmitting}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  canSubmitReverse && !reverseSubmitting
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                }`}
              >
                {reverseSubmitting
                  ? l("Reversing...", "Ters kaydediliyor...")
                  : l("Reverse Voucher", "Voucher ters kaydi")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
