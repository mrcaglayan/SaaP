import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { buildLocalClosePackScopeKey } from "./local.close-packs.shared.js";
import {
  buildCloseCycleItemScopeId,
  CLOSE_CYCLE_ITEM_BUSINESS_STATUS_VALUES,
  CLOSE_CYCLE_ITEM_SCOPE_TYPES,
  CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES,
  CLOSE_CYCLE_ITEM_TYPES,
  CLOSE_CYCLE_SOURCE_TARGET_TYPES,
} from "./close.cycles.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message, details = null, code = "CLOSE_CYCLE_CONFLICT") {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  return err;
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function normalizeBusinessStatus(status) {
  const normalized = toUpperText(status);
  if (!CLOSE_CYCLE_ITEM_BUSINESS_STATUS_VALUES.includes(normalized)) {
    throw badRequest(`Unsupported close-cycle item business status: ${status}`);
  }
  return normalized;
}

function normalizeStaleStatus(status) {
  const normalized = toUpperText(status);
  if (!CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES.includes(normalized)) {
    throw badRequest(`Unsupported close-cycle item stale status: ${status}`);
  }
  return normalized;
}

function normalizeItemType(itemType) {
  const normalized = toUpperText(itemType);
  if (!CLOSE_CYCLE_ITEM_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close-cycle item type: ${itemType}`);
  }
  return normalized;
}

function normalizeScopeType(scopeType) {
  const normalized = toUpperText(scopeType);
  if (!CLOSE_CYCLE_ITEM_SCOPE_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close-cycle item scope type: ${scopeType}`);
  }
  return normalized;
}

function normalizeSourceTargetType(sourceTargetType) {
  const normalized = toUpperText(sourceTargetType);
  if (!CLOSE_CYCLE_SOURCE_TARGET_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close-cycle source target type: ${sourceTargetType}`);
  }
  return normalized;
}

function mapCloseCycleItemRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    itemType: toUpperText(row.item_type),
    itemKey: String(row.item_key || ""),
    scopeType: toUpperText(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    bookId: parsePositiveInt(row.book_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    runName: row.run_name ? toUpperText(row.run_name) : null,
    presentationCurrencyCode: row.presentation_currency_code
      ? toUpperText(row.presentation_currency_code)
      : null,
    businessStatus: toUpperText(row.business_status),
    staleStatus: toUpperText(row.stale_status),
    staleResolvedAt: row.stale_resolved_at || null,
    staleResolvedByUserId: parsePositiveInt(row.stale_resolved_by_user_id),
    ownerUserId: parsePositiveInt(row.owner_user_id),
    dueAt: row.due_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    currentSourceTargetType: row.current_source_target_type
      ? toUpperText(row.current_source_target_type)
      : null,
    currentSourceTargetId: parsePositiveInt(row.current_source_target_id),
    currentLinkCreatedAt: row.current_link_created_at || null,
    closeCycleTenantId: parsePositiveInt(row.close_cycle_tenant_id),
    closeCycleFiscalPeriodId: parsePositiveInt(row.close_cycle_fiscal_period_id),
    closeCycleStatus: row.close_cycle_status ? toUpperText(row.close_cycle_status) : null,
  };
}

function buildItemSelect(whereSql = "1 = 1") {
  return `SELECT
      cci.*,
      cc.tenant_id AS close_cycle_tenant_id,
      cc.fiscal_period_id AS close_cycle_fiscal_period_id,
      cc.status AS close_cycle_status,
      ccil.source_target_type AS current_source_target_type,
      ccil.source_target_id AS current_source_target_id,
      ccil.created_at AS current_link_created_at
    FROM close_cycle_items cci
    JOIN close_cycles cc ON cc.id = cci.close_cycle_id
    LEFT JOIN close_cycle_item_links ccil
      ON ccil.close_cycle_item_id = cci.id
     AND ccil.is_current = TRUE
    WHERE ${whereSql}`;
}

async function loadCloseCycleItemRow({
  closeCycleItemId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${buildItemSelect("cci.id = ?")}
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [closeCycleItemId]
  );
  return result.rows?.[0] || null;
}

async function loadCloseCycleItemByKey({
  closeCycleId,
  itemType,
  itemKey,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${buildItemSelect(
      "cci.close_cycle_id = ? AND cci.item_type = ? AND cci.item_key = ?"
    )}
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [closeCycleId, itemType, itemKey]
  );
  return result.rows?.[0] || null;
}

async function loadLocalClosePackSourceRow(sourceTargetId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       book_id,
       fiscal_period_id,
       close_scope_type,
       scope_key,
       operating_unit_id,
       status
     FROM local_close_packs
     WHERE id = ?
     LIMIT 1`,
    [sourceTargetId]
  );
  return result.rows?.[0] || null;
}

