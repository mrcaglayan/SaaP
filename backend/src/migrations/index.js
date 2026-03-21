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
import migration020ContractsFoundation from "./m020_contracts_foundation.js";
import migration021RevenueRecognitionSchedules from "./m021_revenue_recognition_schedules.js";
import migration022CounterpartyAccountMapping from "./m022_counterparty_account_mapping.js";
import migration023ContractDocumentLinkEvents from "./m023_contract_document_link_events.js";
import migration024ContractAmendmentsAndVersioning from "./m024_contract_amendments_and_versioning.js";
import migration025ContractDocumentLinkFxSnapshots from "./m025_contract_document_link_fx_snapshots.js";
import migration026ContractLineReportingOptimization from "./m026_contract_line_reporting_optimization.js";
import migration027CariCashIntegrationFoundation from "./m027_cari_cash_integration_foundation.js";
import migration028ContractBillingGeneration from "./m028_contract_billing_generation.js";
import migration029CashTransitWorkflow from "./m029_cash_transit_workflow.js";
import migration030LegalEntityPolicyPacks from "./m030_legal_entity_policy_packs.js";
import migration031BankFoundation from "./m031_bank_foundation.js";
import migration032BankStatementImports from "./m032_bank_statement_imports.js";
import migration033BankReconciliation from "./m033_bank_reconciliation.js";
import migration034PaymentBatches from "./m034_payment_batches.js";
import migration039PayrollImportFoundation from "./m039_payroll_import_foundation.js";
import migration040PayrollAccrualPosting from "./m040_payroll_accrual_posting.js";
import migration041PayrollLiabilitiesPaymentPrep from "./m041_payroll_liabilities_payment_prep.js";
import migration042PayrollPaymentSettlementSync from "./m042_payroll_payment_settlement_sync.js";
import migration043PayrollCorrectionsReversals from "./m043_payroll_corrections_reversals.js";
import migration044PayrollPartialSettlementAndManualOverride from "./m044_payroll_partial_settlement_and_manual_override.js";
import migration045PayrollBeneficiarySnapshots from "./m045_payroll_beneficiary_snapshots.js";
import migration046PayrollCloseControls from "./m046_payroll_close_controls.js";
import migration047PayrollProviderAdapters from "./m047_payroll_provider_adapters.js";
import migration054SensitiveDataSecurity from "./m054_sensitive_data_security.js";
import migration055JobEngine from "./m055_job_engine.js";
import migration056BankPaymentFileAcks from "./m056_bank_payment_file_acks.js";
import migration057BankReconciliationRulesAndExceptions from "./m057_bank_reconciliation_rules_and_exceptions.js";
import migration058BankConnectivityAdapters from "./m058_bank_connectivity_adapters.js";
import migration059BankReconciliationAutopostTemplates from "./m059_bank_reconciliation_autopost_templates.js";
import migration060BankReturnsAndReconDifferences from "./m060_bank_returns_and_recon_differences.js";
import migration061BankGovernanceApprovalsSod from "./m061_bank_governance_approvals_sod.js";
import migration062PerformanceIndexesAndPaginationHardening from "./m062_performance_indexes_and_pagination_hardening.js";
import migration063ApprovalPolicyEngine from "./m063_approval_policy_engine.js";
import migration064ExceptionWorkbench from "./m064_exception_workbench.js";
import migration065DataRetentionArchival from "./m065_data_retention_archival.js";
import migration066BankReconAutopostTaxModes from "./m066_bank_recon_autopost_tax_modes.js";
import migration067UserPreferences from "./m067_user_preferences.js";
import migration068ExceptionWorkbenchSlaDueAt from "./m068_exception_workbench_sla_due_at.js";
import migration069JournalSourceLinks from "./m069_journal_source_links.js";
import migration070EvidenceStorageFoundation from "./m070_evidence_storage_foundation.js";
import migration071EvidenceStorageCompression from "./m071_evidence_storage_compression.js";
import migration072UserSavedViews from "./m072_user_saved_views.js";
import migration073InternalCommentsV1 from "./m073_internal_comments_v1.js";
import migration074MentionsAndInAppNotifications from "./m074_mentions_and_in_app_notifications.js";
import migration075OpsStatusNoteBlockedReason from "./m075_ops_status_note_blocked_reason.js";
import migration076UserInvitesCopyLinkFlow from "./m076_user_invites_copy_link_flow.js";
import migration077PasswordResetTokens from "./m077_password_reset_tokens.js";
import migration078TenantFeatureFlags from "./m078_tenant_feature_flags.js";
import migration079IdempotencyKeys from "./m079_idempotency_keys.js";
import migration080RowVersionOptimisticLocking from "./m080_row_version_optimistic_locking.js";
import migration081BankAccountsSubaccountHardening from "./m081_bank_accounts_subaccount_hardening.js";
import migration082CloseConsolidationWorkflowApprovals from "./m082_close_consolidation_workflow_approvals.js";
import migration083CountryTaxEngineFoundation from "./m083_country_tax_engine_foundation.js";
import migration084ConsolidationCanonicalMappingFoundation from "./m084_consolidation_canonical_mapping_foundation.js";
import migration085GlJournalDraftCancelAndEdit from "./m085_gl_journal_draft_cancel_and_edit.js";
import migration086CariPurposeMappingLeafAutofix from "./m086_cari_purpose_mapping_leaf_autofix.js";
import migration087CariSettlementBatchStatusCheckCashLinked from "./m087_cari_settlement_batch_status_check_cash_linked.js";
import migration088CariSettlementBatchStatusCheckCleanup from "./m088_cari_settlement_batch_status_check_cleanup.js";
import migration089CariSettlementBatchStatusCheckFinalCleanup from "./m089_cari_settlement_batch_status_check_final_cleanup.js";
import migration090CashFxDualAmountFoundation from "./m090_cash_fx_dual_amount_foundation.js";
import migration091CashExchangeBatches from "./m091_cash_exchange_batches.js";
import migration092CariSettlementFxReportingColumns from "./m092_cari_settlement_fx_reporting_columns.js";
import migration093CashFxRevaluationRuns from "./m093_cash_fx_revaluation_runs.js";
import migration094CashFxPositionLots from "./m094_cash_fx_position_lots.js";
import migration095CashFxRevaluationReversalHardening from "./m095_cash_fx_revaluation_reversal_hardening.js";
import migration096CashExchangeFeeSpreadAccounting from "./m096_cash_exchange_fee_spread_accounting.js";
import migration097ExceptionWorkbenchCashModule from "./m097_exception_workbench_cash_module.js";
import migration098ConsolidationCanonicalPerformanceIndexes from "./m098_consolidation_canonical_performance_indexes.js";
import migration099CariCheckConstraintCompatGuards from "./m099_cari_check_constraint_compat_guards.js";
import migration100CariCheckConstraintCompatGuardCleanup from "./m100_cari_check_constraint_compat_guard_cleanup.js";
import migration101CariSettlementAllocationDualCurrencyFoundation from "./m101_cari_settlement_allocation_dual_currency_foundation.js";
import migration102CariSettlementBatchDirection from "./m102_cari_settlement_batch_direction.js";
import migration103CariDocumentsOperatingUnit from "./m103_cari_documents_operating_unit.js";
import migration104BankStatementLinesOperatingUnit from "./m104_bank_statement_lines_operating_unit.js";
import migration105CounterpartyOperatingUnits from "./m105_counterparty_operating_units.js";
import migration106CashExchangePostingMode from "./m106_cash_exchange_posting_mode.js";
import migration107CashTxnSharedPostedJournal from "./m107_cash_txn_shared_posted_journal.js";
import migration108OperatingUnitInternalCurrentAccounts from "./m108_operating_unit_internal_current_accounts.js";
import migration109ShareholderCapitalFulfillments from "./m109_shareholder_capital_fulfillments.js";
import migration110ShareholderCapitalFulfillmentsCashRegisterLinks from "./m110_shareholder_capital_fulfillments_cash_register_links.js";
import migration111CashRegisterOwnershipScope from "./m111_cash_register_ownership_scope.js";
import migration112OperatingUnitPartnerCurrentAccounts from "./m112_operating_unit_partner_current_accounts.js";
import migration113TaxRuleThresholdAmount from "./m113_tax_rule_threshold_amount.js";
import migration114ConsolidationCanonicalSavedRules from "./m114_consolidation_canonical_saved_rules.js";
import migration115CariDocumentLinesFoundation from "./m115_cari_document_lines_foundation.js";
import migration116ItemCardsFoundation from "./m116_item_cards_foundation.js";
import migration117CariDocumentLineStockLinks from "./m117_cari_document_line_stock_links.js";
import migration118InventoryFoundation from "./m118_inventory_foundation.js";
import migration119InventoryIssueLayerConsumptions from "./m119_inventory_issue_layer_consumptions.js";
import migration120InventoryIssueJournalPosting from "./m120_inventory_issue_journal_posting.js";
import migration121CariStockLinkSuccessorLineage from "./m121_cari_stock_link_successor_lineage.js";
import migration122InventoryMovementReversalLineage from "./m122_inventory_movement_reversal_lineage.js";
import migration123InventoryWarehouseOwnershipScope from "./m123_inventory_warehouse_ownership_scope.js";
import migration124InventoryTransferFoundation from "./m124_inventory_transfer_foundation.js";
import migration125OperatingUnitReverseInternalCurrentAccounts from "./m125_operating_unit_reverse_internal_current_accounts.js";
import migration126ItemCardsInventoryTransitAccount from "./m126_item_cards_inventory_transit_account.js";
import migration127InventoryTransferSourceTypeBackfill from "./m127_inventory_transfer_source_type_backfill.js";
import migration128CariSettlementOwnerCollectorContexts from "./m128_cari_settlement_owner_collector_contexts.js";
import migration129InventoryTransferSourceTypeEnumRepair from "./m129_inventory_transfer_source_type_enum_repair.js";
import migration130OperatingUnitCurrentAccountConfigs from "./m130_operating_unit_current_account_configs.js";
import migration131CariDocumentLinesWarehouseBinding from "./m131_cari_document_lines_warehouse_binding.js";
import migration132CariDocumentLineStockLinksWarehouseBinding from "./m132_cari_document_line_stock_links_warehouse_binding.js";
import migration133CashTransitAccountNullable from "./m133_cash_transit_account_nullable.js";
import migration134DropCashTransitAccount from "./m134_drop_cash_transit_account.js";
import migration135PayrollEmployeeOwnerContextAssignments from "./m135_payroll_employee_owner_context_assignments.js";
import migration136PayrollRunLineOwnershipSnapshot from "./m136_payroll_run_line_ownership_snapshot.js";
import migration137PayrollLiabilityOperatingUnitAttribution from "./m137_payroll_liability_operating_unit_attribution.js";
import migration138FixedAssetsFoundation from "./m138_fixed_assets_foundation.js";
import migration139FixedAssetCustodianEmployees from "./m139_fixed_asset_custodian_employees.js";
import migration140FixedAssetCariCapitalizationAndTraceability from "./m140_fixed_asset_cari_capitalization_and_traceability.js";
import migration141FixedAssetSaleStaging from "./m141_fixed_asset_sale_staging.js";
import migration142FixedAssetRunHeaderPostingDate from "./m142_fixed_asset_run_header_posting_date.js";
import migration143FixedAssetsDisposalMetadata from "./m143_fixed_assets_disposal_metadata.js";

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
  migration020ContractsFoundation,
  migration021RevenueRecognitionSchedules,
  migration022CounterpartyAccountMapping,
  migration023ContractDocumentLinkEvents,
  migration024ContractAmendmentsAndVersioning,
  migration025ContractDocumentLinkFxSnapshots,
  migration026ContractLineReportingOptimization,
  migration027CariCashIntegrationFoundation,
  migration028ContractBillingGeneration,
  migration029CashTransitWorkflow,
  migration030LegalEntityPolicyPacks,
  migration031BankFoundation,
  migration032BankStatementImports,
  migration033BankReconciliation,
  migration034PaymentBatches,
  migration039PayrollImportFoundation,
  migration040PayrollAccrualPosting,
  migration041PayrollLiabilitiesPaymentPrep,
  migration042PayrollPaymentSettlementSync,
  migration043PayrollCorrectionsReversals,
  migration044PayrollPartialSettlementAndManualOverride,
  migration045PayrollBeneficiarySnapshots,
  migration046PayrollCloseControls,
  migration047PayrollProviderAdapters,
  migration054SensitiveDataSecurity,
  migration055JobEngine,
  migration056BankPaymentFileAcks,
  migration057BankReconciliationRulesAndExceptions,
  migration058BankConnectivityAdapters,
  migration059BankReconciliationAutopostTemplates,
  migration060BankReturnsAndReconDifferences,
  migration061BankGovernanceApprovalsSod,
  migration062PerformanceIndexesAndPaginationHardening,
  migration063ApprovalPolicyEngine,
  migration064ExceptionWorkbench,
  migration065DataRetentionArchival,
  migration066BankReconAutopostTaxModes,
  migration067UserPreferences,
  migration068ExceptionWorkbenchSlaDueAt,
  migration069JournalSourceLinks,
  migration070EvidenceStorageFoundation,
  migration071EvidenceStorageCompression,
  migration072UserSavedViews,
  migration073InternalCommentsV1,
  migration074MentionsAndInAppNotifications,
  migration075OpsStatusNoteBlockedReason,
  migration076UserInvitesCopyLinkFlow,
  migration077PasswordResetTokens,
  migration078TenantFeatureFlags,
  migration079IdempotencyKeys,
  migration080RowVersionOptimisticLocking,
  migration081BankAccountsSubaccountHardening,
  migration082CloseConsolidationWorkflowApprovals,
  migration083CountryTaxEngineFoundation,
  migration084ConsolidationCanonicalMappingFoundation,
  migration085GlJournalDraftCancelAndEdit,
  migration086CariPurposeMappingLeafAutofix,
  migration087CariSettlementBatchStatusCheckCashLinked,
  migration088CariSettlementBatchStatusCheckCleanup,
  migration089CariSettlementBatchStatusCheckFinalCleanup,
  migration090CashFxDualAmountFoundation,
  migration091CashExchangeBatches,
  migration092CariSettlementFxReportingColumns,
  migration093CashFxRevaluationRuns,
  migration094CashFxPositionLots,
  migration095CashFxRevaluationReversalHardening,
  migration096CashExchangeFeeSpreadAccounting,
  migration097ExceptionWorkbenchCashModule,
  migration098ConsolidationCanonicalPerformanceIndexes,
  migration099CariCheckConstraintCompatGuards,
  migration100CariCheckConstraintCompatGuardCleanup,
  migration101CariSettlementAllocationDualCurrencyFoundation,
  migration102CariSettlementBatchDirection,
  migration103CariDocumentsOperatingUnit,
  migration104BankStatementLinesOperatingUnit,
  migration105CounterpartyOperatingUnits,
  migration106CashExchangePostingMode,
  migration107CashTxnSharedPostedJournal,
  migration108OperatingUnitInternalCurrentAccounts,
  migration109ShareholderCapitalFulfillments,
  migration110ShareholderCapitalFulfillmentsCashRegisterLinks,
  migration111CashRegisterOwnershipScope,
  migration112OperatingUnitPartnerCurrentAccounts,
  migration113TaxRuleThresholdAmount,
  migration114ConsolidationCanonicalSavedRules,
  migration115CariDocumentLinesFoundation,
  migration116ItemCardsFoundation,
  migration117CariDocumentLineStockLinks,
  migration118InventoryFoundation,
  migration119InventoryIssueLayerConsumptions,
  migration120InventoryIssueJournalPosting,
  migration121CariStockLinkSuccessorLineage,
  migration122InventoryMovementReversalLineage,
  migration123InventoryWarehouseOwnershipScope,
  migration124InventoryTransferFoundation,
  migration125OperatingUnitReverseInternalCurrentAccounts,
  migration126ItemCardsInventoryTransitAccount,
  migration127InventoryTransferSourceTypeBackfill,
  migration128CariSettlementOwnerCollectorContexts,
  migration129InventoryTransferSourceTypeEnumRepair,
  migration130OperatingUnitCurrentAccountConfigs,
  migration131CariDocumentLinesWarehouseBinding,
  migration132CariDocumentLineStockLinksWarehouseBinding,
  migration133CashTransitAccountNullable,
  migration134DropCashTransitAccount,
  migration135PayrollEmployeeOwnerContextAssignments,
  migration136PayrollRunLineOwnershipSnapshot,
  migration137PayrollLiabilityOperatingUnitAttribution,
  migration138FixedAssetsFoundation,
  migration139FixedAssetCustodianEmployees,
  migration140FixedAssetCariCapitalizationAndTraceability,
  migration141FixedAssetSaleStaging,
  migration142FixedAssetRunHeaderPostingDate,
  migration143FixedAssetsDisposalMetadata,
];

export default migrations;
