import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { deleteEvidenceBinary } from "../src/services/evidence.storage.adapter.js";
import {
  createInventoryTransferEvidenceDraft,
  deleteInventoryTransferEvidenceByIdForTenant,
  getInventoryTransferEvidenceContentForTenant,
  listInventoryTransferEvidenceForTenant,
  uploadInventoryTransferEvidenceContent,
} from "../src/services/evidence.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected async error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected async error containing "${expectedMessage}", got "${message}"`
  );
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

function normalizeSourceText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function buildReq(tenantId, userId) {
  return {
    user: {
      tenantId,
      userId,
    },
    body: {},
    query: {},
    params: {},
  };
}

async function loadSmokeContext() {
  const result = await query(
    `SELECT le.tenant_id, le.id AS legal_entity_id, u.id AS user_id
       FROM legal_entities le
       JOIN users u
         ON u.tenant_id = le.tenant_id
      WHERE le.status = 'ACTIVE'
      ORDER BY le.id ASC
      LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "Expected one active legal entity with at least one user");
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    userId: Number(row.user_id),
    transferDate: todayDateOnly(),
  };
}

async function loadActiveWarehouses(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id, ownership_scope, operating_unit_id
       FROM inventory_warehouses
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status = 'ACTIVE'
      ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

async function createWarehouseFixture({ tenantId, legalEntityId }) {
  const code = uniqueCode("OU07WH");
  const result = await query(
    `INSERT INTO inventory_warehouses (
        tenant_id,
        legal_entity_id,
        ownership_scope,
        operating_unit_id,
        code,
        name,
        status
     ) VALUES (?, ?, 'CENTRAL', NULL, ?, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, `${code} Evidence Warehouse`]
  );
  const warehouseId = Number(result.rows?.insertId || 0);
  assert(warehouseId > 0, "Expected warehouse fixture insert id");
  return warehouseId;
}

async function ensureTransferWarehouses(context) {
  const createdWarehouseIds = [];
  let warehouses = await loadActiveWarehouses(context.tenantId, context.legalEntityId);
  while (warehouses.length < 2) {
    const createdId = await createWarehouseFixture(context);
    createdWarehouseIds.push(createdId);
    warehouses = await loadActiveWarehouses(context.tenantId, context.legalEntityId);
  }
  return {
    sourceWarehouse: warehouses[0],
    targetWarehouse: warehouses[1],
    createdWarehouseIds,
  };
}

