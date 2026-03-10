
import { query, withTransaction } from "../db.js";
import {
assertLegalEntityBelongsToTenant,
assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
generateAutoJournalNo,
normalizeCurrencyCode,
normalizeMoney,
resolveOpenBookPeriodForLegalEntity,
toIsoDate,
} from "./org.shareholder.helpers.js";
import { getBankAccountByIdForTenant } from "./bank.accounts.service.js";
import { reverseJournalEntryTx } from "./gl.journal-reversal.service.js";
import {
findCashRegisterById,
findCashSessionById,
findCashTransactionById,
findCashTransactionByReversalOf,
generateCashTxnNoForLegalEntityYearTx,
insertCashTransaction,
markCashTransactionAsReversed,
postCashTransaction,
} from "./cash.queries.js";
import { assertRegisterOperationalConfig } from "./cash.register.service.js";
import { createAndPostCashJournalTx } from "./cash.service.js";
import { applyCashFxPositionForPostedTransactionTx } from "./cash.fx.position.service.js";
function parseDbBoolean(value) {
return value === true || value === 1 || value === "1";
}
function normalizeUpperText(value) {
return String(value || "")
  .trim()
  .toUpperCase();
}
function nowMysqlDateTime() {
return new Date().toISOString().slice(0, 19).replace("T", " ");
}
function clipText(value, maxLength) {
const normalized = String(value || "").trim();
if (!normalized) {
  return null;
}
return normalized.slice(0, maxLength);
}
function buildCashFulfillmentToken({ tenantId, shareholderId, registerId, contributionDate }) {
return `SCF-CASH:${tenantId}:${shareholderId}:${registerId}:${contributionDate}:${Date.now()}`.slice(
  0,
  100
);
}

async function countChildAccountsTx(tx, accountId) {
const result = await tx.query(
  `SELECT COUNT(*) AS total
   FROM accounts
   WHERE parent_account_id = ?`,
  [accountId]
);
return Number(result.rows?.[0]?.total || 0);
}

async function getEffectivePeriodStatus(bookId, fiscalPeriodId, runQuery = query) {
const result = await runQuery(
  `SELECT status
   FROM period_statuses
   WHERE book_id = ?
     AND fiscal_period_id = ?
   LIMIT 1`,
  [bookId, fiscalPeriodId]
);
return normalizeUpperText(result.rows?.[0]?.status || "OPEN") || "OPEN";
}

async function ensurePeriodOpen(bookId, fiscalPeriodId, actionLabel, runQuery = query) {
const status = await getEffectivePeriodStatus(bookId, fiscalPeriodId, runQuery);
if (status !== "OPEN") {
  throw badRequest(`Period is ${status}; cannot ${actionLabel}`);
}
}
function buildSubledgerReferenceNo({ journalNo, shareholderId, operatingUnitId, preview = false }) {
if (preview) {
  return `SCF-PREVIEW:${shareholderId}:${operatingUnitId}`.slice(0, 100);
}
return `SCF:${String(journalNo || "").trim()}:${shareholderId}:${operatingUnitId}`.slice(0, 100);
}

async function loadShareholderForFulfillmentTx(tx, { tenantId, legalEntityId, shareholderId }) {
const result = await tx.query(
  `SELECT
     s.id,
     s.tenant_id,
     s.legal_entity_id,
     s.code,
     s.name,
     s.status,
     s.currency_code,
     s.capital_sub_account_id,
     s.commitment_debit_sub_account_id,
     a.code AS commitment_account_code,
     a.name AS commitment_account_name,
     a.account_type AS commitment_account_type,
     a.normal_side AS commitment_account_normal_side,
     a.allow_posting AS commitment_account_allow_posting,
     a.is_active AS commitment_account_is_active,
     EXISTS(
       SELECT 1
       FROM accounts child
       WHERE child.parent_account_id = a.id
     ) AS commitment_account_has_children,
     c.legal_entity_id AS commitment_account_legal_entity_id
   FROM shareholders s
   LEFT JOIN accounts a
     ON a.id = s.commitment_debit_sub_account_id
   LEFT JOIN charts_of_accounts c
     ON c.id = a.coa_id
   WHERE s.id = ?
     AND s.tenant_id = ?
   LIMIT 1`,
  [shareholderId, tenantId]
);
const row = result.rows?.[0] || null;
if (!row) {
  throw badRequest("shareholderId not found for tenant");
}
if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
  throw badRequest("shareholderId must belong to legalEntityId");
}
if (!parsePositiveInt(row.capital_sub_account_id)) {
  throw badRequest("shareholderId is missing capital_sub_account_id");
}
const commitmentAccountId = parsePositiveInt(row.commitment_debit_sub_account_id);
if (!commitmentAccountId) {
  throw badRequest("shareholderId is missing commitment_debit_sub_account_id");
}
if (
  parsePositiveInt(row.commitment_account_legal_entity_id) !== parsePositiveInt(legalEntityId)
) {
  throw badRequest("shareholder commitment account must belong to legalEntityId");
}
if (normalizeUpperText(row.commitment_account_type) !== "EQUITY") {
  throw badRequest("shareholder commitment account must be an EQUITY account");
}
if (normalizeUpperText(row.commitment_account_normal_side) !== "DEBIT") {
  throw badRequest("shareholder commitment account must be a DEBIT normal-side account");
}
if (!parseDbBoolean(row.commitment_account_is_active)) {
  throw badRequest("shareholder commitment account must be active");
}
if (!parseDbBoolean(row.commitment_account_allow_posting)) {
  throw badRequest("shareholder commitment account must be postable");
}
if (parseDbBoolean(row.commitment_account_has_children)) {
  throw badRequest("shareholder commitment account must be a leaf account");
}
return {
  id: parsePositiveInt(row.id),
  code: String(row.code || ""),
  name: String(row.name || ""),
  status: normalizeUpperText(row.status),
  capitalSubAccountId: parsePositiveInt(row.capital_sub_account_id),
  commitmentDebitSubAccountId: commitmentAccountId,
  commitmentDebitSubAccountCode: String(row.commitment_account_code || ""),
  commitmentDebitSubAccountName: String(row.commitment_account_name || ""),
  currencyCode: normalizeCurrencyCode(row.currency_code || ""),
};
}

