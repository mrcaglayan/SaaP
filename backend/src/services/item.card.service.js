import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { query } from "../db.js";

function mapItemCardRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    code: row.code || null,
    name: row.name || null,
    itemType: row.item_type || null,
    defaultSalesAccountId: parsePositiveInt(row.default_sales_account_id),
    defaultPurchaseAccountId: parsePositiveInt(row.default_purchase_account_id),
    inventoryAssetAccountId: parsePositiveInt(row.inventory_asset_account_id),
    inventoryTransitAccountId: parsePositiveInt(row.inventory_transit_account_id),
    defaultCogsAccountId: parsePositiveInt(row.default_cogs_account_id),
    taxCategoryCode: row.tax_category_code || null,
    status: row.status || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeSqlLikeQuery(value) {
  const normalized = String(value || "").trim();
  return normalized ? `%${normalized}%` : "";
}

export async function resolveItemCardScope(itemCardId, tenantId, runQuery = query) {
  const normalizedItemCardId = parsePositiveInt(itemCardId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedItemCardId || !normalizedTenantId) {
    return null;
  }
  const result = await runQuery(
    `SELECT legal_entity_id
       FROM item_cards
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedTenantId, normalizedItemCardId]
  );
  const row = Array.isArray(result?.rows) ? result.rows[0] || null : null;
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  return legalEntityId
    ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
    : null;
}

export async function resolveItemCardLineDefaults({
  tenantId,
  legalEntityId,
  itemCardId,
  direction,
  runQuery = query,
}) {
  const itemCard = await getItemCardByIdForTenant({
    tenantId,
    itemCardId,
    runQuery,
  });
  const scopedLegalEntityId = parsePositiveInt(itemCard?.legalEntityId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (
    scopedLegalEntityId &&
    normalizedLegalEntityId &&
    scopedLegalEntityId !== normalizedLegalEntityId
  ) {
    throw badRequest("itemCardId must belong to legalEntityId or be global");
  }

  const normalizedDirection = String(direction || "")
    .trim()
    .toUpperCase();
  if (!["AR", "AP"].includes(normalizedDirection)) {
    throw badRequest("direction must be AR or AP for item card defaults");
  }

  const itemType = String(itemCard?.itemType || "")
    .trim()
    .toUpperCase();
  const isStockItem = itemType === "STOCK_ITEM";
  const defaultPostingAccountId =
    normalizedDirection === "AR"
      ? itemCard?.defaultSalesAccountId || null
      : isStockItem
        ? itemCard?.inventoryAssetAccountId ||
          itemCard?.defaultPurchaseAccountId ||
          null
        : itemCard?.defaultPurchaseAccountId || null;
  const defaultStockImpactMode = isStockItem
    ? normalizedDirection === "AP"
      ? "RECEIPT_PENDING"
      : "ISSUE_PENDING"
    : "NONE";

  return {
    itemCard,
    itemType,
    isStockItem,
    defaultPostingAccountId: parsePositiveInt(defaultPostingAccountId),
    defaultTaxCategoryCode: itemCard?.taxCategoryCode || null,
    defaultStockImpactMode,
  };
}

export async function listItemCards({
  tenantId,
  filters,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  const params = [normalizedTenantId];
  let whereSql = "WHERE tenant_id = ?";

  if (legalEntityId) {
    whereSql += " AND (legal_entity_id = ? OR legal_entity_id IS NULL)";
    params.push(legalEntityId);
  } else {
    whereSql += " AND legal_entity_id IS NULL";
  }

  if (filters?.status) {
    whereSql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.itemType) {
    whereSql += " AND item_type = ?";
    params.push(filters.itemType);
  }
  if (filters?.q) {
    const likeQuery = normalizeSqlLikeQuery(filters.q);
    if (likeQuery) {
      whereSql += " AND (code LIKE ? OR name LIKE ?)";
      params.push(likeQuery, likeQuery);
    }
  }

  const normalizedLimit = Number.isInteger(filters?.limit)
    ? Math.max(1, Math.min(filters.limit, 500))
    : 100;
  const normalizedOffset = Number.isInteger(filters?.offset) && filters.offset >= 0
    ? filters.offset
    : 0;

  const totalResult = await runQuery(
    `SELECT COUNT(*) AS total
       FROM item_cards
       ${whereSql}`,
    params
  );
  const total = Number(totalResult?.rows?.[0]?.total || 0);

  const rowsResult = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        code,
        name,
        item_type,
        default_sales_account_id,
        default_purchase_account_id,
        inventory_asset_account_id,
        inventory_transit_account_id,
        default_cogs_account_id,
        tax_category_code,
        status,
        created_at,
        updated_at
       FROM item_cards
       ${whereSql}
       ORDER BY code ASC, id ASC
       LIMIT ${normalizedLimit}
       OFFSET ${normalizedOffset}`,
    params
  );

  return {
    total,
    rows: (Array.isArray(rowsResult?.rows) ? rowsResult.rows : []).map(mapItemCardRow),
  };
}

