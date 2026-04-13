import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createCariDraftDocument,
  getCariDocumentByIdForTenant,
  resolveCariDocumentPostScope,
  resolveCariDocumentSubmitScope,
  submitCariDocumentById,
  updateCariDraftDocumentById,
} from "../src/services/cari.document.service.js";
import {
  approveWorkflowInstance,
  createWorkflowAssignment,
  createWorkflowDefinition,
  replaceWorkflowDefinitionSteps,
  resolveWorkflowDecisionPermissionAccess,
} from "../src/services/workflows.service.js";
import { AP_DOCUMENT_WORKFLOW_PROCESS_TYPE } from "../../shared/cariDocumentWorkflowGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function allowAllScopes() {}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "test-workflows-actap05-ap-action-step-scenarios",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function makeForbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

async function expectForbidden(promiseFactory, expectedMessagePart) {
  try {
    await promiseFactory();
  } catch (error) {
    assert(Number(error?.status || 0) === 403, `Expected 403, got ${error?.status || 0}`);
    if (expectedMessagePart) {
      assert(
        String(error?.message || "").includes(expectedMessagePart),
        `Expected forbidden message to include "${expectedMessagePart}", got "${error?.message || ""}"`
      );
    }
    return;
  }
  throw new Error(`Expected 403 forbidden${expectedMessagePart ? ` (${expectedMessagePart})` : ""}`);
}

async function expectBadRequest(promiseFactory, expectedMessagePart) {
  try {
    await promiseFactory();
  } catch (error) {
    assert(Number(error?.status || 0) === 400, `Expected 400, got ${error?.status || 0}`);
    if (expectedMessagePart) {
      assert(
        String(error?.message || "").includes(expectedMessagePart),
        `Expected bad-request message to include "${expectedMessagePart}", got "${error?.message || ""}"`
      );
    }
    return;
  }
  throw new Error(
    `Expected 400 bad request${expectedMessagePart ? ` (${expectedMessagePart})` : ""}`
  );
}

function mapScopeTypeToAccessType(scopeType) {
  const normalizedScopeType = normalizeUpper(scopeType);
  if (normalizedScopeType === "OPERATING_UNIT") {
    return "operating_unit";
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    return "legal_entity";
  }
  if (normalizedScopeType === "COUNTRY") {
    return "country";
  }
  if (normalizedScopeType === "GROUP") {
    return "group";
  }
  return "";
}

function buildScopeActor(fixtures, scopeType, scopeId, userId, stamp, suffix) {
  return {
    scopeType: normalizeUpper(scopeType),
    scopeId: toPositiveInt(scopeId),
    userId: toPositiveInt(userId),
    req: makeRequestContext({
      tenantId: fixtures.tenantId,
      userId,
      stamp,
      suffix,
    }),
  };
}

function actorCanReachScope(fixtures, actor, requestedScopeType, requestedScopeId) {
  const actorScopeType = normalizeUpper(actor?.scopeType);
  const actorScopeId = toPositiveInt(actor?.scopeId);
  const scopeType = normalizeUpper(requestedScopeType);
  const scopeId = toPositiveInt(requestedScopeId);
  if (!actorScopeType || !actorScopeId || !scopeType || !scopeId) {
    return false;
  }

  if (actorScopeType === "OPERATING_UNIT") {
    return scopeType === "OPERATING_UNIT" && actorScopeId === scopeId;
  }

  if (actorScopeType === "LEGAL_ENTITY") {
    if (scopeType === "LEGAL_ENTITY") {
      return actorScopeId === scopeId;
    }
    if (scopeType === "OPERATING_UNIT") {
      return (
        actorScopeId === fixtures.legalEntityId &&
        [fixtures.primaryOperatingUnitId, fixtures.secondaryOperatingUnitId].includes(scopeId)
      );
    }
    return false;
  }

  if (actorScopeType === "COUNTRY") {
    if (scopeType === "COUNTRY") {
      return actorScopeId === scopeId;
    }
    if (scopeType === "LEGAL_ENTITY") {
      return actorScopeId === fixtures.countryId && scopeId === fixtures.legalEntityId;
    }
    if (scopeType === "OPERATING_UNIT") {
      return (
        actorScopeId === fixtures.countryId &&
        [fixtures.primaryOperatingUnitId, fixtures.secondaryOperatingUnitId].includes(scopeId)
      );
    }
    return false;
  }

  return false;
}