async function loadPeriodCloseRunSourceRow(sourceTargetId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       book_id,
       fiscal_period_id,
       status
     FROM period_close_runs
     WHERE id = ?
     LIMIT 1`,
    [sourceTargetId]
  );
  return result.rows?.[0] || null;
}

async function loadConsolidationRunSourceRow(sourceTargetId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       cr.id,
       cg.tenant_id,
       cr.consolidation_group_id,
       cr.fiscal_period_id,
       cr.run_name,
       cr.presentation_currency_code,
       cr.status
     FROM consolidation_runs cr
     JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
     WHERE cr.id = ?
     LIMIT 1`,
    [sourceTargetId]
  );
  return result.rows?.[0] || null;
}

async function loadSourceRow(sourceTargetType, sourceTargetId, runQuery = query) {
  const normalizedSourceTargetType = normalizeSourceTargetType(sourceTargetType);
  const normalizedSourceTargetId = parsePositiveInt(sourceTargetId);
  if (!normalizedSourceTargetId) {
    throw badRequest("sourceTargetId must be a positive integer");
  }

  if (normalizedSourceTargetType === "LOCAL_CLOSE_PACK") {
    return loadLocalClosePackSourceRow(normalizedSourceTargetId, runQuery);
  }
  if (normalizedSourceTargetType === "PERIOD_CLOSE_RUN") {
    return loadPeriodCloseRunSourceRow(normalizedSourceTargetId, runQuery);
  }
  return loadConsolidationRunSourceRow(normalizedSourceTargetId, runQuery);
}

function buildSourceIdentityFromRow(sourceTargetType, row) {
  const normalizedSourceTargetType = normalizeSourceTargetType(sourceTargetType);
  if (!row) {
    return null;
  }

  if (normalizedSourceTargetType === "LOCAL_CLOSE_PACK") {
    return {
      tenantId: parsePositiveInt(row.tenant_id),
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      bookId: parsePositiveInt(row.book_id),
      fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
      closeScopeType: toUpperText(row.close_scope_type),
      scopeKey: String(row.scope_key || ""),
      operatingUnitId: parsePositiveInt(row.operating_unit_id),
      businessStatus: toUpperText(row.status),
    };
  }
  if (normalizedSourceTargetType === "PERIOD_CLOSE_RUN") {
    return {
      tenantId: parsePositiveInt(row.tenant_id),
      bookId: parsePositiveInt(row.book_id),
      fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
      businessStatus: toUpperText(row.status),
    };
  }
  return {
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    runName: toUpperText(row.run_name),
    presentationCurrencyCode: toUpperText(row.presentation_currency_code),
    businessStatus: toUpperText(row.status),
  };
}

function canResolveRecoveredStaleState(item = {}) {
  const itemType = toUpperText(item?.itemType);
  const businessStatus = toUpperText(item?.businessStatus);
  if (itemType === "PERIOD_CLOSE_RUN") {
    return businessStatus === "COMPLETED";
  }
  if (itemType === "LOCAL_CLOSE_PACK") {
    return ["APPROVED", "LOCKED"].includes(businessStatus);
  }
  if (itemType === "CONSOLIDATION_RUN") {
    return ["COMPLETED", "LOCKED"].includes(businessStatus);
  }
  return false;
}

async function recordStaleResolutionEvent(
  {
    item,
    sourceTargetType,
    sourceTargetId,
    previousStaleStatus,
  },
  actorCtx = {}
) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const closeCycleId = parsePositiveInt(item?.closeCycleId);
  const tenantId =
    resolveActorTenantId(actorCtx) || parsePositiveInt(item?.closeCycleTenantId);
  if (!closeCycleId || !tenantId) {
    return null;
  }

  await runQuery(
    `INSERT INTO close_stale_events (
        close_cycle_id,
        close_cycle_item_id,
        source_target_type,
        source_target_id,
        event_code,
        target_stale_status,
        payload_json,
        created_by_user_id
     )
     SELECT
       ?,
       ?,
       ?,
       ?,
       'STALE_RESOLVED_AFTER_RERUN',
       'FRESH',
       ?,
       ?
     FROM close_cycles cc
     WHERE cc.id = ?
       AND cc.tenant_id = ?`,
    [
      closeCycleId,
      parsePositiveInt(item?.id),
      normalizeSourceTargetType(sourceTargetType),
      parsePositiveInt(sourceTargetId) || null,
      JSON.stringify({
        previousStaleStatus: previousStaleStatus || "FRESH",
        recoveredBusinessStatus: item?.businessStatus || null,
        itemType: item?.itemType || null,
      }),
      parsePositiveInt(actorCtx?.userId) || null,
      closeCycleId,
      tenantId,
    ]
  );
  return true;
}

