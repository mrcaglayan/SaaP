import { withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { assertOperatingUnitBelongsToTenant } from "../tenantGuards.js";
import {
  findGroupCompanyByCode,
  findShareholderJournalConfigRowTx,
  upsertFiscalCalendarRow,
  upsertFiscalPeriodRow,
  upsertGroupCompanyRow,
  upsertJournalPurposeAccountTx,
  upsertLegalEntityRowTx,
  updateOperatingUnitInternalCurrentAccountsRow,
  upsertOperatingUnitPartnerCurrentAccountRow,
  upsertOperatingUnitRow,
} from "./org.write.queries.js";

const PAYMENT_TERM_STATUS_VALUES = new Set(["ACTIVE", "INACTIVE"]);
const DEFAULT_PAYMENT_TERM_TEMPLATES = [
  {
    code: "DUE_ON_RECEIPT",
    name: "Due on Receipt",
    dueDays: 0,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_15",
    name: "Net 15",
    dueDays: 15,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_30",
    name: "Net 30",
    dueDays: 30,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_45",
    name: "Net 45",
    dueDays: 45,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_60",
    name: "Net 60",
    dueDays: 60,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
];

function normalizeCode(rawValue, fallback = "DEFAULT", maxLength = 50) {
  const normalized = String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safe = normalized || fallback;
  return safe.slice(0, maxLength);
}

function normalizeName(rawValue, fallback = "Default Name", maxLength = 255) {
  const normalized = String(rawValue || "").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function parseNonNegativeInt(value, fieldName, defaultValue = 0) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function parseBooleanFlag(value, fallback = false, fieldName = "value") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1") {
    return true;
  }
  if (value === 0 || value === "0") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw badRequest(`${fieldName} must be a boolean`);
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getIndefiniteArticle(value) {
  return /^[AEIOU]/i.test(String(value || "").trim()) ? "an" : "a";
}

async function assertOperatingUnitInternalCurrentAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    accountId,
    fieldLabel,
    expectedAccountType,
    expectedNormalSide,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  const result = await tx.query(
    `SELECT
       a.id,
       a.parent_account_id,
       a.code,
       a.name,
       a.account_type,
       a.normal_side,
       a.allow_posting,
       a.is_active,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
       ) AS has_children
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [normalizedAccountId, tenantId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }
  if (normalizeUpperText(row.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${fieldLabel} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${fieldLabel} must belong to selected legalEntityId`);
  }
  if (!parseDbBoolean(row.is_active)) {
    throw badRequest(`${fieldLabel} must reference an active account`);
  }
  if (!parseDbBoolean(row.allow_posting)) {
    throw badRequest(`${fieldLabel} must reference a postable account`);
  }
  if (parseDbBoolean(row.has_children)) {
    throw badRequest(`${fieldLabel} must reference a leaf account`);
  }
  if (normalizeUpperText(row.account_type) !== normalizeUpperText(expectedAccountType)) {
    throw badRequest(
      `${fieldLabel} must reference ${getIndefiniteArticle(
        expectedAccountType
      )} ${normalizeUpperText(expectedAccountType)} account`
    );
  }
  if (normalizeUpperText(row.normal_side) !== normalizeUpperText(expectedNormalSide)) {
    throw badRequest(
      `${fieldLabel} must reference a ${normalizeUpperText(expectedNormalSide)} normal-side account`
    );
  }

  return {
    id: normalizedAccountId,
    parentAccountId: parsePositiveInt(row.parent_account_id),
    code: String(row.code || ""),
    name: String(row.name || ""),
  };
}

async function assertUniqueOperatingUnitInternalCurrentMappingTx(
  tx,
  {
    tenantId,
    legalEntityId,
    code,
    accountId,
    fieldLabel,
    columnName,
    roleLabel,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return;
  }

  const result = await tx.query(
    `SELECT id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND ${columnName} = ?
       AND code <> ?
     LIMIT 1`,
    [tenantId, legalEntityId, normalizedAccountId, String(code || "").trim()]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return;
  }

  const conflictingCode = String(row.code || "").trim();
  const conflictingName = String(row.name || "").trim();
  const conflictingLabel =
    conflictingCode && conflictingName
      ? `${conflictingCode} - ${conflictingName}`
      : conflictingCode || conflictingName || `#${parsePositiveInt(row.id)}`;

  throw badRequest(
    `${fieldLabel} is already assigned to operating unit ${conflictingLabel}. ${roleLabel} must be unique per operating unit within the legal entity; configure a branch-specific internal current account.`
  );
}

async function assertUniqueOperatingUnitPartnerCurrentAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    operatingUnitId,
    partnerOperatingUnitId,
    accountId,
    fieldLabel,
    columnName,
    roleLabel,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return;
  }

  const result = await tx.query(
    `SELECT
       map.id,
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       partner.code AS partner_operating_unit_code
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou ON ou.id = map.operating_unit_id
     JOIN operating_units partner ON partner.id = map.partner_operating_unit_id
     WHERE map.tenant_id = ?
       AND map.legal_entity_id = ?
       AND map.${columnName} = ?
       AND NOT (
         map.operating_unit_id = ?
         AND map.partner_operating_unit_id = ?
       )
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      normalizedAccountId,
      operatingUnitId,
      partnerOperatingUnitId,
    ]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return;
  }

  const sourceLabel =
    String(row.operating_unit_code || "").trim() || `#${parsePositiveInt(row.operating_unit_id)}`;
  const partnerLabel =
    String(row.partner_operating_unit_code || "").trim() ||
    `#${parsePositiveInt(row.partner_operating_unit_id)}`;

  throw badRequest(
    `${fieldLabel} is already assigned to operating unit pair ${sourceLabel} -> ${partnerLabel}. ${roleLabel} must be unique per branch pair within the legal entity; configure a partner-specific current account.`
  );
}

function normalizePaymentTermTemplate(rawTerm, index) {
  const term = rawTerm || {};
  const code = normalizeCode(term.code, `TERM_${index + 1}`, 50);
  const name = normalizeName(term.name, `Payment Term ${index + 1}`, 255);
  const dueDays = parseNonNegativeInt(
    term.dueDays ?? term.due_days,
    `paymentTerms[${index}].dueDays`,
    0
  );
  const graceDays = parseNonNegativeInt(
    term.graceDays ?? term.grace_days,
    `paymentTerms[${index}].graceDays`,
    0
  );
  const isEndOfMonth = parseBooleanFlag(
    term.isEndOfMonth ?? term.is_end_of_month,
    false,
    `paymentTerms[${index}].isEndOfMonth`
  );
  const status = String(term.status || "ACTIVE")
    .trim()
    .toUpperCase();
  if (!PAYMENT_TERM_STATUS_VALUES.has(status)) {
    throw badRequest(`paymentTerms[${index}].status must be ACTIVE or INACTIVE`);
  }

  return {
    code,
    name,
    dueDays,
    graceDays,
    isEndOfMonth,
    status,
  };
}

function resolvePaymentTermTemplates(rawTerms) {
  if (rawTerms !== undefined && !Array.isArray(rawTerms)) {
    throw badRequest("paymentTerms must be an array when provided");
  }
  if (Array.isArray(rawTerms) && rawTerms.length === 0) {
    throw badRequest("paymentTerms must be a non-empty array when provided");
  }

  const defaultsUsed = !Array.isArray(rawTerms) || rawTerms.length === 0;
  const sourceTemplates = defaultsUsed ? DEFAULT_PAYMENT_TERM_TEMPLATES : rawTerms;
  const termTemplates = sourceTemplates.map((term, index) =>
    normalizePaymentTermTemplate(term, index)
  );

  const seenCodes = new Set();
  for (const term of termTemplates) {
    const codeKey = String(term.code || "").toUpperCase();
    if (seenCodes.has(codeKey)) {
      throw badRequest(`Duplicate payment term code: ${term.code}`);
    }
    seenCodes.add(codeKey);
  }

  return {
    defaultsUsed,
    termTemplates,
  };
}

