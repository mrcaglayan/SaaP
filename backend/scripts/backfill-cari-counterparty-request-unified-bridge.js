import { closePool, query } from "../src/db.js";
import {
  bridgePendingCounterpartyRequestToUnifiedApproval,
} from "../src/services/cari.counterparty-request.service.js";

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function main() {
  const tenantId = toPositiveInt(process.argv[2]) || null;
  const requestId = toPositiveInt(process.argv[3]) || null;
  const where = ["approval_request_id IS NULL", "request_status = 'PENDING'"];
  const params = [];
  if (tenantId) {
    where.push("tenant_id = ?");
    params.push(tenantId);
  }
  if (requestId) {
    where.push("id = ?");
    params.push(requestId);
  }

  const result = await query(
    `SELECT id, tenant_id
     FROM counterparty_requests
     WHERE ${where.join(" AND ")}
     ORDER BY id ASC`,
    params
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    console.log("No pending legacy counterparty requests needed backfill.");
    return;
  }

  const bridgedRows = await Promise.all(rows.map((row) =>
    bridgePendingCounterpartyRequestToUnifiedApproval({
      req: null,
      tenantId: toPositiveInt(row.tenant_id),
      requestId: toPositiveInt(row.id),
    })
  ));

  for (const bridged of bridgedRows) {
    console.log(
      `Bridged counterparty request ${bridged.id} -> approvalRequestId=${bridged.approvalRequest?.id || "?"}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
