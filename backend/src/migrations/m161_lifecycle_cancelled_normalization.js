import {
  CASH_TRANSIT_TRANSFER_STATUS_VALUES,
  INVENTORY_TRANSFER_STATUS_VALUES,
  LIFECYCLE_STATUS_CANCELLED,
  STOCK_LANDED_COST_VOUCHER_STATUS_VALUES,
} from "../constants/lifecycle.js";

/**
 * m161 - Lifecycle CANCELLED normalization.
 *
 * Replaces legacy CANCELED enum values with canonical CANCELLED in pre-live
 * lifecycle tables so fresh migrations and existing dev databases converge on
 * the same status vocabulary.
 */

const LEGACY_CANCELED = "CANCELED";

const STATUS_COLUMNS = Object.freeze([
  {
    tableName: "cash_transit_transfers",
    columnName: "status",
    finalValues: CASH_TRANSIT_TRANSFER_STATUS_VALUES,
    defaultValue: "INITIATED",
  },
  {
    tableName: "inventory_transfers",
    columnName: "status",
    finalValues: INVENTORY_TRANSFER_STATUS_VALUES,
    defaultValue: "INITIATED",
  },
  {
    tableName: "stock_landed_cost_vouchers",
    columnName: "status",
    finalValues: STOCK_LANDED_COST_VOUCHER_STATUS_VALUES,
    defaultValue: "DRAFT",
  },
]);

async function readColumnType(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return String(rows?.[0]?.column_type || "");
}

function extractEnumValues(columnType) {
  return Array.from(String(columnType || "").matchAll(/'([^']+)'/g)).map((match) => match[1]);
}

function buildEnumSql(values) {
  return values.map((value) => `'${value}'`).join(",");
}

async function ensureCancelledVocabulary(connection, definition) {
  const { tableName, columnName, finalValues, defaultValue } = definition;
  const columnType = await readColumnType(connection, tableName, columnName);
  if (!columnType) {
    return;
  }

  const currentValues = extractEnumValues(columnType);
  if (currentValues.length === 0) {
    return;
  }

  const hasLegacy = currentValues.includes(LEGACY_CANCELED);
  const hasCanonical = currentValues.includes(LIFECYCLE_STATUS_CANCELLED);
  const needsFinalEnum =
    hasLegacy ||
    currentValues.length !== finalValues.length ||
    currentValues.some((value, index) => value !== finalValues[index]);

  if (!needsFinalEnum) {
    return;
  }

  if (hasLegacy && !hasCanonical) {
    const transitionalValues = [];
    for (const value of finalValues) {
      if (value === LIFECYCLE_STATUS_CANCELLED) {
        transitionalValues.push(LEGACY_CANCELED, LIFECYCLE_STATUS_CANCELLED);
      } else {
        transitionalValues.push(value);
      }
    }

    await connection.execute(
      `ALTER TABLE ${tableName}
         MODIFY COLUMN ${columnName} ENUM(${buildEnumSql(transitionalValues)}) NOT NULL DEFAULT '${defaultValue}'`
    );
  }

  await connection.execute(
    `UPDATE ${tableName}
        SET ${columnName} = ?
      WHERE ${columnName} = ?`,
    [LIFECYCLE_STATUS_CANCELLED, LEGACY_CANCELED]
  );

  await connection.execute(
    `ALTER TABLE ${tableName}
       MODIFY COLUMN ${columnName} ENUM(${buildEnumSql(finalValues)}) NOT NULL DEFAULT '${defaultValue}'`
  );
}

const migration161LifecycleCancelledNormalization = {
  key: "m161_lifecycle_cancelled_normalization",
  description: "Normalize lifecycle status vocabulary to canonical CANCELLED.",
  async up(connection) {
    for (const definition of STATUS_COLUMNS) {
      // Pre-live normalization: update stale dev/demo rows before removing the legacy enum value.
      await ensureCancelledVocabulary(connection, definition);
    }
  },
};

export default migration161LifecycleCancelledNormalization;