async function loadOperatingUnitForFulfillmentTx(
tx,
{ req, tenantId, legalEntityId, operatingUnitId, assertScopeAccess }) {
const parsedOperatingUnitId = parsePositiveInt(operatingUnitId);
if (!parsedOperatingUnitId) {
  return null;
}
const scopeRow = await assertOperatingUnitBelongsToTenant(
  tenantId,
  parsedOperatingUnitId,
  "operatingUnitId"
);
if (parsePositiveInt(scopeRow.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
  throw badRequest("operatingUnitId must belong to legalEntityId");
}
assertScopeAccess(req, "operating_unit", parsedOperatingUnitId, "operatingUnitId");
const result = await tx.query(
  `SELECT
     ou.id,
     ou.legal_entity_id,
     ou.code,
     ou.name,
     ou.status,
     ou.has_subledger,
     ou.central_due_from_account_id,
     cdfa.code AS central_due_from_account_code,
     cdfa.name AS central_due_from_account_name,
     cdfa.account_type AS central_due_from_account_type,
     cdfa.normal_side AS central_due_from_account_normal_side,
     cdfa.allow_posting AS central_due_from_account_allow_posting,
     cdfa.is_active AS central_due_from_account_is_active,
     cdfc.legal_entity_id AS central_due_from_account_legal_entity_id,
     EXISTS(
       SELECT 1
       FROM accounts child
       WHERE child.parent_account_id = cdfa.id
     ) AS central_due_from_account_has_children,
     ou.ou_due_to_central_account_id,
     odtq.code AS ou_due_to_central_account_code,
     odtq.name AS ou_due_to_central_account_name,
     odtq.account_type AS ou_due_to_central_account_type,
     odtq.normal_side AS ou_due_to_central_account_normal_side,
     odtq.allow_posting AS ou_due_to_central_account_allow_posting,
     odtq.is_active AS ou_due_to_central_account_is_active,
     odtqc.legal_entity_id AS ou_due_to_central_account_legal_entity_id,
     EXISTS(
       SELECT 1
       FROM accounts child
       WHERE child.parent_account_id = odtq.id
     ) AS ou_due_to_central_account_has_children
   FROM operating_units ou
   LEFT JOIN accounts cdfa
     ON cdfa.id = ou.central_due_from_account_id
   LEFT JOIN charts_of_accounts cdfc
     ON cdfc.id = cdfa.coa_id
   LEFT JOIN accounts odtq
     ON odtq.id = ou.ou_due_to_central_account_id
   LEFT JOIN charts_of_accounts odtqc
     ON odtqc.id = odtq.coa_id
   WHERE ou.id = ?
     AND ou.tenant_id = ?
   LIMIT 1`,
  [parsedOperatingUnitId, tenantId]
);
const row = result.rows?.[0] || null;
if (!row) {
  throw badRequest("operatingUnitId not found for tenant");
}
if (normalizeUpperText(row.status) !== "ACTIVE") {
  throw badRequest("operatingUnitId must reference an ACTIVE operating unit");
}
const centralDueFromAccountId = parsePositiveInt(row.central_due_from_account_id);
const ouDueToCentralAccountId = parsePositiveInt(row.ou_due_to_central_account_id);
if (!centralDueFromAccountId || !ouDueToCentralAccountId) {
  throw badRequest(
    "selected operatingUnitId is missing internal current account mappings"
  );
}
if (
  parsePositiveInt(row.central_due_from_account_legal_entity_id) !==
  parsePositiveInt(legalEntityId)
) {
  throw badRequest("central_due_from_account_id must belong to legalEntityId");
}
if (
  parsePositiveInt(row.ou_due_to_central_account_legal_entity_id) !==
  parsePositiveInt(legalEntityId)
) {
  throw badRequest("ou_due_to_central_account_id must belong to legalEntityId");
}
if (normalizeUpperText(row.central_due_from_account_type) !== "ASSET") {
  throw badRequest("central_due_from_account_id must be an ASSET account");
}
if (normalizeUpperText(row.central_due_from_account_normal_side) !== "DEBIT") {
  throw badRequest("central_due_from_account_id must be a DEBIT normal-side account");
}
if (!parseDbBoolean(row.central_due_from_account_is_active)) {
  throw badRequest("central_due_from_account_id must be active");
}
if (!parseDbBoolean(row.central_due_from_account_allow_posting)) {
  throw badRequest("central_due_from_account_id must be postable");
}
if (parseDbBoolean(row.central_due_from_account_has_children)) {
  throw badRequest("central_due_from_account_id must be a leaf account");
}
if (normalizeUpperText(row.ou_due_to_central_account_type) !== "LIABILITY") {
  throw badRequest("ou_due_to_central_account_id must be a LIABILITY account");
}
if (normalizeUpperText(row.ou_due_to_central_account_normal_side) !== "CREDIT") {
  throw badRequest("ou_due_to_central_account_id must be a CREDIT normal-side account");
}
if (!parseDbBoolean(row.ou_due_to_central_account_is_active)) {
  throw badRequest("ou_due_to_central_account_id must be active");
}
if (!parseDbBoolean(row.ou_due_to_central_account_allow_posting)) {
  throw badRequest("ou_due_to_central_account_id must be postable");
}
if (parseDbBoolean(row.ou_due_to_central_account_has_children)) {
  throw badRequest("ou_due_to_central_account_id must be a leaf account");
}
return {
  id: parsedOperatingUnitId,
  code: String(row.code || ""),
  name: String(row.name || ""),
  hasSubledger: parseDbBoolean(row.has_subledger),
  centralDueFromAccountId,
  centralDueFromAccountCode: String(row.central_due_from_account_code || ""),
  centralDueFromAccountName: String(row.central_due_from_account_name || ""),
  ouDueToCentralAccountId,
  ouDueToCentralAccountCode: String(row.ou_due_to_central_account_code || ""),
  ouDueToCentralAccountName: String(row.ou_due_to_central_account_name || ""),
};
}

async function loadAssetDestinationAccountTx(tx, {
tenantId,
legalEntityId,
destinationAccountId,
shareholder,
}) {
const parsedDestinationAccountId = parsePositiveInt(destinationAccountId);
if (!parsedDestinationAccountId) {
  throw badRequest("destinationAccountId must be a positive integer");
}
const result = await tx.query(
  `SELECT
     a.id,
     a.code,
     a.name,
     a.account_type,
     a.normal_side,
     a.allow_posting,
     a.is_active,
     c.scope AS coa_scope,
     c.legal_entity_id AS coa_legal_entity_id
   FROM accounts a
   JOIN charts_of_accounts c
     ON c.id = a.coa_id
   WHERE a.id = ?
     AND c.tenant_id = ?
   LIMIT 1`,
  [parsedDestinationAccountId, tenantId]
);
const row = result.rows?.[0] || null;
if (!row) {
  throw badRequest("destinationAccountId not found for tenant");
}
if (normalizeUpperText(row.coa_scope) !== "LEGAL_ENTITY") {
  throw badRequest("destinationAccountId must belong to a LEGAL_ENTITY chart");
}
if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
  throw badRequest("destinationAccountId must belong to legalEntityId");
}
if (normalizeUpperText(row.account_type) !== "ASSET") {
  throw badRequest("destinationAccountId must reference an ASSET account");
}
if (!parseDbBoolean(row.is_active)) {
  throw badRequest("destinationAccountId must reference an active account");
}
if (!parseDbBoolean(row.allow_posting)) {
  throw badRequest("destinationAccountId must reference a postable account");
}
if ((await countChildAccountsTx(tx, parsedDestinationAccountId)) > 0) {
  throw badRequest("destinationAccountId must reference a leaf account");
}
if (parsedDestinationAccountId === parsePositiveInt(shareholder?.capitalSubAccountId)) {
  throw badRequest("destinationAccountId cannot be shareholder capital_sub_account_id");
}
if (
  parsedDestinationAccountId === parsePositiveInt(shareholder?.commitmentDebitSubAccountId)
) {
  throw badRequest(
    "destinationAccountId cannot be shareholder commitment_debit_sub_account_id"
  );
}
return {
  mode: "ASSET_GL",
  bankAccountId: null,
  accountId: parsedDestinationAccountId,
  accountCode: String(row.code || ""),
  accountName: String(row.name || ""),
  displayName: `${String(row.code || "").trim()} - ${String(row.name || "").trim()}`.trim(),
};
}

