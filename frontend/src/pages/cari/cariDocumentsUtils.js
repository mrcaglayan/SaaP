export const DOCUMENT_STATUSES = [
  "DRAFT",
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "CANCELLED",
  "REVERSED",
];

export const DOCUMENT_DIRECTIONS = ["AR", "AP"];
export const DOCUMENT_SETTLEMENT_MODES = ["ACCRUAL", "IMMEDIATE_CASH"];

export const DOCUMENT_TYPES = [
  "INVOICE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "PAYMENT",
  "ADJUSTMENT",
];
export const DOCUMENT_LINE_KINDS = [
  "STANDARD",
  "COMMENT",
  "ROUNDING",
  "ADJUSTMENT",
  "OTHER",
];
export const DOCUMENT_LINE_STOCK_IMPACT_MODES = [
  "NONE",
  "RECEIPT_PENDING",
  "ISSUE_PENDING",
];
export const DOCUMENT_LINE_SUBLEDGER_TYPES = ["NONE", "STOCK", "FIXED_ASSET"];
export const DOCUMENT_LINE_FIXED_ASSET_MODES = [
  "AUTO_CREATE",
  "LINK_EXISTING",
  "IMPROVE_EXISTING",
];
export const DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS = [
  "NONE",
  "EQUAL",
  "BY_AMOUNT",
  "BY_QTY",
  "MANUAL",
];
const DOCUMENT_LINE_STOCK_AFFECTING_MODES = new Set(
  DOCUMENT_LINE_STOCK_IMPACT_MODES.filter((value) => value !== "NONE")
);
const DOCUMENT_LINE_SUBMISSION_LIMIT = 500;
const DOCUMENT_LINE_CHARGE_ALLOCATION_NONE = "NONE";
const DOCUMENT_LINE_CHARGE_MANUAL = "MANUAL";
const DOCUMENT_LINE_CHARGE_SUM_TOLERANCE = 0.01;

export const DUE_DATE_REQUIRED_TYPES = new Set(["INVOICE", "DEBIT_NOTE"]);
const DOCUMENT_AMOUNT_PRECISION = 6;

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeSettlementMode(value, fallbackValue = "ACCRUAL") {
  return normalizeEnum(value, DOCUMENT_SETTLEMENT_MODES, fallbackValue);
}

function roundDocumentAmount(value) {
  return Number.isFinite(value) ? Number(value.toFixed(DOCUMENT_AMOUNT_PRECISION)) : null;
}

function roundChargeAllocationAmount(value) {
  return Number.isFinite(Number(value))
    ? Number(Number(value).toFixed(DOCUMENT_AMOUNT_PRECISION))
    : 0;
}