async function bootstrapPaymentTermsForLegalEntity({
  tx,
  tenantId,
  legalEntityId,
  termTemplates,
}) {
  let createdCount = 0;
  let skippedCount = 0;

  for (const term of termTemplates) {
    // eslint-disable-next-line no-await-in-loop
    const insertResult = await tx.query(
      `INSERT IGNORE INTO payment_terms (
          tenant_id,
          legal_entity_id,
          code,
          name,
          due_days,
          grace_days,
          is_end_of_month,
          status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        term.code,
        term.name,
        term.dueDays,
        term.graceDays,
        term.isEndOfMonth ? 1 : 0,
        term.status,
      ]
    );

    const affectedRows = Number(insertResult.rows?.affectedRows || 0);
    if (affectedRows > 0) {
      createdCount += affectedRows;
    } else {
      skippedCount += 1;
    }
  }

  return {
    createdCount,
    skippedCount,
    templateCount: termTemplates.length,
  };
}

export async function upsertGroupCompany({
  req,
  tenantId,
  code,
  name,
  assertScopeAccess,
  getScopeContext,
}) {
  const normalizedCode = String(code).trim();
  const normalizedName = String(name).trim();

  const existing = await findGroupCompanyByCode({
    tenantId,
    code: normalizedCode,
  });
  const existingId = parsePositiveInt(existing?.id);

  if (existingId) {
    assertScopeAccess(req, "group", existingId, "groupCompanyId");
  } else if (!getScopeContext(req)?.tenantWide) {
    throw badRequest("Creating a new group company requires tenant-wide data scope");
  }

  const insertId = await upsertGroupCompanyRow({
    tenantId,
    code: normalizedCode,
    name: normalizedName,
  });

  return {
    id: insertId || existingId || null,
    tenantId,
    code,
    name,
  };
}

export async function upsertLegalEntity({
  req,
  tenantId,
  groupCompanyId,
  countryId,
  code,
  name,
  taxId,
  functionalCurrencyCode,
  isIntercompanyEnabled,
  intercompanyPartnerRequired,
  autoProvisionDefaults,
  fiscalYear,
  paymentTerms,
  parseBooleanValue,
  assertGroupCompanyBelongsToTenant,
  assertCountryExists,
  assertCurrencyExists,
  assertScopeAccess,
  resolveLegalEntityByCode,
  autoProvisionLegalEntityGl,
}) {
  await assertGroupCompanyBelongsToTenant(tenantId, groupCompanyId, "groupCompanyId");
  await assertCountryExists(countryId, "countryId");

  assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
  assertScopeAccess(req, "country", countryId, "countryId");

  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim();
  if (!normalizedCode || !normalizedName) {
    throw badRequest("code and name are required");
  }

  const normalizedFunctionalCurrencyCode = String(functionalCurrencyCode || "")
    .trim()
    .toUpperCase();
  await assertCurrencyExists(normalizedFunctionalCurrencyCode, "functionalCurrencyCode");

  const finalIntercompanyEnabled =
    isIntercompanyEnabled === undefined ? true : Boolean(isIntercompanyEnabled);
  const finalPartnerRequired = Boolean(intercompanyPartnerRequired);
  const finalAutoProvisionDefaults = parseBooleanValue(autoProvisionDefaults, false);
  const finalFiscalYear = parsePositiveInt(fiscalYear) || new Date().getUTCFullYear();
  const shouldProvisionPaymentTerms =
    finalAutoProvisionDefaults || paymentTerms !== undefined;

  const operationResult = await withTransaction(async (tx) => {
    const insertId = await upsertLegalEntityRowTx(tx, {
      tenantId,
      groupCompanyId,
      code: normalizedCode,
      name: normalizedName,
      taxId: taxId ? String(taxId).trim() : null,
      countryId,
      functionalCurrencyCode: normalizedFunctionalCurrencyCode,
      isIntercompanyEnabled: finalIntercompanyEnabled,
      intercompanyPartnerRequired: finalPartnerRequired,
    });

    const legalEntity = await resolveLegalEntityByCode(tx, tenantId, normalizedCode);
    let provisioning = null;
    if (finalAutoProvisionDefaults) {
      provisioning = await autoProvisionLegalEntityGl(
        tx,
        tenantId,
        legalEntity,
        finalFiscalYear
      );
    }
    let paymentTermsProvisioning = null;
    if (shouldProvisionPaymentTerms) {
      const paymentTermTemplates = resolvePaymentTermTemplates(paymentTerms);
      const seededTerms = await bootstrapPaymentTermsForLegalEntity({
        tx,
        tenantId,
        legalEntityId: legalEntity.id,
        termTemplates: paymentTermTemplates.termTemplates,
      });
      paymentTermsProvisioning = {
        defaultsUsed: paymentTermTemplates.defaultsUsed,
        ...seededTerms,
      };
    }

    return {
      legalEntity,
      provisioning,
      paymentTermsProvisioning,
      insertId,
    };
  });

  return {
    id: operationResult.insertId || operationResult.legalEntity.id,
    legalEntityId: operationResult.legalEntity.id,
    autoProvisionDefaults: finalAutoProvisionDefaults,
    fiscalYear: finalFiscalYear,
    provisioning: operationResult.provisioning,
    paymentTermsProvisioning: operationResult.paymentTermsProvisioning,
  };
}

export async function upsertOperatingUnit({
  req,
  tenantId,
  legalEntityId,
  code,
  name,
  unitType,
  hasSubledger,
  centralDueFromAccountId,
  centralDueToAccountId,
  ouDueFromCentralAccountId,
  ouDueToCentralAccountId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  if (
    parsePositiveInt(centralDueFromAccountId) &&
    parsePositiveInt(centralDueFromAccountId) === parsePositiveInt(ouDueToCentralAccountId)
  ) {
    throw badRequest(
      "ouDueToCentralAccountId must be different from centralDueFromAccountId"
    );
  }
  if (
    parsePositiveInt(centralDueToAccountId) &&
    parsePositiveInt(centralDueToAccountId) === parsePositiveInt(ouDueFromCentralAccountId)
  ) {
    throw badRequest(
      "ouDueFromCentralAccountId must be different from centralDueToAccountId"
    );
  }

  const id = await withTransaction(async (tx) => {
    const fieldSpecs = [
      {
        accountId: centralDueFromAccountId,
        fieldLabel: "centralDueFromAccountId",
        columnName: "central_due_from_account_id",
        roleLabel: "Central Due From OU account mapping",
        expectedAccountType: "ASSET",
        expectedNormalSide: "DEBIT",
      },
      {
        accountId: centralDueToAccountId,
        fieldLabel: "centralDueToAccountId",
        columnName: "central_due_to_account_id",
        roleLabel: "Central Due To OU account mapping",
        expectedAccountType: "LIABILITY",
        expectedNormalSide: "CREDIT",
      },
      {
        accountId: ouDueFromCentralAccountId,
        fieldLabel: "ouDueFromCentralAccountId",
        columnName: "ou_due_from_central_account_id",
        roleLabel: "OU Due From Central account mapping",
        expectedAccountType: "ASSET",
        expectedNormalSide: "DEBIT",
      },
      {
        accountId: ouDueToCentralAccountId,
        fieldLabel: "ouDueToCentralAccountId",
        columnName: "ou_due_to_central_account_id",
        roleLabel: "OU Due To Central account mapping",
        expectedAccountType: "LIABILITY",
        expectedNormalSide: "CREDIT",
      },
    ];

    for (const spec of fieldSpecs) {
      // eslint-disable-next-line no-await-in-loop
      await assertOperatingUnitInternalCurrentAccountTx(tx, {
        tenantId,
        legalEntityId,
        accountId: spec.accountId,
        fieldLabel: spec.fieldLabel,
        expectedAccountType: spec.expectedAccountType,
        expectedNormalSide: spec.expectedNormalSide,
      });
    }
    for (const spec of fieldSpecs) {
      // eslint-disable-next-line no-await-in-loop
      await assertUniqueOperatingUnitInternalCurrentMappingTx(tx, {
        tenantId,
        legalEntityId,
        code,
        accountId: spec.accountId,
        fieldLabel: spec.fieldLabel,
        columnName: spec.columnName,
        roleLabel: spec.roleLabel,
      });
    }

    return upsertOperatingUnitRow({
      tenantId,
      legalEntityId,
      code: String(code).trim(),
      name: String(name).trim(),
      unitType: String(unitType).toUpperCase(),
      hasSubledger: Boolean(hasSubledger),
      centralDueFromAccountId: parsePositiveInt(centralDueFromAccountId),
      centralDueToAccountId: parsePositiveInt(centralDueToAccountId),
      ouDueFromCentralAccountId: parsePositiveInt(ouDueFromCentralAccountId),
      ouDueToCentralAccountId: parsePositiveInt(ouDueToCentralAccountId),
      runQuery: (sql, params) => tx.query(sql, params),
    });
  });

  return {
    id,
  };
}

export async function upsertOperatingUnitPartnerCurrentAccount({
  req,
  tenantId,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromAccountId,
  dueToAccountId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  assertScopeAccess(req, "operating_unit", partnerOperatingUnitId, "partnerOperatingUnitId");

  if (parsePositiveInt(operatingUnitId) === parsePositiveInt(partnerOperatingUnitId)) {
    throw badRequest("partnerOperatingUnitId must be different from operatingUnitId");
  }
  if (parsePositiveInt(dueFromAccountId) === parsePositiveInt(dueToAccountId)) {
    throw badRequest("dueToAccountId must be different from dueFromAccountId");
  }

  const id = await withTransaction(async (tx) => {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      operatingUnitId,
      "operatingUnitId"
    );
    const partnerOperatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      partnerOperatingUnitId,
      "partnerOperatingUnitId"
    );

    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
      throw badRequest("operatingUnitId must belong to selected legalEntityId");
    }
    if (
      parsePositiveInt(partnerOperatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)
    ) {
      throw badRequest("partnerOperatingUnitId must belong to selected legalEntityId");
    }

    await assertOperatingUnitInternalCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: dueFromAccountId,
      fieldLabel: "dueFromAccountId",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    await assertOperatingUnitInternalCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: dueToAccountId,
      fieldLabel: "dueToAccountId",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    await assertUniqueOperatingUnitPartnerCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      operatingUnitId: parsePositiveInt(operatingUnitId),
      partnerOperatingUnitId: parsePositiveInt(partnerOperatingUnitId),
      accountId: dueFromAccountId,
      fieldLabel: "dueFromAccountId",
      columnName: "due_from_account_id",
      roleLabel: "Due From Partner account mapping",
    });
    await assertUniqueOperatingUnitPartnerCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      operatingUnitId: parsePositiveInt(operatingUnitId),
      partnerOperatingUnitId: parsePositiveInt(partnerOperatingUnitId),
      accountId: dueToAccountId,
      fieldLabel: "dueToAccountId",
      columnName: "due_to_account_id",
      roleLabel: "Due To Partner account mapping",
    });

    return upsertOperatingUnitPartnerCurrentAccountRow({
      tenantId,
      legalEntityId,
      operatingUnitId: parsePositiveInt(operatingUnitId),
      partnerOperatingUnitId: parsePositiveInt(partnerOperatingUnitId),
      dueFromAccountId: parsePositiveInt(dueFromAccountId),
      dueToAccountId: parsePositiveInt(dueToAccountId),
      runQuery: (sql, params) => tx.query(sql, params),
    });
  });

  return {
    id,
  };
}

function normalizeAccountCode(rawValue) {
  return String(rawValue || "")
    .trim()
    .toUpperCase();
}

function parseChildCodeSequence(code, parentCode) {
  const normalizedCode = normalizeAccountCode(code);
  const normalizedParentCode = normalizeAccountCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }

  let suffix = "";
  if (normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(`${normalizedParentCode}-`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(normalizedParentCode)) {
    suffix = normalizedCode.slice(normalizedParentCode.length);
  } else {
    return null;
  }

  if (!/^\d+$/.test(suffix)) {
    return null;
  }

  const value = Number(suffix);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return {
    value,
    width: suffix.length,
  };
}

function buildChildAccountCode(parentCode, sequence, width) {
  return `${normalizeAccountCode(parentCode)}.${String(sequence).padStart(width, "0")}`;
}

function collectUsedChildSequences(childRows, parentAccountId, parentCode) {
  const usedSequences = new Set();
  let maxWidth = 2;
  for (const row of Array.isArray(childRows) ? childRows : []) {
    if (parsePositiveInt(row?.parent_account_id) !== parsePositiveInt(parentAccountId)) {
      continue;
    }
    const parsed = parseChildCodeSequence(row?.code, parentCode);
    if (!parsed) {
      continue;
    }
    usedSequences.add(parsed.value);
    maxWidth = Math.max(maxWidth, parsed.width);
  }
  return {
    usedSequences,
    width: maxWidth,
  };
}

function pickNextSharedChildSequence(assetUsage, liabilityUsage) {
  const width = Math.max(assetUsage?.width || 2, liabilityUsage?.width || 2, 2);
  const assetUsed = assetUsage?.usedSequences || new Set();
  const liabilityUsed = liabilityUsage?.usedSequences || new Set();

  for (let sequence = 1; sequence <= 999999; sequence += 1) {
    if (!assetUsed.has(sequence) && !liabilityUsed.has(sequence)) {
      return {
        sequence,
        width,
      };
    }
  }

  throw badRequest("No available child account code sequence under selected parent accounts");
}

function pickNextAvailableChildSequence(usage, preferredSequence = null, preferredWidth = 2) {
  const usedSequences = usage?.usedSequences || new Set();
  const width = Math.max(
    usage?.width || 2,
    preferredWidth || 2,
    Number.isInteger(preferredSequence) ? String(preferredSequence).length : 0,
    2
  );

  if (
    Number.isInteger(preferredSequence) &&
    preferredSequence > 0 &&
    !usedSequences.has(preferredSequence)
  ) {
    return {
      sequence: preferredSequence,
      width,
    };
  }

  for (let sequence = 1; sequence <= 999999; sequence += 1) {
    if (!usedSequences.has(sequence)) {
      return {
        sequence,
        width,
      };
    }
  }

  throw badRequest("No available child account code sequence under selected parent account");
}

function buildOperatingUnitLabel(unit) {
  const code = String(unit?.code || "").trim();
  const name = String(unit?.name || "").trim();
  return code || name || `OU ${parsePositiveInt(unit?.id) || "-"}`;
}

function buildPartnerCurrentAccountName({
  operatingUnit,
  partnerOperatingUnit,
  role,
}) {
  const sourceLabel = buildOperatingUnitLabel(operatingUnit);
  const partnerLabel = buildOperatingUnitLabel(partnerOperatingUnit);
  if (role === "DUE_FROM") {
    return normalizeName(`${sourceLabel} Due From ${partnerLabel}`, "Due From Partner");
  }
  return normalizeName(`${sourceLabel} Due To ${partnerLabel}`, "Due To Partner");
}

function buildCentralCurrentAccountName({
  operatingUnit,
  role,
}) {
  const operatingUnitLabel = buildOperatingUnitLabel(operatingUnit);
  if (role === "CENTRAL_DUE_FROM") {
    return normalizeName(
      `Central Due From ${operatingUnitLabel}`,
      "Central Due From OU"
    );
  }
  return normalizeName(`${operatingUnitLabel} Due To Central`, "OU Due To Central");
}

async function assertOperatingUnitInternalCurrentParentAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    accountId,
    fieldLabel,
    expectedAccountType,
    expectedNormalSide,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }

  const result = await tx.query(
    `SELECT
       a.id,
       a.coa_id,
       a.code,
       a.name,
       a.account_type,
       a.normal_side,
       a.allow_posting,
       a.is_active,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1
     FOR UPDATE`,
    [normalizedAccountId, tenantId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }
  if (normalizeUpperText(row.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${fieldLabel} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${fieldLabel} must belong to selected legalEntityId`);
  }
  if (!parseDbBoolean(row.is_active)) {
    throw badRequest(`${fieldLabel} must reference an active account`);
  }
  if (normalizeUpperText(row.account_type) !== normalizeUpperText(expectedAccountType)) {
    throw badRequest(
      `${fieldLabel} must reference ${getIndefiniteArticle(
        expectedAccountType
      )} ${normalizeUpperText(expectedAccountType)} account`
    );
  }
  if (normalizeUpperText(row.normal_side) !== normalizeUpperText(expectedNormalSide)) {
    throw badRequest(
      `${fieldLabel} must reference a ${normalizeUpperText(expectedNormalSide)} normal-side account`
    );
  }

  return {
    id: normalizedAccountId,
    coaId: parsePositiveInt(row.coa_id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    accountType: normalizeUpperText(row.account_type),
    normalSide: normalizeUpperText(row.normal_side),
  };
}

async function loadOperatingUnitIdentityTx(
  tx,
  {
    tenantId,
    operatingUnitId,
    fieldLabel,
  }
) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!normalizedOperatingUnitId) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }

  const result = await tx.query(
    `SELECT
       id,
       legal_entity_id,
       code,
       name,
       unit_type,
       has_subledger,
       status,
       central_due_from_account_id,
       central_due_to_account_id,
       ou_due_from_central_account_id,
       ou_due_to_central_account_id
     FROM operating_units
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1
     FOR UPDATE`,
    [normalizedOperatingUnitId, parsePositiveInt(tenantId)]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }

  return {
    id: normalizedOperatingUnitId,
    legal_entity_id: parsePositiveInt(row.legal_entity_id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    unit_type: String(row.unit_type || ""),
    has_subledger: parseDbBoolean(row.has_subledger),
    status: String(row.status || ""),
    central_due_from_account_id: parsePositiveInt(row.central_due_from_account_id),
    central_due_to_account_id: parsePositiveInt(row.central_due_to_account_id),
    ou_due_from_central_account_id: parsePositiveInt(row.ou_due_from_central_account_id),
    ou_due_to_central_account_id: parsePositiveInt(row.ou_due_to_central_account_id),
  };
}