async function resolveCashSessionForFulfillmentTx(tx, {
tenantId,
cashRegister,
cashSessionId,
}) {
const parsedCashSessionId = parsePositiveInt(cashSessionId);
const sessionMode = normalizeUpperText(cashRegister?.session_mode);
if (sessionMode === "REQUIRED" && !parsedCashSessionId) {
  throw badRequest(
    "cashSessionId is required because selected cash register has session_mode=REQUIRED."
  );
}
if (!parsedCashSessionId) {
  return null;
}
const session = await findCashSessionById({
  tenantId,
  sessionId: parsedCashSessionId,
  runQuery: tx.query,
});
if (!session) {
  throw badRequest("cashSessionId not found for tenant");
}
if (parsePositiveInt(session.cash_register_id) !== parsePositiveInt(cashRegister?.id)) {
  throw badRequest("cashSessionId must belong to cashRegisterId");
}
if (normalizeUpperText(session.status) !== "OPEN") {
  throw badRequest("cashSessionId must be OPEN");
}
return {
  id: parsedCashSessionId,
  status: normalizeUpperText(session.status),
};
}

async function loadCashRegisterDestinationTx(tx, {
req,
tenantId,
legalEntityId,
cashRegisterId,
cashSessionId,
amountBase,
journalContext,
operatingUnit,
assertScopeAccess,
}) {
const parsedCashRegisterId = parsePositiveInt(cashRegisterId);
if (!parsedCashRegisterId) {
  throw badRequest("cashRegisterId must be a positive integer");
}
const register = await findCashRegisterById({
  tenantId,
  registerId: parsedCashRegisterId,
  runQuery: tx.query,
});
if (!register) {
  throw badRequest("cashRegisterId not found for tenant");
}
assertScopeAccess(req, "legal_entity", register.legal_entity_id, "cashRegisterId");
await assertRegisterOperationalConfig(register, {
  requireActive: true,
  requireCashControlledAccount: true,
  label: "cashRegisterId",
  runQuery: tx.query,
});
if (parsePositiveInt(register.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
  throw badRequest("cashRegisterId must belong to legalEntityId");
}
const registerOperatingUnitId = parsePositiveInt(register.operating_unit_id);
if (registerOperatingUnitId) {
  assertScopeAccess(req, "operating_unit", registerOperatingUnitId, "cashRegisterId");
}
if (operatingUnit) {
  if (registerOperatingUnitId !== parsePositiveInt(operatingUnit.id)) {
    throw badRequest("cashRegisterId must belong to operatingUnitId");
  }
} else if (registerOperatingUnitId) {
  throw badRequest("Central fulfillment requires a cashRegisterId without OU ownership");
}
if (Number(register.max_txn_amount || 0) > 0 && Number(amountBase) > Number(register.max_txn_amount)) {
  throw badRequest("amount exceeds register max_txn_amount");
}
const registerCurrencyCode = normalizeCurrencyCode(register.currency_code || "");
if (registerCurrencyCode !== normalizeCurrencyCode(journalContext.baseCurrencyCode || "")) {
  throw badRequest(
    "cashRegisterId currency must match the legalEntity base currency for shareholder capital fulfillment"
  );
}
const session = await resolveCashSessionForFulfillmentTx(tx, {
  tenantId,
  cashRegister: register,
  cashSessionId,
});
return {
  mode: "CASH_REGISTER",
  bankAccountId: null,
  cashRegisterId: parsedCashRegisterId,
  cashRegisterCode: String(register.code || ""),
  cashRegisterName: String(register.name || ""),
  cashSessionId: session?.id || null,
  legalEntityCode: String(register.legal_entity_code || ""),
  accountId: parsePositiveInt(register.account_id),
  accountCode: String(register.account_code || ""),
  accountName: String(register.account_name || ""),
  currencyCode: registerCurrencyCode,
  displayName: `${String(register.code || "").trim()} - ${String(register.name || "").trim()}`.trim(),
};
}

async function buildCapitalFulfillmentPlanTx(tx, payload) {
const amountBase = normalizeMoney(payload.amount);
if (amountBase <= 0) {
  throw badRequest("amount must be greater than zero");
}
const contributionDate = toIsoDate(payload.contributionDate, "contributionDate");
const shareholder = await loadShareholderForFulfillmentTx(tx, {
  tenantId: payload.tenantId,
  legalEntityId: payload.legalEntityId,
  shareholderId: payload.shareholderId,
});
const journalContext = await resolveOpenBookPeriodForLegalEntity(
  tx,
  payload.tenantId,
  payload.legalEntityId,
  contributionDate
);
if (!journalContext?.bookId || !journalContext?.fiscalPeriodId) {
  throw badRequest("No OPEN book/fiscal period found for legalEntityId");
}
if (
  contributionDate < journalContext.startDate ||
  contributionDate > journalContext.endDate
) {
  throw badRequest("contributionDate must be within an OPEN fiscal period for legalEntityId");
}
const operatingUnit = await loadOperatingUnitForFulfillmentTx(tx, {
  req: payload.req,
  tenantId: payload.tenantId,
  legalEntityId: payload.legalEntityId,
  operatingUnitId: payload.operatingUnitId,
  assertScopeAccess: payload.assertScopeAccess,
});
let destination = null;
if (payload.destinationMode === "BANK_ACCOUNT") {
  const bankAccount = await getBankAccountByIdForTenant({
    req: payload.req,
    tenantId: payload.tenantId,
    bankAccountId: payload.bankAccountId,
    assertScopeAccess: payload.assertScopeAccess,
  });
  if (parsePositiveInt(bankAccount.legal_entity_id) !== parsePositiveInt(payload.legalEntityId)) {
    throw badRequest("bankAccountId must belong to legalEntityId");
  }
  if (!parseDbBoolean(bankAccount.is_active)) {
    throw badRequest("bankAccountId must reference an active bank account");
  }
  if (!parsePositiveInt(bankAccount.gl_account_id)) {
    throw badRequest("bankAccountId must resolve to a valid GL account");
  }
  if (normalizeUpperText(bankAccount.gl_account_type) !== "ASSET") {
    throw badRequest("bankAccountId GL account must be an ASSET account");
  }
  if (!parseDbBoolean(bankAccount.gl_account_allow_posting)) {
    throw badRequest("bankAccountId GL account must be postable");
  }
  if (!parseDbBoolean(bankAccount.gl_account_is_active)) {
    throw badRequest("bankAccountId GL account must be active");
  }
  const accountId = parsePositiveInt(bankAccount.gl_account_id);
  if ((await countChildAccountsTx(tx, accountId)) > 0) {
    throw badRequest("bankAccountId GL account must be a leaf account");
  }
  const bankOuId = parsePositiveInt(bankAccount.operating_unit_id);
  if (operatingUnit) {
    if (bankOuId !== operatingUnit.id) {
      throw badRequest("bankAccountId must belong to operatingUnitId");
    }
  } else if (bankOuId) {
    throw badRequest("Central fulfillment requires a bankAccountId without OU ownership");
  }
  destination = {
    mode: "BANK_ACCOUNT",
    bankAccountId: parsePositiveInt(bankAccount.id),
    accountId,
    accountCode: String(bankAccount.gl_account_code || ""),
    accountName: String(bankAccount.gl_account_name || ""),
    displayName: `${String(bankAccount.code || "").trim()} - ${String(
      bankAccount.name || bankAccount.gl_account_name || ""
    ).trim()}`.trim(),
    bankAccountCode: String(bankAccount.code || ""),
    bankAccountName: String(bankAccount.name || ""),
  };
} else if (payload.destinationMode === "ASSET_GL") {
  destination = await loadAssetDestinationAccountTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    destinationAccountId: payload.destinationAccountId,
    shareholder,
  });
} else if (payload.destinationMode === "CASH_REGISTER") {
  destination = await loadCashRegisterDestinationTx(tx, {
    req: payload.req,
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    cashRegisterId: payload.cashRegisterId,
    cashSessionId: payload.cashSessionId,
    amountBase,
    journalContext,
    operatingUnit,
    assertScopeAccess: payload.assertScopeAccess,
  });
} else {
  throw badRequest("destinationMode is invalid");
}
if (
  operatingUnit &&
  (destination.accountId === operatingUnit.centralDueFromAccountId ||
    destination.accountId === operatingUnit.ouDueToCentralAccountId)
) {
  throw badRequest(
    "destination account cannot be the same as the selected OU internal current accounts"
  );
}
const currencyCode = normalizeCurrencyCode(journalContext.baseCurrencyCode || "USD");
const note = clipText(payload.note, 500);
const contributionKind = payload.destinationMode === "ASSET_GL" ? "IN_KIND" : "CASH";
const subledgerReferenceNo = operatingUnit?.hasSubledger
  ? buildSubledgerReferenceNo({
      journalNo: payload.preview ? "PREVIEW" : payload.journalNo,
      shareholderId: shareholder.id,
      operatingUnitId: operatingUnit.id,
      preview: Boolean(payload.preview),
    })
  : null;
