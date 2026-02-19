import { query } from "./db.js";
import { runMigrations } from "./migrationRunner.js";

const BASE_CURRENCIES = [
  ["USD", "US Dollar", 2],
  ["EUR", "Euro", 2],
  ["TRY", "Turkish Lira", 2],
  ["GBP", "Pound Sterling", 2],
  ["JPY", "Japanese Yen", 0],
  ["INR", "Indian Rupee", 2],
  ["CAD", "Canadian Dollar", 2],
  ["AUD", "Australian Dollar", 2],
  ["CHF", "Swiss Franc", 2],
  ["AED", "UAE Dirham", 2],
  ["SAR", "Saudi Riyal", 2],
  ["BRL", "Brazilian Real", 2],
  ["MXN", "Mexican Peso", 2],
  ["ZAR", "South African Rand", 2],
  ["SGD", "Singapore Dollar", 2],
];

const BASE_COUNTRIES = [
  ["US", "USA", "United States", "USD"],
  ["TR", "TUR", "Turkey", "TRY"],
  ["GB", "GBR", "United Kingdom", "GBP"],
  ["DE", "DEU", "Germany", "EUR"],
  ["FR", "FRA", "France", "EUR"],
  ["IT", "ITA", "Italy", "EUR"],
  ["ES", "ESP", "Spain", "EUR"],
  ["NL", "NLD", "Netherlands", "EUR"],
  ["CH", "CHE", "Switzerland", "CHF"],
  ["CA", "CAN", "Canada", "CAD"],
  ["AU", "AUS", "Australia", "AUD"],
  ["JP", "JPN", "Japan", "JPY"],
  ["IN", "IND", "India", "INR"],
  ["AE", "ARE", "United Arab Emirates", "AED"],
  ["SA", "SAU", "Saudi Arabia", "SAR"],
  ["BR", "BRA", "Brazil", "BRL"],
  ["MX", "MEX", "Mexico", "MXN"],
  ["ZA", "ZAF", "South Africa", "ZAR"],
  ["SG", "SGP", "Singapore", "SGD"],
];

const PERMISSIONS = [
  ["org.tree.read", "Read org hierarchy tree"],
  ["org.fiscal_calendar.read", "Read fiscal calendars"],
  ["org.fiscal_period.read", "Read fiscal periods"],
  ["org.group_company.upsert", "Create/update group companies"],
  ["org.legal_entity.upsert", "Create/update legal entities"],
  ["org.operating_unit.upsert", "Create/update operating units/branches"],
  ["org.fiscal_calendar.upsert", "Create/update fiscal calendars"],
  ["org.fiscal_period.generate", "Generate fiscal periods"],
  ["security.permission.read", "Read permission catalog"],
  ["security.role.read", "Read security roles"],
  ["security.role.upsert", "Create/update security roles"],
  ["security.role_permissions.assign", "Assign permissions to roles"],
  ["security.role_assignment.read", "Read role assignments"],
  ["security.role_assignment.upsert", "Assign roles to users and scopes"],
  ["security.data_scope.read", "Read user data scopes"],
  ["security.data_scope.upsert", "Create/update/delete user data scopes"],
  ["security.audit.read", "Read RBAC audit logs"],
  ["gl.book.read", "Read books"],
  ["gl.book.upsert", "Create/update books"],
  ["gl.coa.read", "Read chart of accounts"],
  ["gl.coa.upsert", "Create/update chart of accounts"],
  ["gl.account.read", "Read accounts"],
  ["gl.account.upsert", "Create/update accounts"],
  ["gl.account_mapping.upsert", "Create/update account mappings"],
  ["gl.journal.read", "Read journals"],
  ["gl.journal.create", "Create journals"],
  ["gl.journal.post", "Post journals"],
  ["gl.journal.reverse", "Reverse posted journals"],
  ["gl.trial_balance.read", "Read trial balance"],
  ["gl.period.close", "Close accounting periods"],
  ["fx.rate.bulk_upsert", "Bulk upsert FX rates"],
  ["fx.rate.read", "Read FX rates"],
  ["intercompany.flag.read", "Read legal entity intercompany flags"],
  ["intercompany.flag.upsert", "Create/update legal entity intercompany flags"],
  ["intercompany.pair.upsert", "Create/update intercompany pairs"],
  ["intercompany.reconcile.run", "Run intercompany reconciliation"],
  ["consolidation.group.read", "Read consolidation groups"],
  ["consolidation.group.upsert", "Create/update consolidation groups"],
  ["consolidation.group_member.upsert", "Create/update consolidation members"],
  ["consolidation.coa_mapping.read", "Read group CoA mappings"],
  ["consolidation.coa_mapping.upsert", "Create/update group CoA mappings"],
  ["consolidation.elimination_placeholder.read", "Read elimination placeholders"],
  ["consolidation.elimination_placeholder.upsert", "Create/update elimination placeholders"],
  ["consolidation.run.read", "Read consolidation runs"],
  ["consolidation.run.create", "Create consolidation runs"],
  ["consolidation.run.execute", "Execute consolidation runs"],
  ["consolidation.elimination.create", "Create elimination entries"],
  ["consolidation.adjustment.create", "Create consolidation adjustments"],
  ["consolidation.run.finalize", "Finalize consolidation runs"],
  ["consolidation.report.trial_balance.read", "Read consolidation trial balance"],
  ["consolidation.report.summary.read", "Read consolidation summary report"],
  ["consolidation.report.balance_sheet.read", "Read consolidation balance sheet"],
  ["consolidation.report.income_statement.read", "Read consolidation income statement"],
  ["onboarding.company.setup", "Run company onboarding bootstrap flow"],
];

