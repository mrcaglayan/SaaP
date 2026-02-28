import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT";
const EVIDENCE_STATUS_ACTIVE = "ACTIVE";

export const EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST = "CARI_DOCUMENT_POST";
export const EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE = "CARI_DOCUMENT_REVERSE";

const POLICY_MODE_OFF = "OFF";
const POLICY_MODE_RISKY = "RISKY";
const POLICY_MODE_ALWAYS = "ALWAYS";
const VALID_POLICY_MODES = new Set([POLICY_MODE_OFF, POLICY_MODE_RISKY, POLICY_MODE_ALWAYS]);

function parsePolicyMode() {
  const normalized = String(process.env.EVIDENCE_POLICY_MODE || POLICY_MODE_OFF)
    .trim()
    .toUpperCase();
  if (VALID_POLICY_MODES.has(normalized)) {
    return normalized;
  }
  return POLICY_MODE_OFF;
}

function parsePositiveAmountEnv(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

async function findCariDocumentPolicyRow({ tenantId, documentId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id, status, amount_base, direction, document_type
     FROM cari_documents
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

async function countActiveEvidenceForCariDocument({
  tenantId,
  legalEntityId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT COUNT(*) AS evidence_count
     FROM evidence_objects
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND source_ref_type = ?
       AND source_ref_id = ?
       AND status = ?`,
    [
      tenantId,
      legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      documentId,
      EVIDENCE_STATUS_ACTIVE,
    ]
  );
  return Number(result.rows?.[0]?.evidence_count || 0);
}

function resolveEvidenceRequirements({
  policyMode,
  actionCode,
  useFxOverride,
  amountBase,
}) {
  if (policyMode === POLICY_MODE_OFF) {
    return [];
  }

  if (policyMode === POLICY_MODE_ALWAYS) {
    if (
      actionCode === EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST ||
      actionCode === EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE
    ) {
      return ["POLICY_ALWAYS"];
    }
    return [];
  }

  // POLICY_MODE_RISKY
  const requirements = [];
  const riskyPostAmountBaseMin = parsePositiveAmountEnv(
    process.env.EVIDENCE_POLICY_RISKY_POST_AMOUNT_BASE_MIN
  );

  if (actionCode === EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE) {
    requirements.push("RISKY_REVERSE");
  }
  if (actionCode === EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST && useFxOverride) {
    requirements.push("RISKY_FX_OVERRIDE");
  }
  if (
    actionCode === EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST &&
    riskyPostAmountBaseMin &&
    normalizeAmount(amountBase) >= riskyPostAmountBaseMin
  ) {
    requirements.push("RISKY_POST_AMOUNT_THRESHOLD");
  }

  return requirements;
}

function buildEvidenceRequiredError({
  actionCode,
  policyMode,
  requirementReasons,
  activeEvidenceCount,
  documentId,
}) {
  const err = badRequest(
    "Evidence attachment is required before this action. Attach evidence and retry."
  );
  err.code = "EVIDENCE_REQUIRED";
  err.details = {
    actionCode,
    policyMode,
    requirementReasons,
    documentId: parsePositiveInt(documentId),
    activeEvidenceCount: Number(activeEvidenceCount || 0),
    minRequiredEvidenceCount: 1,
  };
  return err;
}

export async function assertEvidencePolicyForCariDocumentAction({
  tenantId,
  documentId,
  actionCode,
  context = {},
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedDocumentId = parsePositiveInt(documentId);
  if (!parsedTenantId || !parsedDocumentId) {
    throw badRequest("tenantId and documentId are required for evidence policy checks");
  }

  const policyMode = parsePolicyMode();
  if (policyMode === POLICY_MODE_OFF) {
    return {
      policyMode,
      enforced: false,
      requirementReasons: [],
      activeEvidenceCount: null,
    };
  }

  const documentRow = await findCariDocumentPolicyRow({
    tenantId: parsedTenantId,
    documentId: parsedDocumentId,
    runQuery,
  });
  if (!documentRow) {
    throw badRequest("Document not found");
  }

  const requirementReasons = resolveEvidenceRequirements({
    policyMode,
    actionCode,
    useFxOverride: Boolean(context?.useFxOverride),
    amountBase: normalizeAmount(documentRow.amount_base),
  });
  if (requirementReasons.length === 0) {
    return {
      policyMode,
      enforced: false,
      requirementReasons,
      activeEvidenceCount: null,
    };
  }

  const legalEntityId = parsePositiveInt(documentRow.legal_entity_id);
  if (!legalEntityId) {
    throw badRequest("Document legal entity is invalid");
  }

  const activeEvidenceCount = await countActiveEvidenceForCariDocument({
    tenantId: parsedTenantId,
    legalEntityId,
    documentId: parsedDocumentId,
    runQuery,
  });

  if (activeEvidenceCount < 1) {
    throw buildEvidenceRequiredError({
      actionCode,
      policyMode,
      requirementReasons,
      activeEvidenceCount,
      documentId: parsedDocumentId,
    });
  }

  return {
    policyMode,
    enforced: true,
    requirementReasons,
    activeEvidenceCount,
  };
}