function buildActorScopeAsserter(fixtures, actor) {
  return (_req, accessType, accessId) => {
    const requestedScopeType = String(accessType || "").trim().toUpperCase();
    const scopeType =
      requestedScopeType === "OPERATING_UNIT"
        ? "OPERATING_UNIT"
        : requestedScopeType === "LEGAL_ENTITY"
          ? "LEGAL_ENTITY"
          : requestedScopeType === "COUNTRY"
            ? "COUNTRY"
            : requestedScopeType === "GROUP"
              ? "GROUP"
              : "";
    if (!actorCanReachScope(fixtures, actor, scopeType, accessId)) {
      throw makeForbidden(
        `Scope denied for ${actor.scopeType}:${actor.scopeId} -> ${scopeType}:${accessId}`
      );
    }
  };
}

async function assertActorCanReachResolvedScope(fixtures, actor, resolvedScope, label) {
  const accessType = mapScopeTypeToAccessType(resolvedScope?.scopeType);
  assert(accessType, `${label} should resolve a concrete scope type`);
  buildActorScopeAsserter(fixtures, actor)(actor.req, accessType, resolvedScope.scopeId, accessType);
}

async function assertActorCannotReachResolvedScope(fixtures, actor, resolvedScope, label) {
  const accessType = mapScopeTypeToAccessType(resolvedScope?.scopeType);
  await expectForbidden(
    async () =>
      buildActorScopeAsserter(fixtures, actor)(
        actor.req,
        accessType,
        resolvedScope.scopeId,
        accessType
      ),
    `${actor.scopeType}:${actor.scopeId}`
  );
  assert(accessType, `${label} should resolve a concrete scope type`);
}

async function createTenant({ code, name }) {
  await query(
    `INSERT INTO tenants (code, name, status)
     VALUES (?, ?, 'ACTIVE')`,
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
  assert(tenantId > 0, `Failed to create tenant ${code}`);
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
  assert(userId > 0, `Failed to create user ${email}`);
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
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "USD")
    .trim()
    .toUpperCase();
  assert(countryId > 0, "US country row is required");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `ACTAP05GC${stamp}`, `ACTAP05 Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `ACTAP05GC${stamp}`]
  );
  const groupCompanyId = toPositiveInt(groupResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company");

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
      groupCompanyId,
      `ACTAP05LE${stamp}`,
      `ACTAP05 Legal Entity ${stamp}`,
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
    [tenantId, `ACTAP05LE${stamp}`]
  );
  const legalEntityId = toPositiveInt(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity");

  await query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        status
     )
     VALUES
       (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE'),
       (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `ACTAP05OUA${stamp}`,
      `ACTAP05 Primary OU ${stamp}`,
      tenantId,
      legalEntityId,
      `ACTAP05OUB${stamp}`,
      `ACTAP05 Secondary OU ${stamp}`,
    ]
  );
  const ouResult = await query(
    `SELECT id, code
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code IN (?, ?)
      ORDER BY code ASC`,
    [
      tenantId,
      legalEntityId,
      `ACTAP05OUA${stamp}`,
      `ACTAP05OUB${stamp}`,
    ]
  );
  const ouRows = ouResult.rows || [];
  const primaryOperatingUnitId = toPositiveInt(
    ouRows.find((row) => String(row?.code || "").trim() === `ACTAP05OUA${stamp}`)?.id
  );
  const secondaryOperatingUnitId = toPositiveInt(
    ouRows.find((row) => String(row?.code || "").trim() === `ACTAP05OUB${stamp}`)?.id
  );
  assert(primaryOperatingUnitId > 0, "Failed to create primary operating unit");
  assert(secondaryOperatingUnitId > 0, "Failed to create secondary operating unit");

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
    [tenantId, legalEntityId, `ACTAP05TERM${stamp}`, `ACTAP05 Term ${stamp}`]
  );
  const paymentTermResult = await query(
    `SELECT id
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `ACTAP05TERM${stamp}`]
  );
  const paymentTermId = toPositiveInt(paymentTermResult.rows?.[0]?.id);
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
     VALUES (?, ?, ?, ?, FALSE, TRUE, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `ACTAP05V${stamp}`,
      `ACTAP05 Vendor ${stamp}`,
      currencyCode,
      paymentTermId,
    ]
  );
  const vendorResult = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `ACTAP05V${stamp}`]
  );
  const vendorId = toPositiveInt(vendorResult.rows?.[0]?.id);
  assert(vendorId > 0, "Failed to create vendor");

  return {
    tenantId,
    countryId,
    groupCompanyId,
    legalEntityId,
    primaryOperatingUnitId,
    secondaryOperatingUnitId,
    paymentTermId,
    vendorId,
    currencyCode,
  };
}