function parsePreferredChildSequenceFromExistingAccount(account) {
  if (!parsePositiveInt(account?.parentAccountId)) {
    return null;
  }
  const normalizedCode = normalizeAccountCode(account?.code);
  const match = normalizedCode.match(/[.-](\d+)$/);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return {
    sequence: value,
    width: match[1].length,
  };
}

async function resolveReusableOperatingUnitCurrentAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    accountId,
    fieldLabel,
    expectedAccountType,
    expectedNormalSide,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  try {
    return await assertOperatingUnitInternalCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: normalizedAccountId,
      fieldLabel,
      expectedAccountType,
      expectedNormalSide,
    });
  } catch {
    return null;
  }
}

async function insertOperatingUnitCurrentChildAccountTx(
  tx,
  {
    parentAccount,
    code,
    name,
    accountType,
    normalSide,
  }
) {
  await tx.query(
    `INSERT INTO accounts (
       coa_id,
       code,
       name,
       account_type,
       normal_side,
       allow_posting,
       parent_account_id
     )
     VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
    [
      parsePositiveInt(parentAccount.coaId),
      normalizeAccountCode(code),
      normalizeName(name, "Operating Unit Current Account"),
      normalizeUpperText(accountType),
      normalizeUpperText(normalSide),
      parsePositiveInt(parentAccount.id),
    ]
  );

  const result = await tx.query(
    `SELECT id, code, name
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [parsePositiveInt(parentAccount.coaId), normalizeAccountCode(code)]
  );
  const row = result.rows?.[0] || null;
  const accountId = parsePositiveInt(row?.id);
  if (!accountId) {
    throw badRequest(`Failed to create child account ${code}`);
  }

  await tx.query(
    `UPDATE accounts
     SET allow_posting = FALSE
     WHERE id = ?
       AND allow_posting = TRUE`,
    [parsePositiveInt(parentAccount.id)]
  );

  return {
    id: accountId,
    code: String(row.code || code),
    name: String(row.name || name),
  };
}