async function resolveRecoveredItemFreshness(
  item,
  {
    sourceTargetType,
    sourceTargetId,
  },
  actorCtx = {}
) {
  const previousStaleStatus = toUpperText(item?.staleStatus);
  if (previousStaleStatus === "FRESH" || !canResolveRecoveredStaleState(item)) {
    return {
      resolved: false,
      row: item,
    };
  }

  const refreshedItem = await setItemStaleStatus(parsePositiveInt(item?.id), "FRESH", actorCtx);
  await recordStaleResolutionEvent(
    {
      item: refreshedItem,
      sourceTargetType,
      sourceTargetId,
      previousStaleStatus,
    },
    actorCtx
  );
  return {
    resolved: true,
    row: refreshedItem,
  };
}

function assertCurrentItemLinkShape(rows = []) {
  const rowsByCycleId = new Map();
  for (const row of rows) {
    const cycleId = parsePositiveInt(row?.close_cycle_id);
    if (!cycleId) {
      continue;
    }
    const currentCount = (rowsByCycleId.get(cycleId) || 0) + 1;
    rowsByCycleId.set(cycleId, currentCount);
    if (currentCount > 1) {
      throw conflict(
        "More than one close-cycle item in the same cycle matched the same source dimensions",
        {
          closeCycleId: cycleId,
        },
        "CLOSE_CYCLE_DATA_CORRUPTION"
      );
    }
  }
}

function assertSingleCurrentLinkForItem(rows = [], closeCycleItemId = null) {
  if ((rows || []).length <= 1) {
    return;
  }

  throw conflict(
    "More than one current source link exists for the same close-cycle item",
    {
      closeCycleItemId: parsePositiveInt(closeCycleItemId),
      currentLinkIds: (rows || [])
        .map((row) => parsePositiveInt(row?.id))
        .filter(Boolean),
    },
    "CLOSE_CYCLE_DATA_CORRUPTION"
  );
}

function assertItemDimensionsMatch(existingRow, input) {
  const immutableFields = [
    ["item_type", normalizeItemType(input.itemType)],
    ["item_key", String(input.itemKey || "").trim()],
    ["scope_type", normalizeScopeType(input.scopeType)],
    ["scope_id", parsePositiveInt(input.scopeId)],
    ["legal_entity_id", parsePositiveInt(input.legalEntityId)],
    ["operating_unit_id", parsePositiveInt(input.operatingUnitId)],
    ["book_id", parsePositiveInt(input.bookId)],
    ["consolidation_group_id", parsePositiveInt(input.consolidationGroupId)],
    [
      "run_name",
      input.runName === undefined || input.runName === null
        ? null
        : toUpperText(input.runName),
    ],
    [
      "presentation_currency_code",
      input.presentationCurrencyCode === undefined || input.presentationCurrencyCode === null
        ? null
        : toUpperText(input.presentationCurrencyCode),
    ],
  ];

  for (const [columnName, expectedValue] of immutableFields) {
    if (expectedValue === undefined) {
      continue;
    }
    const actualValue = existingRow?.[columnName];
    const normalizedActualValue =
      typeof actualValue === "string" ? toUpperText(actualValue) : parsePositiveInt(actualValue);
    const normalizedExpectedValue =
      typeof expectedValue === "string" ? toUpperText(expectedValue) : expectedValue;
    if ((normalizedActualValue || null) !== (normalizedExpectedValue || null)) {
      throw conflict(
        `Existing close-cycle item ${existingRow.id} does not match the requested immutable dimensions`,
        {
          closeCycleItemId: parsePositiveInt(existingRow.id),
          columnName,
          actualValue: actualValue ?? null,
          expectedValue: expectedValue ?? null,
        },
        "CLOSE_CYCLE_ITEM_IDENTITY_CONFLICT"
      );
    }
  }
}

