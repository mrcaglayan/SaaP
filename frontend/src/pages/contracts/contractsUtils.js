export const CONTRACT_TYPES = ["CUSTOMER", "VENDOR"];
export const CONTRACT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
  "CANCELLED",
];
export const CONTRACT_LINE_STATUSES = ["ACTIVE", "INACTIVE"];
export const RECOGNITION_METHODS = ["STRAIGHT_LINE", "MILESTONE", "MANUAL"];
export const LINK_TYPES = ["BILLING", "ADVANCE", "ADJUSTMENT"];

const LIFECYCLE_FROM_STATUS = Object.freeze({
  activate: new Set(["DRAFT", "SUSPENDED"]),
  suspend: new Set(["ACTIVE"]),
  close: new Set(["ACTIVE", "SUSPENDED"]),
  cancel: new Set(["DRAFT"]),
});

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toPermissionSet(permissionCodes = []) {
  return new Set(
    Array.isArray(permissionCodes)
      ? permissionCodes.map((code) => String(code || "").trim()).filter(Boolean)
      : []
  );
}

export function resolveContractsPermissionGates(permissionCodes = []) {
  const permissionSet = toPermissionSet(permissionCodes);
  const canReadCounterpartyPicker = permissionSet.has("cari.card.read");
  const canReadAccountPicker = permissionSet.has("gl.account.read");
  const canReadDocumentPicker = permissionSet.has("cari.doc.read");

  return {
    canReadContractsRoute: permissionSet.has("contract.read"),
    canUpsertContract: permissionSet.has("contract.upsert"),
    canActivateContract: permissionSet.has("contract.activate"),
    canSuspendContract: permissionSet.has("contract.suspend"),
    canCloseContract: permissionSet.has("contract.close"),
    canCancelContract: permissionSet.has("contract.cancel"),
    canLinkDocument: permissionSet.has("contract.link_document"),
    canReadCounterpartyPicker,
    canReadAccountPicker,
    canReadDocumentPicker,
    shouldFetchCounterparties: canReadCounterpartyPicker,
    shouldFetchAccounts: canReadAccountPicker,
    shouldFetchDocuments: canReadDocumentPicker,
  };
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

export function formatAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function createEmptyContractLine() {
  return {
    description: "",
    lineAmountTxn: "",
    lineAmountBase: "",
    recognitionMethod: "STRAIGHT_LINE",
    recognitionStartDate: "",
    recognitionEndDate: "",
    deferredAccountId: "",
    revenueAccountId: "",
    status: "ACTIVE",
  };
}

export function createInitialContractForm() {
  return {
    legalEntityId: "",
    counterpartyId: "",
    contractNo: "",
    contractType: "CUSTOMER",
    currencyCode: "USD",
    startDate: "",
    endDate: "",
    notes: "",
    lines: [createEmptyContractLine()],
  };
}

export function createInitialLinkForm() {
  return {
    cariDocumentId: "",
    linkType: "BILLING",
    linkedAmountTxn: "",
    linkedAmountBase: "",
  };
}

export function getCounterpartyRoleForContractType(contractType) {
  return toUpper(contractType) === "VENDOR" ? "VENDOR" : "CUSTOMER";
}

export function getDocumentDirectionForContractType(contractType) {
  return toUpper(contractType) === "VENDOR" ? "AP" : "AR";
}

export function getExpectedAccountTypesForContractType(contractType) {
  if (toUpper(contractType) === "VENDOR") {
    return {
      deferredAccountType: "ASSET",
      revenueAccountType: "EXPENSE",
    };
  }
  return {
    deferredAccountType: "LIABILITY",
    revenueAccountType: "REVENUE",
  };
}

export function filterAccountsForContractRole(accounts, contractType, role = "deferred") {
  const expectedTypes = getExpectedAccountTypesForContractType(contractType);
  const expectedType =
    role === "revenue" ? expectedTypes.revenueAccountType : expectedTypes.deferredAccountType;

  return (Array.isArray(accounts) ? accounts : []).filter(
    (row) => toUpper(row?.account_type) === expectedType
  );
}

export function mapContractDetailToForm(row) {
  const lines = Array.isArray(row?.lines)
    ? row.lines.map((line) => ({
        description: String(line?.description || ""),
        lineAmountTxn:
          line?.lineAmountTxn === null || line?.lineAmountTxn === undefined
            ? ""
            : String(line.lineAmountTxn),
        lineAmountBase:
          line?.lineAmountBase === null || line?.lineAmountBase === undefined
            ? ""
            : String(line.lineAmountBase),
        recognitionMethod: toUpper(line?.recognitionMethod) || "STRAIGHT_LINE",
        recognitionStartDate: String(line?.recognitionStartDate || ""),
        recognitionEndDate: String(line?.recognitionEndDate || ""),
        deferredAccountId: String(line?.deferredAccountId || ""),
        revenueAccountId: String(line?.revenueAccountId || ""),
        status: toUpper(line?.status) || "ACTIVE",
      }))
    : [];

  return {
    legalEntityId: String(row?.legalEntityId || ""),
    counterpartyId: String(row?.counterpartyId || ""),
    contractNo: String(row?.contractNo || ""),
    contractType: toUpper(row?.contractType) || "CUSTOMER",
    currencyCode: String(row?.currencyCode || "USD")
      .trim()
      .toUpperCase(),
    startDate: String(row?.startDate || ""),
    endDate: String(row?.endDate || ""),
    notes: String(row?.notes || ""),
    lines: lines.length > 0 ? lines : [createEmptyContractLine()],
  };
}

export function buildContractListQuery(filters = {}) {
  return {
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    counterpartyId: toPositiveInt(filters.counterpartyId) || undefined,
    contractType: toUpper(filters.contractType) || undefined,
    status: toUpper(filters.status) || undefined,
    q: String(filters.q || "").trim() || undefined,
    limit: toPositiveInt(filters.limit) || 100,
    offset: Number.isInteger(Number(filters.offset)) && Number(filters.offset) >= 0
      ? Number(filters.offset)
      : 0,
  };
}

function normalizeLinePayload(line) {
  return {
    description: String(line?.description || "").trim(),
    lineAmountTxn: toOptionalNumber(line?.lineAmountTxn),
    lineAmountBase: toOptionalNumber(line?.lineAmountBase),
    recognitionMethod: toUpper(line?.recognitionMethod) || "STRAIGHT_LINE",
    recognitionStartDate: String(line?.recognitionStartDate || "").trim(),
    recognitionEndDate: String(line?.recognitionEndDate || "").trim(),
    deferredAccountId: toPositiveInt(line?.deferredAccountId),
    revenueAccountId: toPositiveInt(line?.revenueAccountId),
    status: toUpper(line?.status) || "ACTIVE",
  };
}

export function buildContractMutationPayload(form) {
  const lines = (Array.isArray(form?.lines) ? form.lines : []).map((line) =>
    normalizeLinePayload(line)
  );

  return {
    legalEntityId: toPositiveInt(form?.legalEntityId),
    counterpartyId: toPositiveInt(form?.counterpartyId),
    contractNo: String(form?.contractNo || "").trim(),
    contractType: toUpper(form?.contractType),
    currencyCode: String(form?.currencyCode || "")
      .trim()
      .toUpperCase(),
    startDate: String(form?.startDate || "").trim(),
    endDate: String(form?.endDate || "").trim() || null,
    notes: String(form?.notes || "").trim() || null,
    lines: lines.map((line) => ({
      description: line.description,
      lineAmountTxn: line.lineAmountTxn,
      lineAmountBase: line.lineAmountBase,
      recognitionMethod: line.recognitionMethod,
      recognitionStartDate: line.recognitionStartDate || null,
      recognitionEndDate: line.recognitionEndDate || null,
      deferredAccountId: line.deferredAccountId,
      revenueAccountId: line.revenueAccountId,
      status: line.status,
    })),
  };
}

export function validateContractForm(form) {
  const payload = buildContractMutationPayload(form);
  const errors = [];

  if (!payload.legalEntityId) {
    errors.push("legalEntityId is required.");
  }
  if (!payload.counterpartyId) {
    errors.push("counterpartyId is required.");
  }
  if (!payload.contractNo) {
    errors.push("contractNo is required.");
  }
  if (!CONTRACT_TYPES.includes(payload.contractType)) {
    errors.push("contractType must be CUSTOMER or VENDOR.");
  }
  if (!/^[A-Z]{3}$/.test(payload.currencyCode)) {
    errors.push("currencyCode must be a 3-letter code.");
  }
  if (!payload.startDate) {
    errors.push("startDate is required.");
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    errors.push("At least one contract line is required.");
  }

  payload.lines.forEach((line, index) => {
    const lineLabel = `lines[${index}]`;
    if (!line.description) {
      errors.push(`${lineLabel}.description is required.`);
    }
    if (!Number.isFinite(line.lineAmountTxn) || line.lineAmountTxn <= 0) {
      errors.push(`${lineLabel}.lineAmountTxn must be > 0.`);
    }
    if (!Number.isFinite(line.lineAmountBase) || line.lineAmountBase <= 0) {
      errors.push(`${lineLabel}.lineAmountBase must be > 0.`);
    }
    if (!RECOGNITION_METHODS.includes(line.recognitionMethod)) {
      errors.push(`${lineLabel}.recognitionMethod is invalid.`);
    }
    if (!CONTRACT_LINE_STATUSES.includes(line.status)) {
      errors.push(`${lineLabel}.status is invalid.`);
    }
    if (line.recognitionMethod === "STRAIGHT_LINE") {
      if (!line.recognitionStartDate || !line.recognitionEndDate) {
        errors.push(
          `${lineLabel}.recognitionStartDate and ${lineLabel}.recognitionEndDate are required for STRAIGHT_LINE.`
        );
      }
    } else {
      const hasStart = Boolean(line.recognitionStartDate);
      const hasEnd = Boolean(line.recognitionEndDate);
      if (hasStart !== hasEnd) {
        errors.push(
          `${lineLabel}.recognitionStartDate and ${lineLabel}.recognitionEndDate must both be provided or omitted.`
        );
      }
    }
    if (
      line.recognitionStartDate &&
      line.recognitionEndDate &&
      line.recognitionStartDate > line.recognitionEndDate
    ) {
      errors.push(
        `${lineLabel}.recognitionStartDate cannot be greater than ${lineLabel}.recognitionEndDate.`
      );
    }
  });

  return { payload, errors };
}

export function buildContractLinkPayload(form) {
  return {
    cariDocumentId: toPositiveInt(form?.cariDocumentId),
    linkType: toUpper(form?.linkType),
    linkedAmountTxn: toOptionalNumber(form?.linkedAmountTxn),
    linkedAmountBase: toOptionalNumber(form?.linkedAmountBase),
  };
}

export function validateContractLinkForm(form) {
  const payload = buildContractLinkPayload(form);
  const errors = [];

  if (!payload.cariDocumentId) {
    errors.push("cariDocumentId is required.");
  }
  if (!LINK_TYPES.includes(payload.linkType)) {
    errors.push("linkType is invalid.");
  }
  if (!Number.isFinite(payload.linkedAmountTxn) || payload.linkedAmountTxn <= 0) {
    errors.push("linkedAmountTxn must be > 0.");
  }
  if (!Number.isFinite(payload.linkedAmountBase) || payload.linkedAmountBase <= 0) {
    errors.push("linkedAmountBase must be > 0.");
  }

  return { payload, errors };
}

export function canTransitionContractStatus(status, action) {
  const normalizedStatus = toUpper(status);
  const fromStatuses = LIFECYCLE_FROM_STATUS[action];
  if (!fromStatuses) {
    return false;
  }
  return fromStatuses.has(normalizedStatus);
}

export function getLifecycleActionStates(status, gates = {}) {
  const normalizedStatus = toUpper(status);

  const activatePermission = Boolean(gates?.canActivateContract);
  const suspendPermission = Boolean(gates?.canSuspendContract);
  const closePermission = Boolean(gates?.canCloseContract);
  const cancelPermission = Boolean(gates?.canCancelContract);

  const activateAllowed = activatePermission && canTransitionContractStatus(normalizedStatus, "activate");
  const suspendAllowed = suspendPermission && canTransitionContractStatus(normalizedStatus, "suspend");
  const closeAllowed = closePermission && canTransitionContractStatus(normalizedStatus, "close");
  const cancelAllowed = cancelPermission && canTransitionContractStatus(normalizedStatus, "cancel");

  return {
    activate: {
      allowed: activateAllowed,
      reason: activatePermission ? null : "Missing permission: contract.activate",
    },
    suspend: {
      allowed: suspendAllowed,
      reason: suspendPermission ? null : "Missing permission: contract.suspend",
    },
    close: {
      allowed: closeAllowed,
      reason: closePermission ? null : "Missing permission: contract.close",
    },
    cancel: {
      allowed: cancelAllowed,
      reason: cancelPermission ? null : "Missing permission: contract.cancel",
    },
  };
}

