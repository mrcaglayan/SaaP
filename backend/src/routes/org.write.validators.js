import {
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";

function parseOptionalPositiveIntField(rawValue, fieldLabel) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  const parsed = parsePositiveInt(rawValue);
  if (!parsed) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }
  return parsed;
}

function normalizeOptionalUpperEnum(rawValue, allowedValues, fieldLabel) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  const normalized = String(rawValue).trim().toUpperCase();
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${fieldLabel} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function parseBooleanField(rawValue, fieldLabel, defaultValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    if (rawValue === 1) {
      return true;
    }
    if (rawValue === 0) {
      return false;
    }
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  throw badRequest(`${fieldLabel} must be a boolean`);
}

export function parseGroupCompanyUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, ["code", "name"]);
  const { code, name } = req.body;

  return {
    tenantId,
    code,
    name,
  };
}

/**
 * Parse and validate legal-entity upsert input, including optional lifecycle
 * status and default provisioning controls used by Organization Management.
 */
export function parseLegalEntityUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, [
    "groupCompanyId",
    "code",
    "name",
    "countryId",
    "functionalCurrencyCode",
  ]);

  const groupCompanyId = parsePositiveInt(req.body.groupCompanyId);
  const countryId = parsePositiveInt(req.body.countryId);
  if (!groupCompanyId || !countryId) {
    throw badRequest("groupCompanyId and countryId must be positive integers");
  }

  return {
    tenantId,
    groupCompanyId,
    countryId,
    code: req.body.code,
    name: req.body.name,
    taxId: req.body.taxId,
    functionalCurrencyCode: req.body.functionalCurrencyCode,
    isIntercompanyEnabled: req.body.isIntercompanyEnabled,
    intercompanyPartnerRequired: req.body.intercompanyPartnerRequired,
    status: normalizeOptionalUpperEnum(req.body.status, ["ACTIVE", "INACTIVE"], "status"),
    autoProvisionDefaults: req.body.autoProvisionDefaults,
    policyPackId: req.body.policyPackId,
    overwriteExistingCoaAccounts: req.body.overwriteExistingCoaAccounts,
    fiscalYear: req.body.fiscalYear,
    paymentTerms: req.body.paymentTerms,
  };
}

export function parseOperatingUnitUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  const { code, name, unitType = "BRANCH", hasSubledger = false } = req.body;

  return {
    tenantId,
    legalEntityId,
    code,
    name,
    unitType,
    hasSubledger,
    centralDueFromAccountId: parseOptionalPositiveIntField(
      req.body.centralDueFromAccountId,
      "centralDueFromAccountId"
    ),
    centralDueToAccountId: parseOptionalPositiveIntField(
      req.body.centralDueToAccountId,
      "centralDueToAccountId"
    ),
    ouDueFromCentralAccountId: parseOptionalPositiveIntField(
      req.body.ouDueFromCentralAccountId,
      "ouDueFromCentralAccountId"
    ),
    ouDueToCentralAccountId: parseOptionalPositiveIntField(
      req.body.ouDueToCentralAccountId,
      "ouDueToCentralAccountId"
    ),
  };
}

export function parseOperatingUnitCurrentAccountConfigUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  const dueFromParentAccountId = parsePositiveInt(req.body?.dueFromParentAccountId);
  const dueToParentAccountId = parsePositiveInt(req.body?.dueToParentAccountId);

  if (!legalEntityId || !dueFromParentAccountId || !dueToParentAccountId) {
    throw badRequest(
      "legalEntityId, dueFromParentAccountId, and dueToParentAccountId must be positive integers"
    );
  }
  if (dueFromParentAccountId === dueToParentAccountId) {
    throw badRequest(
      "dueToParentAccountId must be different from dueFromParentAccountId"
    );
  }

  return {
    tenantId,
    legalEntityId,
    dueFromParentAccountId,
    dueToParentAccountId,
    autoProvisionOnOperatingUnitCreate: parseBooleanField(
      req.body?.autoProvisionOnOperatingUnitCreate,
      "autoProvisionOnOperatingUnitCreate",
      true
    ),
  };
}

export function parseOperatingUnitCurrentAccountConfigApplyInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  return {
    tenantId,
    legalEntityId,
    operatingUnitId: parseOptionalPositiveIntField(
      req.body?.operatingUnitId,
      "operatingUnitId"
    ),
    repairMissingOnly: parseBooleanField(
      req.body?.repairMissingOnly,
      "repairMissingOnly",
      true
    ),
  };
}

export function parseFiscalCalendarUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, ["code", "name", "yearStartMonth", "yearStartDay"]);

  const yearStartMonth = parsePositiveInt(req.body.yearStartMonth);
  const yearStartDay = parsePositiveInt(req.body.yearStartDay);

  if (!yearStartMonth || yearStartMonth > 12) {
    throw badRequest("yearStartMonth must be between 1 and 12");
  }
  if (!yearStartDay || yearStartDay > 31) {
    throw badRequest("yearStartDay must be between 1 and 31");
  }

  const { code, name } = req.body;
  return {
    tenantId,
    code,
    name,
    yearStartMonth,
    yearStartDay,
  };
}

export function parseFiscalPeriodGenerateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, ["calendarId", "fiscalYear"]);

  const calendarId = parsePositiveInt(req.body.calendarId);
  const fiscalYear = parsePositiveInt(req.body.fiscalYear);
  if (!calendarId || !fiscalYear) {
    throw badRequest("calendarId and fiscalYear must be positive integers");
  }

  return {
    tenantId,
    calendarId,
    fiscalYear,
  };
}

export function parseShareholderJournalConfigUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  const capitalCreditParentAccountId = parsePositiveInt(
    req.body.capitalCreditParentAccountId
  );
  const commitmentDebitParentAccountId = parsePositiveInt(
    req.body.commitmentDebitParentAccountId
  );

  if (!legalEntityId || !capitalCreditParentAccountId || !commitmentDebitParentAccountId) {
    throw badRequest(
      "legalEntityId, capitalCreditParentAccountId, and commitmentDebitParentAccountId must be positive integers"
    );
  }
  if (capitalCreditParentAccountId === commitmentDebitParentAccountId) {
    throw badRequest(
      "commitmentDebitParentAccountId must be different from capitalCreditParentAccountId"
    );
  }

  return {
    tenantId,
    legalEntityId,
    capitalCreditParentAccountId,
    commitmentDebitParentAccountId,
  };
}

export function parseShareholderCommitmentBatchPreviewInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  return {
    tenantId,
    legalEntityId,
    shareholderIds: req.body?.shareholderIds,
    commitmentDate: req.body?.commitmentDate,
  };
}

export function parseShareholderCommitmentBatchExecuteInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  const userId = parsePositiveInt(req.user?.userId);
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  return {
    tenantId,
    legalEntityId,
    shareholderIds: req.body?.shareholderIds,
    commitmentDate: req.body?.commitmentDate,
    userId,
  };
}

export function parseShareholderAutoProvisionSubAccountsInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  const shareholderId = parsePositiveInt(req.body?.shareholderId);
  const shareholderCode = String(req.body?.shareholderCode || "")
    .trim()
    .toUpperCase();
  const shareholderName = String(req.body?.shareholderName || "").trim();
  if (!shareholderCode || !shareholderName) {
    throw badRequest("shareholderCode and shareholderName are required");
  }

  return {
    tenantId,
    legalEntityId,
    shareholderId,
    shareholderCode,
    shareholderName,
  };
}

export function parseShareholderUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }

  return {
    tenantId,
    legalEntityId,
    code: req.body.code,
    name: req.body.name,
    shareholderType: req.body.shareholderType,
    taxId: req.body.taxId,
    committedCapital: req.body.committedCapital,
    capitalSubAccountId: req.body.capitalSubAccountId,
    commitmentDebitSubAccountId: req.body.commitmentDebitSubAccountId,
    currencyCode: req.body.currencyCode,
    status: req.body.status,
    notes: req.body.notes,
    commitmentDate: req.body.commitmentDate,
    autoCommitmentJournal: req.body.autoCommitmentJournal,
  };
}

function parseShareholderCapitalFulfillmentBaseInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  const shareholderId = parsePositiveInt(req.body?.shareholderId);
  const operatingUnitId = parseOptionalPositiveIntField(
    req.body?.operatingUnitId,
    "operatingUnitId"
  );
  const destinationMode = normalizeOptionalUpperEnum(
    req.body?.destinationMode,
    ["BANK_ACCOUNT", "ASSET_GL", "CASH_REGISTER"],
    "destinationMode"
  );
  const bankAccountId = parseOptionalPositiveIntField(
    req.body?.bankAccountId,
    "bankAccountId"
  );
  const destinationAccountId = parseOptionalPositiveIntField(
    req.body?.destinationAccountId,
    "destinationAccountId"
  );
  const cashRegisterId = parseOptionalPositiveIntField(
    req.body?.cashRegisterId,
    "cashRegisterId"
  );
  const cashSessionId = parseOptionalPositiveIntField(
    req.body?.cashSessionId,
    "cashSessionId"
  );

  if (!legalEntityId || !shareholderId) {
    throw badRequest("legalEntityId and shareholderId must be positive integers");
  }
  if (!destinationMode) {
    throw badRequest("destinationMode is required");
  }
  if (req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === "") {
    throw badRequest("amount is required");
  }
  if (!req.body?.contributionDate) {
    throw badRequest("contributionDate is required");
  }
  if (destinationMode === "BANK_ACCOUNT") {
    if (!bankAccountId || destinationAccountId || cashRegisterId || cashSessionId) {
      throw badRequest(
        "BANK_ACCOUNT mode requires bankAccountId and does not allow destinationAccountId, cashRegisterId, or cashSessionId"
      );
    }
  }
  if (destinationMode === "ASSET_GL") {
    if (!destinationAccountId || bankAccountId || cashRegisterId || cashSessionId) {
      throw badRequest(
        "ASSET_GL mode requires destinationAccountId and does not allow bankAccountId, cashRegisterId, or cashSessionId"
      );
    }
  }
  if (destinationMode === "CASH_REGISTER") {
    if (!cashRegisterId || bankAccountId || destinationAccountId) {
      throw badRequest(
        "CASH_REGISTER mode requires cashRegisterId and does not allow bankAccountId or destinationAccountId"
      );
    }
  }

  return {
    tenantId,
    legalEntityId,
    shareholderId,
    operatingUnitId,
    destinationMode,
    bankAccountId,
    destinationAccountId,
    cashRegisterId,
    cashSessionId,
    amount: req.body.amount,
    contributionDate: req.body.contributionDate,
    note: req.body.note,
  };
}