const lines = [];
let totalDebitBase = 0;
let totalCreditBase = 0;
if (!operatingUnit) {
  lines.push({
    lineNo: 1,
    accountId: destination.accountId,
    accountCode: destination.accountCode,
    accountName: destination.accountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(
      `Capital fulfillment destination (${shareholder.code})`,
      500
    ),
    subledgerReferenceNo: null,
    currencyCode,
    amountTxn: amountBase,
    debitBase: amountBase,
    creditBase: 0,
  });
  lines.push({
    lineNo: 2,
    accountId: shareholder.commitmentDebitSubAccountId,
    accountCode: shareholder.commitmentDebitSubAccountCode,
    accountName: shareholder.commitmentDebitSubAccountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(
      `Capital fulfillment against commitment (${shareholder.code})`,
      500
    ),
    subledgerReferenceNo: null,
    currencyCode,
    amountTxn: amountBase * -1,
    debitBase: 0,
    creditBase: amountBase,
  });
  totalDebitBase = amountBase;
  totalCreditBase = amountBase;
} else {
  lines.push({
    lineNo: 1,
    accountId: destination.accountId,
    accountCode: destination.accountCode,
    accountName: destination.accountName,
    operatingUnitId: operatingUnit.id,
    operatingUnitCode: operatingUnit.code,
    description: clipText(
      `Capital fulfillment destination (${shareholder.code} -> ${operatingUnit.code})`,
      500
    ),
    subledgerReferenceNo,
    currencyCode,
    amountTxn: amountBase,
    debitBase: amountBase,
    creditBase: 0,
  });
  lines.push({
    lineNo: 2,
    accountId: operatingUnit.ouDueToCentralAccountId,
    accountCode: operatingUnit.ouDueToCentralAccountCode,
    accountName: operatingUnit.ouDueToCentralAccountName,
    operatingUnitId: operatingUnit.id,
    operatingUnitCode: operatingUnit.code,
    description: clipText(`OU due to Central (${operatingUnit.code})`, 500),
    subledgerReferenceNo,
    currencyCode,
    amountTxn: amountBase * -1,
    debitBase: 0,
    creditBase: amountBase,
  });
  lines.push({
    lineNo: 3,
    accountId: operatingUnit.centralDueFromAccountId,
    accountCode: operatingUnit.centralDueFromAccountCode,
    accountName: operatingUnit.centralDueFromAccountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(`Central due from OU (${operatingUnit.code})`, 500),
    subledgerReferenceNo: null,
    currencyCode,
    amountTxn: amountBase,
    debitBase: amountBase,
    creditBase: 0,
  });
  lines.push({
    lineNo: 4,
    accountId: shareholder.commitmentDebitSubAccountId,
    accountCode: shareholder.commitmentDebitSubAccountCode,
    accountName: shareholder.commitmentDebitSubAccountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(
      `Capital fulfillment against commitment (${shareholder.code})`,
      500
    ),
    subledgerReferenceNo: null,
    currencyCode,
    amountTxn: amountBase * -1,
    debitBase: 0,
    creditBase: amountBase,
  });
  totalDebitBase = amountBase * 2;
  totalCreditBase = amountBase * 2;
}
return {
  tenantId: payload.tenantId,
  legalEntityId: payload.legalEntityId,
  shareholder,
  operatingUnit,
  destination,
  amountBase,
  currencyCode,
  contributionKind,
  contributionDate,
  note,
  journalContext,
  totalDebitBase,
  totalCreditBase,
  lines,
  operationalModel: operatingUnit ? "DIRECT_OU_TARGETED" : "HQ_FIRST_CENTRAL_ONLY",
};
}
function formatPreviewResponse(plan) {
return {
  operational_model: plan.operationalModel,
  contribution_kind: plan.contributionKind,
  contribution_date: plan.contributionDate,
  amount_base: plan.amountBase,
  currency_code: plan.currencyCode,
  journal_context: {
    book_id: plan.journalContext.bookId,
    book_code: plan.journalContext.bookCode,
    fiscal_period_id: plan.journalContext.fiscalPeriodId,
    base_currency_code: plan.journalContext.baseCurrencyCode,
    start_date: plan.journalContext.startDate,
    end_date: plan.journalContext.endDate,
  },
  shareholder: {
    id: plan.shareholder.id,
    code: plan.shareholder.code,
    name: plan.shareholder.name,
    commitment_debit_sub_account_id: plan.shareholder.commitmentDebitSubAccountId,
    commitment_debit_sub_account_code: plan.shareholder.commitmentDebitSubAccountCode,
    commitment_debit_sub_account_name: plan.shareholder.commitmentDebitSubAccountName,
  },
  operating_unit: plan.operatingUnit
    ? {
        id: plan.operatingUnit.id,
        code: plan.operatingUnit.code,
        name: plan.operatingUnit.name,
        has_subledger: plan.operatingUnit.hasSubledger,
        central_due_from_account_id: plan.operatingUnit.centralDueFromAccountId,
        central_due_from_account_code: plan.operatingUnit.centralDueFromAccountCode,
        central_due_from_account_name: plan.operatingUnit.centralDueFromAccountName,
        ou_due_to_central_account_id: plan.operatingUnit.ouDueToCentralAccountId,
        ou_due_to_central_account_code: plan.operatingUnit.ouDueToCentralAccountCode,
        ou_due_to_central_account_name: plan.operatingUnit.ouDueToCentralAccountName,
      }
    : null,
  destination: {
    mode: plan.destination.mode,
    bank_account_id: plan.destination.bankAccountId,
    cash_register_id: plan.destination.cashRegisterId || null,
    cash_register_code: plan.destination.cashRegisterCode || null,
    cash_register_name: plan.destination.cashRegisterName || null,
    cash_session_id: plan.destination.cashSessionId || null,
    destination_account_id: plan.destination.accountId,
    destination_account_code: plan.destination.accountCode,
    destination_account_name: plan.destination.accountName,
    display_name: plan.destination.displayName,
  },
  totals: {
    total_debit_base: plan.totalDebitBase,
    total_credit_base: plan.totalCreditBase,
    currency_code: plan.currencyCode,
  },
  lines: plan.lines.map((line) => ({
    line_no: line.lineNo,
    account_id: line.accountId,
    account_code: line.accountCode,
    account_name: line.accountName,
    operating_unit_id: line.operatingUnitId,
    operating_unit_code: line.operatingUnitCode,
    description: line.description,
    subledger_reference_no: line.subledgerReferenceNo,
    currency_code: line.currencyCode,
    amount_txn: line.amountTxn,
    debit_base: line.debitBase,
    credit_base: line.creditBase,
  })),
};
}

