import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  AP_WORKFLOW_COMPAT_MODE,
  FEATURE_AP_DOCUMENT_WORKFLOW_V1,
  isDocClassWorkflowGoverned,
  normalizeCariDocumentWorkflowDirection,
  normalizeCariDocumentWorkflowType,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

async function loadTenantWorkflowFeatureRows({
  tenantId,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT feature_code, is_enabled
         FROM tenant_features
        WHERE tenant_id = ?
          AND feature_code IN (?, ?)`,
      [tenantId, FEATURE_AP_DOCUMENT_WORKFLOW_V1, AP_WORKFLOW_COMPAT_MODE]
    );
    return result.rows || [];
  } catch (err) {
    if (isMissingTableError(err)) {
      return [];
    }
    throw err;
  }
}

/**
 * Reads the tenant-level governed AP rollout flags. Compat mode defaults to ON
 * once the main workflow feature is enabled so rollout can start in the
 * documented safe-fallback posture.
 */
export async function getCariDocumentWorkflowFeatureState({
  tenantId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const rows = await loadTenantWorkflowFeatureRows({
    tenantId: normalizedTenantId,
    runQuery,
  });
  const byCode = new Map(
    rows.map((row) => [normalizeUpperText(row?.feature_code), parseDbBoolean(row?.is_enabled)])
  );
  const featureEnabled = Boolean(byCode.get(FEATURE_AP_DOCUMENT_WORKFLOW_V1));
  const compatRowExists = byCode.has(AP_WORKFLOW_COMPAT_MODE);
  const compatModeEnabled = featureEnabled
    ? compatRowExists
      ? Boolean(byCode.get(AP_WORKFLOW_COMPAT_MODE))
      : true
    : false;

  return {
    tenantId: normalizedTenantId,
    featureEnabled,
    compatModeEnabled,
  };
}

/**
 * Resolves the tenant-scoped workflow-governance metadata row for a CARI doc
 * class. When the table or row is absent, the shared seeded defaults still
 * apply through `isDocClassWorkflowGoverned`.
 */
export async function getCariDocumentClassWorkflowMetadata({
  tenantId,
  direction,
  documentType,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedDirection = normalizeCariDocumentWorkflowDirection(direction);
  const normalizedDocumentType = normalizeCariDocumentWorkflowType(documentType);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedDirection) {
    throw badRequest("direction must be AR or AP");
  }
  if (!normalizedDocumentType) {
    throw badRequest("documentType is invalid");
  }

  try {
    const result = await runQuery(
      `SELECT direction, document_type, is_workflow_governed
         FROM cari_document_class_metadata
        WHERE tenant_id = ?
          AND direction = ?
          AND document_type = ?
        LIMIT 1`,
      [normalizedTenantId, normalizedDirection, normalizedDocumentType]
    );
    const row = result.rows?.[0] || null;
    const docClass = {
      tenantId: normalizedTenantId,
      direction: normalizedDirection,
      documentType: normalizedDocumentType,
      isWorkflowGoverned: isDocClassWorkflowGoverned({
        direction: normalizedDirection,
        documentType: normalizedDocumentType,
        is_workflow_governed: row?.is_workflow_governed,
      }),
      hasPersistedOverride: row !== null,
    };
    return docClass;
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    return {
      tenantId: normalizedTenantId,
      direction: normalizedDirection,
      documentType: normalizedDocumentType,
      isWorkflowGoverned: isDocClassWorkflowGoverned({
        direction: normalizedDirection,
        documentType: normalizedDocumentType,
      }),
      hasPersistedOverride: false,
    };
  }
}

export default {
  AP_WORKFLOW_COMPAT_MODE,
  FEATURE_AP_DOCUMENT_WORKFLOW_V1,
  getCariDocumentClassWorkflowMetadata,
  getCariDocumentWorkflowFeatureState,
};