const ROLE_DEFINITIONS = [
  {
    code: "TenantAdmin",
    name: "Tenant Administrator",
    permissions: PERMISSIONS.map(([code]) => code),
  },
  {
    code: "GroupController",
    name: "Group Controller",
    permissions: [
      "org.tree.read",
      "org.fiscal_calendar.read",
      "org.fiscal_period.read",
      "org.group_company.upsert",
      "org.legal_entity.upsert",
      "org.operating_unit.upsert",
      "org.fiscal_calendar.upsert",
      "org.fiscal_period.generate",
      "gl.book.read",
      "gl.coa.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "intercompany.flag.read",
      "intercompany.flag.upsert",
      "fx.rate.read",
      "intercompany.pair.upsert",
      "intercompany.reconcile.run",
      "consolidation.group.read",
      "consolidation.group.upsert",
      "consolidation.group_member.upsert",
      "consolidation.coa_mapping.read",
      "consolidation.coa_mapping.upsert",
      "consolidation.elimination_placeholder.read",
      "consolidation.elimination_placeholder.upsert",
      "consolidation.run.read",
      "consolidation.run.create",
      "consolidation.run.execute",
      "consolidation.elimination.create",
      "consolidation.adjustment.create",
      "consolidation.run.finalize",
      "consolidation.report.trial_balance.read",
      "consolidation.report.summary.read",
      "consolidation.report.balance_sheet.read",
      "consolidation.report.income_statement.read",
    ],
  },
  {
    code: "CountryController",
    name: "Country Controller",
    permissions: [
      "org.tree.read",
      "org.fiscal_calendar.read",
      "org.fiscal_period.read",
      "org.legal_entity.upsert",
      "org.operating_unit.upsert",
      "gl.book.read",
      "gl.book.upsert",
      "gl.coa.read",
      "gl.coa.upsert",
      "gl.account.read",
      "gl.account.upsert",
      "gl.account_mapping.upsert",
      "gl.journal.read",
      "gl.journal.create",
      "gl.journal.post",
      "gl.journal.reverse",
      "gl.trial_balance.read",
      "gl.period.close",
      "intercompany.flag.read",
      "intercompany.flag.upsert",
      "fx.rate.read",
    ],
  },
  {
    code: "EntityAccountant",
    name: "Entity Accountant",
    permissions: [
      "org.tree.read",
      "org.fiscal_calendar.read",
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.book.upsert",
      "gl.coa.read",
      "gl.coa.upsert",
      "gl.account.read",
      "gl.account.upsert",
      "gl.account_mapping.upsert",
      "gl.journal.read",
      "gl.journal.create",
      "gl.journal.post",
      "gl.journal.reverse",
      "gl.trial_balance.read",
      "gl.period.close",
      "intercompany.flag.read",
      "intercompany.flag.upsert",
      "fx.rate.read",
      "intercompany.pair.upsert",
      "intercompany.reconcile.run",
    ],
  },
  {
    code: "BranchOperator",
    name: "Branch Operator",
    permissions: [
      "org.tree.read",
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.coa.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.journal.create",
      "gl.journal.post",
      "gl.trial_balance.read",
    ],
  },
  {
    code: "AuditorReadOnly",
    name: "Auditor (Read Only)",
    permissions: [
      "org.tree.read",
      "org.fiscal_calendar.read",
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.coa.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "fx.rate.read",
      "consolidation.run.read",
      "consolidation.report.trial_balance.read",
      "consolidation.report.summary.read",
      "consolidation.report.balance_sheet.read",
      "consolidation.report.income_statement.read",
    ],
  },
];

