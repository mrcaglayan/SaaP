import { closePool, query, withTransaction } from "../src/db.js";

const WORKFLOW_PACKAGE_ROLE_PREFIX = "WORKFLOW_PACKAGE__";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function main() {
  const roleRowsResult = await query(
    `SELECT id, tenant_id, code
       FROM roles
      WHERE code LIKE ?
      ORDER BY tenant_id ASC, id ASC`,
    [`${WORKFLOW_PACKAGE_ROLE_PREFIX}%`],
  );
  const roleRows = Array.isArray(roleRowsResult.rows) ? roleRowsResult.rows : [];
  const roleIds = roleRows.map((row) => toPositiveInt(row.id)).filter(Boolean);

  if (roleIds.length === 0) {
    console.log("cleanup-delete-workflow-package-managed-roles: no managed roles found");
    await closePool();
    return;
  }

  const placeholders = roleIds.map(() => "?").join(", ");
  const summary = await withTransaction(async (tx) => {
    const [{ rolePermissionCount = 0 } = {}] = (
      await tx.query(
        `SELECT COUNT(*) AS rolePermissionCount
           FROM role_permissions
          WHERE role_id IN (${placeholders})`,
        roleIds,
      )
    ).rows;
    const [{ assignmentCount = 0 } = {}] = (
      await tx.query(
        `SELECT COUNT(*) AS assignmentCount
           FROM user_role_scopes
          WHERE role_id IN (${placeholders})`,
        roleIds,
      )
    ).rows;

    await tx.query(
      `DELETE FROM role_permissions
        WHERE role_id IN (${placeholders})`,
      roleIds,
    );
    await tx.query(
      `DELETE FROM user_role_scopes
        WHERE role_id IN (${placeholders})`,
      roleIds,
    );
    await tx.query(
      `DELETE FROM roles
        WHERE id IN (${placeholders})`,
      roleIds,
    );

    return {
      roleCount: roleIds.length,
      rolePermissionCount: Number(rolePermissionCount || 0),
      assignmentCount: Number(assignmentCount || 0),
    };
  });

  console.log(
    JSON.stringify(
      {
        script: "cleanup-delete-workflow-package-managed-roles",
        prefix: WORKFLOW_PACKAGE_ROLE_PREFIX,
        deletedRoleCodes: roleRows.map((row) => String(row.code || "")).filter(Boolean),
        ...summary,
      },
      null,
      2,
    ),
  );
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await closePool();
  } catch {
    // Ignore pool shutdown failures after the original error.
  }
  process.exit(1);
});