async function insertTransferFixture(context, sourceWarehouse, targetWarehouse) {
  const transferNo = uniqueCode("TRF-OU07-");
  const result = await query(
    `INSERT INTO inventory_transfers (
        tenant_id,
        legal_entity_id,
        transfer_no,
        transfer_date,
        source_warehouse_id,
        target_warehouse_id,
        source_ownership_scope,
        source_operating_unit_id,
        target_ownership_scope,
        target_operating_unit_id,
        initiated_by_user_id,
        note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      context.tenantId,
      context.legalEntityId,
      transferNo,
      context.transferDate,
      Number(sourceWarehouse.id),
      Number(targetWarehouse.id),
      String(sourceWarehouse.ownership_scope || "CENTRAL"),
      Number(sourceWarehouse.operating_unit_id || 0) || null,
      String(targetWarehouse.ownership_scope || "CENTRAL"),
      Number(targetWarehouse.operating_unit_id || 0) || null,
      context.userId,
      "OU07 transfer evidence smoke",
    ]
  );
  const transferId = Number(result.rows?.insertId || 0);
  assert(transferId > 0, "Expected transfer fixture insert id");
  return transferId;
}

async function cleanupEvidenceRows(transferId) {
  const result = await query(
    `SELECT id, storage_path
       FROM evidence_objects
      WHERE source_ref_type = 'INVENTORY_TRANSFER'
        AND source_ref_id = ?`,
    [transferId]
  );
  for (const row of result.rows || []) {
    if (row?.storage_path) {
      await deleteEvidenceBinary({ storagePath: row.storage_path }).catch(() => {});
    }
  }
  await query(
    `DELETE FROM evidence_objects
      WHERE source_ref_type = 'INVENTORY_TRANSFER'
        AND source_ref_id = ?`,
    [transferId]
  );
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const evidenceServiceSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.service.js"),
    "utf8"
  );
  const evidenceRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/inventory.transfer.evidence.routes.js"),
    "utf8"
  );
  const transferRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/inventory.transfer.routes.js"),
    "utf8"
  );
  const inventoryApiSource = await readFile(
    path.resolve(root, "frontend/src/api/inventory.js"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/inventory/InventoryTransfersPage.jsx"),
    "utf8"
  );
  const normalizedEvidenceRouteSource = normalizeSourceText(evidenceRouteSource);

  assert(
    evidenceServiceSource.includes('SOURCE_REF_TYPE_INVENTORY_TRANSFER = "INVENTORY_TRANSFER"') &&
      evidenceServiceSource.includes("findInventoryTransferRow") &&
      evidenceServiceSource.includes("assertInventoryTransferScope") &&
      evidenceServiceSource.includes("createInventoryTransferEvidenceDraft") &&
      evidenceServiceSource.includes("listInventoryTransferEvidenceForTenant") &&
      evidenceServiceSource.includes("uploadInventoryTransferEvidenceContent") &&
      evidenceServiceSource.includes("getInventoryTransferEvidenceContentForTenant") &&
      evidenceServiceSource.includes("deleteInventoryTransferEvidenceByIdForTenant"),
    "Evidence service should expose inventory transfer evidence lifecycle helpers"
  );
  assert(
    normalizedEvidenceRouteSource.includes('router.get(\n  "/"') &&
      normalizedEvidenceRouteSource.includes('router.post(\n  "/"') &&
      normalizedEvidenceRouteSource.includes('router.delete(\n  "/:evidenceId"') &&
      normalizedEvidenceRouteSource.includes('"/:evidenceId/content"') &&
      normalizedEvidenceRouteSource.includes('"/:evidenceId/download"') &&
      normalizedEvidenceRouteSource.includes('requirePermission("inventory.read"') &&
      normalizedEvidenceRouteSource.includes('requirePermission("inventory.upsert"'),
    "Inventory transfer evidence routes should provide list/create/upload/download/delete with inventory permission guards"
  );
  assert(
    transferRouteSource.includes(
      'router.use("/transfers/:transferId/evidence", inventoryTransferEvidenceRoutes)'
    ),
    "Inventory transfer router should mount /transfers/:transferId/evidence routes"
  );
  assert(
    inventoryApiSource.includes("export async function listInventoryTransferEvidence") &&
      inventoryApiSource.includes("export async function createInventoryTransferEvidence") &&
      inventoryApiSource.includes("export async function uploadInventoryTransferEvidenceContent") &&
      inventoryApiSource.includes("export async function downloadInventoryTransferEvidence") &&
      inventoryApiSource.includes("export async function deleteInventoryTransferEvidence"),
    "Inventory frontend API should expose transfer evidence list/create/upload/download/delete clients"
  );
  assert(
    pageSource.includes("Evidence attachments") &&
      pageSource.includes("handleAttachEvidence") &&
      pageSource.includes("handleDownloadEvidence") &&
      pageSource.includes("handleDeleteEvidence") &&
      pageSource.includes("listInventoryTransferEvidence") &&
      pageSource.includes("createInventoryTransferEvidence") &&
      pageSource.includes("uploadInventoryTransferEvidenceContent") &&
      pageSource.includes("downloadInventoryTransferEvidence") &&
      pageSource.includes("deleteInventoryTransferEvidence"),
    "InventoryTransfersPage should provide evidence uploader/list/download/delete UI wired to transfer evidence APIs"
  );

  const context = await loadSmokeContext();
  const { sourceWarehouse, targetWarehouse, createdWarehouseIds } =
    await ensureTransferWarehouses(context);
  const transferId = await insertTransferFixture(context, sourceWarehouse, targetWarehouse);
  const req = buildReq(context.tenantId, context.userId);
  const scopeCalls = [];

  try {
    const evidenceDraft = await createInventoryTransferEvidenceDraft({
      req,
      input: {
        tenantId: context.tenantId,
        transferId,
        userId: context.userId,
        fileName: "transfer-proof.txt",
        displayName: "Transfer Proof",
        note: "OU07 smoke evidence",
      },
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });

    assert(
      Number(evidenceDraft.id) > 0 &&
        evidenceDraft.sourceRefType === "INVENTORY_TRANSFER" &&
        evidenceDraft.status === "PENDING_UPLOAD",
      "Evidence draft should be created in PENDING_UPLOAD status for the transfer"
    );

    const evidenceContent = Buffer.from("OU07 inventory transfer evidence payload", "utf8");
    const uploadedEvidence = await uploadInventoryTransferEvidenceContent({
      req,
      input: {
        tenantId: context.tenantId,
        transferId,
        evidenceId: evidenceDraft.id,
        contentType: "text/plain",
      },
      binaryData: evidenceContent,
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });

    assert(
      uploadedEvidence.status === "ACTIVE" &&
        uploadedEvidence.contentType === "text/plain" &&
        Number(uploadedEvidence.fileSizeBytes || 0) === evidenceContent.length,
      "Evidence upload should activate the transfer evidence and persist metadata"
    );

    const listedEvidence = await listInventoryTransferEvidenceForTenant({
      req,
      tenantId: context.tenantId,
      transferId,
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });
    assert(
      listedEvidence.length === 1 && Number(listedEvidence[0]?.id || 0) === Number(evidenceDraft.id),
      "Transfer evidence list should return the uploaded evidence row"
    );

    const contentPayload = await getInventoryTransferEvidenceContentForTenant({
      req,
      tenantId: context.tenantId,
      transferId,
      evidenceId: evidenceDraft.id,
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });
    assert(
      String(contentPayload?.data?.toString("utf8") || "") === evidenceContent.toString("utf8"),
      "Transfer evidence content download should return the uploaded binary payload"
    );

    const deletedEvidence = await deleteInventoryTransferEvidenceByIdForTenant({
      req,
      input: {
        tenantId: context.tenantId,
        transferId,
        evidenceId: evidenceDraft.id,
        userId: context.userId,
      },
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });
    assert(
      deletedEvidence.status === "DELETED",
      "Transfer evidence delete should soft-delete the evidence row"
    );

    const listedAfterDelete = await listInventoryTransferEvidenceForTenant({
      req,
      tenantId: context.tenantId,
      transferId,
      assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
        scopeCalls.push({ scopeType, scopeId, fieldName });
      },
    });
    assert(
      listedAfterDelete.length === 0,
      "Deleted transfer evidence should no longer appear in list responses"
    );

    await assertThrowsAsync(
      () =>
        getInventoryTransferEvidenceContentForTenant({
          req,
          tenantId: context.tenantId,
          transferId,
          evidenceId: evidenceDraft.id,
          assertScopeAccess: (_req, scopeType, scopeId, fieldName) => {
            scopeCalls.push({ scopeType, scopeId, fieldName });
          },
        }),
      "Evidence object not found"
    );

    assert(
      scopeCalls.length > 0 &&
        scopeCalls.every(
          (call) =>
            call.scopeType === "legal_entity" &&
            Number(call.scopeId) === Number(context.legalEntityId) &&
            call.fieldName === "transferId"
        ),
      "Transfer evidence scope helper should assert legal entity access on every lifecycle operation"
    );

    console.log("Inventory OU07 transfer evidence smoke passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          transferId,
          evidenceScopeCalls: scopeCalls.length,
        },
        null,
        2
      )
    );

    await cleanupEvidenceRows(transferId);
    await query(`DELETE FROM inventory_transfers WHERE id = ?`, [transferId]);
    if (createdWarehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses WHERE id IN (${createdWarehouseIds.map(() => "?").join(",")})`,
        createdWarehouseIds
      );
    }
  } finally {
    await cleanupEvidenceRows(transferId).catch(() => {});
    await query(`DELETE FROM inventory_transfers WHERE id = ?`, [transferId]).catch(() => {});
    if (createdWarehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses WHERE id IN (${createdWarehouseIds.map(() => "?").join(",")})`,
        createdWarehouseIds
      ).catch(() => {});
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
