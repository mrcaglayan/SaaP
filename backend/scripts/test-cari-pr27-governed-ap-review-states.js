import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  cancelCariDraftDocumentById,
  createCariDraftDocument,
  getCariDocumentByIdForTenant,
  submitCariDocumentById,
  updateCariDraftDocumentById,
} from "../src/services/cari.document.service.js";
import {
  getCariCounterpartyStatementReport,
  getCariOpenItemsReport,
} from "../src/services/cari.report.service.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
  WORKFLOW_GATE_BLOCKING_REASON_CODES,
  getApWorkflowRequiredPermissionCode,
} from "../../shared/cariDocumentWorkflowGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const RETURNED_FOR_CORRECTION_SUMMARY =
  "Returned to Country correction - Country resubmission required";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toIsoPrefix(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "cari-pr27-governed-ap-review-states",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() {}

async function expectThrows(promiseFactory, expectedMessage, expectedStatus = null) {
  try {
    await promiseFactory();
  } catch (error) {
    if (expectedMessage) {
      assert(
        String(error?.message || "").includes(expectedMessage),
        `Expected error message to include "${expectedMessage}", got "${error?.message || ""}"`
      );
    }
    if (expectedStatus !== null) {
      assert(
        Number(error?.status || 0) === Number(expectedStatus),
        `Expected status ${expectedStatus}, got ${error?.status || 0}`
      );
    }
    return error;
  }
  throw new Error(`Expected error containing "${expectedMessage}"`);
}

async function createTenant(code, name) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, name]
  );
  const result = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  const tenantId = toPositiveInt(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

async function createUser({ tenantId, email, name, passwordHash = "test-hash" }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const result = await query(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND email = ?
      LIMIT 1`,
    [tenantId, email]
  );
  const userId = toPositiveInt(result.rows?.[0]?.id);
  assert(userId > 0, `Failed to resolve user id for ${email}`);
  return userId;
}

async function createOrgFixtures({ tenantId, stamp }) {
  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'US'
      LIMIT 1`
  );
  const countryId = toPositiveInt(countryResult.rows?.[0]?.id);
  const currencyCode = String(
    countryResult.rows?.[0]?.default_currency_code || "USD"
  ).toUpperCase();
  assert(countryId > 0, "US country row is required");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `CPR27GC${stamp}`, `CARI PR27 Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `CPR27GC${stamp}`]
  );
  const groupId = toPositiveInt(groupResult.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create group company");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      groupId,
      `CPR27LE${stamp}`,
      `CARI PR27 LE ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const legalEntityResult = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `CPR27LE${stamp}`]
  );
  const legalEntityId = toPositiveInt(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity");

  await query(
    `INSERT INTO payment_terms (
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, `CPR27TERM${stamp}`, `CARI PR27 Term ${stamp}`]
  );
  const paymentTermResult = await query(
    `SELECT id, code
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `CPR27TERM${stamp}`]
  );
  const paymentTermId = toPositiveInt(paymentTermResult.rows?.[0]?.id);
  const paymentTermCode = String(paymentTermResult.rows?.[0]?.code || "").trim();
  assert(paymentTermId > 0, "Failed to create payment term");

  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES
       (?, ?, ?, ?, FALSE, TRUE, ?, ?, 'ACTIVE'),
       (?, ?, ?, ?, TRUE, FALSE, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `CPR27V${stamp}`,
      `CARI PR27 Vendor ${stamp}`,
      currencyCode,
      paymentTermId,
      tenantId,
      legalEntityId,
      `CPR27C${stamp}`,
      `CARI PR27 Customer ${stamp}`,
      currencyCode,
      paymentTermId,
    ]
  );
  const counterpartyRows = await query(
    `SELECT id, code, name, is_vendor, is_customer
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code IN (?, ?)
      ORDER BY code`,
    [tenantId, legalEntityId, `CPR27V${stamp}`, `CPR27C${stamp}`]
  );
  let vendor = null;
  let customer = null;
  for (const row of counterpartyRows.rows || []) {
    if (row.is_vendor) {
      vendor = row;
    }
    if (row.is_customer) {
      customer = row;
    }
  }
  assert(toPositiveInt(vendor?.id) > 0, "Vendor counterparty missing");
  assert(toPositiveInt(customer?.id) > 0, "Customer counterparty missing");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     )
     VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `CPR27CAL${stamp}`, `CARI PR27 Calendar ${stamp}`]
  );
  const calendarResult = await query(
    `SELECT id
       FROM fiscal_calendars
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `CPR27CAL${stamp}`]
  );
  const calendarId = toPositiveInt(calendarResult.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create fiscal calendar");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
     )
     VALUES (?, 2026, 1, 'FY2026', '2026-01-01', '2026-12-31', FALSE)
     ON DUPLICATE KEY UPDATE period_name = VALUES(period_name)`,
    [calendarId]
  );
  const fiscalPeriodResult = await query(
    `SELECT id
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND fiscal_year = 2026
        AND period_no = 1
      LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = toPositiveInt(fiscalPeriodResult.rows?.[0]?.id);
  assert(fiscalPeriodId > 0, "Failed to create fiscal period");

  await query(
    `INSERT INTO books (
        tenant_id,
        legal_entity_id,
        calendar_id,
        code,
        name,
        book_type,
        base_currency_code
     )
     VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [
      tenantId,
      legalEntityId,
      calendarId,
      `CPR27BOOK${stamp}`,
      `CARI PR27 Book ${stamp}`,
      currencyCode,
    ]
  );
  const bookResult = await query(
    `SELECT id
       FROM books
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `CPR27BOOK${stamp}`]
  );
  const bookId = toPositiveInt(bookResult.rows?.[0]?.id);
  assert(bookId > 0, "Failed to create book");

  return {
    countryId,
    currencyCode,
    legalEntityId,
    paymentTermId,
    paymentTermCode,
    vendorId: toPositiveInt(vendor?.id),
    vendorCode: String(vendor?.code || "").trim(),
    vendorName: String(vendor?.name || "").trim(),
    customerId: toPositiveInt(customer?.id),
    customerCode: String(customer?.code || "").trim(),
    customerName: String(customer?.name || "").trim(),
    bookId,
    fiscalPeriodId,
  };
}

async function createGovernedApWorkflowAssignment({
  tenantId,
  userId,
  countryId,
  stamp,
}) {
  const workflowCode = `CPR27APWF${stamp}`;
  await query(
    `INSERT INTO workflow_definitions (
        tenant_id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, TRUE, 1, ?)`,
    [
      tenantId,
      workflowCode,
      `CARI PR27 AP Workflow ${stamp}`,
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      userId,
    ]
  );
  const definitionResult = await query(
    `SELECT id
       FROM workflow_definitions
      WHERE tenant_id = ?
        AND code = ?
        AND version_no = 1
      LIMIT 1`,
    [tenantId, workflowCode]
  );
  const workflowDefinitionId = toPositiveInt(definitionResult.rows?.[0]?.id);
  assert(workflowDefinitionId > 0, "Failed to create governed AP workflow definition");

  await query(
    `INSERT INTO workflow_definition_steps (
        workflow_definition_id,
        step_no,
        action_code,
        stage_scope_type,
        required_permission_code,
        min_approver_count,
        allow_self_approve,
        escalation_after_hours
     )
     VALUES
       (?, 1, 'SUBMIT', 'COUNTRY', ?, 1, FALSE, NULL),
       (?, 2, 'APPROVE', 'COUNTRY', ?, 1, FALSE, NULL),
       (?, 3, 'POST', 'COUNTRY', ?, 1, FALSE, NULL)`,
    [
      workflowDefinitionId,
      getApWorkflowRequiredPermissionCode("SUBMIT"),
      workflowDefinitionId,
      getApWorkflowRequiredPermissionCode("APPROVE"),
      workflowDefinitionId,
      getApWorkflowRequiredPermissionCode("POST"),
    ]
  );

  await query(
    `INSERT INTO workflow_assignments (
        tenant_id,
        process_type,
        workflow_definition_id,
        group_company_id,
        country_id,
        legal_entity_id,
        operating_unit_id,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, ?, ?, NULL, ?, NULL, NULL, '2026-01-01', NULL, 'ACTIVE', ?)`,
    [tenantId, AP_DOCUMENT_WORKFLOW_PROCESS_TYPE, workflowDefinitionId, countryId, userId]
  );
  const assignmentResult = await query(
    `SELECT id
       FROM workflow_assignments
      WHERE tenant_id = ?
        AND process_type = ?
        AND workflow_definition_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId, AP_DOCUMENT_WORKFLOW_PROCESS_TYPE, workflowDefinitionId]
  );
  const assignmentId = toPositiveInt(assignmentResult.rows?.[0]?.id);
  assert(assignmentId > 0, "Failed to create governed AP workflow assignment");

  return {
    workflowDefinitionId,
    assignmentId,
  };
}

