import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  isDocClassWorkflowGoverned,
  normalizeCariDocumentWorkflowDirection,
  normalizeCariDocumentWorkflowType,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
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
  getCariDocumentClassWorkflowMetadata,
};