function createDocumentLineRowId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `doc-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function normalizeEnum(value, allowedValues, fallbackValue) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return allowedValues.includes(normalized) ? normalized : fallbackValue;
}

function normalizeChargeAllocationMethod(value) {
  return normalizeEnum(
    value,
    DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS,
    DOCUMENT_LINE_CHARGE_ALLOCATION_NONE
  );
}

function isChargeAllocationLine(line) {
  return (
    normalizeChargeAllocationMethod(
      line?.chargeAllocationMethod ?? line?.charge_allocation_method
    ) !== DOCUMENT_LINE_CHARGE_ALLOCATION_NONE
  );
}

function isStockAffectingLineMode(value) {
  return DOCUMENT_LINE_STOCK_AFFECTING_MODES.has(
    normalizeEnum(value, DOCUMENT_LINE_STOCK_IMPACT_MODES, "NONE")
  );
}

function allocateResidualAmountSplit(totalAmount, partCount) {
  const normalizedPartCount = Number(partCount || 0);
  if (!Number.isInteger(normalizedPartCount) || normalizedPartCount <= 0) {
    return [];
  }
  const normalizedTotal = roundChargeAllocationAmount(totalAmount);
  if (normalizedPartCount === 1) {
    return [normalizedTotal];
  }
  const scaledTotal = Math.round(normalizedTotal * 1_000_000);
  const scaledBaseShare = Math.floor(scaledTotal / normalizedPartCount);
  const allocations = [];
  let allocatedScaled = 0;
  for (let index = 0; index < normalizedPartCount; index += 1) {
    if (index === normalizedPartCount - 1) {
      allocations.push((scaledTotal - allocatedScaled) / 1_000_000);
    } else {
      allocations.push(scaledBaseShare / 1_000_000);
      allocatedScaled += scaledBaseShare;
    }
  }
  return allocations.map((value) => roundChargeAllocationAmount(value));
}

function allocateResidualProportionalSplit(totalAmount, sourceAmounts) {
  const weights = Array.isArray(sourceAmounts)
    ? sourceAmounts.map((value) => Number(value || 0))
    : [];
  if (weights.length === 0) {
    return [];
  }
  if (weights.length === 1) {
    return [roundChargeAllocationAmount(totalAmount)];
  }
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (!(totalWeight > 0)) {
    return [];
  }
  const scaledTotal = Math.round(roundChargeAllocationAmount(totalAmount) * 1_000_000);
  const allocations = [];
  let allocatedScaled = 0;
  for (let index = 0; index < weights.length; index += 1) {
    if (index === weights.length - 1) {
      allocations.push((scaledTotal - allocatedScaled) / 1_000_000);
      continue;
    }
    const scaledShare = Math.floor((scaledTotal * weights[index]) / totalWeight);
    allocations.push(scaledShare / 1_000_000);
    allocatedScaled += scaledShare;
  }
  return allocations.map((value) => roundChargeAllocationAmount(value));
}

function inferDocumentLineSubledgerType(seed, stockImpactMode) {
  const explicitSubledgerType = normalizeEnum(
    seed?.subledgerType ?? seed?.subledger_type ?? "",
    DOCUMENT_LINE_SUBLEDGER_TYPES,
    ""
  );
  if (explicitSubledgerType) {
    return explicitSubledgerType;
  }
  if (toPositiveInt(seed?.targetFixedAssetId ?? seed?.target_fixed_asset_id)) {
    return "FIXED_ASSET";
  }
  return isStockAffectingLineMode(stockImpactMode) ? "STOCK" : "NONE";
}

function mapDocumentLineTaxRow(row, fallbackIndex = 0) {
  return {
    componentNo: Number(row?.componentNo ?? row?.component_no ?? fallbackIndex + 1),
    taxCode: String(row?.taxCode ?? row?.tax_code ?? "").trim() || null,
    taxKind: String(row?.taxKind ?? row?.tax_kind ?? "").trim() || null,
    ratePct: toOptionalNumber(row?.ratePct ?? row?.rate_pct),
    taxBaseAmountTxn: toOptionalNumber(
      row?.taxBaseAmountTxn ?? row?.tax_base_amount_txn
    ),
    taxAmountTxn: toOptionalNumber(row?.taxAmountTxn ?? row?.tax_amount_txn),
    taxPurposeCode: String(
      row?.taxPurposeCode ?? row?.tax_purpose_code ?? ""
    ).trim() || null,
    accountId: toPositiveInt(row?.accountId ?? row?.account_id),
  };
}

function resolveLineTaxAmountTxn(line, taxes = []) {
  const explicitTaxAmount = toOptionalNumber(
    line?.lineTaxAmountTxn ??
      line?.line_tax_amount_txn ??
      line?.taxAmountTxn ??
      line?.tax_amount_txn
  );
  if (explicitTaxAmount !== null) {
    return roundDocumentAmount(explicitTaxAmount) ?? 0;
  }
  return roundDocumentAmount(
    taxes.reduce(
      (sum, row) => sum + Number(row?.taxAmountTxn ?? row?.tax_amount_txn ?? 0),
      0
    )
  ) ?? 0;
}

export function computeDocumentLineAmounts(line) {
  const normalizedTaxes = Array.isArray(line?.taxes)
    ? line.taxes.map((row, index) => mapDocumentLineTaxRow(row, index))
    : [];
  const explicitNetAmount = toOptionalNumber(
    line?.lineNetAmountTxn ??
      line?.line_net_amount_txn ??
      line?.netAmountTxn ??
      line?.net_amount_txn ??
      line?.amountTxn ??
      line?.amount_txn
  );
  const quantityInput = toOptionalNumber(line?.quantity ?? line?.qty);
  const quantity =
    quantityInput !== null && quantityInput > 0 ? roundDocumentAmount(quantityInput) : 1;
  let unitPriceTxn = toOptionalNumber(
    line?.unitPriceTxn ?? line?.unit_price_txn ?? line?.unitPrice
  );
  if (unitPriceTxn === null && explicitNetAmount !== null && quantity > 0) {
    unitPriceTxn = roundDocumentAmount(explicitNetAmount / quantity);
  }
  const lineNetAmountTxn =
    unitPriceTxn !== null
      ? roundDocumentAmount(quantity * unitPriceTxn) ?? 0
      : roundDocumentAmount(explicitNetAmount ?? 0) ?? 0;
  const lineTaxAmountTxn = resolveLineTaxAmountTxn(line, normalizedTaxes);
  const lineGrossAmountTxn =
    roundDocumentAmount(lineNetAmountTxn + lineTaxAmountTxn) ?? 0;

  return {
    quantity,
    unitPriceTxn,
    lineNetAmountTxn,
    lineTaxAmountTxn,
    lineGrossAmountTxn,
    taxes: normalizedTaxes,
  };
}

function normalizeDocumentLineChargeTargets(targets = []) {
  if (!Array.isArray(targets)) {
    return [];
  }
  return targets
    .map((target) => {
      const targetRowId = String(target?.targetRowId || "").trim();
      const targetLineNo = toPositiveInt(target?.targetLineNo ?? target?.target_line_no);
      const allocatedAmountTxn = toOptionalNumber(
        target?.allocatedAmountTxn ?? target?.allocated_amount_txn
      );
      const targetLineDescription = String(
        target?.targetLineDescription ?? target?.target_line_description ?? ""
      ).trim();
      if (!targetRowId && !targetLineNo) {
        return null;
      }
      return {
        targetRowId,
        targetLineNo,
        targetLineDescription,
        allocatedAmountTxn:
          allocatedAmountTxn === null || allocatedAmountTxn === undefined
            ? ""
            : String(roundChargeAllocationAmount(allocatedAmountTxn)),
      };
    })
    .filter(Boolean);
}

export function listEligibleChargeTargetLines(lines, chargeLineRowId) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  return normalizedLines
    .map((line, index) => ({
      ...line,
      lineNo: index + 1,
    }))
    .filter((line) => {
      if (String(line.rowId || "") === String(chargeLineRowId || "")) {
        return false;
      }
      if (String(line.lineKind || "STANDARD").trim().toUpperCase() !== "STANDARD") {
        return false;
      }
      if (isChargeAllocationLine(line)) {
        return false;
      }
      return true;
    });
}

export function reconcileDocumentChargeTargets(lines) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  const linesByRowId = new Map(
    normalizedLines.map((line, index) => [String(line.rowId), { ...line, lineNo: index + 1 }])
  );
  const rowIdByLineNo = new Map(
    normalizedLines.map((line, index) => [index + 1, String(line.rowId)])
  );

  return normalizedLines.map((line) => {
    const chargeAllocationMethod = normalizeChargeAllocationMethod(
      line.chargeAllocationMethod
    );
    if (chargeAllocationMethod === DOCUMENT_LINE_CHARGE_ALLOCATION_NONE) {
      return {
        ...line,
        chargeAllocationMethod: DOCUMENT_LINE_CHARGE_ALLOCATION_NONE,
        chargeTargets: [],
      };
    }
    const reconciledTargets = normalizeDocumentLineChargeTargets(line.chargeTargets)
      .map((target) => {
        const resolvedTargetRowId =
          target.targetRowId || rowIdByLineNo.get(target.targetLineNo) || "";
        const targetLine = linesByRowId.get(resolvedTargetRowId) || null;
        if (!resolvedTargetRowId || !targetLine) {
          return null;
        }
        if (resolvedTargetRowId === String(line.rowId)) {
          return null;
        }
        if (String(targetLine.lineKind || "STANDARD").trim().toUpperCase() !== "STANDARD") {
          return null;
        }
        if (isChargeAllocationLine(targetLine)) {
          return null;
        }
        return {
          targetRowId: resolvedTargetRowId,
          targetLineNo: targetLine.lineNo,
          targetLineDescription:
            target.targetLineDescription || String(targetLine.description || "").trim(),
          allocatedAmountTxn: String(target.allocatedAmountTxn || "").trim(),
        };
      })
      .filter(Boolean);

    const seenTargetRowIds = new Set();
    return {
      ...line,
      chargeAllocationMethod,
      chargeTargets: reconciledTargets.filter((target) => {
        const key = String(target.targetRowId || "").trim();
        if (!key || seenTargetRowIds.has(key)) {
          return false;
        }
        seenTargetRowIds.add(key);
        return true;
      }),
    };
  });
}

export function computeDocumentChargeAllocationPreview(lines) {
  const normalizedLines = reconcileDocumentChargeTargets(lines);
  const linesByRowId = new Map(
    normalizedLines.map((line, index) => [String(line.rowId), { ...line, lineNo: index + 1 }])
  );
  const allocationsByTargetRowId = new Map();
  const chargeLines = [];

  normalizedLines.forEach((line, index) => {
    const chargeAllocationMethod = normalizeChargeAllocationMethod(
      line.chargeAllocationMethod
    );
    if (chargeAllocationMethod === DOCUMENT_LINE_CHARGE_ALLOCATION_NONE) {
      return;
    }
    const targetSelections = normalizeDocumentLineChargeTargets(line.chargeTargets)
      .map((target) => {
        const targetRowId = String(target.targetRowId || "").trim();
        const targetLine = linesByRowId.get(targetRowId) || null;
        if (!targetRowId || !targetLine) {
          return null;
        }
        return {
          targetRowId,
          targetLine,
          targetLineNo: targetLine.lineNo,
          allocatedAmountTxn: toOptionalNumber(target.allocatedAmountTxn),
        };
      })
      .filter(Boolean);

    let allocations = [];
    const chargeNetAmountTxn = Number(line.lineNetAmountTxn || 0);
    if (targetSelections.length > 0) {
      if (chargeAllocationMethod === DOCUMENT_LINE_CHARGE_MANUAL) {
        allocations = targetSelections.map((target) =>
          roundChargeAllocationAmount(target.allocatedAmountTxn || 0)
        );
      } else if (chargeAllocationMethod === "EQUAL") {
        allocations = allocateResidualAmountSplit(chargeNetAmountTxn, targetSelections.length);
      } else if (chargeAllocationMethod === "BY_AMOUNT") {
        allocations = allocateResidualProportionalSplit(
          chargeNetAmountTxn,
          targetSelections.map((target) => Number(target.targetLine.lineNetAmountTxn || 0))
        );
      } else if (chargeAllocationMethod === "BY_QTY") {
        allocations = allocateResidualProportionalSplit(
          chargeNetAmountTxn,
          targetSelections.map((target) => Number(target.targetLine.quantity || 0))
        );
      }
    }

    const resolvedAllocations = targetSelections.map((target, targetIndex) => {
      const allocatedAmountTxn = roundChargeAllocationAmount(allocations[targetIndex] || 0);
      const currentAllocation =
        allocationsByTargetRowId.get(target.targetRowId) || {
          additionalAmountTxn: 0,
        };
      currentAllocation.additionalAmountTxn = roundChargeAllocationAmount(
        currentAllocation.additionalAmountTxn + allocatedAmountTxn
      );
      allocationsByTargetRowId.set(target.targetRowId, currentAllocation);
      return {
        targetRowId: target.targetRowId,
        targetLineNo: target.targetLineNo,
        targetDescription: String(target.targetLine.description || "").trim(),
        targetSubledgerType: target.targetLine.subledgerType || "NONE",
        allocatedAmountTxn,
      };
    });

    chargeLines.push({
      chargeLineRowId: String(line.rowId),
      chargeLineNo: index + 1,
      chargeLineDescription: String(line.description || "").trim(),
      chargeLineNetAmountTxn: chargeNetAmountTxn,
      chargeAllocationMethod,
      allocations: resolvedAllocations,
      manualTotalTxn: roundChargeAllocationAmount(
        resolvedAllocations.reduce(
          (sum, target) => sum + Number(target.allocatedAmountTxn || 0),
          0
        )
      ),
    });
  });

  const targetSummaries = normalizedLines
    .map((line, index) => {
      const allocation = allocationsByTargetRowId.get(String(line.rowId)) || null;
      if (!allocation) {
        return null;
      }
      const originalAmountTxn = Number(line.lineNetAmountTxn || 0);
      const allocatedChargeAmountTxn = roundChargeAllocationAmount(
        allocation.additionalAmountTxn || 0
      );
      const effectiveAmountTxn = roundChargeAllocationAmount(
        originalAmountTxn + allocatedChargeAmountTxn
      );
      const quantity = Number(line.quantity || 0);
      return {
        rowId: String(line.rowId),
        lineNo: index + 1,
        description: String(line.description || "").trim(),
        subledgerType: line.subledgerType || "NONE",
        fixedAssetMode: line.fixedAssetMode || "",
        quantity,
        originalAmountTxn,
        allocatedChargeAmountTxn,
        effectiveAmountTxn,
        effectiveUnitAmountTxn:
          quantity > 0
            ? roundChargeAllocationAmount(effectiveAmountTxn / quantity)
            : null,
      };
    })
    .filter(Boolean);

  return {
    hasChargeLines: chargeLines.length > 0,
    chargeLines,
    allocationsByTargetRowId,
    targetSummaries,
    targetSummaryByRowId: new Map(
      targetSummaries.map((summary) => [String(summary.rowId), summary])
    ),
    chargeLinesByRowId: new Map(
      chargeLines.map((entry) => [String(entry.chargeLineRowId), entry])
    ),
  };
}

export function createDocumentLineDraft(seed = {}) {
  const amounts = computeDocumentLineAmounts(seed);
  const stockImpactMode = normalizeEnum(
    seed?.stockImpactMode ?? seed?.stock_impact_mode ?? "NONE",
    DOCUMENT_LINE_STOCK_IMPACT_MODES,
    "NONE"
  );
  const subledgerType = inferDocumentLineSubledgerType(seed, stockImpactMode);
  return {
    rowId: String(seed?.rowId || createDocumentLineRowId()),
    lineKind: normalizeEnum(
      seed?.lineKind ?? seed?.line_kind ?? "STANDARD",
      DOCUMENT_LINE_KINDS,
      "STANDARD"
    ),
    description: String(seed?.description ?? ""),
    itemCardId: String(seed?.itemCardId ?? seed?.item_card_id ?? "").trim(),
    quantity: String(amounts.quantity ?? 1),
    unitPriceTxn:
      amounts.unitPriceTxn === null || amounts.unitPriceTxn === undefined
        ? ""
        : String(amounts.unitPriceTxn),
    lineNetAmountTxn: String(amounts.lineNetAmountTxn ?? 0),
    lineTaxAmountTxn: String(amounts.lineTaxAmountTxn ?? 0),
    lineGrossAmountTxn: String(amounts.lineGrossAmountTxn ?? 0),
    postingAccountId: String(
      seed?.postingAccountId ?? seed?.posting_account_id ?? ""
    ).trim(),
    warehouseId: String(seed?.warehouseId ?? seed?.warehouse_id ?? "").trim(),
    warehouseCode: String(
      seed?.warehouseCode ?? seed?.warehouse_code ?? ""
    ).trim(),
    warehouseName: String(
      seed?.warehouseName ?? seed?.warehouse_name ?? ""
    ).trim(),
    taxCategoryCode: String(
      seed?.taxCategoryCode ?? seed?.tax_category_code ?? ""
    )
      .trim()
      .toUpperCase(),
    stockImpactMode,
    subledgerType,
    chargeAllocationMethod: normalizeChargeAllocationMethod(
      seed?.chargeAllocationMethod ?? seed?.charge_allocation_method
    ),
    chargeTargets: normalizeDocumentLineChargeTargets(
      seed?.chargeTargets ?? seed?.charge_targets
    ),
    fixedAssetMode: normalizeEnum(
      seed?.fixedAssetMode ?? seed?.fixed_asset_mode ?? "",
      DOCUMENT_LINE_FIXED_ASSET_MODES,
      ""
    ),
    targetFixedAssetId: String(
      seed?.targetFixedAssetId ?? seed?.target_fixed_asset_id ?? ""
    ).trim(),
    fixedAssetCategoryId: String(
      seed?.fixedAssetCategoryId ?? seed?.fixed_asset_category_id ?? ""
    ).trim(),
    fixedAssetOwnerOperatingUnitId: String(
      seed?.fixedAssetOwnerOperatingUnitId ??
        seed?.fixed_asset_owner_operating_unit_id ??
        ""
    ).trim(),
    fixedAssetLocationOperatingUnitId: String(
      seed?.fixedAssetLocationOperatingUnitId ??
        seed?.fixed_asset_location_operating_unit_id ??
        ""
    ).trim(),
    fixedAssetNameOverride: String(
      seed?.fixedAssetNameOverride ?? seed?.fixed_asset_name_override ?? ""
    ).trim(),
    fixedAssetSerialNo: String(
      seed?.fixedAssetSerialNo ?? seed?.fixed_asset_serial_no ?? ""
    ).trim(),
    fixedAssetTag: String(seed?.fixedAssetTag ?? seed?.fixed_asset_tag ?? "").trim(),
    improvementEffectiveDate: String(
      seed?.improvementEffectiveDate ?? seed?.improvement_effective_date ?? ""
    ).trim(),
    revisedUsefulLifeMonths: String(
      seed?.revisedUsefulLifeMonths ??
        seed?.improvementRevisedUsefulLifeMonths ??
        seed?.improvement_revised_useful_life_months ??
        ""
    ).trim(),
    lifeExtensionMonths: String(
      seed?.lifeExtensionMonths ??
        seed?.improvementLifeExtensionMonths ??
        seed?.improvement_life_extension_months ??
        ""
    ).trim(),
    taxes: amounts.taxes,
    previewStatus: String(seed?.previewStatus || "").trim().toUpperCase(),
    previewError: String(seed?.previewError || "").trim(),
    previewUpdatedAt: String(seed?.previewUpdatedAt || "").trim(),
  };
}

export function normalizeDocumentFormLines(lines, fallback = {}) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  if (normalizedLines.length > 0) {
    return reconcileDocumentChargeTargets(normalizedLines);
  }
  const fallbackAmountTxn = toOptionalNumber(fallback?.amountTxn);
  if (fallbackAmountTxn !== null && fallbackAmountTxn > 0) {
    return [
      createDocumentLineDraft({
        quantity: 1,
        unitPriceTxn: fallbackAmountTxn,
        lineNetAmountTxn: fallbackAmountTxn,
        lineGrossAmountTxn: fallbackAmountTxn,
      }),
    ];
  }
  return [createDocumentLineDraft()];
}

export function getDocumentLineTotals(lines) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  const totals = normalizedLines.reduce(
    (accumulator, row) => {
      accumulator.netAmountTxn += Number(row.lineNetAmountTxn || 0);
      accumulator.taxAmountTxn += Number(row.lineTaxAmountTxn || 0);
      accumulator.grossAmountTxn += Number(row.lineGrossAmountTxn || 0);
      return accumulator;
    },
    {
      lineCount: normalizedLines.length,
      netAmountTxn: 0,
      taxAmountTxn: 0,
      grossAmountTxn: 0,
    }
  );

  return {
    lineCount: totals.lineCount,
    netAmountTxn: roundDocumentAmount(totals.netAmountTxn) ?? 0,
    taxAmountTxn: roundDocumentAmount(totals.taxAmountTxn) ?? 0,
    grossAmountTxn: roundDocumentAmount(totals.grossAmountTxn) ?? 0,
  };
}

export function buildDocumentListQuery(filters) {
  return {
    legalEntityId: filters.legalEntityId || undefined,
    operatingUnitId: filters.operatingUnitId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
    direction: filters.direction || undefined,
    documentType: filters.documentType || undefined,
    status: filters.status || undefined,
    dateFrom: filters.dateFrom || filters.documentDateFrom || undefined,
    dateTo: filters.dateTo || filters.documentDateTo || undefined,
    q: filters.q || undefined,
    limit: filters.limit || 100,
    offset: filters.offset || 0,
  };
}

export function requiresDueDate(documentType) {
  return DUE_DATE_REQUIRED_TYPES.has(String(documentType || "").toUpperCase());
}

export function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWholePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

export function mapDocumentRowToForm(row) {
  const amountTxnValue =
    row?.amountTxn === null || row?.amountTxn === undefined
      ? row?.amount_txn === null || row?.amount_txn === undefined
        ? ""
        : String(row.amount_txn)
      : String(row.amountTxn);
  const lines = normalizeDocumentFormLines(row?.lines, {
    amountTxn: amountTxnValue,
  });
  return {
    rowVersion:
      row?.rowVersion === null || row?.rowVersion === undefined
        ? ""
        : String(row.rowVersion),
    legalEntityId: String(row?.legalEntityId ?? row?.legal_entity_id ?? ""),
    operatingUnitId: String(row?.operatingUnitId ?? row?.operating_unit_id ?? ""),
    counterpartyId: String(row?.counterpartyId ?? row?.counterparty_id ?? ""),
    paymentTermId: String(row?.paymentTermId ?? row?.payment_term_id ?? ""),
    settlementMode: normalizeSettlementMode(
      row?.settlementMode ?? row?.settlement_mode,
      "ACCRUAL"
    ),
    settlementCashRegisterId: String(
      row?.settlementCashRegisterId ?? row?.settlement_cash_register_id ?? ""
    ),
    direction: String(row?.direction || "AR"),
    documentType: String(row?.documentType ?? row?.document_type ?? "INVOICE"),
    documentDate: String(row?.documentDate ?? row?.document_date ?? ""),
    dueDate: String(row?.dueDate ?? row?.due_date ?? row?.dueDateSnapshot ?? row?.due_date_snapshot ?? ""),
    amountTxn: amountTxnValue,
    amountBase:
      row?.amountBase === null || row?.amountBase === undefined
        ? row?.amount_base === null || row?.amount_base === undefined
          ? ""
          : String(row.amount_base)
        : String(row.amountBase),
    currencyCode: String(
      row?.currencyCode ??
        row?.currency_code ??
        row?.currencyCodeSnapshot ??
        row?.currency_code_snapshot ??
        ""
    ),
    fxRate:
      row?.fxRate === null || row?.fxRate === undefined
        ? row?.fx_rate === null || row?.fx_rate === undefined
          ? row?.fxRateSnapshot === null || row?.fxRateSnapshot === undefined
            ? row?.fx_rate_snapshot === null || row?.fx_rate_snapshot === undefined
              ? ""
              : String(row.fx_rate_snapshot)
            : String(row.fxRateSnapshot)
          : String(row.fx_rate)
        : String(row.fxRate),
    lines,
  };
}

export function getDocumentFxComputation(form, options = {}) {
  const lineTotals = getDocumentLineTotals(form?.lines);
  const amountTxn =
    lineTotals.lineCount > 0
      ? lineTotals.grossAmountTxn
      : toOptionalNumber(form?.amountTxn);
  const amountBaseInput = toOptionalNumber(form?.amountBase);
  const fxRateInput = toOptionalNumber(form?.fxRate);
  const currencyCode = normalizeCurrencyCode(form?.currencyCode);
  const functionalCurrencyCode = normalizeCurrencyCode(options?.functionalCurrencyCode);
  const hasFunctionalCurrency = /^[A-Z]{3}$/.test(functionalCurrencyCode);
  const isLocalCurrency = hasFunctionalCurrency && currencyCode === functionalCurrencyCode;
  const isForeignCurrency =
    hasFunctionalCurrency &&
    /^[A-Z]{3}$/.test(currencyCode) &&
    currencyCode !== functionalCurrencyCode;
  const resolvedFxRate = isLocalCurrency ? 1 : fxRateInput;
  let derivedAmountBase = null;

  if (amountTxn !== null && amountTxn > 0) {
    if (isLocalCurrency) {
      derivedAmountBase = roundDocumentAmount(amountTxn);
    } else if (resolvedFxRate !== null && resolvedFxRate > 0) {
      derivedAmountBase = roundDocumentAmount(amountTxn * resolvedFxRate);
    }
  }

  return {
    functionalCurrencyCode: hasFunctionalCurrency ? functionalCurrencyCode : "",
    isLocalCurrency,
    isForeignCurrency,
    fxRateRequired: isForeignCurrency,
    resolvedFxRate,
    derivedAmountBase,
    resolvedAmountTxn: amountTxn,
    lineTotals,
    resolvedAmountBase: derivedAmountBase ?? amountBaseInput,
  };
}

export function buildDocumentMutationPayload(form, options = {}) {
  const rowVersion = toPositiveInt(form.rowVersion);
  const legalEntityId = toPositiveInt(form.legalEntityId);
  const operatingUnitId = toPositiveInt(form.operatingUnitId);
  const counterpartyId = toPositiveInt(form.counterpartyId);
  const paymentTermId = toPositiveInt(form.paymentTermId);
  const settlementMode = normalizeSettlementMode(form.settlementMode);
  const settlementCashRegisterId = toPositiveInt(form.settlementCashRegisterId);
  const amountTxn = toOptionalNumber(form.amountTxn);
  const fxComputation = getDocumentFxComputation(form, options);
  const direction = String(form.direction || "").trim().toUpperCase();
  const documentType = String(form.documentType || "").trim().toUpperCase();
  const documentDate = String(form.documentDate || "").trim();
  const dueDate = String(form.dueDate || "").trim();
  const resolvedDueDate =
    settlementMode === "IMMEDIATE_CASH" &&
    requiresDueDate(documentType) &&
    documentDate
      ? documentDate
      : dueDate;
  const currencyCode = normalizeCurrencyCode(form.currencyCode);
  const normalizedLines = normalizeDocumentFormLines(form?.lines);
  const rowIdToLineNo = new Map(
    normalizedLines.map((row, index) => [String(row.rowId), index + 1])
  );
  const lines = Array.isArray(normalizedLines)
    ? normalizedLines.map((row, index) => {
        const normalizedLine = createDocumentLineDraft(row);
        const isFixedAssetLine = normalizedLine.subledgerType === "FIXED_ASSET";
        const isApFixedAssetLine = isFixedAssetLine && direction === "AP";
        const chargeAllocationMethod = normalizeChargeAllocationMethod(
          normalizedLine.chargeAllocationMethod
        );
        const isChargeLine =
          chargeAllocationMethod !== DOCUMENT_LINE_CHARGE_ALLOCATION_NONE;
        const serializedChargeTargets = isChargeLine
          ? normalizeDocumentLineChargeTargets(normalizedLine.chargeTargets)
              .map((target) => {
                const targetLineNo =
                  rowIdToLineNo.get(String(target.targetRowId || "").trim())
                  || toPositiveInt(target.targetLineNo);
                if (!targetLineNo) {
                  return null;
                }
                return {
                  targetLineNo,
                  allocatedAmountTxn:
                    chargeAllocationMethod === DOCUMENT_LINE_CHARGE_MANUAL
                    && String(target.allocatedAmountTxn || "").trim()
                      ? toOptionalNumber(target.allocatedAmountTxn)
                      : undefined,
                };
              })
              .filter(Boolean)
          : [];
        return {
          lineNo: index + 1,
          lineKind: normalizedLine.lineKind,
          description: String(normalizedLine.description || "").trim() || undefined,
          subledgerType: normalizedLine.subledgerType || undefined,
          chargeAllocationMethod: isChargeLine ? chargeAllocationMethod : undefined,
          chargeTargets: isChargeLine && serializedChargeTargets.length > 0
            ? serializedChargeTargets
            : undefined,
          fixedAssetMode:
            isApFixedAssetLine && normalizedLine.fixedAssetMode
              ? normalizedLine.fixedAssetMode
              : undefined,
          itemCardId: toPositiveInt(normalizedLine.itemCardId) || undefined,
          quantity: toOptionalNumber(normalizedLine.quantity) ?? 1,
          unitPriceTxn: toOptionalNumber(normalizedLine.unitPriceTxn),
          lineNetAmountTxn: toOptionalNumber(normalizedLine.lineNetAmountTxn) ?? 0,
          lineTaxAmountTxn: toOptionalNumber(normalizedLine.lineTaxAmountTxn) ?? 0,
          lineGrossAmountTxn: toOptionalNumber(normalizedLine.lineGrossAmountTxn) ?? 0,
          postingAccountId:
            isApFixedAssetLine
            || isChargeLine
            || !toPositiveInt(normalizedLine.postingAccountId)
              ? undefined
              : toPositiveInt(normalizedLine.postingAccountId),
          warehouseId: toPositiveInt(normalizedLine.warehouseId) || undefined,
          targetFixedAssetId:
            toPositiveInt(normalizedLine.targetFixedAssetId) || undefined,
          fixedAssetCategoryId:
            toPositiveInt(normalizedLine.fixedAssetCategoryId) || undefined,
          fixedAssetOwnerOperatingUnitId:
            toPositiveInt(normalizedLine.fixedAssetOwnerOperatingUnitId) || undefined,
          fixedAssetLocationOperatingUnitId:
            toPositiveInt(normalizedLine.fixedAssetLocationOperatingUnitId) || undefined,
          fixedAssetNameOverride: normalizedLine.fixedAssetNameOverride || undefined,
          fixedAssetSerialNo: normalizedLine.fixedAssetSerialNo || undefined,
          fixedAssetTag: normalizedLine.fixedAssetTag || undefined,
          improvementEffectiveDate:
            isApFixedAssetLine &&
            normalizedLine.fixedAssetMode === "IMPROVE_EXISTING" &&
            String(normalizedLine.improvementEffectiveDate || "").trim()
              ? String(normalizedLine.improvementEffectiveDate || "").trim()
              : undefined,
          revisedUsefulLifeMonths:
            toPositiveInt(normalizedLine.revisedUsefulLifeMonths) || undefined,
          lifeExtensionMonths:
            toPositiveInt(normalizedLine.lifeExtensionMonths) || undefined,
          taxCategoryCode: normalizedLine.taxCategoryCode || undefined,
          stockImpactMode:
            isChargeLine
              ? "NONE"
              : normalizedLine.stockImpactMode || undefined,
        };
      })
    : [];

  return {
    rowVersion: rowVersion || undefined,
    legalEntityId,
    operatingUnitId: operatingUnitId || undefined,
    counterpartyId,
    paymentTermId,
    settlementMode,
    settlementCashRegisterId:
      settlementMode === "IMMEDIATE_CASH" ? settlementCashRegisterId || undefined : undefined,
    direction,
    documentType,
    documentDate,
    dueDate: resolvedDueDate || null,
    amountTxn: lines.length > 0 ? fxComputation.resolvedAmountTxn : amountTxn,
    amountBase: fxComputation.resolvedAmountBase,
    currencyCode,
    fxRate: fxComputation.resolvedFxRate,
    lines: lines.length > 0 ? lines : undefined,
  };
}

export function validateDocumentMutationForm(form, options = {}) {
  const payload = buildDocumentMutationPayload(form, options);
  const fxComputation = getDocumentFxComputation(form, options);
  const normalizedLines = normalizeDocumentFormLines(form?.lines);
  const rawFxRate = toOptionalNumber(form.fxRate);
  const rawSettlementMode = String(form?.settlementMode || "")
    .trim()
    .toUpperCase();
  const errors = [];
  const generalErrors = [];
  const lineErrors = new Map();

  function pushGeneralError(message) {
    if (!message || generalErrors.includes(message)) {
      return;
    }
    generalErrors.push(message);
    errors.push(message);
  }

  function pushLineError(lineIndex, rowId, message) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
      return;
    }
    const key = String(rowId || `line-${lineIndex + 1}`);
    const existingMessages = lineErrors.get(key) || [];
    if (!existingMessages.includes(normalizedMessage)) {
      lineErrors.set(key, [...existingMessages, normalizedMessage]);
    }
    errors.push(`lines[${lineIndex}].${normalizedMessage}`);
  }

  if (!payload.legalEntityId) {
    pushGeneralError("legalEntityId is required.");
  }
  if (!payload.counterpartyId) {
    pushGeneralError("counterpartyId is required.");
  }
  if (!DOCUMENT_DIRECTIONS.includes(payload.direction)) {
    pushGeneralError("direction must be AR or AP.");
  }
  if (!DOCUMENT_TYPES.includes(payload.documentType)) {
    pushGeneralError("documentType is invalid.");
  }
  if (!payload.documentDate) {
    pushGeneralError("documentDate is required.");
  }
  if (rawSettlementMode && !DOCUMENT_SETTLEMENT_MODES.includes(rawSettlementMode)) {
    pushGeneralError("settlementMode must be ACCRUAL or IMMEDIATE_CASH");
  }
  if (
    payload.settlementMode === "IMMEDIATE_CASH" &&
    !payload.settlementCashRegisterId
  ) {
    pushGeneralError(
      "settlementCashRegisterId is required when settlementMode=IMMEDIATE_CASH"
    );
  }
  if (requiresDueDate(payload.documentType) && !payload.dueDate) {
    pushGeneralError(`dueDate is required for documentType=${payload.documentType}.`);
  }
  if (Array.isArray(payload.lines) && payload.lines.length > DOCUMENT_LINE_SUBMISSION_LIMIT) {
    pushGeneralError("Document cannot exceed 500 lines.");
  }
  if (payload.lines && payload.lines.length > 0) {
    payload.lines.forEach((line, index) => {
      const sourceLine = normalizedLines[index] || createDocumentLineDraft();
      const rowId = sourceLine.rowId;
      const subledgerType = sourceLine.subledgerType;
      const fixedAssetMode = sourceLine.fixedAssetMode;
      const chargeAllocationMethod = normalizeChargeAllocationMethod(
        sourceLine.chargeAllocationMethod
      );
      const chargeTargets = normalizeDocumentLineChargeTargets(sourceLine.chargeTargets);
      const isChargeLine =
        chargeAllocationMethod !== DOCUMENT_LINE_CHARGE_ALLOCATION_NONE;

      if ((line.quantity ?? 0) <= 0) {
        pushLineError(index, rowId, "quantity must be > 0.");
      }
      if ((line.lineNetAmountTxn ?? 0) <= 0) {
        pushLineError(index, rowId, "lineNetAmountTxn must be > 0.");
      }
      if ((line.lineGrossAmountTxn ?? 0) <= 0) {
        pushLineError(index, rowId, "lineGrossAmountTxn must be > 0.");
      }
      if ((line.lineTaxAmountTxn ?? 0) > 0 && !line.taxCategoryCode) {
        pushLineError(index, rowId, "taxCategoryCode is required when lineTaxAmountTxn > 0.");
      }
      if (isChargeLine) {
        if (payload.direction !== "AP") {
          pushLineError(
            index,
            rowId,
            `chargeAllocationMethod is supported only on AP documents`
          );
        }
        if (subledgerType !== "NONE") {
          pushLineError(
            index,
            rowId,
            "subledgerType must be NONE when chargeAllocationMethod != NONE"
          );
        }
        if ((line.stockImpactMode || "NONE") !== "NONE") {
          pushLineError(
            index,
            rowId,
            "stockImpactMode must be NONE when chargeAllocationMethod != NONE"
          );
        }
        if (!Array.isArray(chargeTargets) || chargeTargets.length === 0) {
          pushLineError(
            index,
            rowId,
            "chargeTargets must be a non-empty array when chargeAllocationMethod != NONE"
          );
        }
      } else if (Array.isArray(chargeTargets) && chargeTargets.length > 0) {
        pushLineError(
          index,
          rowId,
          "chargeTargets is allowed only when chargeAllocationMethod != NONE"
        );
      }
      if (subledgerType === "FIXED_ASSET") {
        if (payload.direction === "AP") {
          if (!fixedAssetMode) {
            pushLineError(index, rowId, "fixedAssetMode is required for AP FIXED_ASSET lines.");
          } else if (fixedAssetMode === "AUTO_CREATE") {
            if (line.targetFixedAssetId) {
              pushLineError(
                index,
                rowId,
                "targetFixedAssetId must be empty for AP FIXED_ASSET AUTO_CREATE lines."
              );
            }
            if (!isWholePositiveInteger(line.quantity)) {
              pushLineError(
                index,
                rowId,
                "quantity must be a whole positive integer for AP FIXED_ASSET AUTO_CREATE lines."
              );
            }
            if (!line.fixedAssetCategoryId) {
              pushLineError(
                index,
                rowId,
                "fixedAssetCategoryId is required for AP FIXED_ASSET AUTO_CREATE lines."
              );
            }
            if (!line.fixedAssetOwnerOperatingUnitId) {
              pushLineError(
                index,
                rowId,
                "fixedAssetOwnerOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines."
              );
            }
            if (!line.fixedAssetLocationOperatingUnitId) {
              pushLineError(
                index,
                rowId,
                "fixedAssetLocationOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines."
              );
            }
            if (line.improvementEffectiveDate) {
              pushLineError(
                index,
                rowId,
                "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
          } else if (fixedAssetMode === "LINK_EXISTING") {
            if (!line.targetFixedAssetId) {
              pushLineError(
                index,
                rowId,
                "targetFixedAssetId is required for AP FIXED_ASSET LINK_EXISTING lines."
              );
            }
            if (Number(line.quantity ?? 0) !== 1) {
              pushLineError(
                index,
                rowId,
                "quantity must equal 1 for AP FIXED_ASSET LINK_EXISTING lines."
              );
            }
            if (line.revisedUsefulLifeMonths || line.lifeExtensionMonths) {
              pushLineError(
                index,
                rowId,
                "revisedUsefulLifeMonths and lifeExtensionMonths are allowed only when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
            if (line.improvementEffectiveDate) {
              pushLineError(
                index,
                rowId,
                "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
          } else if (fixedAssetMode === "IMPROVE_EXISTING") {
            if (!line.targetFixedAssetId) {
              pushLineError(
                index,
                rowId,
                "targetFixedAssetId is required when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
            if (Number(line.quantity ?? 0) !== 1) {
              pushLineError(
                index,
                rowId,
                "quantity must equal 1 when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
            if (line.revisedUsefulLifeMonths && line.lifeExtensionMonths) {
              pushLineError(
                index,
                rowId,
                "revisedUsefulLifeMonths and lifeExtensionMonths cannot both be provided."
              );
            }
            if (
              line.fixedAssetCategoryId
              || line.fixedAssetOwnerOperatingUnitId
              || line.fixedAssetLocationOperatingUnitId
            ) {
              pushLineError(
                index,
                rowId,
                "fixedAssetCategoryId, fixedAssetOwnerOperatingUnitId, and fixedAssetLocationOperatingUnitId are not allowed when fixedAssetMode=IMPROVE_EXISTING."
              );
            }
            const improvementEffectiveDate = String(
              sourceLine.improvementEffectiveDate || line.improvementEffectiveDate || ""
            ).trim();
            if (improvementEffectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(improvementEffectiveDate)) {
              pushLineError(
                index,
                rowId,
                "improvementEffectiveDate must be a valid ISO date."
              );
            }
            if (
              improvementEffectiveDate &&
              payload.documentDate &&
              /^\d{4}-\d{2}-\d{2}$/.test(improvementEffectiveDate) &&
              improvementEffectiveDate > payload.documentDate
            ) {
              pushLineError(
                index,
                rowId,
                "improvementEffectiveDate cannot be after documentDate."
              );
            }
          }
        } else if (payload.direction === "AR") {
          if (!line.targetFixedAssetId) {
            pushLineError(index, rowId, "targetFixedAssetId is required for AR FIXED_ASSET lines.");
          }
          if (Number(line.quantity ?? 0) !== 1) {
            pushLineError(index, rowId, "quantity must equal 1 for AR FIXED_ASSET lines.");
          }
          if (line.improvementEffectiveDate) {
            pushLineError(
              index,
              rowId,
              "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING."
            );
          }
        }
      } else if (subledgerType === "STOCK") {
        if (!line.itemCardId) {
          pushLineError(index, rowId, "itemCardId is required for STOCK lines.");
        }
        if (!line.stockImpactMode) {
          pushLineError(index, rowId, "stockImpactMode is required for STOCK lines.");
        }
        if (line.targetFixedAssetId) {
          pushLineError(index, rowId, "targetFixedAssetId must be empty for STOCK lines.");
        }
        if (sourceLine.improvementEffectiveDate) {
          pushLineError(
            index,
            rowId,
            "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING."
          );
        }
      } else {
        if (line.targetFixedAssetId) {
          pushLineError(index, rowId, "targetFixedAssetId must be empty for NONE lines.");
        }
        if (sourceLine.improvementEffectiveDate) {
          pushLineError(
            index,
            rowId,
            "improvementEffectiveDate is allowed only when fixedAssetMode=IMPROVE_EXISTING."
          );
        }
      }
    });

    const rowByLineNo = new Map(
      normalizedLines.map((row, index) => [index + 1, row])
    );
    const lineNoByRowId = new Map(
      normalizedLines.map((row, index) => [String(row.rowId), index + 1])
    );
    payload.lines.forEach((line, index) => {
      const sourceLine = normalizedLines[index] || createDocumentLineDraft();
      const rowId = sourceLine.rowId;
      const chargeAllocationMethod = normalizeChargeAllocationMethod(
        sourceLine.chargeAllocationMethod
      );
      const isChargeLine =
        chargeAllocationMethod !== DOCUMENT_LINE_CHARGE_ALLOCATION_NONE;
      if (!isChargeLine) {
        return;
      }

      const normalizedChargeTargets = normalizeDocumentLineChargeTargets(sourceLine.chargeTargets);
      const seenTargetLineNos = new Set();
      let manualAllocationSum = 0;
      normalizedChargeTargets.forEach((target, targetIndex) => {
        const targetLineNo =
          lineNoByRowId.get(String(target.targetRowId || "").trim())
          || toPositiveInt(target.targetLineNo);
        if (!targetLineNo) {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo must reference another line on the same document`
          );
          return;
        }
        if (seenTargetLineNos.has(targetLineNo)) {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo duplicates another target`
          );
        }
        seenTargetLineNos.add(targetLineNo);
        if (targetLineNo === index + 1) {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo cannot reference the same line`
          );
        }
        const targetLine = rowByLineNo.get(targetLineNo) || null;
        if (!targetLine) {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo must reference another line on the same document`
          );
          return;
        }
        if (String(targetLine.lineKind || "STANDARD").trim().toUpperCase() !== "STANDARD") {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo must reference a STANDARD line`
          );
        }
        if (isChargeAllocationLine(targetLine)) {
          pushLineError(
            index,
            rowId,
            `chargeTargets[${targetIndex}].targetLineNo cannot reference another charge line`
          );
        }
        if (chargeAllocationMethod === DOCUMENT_LINE_CHARGE_MANUAL) {
          const allocatedAmountTxn = toOptionalNumber(target.allocatedAmountTxn);
          if (allocatedAmountTxn === null || allocatedAmountTxn === undefined) {
            pushLineError(
              index,
              rowId,
              `chargeTargets[${targetIndex}].allocatedAmountTxn is required`
            );
            return;
          }
          manualAllocationSum = roundChargeAllocationAmount(
            manualAllocationSum + allocatedAmountTxn
          );
        }
      });

      if (
        chargeAllocationMethod === DOCUMENT_LINE_CHARGE_MANUAL
        && Math.abs(manualAllocationSum - Number(line.lineNetAmountTxn || 0))
          > DOCUMENT_LINE_CHARGE_SUM_TOLERANCE
      ) {
        pushLineError(
          index,
          rowId,
          "chargeTargets manual allocation total must equal lineNetAmountTxn within tolerance 0.01"
        );
      }
    });
  }
  if (payload.amountTxn === null || payload.amountTxn <= 0) {
    pushGeneralError("amountTxn must be > 0.");
  }
  if (!/^[A-Z]{3}$/.test(payload.currencyCode)) {
    pushGeneralError("currencyCode must be a 3-letter code.");
  }
  if (fxComputation.fxRateRequired && (payload.fxRate === null || payload.fxRate <= 0)) {
    pushGeneralError(
      "fxRate is required when currencyCode differs from legal entity functional currency."
    );
  } else if (String(form.fxRate || "").trim() && (rawFxRate === null || rawFxRate <= 0)) {
    pushGeneralError("fxRate must be > 0 when provided.");
  }

  return {
    payload,
    errors,
    generalErrors,
    lineErrors,
  };
}