function buildCapitalFulfillmentCentralJournalLines(plan) {
if (!plan?.operatingUnit) {
  throw badRequest("Central capital journal requires an operating unit fulfillment plan");
}
return [
  {
    lineNo: 1,
    accountId: plan.operatingUnit.centralDueFromAccountId,
    accountCode: plan.operatingUnit.centralDueFromAccountCode,
    accountName: plan.operatingUnit.centralDueFromAccountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(`Central due from OU (${plan.operatingUnit.code})`, 500),
    subledgerReferenceNo: null,
    currencyCode: plan.currencyCode,
    amountTxn: plan.amountBase,
    debitBase: plan.amountBase,
    creditBase: 0,
  },
  {
    lineNo: 2,
    accountId: plan.shareholder.commitmentDebitSubAccountId,
    accountCode: plan.shareholder.commitmentDebitSubAccountCode,
    accountName: plan.shareholder.commitmentDebitSubAccountName,
    operatingUnitId: null,
    operatingUnitCode: null,
    description: clipText(
      `Capital fulfillment against commitment (${plan.shareholder.code})`,
      500
    ),
    subledgerReferenceNo: null,
    currencyCode: plan.currencyCode,
    amountTxn: plan.amountBase * -1,
    debitBase: 0,
    creditBase: plan.amountBase,
  },
];
}

async function insertJournalForCapitalFulfillmentTx(
tx,
plan,
userId,
{ descriptionOverride = null, journalLines = null, referenceSuffix = null } = {}
) {
const journalNo = generateAutoJournalNo("SERFUL");
const description = clipText(
  descriptionOverride ||
    (plan.operatingUnit
      ? `Capital fulfillment - ${plan.shareholder.code} - OU ${plan.operatingUnit.code}`
      : `Capital fulfillment - ${plan.shareholder.code}`),
  500
);
const postingLines = (Array.isArray(journalLines) && journalLines.length ? journalLines : plan.lines).map(
  (line, index) => ({
    ...line,
    lineNo: index + 1,
  })
);
let totalDebitBase = 0;
let totalCreditBase = 0;
for (const line of postingLines) {
  totalDebitBase += Number(line.debitBase || 0);
  totalCreditBase += Number(line.creditBase || 0);
}
const referenceNo = clipText(
  `SHAREHOLDER_CAPITAL_FULFILLMENT:${plan.shareholder.id}:${
    referenceSuffix || Date.now()
  }`,
  100
);
await ensurePeriodOpen(
  plan.journalContext.bookId,
  plan.journalContext.fiscalPeriodId,
  "post shareholder capital fulfillment",
  tx.query.bind(tx)
);
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
      created_by_user_id,
      posted_by_user_id,
      posted_at
    )
    VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  [
    plan.tenantId,
    plan.legalEntityId,
    plan.journalContext.bookId,
    plan.journalContext.fiscalPeriodId,
    journalNo,
    plan.contributionDate,
    plan.contributionDate,
    plan.currencyCode,
    description,
    referenceNo,
    totalDebitBase,
    totalCreditBase,
    userId,
    userId,
  ]
);
const journalEntryId = parsePositiveInt(entryResult.rows?.insertId);
if (!journalEntryId) {
  throw new Error("Failed to create shareholder capital fulfillment journal");
}
for (const sourceLine of postingLines) {
  const subledgerReferenceNo =
    sourceLine.operatingUnitId && plan.operatingUnit?.hasSubledger
      ? buildSubledgerReferenceNo({
          journalNo,
          shareholderId: plan.shareholder.id,
          operatingUnitId: sourceLine.operatingUnitId,
        })
      : null;
  // eslint-disable-next-line no-await-in-loop
  await tx.query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        subledger_reference_no,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      journalEntryId,
      sourceLine.lineNo,
      sourceLine.accountId,
      sourceLine.operatingUnitId,
      sourceLine.description,
      subledgerReferenceNo,
      sourceLine.currencyCode,
      sourceLine.amountTxn,
      sourceLine.debitBase,
      sourceLine.creditBase,
    ]
  );
}
return {
  journalEntryId,
  journalNo,
};
}

async function loadJournalEntryHeaderTx(tx, { tenantId, journalEntryId }) {
const result = await tx.query(
  `SELECT id, journal_no
   FROM journal_entries
   WHERE id = ?
     AND tenant_id = ?
   LIMIT 1`,
  [journalEntryId, tenantId]
);
const row = result.rows?.[0] || null;
if (!row) {
  throw badRequest("Capital fulfillment journal not found");
}
return {
  journalEntryId: parsePositiveInt(row.id),
  journalNo: String(row.journal_no || ""),
};
}

async function createCashRegisterFulfillmentPostingTx(tx, { req, plan, userId }) {
const idempotencyKey = buildCashFulfillmentToken({
  tenantId: plan.tenantId,
  shareholderId: plan.shareholder.id,
  registerId: plan.destination.cashRegisterId,
  contributionDate: plan.contributionDate,
});
const integrationEventUid = `EV:${idempotencyKey}`.slice(0, 100);
const txnNo = await generateCashTxnNoForLegalEntityYearTx({
  tenantId: plan.tenantId,
  legalEntityId: plan.legalEntityId,
  legalEntityCode: plan.destination.legalEntityCode || "",
  bookDate: plan.contributionDate,
  runQuery: tx.query,
});
const transactionId = await insertCashTransaction({
  payload: {
    tenantId: plan.tenantId,
    registerId: plan.destination.cashRegisterId,
    cashSessionId: plan.destination.cashSessionId || null,
    txnNo,
    txnType: "RECEIPT",
    status: "DRAFT",
    txnDatetime: `${plan.contributionDate} 12:00:00`,
    bookDate: plan.contributionDate,
    amount: Number(plan.amountBase).toFixed(6),
    amountBase: Number(plan.amountBase).toFixed(6),
    currencyCode: plan.destination.currencyCode || plan.currencyCode,
    fxRate: Number(1).toFixed(10),
    fxRateSource: "PARITY",
    fxRateDate: plan.contributionDate,
    fxFallbackMode: null,
    fxFallbackMaxDays: null,
    description: clipText(
      plan.operatingUnit
        ? `Shareholder capital fulfillment (${plan.shareholder.code} -> ${plan.operatingUnit.code})`
        : `Shareholder capital fulfillment (${plan.shareholder.code})`,
      255
    ),
    referenceNo: clipText(
      `SCF:${plan.shareholder.id}:${plan.destination.cashRegisterId}:${plan.contributionDate}`,
      100
    ),
    sourceDocType: null,
    sourceDocId: null,
    sourceModule: "SYSTEM",
    sourceEntityType: "shareholder_capital_fulfillment",
    sourceEntityId: "PENDING",
    integrationLinkStatus: "LINKED",
    counterpartyType: null,
    counterpartyId: null,
    counterAccountId: plan.operatingUnit
      ? plan.operatingUnit.ouDueToCentralAccountId
      : plan.shareholder.commitmentDebitSubAccountId,
    counterCashRegisterId: null,
    linkedCariSettlementBatchId: null,
    linkedCariUnappliedCashId: null,
    reversalOfTransactionId: null,
    overrideCashControl: false,
    overrideReason: null,
    idempotencyKey,
    integrationEventUid,
    userId,
    postedByUserId: null,
    postedAt: null,
  },
  runQuery: tx.query,
});
const draftCashTransaction = await findCashTransactionById({
  tenantId: plan.tenantId,
  transactionId,
  runQuery: tx.query,
});
if (!draftCashTransaction) {
  throw badRequest("Failed to create capital fulfillment cash transaction");
}
const posting = await createAndPostCashJournalTx(tx, {
  tenantId: plan.tenantId,
  userId,
  legalEntityId: plan.legalEntityId,
  cashTxn: draftCashTransaction,
  req,
});
await postCashTransaction({
  tenantId: plan.tenantId,
  transactionId,
  userId,
  postedJournalEntryId: posting.journalEntryId,
  overrideCashControl: false,
  overrideReason: null,
  runQuery: tx.query,
});
const postedCashTransaction = await findCashTransactionById({
  tenantId: plan.tenantId,
  transactionId,
  runQuery: tx.query,
});
if (!postedCashTransaction) {
  throw badRequest("Failed to load posted capital fulfillment cash transaction");
}
await applyCashFxPositionForPostedTransactionTx({
  tenantId: plan.tenantId,
  cashTransactionId: transactionId,
  cashTransactionRow: postedCashTransaction,
  runQuery: tx.query,
});
const journalHeader = await loadJournalEntryHeaderTx(tx, {
  tenantId: plan.tenantId,
  journalEntryId: posting.journalEntryId,
});
if (!plan.operatingUnit) {
  return {
    cashTransactionId: transactionId,
    journalEntryId: journalHeader.journalEntryId,
    journalNo: journalHeader.journalNo,
  };
}
const capitalJournal = await insertJournalForCapitalFulfillmentTx(tx, plan, userId, {
  descriptionOverride: clipText(
    `Capital fulfillment - ${plan.shareholder.code} - central capital layer for OU ${plan.operatingUnit.code}`,
    500
  ),
  journalLines: buildCapitalFulfillmentCentralJournalLines(plan),
  referenceSuffix: `CENTRAL:${plan.operatingUnit.id}:${Date.now()}`,
});
return {
  cashTransactionId: transactionId,
  cashJournalEntryId: journalHeader.journalEntryId,
  cashJournalNo: journalHeader.journalNo,
  journalEntryId: capitalJournal.journalEntryId,
  journalNo: capitalJournal.journalNo,
};
}