async function listWorkflowInstancesForDocument({ tenantId, documentId }) {
  const result = await query(
    `SELECT
        id,
        process_type,
        target_type,
        target_id,
        workflow_definition_id,
        status,
        current_step_no,
        generic_request_id
     FROM workflow_instances
     WHERE tenant_id = ?
       AND target_type = ?
       AND target_id = ?
     ORDER BY id ASC`,
    [tenantId, CARI_DOCUMENT_WORKFLOW_TARGET_TYPE, documentId]
  );
  return result.rows || [];
}

async function updateLatestWorkflowInstanceForDocument({
  tenantId,
  documentId,
  status,
  currentStepNo = null,
  decision = "",
  decisionByUserId = null,
  decisionNote = null,
  decisionAt = null,
  resolvedAt = null,
  resolutionNote = null,
}) {
  const workflowInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId,
  });
  const latestInstance = workflowInstances[workflowInstances.length - 1] || null;
  const workflowInstanceId = toPositiveInt(latestInstance?.id);
  assert(
    workflowInstanceId > 0,
    `Workflow instance is required before updating document ${documentId}`
  );

  await query(
    `UPDATE workflow_instances
        SET status = ?,
            current_step_no = COALESCE(?, current_step_no),
            resolved_at = ?,
            resolution_note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [
      status,
      toPositiveInt(currentStepNo) || null,
      resolvedAt || null,
      resolutionNote || decisionNote || null,
      tenantId,
      workflowInstanceId,
    ]
  );

  if (decision) {
    await query(
      `INSERT INTO workflow_instance_decisions (
          workflow_instance_id,
          step_no,
          decision,
          decision_by_user_id,
          decision_note,
          created_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        workflowInstanceId,
        Math.max(1, Number(latestInstance?.current_step_no || 1)),
        decision,
        toPositiveInt(decisionByUserId),
        decisionNote || null,
        decisionAt || "2026-02-01 00:00:00",
      ]
    );
  }

  return workflowInstanceId;
}

