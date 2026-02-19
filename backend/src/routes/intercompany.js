import express from "express";
import { query } from "../db.js";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import {
  assertAccountBelongsToTenant,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  notImplemented,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";

const router = express.Router();

router.get(
  "/entity-flags",
  requirePermission("intercompany.flag.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["tenant_id = ?"];
    const params = [tenantId];
    conditions.push(buildScopeFilter(req, "legal_entity", "id", params));

    if (legalEntityId) {
      conditions.push("id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT
         id AS legal_entity_id,
         code,
         name,
         is_intercompany_enabled,
         intercompany_partner_required,
         status
       FROM legal_entities
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.patch(
  "/entity-flags/:legalEntityId",
  requirePermission("intercompany.flag.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.params?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.params.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const isIntercompanyEnabled =
      req.body?.isIntercompanyEnabled === undefined
        ? null
        : Boolean(req.body.isIntercompanyEnabled);
    const intercompanyPartnerRequired =
      req.body?.intercompanyPartnerRequired === undefined
        ? null
        : Boolean(req.body.intercompanyPartnerRequired);

    if (isIntercompanyEnabled === null && intercompanyPartnerRequired === null) {
      throw badRequest(
        "Provide isIntercompanyEnabled and/or intercompanyPartnerRequired"
      );
    }

    await query(
      `UPDATE legal_entities
       SET
         is_intercompany_enabled = COALESCE(?, is_intercompany_enabled),
         intercompany_partner_required = COALESCE(?, intercompany_partner_required)
       WHERE tenant_id = ?
         AND id = ?`,
      [isIntercompanyEnabled, intercompanyPartnerRequired, tenantId, legalEntityId]
    );

    const result = await query(
      `SELECT
         id AS legal_entity_id,
         code,
         name,
         is_intercompany_enabled,
         intercompany_partner_required
       FROM legal_entities
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, legalEntityId]
    );

    return res.json({
      ok: true,
      row: result.rows[0] || null,
    });
  })
);

router.post(
  "/pairs",
  requirePermission("intercompany.pair.upsert", {
    resolveScope: (req, tenantId) => {
      const fromLegalEntityId = parsePositiveInt(req.body?.fromLegalEntityId);
      if (fromLegalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: fromLegalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["fromLegalEntityId", "toLegalEntityId"]);
    const fromLegalEntityId = parsePositiveInt(req.body.fromLegalEntityId);
    const toLegalEntityId = parsePositiveInt(req.body.toLegalEntityId);

    if (!fromLegalEntityId || !toLegalEntityId) {
      throw badRequest("fromLegalEntityId and toLegalEntityId must be positive integers");
    }

    await assertLegalEntityBelongsToTenant(tenantId, fromLegalEntityId, "fromLegalEntityId");
    await assertLegalEntityBelongsToTenant(tenantId, toLegalEntityId, "toLegalEntityId");

    assertScopeAccess(req, "legal_entity", fromLegalEntityId, "fromLegalEntityId");
    assertScopeAccess(req, "legal_entity", toLegalEntityId, "toLegalEntityId");

    const receivableAccountId = req.body.receivableAccountId
      ? parsePositiveInt(req.body.receivableAccountId)
      : null;
    const payableAccountId = req.body.payableAccountId
      ? parsePositiveInt(req.body.payableAccountId)
      : null;

    if (receivableAccountId) {
      await assertAccountBelongsToTenant(tenantId, receivableAccountId, "receivableAccountId");
    }
    if (payableAccountId) {
      await assertAccountBelongsToTenant(tenantId, payableAccountId, "payableAccountId");
    }

    const status = String(req.body.status || "ACTIVE").toUpperCase();

    const result = await query(
      `INSERT INTO intercompany_pairs (
          tenant_id, from_legal_entity_id, to_legal_entity_id,
          receivable_account_id, payable_account_id, status
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         receivable_account_id = VALUES(receivable_account_id),
         payable_account_id = VALUES(payable_account_id),
         status = VALUES(status)`,
      [
        tenantId,
        fromLegalEntityId,
        toLegalEntityId,
        receivableAccountId,
        payableAccountId,
        status,
      ]
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || null,
      tenantId,
    });
  })
);

router.post(
  "/reconcile",
  requirePermission("intercompany.reconcile.run"),
  asyncHandler(async (req, res) => {
    return notImplemented(res, "Intercompany reconciliation");
  })
);

export default router;