function validateSourceDimensionsMatch(itemRow, sourceTargetType, sourceIdentity) {
  const normalizedSourceTargetType = normalizeSourceTargetType(sourceTargetType);
  if (parsePositiveInt(itemRow?.close_cycle_tenant_id) !== parsePositiveInt(sourceIdentity?.tenantId)) {
    throw conflict(
      "The selected source row belongs to a different tenant than the close cycle",
      {
        closeCycleItemId: parsePositiveInt(itemRow?.id),
      },
      "CLOSE_CYCLE_SOURCE_DIMENSION_MISMATCH"
    );
  }

  if (normalizedSourceTargetType === "LOCAL_CLOSE_PACK") {
    const expectedScopeKey =
      toUpperText(itemRow?.scope_type) === "CENTRAL"
        ? buildLocalClosePackScopeKey({
            closeScopeType: "CENTRAL",
          })
        : buildLocalClosePackScopeKey({
            closeScopeType: "OPERATING_UNIT",
            operatingUnitId: parsePositiveInt(itemRow?.operating_unit_id),
          });

    if (
      parsePositiveInt(itemRow?.book_id) !== parsePositiveInt(sourceIdentity?.bookId) ||
      parsePositiveInt(itemRow?.legal_entity_id) !==
        parsePositiveInt(sourceIdentity?.legalEntityId) ||
      parsePositiveInt(itemRow?.close_cycle_fiscal_period_id) !==
        parsePositiveInt(sourceIdentity?.fiscalPeriodId) ||
      String(expectedScopeKey) !== String(sourceIdentity?.scopeKey || "")
    ) {
      throw conflict(
        "Local close pack dimensions do not match the expected close-cycle item dimensions",
        {
          closeCycleItemId: parsePositiveInt(itemRow?.id),
          sourceTargetType: normalizedSourceTargetType,
        },
        "CLOSE_CYCLE_SOURCE_DIMENSION_MISMATCH"
      );
    }
    return;
  }

  if (normalizedSourceTargetType === "PERIOD_CLOSE_RUN") {
    if (
      parsePositiveInt(itemRow?.book_id) !== parsePositiveInt(sourceIdentity?.bookId) ||
      parsePositiveInt(itemRow?.close_cycle_fiscal_period_id) !==
        parsePositiveInt(sourceIdentity?.fiscalPeriodId)
    ) {
      throw conflict(
        "Period close run dimensions do not match the expected close-cycle item dimensions",
        {
          closeCycleItemId: parsePositiveInt(itemRow?.id),
          sourceTargetType: normalizedSourceTargetType,
        },
        "CLOSE_CYCLE_SOURCE_DIMENSION_MISMATCH"
      );
    }
    return;
  }

  if (
    parsePositiveInt(itemRow?.consolidation_group_id) !==
      parsePositiveInt(sourceIdentity?.consolidationGroupId) ||
    parsePositiveInt(itemRow?.close_cycle_fiscal_period_id) !==
      parsePositiveInt(sourceIdentity?.fiscalPeriodId) ||
    toUpperText(itemRow?.run_name) !== toUpperText(sourceIdentity?.runName) ||
    toUpperText(itemRow?.presentation_currency_code) !==
      toUpperText(sourceIdentity?.presentationCurrencyCode)
  ) {
    throw conflict(
      "Consolidation run dimensions do not match the expected close-cycle item dimensions",
      {
        closeCycleItemId: parsePositiveInt(itemRow?.id),
        sourceTargetType: normalizedSourceTargetType,
      },
      "CLOSE_CYCLE_SOURCE_DIMENSION_MISMATCH"
    );
  }
}

/**
 * Create or update one close-cycle participation row while preserving its
 * immutable business identity.
 */
export async function ensureCycleItem(input, actorCtx = {}) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const closeCycleId = parsePositiveInt(input?.closeCycleId);
  const itemType = normalizeItemType(input?.itemType);
  const itemKey = String(input?.itemKey || "").trim();
  const scopeType = normalizeScopeType(input?.scopeType);
  const scopeId =
    parsePositiveInt(input?.scopeId) ||
    buildCloseCycleItemScopeId({
      scopeType,
      bookId: input?.bookId,
      legalEntityId: input?.legalEntityId,
      operatingUnitId: input?.operatingUnitId,
      consolidationGroupId: input?.consolidationGroupId,
    });
  const businessStatus = normalizeBusinessStatus(input?.businessStatus || "NOT_STARTED");
  const staleStatus = normalizeStaleStatus(input?.staleStatus || "FRESH");

  if (!closeCycleId) {
    throw badRequest("closeCycleId is required");
  }
  if (!itemKey) {
    throw badRequest("itemKey is required");
  }
  if (!scopeId) {
    throw badRequest("scopeId is required");
  }

  const insertResult = await runQuery(
    `INSERT INTO close_cycle_items (
        close_cycle_id,
        item_type,
        item_key,
        scope_type,
        scope_id,
        legal_entity_id,
        operating_unit_id,
        book_id,
        consolidation_group_id,
        run_name,
        presentation_currency_code,
        business_status,
        stale_status,
        owner_user_id,
        due_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id)`,
    [
      closeCycleId,
      itemType,
      itemKey,
      scopeType,
      scopeId,
      parsePositiveInt(input?.legalEntityId) || null,
      parsePositiveInt(input?.operatingUnitId) || null,
      parsePositiveInt(input?.bookId) || null,
      parsePositiveInt(input?.consolidationGroupId) || null,
      input?.runName ? toUpperText(input.runName) : null,
      input?.presentationCurrencyCode
        ? toUpperText(input.presentationCurrencyCode)
        : null,
      businessStatus,
      staleStatus,
      parsePositiveInt(input?.ownerUserId) || null,
      input?.dueAt || null,
    ]
  );

  const closeCycleItemId =
    parsePositiveInt(insertResult.rows?.insertId) ||
    parsePositiveInt(
      (
        await loadCloseCycleItemByKey({
          closeCycleId,
          itemType,
          itemKey,
          runQuery,
        })
      )?.id
    );
  if (!closeCycleItemId) {
    throw badRequest("Failed to resolve close-cycle item identity");
  }

  const created = Number(insertResult.rows?.affectedRows || 0) === 1;
  const existingRow = await loadCloseCycleItemRow({
    closeCycleItemId,
    runQuery,
  });
  if (!existingRow) {
    throw notFound("Close-cycle item not found");
  }

  assertItemDimensionsMatch(existingRow, {
    ...input,
    itemType,
    itemKey,
    scopeType,
    scopeId,
  });

  if (!created) {
    const ownerUserId = parsePositiveInt(input?.ownerUserId) || null;
    const dueAt = input?.dueAt || null;
    if (parsePositiveInt(existingRow.current_source_target_id)) {
      // Retries can refresh operational assignment fields, but once a source is
      // linked the row's live business status must keep following that source.
      await runQuery(
        `UPDATE close_cycle_items
         SET owner_user_id = ?,
             due_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [ownerUserId, dueAt, closeCycleItemId]
      );
    } else {
      await runQuery(
        `UPDATE close_cycle_items
         SET business_status = ?,
             stale_status = ?,
             owner_user_id = ?,
             due_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [businessStatus, staleStatus, ownerUserId, dueAt, closeCycleItemId]
      );
    }
  }

  const createdRow = await loadCloseCycleItemRow({
    closeCycleItemId,
    runQuery,
  });
  return {
    created,
    row: mapCloseCycleItemRow(createdRow || existingRow),
  };
}