export function parseOperatingUnitPartnerCurrentAccountUpsertInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, [
    "legalEntityId",
    "operatingUnitId",
    "partnerOperatingUnitId",
    "dueFromAccountId",
    "dueToAccountId",
  ]);

  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  const operatingUnitId = parsePositiveInt(req.body.operatingUnitId);
  const partnerOperatingUnitId = parsePositiveInt(req.body.partnerOperatingUnitId);
  const dueFromAccountId = parsePositiveInt(req.body.dueFromAccountId);
  const dueToAccountId = parsePositiveInt(req.body.dueToAccountId);

  if (
    !legalEntityId ||
    !operatingUnitId ||
    !partnerOperatingUnitId ||
    !dueFromAccountId ||
    !dueToAccountId
  ) {
    throw badRequest(
      "legalEntityId, operatingUnitId, partnerOperatingUnitId, dueFromAccountId, and dueToAccountId must be positive integers"
    );
  }

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    partnerOperatingUnitId,
    dueFromAccountId,
    dueToAccountId,
  };
}

export function parseOperatingUnitPartnerCurrentAccountAutoProvisionInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, [
    "legalEntityId",
    "operatingUnitId",
    "partnerOperatingUnitId",
    "dueFromParentAccountId",
    "dueToParentAccountId",
  ]);

  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  const operatingUnitId = parsePositiveInt(req.body.operatingUnitId);
  const partnerOperatingUnitId = parsePositiveInt(req.body.partnerOperatingUnitId);
  const dueFromParentAccountId = parsePositiveInt(req.body.dueFromParentAccountId);
  const dueToParentAccountId = parsePositiveInt(req.body.dueToParentAccountId);

  if (
    !legalEntityId ||
    !operatingUnitId ||
    !partnerOperatingUnitId ||
    !dueFromParentAccountId ||
    !dueToParentAccountId
  ) {
    throw badRequest(
      "legalEntityId, operatingUnitId, partnerOperatingUnitId, dueFromParentAccountId, and dueToParentAccountId must be positive integers"
    );
  }

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    partnerOperatingUnitId,
    dueFromParentAccountId,
    dueToParentAccountId,
  };
}

export function parseOperatingUnitCentralCurrentAccountAutoProvisionInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  assertRequiredFields(req.body, [
    "legalEntityId",
    "operatingUnitId",
    "centralDueFromParentAccountId",
    "ouDueToCentralParentAccountId",
  ]);

  const legalEntityId = parsePositiveInt(req.body.legalEntityId);
  const operatingUnitId = parsePositiveInt(req.body.operatingUnitId);
  const centralDueFromParentAccountId = parsePositiveInt(
    req.body.centralDueFromParentAccountId
  );
  const ouDueToCentralParentAccountId = parsePositiveInt(
    req.body.ouDueToCentralParentAccountId
  );

  if (
    !legalEntityId ||
    !operatingUnitId ||
    !centralDueFromParentAccountId ||
    !ouDueToCentralParentAccountId
  ) {
    throw badRequest(
      "legalEntityId, operatingUnitId, centralDueFromParentAccountId, and ouDueToCentralParentAccountId must be positive integers"
    );
  }

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    centralDueFromParentAccountId,
    ouDueToCentralParentAccountId,
  };
}

export function parseShareholderCapitalFulfillmentPreviewInput(req) {
  return parseShareholderCapitalFulfillmentBaseInput(req);
}

export function parseShareholderCapitalFulfillmentCreateInput(req) {
  const userId = parsePositiveInt(req.user?.userId);
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  return {
    ...parseShareholderCapitalFulfillmentBaseInput(req),
    userId,
  };
}

export function parseShareholderCapitalFulfillmentListFilters(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  return {
    tenantId,
    legalEntityId: parseOptionalPositiveIntField(req.query?.legalEntityId, "legalEntityId"),
    shareholderId: parseOptionalPositiveIntField(req.query?.shareholderId, "shareholderId"),
    operatingUnitId: parseOptionalPositiveIntField(req.query?.operatingUnitId, "operatingUnitId"),
    status: normalizeOptionalUpperEnum(req.query?.status, ["POSTED", "REVERSED"], "status"),
  };
}

export function parseShareholderCapitalFulfillmentReverseInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const fulfillmentId = parsePositiveInt(req.params?.id);
  if (!fulfillmentId) {
    throw badRequest("id must be a positive integer");
  }
  const userId = parsePositiveInt(req.user?.userId);
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  return {
    tenantId,
    fulfillmentId,
    userId,
    reason: req.body?.reason,
  };
}
