function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export const KNOWN_TENANT_FEATURE_CODES = Object.freeze([
  normalizeFeatureCode("feature_subaccounts_v1"),
  normalizeFeatureCode("feature_setup_wizard_v2"),
  normalizeFeatureCode("feature_consolidation_canonical_mapping_v1"),
  normalizeFeatureCode("feature_workflow_close_consolidation_v1"),
  normalizeFeatureCode("feature_tax_engine_v1"),
]);

export { normalizeFeatureCode };