/**
 * Find all provisioned close-cycle items whose frozen dimensions match a
 * source row that already exists or is about to be linked for the first time.
 */
export async function findLinkableCycleItemsForSource(
  sourceTargetType,
  sourceIdentity,
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedSourceTargetType = normalizeSourceTargetType(sourceTargetType);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  let result = null;
  if (normalizedSourceTargetType === "LOCAL_CLOSE_PACK") {
    const closeScopeType = toUpperText(sourceIdentity?.closeScopeType);
    const scopeType = closeScopeType === "CENTRAL" ? "CENTRAL" : "OPERATING_UNIT";
    result = await runQuery(
      `${buildItemSelect(
        `cc.tenant_id = ?
         AND cc.status = 'OPEN'
         AND cci.item_type = 'LOCAL_CLOSE_PACK'
         AND cci.book_id = ?
         AND cci.legal_entity_id = ?
         AND cc.fiscal_period_id = ?
         AND cci.scope_type = ?
         AND (
           (? = 'CENTRAL' AND cci.operating_unit_id IS NULL)
           OR (? = 'OPERATING_UNIT' AND cci.operating_unit_id = ?)
         )`
      )}
       ORDER BY cci.close_cycle_id ASC, cci.id ASC`,
      [
        tenantId,
        parsePositiveInt(sourceIdentity?.bookId),
        parsePositiveInt(sourceIdentity?.legalEntityId),
        parsePositiveInt(sourceIdentity?.fiscalPeriodId),
        scopeType,
        closeScopeType,
        closeScopeType,
        parsePositiveInt(sourceIdentity?.operatingUnitId) || null,
      ]
    );
  } else if (normalizedSourceTargetType === "PERIOD_CLOSE_RUN") {
    result = await runQuery(
      `${buildItemSelect(
        `cc.tenant_id = ?
         AND cc.status = 'OPEN'
         AND cci.item_type = 'PERIOD_CLOSE_RUN'
         AND cci.book_id = ?
         AND cc.fiscal_period_id = ?`
      )}
       ORDER BY cci.close_cycle_id ASC, cci.id ASC`,
      [
        tenantId,
        parsePositiveInt(sourceIdentity?.bookId),
        parsePositiveInt(sourceIdentity?.fiscalPeriodId),
      ]
    );
  } else {
    result = await runQuery(
      `${buildItemSelect(
        `cc.tenant_id = ?
         AND cc.status = 'OPEN'
         AND cci.item_type = 'CONSOLIDATION_RUN'
         AND cci.consolidation_group_id = ?
         AND cc.fiscal_period_id = ?
         AND cci.run_name = ?
         AND cci.presentation_currency_code = ?`
      )}
       ORDER BY cci.close_cycle_id ASC, cci.id ASC`,
      [
        tenantId,
        parsePositiveInt(sourceIdentity?.consolidationGroupId),
        parsePositiveInt(sourceIdentity?.fiscalPeriodId),
        toUpperText(sourceIdentity?.runName),
        toUpperText(sourceIdentity?.presentationCurrencyCode),
      ]
    );
  }

  assertCurrentItemLinkShape(result?.rows || []);
  return (result?.rows || []).map(mapCloseCycleItemRow);
}