export async function autoProvisionOperatingUnitCentralCurrentAccounts({
  req,
  tenantId,
  legalEntityId,
  operatingUnitId,
  centralDueFromParentAccountId,
  ouDueToCentralParentAccountId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");

  if (
    parsePositiveInt(centralDueFromParentAccountId) ===
    parsePositiveInt(ouDueToCentralParentAccountId)
  ) {
    throw badRequest(
      "ouDueToCentralParentAccountId must be different from centralDueFromParentAccountId"
    );
  }

  return withTransaction(async (tx) => {
    const operatingUnit = await loadOperatingUnitIdentityTx(tx, {
      tenantId,
      operatingUnitId,
      fieldLabel: "operatingUnitId",
    });
    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
      throw badRequest("operatingUnitId must belong to selected legalEntityId");
    }

    const centralDueFromParentAccount =
      await assertOperatingUnitInternalCurrentParentAccountTx(tx, {
        tenantId,
        legalEntityId,
        accountId: centralDueFromParentAccountId,
        fieldLabel: "centralDueFromParentAccountId",
        expectedAccountType: "ASSET",
        expectedNormalSide: "DEBIT",
      });
    const ouDueToCentralParentAccount =
      await assertOperatingUnitInternalCurrentParentAccountTx(tx, {
        tenantId,
        legalEntityId,
        accountId: ouDueToCentralParentAccountId,
        fieldLabel: "ouDueToCentralParentAccountId",
        expectedAccountType: "LIABILITY",
        expectedNormalSide: "CREDIT",
      });

    let centralDueFromAccount = await resolveReusableOperatingUnitCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: operatingUnit.central_due_from_account_id,
      fieldLabel: "centralDueFromAccountId",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    let ouDueToCentralAccount = await resolveReusableOperatingUnitCurrentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: operatingUnit.ou_due_to_central_account_id,
      fieldLabel: "ouDueToCentralAccountId",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });

    const childRowsResult = await tx.query(
      `SELECT id, code, parent_account_id
       FROM accounts
       WHERE parent_account_id IN (?, ?)
       FOR UPDATE`,
      [
        parsePositiveInt(centralDueFromParentAccount.id),
        parsePositiveInt(ouDueToCentralParentAccount.id),
      ]
    );
    const childRows = childRowsResult.rows || [];
    const centralDueFromUsage = collectUsedChildSequences(
      childRows,
      centralDueFromParentAccount.id,
      centralDueFromParentAccount.code
    );
    const ouDueToUsage = collectUsedChildSequences(
      childRows,
      ouDueToCentralParentAccount.id,
      ouDueToCentralParentAccount.code
    );
    const createdAccounts = [];

    if (!centralDueFromAccount && !ouDueToCentralAccount) {
      const allocation = pickNextSharedChildSequence(
        centralDueFromUsage,
        ouDueToUsage
      );
      centralDueFromUsage.usedSequences.add(allocation.sequence);
      ouDueToUsage.usedSequences.add(allocation.sequence);

      centralDueFromAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
        parentAccount: centralDueFromParentAccount,
        code: buildChildAccountCode(
          centralDueFromParentAccount.code,
          allocation.sequence,
          allocation.width
        ),
        name: buildCentralCurrentAccountName({
          operatingUnit,
          role: "CENTRAL_DUE_FROM",
        }),
        accountType: "ASSET",
        normalSide: "DEBIT",
      });
      ouDueToCentralAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
        parentAccount: ouDueToCentralParentAccount,
        code: buildChildAccountCode(
          ouDueToCentralParentAccount.code,
          allocation.sequence,
          allocation.width
        ),
        name: buildCentralCurrentAccountName({
          operatingUnit,
          role: "OU_DUE_TO_CENTRAL",
        }),
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      });
      createdAccounts.push(
        {
          id: centralDueFromAccount.id,
          code: centralDueFromAccount.code,
          name: centralDueFromAccount.name,
          role: "CENTRAL_DUE_FROM",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        },
        {
          id: ouDueToCentralAccount.id,
          code: ouDueToCentralAccount.code,
          name: ouDueToCentralAccount.name,
          role: "OU_DUE_TO_CENTRAL",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        }
      );
    } else {
      if (!centralDueFromAccount) {
        const preferredSequence = parsePreferredChildSequenceFromExistingAccount(
          ouDueToCentralAccount
        );
        const allocation = pickNextAvailableChildSequence(
          centralDueFromUsage,
          preferredSequence?.sequence,
          preferredSequence?.width
        );
        centralDueFromUsage.usedSequences.add(allocation.sequence);
        centralDueFromAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
          parentAccount: centralDueFromParentAccount,
          code: buildChildAccountCode(
            centralDueFromParentAccount.code,
            allocation.sequence,
            allocation.width
          ),
          name: buildCentralCurrentAccountName({
            operatingUnit,
            role: "CENTRAL_DUE_FROM",
          }),
          accountType: "ASSET",
          normalSide: "DEBIT",
        });
        createdAccounts.push({
          id: centralDueFromAccount.id,
          code: centralDueFromAccount.code,
          name: centralDueFromAccount.name,
          role: "CENTRAL_DUE_FROM",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        });
      }

      if (!ouDueToCentralAccount) {
        const preferredSequence = parsePreferredChildSequenceFromExistingAccount(
          centralDueFromAccount
        );
        const allocation = pickNextAvailableChildSequence(
          ouDueToUsage,
          preferredSequence?.sequence,
          preferredSequence?.width
        );
        ouDueToUsage.usedSequences.add(allocation.sequence);
        ouDueToCentralAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
          parentAccount: ouDueToCentralParentAccount,
          code: buildChildAccountCode(
            ouDueToCentralParentAccount.code,
            allocation.sequence,
            allocation.width
          ),
          name: buildCentralCurrentAccountName({
            operatingUnit,
            role: "OU_DUE_TO_CENTRAL",
          }),
          accountType: "LIABILITY",
          normalSide: "CREDIT",
        });
        createdAccounts.push({
          id: ouDueToCentralAccount.id,
          code: ouDueToCentralAccount.code,
          name: ouDueToCentralAccount.name,
          role: "OU_DUE_TO_CENTRAL",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        });
      }
    }

    await assertUniqueOperatingUnitInternalCurrentMappingTx(tx, {
      tenantId,
      legalEntityId,
      code: operatingUnit.code,
      accountId: centralDueFromAccount.id,
      fieldLabel: "centralDueFromAccountId",
      columnName: "central_due_from_account_id",
      roleLabel: "Central Due From OU account mapping",
    });
    await assertUniqueOperatingUnitInternalCurrentMappingTx(tx, {
      tenantId,
      legalEntityId,
      code: operatingUnit.code,
      accountId: ouDueToCentralAccount.id,
      fieldLabel: "ouDueToCentralAccountId",
      columnName: "ou_due_to_central_account_id",
      roleLabel: "OU Due To Central account mapping",
    });

    await updateOperatingUnitInternalCurrentAccountsRow({
      tenantId,
      operatingUnitId: parsePositiveInt(operatingUnit.id),
      centralDueFromAccountId: centralDueFromAccount.id,
      ouDueToCentralAccountId: ouDueToCentralAccount.id,
      runQuery: (sql, params) => tx.query(sql, params),
    });

    return {
      legalEntityId: parsePositiveInt(legalEntityId),
      operatingUnitId: parsePositiveInt(operatingUnit.id),
      centralDueFromParentAccountId: parsePositiveInt(centralDueFromParentAccount.id),
      ouDueToCentralParentAccountId: parsePositiveInt(ouDueToCentralParentAccount.id),
      createdAccounts,
      operatingUnit: {
        id: parsePositiveInt(operatingUnit.id),
        code: String(operatingUnit.code || ""),
        name: String(operatingUnit.name || ""),
        centralDueFromAccountId: centralDueFromAccount.id,
        centralDueFromAccountCode: centralDueFromAccount.code,
        centralDueFromAccountName: centralDueFromAccount.name,
        ouDueToCentralAccountId: ouDueToCentralAccount.id,
        ouDueToCentralAccountCode: ouDueToCentralAccount.code,
        ouDueToCentralAccountName: ouDueToCentralAccount.name,
        capitalSelfBalancingReady: true,
      },
    };
  });
}