async function reverseCashRegisterFulfillmentTx(tx, {
req,
tenantId,
cashTransactionId,
userId,
reason,
}) {
const original = await findCashTransactionById({
  tenantId,
  transactionId: cashTransactionId,
  runQuery: tx.query,
  forUpdate: true,
});
if (!original) {
  throw badRequest("Capital fulfillment cash transaction not found");
}
const existingReversal = await findCashTransactionByReversalOf({
  tenantId,
  transactionId: cashTransactionId,
  runQuery: tx.query,
});
if (normalizeUpperText(original.status) === "REVERSED" && existingReversal) {
  await applyCashFxPositionForPostedTransactionTx({
    tenantId,
    cashTransactionId: parsePositiveInt(existingReversal.id),
    cashTransactionRow: existingReversal,
    runQuery: tx.query,
  });
  return {
    reversalCashTransactionId: parsePositiveInt(existingReversal.id),
    reversalJournalId: parsePositiveInt(existingReversal.posted_journal_entry_id),
    idempotentReplay: true,
  };
}
if (parsePositiveInt(original.reversal_of_transaction_id)) {
  throw badRequest("Reversal transactions cannot be reversed");
}
if (normalizeUpperText(original.status) !== "POSTED") {
  throw badRequest("Only POSTED cash transactions can be reversed");
}
const reversalBookDate = new Date().toISOString().slice(0, 10);
const reversalReason = clipText(reason || "Shareholder capital fulfillment reversal", 255);
const reversalTxnNo = await generateCashTxnNoForLegalEntityYearTx({
  tenantId,
  legalEntityId: parsePositiveInt(original.legal_entity_id),
  legalEntityCode: String(original.legal_entity_code || ""),
  bookDate: reversalBookDate,
  runQuery: tx.query,
});
const reversalId = await insertCashTransaction({
  payload: {
    tenantId,
    registerId: parsePositiveInt(original.cash_register_id),
    cashSessionId: parsePositiveInt(original.cash_session_id) || null,
    txnNo: reversalTxnNo,
    txnType: original.txn_type,
    status: "DRAFT",
    txnDatetime: nowMysqlDateTime(),
    bookDate: reversalBookDate,
    amount: Number(original.amount || 0).toFixed(6),
    amountBase: Number(original.amount_base || original.amount || 0).toFixed(6),
    currencyCode: String(original.currency_code || ""),
    fxRate: Number(original.fx_rate || 1).toFixed(10),
    fxRateSource: String(original.fx_rate_source || "PARITY"),
    fxRateDate: original.fx_rate_date || reversalBookDate,
    fxFallbackMode: original.fx_fallback_mode || null,
    fxFallbackMaxDays:
      original.fx_fallback_max_days === undefined ? null : original.fx_fallback_max_days,
    description: clipText(
      `Reversal of ${original.txn_no}: ${reversalReason}`,
      255
    ),
    referenceNo: clipText(original.reference_no, 100),
    sourceDocType: original.source_doc_type || null,
    sourceDocId: original.source_doc_id || null,
    sourceModule: "CASH",
    sourceEntityType: "cash_transaction_reversal",
    sourceEntityId: String(original.id),
    integrationLinkStatus: "UNLINKED",
    counterpartyType: original.counterparty_type || null,
    counterpartyId: parsePositiveInt(original.counterparty_id) || null,
    counterAccountId: parsePositiveInt(original.counter_account_id) || null,
    counterCashRegisterId: parsePositiveInt(original.counter_cash_register_id) || null,
    linkedCariSettlementBatchId: null,
    linkedCariUnappliedCashId: null,
    reversalOfTransactionId: original.id,
    overrideCashControl: false,
    overrideReason: null,
    idempotencyKey: `REV-${original.id}`.slice(0, 100),
    integrationEventUid: `REV-${original.id}`.slice(0, 100),
    userId,
    postedByUserId: null,
    postedAt: null,
  },
  runQuery: tx.query,
});
let reversal = await findCashTransactionById({
  tenantId,
  transactionId: reversalId,
  runQuery: tx.query,
});
if (!reversal) {
  throw badRequest("Failed to create reversal cash transaction");
}
const posting = await createAndPostCashJournalTx(tx, {
  tenantId,
  userId,
  legalEntityId: parsePositiveInt(reversal.legal_entity_id),
  cashTxn: reversal,
  req,
});
await postCashTransaction({
  tenantId,
  transactionId: reversalId,
  userId,
  postedJournalEntryId: posting.journalEntryId,
  overrideCashControl: false,
  overrideReason: null,
  runQuery: tx.query,
});
reversal = await findCashTransactionById({
  tenantId,
  transactionId: reversalId,
  runQuery: tx.query,
});
if (!reversal) {
  throw badRequest("Failed to load posted reversal cash transaction");
}
await applyCashFxPositionForPostedTransactionTx({
  tenantId,
  cashTransactionId: reversalId,
  cashTransactionRow: reversal,
  runQuery: tx.query,
});
await markCashTransactionAsReversed({
  tenantId,
  transactionId: cashTransactionId,
  userId,
  runQuery: tx.query,
});
return {
  reversalCashTransactionId: reversalId,
  reversalJournalId: parsePositiveInt(reversal.posted_journal_entry_id),
  idempotentReplay: false,
};
}