/**
 * Find every current close-cycle item currently linked to one source row.
 */
export async function findCurrentCycleItemsBySource(
  sourceTargetType,
  sourceTargetId,
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedSourceTargetType = normalizeSourceTargetType(sourceTargetType);
  const normalizedSourceTargetId = parsePositiveInt(sourceTargetId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedSourceTargetId) {
    throw badRequest("sourceTargetId must be a positive integer");
  }

  const result = await runQuery(
    `${buildItemSelect(
      `cc.tenant_id = ?
       AND ccil.source_target_type = ?
       AND ccil.source_target_id = ?
       AND ccil.is_current = TRUE`
    )}
     ORDER BY cci.close_cycle_id ASC, cci.id ASC`,
    [tenantId, normalizedSourceTargetType, normalizedSourceTargetId]
  );

  assertCurrentItemLinkShape(result.rows || []);
  return (result.rows || []).map(mapCloseCycleItemRow);
}

/**
 * Find the one current close-cycle item linked to a source row within a
 * specific close cycle.
 */
export async function findCurrentCycleItemBySourceInCycle(
  sourceTargetType,
  sourceTargetId,
  cycleId,
  actorCtx = {}
) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const rows = await findCurrentCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx);
  const row = rows.find((candidate) => parsePositiveInt(candidate.closeCycleId) === normalizedCycleId);
  if (!row) {
    return null;
  }

  const refreshed = await loadCloseCycleItemRow({
    closeCycleItemId: parsePositiveInt(row.id),
    runQuery,
  });
  return mapCloseCycleItemRow(refreshed || row);
}

/**
 * Set the stored business status for one close-cycle item.
 */
export async function setItemBusinessStatus(itemId, status, actorCtx = {}) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedStatus = normalizeBusinessStatus(status);
  if (!normalizedItemId) {
    throw badRequest("itemId must be a positive integer");
  }

  await runQuery(
    `UPDATE close_cycle_items
     SET business_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [normalizedStatus, normalizedItemId]
  );

  const row = await loadCloseCycleItemRow({
    closeCycleItemId: normalizedItemId,
    runQuery,
  });
  if (!row) {
    throw notFound("Close-cycle item not found");
  }
  return mapCloseCycleItemRow(row);
}

/**
 * Set the stored stale status for one close-cycle item.
 */
export async function setItemStaleStatus(itemId, status, actorCtx = {}) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const userId = parsePositiveInt(actorCtx?.userId);
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedStatus = normalizeStaleStatus(status);
  if (!normalizedItemId) {
    throw badRequest("itemId must be a positive integer");
  }

  await runQuery(
    `UPDATE close_cycle_items
     SET stale_status = ?,
         stale_resolved_at = CASE WHEN ? = 'FRESH' THEN CURRENT_TIMESTAMP ELSE NULL END,
         stale_resolved_by_user_id = CASE WHEN ? = 'FRESH' THEN ? ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [normalizedStatus, normalizedStatus, normalizedStatus, userId || null, normalizedItemId]
  );

  const row = await loadCloseCycleItemRow({
    closeCycleItemId: normalizedItemId,
    runQuery,
  });
  if (!row) {
    throw notFound("Close-cycle item not found");
  }
  return mapCloseCycleItemRow(row);
}

/**
 * Validate a source row against one close-cycle item, then supersede or create
 * the current link while preserving link history.
 */