export async function autoProvisionOperatingUnitPartnerCurrentAccounts({
  req,
  tenantId,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromParentAccountId,
  dueToParentAccountId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  assertScopeAccess(req, "operating_unit", partnerOperatingUnitId, "partnerOperatingUnitId");

  if (parsePositiveInt(operatingUnitId) === parsePositiveInt(partnerOperatingUnitId)) {
    throw badRequest("partnerOperatingUnitId must be different from operatingUnitId");
  }
  if (parsePositiveInt(dueFromParentAccountId) === parsePositiveInt(dueToParentAccountId)) {
    throw badRequest(
      "dueToParentAccountId must be different from dueFromParentAccountId"
    );
  }

  return withTransaction(async (tx) => {
    const operatingUnit = await loadOperatingUnitIdentityTx(tx, {
      tenantId,
      operatingUnitId,
      fieldLabel: "operatingUnitId",
    });
    const partnerOperatingUnit = await loadOperatingUnitIdentityTx(tx, {
      tenantId,
      operatingUnitId: partnerOperatingUnitId,
      fieldLabel: "partnerOperatingUnitId",
    });

    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
      throw badRequest("operatingUnitId must belong to selected legalEntityId");
    }
    if (
      parsePositiveInt(partnerOperatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)
    ) {
      throw badRequest("partnerOperatingUnitId must belong to selected legalEntityId");
    }

    const dueFromParentAccount = await assertOperatingUnitInternalCurrentParentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: dueFromParentAccountId,
      fieldLabel: "dueFromParentAccountId",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    const dueToParentAccount = await assertOperatingUnitInternalCurrentParentAccountTx(tx, {
      tenantId,
      legalEntityId,
      accountId: dueToParentAccountId,
      fieldLabel: "dueToParentAccountId",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });

    const mappingResult = await tx.query(
      `SELECT
         map.id,
         map.operating_unit_id,
         map.partner_operating_unit_id,
         map.due_from_account_id,
         dfa.code AS due_from_account_code,
         dfa.name AS due_from_account_name,
         map.due_to_account_id,
         dta.code AS due_to_account_code,
         dta.name AS due_to_account_name
       FROM operating_unit_partner_current_accounts map
       LEFT JOIN accounts dfa ON dfa.id = map.due_from_account_id
       LEFT JOIN accounts dta ON dta.id = map.due_to_account_id
       WHERE map.tenant_id = ?
         AND map.legal_entity_id = ?
         AND (
           (map.operating_unit_id = ? AND map.partner_operating_unit_id = ?)
           OR
           (map.operating_unit_id = ? AND map.partner_operating_unit_id = ?)
         )
       FOR UPDATE`,
      [
        tenantId,
        legalEntityId,
        parsePositiveInt(operatingUnitId),
        parsePositiveInt(partnerOperatingUnitId),
        parsePositiveInt(partnerOperatingUnitId),
        parsePositiveInt(operatingUnitId),
      ]
    );
    const existingMappingsByKey = new Map();
    for (const row of mappingResult.rows || []) {
      existingMappingsByKey.set(
        `${parsePositiveInt(row.operating_unit_id)}:${parsePositiveInt(
          row.partner_operating_unit_id
        )}`,
        row
      );
    }

    const childRowsResult = await tx.query(
      `SELECT id, code, parent_account_id
       FROM accounts
       WHERE parent_account_id IN (?, ?)
       FOR UPDATE`,
      [parsePositiveInt(dueFromParentAccount.id), parsePositiveInt(dueToParentAccount.id)]
    );
    const childRows = childRowsResult.rows || [];
    const dueFromUsage = collectUsedChildSequences(
      childRows,
      dueFromParentAccount.id,
      dueFromParentAccount.code
    );
    const dueToUsage = collectUsedChildSequences(
      childRows,
      dueToParentAccount.id,
      dueToParentAccount.code
    );
    const createdAccounts = [];
    const mappings = [];

    const ensureDirectionalMapping = async ({
      sourceOperatingUnit,
      targetOperatingUnit,
    }) => {
      const mappingKey = `${parsePositiveInt(sourceOperatingUnit.id)}:${parsePositiveInt(
        targetOperatingUnit.id
      )}`;
      const existing = existingMappingsByKey.get(mappingKey) || null;
      if (existing) {
        mappings.push({
          id: parsePositiveInt(existing.id),
          operatingUnitId: parsePositiveInt(existing.operating_unit_id),
          partnerOperatingUnitId: parsePositiveInt(existing.partner_operating_unit_id),
          dueFromAccountId: parsePositiveInt(existing.due_from_account_id),
          dueFromAccountCode: String(existing.due_from_account_code || ""),
          dueFromAccountName: String(existing.due_from_account_name || ""),
          dueToAccountId: parsePositiveInt(existing.due_to_account_id),
          dueToAccountCode: String(existing.due_to_account_code || ""),
          dueToAccountName: String(existing.due_to_account_name || ""),
          created: false,
        });
        return;
      }

      const allocation = pickNextSharedChildSequence(dueFromUsage, dueToUsage);
      dueFromUsage.usedSequences.add(allocation.sequence);
      dueToUsage.usedSequences.add(allocation.sequence);

      const dueFromCode = buildChildAccountCode(
        dueFromParentAccount.code,
        allocation.sequence,
        allocation.width
      );
      const dueToCode = buildChildAccountCode(
        dueToParentAccount.code,
        allocation.sequence,
        allocation.width
      );

      const dueFromAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
        parentAccount: dueFromParentAccount,
        code: dueFromCode,
        name: buildPartnerCurrentAccountName({
          operatingUnit: sourceOperatingUnit,
          partnerOperatingUnit: targetOperatingUnit,
          role: "DUE_FROM",
        }),
        accountType: "ASSET",
        normalSide: "DEBIT",
      });
      const dueToAccount = await insertOperatingUnitCurrentChildAccountTx(tx, {
        parentAccount: dueToParentAccount,
        code: dueToCode,
        name: buildPartnerCurrentAccountName({
          operatingUnit: sourceOperatingUnit,
          partnerOperatingUnit: targetOperatingUnit,
          role: "DUE_TO",
        }),
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      });

      await assertUniqueOperatingUnitPartnerCurrentAccountTx(tx, {
        tenantId,
        legalEntityId,
        operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
        partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        accountId: dueFromAccount.id,
        fieldLabel: "dueFromAccountId",
        columnName: "due_from_account_id",
        roleLabel: "Due From Partner account mapping",
      });
      await assertUniqueOperatingUnitPartnerCurrentAccountTx(tx, {
        tenantId,
        legalEntityId,
        operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
        partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        accountId: dueToAccount.id,
        fieldLabel: "dueToAccountId",
        columnName: "due_to_account_id",
        roleLabel: "Due To Partner account mapping",
      });

      const mappingId = await upsertOperatingUnitPartnerCurrentAccountRow({
        tenantId,
        legalEntityId,
        operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
        partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        dueFromAccountId: dueFromAccount.id,
        dueToAccountId: dueToAccount.id,
        runQuery: (sql, params) => tx.query(sql, params),
      });

      createdAccounts.push(
        {
          id: dueFromAccount.id,
          code: dueFromAccount.code,
          name: dueFromAccount.name,
          role: "DUE_FROM",
          operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
          partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        },
        {
          id: dueToAccount.id,
          code: dueToAccount.code,
          name: dueToAccount.name,
          role: "DUE_TO",
          operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
          partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        }
      );
      mappings.push({
        id: mappingId,
        operatingUnitId: parsePositiveInt(sourceOperatingUnit.id),
        partnerOperatingUnitId: parsePositiveInt(targetOperatingUnit.id),
        dueFromAccountId: dueFromAccount.id,
        dueFromAccountCode: dueFromAccount.code,
        dueFromAccountName: dueFromAccount.name,
        dueToAccountId: dueToAccount.id,
        dueToAccountCode: dueToAccount.code,
        dueToAccountName: dueToAccount.name,
        created: true,
      });
    };

    await ensureDirectionalMapping({
      sourceOperatingUnit: operatingUnit,
      targetOperatingUnit: partnerOperatingUnit,
    });
    await ensureDirectionalMapping({
      sourceOperatingUnit: partnerOperatingUnit,
      targetOperatingUnit: operatingUnit,
    });

    return {
      legalEntityId: parsePositiveInt(legalEntityId),
      operatingUnitId: parsePositiveInt(operatingUnitId),
      partnerOperatingUnitId: parsePositiveInt(partnerOperatingUnitId),
      dueFromParentAccountId: parsePositiveInt(dueFromParentAccount.id),
      dueToParentAccountId: parsePositiveInt(dueToParentAccount.id),
      createdAccounts,
      mappings,
    };
  });
}

export async function upsertFiscalCalendar({
  tenantId,
  code,
  name,
  yearStartMonth,
  yearStartDay,
}) {
  const id = await upsertFiscalCalendarRow({
    tenantId,
    code: String(code).trim(),
    name: String(name).trim(),
    yearStartMonth,
    yearStartDay,
  });

  return {
    id,
  };
}

export async function generateFiscalPeriods({
  tenantId,
  calendarId,
  fiscalYear,
  assertFiscalCalendarBelongsToTenant,
  toIsoDate,
}) {
  const calendar = await assertFiscalCalendarBelongsToTenant(
    tenantId,
    calendarId,
    "calendarId"
  );

  for (let i = 0; i < 12; i += 1) {
    const monthOffset = calendar.year_start_month - 1 + i;
    const start = new Date(Date.UTC(fiscalYear, monthOffset, calendar.year_start_day));
    const nextStart = new Date(Date.UTC(fiscalYear, monthOffset + 1, calendar.year_start_day));
    const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
    const periodNo = i + 1;
    const periodName = `P${String(periodNo).padStart(2, "0")}`;

    await upsertFiscalPeriodRow({
      calendarId,
      fiscalYear,
      periodNo,
      periodName,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
    });
  }

  return {
    calendarId,
    fiscalYear,
    periodsGenerated: 12,
  };
}