async function createDraftDocument({
  req,
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  paymentTermId,
  direction,
  documentType,
  documentDate,
  dueDate,
  currencyCode,
  amountTxn,
  amountBase = amountTxn,
}) {
  return createCariDraftDocument({
    req,
    payload: {
      tenantId,
      userId,
      legalEntityId,
      counterpartyId,
      paymentTermId,
      direction,
      documentType,
      documentDate,
      dueDate,
      amountTxn,
      amountBase,
      currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
}

async function createJournalEntry({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  currencyCode,
  userId,
  stamp,
  suffix,
  amountBase,
  documentDate,
}) {
  const result = await query(
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
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId,
      `CPR27-JE-${stamp}-${suffix}`.slice(0, 40),
      documentDate,
      documentDate,
      currencyCode,
      `CARI PR27 journal ${suffix}`.slice(0, 500),
      `CPR27-${suffix}`.slice(0, 100),
      amountBase,
      amountBase,
      userId,
      userId,
    ]
  );
  const journalEntryId = toPositiveInt(result.rows?.insertId);
  assert(journalEntryId > 0, "Failed to create journal entry");
  return journalEntryId;
}

async function setDocumentStatus({
  tenantId,
  documentId,
  status,
  postedJournalEntryId = null,
  returnReason = null,
  returnedAt = null,
}) {
  await query(
    `UPDATE cari_documents
        SET status = ?,
            posted_journal_entry_id = ?,
            posted_at = CASE WHEN ? = 'POSTED' THEN CURRENT_TIMESTAMP ELSE posted_at END,
            return_reason = ?,
            returned_at = ?,
            row_version = row_version + 1
      WHERE tenant_id = ?
        AND id = ?`,
    [
      status,
      postedJournalEntryId,
      status,
      returnReason,
      returnedAt,
      tenantId,
      documentId,
    ]
  );
}

async function insertOpenItem({
  tenantId,
  legalEntityId,
  counterpartyId,
  documentId,
  documentDate,
  dueDate,
  amountTxn,
  amountBase,
  currencyCode,
}) {
  const result = await query(
    `INSERT INTO cari_open_items (
        tenant_id,
        legal_entity_id,
        counterparty_id,
        document_id,
        item_no,
        status,
        document_date,
        due_date,
        original_amount_txn,
        original_amount_base,
        residual_amount_txn,
        residual_amount_base,
        settled_amount_txn,
        settled_amount_base,
        currency_code
     )
     VALUES (?, ?, ?, ?, 1, 'OPEN', ?, ?, ?, ?, ?, ?, 0.000000, 0.000000, ?)`,
    [
      tenantId,
      legalEntityId,
      counterpartyId,
      documentId,
      documentDate,
      dueDate,
      amountTxn,
      amountBase,
      amountTxn,
      amountBase,
      currencyCode,
    ]
  );
  const openItemId = toPositiveInt(result.rows?.insertId);
  assert(openItemId > 0, "Failed to create open item");
  return openItemId;
}

async function countAuditRows({ tenantId, action, documentId }) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
       FROM audit_logs
      WHERE tenant_id = ?
        AND resource_type = 'cari_document'
        AND action = ?
        AND resource_id = ?`,
    [tenantId, action, String(documentId)]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(
    `CPR27_${stamp}`,
    `CARI PR27 Governed Review ${stamp}`
  );
  const userId = await createUser({
    tenantId,
    email: `cari-pr27-${stamp}@example.com`,
    name: `CARI PR27 User ${stamp}`,
  });
  const fixtures = await createOrgFixtures({ tenantId, stamp });
  const req = makeRequestContext({
    tenantId,
    userId,
    stamp,
    suffix: "base",
  });

  const noAssignmentDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-10",
    dueDate: "2026-03-12",
    currencyCode: fixtures.currencyCode,
    amountTxn: 250,
  });
  const noAssignmentError = await expectThrows(
    () =>
      submitCariDocumentById({
        req,
        payload: {
          tenantId,
          userId,
          documentId: noAssignmentDraft.id,
        },
        assertScopeAccess: allowAllScopes,
      }),
    "No workflow assignment configured for governed AP document",
    409
  );
  assert(
    String(noAssignmentError.code || "") === "NO_WORKFLOW_ASSIGNMENT_CONFIGURED",
    "Governed AP submit without a resolved assignment should use NO_WORKFLOW_ASSIGNMENT_CONFIGURED"
  );
  const noAssignmentReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: noAssignmentDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    noAssignmentReadback.status === "DRAFT",
    "Governed AP submit attempt without assignment must keep document in DRAFT"
  );
  assert(
    noAssignmentReadback.isWorkflowGoverned === true,
    "AP invoice should resolve as workflow-governed from shared defaults"
  );
  assert(
    noAssignmentReadback.workflowGate?.state === "none" &&
      noAssignmentReadback.workflowGate?.assignmentResolved === false,
    "Governed AP readback without assignment should expose a none-state workflow gate without assignment resolution"
  );
  assert(
    noAssignmentReadback.workflowGate?.blockingReasonCode ===
      WORKFLOW_GATE_BLOCKING_REASON_CODES.WORKFLOW_ASSIGNMENT_NOT_RESOLVED &&
      noAssignmentReadback.workflowGate?.blockingReasonDetail ===
        "No workflow assignment configured for this document scope" &&
      noAssignmentReadback.workflowGate?.submitPermissionCode === "cari.doc.submit" &&
      noAssignmentReadback.workflowGate?.postPermissionCode === "cari.doc.post" &&
      noAssignmentReadback.workflowGate?.assignmentScopeType === null &&
      Number(noAssignmentReadback.workflowGate?.totalSteps || 0) === 0,
    "Governed AP readback without assignment should expose structured explainability fields"
  );

  const governedApWorkflow = await createGovernedApWorkflowAssignment({
    tenantId,
    userId,
    countryId: fixtures.countryId,
    stamp,
  });

  const submissionRequiredDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-11",
    dueDate: "2026-03-13",
    currencyCode: fixtures.currencyCode,
    amountTxn: 260,
  });
  const submissionRequiredReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: submissionRequiredDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    submissionRequiredReadback.workflowGate?.state === "blocked" &&
      submissionRequiredReadback.workflowGate?.assignmentResolved === true &&
      submissionRequiredReadback.workflowGate?.assignmentScopeType === "COUNTRY" &&
      toPositiveInt(submissionRequiredReadback.workflowGate?.assignmentScopeId) ===
        fixtures.countryId &&
      submissionRequiredReadback.workflowGate?.assignmentScopeLabel === "Country" &&
      submissionRequiredReadback.workflowGate?.waitingForSummary ===
        "Waiting for Country submission" &&
      submissionRequiredReadback.workflowGate?.blockingReasonCode ===
        WORKFLOW_GATE_BLOCKING_REASON_CODES.WORKFLOW_APPROVAL_REQUIRED &&
      submissionRequiredReadback.workflowGate?.blockingReasonDetail ===
        "Submission is required at Country scope before posting" &&
      submissionRequiredReadback.workflowGate?.submitPermissionCode === "cari.doc.submit" &&
      submissionRequiredReadback.workflowGate?.postPermissionCode === "cari.doc.post" &&
      Number(submissionRequiredReadback.workflowGate?.currentStepNo || 0) === 1 &&
      Number(submissionRequiredReadback.workflowGate?.totalSteps || 0) === 3 &&
      submissionRequiredReadback.workflowGate?.currentActionCode === "SUBMIT" &&
      submissionRequiredReadback.workflowGate?.currentRequiredPermissionCode ===
        "cari.doc.submit" &&
      submissionRequiredReadback.workflowGate?.currentStageScopeType === "COUNTRY" &&
      submissionRequiredReadback.workflowGate?.currentStageScopeLabel === "Country" &&
      submissionRequiredReadback.workflowGate?.nextActionCode === "APPROVE" &&
      submissionRequiredReadback.workflowGate?.nextActionLabel === "Country approval",
    "Governed AP draft readback should expose the explicit blocked-submit step contract"
  );

  const governedSubmitDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-12",
    dueDate: "2026-03-14",
    currencyCode: fixtures.currencyCode,
    amountTxn: 270,
  });
  const submitted = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: governedSubmitDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(submitted.status === "SUBMITTED", "Governed AP doc should submit into SUBMITTED");
  assert(submitted.rowVersion === 2, "Successful submit should increment rowVersion");
  assert(
    submitted.isWorkflowGoverned === true,
    "Successful submit should preserve workflow-governed flag on the response"
  );
  assert(
    submitted.workflowGate?.state === "pending" &&
      submitted.workflowGate?.assignmentResolved === true &&
      toPositiveInt(submitted.workflowGate?.workflowInstanceId) > 0,
    "Successful submit should return a pending workflow gate summary with an instance id"
  );
  assert(
    toPositiveInt(submitted.workflowGate?.workflowDefinitionId) ===
      governedApWorkflow.workflowDefinitionId,
    "Successful submit should surface the resolved workflow definition id"
  );
  const submittedPendingExplainabilityMatches =
    submitted.workflowGate?.assignmentScopeType === "COUNTRY" &&
    toPositiveInt(submitted.workflowGate?.assignmentScopeId) === fixtures.countryId &&
    submitted.workflowGate?.assignmentScopeLabel === "Country" &&
    Number(submitted.workflowGate?.currentStepNo || 0) === 2 &&
    Number(submitted.workflowGate?.totalSteps || 0) === 3 &&
    submitted.workflowGate?.currentActionCode === "APPROVE" &&
    submitted.workflowGate?.currentRequiredPermissionCode ===
      "approvals.requests.approve" &&
    submitted.workflowGate?.currentStageScopeType === "COUNTRY" &&
    submitted.workflowGate?.currentStageScopeLabel === "Country" &&
    submitted.workflowGate?.effectiveApprovalPermissionCode ===
      "approvals.requests.approve" &&
    submitted.workflowGate?.effectiveApprovalPermissionLabel ===
      "approvals.requests.approve" &&
    submitted.workflowGate?.nextActorType === "COUNTRY" &&
    submitted.workflowGate?.nextActionCode === "POST" &&
    submitted.workflowGate?.nextActionLabel === "Country posting" &&
    submitted.workflowGate?.waitingForSummary === "Waiting for Country approval" &&
    submitted.workflowGate?.blockingReasonCode ===
      WORKFLOW_GATE_BLOCKING_REASON_CODES.WORKFLOW_APPROVAL_PENDING &&
    submitted.workflowGate?.blockingReasonDetail ===
      "Approval is pending at Country scope" &&
    submitted.workflowGate?.submitPermissionCode === "cari.doc.submit" &&
    submitted.workflowGate?.postPermissionCode === "cari.doc.post";
  assert(
    submittedPendingExplainabilityMatches,
    `Successful submit should return enriched pending workflow explainability fields: ${JSON.stringify(
      submitted.workflowGate,
      null,
      2
    )}`
  );
  const workflowInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId: governedSubmitDraft.id,
  });
  assert(
    workflowInstances.length === 1,
    "Governed AP submit should create exactly one workflow instance for the document"
  );
  assert(
    String(workflowInstances[0]?.process_type || "").toUpperCase() ===
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE &&
      String(workflowInstances[0]?.target_type || "").toUpperCase() ===
        CARI_DOCUMENT_WORKFLOW_TARGET_TYPE &&
      String(workflowInstances[0]?.status || "").toUpperCase() === "PENDING" &&
      toPositiveInt(workflowInstances[0]?.workflow_definition_id) ===
        governedApWorkflow.workflowDefinitionId &&
      toPositiveInt(workflowInstances[0]?.generic_request_id) > 0,
    "Governed AP submit should persist a bridged AP_DOCUMENT_POSTING workflow instance"
  );
  const submittedReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: governedSubmitDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    submittedReadback.workflowGate?.state === "pending" &&
      toPositiveInt(submittedReadback.workflowGate?.workflowAssignmentId) ===
        governedApWorkflow.assignmentId,
    "Document GET should expose the pending AP workflow gate after submit"
  );
  assert(
    submittedReadback.workflowGate?.waitingForSummary === "Waiting for Country approval" &&
      Number(submittedReadback.workflowGate?.currentStepNo || 0) === 2 &&
      Number(submittedReadback.workflowGate?.totalSteps || 0) === 3 &&
      submittedReadback.workflowGate?.currentStageScopeLabel === "Country" &&
      submittedReadback.workflowGate?.nextActionLabel === "Country posting",
    "Document GET should preserve enriched workflow explainability fields after submit"
  );
  assert(
    (await countAuditRows({
      tenantId,
      action: "cari.document.submit",
      documentId: governedSubmitDraft.id,
    })) >= 1,
    "Submit should write cari.document.submit audit rows"
  );
  const approvalNote = "Country AP approval completed after reviewer sign-off.";
  const approvedWorkflowInstanceId = await updateLatestWorkflowInstanceForDocument({
    tenantId,
    documentId: governedSubmitDraft.id,
    status: "APPROVED",
    currentStepNo: 3,
    decision: "APPROVE",
    decisionByUserId: userId,
    decisionNote: approvalNote,
    decisionAt: "2026-02-14 10:15:00",
    resolvedAt: "2026-02-14 10:15:00",
    resolutionNote: approvalNote,
  });
  await setDocumentStatus({
    tenantId,
    documentId: governedSubmitDraft.id,
    status: "APPROVED",
  });
  const approvedReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: governedSubmitDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    approvedReadback.workflowGate?.state === "approved" &&
      toPositiveInt(approvedReadback.workflowGate?.workflowInstanceId) ===
        approvedWorkflowInstanceId &&
      approvedReadback.workflowGate?.workflowInstanceStatus === "APPROVED" &&
      Number(approvedReadback.workflowGate?.currentStepNo || 0) === 3 &&
      Number(approvedReadback.workflowGate?.totalSteps || 0) === 3 &&
      approvedReadback.workflowGate?.currentActionCode === "POST" &&
      approvedReadback.workflowGate?.currentRequiredPermissionCode === "cari.doc.post" &&
      approvedReadback.workflowGate?.currentStageScopeLabel === "Country" &&
      approvedReadback.workflowGate?.waitingForSummary === "Ready for Country posting" &&
      approvedReadback.workflowGate?.nextActorType === null &&
      approvedReadback.workflowGate?.nextActionCode === null &&
      approvedReadback.workflowGate?.nextActionLabel === null &&
      approvedReadback.workflowGate?.blockingReasonCode === null &&
      approvedReadback.workflowGate?.latestDecisionComment === approvalNote,
    "Approved governed AP readback should expose the ready-to-post explainability contract"
  );

  const nonGovernedApDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "PAYMENT",
    documentDate: "2026-02-13",
    dueDate: "2026-02-13",
    currencyCode: fixtures.currencyCode,
    amountTxn: 180,
  });
  await expectThrows(
    () =>
      submitCariDocumentById({
        req,
        payload: {
      tenantId,
      userId,
      documentId: nonGovernedApDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  }),
    "Only governed AP documents can be submitted",
    400
  );

  const arDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.customerId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AR",
    documentType: "INVOICE",
    documentDate: "2026-02-14",
    dueDate: "2026-03-16",
    currencyCode: fixtures.currencyCode,
    amountTxn: 190,
  });
  await expectThrows(
    () =>
      submitCariDocumentById({
        req,
        payload: {
      tenantId,
      userId,
      documentId: arDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  }),
    "Only governed AP documents can be submitted",
    400
  );

  const returnedWorkflowDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-15",
    dueDate: "2026-03-17",
    currencyCode: fixtures.currencyCode,
    amountTxn: 280,
  });
  const returnedWorkflowSubmitted = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: returnedWorkflowDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const workflowReturnReason = "Supplier evidence is incomplete for the reviewed bill.";
  const originalReturnedWorkflowInstanceId = toPositiveInt(
    returnedWorkflowSubmitted.workflowGate?.workflowInstanceId
  );
  assert(
    originalReturnedWorkflowInstanceId > 0,
    "Returned/resubmitted scenario requires a live workflow instance"
  );
  await updateLatestWorkflowInstanceForDocument({
    tenantId,
    documentId: returnedWorkflowDraft.id,
    status: "REJECTED",
    decision: "RETURN",
    decisionByUserId: userId,
    decisionNote: workflowReturnReason,
    decisionAt: "2026-02-18 09:30:00",
    resolvedAt: "2026-02-18 09:30:00",
    resolutionNote: workflowReturnReason,
  });
  await setDocumentStatus({
    tenantId,
    documentId: returnedWorkflowDraft.id,
    status: "RETURNED",
    returnReason: workflowReturnReason,
    returnedAt: "2026-02-18 09:30:00",
  });
  const returnedWorkflowReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: returnedWorkflowDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  const returnedWorkflowExplainabilityMatches =
    returnedWorkflowReadback.workflowGate?.state === "returned" &&
      returnedWorkflowReadback.workflowGate?.workflowInstanceStatus === "REJECTED" &&
      returnedWorkflowReadback.workflowGate?.waitingForSummary ===
        RETURNED_FOR_CORRECTION_SUMMARY &&
      returnedWorkflowReadback.workflowGate?.blockingReasonCode ===
        WORKFLOW_GATE_BLOCKING_REASON_CODES.WORKFLOW_APPROVAL_REJECTED &&
      returnedWorkflowReadback.workflowGate?.blockingReasonDetail === workflowReturnReason &&
      returnedWorkflowReadback.workflowGate?.latestDecisionComment === workflowReturnReason &&
      Number(returnedWorkflowReadback.workflowGate?.currentStepNo || 0) === 1 &&
      Number(returnedWorkflowReadback.workflowGate?.totalSteps || 0) === 3 &&
      returnedWorkflowReadback.workflowGate?.currentActionCode === "SUBMIT" &&
      returnedWorkflowReadback.workflowGate?.currentRequiredPermissionCode ===
        "cari.doc.submit" &&
      returnedWorkflowReadback.workflowGate?.currentStageScopeLabel === "Country";
  assert(
    returnedWorkflowExplainabilityMatches,
    `Returned governed AP readback should expose returned explainability fields from the workflow instance: ${JSON.stringify(
      returnedWorkflowReadback.workflowGate,
      null,
      2
    )}`
  );
  const correctedReturnedWorkflow = await updateCariDraftDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: returnedWorkflowDraft.id,
      rowVersion: returnedWorkflowReadback.rowVersion,
      dueDate: "2026-03-28",
      amountTxn: 281,
      amountBase: 281,
      currencyCode: fixtures.currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(
    correctedReturnedWorkflow.status === "RETURNED" &&
      correctedReturnedWorkflow.workflowGate?.state === "returned" &&
      correctedReturnedWorkflow.workflowGate?.blockingReasonDetail === workflowReturnReason,
    "Returned governed AP documents should stay editable until resubmitted"
  );
  const resubmittedReturnedWorkflow = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: returnedWorkflowDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const returnedWorkflowInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId: returnedWorkflowDraft.id,
  });
  assert(
    returnedWorkflowInstances.length === 2 &&
      resubmittedReturnedWorkflow.status === "SUBMITTED" &&
      resubmittedReturnedWorkflow.workflowGate?.state === "pending" &&
      toPositiveInt(resubmittedReturnedWorkflow.workflowGate?.workflowInstanceId) >
        originalReturnedWorkflowInstanceId &&
      resubmittedReturnedWorkflow.workflowGate?.waitingForSummary ===
        "Waiting for Country approval" &&
      !resubmittedReturnedWorkflow.workflowGate?.latestDecisionComment,
    "Resubmitted governed AP documents should create a fresh pending workflow instance and clear the old return note"
  );

  const returnedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-15",
    dueDate: "2026-03-17",
    currencyCode: fixtures.currencyCode,
    amountTxn: 280,
  });
  const returnReason = "Vendor tax id missing on the submitted bill";
  await setDocumentStatus({
    tenantId,
    documentId: returnedDraft.id,
    status: "RETURNED",
    returnReason,
    returnedAt: "2026-02-20 09:30:00",
  });
  const returnedReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: returnedDraft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    returnedReadback.status === "RETURNED" &&
      returnedReadback.returnReason === returnReason &&
      toIsoPrefix(returnedReadback.returnedAt) === "2026-02-20",
    "Document GET should surface RETURNED status with returnReason and returnedAt"
  );
  const correctedReturned = await updateCariDraftDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: returnedDraft.id,
      rowVersion: returnedReadback.rowVersion,
      dueDate: "2026-03-25",
      amountTxn: 285,
      amountBase: 285,
      currencyCode: fixtures.currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(
    correctedReturned.status === "RETURNED" &&
      correctedReturned.workflowGate?.state === "returned" &&
      correctedReturned.workflowGate?.waitingForSummary ===
        RETURNED_FOR_CORRECTION_SUMMARY &&
      correctedReturned.workflowGate?.blockingReasonCode ===
        WORKFLOW_GATE_BLOCKING_REASON_CODES.WORKFLOW_APPROVAL_REJECTED &&
      correctedReturned.returnReason === returnReason &&
      correctedReturned.dueDate === "2026-03-25" &&
      toNumber(correctedReturned.amountTxn) === 285 &&
      correctedReturned.rowVersion === returnedReadback.rowVersion + 1,
    "RETURNED documents should stay editable and preserve the returned workflow gate"
  );
  const cancelled = await cancelCariDraftDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: returnedDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(
    cancelled.status === "CANCELLED",
    "RETURNED documents should be cancellable in PR-2"
  );
  assert(
    (await countAuditRows({
      tenantId,
      action: "cari.document.cancel",
      documentId: returnedDraft.id,
    })) >= 1,
    "RETURNED cancel should write cari.document.cancel audit rows"
  );

  const invalidReturnedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-16",
    dueDate: "2026-03-18",
    currencyCode: fixtures.currencyCode,
    amountTxn: 290,
  });
  const returnConstraintError = await expectThrows(
    () =>
      query(
        `UPDATE cari_documents
            SET status = 'RETURNED'
          WHERE tenant_id = ?
            AND id = ?`,
        [tenantId, invalidReturnedDraft.id]
      ),
    "chk_cari_docs_return_reason_required"
  );
  assert(
    Number(returnConstraintError?.errno || 0) > 0,
    "RETURNED constraint violation should come from the database layer"
  );

  const reportPostedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-17",
    dueDate: "2026-03-19",
    currencyCode: fixtures.currencyCode,
    amountTxn: 300,
  });
  const reportSubmittedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-18",
    dueDate: "2026-03-20",
    currencyCode: fixtures.currencyCode,
    amountTxn: 310,
  });
  const reportReturnedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-19",
    dueDate: "2026-03-21",
    currencyCode: fixtures.currencyCode,
    amountTxn: 320,
  });
  const reportApprovedDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-02-20",
    dueDate: "2026-03-22",
    currencyCode: fixtures.currencyCode,
    amountTxn: 330,
  });

  const postedJournalEntryId = await createJournalEntry({
    tenantId,
    legalEntityId: fixtures.legalEntityId,
    bookId: fixtures.bookId,
    fiscalPeriodId: fixtures.fiscalPeriodId,
    currencyCode: fixtures.currencyCode,
    userId,
    stamp,
    suffix: "posted-report",
    amountBase: 300,
    documentDate: "2026-02-17",
  });
  await setDocumentStatus({
    tenantId,
    documentId: reportPostedDraft.id,
    status: "POSTED",
    postedJournalEntryId,
  });
  await setDocumentStatus({
    tenantId,
    documentId: reportSubmittedDraft.id,
    status: "SUBMITTED",
  });
  await setDocumentStatus({
    tenantId,
    documentId: reportReturnedDraft.id,
    status: "RETURNED",
    returnReason: "Need corrected supplier evidence",
    returnedAt: "2026-02-25 08:15:00",
  });
  await setDocumentStatus({
    tenantId,
    documentId: reportApprovedDraft.id,
    status: "APPROVED",
  });

  await insertOpenItem({
    tenantId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    documentId: reportPostedDraft.id,
    documentDate: "2026-02-17",
    dueDate: "2026-03-19",
    amountTxn: 300,
    amountBase: 300,
    currencyCode: fixtures.currencyCode,
  });
  await insertOpenItem({
    tenantId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    documentId: reportSubmittedDraft.id,
    documentDate: "2026-02-18",
    dueDate: "2026-03-20",
    amountTxn: 310,
    amountBase: 310,
    currencyCode: fixtures.currencyCode,
  });
  await insertOpenItem({
    tenantId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    documentId: reportReturnedDraft.id,
    documentDate: "2026-02-19",
    dueDate: "2026-03-21",
    amountTxn: 320,
    amountBase: 320,
    currencyCode: fixtures.currencyCode,
  });
  await insertOpenItem({
    tenantId,
    legalEntityId: fixtures.legalEntityId,
    counterpartyId: fixtures.vendorId,
    documentId: reportApprovedDraft.id,
    documentDate: "2026-02-20",
    dueDate: "2026-03-22",
    amountTxn: 330,
    amountBase: 330,
    currencyCode: fixtures.currencyCode,
  });

  const openItemsReport = await getCariOpenItemsReport({
    req,
    filters: {
      tenantId,
      legalEntityId: fixtures.legalEntityId,
      counterpartyId: fixtures.vendorId,
      asOfDate: "2026-03-31",
      role: "VENDOR",
      direction: "AP",
      status: "ALL",
      limit: 50,
      offset: 0,
      includeDetails: true,
    },
    buildScopeFilter: null,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    Array.isArray(openItemsReport.rows) &&
      openItemsReport.rows.length === 1 &&
      toPositiveInt(openItemsReport.rows[0]?.documentId) === reportPostedDraft.id,
    "Open-item report should exclude SUBMITTED/RETURNED/APPROVED documents from accounting-visible rows"
  );

  const statementReport = await getCariCounterpartyStatementReport({
    req,
    filters: {
      tenantId,
      legalEntityId: fixtures.legalEntityId,
      counterpartyId: fixtures.vendorId,
      asOfDate: "2026-03-31",
      role: "VENDOR",
      direction: "AP",
      status: "ALL",
      limit: 50,
      offset: 0,
      includeDetails: true,
    },
    buildScopeFilter: null,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    Array.isArray(statementReport.documents?.rows) &&
      statementReport.documents.rows.length === 1 &&
      toPositiveInt(statementReport.documents.rows[0]?.documentId) === reportPostedDraft.id,
    "Statement report should exclude SUBMITTED/RETURNED/APPROVED document rows"
  );

  console.log("CARI PR-27 governed AP review-state smoke passed.");
  console.log(
    JSON.stringify(
      {
        tenantId,
        checkedSubmitDocumentIds: [
          noAssignmentDraft.id,
          governedSubmitDraft.id,
          nonGovernedApDraft.id,
          arDraft.id,
          returnedDraft.id,
          invalidReturnedDraft.id,
        ],
        checkedReportDocumentIds: [
          reportPostedDraft.id,
          reportSubmittedDraft.id,
          reportReturnedDraft.id,
          reportApprovedDraft.id,
        ],
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    try {
      await closePool();
    } catch {
      // ignore close failures
    }
    process.exit(1);
  });