function makeApStep(stepNo, actionCode, stageScopeType) {
  const normalizedActionCode = normalizeUpper(actionCode);
  return {
    stepNo,
    actionCode: normalizedActionCode,
    stageScopeType: normalizeUpper(stageScopeType),
    requiredPackageCode:
      normalizedActionCode === "APPROVE"
        ? "PKG-AP-APPROVE"
        : normalizedActionCode === "POST"
          ? "PKG-AP-POST"
          : "PKG-AP-DRAFT-SUBMIT",
    requiredPermissionCode: null,
    minApproverCount: 1,
    allowSelfApprove: false,
  };
}

async function deactivateActiveApAssignments(tenantId) {
  await query(
    `UPDATE workflow_assignments
        SET status = 'INACTIVE'
      WHERE tenant_id = ?
        AND process_type = ?`,
    [tenantId, AP_DOCUMENT_WORKFLOW_PROCESS_TYPE]
  );
}

async function createScenarioWorkflow({ tenantId, userId, countryId, stamp, slug, steps }) {
  const definition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `ACTAP05_${slug}_${stamp}`.slice(0, 60),
      name: `ACTAP05 ${slug} ${stamp}`.slice(0, 255),
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      isActive: true,
      versionNo: 1,
    },
  });
  await replaceWorkflowDefinitionSteps({
    input: {
      tenantId,
      definitionId: definition.id,
      steps,
    },
  });
  const assignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: allowAllScopes,
    input: {
      tenantId,
      userId,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      workflowDefinitionId: definition.id,
      countryId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  return {
    definition,
    assignment,
  };
}

async function createDraftDocument({ fixtures, actor, amountBase = 1000, suffix = "draft" }) {
  return createCariDraftDocument({
    req: actor.req,
    payload: {
      tenantId: fixtures.tenantId,
      userId: actor.userId,
      legalEntityId: fixtures.legalEntityId,
      operatingUnitId: fixtures.primaryOperatingUnitId,
      counterpartyId: fixtures.vendorId,
      paymentTermId: fixtures.paymentTermId,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: "2026-02-10",
      dueDate: "2026-03-12",
      amountTxn: amountBase,
      amountBase,
      currencyCode: fixtures.currencyCode,
      fxRate: 1,
      narrative: `ACTAP05 ${suffix}`,
    },
    assertScopeAccess: buildActorScopeAsserter(fixtures, actor),
  });
}

async function readDocument(fixtures, documentId) {
  return getCariDocumentByIdForTenant({
    req: makeRequestContext({
      tenantId: fixtures.tenantId,
      userId: 1,
      stamp: Date.now(),
      suffix: `read-${documentId}`,
    }),
    tenantId: fixtures.tenantId,
    documentId,
    assertScopeAccess: allowAllScopes,
  });
}

