import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  parseTaxAccountMappingCreateInput,
  parseTaxAccountMappingUpdateInput,
  parseTaxAccountMappingsListInput,
  parseTaxCodeCreateInput,
  parseTaxCodeUpdateInput,
  parseTaxCodesListInput,
  parseTaxPreviewInput,
  parseTaxRegimeCreateInput,
  parseTaxRegimeUpdateInput,
  parseTaxRegimesListInput,
  parseTaxRuleCreateInput,
  parseTaxRuleUpdateInput,
  parseTaxRulesListInput,
} from "./tax.validators.js";
import {
  createTaxAccountMapping,
  createTaxCode,
  createTaxRegime,
  createTaxRule,
  listTaxAccountMappings,
  listTaxCodes,
  listTaxRegimes,
  listTaxRules,
  previewTaxComputation,
  resolveTaxAccountMappingScope,
  resolveTaxCodeScope,
  resolveTaxRegimeScope,
  resolveTaxRuleScope,
  updateTaxAccountMapping,
  updateTaxCode,
  updateTaxRegime,
  updateTaxRule,
} from "../services/tax.setup.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromInput(raw) {
  const legalEntityId = parsePositiveInt(raw?.legalEntityId ?? raw?.legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}

async function resolveRegimeScopeFromInput(raw, tenantId) {
  const regimeId = parsePositiveInt(raw?.regimeId ?? raw?.regime_id);
  if (!regimeId) {
    return null;
  }
  return resolveTaxRegimeScope(regimeId, tenantId);
}

async function resolveCodeScopeFromInput(raw, tenantId) {
  const codeId = parsePositiveInt(raw?.taxCodeId ?? raw?.tax_code_id);
  if (!codeId) {
    return null;
  }
  return resolveTaxCodeScope(codeId, tenantId);
}

router.get(
  "/regimes",
  requirePermission("org.tree.read", {
    resolveScope: (req) => resolveLegalEntityScopeFromInput(req.query),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseTaxRegimesListInput(req);
    const result = await listTaxRegimes({
      req,
      tenantId: filters.tenantId,
      filters,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, ...result });
  })
);

router.post(
  "/regimes",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req) => resolveLegalEntityScopeFromInput(req.body),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxRegimeCreateInput(req);
    const row = await createTaxRegime({ req, input, assertScopeAccess });
    return res.status(201).json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.patch(
  "/regimes/:regimeId",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) => resolveTaxRegimeScope(req.params?.regimeId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxRegimeUpdateInput(req);
    const row = await updateTaxRegime({ req, input, assertScopeAccess });
    return res.json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.get(
  "/codes",
  requirePermission("org.tree.read", {
    resolveScope: async (req, tenantId) => resolveRegimeScopeFromInput(req.query, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseTaxCodesListInput(req);
    const result = await listTaxCodes({
      req,
      tenantId: filters.tenantId,
      filters,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, ...result });
  })
);

router.post(
  "/codes",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) => resolveRegimeScopeFromInput(req.body, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxCodeCreateInput(req);
    const row = await createTaxCode({ req, input, assertScopeAccess });
    return res.status(201).json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.patch(
  "/codes/:codeId",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) => resolveTaxCodeScope(req.params?.codeId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxCodeUpdateInput(req);
    const row = await updateTaxCode({ req, input, assertScopeAccess });
    return res.json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.get(
  "/rules",
  requirePermission("org.tree.read", {
    resolveScope: async (req, tenantId) => {
      return (
        (await resolveRegimeScopeFromInput(req.query, tenantId)) ||
        (await resolveCodeScopeFromInput(req.query, tenantId))
      );
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseTaxRulesListInput(req);
    const result = await listTaxRules({
      req,
      tenantId: filters.tenantId,
      filters,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, ...result });
  })
);

router.post(
  "/rules",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) => resolveRegimeScopeFromInput(req.body, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxRuleCreateInput(req);
    const row = await createTaxRule({ req, input, assertScopeAccess });
    return res.status(201).json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.patch(
  "/rules/:ruleId",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) => resolveTaxRuleScope(req.params?.ruleId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxRuleUpdateInput(req);
    const row = await updateTaxRule({ req, input, assertScopeAccess });
    return res.json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.get(
  "/account-mappings",
  requirePermission("org.tree.read", {
    resolveScope: async (req, tenantId) =>
      resolveLegalEntityScopeFromInput(req.query) ||
      (await resolveRegimeScopeFromInput(req.query, tenantId)) ||
      (await resolveCodeScopeFromInput(req.query, tenantId)),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseTaxAccountMappingsListInput(req);
    const result = await listTaxAccountMappings({
      req,
      tenantId: filters.tenantId,
      filters,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, ...result });
  })
);

router.post(
  "/account-mappings",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req) => resolveLegalEntityScopeFromInput(req.body),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxAccountMappingCreateInput(req);
    const row = await createTaxAccountMapping({ req, input, assertScopeAccess });
    return res.status(201).json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.patch(
  "/account-mappings/:mappingId",
  requirePermission("tax.setup.upsert", {
    resolveScope: (req, tenantId) =>
      resolveTaxAccountMappingScope(req.params?.mappingId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxAccountMappingUpdateInput(req);
    const row = await updateTaxAccountMapping({ req, input, assertScopeAccess });
    return res.json({ ok: true, tenantId: input.tenantId, row });
  })
);

router.post(
  "/preview",
  requirePermission("org.tree.read", {
    resolveScope: (req) => resolveLegalEntityScopeFromInput(req.body),
  }),
  asyncHandler(async (req, res) => {
    const input = parseTaxPreviewInput(req);
    const preview = await previewTaxComputation({ req, input, assertScopeAccess });
    return res.json({
      ok: true,
      tenantId: input.tenantId,
      ...preview,
    });
  })
);

export default router;