export async function getItemCardByIdForTenant({
  tenantId,
  itemCardId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedItemCardId = parsePositiveInt(itemCardId);
  if (!normalizedTenantId || !normalizedItemCardId) {
    throw badRequest("tenantId and itemCardId are required");
  }
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        code,
        name,
        item_type,
        default_sales_account_id,
        default_purchase_account_id,
        inventory_asset_account_id,
        inventory_transit_account_id,
        default_cogs_account_id,
        tax_category_code,
        status,
        created_at,
        updated_at
       FROM item_cards
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedTenantId, normalizedItemCardId]
  );
  const row = Array.isArray(result?.rows) ? result.rows[0] || null : null;
  if (!row) {
    throw badRequest("Item card not found");
  }
  return mapItemCardRow(row);
}

function handleWriteError(error) {
  if (Number(error?.errno) === 1062) {
    throw badRequest("Item card code already exists in the selected scope");
  }
  throw error;
}

export async function createItemCard({
  payload,
  runQuery = query,
}) {
  try {
    const insertResult = await runQuery(
      `INSERT INTO item_cards (
          tenant_id,
          legal_entity_id,
          code,
          name,
          item_type,
          default_sales_account_id,
          default_purchase_account_id,
          inventory_asset_account_id,
          inventory_transit_account_id,
          default_cogs_account_id,
          tax_category_code,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.tenantId,
        payload.legalEntityId || null,
        payload.code,
        payload.name,
        payload.itemType,
        payload.defaultSalesAccountId || null,
        payload.defaultPurchaseAccountId || null,
        payload.inventoryAssetAccountId || null,
        payload.inventoryTransitAccountId || null,
        payload.defaultCogsAccountId || null,
        payload.taxCategoryCode || null,
        payload.status,
      ]
    );
    return getItemCardByIdForTenant({
      tenantId: payload.tenantId,
      itemCardId: insertResult?.rows?.insertId,
      runQuery,
    });
  } catch (error) {
    handleWriteError(error);
  }
}

export async function updateItemCardById({
  payload,
  runQuery = query,
}) {
  try {
    const updateResult = await runQuery(
      `UPDATE item_cards
          SET legal_entity_id = ?,
              code = ?,
              name = ?,
              item_type = ?,
              default_sales_account_id = ?,
              default_purchase_account_id = ?,
              inventory_asset_account_id = ?,
              inventory_transit_account_id = ?,
              default_cogs_account_id = ?,
              tax_category_code = ?,
              status = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [
        payload.legalEntityId || null,
        payload.code,
        payload.name,
        payload.itemType,
        payload.defaultSalesAccountId || null,
        payload.defaultPurchaseAccountId || null,
        payload.inventoryAssetAccountId || null,
        payload.inventoryTransitAccountId || null,
        payload.defaultCogsAccountId || null,
        payload.taxCategoryCode || null,
        payload.status,
        payload.tenantId,
        payload.itemCardId,
      ]
    );
    if (!updateResult?.rows?.affectedRows) {
      throw badRequest("Item card not found");
    }
    return getItemCardByIdForTenant({
      tenantId: payload.tenantId,
      itemCardId: payload.itemCardId,
      runQuery,
    });
  } catch (error) {
    handleWriteError(error);
  }
}
