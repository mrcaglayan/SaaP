function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export const FEATURE_CASH_FX_EXF05_PILOT_V1 = normalizeFeatureCode(
  "feature_cash_fx_exf05_pilot_v1"
);
export const FEATURE_CASH_FX_EXF05_GA_V1 = normalizeFeatureCode(
  "feature_cash_fx_exf05_ga_v1"
);

export const KNOWN_TENANT_FEATURE_CODES = Object.freeze([
  normalizeFeatureCode("feature_subaccounts_v1"),
  normalizeFeatureCode("feature_setup_wizard_v2"),
  normalizeFeatureCode("feature_consolidation_canonical_mapping_v1"),
  normalizeFeatureCode("feature_workflow_close_consolidation_v1"),
  normalizeFeatureCode("feature_tax_engine_v1"),
  FEATURE_CASH_FX_EXF05_PILOT_V1,
  FEATURE_CASH_FX_EXF05_GA_V1,
]);

export { normalizeFeatureCode };
