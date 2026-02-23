import migration001GlobalMultiEntity from "./m001_global_multi_entity.js";
import migration002AuthzOnboardingFoundations from "./m002_authz_onboarding_foundations.js";
import migration003RbacAuditAndConsolidationRunEntries from "./m003_rbac_audit_and_consolidation_run_entries.js";
import migration004TenantSafeConstraints from "./m004_tenant_safe_constraints.js";
import migration005PeriodCloseRuns from "./m005_period_close_runs.js";
import migration006ProviderControlPlane from "./m006_provider_control_plane.js";
import migration007ShareholdersMaster from "./m007_shareholders_master.js";
import migration008ShareholderCapitalSubAccount from "./m008_shareholder_capital_sub_account.js";
import migration009JournalPurposeAccounts from "./m009_journal_purpose_accounts.js";
import migration010IntercompanyJournalLinks from "./m010_intercompany_journal_links.js";
import migration011JournalLineSubledgerReference from "./m011_journal_line_subledger_reference.js";
import migration012ShareholderCommitmentDebitSubAccount from "./m012_shareholder_commitment_debit_sub_account.js";
import migration013GlReclassificationRuns from "./m013_gl_reclassification_runs.js";
import migration014ShareholderCommitmentJournalEntries from "./m014_shareholder_commitment_journal_entries.js";
import migration015CashControlFoundation from "./m015_cash_control_foundation.js";
import migration016CashControlIntegrity from "./m016_cash_control_integrity.js";
import migration017CariSchemaFoundation from "./m017_cari_schema_foundation.js";
import migration018CariReportIndexes from "./m018_cari_report_indexes.js";
import migration019CounterpartyRoleFlags from "./m019_counterparty_role_flags.js";

const migrations = [
  migration001GlobalMultiEntity,
  migration002AuthzOnboardingFoundations,
  migration003RbacAuditAndConsolidationRunEntries,
  migration004TenantSafeConstraints,
  migration005PeriodCloseRuns,
  migration006ProviderControlPlane,
  migration007ShareholdersMaster,
  migration008ShareholderCapitalSubAccount,
  migration009JournalPurposeAccounts,
  migration010IntercompanyJournalLinks,
  migration011JournalLineSubledgerReference,
  migration012ShareholderCommitmentDebitSubAccount,
  migration013GlReclassificationRuns,
  migration014ShareholderCommitmentJournalEntries,
  migration015CashControlFoundation,
  migration016CashControlIntegrity,
  migration017CariSchemaFoundation,
  migration018CariReportIndexes,
  migration019CounterpartyRoleFlags,
];

export default migrations;
