import { closePool, query } from "../src/db.js";

const REQUIRED_MIGRATION_KEYS = Object.freeze([
  "m118_inventory_foundation",
  "m123_inventory_warehouse_ownership_scope",
  "m124_inventory_transfer_foundation",
  "m126_item_cards_inventory_transit_account",
  "m127_inventory_transfer_source_type_backfill",
  "m129_inventory_transfer_source_type_enum_repair",
]);

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

function collectEnumValues(columnType) {
  return Array.from(String(columnType || "").matchAll(/'([^']+)'/g)).map((match) => match[1]);
}

async function tableExists(tableName) {
  const result = await query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return Number(result.rows?.[0]?.table_count || 0) > 0;
}

async function loadColumn(tableName, columnName) {
  const result = await query(
    `SELECT
        column_name AS column_name,
        column_type AS column_type,
        is_nullable AS is_nullable,
        column_default AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return result.rows?.[0] || null;
}

async function indexExists(tableName, indexName) {
  const result = await query(
    `SELECT COUNT(*) AS index_count
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [tableName, indexName]
  );
  return Number(result.rows?.[0]?.index_count || 0) > 0;
}

async function foreignKeyExists(tableName, constraintName) {
  const result = await query(
    `SELECT COUNT(*) AS constraint_count
       FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND constraint_name = ?
        AND constraint_type = 'FOREIGN KEY'`,
    [tableName, constraintName]
  );
  return Number(result.rows?.[0]?.constraint_count || 0) > 0;
}

async function loadAppliedMigrationKeys() {
  const hasSchemaMigrations = await tableExists("schema_migrations");
  if (!hasSchemaMigrations) {
    return {
      schemaMigrationsExists: false,
      appliedKeys: [],
    };
  }

  const placeholders = REQUIRED_MIGRATION_KEYS.map(() => "?").join(", ");
  const result = await query(
    `SELECT migration_key
       FROM schema_migrations
      WHERE migration_key IN (${placeholders})
      ORDER BY migration_key`,
    REQUIRED_MIGRATION_KEYS
  );
  const appliedKeys = Array.isArray(result.rows)
    ? result.rows.map((row) => String(row.migration_key || "").trim()).filter(Boolean)
    : [];
  return {
    schemaMigrationsExists: true,
    appliedKeys,
  };
}

function createCheck(id, label, ok, details, remediation) {
  return {
    id,
    label,
    ok: Boolean(ok),
    details: String(details || ""),
    remediation: remediation ? String(remediation) : null,
  };
}

function summarize(checks) {
  return {
    ok: checks.every((check) => check.ok),
    issueCount: checks.filter((check) => !check.ok).length,
    checks,
  };
}