function assertResolvedScope(resolvedScope, expectedScopeType, expectedScopeId, label) {
  assert(
    normalizeUpper(resolvedScope?.scopeType) === normalizeUpper(expectedScopeType),
    `${label} should resolve ${expectedScopeType}, got ${resolvedScope?.scopeType || "none"}`
  );
  assert(
    toPositiveInt(resolvedScope?.scopeId) === toPositiveInt(expectedScopeId),
    `${label} should resolve scopeId=${expectedScopeId}, got ${resolvedScope?.scopeId || 0}`
  );
}

async function runScenario({
  fixtures,
  tenantAdminUserId,
  stamp,
  slug,
  steps,
  creator,
  draftDeniedActor = null,
  submitAllowedActor,
  submitDeniedActor,
  approveStages = [],
  postAllowedActor,
  postDeniedActor,
}) {
  await deactivateActiveApAssignments(fixtures.tenantId);
  await createScenarioWorkflow({
    tenantId: fixtures.tenantId,
    userId: tenantAdminUserId,
    countryId: fixtures.countryId,
    stamp,
    slug,
    steps,
  });

  const draft = await createDraftDocument({
    fixtures,
    actor: creator,
    suffix: slug,
  });
  assert(toPositiveInt(draft.id) > 0, `${slug} should create an AP draft document`);
  if (draftDeniedActor) {
    const initialReadback = await readDocument(fixtures, draft.id);
    assert(
      Number(initialReadback.workflowGate?.editableStepNo || 0) === 1 &&
        normalizeUpper(initialReadback.workflowGate?.editableStageScopeType) === "OPERATING_UNIT" &&
        Number(initialReadback.workflowGate?.currentStepNo || 0) === 1 &&
        normalizeUpper(initialReadback.workflowGate?.currentActionCode) === "DRAFT",
      `${slug} should expose the explicit DRAFT owner as the current runtime step`
    );
  }

  if (draftDeniedActor) {
    await expectForbidden(
      async () =>
        updateCariDraftDocumentById({
          req: draftDeniedActor.req,
          payload: {
            tenantId: fixtures.tenantId,
            userId: draftDeniedActor.userId,
            documentId: draft.id,
            rowVersion: draft.rowVersion,
            dueDate: "2026-03-20",
            amountTxn: 1100,
            amountBase: 1100,
            currencyCode: fixtures.currencyCode,
            fxRate: 1,
          },
          assertScopeAccess: buildActorScopeAsserter(fixtures, draftDeniedActor),
        }),
      `${draftDeniedActor.scopeType}:${draftDeniedActor.scopeId}`
    );

    const corrected = await updateCariDraftDocumentById({
      req: creator.req,
      payload: {
        tenantId: fixtures.tenantId,
        userId: creator.userId,
        documentId: draft.id,
        rowVersion: draft.rowVersion,
        dueDate: "2026-03-20",
        amountTxn: 1100,
        amountBase: 1100,
        currencyCode: fixtures.currencyCode,
        fxRate: 1,
      },
      assertScopeAccess: buildActorScopeAsserter(fixtures, creator),
    });
    assert(
      normalizeUpper(corrected.status) === "DRAFT" && Number(corrected.amountBase || 0) === 1100,
      `${slug} should keep DRAFT access on the explicit draft owner`
    );
  }

  const expectedSubmitStep = steps.find((step) => normalizeUpper(step.actionCode) === "SUBMIT");
  const submitScope = await resolveCariDocumentSubmitScope(draft.id, fixtures.tenantId);
  assertResolvedScope(
    submitScope,
    expectedSubmitStep.stageScopeType,
    expectedSubmitStep.stageScopeType === "OPERATING_UNIT"
      ? fixtures.primaryOperatingUnitId
      : expectedSubmitStep.stageScopeType === "LEGAL_ENTITY"
        ? fixtures.legalEntityId
        : fixtures.countryId,
    `${slug} submit scope`
  );
  await assertActorCanReachResolvedScope(fixtures, submitAllowedActor, submitScope, `${slug} submit`);
  await assertActorCannotReachResolvedScope(fixtures, submitDeniedActor, submitScope, `${slug} submit`);

  await expectForbidden(
    async () =>
      submitCariDocumentById({
        req: submitDeniedActor.req,
        payload: {
          tenantId: fixtures.tenantId,
          userId: submitDeniedActor.userId,
          documentId: draft.id,
        },
        assertScopeAccess: buildActorScopeAsserter(fixtures, submitDeniedActor),
      }),
    `${submitDeniedActor.scopeType}:${submitDeniedActor.scopeId}`
  );

  const submitted = await submitCariDocumentById({
    req: submitAllowedActor.req,
    payload: {
      tenantId: fixtures.tenantId,
      userId: submitAllowedActor.userId,
      documentId: draft.id,
    },
    assertScopeAccess: buildActorScopeAsserter(fixtures, submitAllowedActor),
  });
  const stepAfterSubmit = steps.find((step) => Number(step.stepNo) > Number(expectedSubmitStep.stepNo));
  assert(
    normalizeUpper(submitted.workflowGate?.currentActionCode) === normalizeUpper(stepAfterSubmit?.actionCode),
    `${slug} should advance to the explicit step after SUBMIT`
  );
  assert(
    normalizeUpper(submitted.workflowGate?.currentStageScopeType) ===
      normalizeUpper(stepAfterSubmit?.stageScopeType),
    `${slug} should expose the explicit next-step scope after SUBMIT`
  );

  let currentReadback = await readDocument(fixtures, draft.id);
  for (let index = 0; index < approveStages.length; index += 1) {
    const stage = approveStages[index];
    const instanceId = toPositiveInt(currentReadback.workflowGate?.workflowInstanceId);
    assert(instanceId > 0, `${slug} approval stage ${index + 1} should have a workflow instance`);

    const decisionAccess = await resolveWorkflowDecisionPermissionAccess({
      tenantId: fixtures.tenantId,
      instanceId,
      decisionCode: "APPROVE",
    });
    const expectedApproveStep = steps.find((step) => Number(step.stepNo) === stage.expectedStepNo);
    assertResolvedScope(
      decisionAccess.scope,
      expectedApproveStep.stageScopeType,
      expectedApproveStep.stageScopeType === "LEGAL_ENTITY"
        ? fixtures.legalEntityId
        : fixtures.countryId,
      `${slug} approve step ${stage.expectedStepNo}`
    );
    assert(
      Number(decisionAccess.stepNo || 0) === Number(stage.expectedStepNo),
      `${slug} should map approval access back to explicit step ${stage.expectedStepNo}`
    );
    await assertActorCanReachResolvedScope(
      fixtures,
      stage.allowedActor,
      decisionAccess.scope,
      `${slug} approve step ${stage.expectedStepNo}`
    );
    await assertActorCannotReachResolvedScope(
      fixtures,
      stage.deniedActor,
      decisionAccess.scope,
      `${slug} approve step ${stage.expectedStepNo}`
    );

    await approveWorkflowInstance({
      req: stage.allowedActor.req,
      input: {
        tenantId: fixtures.tenantId,
        userId: stage.allowedActor.userId,
        instanceId,
        decisionNote: stage.decisionNote,
      },
      assertScopeAccess: buildActorScopeAsserter(fixtures, stage.allowedActor),
    });

    currentReadback = await readDocument(fixtures, draft.id);
    const nextExpectedStep = steps.find(
      (step) => Number(step.stepNo) > Number(stage.expectedStepNo)
    );
    assert(
      normalizeUpper(currentReadback.workflowGate?.currentActionCode) ===
        normalizeUpper(nextExpectedStep?.actionCode),
      `${slug} should advance to the next explicit action after approval step ${stage.expectedStepNo}`
    );
    assert(
      normalizeUpper(currentReadback.workflowGate?.currentStageScopeType) ===
        normalizeUpper(nextExpectedStep?.stageScopeType),
      `${slug} should expose the next explicit scope after approval step ${stage.expectedStepNo}`
    );
  }

  const postScope = await resolveCariDocumentPostScope(draft.id, fixtures.tenantId);
  const expectedPostStep = steps.find((step) => normalizeUpper(step.actionCode) === "POST");
  assertResolvedScope(
    postScope,
    expectedPostStep.stageScopeType,
    expectedPostStep.stageScopeType === "LEGAL_ENTITY"
      ? fixtures.legalEntityId
      : fixtures.countryId,
    `${slug} post scope`
  );
  await assertActorCanReachResolvedScope(fixtures, postAllowedActor, postScope, `${slug} post`);
  await assertActorCannotReachResolvedScope(fixtures, postDeniedActor, postScope, `${slug} post`);

  const finalReadback = approveStages.length > 0 ? currentReadback : await readDocument(fixtures, draft.id);
  assert(
    normalizeUpper(finalReadback.workflowGate?.currentActionCode) === "POST" &&
      normalizeUpper(finalReadback.workflowGate?.state) === "APPROVED",
    `${slug} should finish the runtime checks at the explicit POST step`
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `ACTAP05T${stamp}`,
    name: `ACTAP05 Tenant ${stamp}`,
  });
  const adminUserId = await createUser({
    tenantId,
    email: `actap05-admin-${stamp}@example.com`,
    name: "ACTAP05 Admin",
  });
  const keoUserId = await createUser({
    tenantId,
    email: `keo-${stamp}@example.com`,
    name: "KEO",
  });
  const entityUserId = await createUser({
    tenantId,
    email: `afmuhasebe-${stamp}@example.com`,
    name: "AF Muhasebe",
  });
  const countryUserId = await createUser({
    tenantId,
    email: `countrycontroller-${stamp}@example.com`,
    name: "Country Controller",
  });
  const siblingUserId = await createUser({
    tenantId,
    email: `sibling-${stamp}@example.com`,
    name: "Sibling OU User",
  });

  const fixtures = await createOrgFixtures({ tenantId, stamp });
  const scenarioFixtures = {
    ...fixtures,
    tenantId,
  };

  const primaryOuActor = buildScopeActor(
    scenarioFixtures,
    "OPERATING_UNIT",
    scenarioFixtures.primaryOperatingUnitId,
    keoUserId,
    stamp,
    "primary-ou"
  );
  const siblingOuActor = buildScopeActor(
    scenarioFixtures,
    "OPERATING_UNIT",
    scenarioFixtures.secondaryOperatingUnitId,
    siblingUserId,
    stamp,
    "sibling-ou"
  );
  const legalEntityActor = buildScopeActor(
    scenarioFixtures,
    "LEGAL_ENTITY",
    scenarioFixtures.legalEntityId,
    entityUserId,
    stamp,
    "legal-entity"
  );
  const countryActor = buildScopeActor(
    scenarioFixtures,
    "COUNTRY",
    scenarioFixtures.countryId,
    countryUserId,
    stamp,
    "country"
  );

  await expectBadRequest(
    async () =>
      createScenarioWorkflow({
        tenantId,
        userId: adminUserId,
        countryId: scenarioFixtures.countryId,
        stamp,
        slug: "invalid-no-submit",
        steps: [
          makeApStep(1, "DRAFT", "OPERATING_UNIT"),
          makeApStep(2, "POST", "COUNTRY"),
        ],
      }),
    "POST must appear after SUBMIT"
  );

  await runScenario({
    fixtures: scenarioFixtures,
    tenantAdminUserId: adminUserId,
    stamp,
    slug: "submit-post",
    steps: [
      makeApStep(1, "SUBMIT", "OPERATING_UNIT"),
      makeApStep(2, "POST", "LEGAL_ENTITY"),
    ],
    creator: primaryOuActor,
    submitAllowedActor: primaryOuActor,
    submitDeniedActor: siblingOuActor,
    postAllowedActor: legalEntityActor,
    postDeniedActor: primaryOuActor,
  });

  await runScenario({
    fixtures: scenarioFixtures,
    tenantAdminUserId: adminUserId,
    stamp,
    slug: "submit-approve-post",
    steps: [
      makeApStep(1, "SUBMIT", "OPERATING_UNIT"),
      makeApStep(2, "APPROVE", "LEGAL_ENTITY"),
      makeApStep(3, "POST", "COUNTRY"),
    ],
    creator: primaryOuActor,
    submitAllowedActor: primaryOuActor,
    submitDeniedActor: siblingOuActor,
    approveStages: [
      {
        expectedStepNo: 2,
        allowedActor: legalEntityActor,
        deniedActor: primaryOuActor,
        decisionNote: "Legal Entity approval completed.",
      },
    ],
    postAllowedActor: countryActor,
    postDeniedActor: legalEntityActor,
  });

  await runScenario({
    fixtures: scenarioFixtures,
    tenantAdminUserId: adminUserId,
    stamp,
    slug: "submit-approve-approve-post",
    steps: [
      makeApStep(1, "SUBMIT", "OPERATING_UNIT"),
      makeApStep(2, "APPROVE", "LEGAL_ENTITY"),
      makeApStep(3, "APPROVE", "COUNTRY"),
      makeApStep(4, "POST", "COUNTRY"),
    ],
    creator: primaryOuActor,
    submitAllowedActor: primaryOuActor,
    submitDeniedActor: siblingOuActor,
    approveStages: [
      {
        expectedStepNo: 2,
        allowedActor: legalEntityActor,
        deniedActor: primaryOuActor,
        decisionNote: "Legal Entity approval completed.",
      },
      {
        expectedStepNo: 3,
        allowedActor: countryActor,
        deniedActor: legalEntityActor,
        decisionNote: "Country approval completed.",
      },
    ],
    postAllowedActor: countryActor,
    postDeniedActor: legalEntityActor,
  });

  await runScenario({
    fixtures: scenarioFixtures,
    tenantAdminUserId: adminUserId,
    stamp,
    slug: "draft-submit-post",
    steps: [
      makeApStep(1, "DRAFT", "OPERATING_UNIT"),
      makeApStep(2, "SUBMIT", "LEGAL_ENTITY"),
      makeApStep(3, "POST", "COUNTRY"),
    ],
    creator: primaryOuActor,
    draftDeniedActor: siblingOuActor,
    submitAllowedActor: legalEntityActor,
    submitDeniedActor: primaryOuActor,
    postAllowedActor: countryActor,
    postDeniedActor: legalEntityActor,
  });

  await runScenario({
    fixtures: scenarioFixtures,
    tenantAdminUserId: adminUserId,
    stamp,
    slug: "draft-submit-approve-post",
    steps: [
      makeApStep(1, "DRAFT", "OPERATING_UNIT"),
      makeApStep(2, "SUBMIT", "LEGAL_ENTITY"),
      makeApStep(3, "APPROVE", "COUNTRY"),
      makeApStep(4, "POST", "COUNTRY"),
    ],
    creator: primaryOuActor,
    draftDeniedActor: siblingOuActor,
    submitAllowedActor: legalEntityActor,
    submitDeniedActor: primaryOuActor,
    approveStages: [
      {
        expectedStepNo: 3,
        allowedActor: countryActor,
        deniedActor: legalEntityActor,
        decisionNote: "Country approval completed after legal-entity submission.",
      },
    ],
    postAllowedActor: countryActor,
    postDeniedActor: legalEntityActor,
  });

  console.log("ACTAP05 AP action-step scenario coverage passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