async function insertCapitalFulfillmentRowTx(
tx,
{ plan, userId, journalEntryId, cashTransactionId = null, cashReversalTransactionId = null }
) {
const result = await tx.query(
  `INSERT INTO shareholder_capital_fulfillments (
      tenant_id,
      legal_entity_id,
      shareholder_id,
      operating_unit_id,
      destination_mode,
      bank_account_id,
      cash_register_id,
      cash_session_id,
      cash_transaction_id,
      cash_reversal_transaction_id,
      destination_account_id,
      amount_base,
      currency_code,
      contribution_kind,
      status,
      journal_entry_id,
      reversal_journal_entry_id,
      contribution_date,
      note,
      created_by_user_id,
      posted_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, NULL, ?, ?, ?, ?)`,
  [
    plan.tenantId,
    plan.legalEntityId,
    plan.shareholder.id,
    plan.operatingUnit?.id || null,
    plan.destination.mode,
    plan.destination.bankAccountId || null,
    plan.destination.cashRegisterId || null,
    plan.destination.cashSessionId || null,
    cashTransactionId,
    cashReversalTransactionId,
    plan.destination.mode === "ASSET_GL" ? plan.destination.accountId : null,
    plan.amountBase,
    plan.currencyCode,
    plan.contributionKind,
    journalEntryId,
    plan.contributionDate,
    plan.note,
    userId,
    userId,
  ]
);
return parsePositiveInt(result.rows?.insertId);
}

async function loadCapitalFulfillmentRowTx(tx, tenantId, fulfillmentId, { forUpdate = false } = {}) {
const result = await tx.query(
  `SELECT
     scf.*,
     s.code AS shareholder_code,
     s.name AS shareholder_name
   FROM shareholder_capital_fulfillments scf
   JOIN shareholders s
     ON s.id = scf.shareholder_id
   WHERE scf.id = ?
     AND scf.tenant_id = ?
   LIMIT 1
   ${forUpdate ? "FOR UPDATE" : ""}`,
  [fulfillmentId, tenantId]
);
return result.rows?.[0] || null;
}

async function reverseJournalEntryForFulfillmentTx(tx, { tenantId, journalId, userId, reason }) {
const journalResult = await tx.query(
  `SELECT
     book_id,
     fiscal_period_id,
     journal_no,
     entry_date,
     document_date
   FROM journal_entries
   WHERE id = ?
     AND tenant_id = ?
   LIMIT 1
   FOR UPDATE`,
  [journalId, tenantId]
);
const original = journalResult.rows?.[0] || null;
if (!original) {
  throw badRequest("Capital fulfillment journal not found");
}
await ensurePeriodOpen(
  parsePositiveInt(original.book_id),
  parsePositiveInt(original.fiscal_period_id),
  "reverse shareholder capital fulfillment",
  tx.query.bind(tx)
);
const reversalReason = clipText(reason || "Shareholder capital fulfillment reversal", 255);
const reversalJournalNo = clipText(`${original.journal_no}-REV`, 40);
const result = await reverseJournalEntryTx(tx, {
  tenantId,
  journalId,
  userId,
  reason: reversalReason,
  reversalPeriodId: parsePositiveInt(original.fiscal_period_id),
  entryDate: toIsoDate(original.entry_date, "entry_date"),
  documentDate: toIsoDate(original.document_date, "document_date"),
  journalNo: reversalJournalNo,
  autoPost: true,
  idempotentOnAlreadyReversed: true,
});
return {
  reversalJournalId: result.reversalJournalId,
  idempotentReplay: Boolean(result.idempotentReplay),
};
}

export async function previewShareholderCapitalFulfillment({
req,
tenantId,
legalEntityId,
shareholderId,
operatingUnitId,
destinationMode,
bankAccountId,
destinationAccountId,
cashRegisterId,
cashSessionId,
amount,
contributionDate,
note,
assertLegalEntityBelongsToTenant: assertLegalEntityBelongsToTenantFn = assertLegalEntityBelongsToTenant,
assertScopeAccess,
}) {
await assertLegalEntityBelongsToTenantFn(tenantId, legalEntityId, "legalEntityId");
assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
const preview = await withTransaction(async (tx) => {
  const plan = await buildCapitalFulfillmentPlanTx(tx, {
    req,
    tenantId,
    legalEntityId,
    shareholderId,
    operatingUnitId,
    destinationMode,
    bankAccountId,
    destinationAccountId,
    cashRegisterId,
    cashSessionId,
    amount,
    contributionDate,
    note,
    preview: true,
    assertScopeAccess,
  });
  return formatPreviewResponse(plan);
});
return preview;
}