function printHuman(summary, databaseName) {
  console.log(`Inventory transfer schema audit for database ${databaseName}`);
  for (const check of summary.checks) {
    const status = check.ok ? "OK" : "FAIL";
    console.log(`[${status}] ${check.id} ${check.label}`);
    console.log(`  ${check.details}`);
    if (!check.ok && check.remediation) {
      console.log(`  Fix: ${check.remediation}`);
    }
  }

  if (summary.ok) {
    console.log("Inventory transfer schema audit passed.");
    return;
  }

  console.error(
    `Inventory transfer schema audit failed with ${summary.issueCount} issue(s).`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseResult = await query("SELECT DATABASE() AS database_name");
  const databaseName = String(databaseResult.rows?.[0]?.database_name || "").trim() || "(unknown)";

  const [
    inventoryMovementsTableExists,
    inventoryTransfersTableExists,
    inventoryTransferLinesTableExists,
    inventoryWarehousesTableExists,
    itemCardsTableExists,
    movementSourceTypeColumn,
    warehouseOwnershipScopeColumn,
    warehouseOperatingUnitColumn,
    transitAccountColumn,
    transitAccountIndexExists,
    transitAccountForeignKeyExists,
    warehouseOperatingUnitForeignKeyExists,
    migrationInfo,
  ] = await Promise.all([
    tableExists("inventory_movements"),
    tableExists("inventory_transfers"),
    tableExists("inventory_transfer_lines"),
    tableExists("inventory_warehouses"),
    tableExists("item_cards"),
    loadColumn("inventory_movements", "source_type"),
    loadColumn("inventory_warehouses", "ownership_scope"),
    loadColumn("inventory_warehouses", "operating_unit_id"),
    loadColumn("item_cards", "inventory_transit_account_id"),
    indexExists("item_cards", "ix_item_cards_tenant_inventory_transit_account"),
    foreignKeyExists("item_cards", "fk_item_cards_inventory_transit_account"),
    foreignKeyExists("inventory_warehouses", "fk_inventory_warehouses_operating_unit"),
    loadAppliedMigrationKeys(),
  ]);

  const sourceTypeEnumValues = collectEnumValues(movementSourceTypeColumn?.column_type);
  const warehouseOwnershipEnumValues = collectEnumValues(warehouseOwnershipScopeColumn?.column_type);

  const checks = [
    createCheck(
      "MIGRATIONS",
      "required migration keys are recorded",
      migrationInfo.schemaMigrationsExists &&
        REQUIRED_MIGRATION_KEYS.every((key) => migrationInfo.appliedKeys.includes(key)),
      migrationInfo.schemaMigrationsExists
        ? `Applied keys: ${migrationInfo.appliedKeys.length ? migrationInfo.appliedKeys.join(", ") : "none"}`
        : "schema_migrations table is missing.",
      "Run `npm run db:migrate`. If keys are already recorded but schema is still missing, rebuild the test database with `npm run db:reset`."
    ),
    createCheck(
      "INV_MOVEMENTS",
      "inventory_movements table exists",
      inventoryMovementsTableExists,
      `inventory_movements table exists=${inventoryMovementsTableExists}`,
      "Run `npm run db:migrate` to create inventory foundation tables."
    ),
    createCheck(
      "INV_SOURCE_TYPE",
      "inventory_movements.source_type includes INVENTORY_TRANSFER",
      inventoryMovementsTableExists && sourceTypeEnumValues.includes("INVENTORY_TRANSFER"),
      movementSourceTypeColumn
        ? `column_type=${movementSourceTypeColumn.column_type}`
        : "inventory_movements.source_type column metadata is missing.",
      "Run `npm run db:migrate`. If m124/m127 are already recorded, the schema is drifted and the database should be rebuilt."
    ),
    createCheck(
      "TRANSFER_TABLES",
      "inventory transfer header and line tables exist",
      inventoryTransfersTableExists && inventoryTransferLinesTableExists,
      `inventory_transfers=${inventoryTransfersTableExists}, inventory_transfer_lines=${inventoryTransferLinesTableExists}`,
      "Run `npm run db:migrate` to create transfer tables from m124."
    ),
    createCheck(
      "WAREHOUSE_SCOPE",
      "inventory_warehouses ownership scope columns exist with OU support",
      inventoryWarehousesTableExists &&
        warehouseOwnershipEnumValues.includes("CENTRAL") &&
        warehouseOwnershipEnumValues.includes("OPERATING_UNIT") &&
        Boolean(warehouseOperatingUnitColumn) &&
        warehouseOperatingUnitForeignKeyExists,
      warehouseOwnershipScopeColumn
        ? `ownership_scope=${warehouseOwnershipScopeColumn.column_type}; operating_unit_id column present=${Boolean(warehouseOperatingUnitColumn)}; fk_inventory_warehouses_operating_unit=${warehouseOperatingUnitForeignKeyExists}`
        : "inventory_warehouses ownership columns are missing.",
      "Run `npm run db:migrate` to apply m123 inventory warehouse ownership scope changes."
    ),
    createCheck(
      "ITEM_TRANSIT",
      "item_cards transit account mapping exists",
      itemCardsTableExists &&
        Boolean(transitAccountColumn) &&
        transitAccountIndexExists &&
        transitAccountForeignKeyExists,
      transitAccountColumn
        ? `inventory_transit_account_id present=true; ix_item_cards_tenant_inventory_transit_account=${transitAccountIndexExists}; fk_item_cards_inventory_transit_account=${transitAccountForeignKeyExists}`
        : "item_cards.inventory_transit_account_id column is missing.",
      "Run `npm run db:migrate` to apply m126 item transit account changes."
    ),
  ];

  const summary = summarize(checks);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          databaseName,
          ...summary,
        },
        null,
        2
      )
    );
  } else {
    printHuman(summary, databaseName);
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
