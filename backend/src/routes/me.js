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
      `SELECT DISTINCT p.code
       FROM user_role_scopes urs
       JOIN roles r ON r.id = urs.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE urs.user_id = ?
         AND urs.tenant_id = ?
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
