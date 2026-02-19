import express from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

async function loadPermissionCodes(userId, tenantId) {
  if (!userId || !tenantId) {
    return [];
  }

  try {
    const permissionResult = await query(
      `SELECT
         p.code,
         SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END) AS allow_count,
         SUM(
           CASE
             WHEN urs.effect = 'DENY' AND urs.scope_type = 'TENANT' THEN 1
             ELSE 0
           END
         ) AS tenant_deny_count
       FROM user_role_scopes urs
       JOIN roles r ON r.id = urs.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE urs.user_id = ?
         AND urs.tenant_id = ?
       GROUP BY p.code
       HAVING allow_count > 0
          AND tenant_deny_count = 0
       ORDER BY p.code`,
      [userId, tenantId]
    );

    return permissionResult.rows.map((row) => row.code);
  } catch (err) {
    // Keep /me backward-compatible if RBAC tables are not migrated yet.
    if (err?.errno === 1146) {
      return [];
    }
    throw err;
  }
}

// GET /me
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const { rows } = await query(
      "SELECT id, tenant_id, email, name, status, created_at FROM users WHERE id = ?",
      [userId]
    );

    const user = rows[0];
    if (!user) return res.status(404).json({ message: "User not found" });

    const permissionCodes = await loadPermissionCodes(userId, user.tenant_id);

    return res.json({
      ...user,
      permissionCodes,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