export async function linkCycleItemToSource(input, actorCtx = {}) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const closeCycleItemId = parsePositiveInt(input?.closeCycleItemId);
  const sourceTargetType = normalizeSourceTargetType(input?.sourceTargetType);
  const sourceTargetId = parsePositiveInt(input?.sourceTargetId);

  if (!closeCycleItemId) {
    throw badRequest("closeCycleItemId is required");
  }
  if (!sourceTargetId) {
    throw badRequest("sourceTargetId is required");
  }

  const itemRow = await loadCloseCycleItemRow({
    closeCycleItemId,
    runQuery,
    forUpdate: true,
  });
  if (!itemRow) {
    throw notFound("Close-cycle item not found");
  }

  const sourceRow = await loadSourceRow(sourceTargetType, sourceTargetId, runQuery);
  if (!sourceRow) {
    throw notFound(`${sourceTargetType} source row not found`);
  }
  const sourceIdentity = buildSourceIdentityFromRow(sourceTargetType, sourceRow);
  validateSourceDimensionsMatch(itemRow, sourceTargetType, sourceIdentity);

  const conflictingCurrentResult = await runQuery(
    `SELECT cci.id
     FROM close_cycle_item_links ccil
     JOIN close_cycle_items cci ON cci.id = ccil.close_cycle_item_id
     WHERE ccil.source_target_type = ?
       AND ccil.source_target_id = ?
       AND ccil.is_current = TRUE
       AND cci.close_cycle_id = ?
       AND cci.id <> ?
     LIMIT 1`,
    [
      sourceTargetType,
      sourceTargetId,
      parsePositiveInt(itemRow.close_cycle_id),
      closeCycleItemId,
    ]
  );
  if (conflictingCurrentResult.rows?.[0]) {
    throw conflict(
      "The selected source row is already the current source for another close-cycle item in the same cycle",
      {
        closeCycleId: parsePositiveInt(itemRow.close_cycle_id),
        sourceTargetType,
        sourceTargetId,
      },
      "CLOSE_CYCLE_SOURCE_REUSE_CONFLICT"
    );
  }

  const currentLinkResult = await runQuery(
    `SELECT id, source_target_type, source_target_id
     FROM close_cycle_item_links
     WHERE close_cycle_item_id = ?
       AND is_current = TRUE
     ORDER BY id DESC
      FOR UPDATE`,
    [closeCycleItemId]
  );
  const currentLinkRows = currentLinkResult.rows || [];
  assertSingleCurrentLinkForItem(currentLinkRows, closeCycleItemId);
  const currentLinkRow = currentLinkRows[0] || null;
  const currentMatchesRequestedSource =
    currentLinkRow &&
    toUpperText(currentLinkRow.source_target_type) === sourceTargetType &&
    parsePositiveInt(currentLinkRow.source_target_id) === sourceTargetId;

  if (currentLinkRow && !currentMatchesRequestedSource) {
    await runQuery(
      `UPDATE close_cycle_item_links
       SET is_current = FALSE,
           superseded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [parsePositiveInt(currentLinkRow.id)]
    );
  }

  if (!currentMatchesRequestedSource) {
    const existingHistoricalResult = await runQuery(
      `SELECT id
       FROM close_cycle_item_links
       WHERE close_cycle_item_id = ?
         AND source_target_type = ?
         AND source_target_id = ?
       LIMIT 1
       FOR UPDATE`,
      [closeCycleItemId, sourceTargetType, sourceTargetId]
    );
    const historicalRow = existingHistoricalResult.rows?.[0] || null;
    if (historicalRow) {
      await runQuery(
        `UPDATE close_cycle_item_links
         SET is_current = TRUE,
             superseded_at = NULL
         WHERE id = ?`,
        [parsePositiveInt(historicalRow.id)]
      );
    } else {
      await runQuery(
        `INSERT INTO close_cycle_item_links (
            close_cycle_item_id,
            source_target_type,
            source_target_id,
            is_current
         )
         VALUES (?, ?, ?, TRUE)`,
        [closeCycleItemId, sourceTargetType, sourceTargetId]
      );
    }
  }

  await runQuery(
    `UPDATE close_cycle_items
     SET business_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [normalizeBusinessStatus(sourceIdentity.businessStatus), closeCycleItemId]
  );

  const refreshed = await loadCloseCycleItemRow({
    closeCycleItemId,
    runQuery,
  });
  return mapCloseCycleItemRow(refreshed || itemRow);
}

/**
 * Mirror the source lifecycle onto every current linked close-cycle item for
 * that source row. When a previously stale downstream item reaches a
 * successful recovery state, the sync path clears the active stale flag while
 * preserving the original stale history in `close_stale_events`.
 */
export async function syncCycleItemsBySource(
  sourceTargetType,
  sourceTargetId,
  actorCtx = {}
) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const sourceRow = await loadSourceRow(sourceTargetType, sourceTargetId, runQuery);
  if (!sourceRow) {
    throw notFound(`${sourceTargetType} source row not found`);
  }

  const sourceIdentity = buildSourceIdentityFromRow(sourceTargetType, sourceRow);
  const rows = await findCurrentCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx);
  const syncedRows = [];
  let resolvedStaleCount = 0;
  for (const row of rows) {
    // Only the current governing source link mirrors the live source status.
    // Superseded links stay as audit history and must not keep mutating items.
    // eslint-disable-next-line no-await-in-loop
    const updatedRow = await setItemBusinessStatus(row.id, sourceIdentity.businessStatus, {
      ...actorCtx,
      runQuery,
    });
    // A stale mark is a current-state warning, not a permanent scar. Once the
    // downstream source has been rerun, reapproved, or relocked successfully,
    // clear the active stale flag and keep the stale-event table as the audit trail.
    // eslint-disable-next-line no-await-in-loop
    const freshnessResult = await resolveRecoveredItemFreshness(
      updatedRow,
      {
        sourceTargetType,
        sourceTargetId,
      },
      {
        ...actorCtx,
        runQuery,
      }
    );
    resolvedStaleCount += freshnessResult.resolved ? 1 : 0;
    syncedRows.push(freshnessResult.row);
  }

  return {
    count: rows.length,
    businessStatus: sourceIdentity.businessStatus,
    resolvedStaleCount,
    rows: syncedRows,
  };
}

