import assert from "node:assert/strict";
import { syncCariDocumentFromWorkflowRequestTx } from "../src/services/cari.document.workflow.runtime.service.js";

function buildDocumentRow(status) {
  return {
    id: 42,
    tenant_id: 7,
    status,
    direction: "AP",
    document_type: "INVOICE",
    return_reason: null,
    returned_at: null,
    row_version: 1,
    is_workflow_governed: 1,
  };
}

function createRunQuery(documentStatus) {
  const calls = [];

  const runQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM cari_documents") && sql.includes("FOR UPDATE")) {
      return {
        rows: [buildDocumentRow(documentStatus)],
      };
    }
    if (sql.includes("UPDATE cari_documents")) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query in regression test: ${sql}`);
  };

  return { runQuery, calls };
}

async function expectProtectedStatus({ documentStatus, requestStatus }) {
  const { runQuery, calls } = createRunQuery(documentStatus);
  const result = await syncCariDocumentFromWorkflowRequestTx({
    tenantId: 7,
    requestRow: {
      target_type: "CARI_DOCUMENT",
      target_id: 42,
      request_status: requestStatus,
    },
    legacyInstanceRow: {
      process_type: "AP_DOCUMENT_POSTING",
    },
    runQuery,
  });

  assert.equal(result?.documentId, 42);
  assert.equal(result?.status, documentStatus);
  assert.equal(
    calls.some((entry) => entry.sql.includes("UPDATE cari_documents")),
    false,
    `${requestStatus} sync should not update ${documentStatus} documents`
  );
}

async function expectMutableApprovalSync() {
  const { runQuery, calls } = createRunQuery("DRAFT");
  const result = await syncCariDocumentFromWorkflowRequestTx({
    tenantId: 7,
    requestRow: {
      target_type: "CARI_DOCUMENT",
      target_id: 42,
      request_status: "APPROVED",
    },
    legacyInstanceRow: {
      process_type: "AP_DOCUMENT_POSTING",
    },
    runQuery,
  });

  assert.equal(result?.documentId, 42);
  assert.equal(result?.status, "APPROVED");
  assert.equal(
    calls.some((entry) => entry.sql.includes("UPDATE cari_documents")),
    true,
    "APPROVED sync should still update mutable pre-posting document statuses"
  );
}

async function main() {
  await expectProtectedStatus({
    documentStatus: "PARTIALLY_SETTLED",
    requestStatus: "APPROVED",
  });
  await expectProtectedStatus({
    documentStatus: "SETTLED",
    requestStatus: "APPROVED",
  });
  await expectProtectedStatus({
    documentStatus: "POSTED",
    requestStatus: "RETURNED",
  });
  await expectProtectedStatus({
    documentStatus: "SETTLED",
    requestStatus: "REJECTED",
  });
  await expectMutableApprovalSync();

  console.log("test-cari-workflow-posted-status-regression passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