async function upsertCurrencies() {
  for (const [code, name, minorUnits] of BASE_CURRENCIES) {
    await query(
      `INSERT INTO currencies (code, name, minor_units)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         minor_units = VALUES(minor_units)`,
      [code, name, minorUnits]
    );
  }
}

async function upsertCountries() {
  for (const [iso2, iso3, name, defaultCurrencyCode] of BASE_COUNTRIES) {
    await query(
      `INSERT INTO countries (iso2, iso3, name, default_currency_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         iso3 = VALUES(iso3),
         name = VALUES(name),
         default_currency_code = VALUES(default_currency_code)`,
      [iso2, iso3, name, defaultCurrencyCode]
    );
  }
}

async function upsertPermissions() {
  for (const [code, description] of PERMISSIONS) {
    await query(
      `INSERT INTO permissions (code, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         description = VALUES(description)`,
      [code, description]
    );
  }
}

async function ensureDefaultTenant(defaultTenantCode, defaultTenantName) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [defaultTenantCode, defaultTenantName]
  );
}

async function getTenantIds() {
  const tenantRows = await query("SELECT id, code FROM tenants ORDER BY id");
  return tenantRows.rows;
}

async function getPermissionIdMap() {
  const { rows } = await query("SELECT id, code FROM permissions");
  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function getRoleIdsByTenant(tenantId) {
  const { rows } = await query(
    "SELECT id, code FROM roles WHERE tenant_id = ?",
    [tenantId]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function upsertRolesForTenant(tenantId) {
  for (const role of ROLE_DEFINITIONS) {
    await query(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system)`,
      [tenantId, role.code, role.name]
    );
  }
}

async function assignRolePermissionsForTenant(tenantId, permissionIdByCode) {
  const roleIdsByCode = await getRoleIdsByTenant(tenantId);

  for (const role of ROLE_DEFINITIONS) {
    const roleId = roleIdsByCode.get(role.code);
    if (!roleId) {
      throw new Error(`Role not found after upsert: ${role.code}`);
    }

    for (const permissionCode of role.permissions) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(`Permission not found for role binding: ${permissionCode}`);
      }

      await query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         VALUES (?, ?)`,
        [roleId, permissionId]
      );
    }
  }
}

export async function seedCore(options = {}) {
  const {
    defaultTenantCode = "DEFAULT",
    defaultTenantName = "Default Tenant",
    ensureDefaultTenantIfMissing = true,
  } = options;

  await runMigrations();
  await upsertCurrencies();
  await upsertCountries();
  await upsertPermissions();

  if (ensureDefaultTenantIfMissing) {
    await ensureDefaultTenant(defaultTenantCode, defaultTenantName);
  }

  const tenants = await getTenantIds();
  for (const tenant of tenants) {
    await upsertRolesForTenant(tenant.id);
  }

  const permissionIdByCode = await getPermissionIdMap();
  for (const tenant of tenants) {
    await assignRolePermissionsForTenant(tenant.id, permissionIdByCode);
  }

  return {
    tenantCount: tenants.length,
    currencyCount: BASE_CURRENCIES.length,
    countryCount: BASE_COUNTRIES.length,
    permissionCount: PERMISSIONS.length,
    roleCountPerTenant: ROLE_DEFINITIONS.length,
  };
}