/**
 * Read all cycle items for one close cycle, including the current source link
 * when one exists.
 */
export async function listCycleItems(cycleId, filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const where = ["cc.tenant_id = ?", "cci.close_cycle_id = ?"];
  const params = [tenantId, normalizedCycleId];

  if (filters?.itemType) {
    where.push("cci.item_type = ?");
    params.push(normalizeItemType(filters.itemType));
  }
  if (filters?.scopeType) {
    where.push("cci.scope_type = ?");
    params.push(normalizeScopeType(filters.scopeType));
  }
  if (filters?.businessStatus) {
    where.push("cci.business_status = ?");
    params.push(normalizeBusinessStatus(filters.businessStatus));
  }
  if (filters?.staleStatus) {
    where.push("cci.stale_status = ?");
    params.push(normalizeStaleStatus(filters.staleStatus));
  }

  const result = await runQuery(
    `${buildItemSelect(where.join(" AND "))}
     ORDER BY
       cci.item_type ASC,
       cci.legal_entity_id ASC,
       cci.book_id ASC,
       cci.operating_unit_id ASC,
       cci.id ASC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCloseCycleItemRow),
  };
}

/**
 * Auto-link every matching active close-cycle item to a freshly created source
 * row, then mirror the live source status onto current links.
 */
export async function autoLinkAndSyncSource(
  sourceTargetType,
  sourceTargetId,
  actorCtx = {}
) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const sourceRow = await loadSourceRow(sourceTargetType, sourceTargetId, runQuery);
  if (!sourceRow) {
    throw notFound(`${sourceTargetType} source row not found`);
  }

  const sourceIdentity = buildSourceIdentityFromRow(sourceTargetType, sourceRow);
  const candidateRows = await findLinkableCycleItemsForSource(
    sourceTargetType,
    sourceIdentity,
    {
      ...actorCtx,
      tenantId: resolveActorTenantId(actorCtx) || parsePositiveInt(sourceIdentity?.tenantId),
      runQuery,
    }
  );

  for (const row of candidateRows) {
    // Fan out first-time source links across every matching active cycle so the
    // expected item family stays in sync when entity and group cycles share a source.
    // eslint-disable-next-line no-await-in-loop
    await linkCycleItemToSource(
      {
        closeCycleItemId: parsePositiveInt(row.id),
        sourceTargetType,
        sourceTargetId,
      },
      {
        ...actorCtx,
        runQuery,
      }
    );
  }

  return syncCycleItemsBySource(sourceTargetType, sourceTargetId, {
    ...actorCtx,
    tenantId: resolveActorTenantId(actorCtx) || parsePositiveInt(sourceIdentity?.tenantId),
    runQuery,
  });
}

/**
 * Read the currently provisioned `CONSOLIDATION_RUN` cycle items for one
 * group/period/run-name triple, regardless of whether they are already linked.
 */
export async function listExpectedConsolidationCycleItems(
  {
    tenantId,
    consolidationGroupId,
    fiscalPeriodId,
    runName,
  },
  actorCtx = {}
) {
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedConsolidationGroupId = parsePositiveInt(consolidationGroupId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  const normalizedRunName = toUpperText(runName);

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedConsolidationGroupId) {
    throw badRequest("consolidationGroupId is required");
  }
  if (!normalizedFiscalPeriodId) {
    throw badRequest("fiscalPeriodId is required");
  }
  if (!normalizedRunName) {
    throw badRequest("runName is required");
  }

  const result = await runQuery(
    `${buildItemSelect(
      `cc.tenant_id = ?
       AND cc.status = 'OPEN'
       AND cc.fiscal_period_id = ?
       AND cci.item_type = 'CONSOLIDATION_RUN'
       AND cci.consolidation_group_id = ?
       AND cci.run_name = ?`
    )}
     ORDER BY cci.close_cycle_id ASC, cci.id ASC`,
    [
      normalizedTenantId,
      normalizedFiscalPeriodId,
      normalizedConsolidationGroupId,
      normalizedRunName,
    ]
  );

  return {
    rows: (result.rows || []).map(mapCloseCycleItemRow),
  };
}

export default {
  ensureCycleItem,
  linkCycleItemToSource,
  findLinkableCycleItemsForSource,
  findCurrentCycleItemsBySource,
  findCurrentCycleItemBySourceInCycle,
  setItemBusinessStatus,
  setItemStaleStatus,
  syncCycleItemsBySource,
  listCycleItems,
  autoLinkAndSyncSource,
  listExpectedConsolidationCycleItems,
};
