import migration001GlobalMultiEntity from "./m001_global_multi_entity.js";
import migration002AuthzOnboardingFoundations from "./m002_authz_onboarding_foundations.js";
import migration003RbacAuditAndConsolidationRunEntries from "./m003_rbac_audit_and_consolidation_run_entries.js";
import migration004TenantSafeConstraints from "./m004_tenant_safe_constraints.js";

const migrations = [
  migration001GlobalMultiEntity,
  migration002AuthzOnboardingFoundations,
  migration003RbacAuditAndConsolidationRunEntries,
  migration004TenantSafeConstraints,
];

export default migrations;