export async function createShareholderCapitalFulfillment({
req,
tenantId,
legalEntityId,
shareholderId,
operatingUnitId,
destinationMode,
bankAccountId,
destinationAccountId,
cashRegisterId,
cashSessionId,
amount,
contributionDate,
note,
userId,
assertLegalEntityBelongsToTenant: assertLegalEntityBelongsToTenantFn = assertLegalEntityBelongsToTenant,
assertScopeAccess,
}) {
await assertLegalEntityBelongsToTenantFn(tenantId, legalEntityId, "legalEntityId");
assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
return withTransaction(async (tx) => {
  const plan = await buildCapitalFulfillmentPlanTx(tx, {
    req,
    tenantId,
    legalEntityId,
    shareholderId,
    operatingUnitId,
    destinationMode,
    bankAccountId,
    destinationAccountId,
    cashRegisterId,
    cashSessionId,
    amount,
    contributionDate,
    note,
    preview: false,
    assertScopeAccess,
  });
  const journal =
    plan.destination.mode === "CASH_REGISTER"
      ? await createCashRegisterFulfillmentPostingTx(tx, {
          req,
          plan,
          userId,
        })
      : await insertJournalForCapitalFulfillmentTx(tx, plan, userId);
  const fulfillmentId = await insertCapitalFulfillmentRowTx(tx, {
    plan,
    userId,
    journalEntryId: journal.journalEntryId,
    cashTransactionId:
      plan.destination.mode === "CASH_REGISTER" ? journal.cashTransactionId : null,
  });
  if (!fulfillmentId) {
    throw new Error("Failed to create shareholder capital fulfillment row");
  }
  if (plan.destination.mode === "CASH_REGISTER") {
    await tx.query(
      `UPDATE cash_transactions
       SET source_entity_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [String(fulfillmentId), tenantId, journal.cashTransactionId]
    );
  }
  return {
    fulfillmentId,
    status: "POSTED",
    journalEntryId: journal.journalEntryId,
    journalNo: journal.journalNo,
    cashTransactionId: journal.cashTransactionId || null,
    preview: formatPreviewResponse(plan),
  };
});
}

export async function listShareholderCapitalFulfillments({
req,
tenantId,
filters,
buildScopeFilter,
assertLegalEntityBelongsToTenant: assertLegalEntityBelongsToTenantFn = assertLegalEntityBelongsToTenant,
assertOperatingUnitBelongsToTenant: assertOperatingUnitBelongsToTenantFn = assertOperatingUnitBelongsToTenant,
assertScopeAccess,
}) {
if (filters.legalEntityId) {
  await assertLegalEntityBelongsToTenantFn(tenantId, filters.legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
}
if (filters.operatingUnitId) {
  const operatingUnit = await assertOperatingUnitBelongsToTenantFn(
    tenantId,
    filters.operatingUnitId,
    "operatingUnitId"
  );
  if (
    filters.legalEntityId &&
    parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(filters.legalEntityId)
  ) {
    throw badRequest("operatingUnitId must belong to legalEntityId");
  }
  assertScopeAccess(req, "operating_unit", filters.operatingUnitId, "operatingUnitId");
}
const params = [tenantId];
const conditions = ["scf.tenant_id = ?"];
conditions.push(buildScopeFilter(req, "legal_entity", "scf.legal_entity_id", params));
if (filters.legalEntityId) {
  conditions.push("scf.legal_entity_id = ?");
  params.push(filters.legalEntityId);
}
if (filters.shareholderId) {
  conditions.push("scf.shareholder_id = ?");
  params.push(filters.shareholderId);
}
if (filters.operatingUnitId) {
  conditions.push("scf.operating_unit_id = ?");
  params.push(filters.operatingUnitId);
}
if (filters.status) {
  conditions.push("scf.status = ?");
  params.push(filters.status);
}
const result = await query(
  `SELECT
     scf.id,
     scf.tenant_id,
     scf.legal_entity_id,
     scf.shareholder_id,
     scf.operating_unit_id,
     scf.destination_mode,
     scf.bank_account_id,
     scf.cash_register_id,
     scf.cash_session_id,
     scf.cash_transaction_id,
     scf.cash_reversal_transaction_id,
     scf.destination_account_id,
     scf.amount_base,
     scf.currency_code,
     scf.contribution_kind,
     scf.status,
     scf.journal_entry_id,
     scf.reversal_journal_entry_id,
     scf.contribution_date,
     scf.note,
     scf.created_by_user_id,
     scf.posted_by_user_id,
     scf.reversed_by_user_id,
     scf.reversed_at,
     scf.created_at,
     scf.updated_at,
     le.code AS legal_entity_code,
     le.name AS legal_entity_name,
     s.code AS shareholder_code,
     s.name AS shareholder_name,
     ou.code AS operating_unit_code,
     ou.name AS operating_unit_name,
     ba.code AS bank_account_code,
     ba.name AS bank_account_name,
     cr.code AS cash_register_code,
     cr.name AS cash_register_name,
     ct.txn_no AS cash_transaction_no,
     ct.posted_journal_entry_id AS cash_journal_entry_id,
     cje.journal_no AS cash_journal_no,
     rct.txn_no AS cash_reversal_transaction_no,
     rct.posted_journal_entry_id AS cash_reversal_journal_entry_id,
     rcje.journal_no AS cash_reversal_journal_no,
     da.code AS destination_account_code,
     da.name AS destination_account_name,
     je.journal_no AS journal_no,
     rje.journal_no AS reversal_journal_no
   FROM shareholder_capital_fulfillments scf
   JOIN legal_entities le
     ON le.id = scf.legal_entity_id
    AND le.tenant_id = scf.tenant_id
   JOIN shareholders s
     ON s.id = scf.shareholder_id
    AND s.tenant_id = scf.tenant_id
   LEFT JOIN operating_units ou
     ON ou.id = scf.operating_unit_id
    AND ou.tenant_id = scf.tenant_id
   LEFT JOIN bank_accounts ba
     ON ba.id = scf.bank_account_id
    AND ba.tenant_id = scf.tenant_id
   LEFT JOIN cash_registers cr
     ON cr.id = scf.cash_register_id
    AND cr.tenant_id = scf.tenant_id
   LEFT JOIN cash_transactions ct
     ON ct.id = scf.cash_transaction_id
    AND ct.tenant_id = scf.tenant_id
   LEFT JOIN journal_entries cje
     ON cje.id = ct.posted_journal_entry_id
    AND cje.tenant_id = scf.tenant_id
   LEFT JOIN cash_transactions rct
     ON rct.id = scf.cash_reversal_transaction_id
    AND rct.tenant_id = scf.tenant_id
   LEFT JOIN journal_entries rcje
     ON rcje.id = rct.posted_journal_entry_id
    AND rcje.tenant_id = scf.tenant_id
   LEFT JOIN accounts da
     ON da.id = scf.destination_account_id
   JOIN journal_entries je
     ON je.id = scf.journal_entry_id
    AND je.tenant_id = scf.tenant_id
   LEFT JOIN journal_entries rje
     ON rje.id = scf.reversal_journal_entry_id
    AND rje.tenant_id = scf.tenant_id
   WHERE ${conditions.join(" AND ")}
   ORDER BY scf.contribution_date DESC, scf.id DESC`,
  params
);
return result.rows || [];
}

export async function reverseShareholderCapitalFulfillment({
req,
tenantId,
fulfillmentId,
userId,
reason,
assertScopeAccess,
}) {
return withTransaction(async (tx) => {
  const fulfillment = await loadCapitalFulfillmentRowTx(tx, tenantId, fulfillmentId, {
    forUpdate: true,
  });
  if (!fulfillment) {
    throw badRequest("Capital fulfillment not found");
  }
  assertScopeAccess(req, "legal_entity", fulfillment.legal_entity_id, "id");
  const existingReversalJournalId = parsePositiveInt(fulfillment.reversal_journal_entry_id);
  if (normalizeUpperText(fulfillment.status) === "REVERSED" && existingReversalJournalId) {
    return {
      fulfillmentId,
      status: "REVERSED",
      journalEntryId: parsePositiveInt(fulfillment.journal_entry_id),
      reversalJournalEntryId: existingReversalJournalId,
      cashReversalTransactionId:
        parsePositiveInt(fulfillment.cash_reversal_transaction_id) || null,
      idempotentReplay: true,
    };
  }
  const isCashRegisterFulfillment =
    normalizeUpperText(fulfillment.destination_mode) === "CASH_REGISTER";
  let reversal = null;
  if (isCashRegisterFulfillment) {
    const cashReversal = await reverseCashRegisterFulfillmentTx(tx, {
      req,
      tenantId,
      cashTransactionId: parsePositiveInt(fulfillment.cash_transaction_id),
      userId,
      reason,
    });
    if (parsePositiveInt(fulfillment.operating_unit_id)) {
      const centralJournalReversal = await reverseJournalEntryForFulfillmentTx(tx, {
        tenantId,
        journalId: parsePositiveInt(fulfillment.journal_entry_id),
        userId,
        reason,
      });
      reversal = {
        reversalJournalId: centralJournalReversal.reversalJournalId,
        reversalCashTransactionId: cashReversal.reversalCashTransactionId || null,
        idempotentReplay:
          Boolean(cashReversal.idempotentReplay) &&
          Boolean(centralJournalReversal.idempotentReplay),
      };
    } else {
      reversal = cashReversal;
    }
  } else {
    reversal = await reverseJournalEntryForFulfillmentTx(tx, {
      tenantId,
      journalId: parsePositiveInt(fulfillment.journal_entry_id),
      userId,
      reason,
    });
  }
  const reversalReason = clipText(reason || "Shareholder capital fulfillment reversal", 255);
  await tx.query(
    `UPDATE shareholder_capital_fulfillments
     SET status = 'REVERSED',
         reversal_journal_entry_id = ?,
         cash_reversal_transaction_id = ?,
         reversed_by_user_id = ?,
         reversed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND tenant_id = ?`,
    [
      reversal.reversalJournalId,
      reversal.reversalCashTransactionId || null,
      userId,
      fulfillmentId,
      tenantId,
    ]
  );
  return {
    fulfillmentId,
    status: "REVERSED",
    journalEntryId: parsePositiveInt(fulfillment.journal_entry_id),
    reversalJournalEntryId: reversal.reversalJournalId,
    cashReversalTransactionId: reversal.reversalCashTransactionId || null,
    reverseReason: reversalReason,
    idempotentReplay: reversal.idempotentReplay,
  };
});
}