export async function upsertShareholderJournalConfig({
  req,
  tenantId,
  legalEntityId,
  capitalCreditParentAccountId,
  commitmentDebitParentAccountId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  assertShareholderParentAccount,
  capitalPurposeCode,
  commitmentPurposeCode,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  const row = await withTransaction(async (tx) => {
    await assertShareholderParentAccount(
      tx,
      tenantId,
      legalEntityId,
      capitalCreditParentAccountId,
      "capitalCreditParentAccountId",
      "CREDIT"
    );
    await assertShareholderParentAccount(
      tx,
      tenantId,
      legalEntityId,
      commitmentDebitParentAccountId,
      "commitmentDebitParentAccountId",
      "DEBIT"
    );

    await upsertJournalPurposeAccountTx(tx, {
      tenantId,
      legalEntityId,
      purposeCode: capitalPurposeCode,
      accountId: capitalCreditParentAccountId,
    });

    await upsertJournalPurposeAccountTx(tx, {
      tenantId,
      legalEntityId,
      purposeCode: commitmentPurposeCode,
      accountId: commitmentDebitParentAccountId,
    });

    return findShareholderJournalConfigRowTx(tx, {
      tenantId,
      legalEntityId,
      capitalPurposeCode,
      commitmentPurposeCode,
    });
  });

  return {
    row,
  };
}

export async function previewShareholderCommitmentJournalBatch({
  req,
  tenantId,
  legalEntityId,
  shareholderIds,
  commitmentDate,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  parseBatchShareholderIds,
  toIsoDate,
  buildShareholderCommitmentBatchPreviewTx,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  const parsedShareholderIds = parseBatchShareholderIds(shareholderIds);
  const finalCommitmentDate =
    commitmentDate === undefined || commitmentDate === null || commitmentDate === ""
      ? toIsoDate(new Date(), "commitmentDate")
      : toIsoDate(commitmentDate, "commitmentDate");

  return withTransaction(async (tx) =>
    buildShareholderCommitmentBatchPreviewTx(tx, {
      tenantId,
      legalEntityId,
      shareholderIds: parsedShareholderIds,
      commitmentDate: finalCommitmentDate,
      lockShareholders: false,
    })
  );
}

export async function executeShareholderCommitmentJournalBatch({
  req,
  tenantId,
  legalEntityId,
  shareholderIds,
  commitmentDate,
  userId,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  parseBatchShareholderIds,
  toIsoDate,
  buildShareholderCommitmentBatchPreviewTx,
  normalizeMoney,
  generateAutoJournalNo,
  normalizeCurrencyCode,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  const parsedShareholderIds = parseBatchShareholderIds(shareholderIds);
  const finalCommitmentDate =
    commitmentDate === undefined || commitmentDate === null || commitmentDate === ""
      ? toIsoDate(new Date(), "commitmentDate")
      : toIsoDate(commitmentDate, "commitmentDate");

  return withTransaction(async (tx) => {
    const preview = await buildShareholderCommitmentBatchPreviewTx(tx, {
      tenantId,
      legalEntityId,
      shareholderIds: parsedShareholderIds,
      commitmentDate: finalCommitmentDate,
      lockShareholders: true,
    });

    if (preview.validation?.has_blocking_errors) {
      const err = badRequest("Batch commitment journal validation failed");
      err.code = "BATCH_VALIDATION_FAILED";
      err.payload = {
        validation: preview.validation,
        skipped_shareholders: preview.skipped_shareholders,
        rows: preview.rows,
      };
      throw err;
    }

    const includedShareholders = Array.isArray(preview.included_shareholders)
      ? preview.included_shareholders
      : [];
    if (includedShareholders.length === 0) {
      const err = badRequest("No shareholder has a positive journalizable commitment delta");
      err.code = "BATCH_VALIDATION_FAILED";
      err.payload = {
        validation: preview.validation,
        skipped_shareholders: preview.skipped_shareholders,
        rows: preview.rows,
      };
      throw err;
    }

    const journalContext = preview.journal_context || null;
    const bookId = parsePositiveInt(journalContext?.book_id);
    const fiscalPeriodId = parsePositiveInt(journalContext?.fiscal_period_id);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("No OPEN book/fiscal period found for legalEntityId");
    }

    const totalAmount = normalizeMoney(preview.totals?.total_debit || 0);
    if (totalAmount <= 0) {
      throw badRequest("Total commitment amount must be greater than zero");
    }

    const journalNo = generateAutoJournalNo("TAAHHUT");
    const referenceNo = `SHAREHOLDER_COMMITMENT_BATCH:${legalEntityId}:${Date.now()}`.slice(
      0,
      100
    );
    const currencyCode = normalizeCurrencyCode(
      preview.totals?.currency_code || journalContext?.base_currency_code || "USD"
    );
    const entryDate = finalCommitmentDate;
    const documentDate = finalCommitmentDate;
    const description = `Shareholder commitment batch (${includedShareholders.length} shareholders)`;

    const entryResult = await tx.query(
      `INSERT INTO journal_entries (
          tenant_id,
          legal_entity_id,
          book_id,
          fiscal_period_id,
          journal_no,
          source_type,
          status,
          entry_date,
          document_date,
          currency_code,
          description,
          reference_no,
          total_debit_base,
          total_credit_base,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        bookId,
        fiscalPeriodId,
        journalNo,
        entryDate,
        documentDate,
        currencyCode,
        description,
        referenceNo,
        totalAmount,
        totalAmount,
        userId,
      ]
    );
    const journalEntryId = parsePositiveInt(entryResult.rows.insertId);
    if (!journalEntryId) {
      throw badRequest("Failed to create shareholder batch commitment journal");
    }

    let lineNo = 1;
    for (const shareholder of includedShareholders) {
      const amount = normalizeMoney(shareholder.delta_amount || 0);
      const shareholderId = parsePositiveInt(shareholder.shareholder_id);
      const shareholderCode = String(shareholder.code || shareholderId || "");
      const shareholderName = String(shareholder.name || "").trim();
      const debitAccountId = parsePositiveInt(shareholder.debit_account_id);
      const creditAccountId = parsePositiveInt(shareholder.credit_account_id);

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO journal_lines (
            journal_entry_id,
            line_no,
            account_id,
            operating_unit_id,
            counterparty_legal_entity_id,
            description,
            currency_code,
            amount_txn,
            debit_base,
            credit_base,
            tax_code
          )
          VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL)`,
        [
          journalEntryId,
          lineNo,
          debitAccountId,
          `Shareholder commitment receivable (${shareholderCode}${
            shareholderName ? ` - ${shareholderName}` : ""
          })`,
          currencyCode,
          amount,
          amount,
        ]
      );
      lineNo += 1;

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO journal_lines (
            journal_entry_id,
            line_no,
            account_id,
            operating_unit_id,
            counterparty_legal_entity_id,
            description,
            currency_code,
            amount_txn,
            debit_base,
            credit_base,
            tax_code
          )
          VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?, NULL)`,
        [
          journalEntryId,
          lineNo,
          creditAccountId,
          `Committed capital (${shareholderCode}${shareholderName ? ` - ${shareholderName}` : ""})`,
          currencyCode,
          amount * -1,
          amount,
        ]
      );
      lineNo += 1;

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO shareholder_commitment_journal_entries (
            tenant_id,
            shareholder_id,
            legal_entity_id,
            journal_entry_id,
            line_group_key,
            amount,
            currency_code,
            created_by_user_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          shareholderId,
          legalEntityId,
          journalEntryId,
          `BATCH:${shareholderId}`,
          amount,
          currencyCode,
          userId,
        ]
      );
    }

    return {
      journalEntryId,
      journalNo,
      shareholderCount: includedShareholders.length,
      skippedCount: Array.isArray(preview.skipped_shareholders)
        ? preview.skipped_shareholders.length
        : 0,
      totalAmount,
      bookId,
      bookCode: journalContext?.book_code || "-",
      fiscalPeriodId,
      entryDate,
      processedShareholderIds: includedShareholders.map((row) =>
        parsePositiveInt(row.shareholder_id)
      ),
      skippedShareholders: preview.skipped_shareholders || [],
      validationWarnings: preview.validation?.warnings || [],
    };
  });
}

export async function autoProvisionShareholderSubAccounts({
  req,
  tenantId,
  legalEntityId,
  shareholderId,
  shareholderCode,
  shareholderName,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  resolveShareholderParentMappings,
  assertShareholderParentAccount,
  loadLegalEntityAccountHierarchy,
  validateShareholderMappedLeafAccount,
  normalizeShareholderChildSequenceFromCode,
  buildShareholderChildCode,
}) {
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  return withTransaction(async (tx) => {
    const parentMappings = await resolveShareholderParentMappings(tx, tenantId, legalEntityId);
    const capitalParentAccountId = parsePositiveInt(parentMappings.capitalCreditParentAccountId);
    const commitmentParentAccountId = parsePositiveInt(
      parentMappings.commitmentDebitParentAccountId
    );
    if (!capitalParentAccountId || !commitmentParentAccountId) {
      throw badRequest(
        "Setup required: configure shareholder parent account mapping for selected legalEntityId"
      );
    }
    const capitalParentAccount = await assertShareholderParentAccount(
      tx,
      tenantId,
      legalEntityId,
      capitalParentAccountId,
      "capitalCreditParentAccountId",
      "CREDIT"
    );
    const commitmentParentAccount = await assertShareholderParentAccount(
      tx,
      tenantId,
      legalEntityId,
      commitmentParentAccountId,
      "commitmentDebitParentAccountId",
      "DEBIT"
    );

    const parentRowsResult = await tx.query(
      `SELECT
         a.id,
         a.code,
         a.name,
         a.coa_id,
         a.normal_side,
         a.account_type,
         a.allow_posting,
         a.is_active,
         c.legal_entity_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE c.tenant_id = ?
         AND a.id IN (?, ?)
       FOR UPDATE`,
      [tenantId, capitalParentAccount.id, commitmentParentAccount.id]
    );
    const parentById = new Map(
      (parentRowsResult.rows || []).map((row) => [parsePositiveInt(row.id), row])
    );
    const capitalParentRow = parentById.get(capitalParentAccount.id);
    const commitmentParentRow = parentById.get(commitmentParentAccount.id);
    if (!capitalParentRow || !commitmentParentRow) {
      throw badRequest("Configured parent mapping accounts could not be loaded");
    }

    let shareholderRow = null;
    if (shareholderId) {
      const shareholderResult = await tx.query(
        `SELECT
           id,
           code,
           name,
           capital_sub_account_id,
           commitment_debit_sub_account_id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?
         LIMIT 1
         FOR UPDATE`,
        [tenantId, legalEntityId, shareholderId]
      );
      shareholderRow = shareholderResult.rows[0] || null;
      if (!shareholderRow) {
        throw badRequest("shareholderId not found for selected legalEntityId");
      }
    }

    const existingAccountIds = Array.from(
      new Set(
        [
          parsePositiveInt(shareholderRow?.capital_sub_account_id),
          parsePositiveInt(shareholderRow?.commitment_debit_sub_account_id),
        ].filter(Boolean)
      )
    );
    const existingAccountById = new Map();
    if (existingAccountIds.length > 0) {
      const placeholders = existingAccountIds.map(() => "?").join(",");
      const existingAccountsResult = await tx.query(
        `SELECT
           a.id,
           a.code,
           a.name,
           a.account_type,
           a.normal_side,
           a.allow_posting,
           a.is_active,
           a.parent_account_id,
           EXISTS(
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = a.id
               AND child.is_active = TRUE
           ) AS has_active_children,
           c.tenant_id AS account_tenant_id,
           c.legal_entity_id AS account_legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE a.id IN (${placeholders})`,
        existingAccountIds
      );
      for (const row of existingAccountsResult.rows || []) {
        existingAccountById.set(parsePositiveInt(row.id), row);
      }
    }

    const accountParentById = await loadLegalEntityAccountHierarchy(
      tx,
      tenantId,
      legalEntityId
    );

    const resolveExistingMappedAccount = ({
      accountId,
      fieldLabel,
      expectedNormalSide,
      expectedParentAccountId,
    }) => {
      const normalizedAccountId = parsePositiveInt(accountId);
      if (!normalizedAccountId) {
        return null;
      }
      const account = existingAccountById.get(normalizedAccountId) || null;
      const issue = validateShareholderMappedLeafAccount({
        account,
        tenantId,
        legalEntityId,
        expectedNormalSide,
        expectedParentAccountId,
        parentById: accountParentById,
        fieldLabel,
      });
      if (issue) {
        throw badRequest(`${fieldLabel} on shareholder is invalid: ${issue.message}`);
      }
      return {
        id: normalizedAccountId,
        code: String(account.code || ""),
        name: String(account.name || ""),
        created: false,
      };
    };

    let capitalSubAccount = resolveExistingMappedAccount({
      accountId: shareholderRow?.capital_sub_account_id,
      fieldLabel: "capital_sub_account_id",
      expectedNormalSide: "CREDIT",
      expectedParentAccountId: capitalParentAccount.id,
    });
    let commitmentSubAccount = resolveExistingMappedAccount({
      accountId: shareholderRow?.commitment_debit_sub_account_id,
      fieldLabel: "commitment_debit_sub_account_id",
      expectedNormalSide: "DEBIT",
      expectedParentAccountId: commitmentParentAccount.id,
    });

    const childRowsResult = await tx.query(
      `SELECT id, code, parent_account_id
       FROM accounts
       WHERE parent_account_id IN (?, ?)
       FOR UPDATE`,
      [capitalParentAccount.id, commitmentParentAccount.id]
    );
    const capitalUsedSequences = new Set();
    const debitUsedSequences = new Set();
    for (const row of childRowsResult.rows || []) {
      const parentAccountId = parsePositiveInt(row.parent_account_id);
      const sequence =
        parentAccountId === capitalParentAccount.id
          ? normalizeShareholderChildSequenceFromCode(capitalParentRow.code, row.code)
          : normalizeShareholderChildSequenceFromCode(commitmentParentRow.code, row.code);
      if (!sequence) {
        continue;
      }
      if (parentAccountId === capitalParentAccount.id) {
        capitalUsedSequences.add(sequence);
      }
      if (parentAccountId === commitmentParentAccount.id) {
        debitUsedSequences.add(sequence);
      }
    }

    const needsCapitalCreate = !capitalSubAccount;
    const needsDebitCreate = !commitmentSubAccount;

    if (needsCapitalCreate || needsDebitCreate) {
      const preferredSequenceFromCapital =
        !needsCapitalCreate && capitalSubAccount
          ? normalizeShareholderChildSequenceFromCode(
              capitalParentRow.code,
              capitalSubAccount.code
            )
          : null;
      const preferredSequenceFromDebit =
        !needsDebitCreate && commitmentSubAccount
          ? normalizeShareholderChildSequenceFromCode(
              commitmentParentRow.code,
              commitmentSubAccount.code
            )
          : null;
      const preferredSequence = parsePositiveInt(
        preferredSequenceFromCapital || preferredSequenceFromDebit
      );
      const sequenceFits = (sequence) => {
        if (!sequence) {
          return false;
        }
        if (needsCapitalCreate && capitalUsedSequences.has(sequence)) {
          return false;
        }
        if (needsDebitCreate && debitUsedSequences.has(sequence)) {
          return false;
        }
        return true;
      };

      let selectedSequence = preferredSequence && sequenceFits(preferredSequence)
        ? preferredSequence
        : null;
      if (!selectedSequence) {
        selectedSequence = 1;
        while (!sequenceFits(selectedSequence) && selectedSequence < 999999) {
          selectedSequence += 1;
        }
      }
      if (!sequenceFits(selectedSequence)) {
        throw badRequest(
          "Unable to allocate next available shareholder sub-account codes under configured parents"
        );
      }

      if (needsCapitalCreate) {
        const capitalCode = buildShareholderChildCode(capitalParentRow.code, selectedSequence);
        const capitalInsert = await tx.query(
          `INSERT INTO accounts (
              coa_id,
              code,
              name,
              account_type,
              normal_side,
              allow_posting,
              parent_account_id,
              is_active
            )
            VALUES (?, ?, ?, 'EQUITY', 'CREDIT', TRUE, ?, TRUE)`,
          [
            parsePositiveInt(capitalParentRow.coa_id),
            capitalCode,
            shareholderName,
            capitalParentAccount.id,
          ]
        );
        capitalSubAccount = {
          id: parsePositiveInt(capitalInsert.rows.insertId),
          code: capitalCode,
          name: shareholderName,
          created: true,
        };
        capitalUsedSequences.add(selectedSequence);
      }

      if (needsDebitCreate) {
        const debitCode = buildShareholderChildCode(
          commitmentParentRow.code,
          selectedSequence
        );
        const debitInsert = await tx.query(
          `INSERT INTO accounts (
              coa_id,
              code,
              name,
              account_type,
              normal_side,
              allow_posting,
              parent_account_id,
              is_active
            )
            VALUES (?, ?, ?, 'EQUITY', 'DEBIT', TRUE, ?, TRUE)`,
          [
            parsePositiveInt(commitmentParentRow.coa_id),
            debitCode,
            shareholderName,
            commitmentParentAccount.id,
          ]
        );
        commitmentSubAccount = {
          id: parsePositiveInt(debitInsert.rows.insertId),
          code: debitCode,
          name: shareholderName,
          created: true,
        };
        debitUsedSequences.add(selectedSequence);
      }
    }

    if (!capitalSubAccount?.id || !commitmentSubAccount?.id) {
      throw badRequest("Failed to resolve both shareholder sub-accounts");
    }

    if (shareholderRow?.id) {
      await tx.query(
        `UPDATE shareholders
         SET capital_sub_account_id = ?,
             commitment_debit_sub_account_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?`,
        [
          capitalSubAccount.id,
          commitmentSubAccount.id,
          tenantId,
          legalEntityId,
          parsePositiveInt(shareholderRow.id),
        ]
      );
    }

    return {
      legalEntityId,
      shareholderId: parsePositiveInt(shareholderRow?.id) || null,
      shareholderCode,
      shareholderName,
      capitalSubAccount,
      commitmentDebitSubAccount: commitmentSubAccount,
    };
  });
}

export async function upsertShareholder({
  req,
  tenantId,
  legalEntityId,
  code,
  name,
  shareholderType,
  taxId,
  committedCapital,
  capitalSubAccountId,
  commitmentDebitSubAccountId,
  currencyCode,
  status,
  notes,
  commitmentDate,
  autoCommitmentJournal,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  assertCurrencyExists,
  parseOptionalNonNegativeNumber,
  toIsoDate,
  parseBooleanValue,
  resolveShareholderParentMappings,
  assertShareholderParentAccount,
  loadLegalEntityAccountHierarchy,
  normalizeAccountNormalSide,
  isDescendantOfParentAccount,
  normalizeMoney,
  createShareholderCommitmentDraftJournal,
  toCommitmentJournalFailureMessage,
  recalculateShareholderOwnershipPctTx,
}) {
  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    legalEntityId,
    "legalEntityId"
  );
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  const normalizedCode = String(code || "").trim().toUpperCase();
  const normalizedName = String(name || "").trim();
  if (!normalizedCode || !normalizedName) {
    throw badRequest("code and name are required");
  }

  const normalizedShareholderType = String(shareholderType || "INDIVIDUAL").toUpperCase();
  if (!["INDIVIDUAL", "CORPORATE"].includes(normalizedShareholderType)) {
    throw badRequest("shareholderType must be INDIVIDUAL or CORPORATE");
  }

  const normalizedStatus = String(status || "ACTIVE").toUpperCase();
  if (!["ACTIVE", "INACTIVE"].includes(normalizedStatus)) {
    throw badRequest("status must be ACTIVE or INACTIVE");
  }

  const finalCommittedCapital = parseOptionalNonNegativeNumber(
    committedCapital,
    "committedCapital",
    0
  );

  const normalizedCurrencyCode = String(
    currencyCode || legalEntity.functional_currency_code || "USD"
  )
    .trim()
    .toUpperCase();
  await assertCurrencyExists(normalizedCurrencyCode, "currencyCode");

  const normalizedTaxId = taxId ? String(taxId).trim() : null;
  const normalizedNotes = notes ? String(notes).trim() : null;
  const normalizedCommitmentDate =
    commitmentDate === undefined || commitmentDate === null || commitmentDate === ""
      ? null
      : toIsoDate(commitmentDate, "commitmentDate");
  const normalizedCapitalSubAccountId = capitalSubAccountId
    ? parsePositiveInt(capitalSubAccountId)
    : null;
  const normalizedCommitmentDebitSubAccountId = commitmentDebitSubAccountId
    ? parsePositiveInt(commitmentDebitSubAccountId)
    : null;
  const finalAutoCommitmentJournal = parseBooleanValue(autoCommitmentJournal, true);
  const userId = parsePositiveInt(req.user?.userId);

  if (capitalSubAccountId && !normalizedCapitalSubAccountId) {
    throw badRequest("capitalSubAccountId must be a positive integer");
  }
  if (commitmentDebitSubAccountId && !normalizedCommitmentDebitSubAccountId) {
    throw badRequest("commitmentDebitSubAccountId must be a positive integer");
  }
  if (finalCommittedCapital > 0 && !normalizedCapitalSubAccountId) {
    throw badRequest("capitalSubAccountId is required when committedCapital is greater than 0");
  }
  if (finalCommittedCapital > 0 && !normalizedCommitmentDebitSubAccountId) {
    throw badRequest(
      "commitmentDebitSubAccountId is required when committedCapital is greater than 0"
    );
  }
  if (
    normalizedCapitalSubAccountId &&
    normalizedCommitmentDebitSubAccountId &&
    normalizedCapitalSubAccountId === normalizedCommitmentDebitSubAccountId
  ) {
    throw badRequest(
      "commitmentDebitSubAccountId must be different from capitalSubAccountId"
    );
  }
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  const operation = await withTransaction(async (tx) => {
    const existingResult = await tx.query(
      `SELECT
         id,
         committed_capital,
         capital_sub_account_id,
         commitment_debit_sub_account_id
       FROM shareholders
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantId, legalEntityId, normalizedCode]
    );
    const existing = existingResult.rows[0] || null;
    const shareholderParentMappings = await resolveShareholderParentMappings(
      tx,
      tenantId,
      legalEntityId
    );
    const capitalCreditParentAccountId = parsePositiveInt(
      shareholderParentMappings.capitalCreditParentAccountId
    );
    const commitmentDebitParentAccountId = parsePositiveInt(
      shareholderParentMappings.commitmentDebitParentAccountId
    );
    const shouldValidateMappedShareholderSubAccounts =
      finalCommittedCapital > 0 ||
      normalizedCapitalSubAccountId ||
      normalizedCommitmentDebitSubAccountId;
    const shouldValidateMappedLeafHierarchy =
      Boolean(normalizedCapitalSubAccountId) ||
      Boolean(normalizedCommitmentDebitSubAccountId);

    if (
      shouldValidateMappedShareholderSubAccounts &&
      (!capitalCreditParentAccountId || !commitmentDebitParentAccountId)
    ) {
      throw badRequest(
        "Setup required: configure shareholder parent account mapping for selected legalEntityId"
      );
    }
    if (capitalCreditParentAccountId) {
      await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        capitalCreditParentAccountId,
        "capitalCreditParentAccountId",
        "CREDIT"
      );
    }
    if (commitmentDebitParentAccountId) {
      await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        commitmentDebitParentAccountId,
        "commitmentDebitParentAccountId",
        "DEBIT"
      );
    }
    const accountParentById = shouldValidateMappedLeafHierarchy
      ? await loadLegalEntityAccountHierarchy(tx, tenantId, legalEntityId)
      : new Map();

    if (normalizedCapitalSubAccountId) {
      const accountResult = await tx.query(
        `SELECT
           a.id,
           a.code,
           a.account_type,
           a.normal_side,
           a.allow_posting,
           a.is_active,
           a.parent_account_id,
           EXISTS(
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = a.id
               AND child.is_active = TRUE
           ) AS has_active_children,
           c.legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE a.id = ?
           AND c.tenant_id = ?
         LIMIT 1`,
        [normalizedCapitalSubAccountId, tenantId]
      );
      const account = accountResult.rows[0];
      if (!account) {
        throw badRequest("capitalSubAccountId not found for tenant");
      }
      if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
        throw badRequest("capitalSubAccountId must belong to the selected legalEntityId");
      }
      if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
        throw badRequest("capitalSubAccountId must reference an EQUITY account");
      }
      if (normalizeAccountNormalSide(account.normal_side) !== "CREDIT") {
        throw badRequest(
          "capitalSubAccountId must reference a CREDIT normal-side account"
        );
      }
      if (!Boolean(account.is_active)) {
        throw badRequest("capitalSubAccountId must reference an active account");
      }
      if (!Boolean(account.allow_posting)) {
        throw badRequest("capitalSubAccountId must reference a postable account");
      }
      if (Boolean(account.has_active_children)) {
        throw badRequest("capitalSubAccountId must reference a leaf sub-account");
      }
      if (
        capitalCreditParentAccountId &&
        !isDescendantOfParentAccount(
          accountParentById,
          parsePositiveInt(account.id),
          capitalCreditParentAccountId
        )
      ) {
        throw badRequest(
          "capitalSubAccountId must be a child/descendant of configured capitalCreditParentAccountId"
        );
      }

      const mappingConflict = await tx.query(
        `SELECT id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND capital_sub_account_id = ?
           AND id <> ?
         LIMIT 1`,
        [
          tenantId,
          legalEntityId,
          normalizedCapitalSubAccountId,
          parsePositiveInt(existing?.id) || 0,
        ]
      );
      if (mappingConflict.rows[0]) {
        throw badRequest("capitalSubAccountId is already assigned to another shareholder");
      }
    }

    if (normalizedCommitmentDebitSubAccountId) {
      const accountResult = await tx.query(
        `SELECT
           a.id,
           a.code,
           a.account_type,
           a.normal_side,
           a.allow_posting,
           a.is_active,
           a.parent_account_id,
           EXISTS(
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = a.id
               AND child.is_active = TRUE
           ) AS has_active_children,
           c.legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE a.id = ?
           AND c.tenant_id = ?
         LIMIT 1`,
        [normalizedCommitmentDebitSubAccountId, tenantId]
      );
      const account = accountResult.rows[0];
      if (!account) {
        throw badRequest("commitmentDebitSubAccountId not found for tenant");
      }
      if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
        throw badRequest(
          "commitmentDebitSubAccountId must belong to the selected legalEntityId"
        );
      }
      if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
        throw badRequest("commitmentDebitSubAccountId must reference an EQUITY account");
      }
      if (normalizeAccountNormalSide(account.normal_side) !== "DEBIT") {
        throw badRequest(
          "commitmentDebitSubAccountId must reference a DEBIT normal-side account"
        );
      }
      if (!Boolean(account.is_active)) {
        throw badRequest("commitmentDebitSubAccountId must reference an active account");
      }
      if (!Boolean(account.allow_posting)) {
        throw badRequest("commitmentDebitSubAccountId must reference a postable account");
      }
      if (Boolean(account.has_active_children)) {
        throw badRequest("commitmentDebitSubAccountId must reference a leaf sub-account");
      }
      if (
        commitmentDebitParentAccountId &&
        !isDescendantOfParentAccount(
          accountParentById,
          parsePositiveInt(account.id),
          commitmentDebitParentAccountId
        )
      ) {
        throw badRequest(
          "commitmentDebitSubAccountId must be a child/descendant of configured commitmentDebitParentAccountId"
        );
      }

      const mappingConflict = await tx.query(
        `SELECT id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND commitment_debit_sub_account_id = ?
           AND id <> ?
         LIMIT 1`,
        [
          tenantId,
          legalEntityId,
          normalizedCommitmentDebitSubAccountId,
          parsePositiveInt(existing?.id) || 0,
        ]
      );
      if (mappingConflict.rows[0]) {
        throw badRequest(
          "commitmentDebitSubAccountId is already assigned to another shareholder"
        );
      }
    }

    await tx.query(
      `INSERT INTO shareholders (
          tenant_id,
          legal_entity_id,
          code,
          name,
          shareholder_type,
          tax_id,
          committed_capital,
          capital_sub_account_id,
          commitment_debit_sub_account_id,
          currency_code,
          status,
          notes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         shareholder_type = VALUES(shareholder_type),
         tax_id = VALUES(tax_id),
         committed_capital = VALUES(committed_capital),
         capital_sub_account_id = VALUES(capital_sub_account_id),
         commitment_debit_sub_account_id = VALUES(commitment_debit_sub_account_id),
         currency_code = VALUES(currency_code),
         status = VALUES(status),
         notes = VALUES(notes)`,
      [
        tenantId,
        legalEntityId,
        normalizedCode,
        normalizedName,
        normalizedShareholderType,
        normalizedTaxId,
        finalCommittedCapital,
        normalizedCapitalSubAccountId,
        normalizedCommitmentDebitSubAccountId,
        normalizedCurrencyCode,
        normalizedStatus,
        normalizedNotes,
      ]
    );

    const savedResult = await tx.query(
      `SELECT
         id,
         committed_capital,
         capital_sub_account_id,
         commitment_debit_sub_account_id
       FROM shareholders
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, normalizedCode]
    );
    const saved = savedResult.rows[0] || null;
    const shareholderId = parsePositiveInt(saved?.id);
    const previousCommittedCapital = normalizeMoney(existing?.committed_capital || 0);
    const currentCommittedCapital = normalizeMoney(saved?.committed_capital || 0);
    const committedCapitalDelta = normalizeMoney(
      currentCommittedCapital - previousCommittedCapital
    );

    let commitmentJournal = {
      attempted: false,
      created: false,
      reason: finalAutoCommitmentJournal ? null : "DISABLED",
      amount: committedCapitalDelta > 0 ? committedCapitalDelta : 0,
    };

    if (finalAutoCommitmentJournal) {
      if (committedCapitalDelta > 0) {
        commitmentJournal = await createShareholderCommitmentDraftJournal(tx, {
          tenantId,
          legalEntityId,
          userId,
          shareholderId,
          shareholderCode: normalizedCode,
          shareholderName: normalizedName,
          amount: committedCapitalDelta,
          currencyCode: normalizedCurrencyCode,
          commitmentDate: normalizedCommitmentDate,
          capitalSubAccountId:
            parsePositiveInt(saved?.capital_sub_account_id) ||
            normalizedCapitalSubAccountId,
          commitmentDebitSubAccountId:
            parsePositiveInt(saved?.commitment_debit_sub_account_id) ||
            normalizedCommitmentDebitSubAccountId,
        });
        if (!commitmentJournal.created) {
          throw badRequest(toCommitmentJournalFailureMessage(commitmentJournal.reason));
        }
      } else if (committedCapitalDelta < 0) {
        commitmentJournal = {
          attempted: true,
          created: false,
          reason: "COMMITTED_CAPITAL_DECREASE_REQUIRES_MANUAL_REVERSAL",
          amount: Math.abs(committedCapitalDelta),
        };
      } else {
        commitmentJournal = {
          attempted: true,
          created: false,
          reason: "NO_COMMITTED_CAPITAL_INCREASE",
          amount: 0,
        };
      }
    }

    await recalculateShareholderOwnershipPctTx(tx, tenantId, legalEntityId);

    return {
      shareholderId: shareholderId || null,
      committedCapitalDelta,
      commitmentJournal,
    };
  });

  return {
    shareholderId: operation.shareholderId,
    committedCapitalDelta: operation.committedCapitalDelta,
    commitmentJournal: operation.commitmentJournal,
    autoCommitmentJournal: finalAutoCommitmentJournal,
  };
}
