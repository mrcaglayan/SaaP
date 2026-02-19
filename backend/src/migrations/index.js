import migration001GlobalMultiEntity from "./m001_global_multi_entity.js";
import migration002AuthzOnboardingFoundations from "./m002_authz_onboarding_foundations.js";
import migration003RbacAuditAndConsolidationRunEntries from "./m003_rbac_audit_and_consolidation_run_entries.js";
import migration004TenantSafeConstraints from "./m004_tenant_safe_constraints.js";
import migration005PeriodCloseRuns from "./m005_period_close_runs.js";
import migration006ProviderControlPlane from "./m006_provider_control_plane.js";
import migration007ShareholdersMaster from "./m007_shareholders_master.js";

const migrations = [
  migration001GlobalMultiEntity,
  migration002AuthzOnboardingFoundations,
  migration003RbacAuditAndConsolidationRunEntries,
  migration004TenantSafeConstraints,
  migration005PeriodCloseRuns,
  migration006ProviderControlPlane,
  migration007ShareholdersMaster,
];

export default migrations;
