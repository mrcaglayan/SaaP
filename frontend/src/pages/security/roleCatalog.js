
import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_CLOSED_POST_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
} from "../../../../shared/periodCloseGovernance.js";
import { getWorkflowStepAllowedScopeTypes } from "../../../../shared/workflowStepScopeGovernance.js";

function freezeList(values) {
  return Object.freeze(values);
}
function freezeStep(step) {
  return Object.freeze(step);
}
function freezeAuthority(authority) {
  return Object.freeze({
    ...authority,
    requiredPermissionCodes: freezeList(authority?.requiredPermissionCodes || []),
    anyPermissionCodes: freezeList(authority?.anyPermissionCodes || []),
    allowedStepScopes: freezeList(authority?.allowedStepScopes || []),
  });
}
const CATEGORY_LABELS = Object.freeze({
  system: "System administration",
  composable: "Composable duty-boundary",
  scoped: "Scoped operations",
  readonly: "Read-only",
  managed_authority: "Workflow managed role",
  custom: "Custom tenant role",
});
const ACCESS_MODEL_TYPE_LABELS = Object.freeze({
  runtime_role: "Runtime Role",
  assignment_preset: "Assignment Preset",
});
const WORKFLOW_FAMILY_LABELS = Object.freeze({
  CROSS_WORKFLOW: "Cross-workflow",
  AP_DOCUMENT_POSTING: "AP Document Posting",
  LOCAL_CLOSE_PACK: "Local Close Pack",
  PERIOD_CLOSE: "Period Close",
  CONSOLIDATION_RUN: "Consolidation Run",
});
const WORKFLOW_AUTHORITY_CATALOG = Object.freeze({
  CROSS_WORKFLOW: freezeList([
    freezeAuthority({
      code: "WF_SETUP_ADMIN",
      displayName: "Administer workflow setup",
      description:
        "Create and maintain workflow definitions, assignments, and approval-policy setup.",
      anyPermissionCodes: ["workflow.definition.write", "workflow.assignment.write"],
      sortOrder: 10,
    }),
    freezeAuthority({
      code: "WF_QUEUE_VIEW",
      displayName: "Review workflow queues",
      description:
        "Read workflow assignments and approval requests without setup-write authority.",
      anyPermissionCodes: [
        "approvals.requests.read",
        "workflow.assignment.read",
        "workflow.definition.read",
      ],
      viewOnly: true,
      sortOrder: 20,
    }),
  ]),
  AP_DOCUMENT_POSTING: freezeList([
    freezeAuthority({
      code: "AP_VIEW",
      displayName: "View AP",
      description: "Read governed AP documents and diagnostics.",
      requiredPermissionCodes: ["cari.doc.read"],
      viewOnly: true,
      sortOrder: 10,
    }),
    freezeAuthority({
      code: "AP_DRAFT_SUBMIT",
      displayName: "Draft and submit AP",
      description: "Create, update, and submit AP work into the approval flow.",
      requiredPermissionCodes: ["cari.doc.submit"],
      anyPermissionCodes: ["cari.doc.update"],
      sortOrder: 20,
    }),
    freezeAuthority({
      code: "AP_APPROVE",
      displayName: "Approve AP",
      description: "Review and approve governed AP requests.",
      requiredPermissionCodes: ["approvals.requests.approve"],
      sortOrder: 30,
    }),
    freezeAuthority({
      code: "AP_POST",
      displayName: "Post AP",
      description: "Perform final AP posting at the selected scope.",
      requiredPermissionCodes: ["cari.doc.post"],
      sortOrder: 40,
    }),
    freezeAuthority({
      code: "AP_REVERSE",
      displayName: "Reverse AP",
      description: "Reverse already-posted AP documents.",
      requiredPermissionCodes: ["cari.doc.reverse"],
      sortOrder: 50,
    }),
    freezeAuthority({
      code: "AP_FX_OVERRIDE",
      displayName: "Override AP FX",
      description: "Handle exceptional AP foreign-currency overrides.",
      requiredPermissionCodes: ["cari.fx.override"],
      sortOrder: 60,
    }),
  ]),
  LOCAL_CLOSE_PACK: freezeList([
    freezeAuthority({
      code: "LOCAL_CLOSE_VIEW",
      displayName: "View Local Close",
      description: "Read local-close packs and their status.",
      requiredPermissionCodes: ["ouclose.read"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.read"),
      viewOnly: true,
      sortOrder: 10,
    }),
    freezeAuthority({
      code: "LOCAL_CLOSE_PREPARE",
      displayName: "Prepare Local Close",
      description: "Prepare and submit local-close work.",
      requiredPermissionCodes: ["ouclose.prepare"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.prepare"),
      sortOrder: 20,
    }),
    freezeAuthority({
      code: "LOCAL_CLOSE_REVIEW",
      displayName: "Review Local Close",
      description: "Review local-close checkpoints before approval.",
      requiredPermissionCodes: ["ouclose.review"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.review"),
      sortOrder: 30,
    }),
    freezeAuthority({
      code: "LOCAL_CLOSE_APPROVE_LOCK",
      displayName: "Approve and lock Local Close",
      description: "Give final local-close approval and lock the pack.",
      requiredPermissionCodes: ["ouclose.approve", "ouclose.lock"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.approve"),
      sortOrder: 40,
    }),
    freezeAuthority({
      code: "LOCAL_CLOSE_REOPEN",
      displayName: "Reopen Local Close",
      description: "Reopen a previously closed local-close pack.",
      requiredPermissionCodes: ["ouclose.reopen"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.reopen"),
      sortOrder: 50,
    }),
    freezeAuthority({
      code: "LOCAL_CLOSE_ADMIN",
      displayName: "Administer Local Close",
      description: "Apply override or administrative control to local-close packs.",
      anyPermissionCodes: ["ouclose.admin", "ouclose.override_post_lock"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("ouclose.admin"),
      sortOrder: 60,
    }),
  ]),
  PERIOD_CLOSE: freezeList([
    freezeAuthority({
      code: "PERIOD_CLOSE_READINESS",
      displayName: "Review period-close readiness",
      description: "Review fiscal periods, journals, and supporting GL visibility before close.",
      requiredPermissionCodes: [PERIOD_CLOSE_READINESS_PERMISSION_CODE],
      allowedStepScopes: ["LEGAL_ENTITY", "COUNTRY", "GROUP"],
      viewOnly: true,
      sortOrder: 10,
    }),
    freezeAuthority({
      code: "PERIOD_CLOSE_APPROVAL",
      displayName: "Approve period close",
      description: "Approve governed period-close workflow steps without executing the close run.",
      requiredPermissionCodes: [PERIOD_CLOSE_APPROVE_PERMISSION_CODE],
      allowedStepScopes: ["LEGAL_ENTITY", "COUNTRY", "GROUP"],
      sortOrder: 20,
    }),
    freezeAuthority({
      code: "PERIOD_CLOSE_EXECUTION",
      displayName: "Execute period close",
      description: "Execute the final governed period close once workflow approval is complete.",
      requiredPermissionCodes: [PERIOD_CLOSE_EXECUTE_PERMISSION_CODE],
      allowedStepScopes: ["LEGAL_ENTITY", "COUNTRY"],
      sortOrder: 30,
    }),
    freezeAuthority({
      code: "PERIOD_REOPEN",
      displayName: "Reopen periods",
      description: "Reopen a previously closed period.",
      requiredPermissionCodes: [PERIOD_CLOSE_REOPEN_PERMISSION_CODE],
      allowedStepScopes: ["LEGAL_ENTITY", "COUNTRY"],
      sortOrder: 40,
    }),
    freezeAuthority({
      code: "PERIOD_ADMIN",
      displayName: "Administer period close",
      description: "Apply exceptional period-close governance controls.",
      requiredPermissionCodes: [PERIOD_CLOSE_ADMIN_PERMISSION_CODE],
      allowedStepScopes: ["COUNTRY", "GROUP"],
      sortOrder: 50,
    }),
    freezeAuthority({
      code: "PERIOD_CLOSED_POST",
      displayName: "Post to soft-closed periods",
      description: "Post approved journals into soft-closed periods.",
      requiredPermissionCodes: [PERIOD_CLOSE_CLOSED_POST_PERMISSION_CODE],
      allowedStepScopes: ["LEGAL_ENTITY", "COUNTRY", "GROUP"],
      sortOrder: 60,
    }),
  ]),
  CONSOLIDATION_RUN: freezeList([
    freezeAuthority({
      code: "CONSOLIDATION_VIEW",
      displayName: "View Consolidation",
      description: "Read consolidation runs, mappings, and reports.",
      requiredPermissionCodes: ["consolidation.run.read"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.run.read"),
      viewOnly: true,
      sortOrder: 10,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_PREPARE",
      displayName: "Prepare Consolidation runs",
      description: "Open and stage consolidation runs.",
      requiredPermissionCodes: ["consolidation.run.create"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.run.create"),
      sortOrder: 20,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_EXECUTE",
      displayName: "Execute Consolidation runs",
      description: "Execute consolidation runs once inputs are ready.",
      requiredPermissionCodes: ["consolidation.run.execute"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.run.execute"),
      sortOrder: 30,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_ADJUST",
      displayName: "Post Consolidation adjustments",
      description: "Post consolidation adjustment entries.",
      requiredPermissionCodes: ["consolidation.adjustment.post"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.adjustment.post"),
      sortOrder: 40,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_ELIMINATE",
      displayName: "Post Consolidation eliminations",
      description: "Post consolidation elimination entries.",
      requiredPermissionCodes: ["consolidation.elimination.post"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.elimination.post"),
      sortOrder: 50,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_FINALIZE",
      displayName: "Finalize Consolidation",
      description: "Finalize the consolidation run after execution and posting.",
      requiredPermissionCodes: ["consolidation.run.finalize"],
      allowedStepScopes: getWorkflowStepAllowedScopeTypes("consolidation.run.finalize"),
      sortOrder: 60,
    }),
    freezeAuthority({
      code: "CONSOLIDATION_SETUP",
      displayName: "Administer Consolidation setup",
      description: "Maintain consolidation structures, mappings, and setup.",
      anyPermissionCodes: [
        "consolidation.group.upsert",
        "consolidation.coa_mapping.upsert",
        "consolidation.elimination_placeholder.upsert",
      ],
      sortOrder: 70,
    }),
  ]),
});
const ASSIGNMENT_PRESET_CATEGORY_LABELS = Object.freeze({
  bootstrap_setup: "Bootstrap setup",
});
const MODEL_CATEGORY_LABELS = Object.freeze({
  runtime_role: CATEGORY_LABELS,
  assignment_preset: ASSIGNMENT_PRESET_CATEGORY_LABELS,
});
const WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX = "WORKFLOW_PACKAGE__";
const ROLE_CATALOG_CODE_ALIASES = Object.freeze({
  CountryAPPoster: "CountryAPController",
});
const BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES = Object.freeze({});
const ROLE_CATALOG = Object.freeze({
  SecurityAdmin: {
    category: "system",
    summary:
      "Manages roles, assignments, scopes, and security-facing audit surfaces.",
    capabilities: ["Role governance", "Access administration", "Security audit"],
    recommendedScopes: ["TENANT"],
    sortOrder: 410,
  },
  SystemAdmin: {
    category: "system",
    summary:
      "Manages tenant setup controls, workflow governance, jobs, retention, and broader operational controls.",
    capabilities: [
      "Ops jobs",
      "Tenant setup controls",
      "Workflow governance",
      "Retention operations",
    ],
    recommendedScopes: ["TENANT"],
    sortOrder: 420,
  },
  LocalUserAdmin: {
    category: "composable",
    summary:
      "Invites and manages allow-listed local operational roles without opening tenant-wide security administration.",
    capabilities: ["Scoped invites", "Allow-listed local roles", "Local assignment review"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
    sortOrder: 210,
  },
  MasterDataSteward: {
    category: "composable",
    summary:
      "Owns organizational, accounting, and counterparty master data review without taking posting authority.",
    capabilities: ["Org structure", "GL master data", "Counterparty request review"],
    recommendedScopes: ["GROUP", "COUNTRY", "LEGAL_ENTITY"],
    sortOrder: 220,
  },
  CounterpartyCardEditor: {
    category: "composable",
    summary:
      "Maintains live customer/vendor cards and exceptional AP/AR control-account overrides without broad review or posting authority.",
    capabilities: [
      "Live card maintenance",
      "Counterparty account overrides",
      "Counterparty payment-term editing",
    ],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 230,
  },
  EntityAPController: {
    code: "AP Submitter",
    category: "composable",
    summary:
      "Prepares, corrects, and submits AP documents at legal-entity scope without inheriting review or final posting authority.",
    capabilities: ["AP draft correction", "AP submit", "AP workflow handoff"],
    recommendedScopes: ["LEGAL_ENTITY"],
    replacementLabel: "AP Submitter",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 120,
  },
  OUAPSubmitter: {
    code: "Branch AP Submitter",
    category: "composable",
    summary:
      "Optional operating-unit AP submitter role for branches that can hand off their own governed AP drafts without broader entity submit coverage.",
    capabilities: ["OU AP submit", "Workflow handoff", "Draft correction"],
    recommendedScopes: ["OPERATING_UNIT"],
    replacementLabel: "Branch AP Submitter",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 115,
  },
  CountryAPApprover: {
    code: "AP Reviewer",
    category: "composable",
    summary:
      "Country-scoped AP review role that reads governed AP documents while final posting stays separate.",
    capabilities: ["Country AP visibility", "AP workflow review", "AP return/approve via workflow"],
    recommendedScopes: ["COUNTRY"],
    replacementLabel: "AP Reviewer",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 130,
  },
  CountryAPController: {
    code: "AP Poster",
    category: "composable",
    summary:
      "Country-scoped AP final-posting role for posting and reversal. Review authority stays separate from posting authority.",
    capabilities: ["Country AP visibility", "AP final post", "AP reverse"],
    recommendedScopes: ["COUNTRY"],
    replacementLabel: "AP Poster",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 140,
  },
  APApprover: {
    category: "composable",
    summary:
      "Platform-level approval engine access for AP workflows. Grants the ability to read and act on AP workflow approval requests. Assign alongside a domain role such as AP Submitter or AP Reviewer so the user can participate in approval decisions routed to their scope.",
    capabilities: ["Approval request visibility", "Approve/reject workflow decisions", "Approval policy visibility"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY", "OPERATING_UNIT"],
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 150,
  },
  WorkflowGovernanceAdmin: {
    code: "Workflow Governance Admin",
    category: "composable",
    summary:
      "Owns workflow-definition, assignment, and approval-policy setup without requiring full tenant operations administration.",
    capabilities: ["Workflow setup", "Assignment governance", "Approval policy setup"],
    recommendedScopes: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY"],
    workflowFamily: "CROSS_WORKFLOW",
    sortOrder: 205,
  },
  WorkflowQueueViewer: {
    code: "Workflow Queue Viewer",
    category: "composable",
    summary:
      "Reads governed workflow definitions, assignments, and approval queues without setup-write authority.",
    capabilities: ["Workflow visibility", "Approval queue review", "Assignment visibility"],
    recommendedScopes: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY"],
    workflowFamily: "CROSS_WORKFLOW",
    sortOrder: 206,
  },
  GLOperator: {
    category: "composable",
    summary:
      "Runs GL operations and reporting without free-form manual posting authority.",
    capabilities: ["Journal drafting", "Ledger visibility", "Period operations"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 240,
  },
  GLPostingAuthority: {
    category: "composable",
    summary:
      "Companion authority for manual journal post and reversal without period-close governance. Pair it with a read-bearing accounting role.",
    capabilities: ["Manual journal posting", "Manual reversal", "Journal control"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
    companionOnly: true,
    companionNote:
      "Pair with GLOperator or another read-bearing accounting role at the same or broader scope. Assign period-close authority through the dedicated period-close roles separately.",
    sortOrder: 250,
  },
  ShareholderCapitalOperator: {
    category: "composable",
    summary:
      "Posts and reverses shareholder capital fulfillment without broader org master-data or treasury governance powers.",
    capabilities: ["Equity funding", "Capital fulfillment", "Posting control"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 260,
  },
  OUAccountant: {
    category: "composable",
    summary:
      "Optional operating-unit accounting role for OUs that truly own local accounting adjustments.",
    capabilities: ["OU accounting exceptions", "Operational GL work"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 270,
  },
  TreasuryOperator: {
    category: "composable",
    summary:
      "Operates bank, cash, and settlement workflows without treasury approval power.",
    capabilities: ["Cash operations", "Bank operations", "Settlement handling"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 280,
  },
  TreasuryApprover: {
    category: "composable",
    summary:
      "Approves bank and treasury governance flows without becoming the operational maker.",
    capabilities: ["Bank governance", "Payment approval", "Cash variance approval"],
    recommendedScopes: ["COUNTRY"],
    sortOrder: 290,
  },
  PayrollOperator: {
    category: "composable",
    summary:
      "Runs payroll preparation and operations without payroll governance approval power.",
    capabilities: ["Payroll operations", "Payroll ownership", "Payroll preparation"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 300,
  },
  PayrollApprover: {
    category: "composable",
    summary:
      "Approves payroll governance actions while keeping review authority separate from payroll operations.",
    capabilities: ["Payroll governance", "Run review", "Close approval"],
    recommendedScopes: ["COUNTRY"],
    sortOrder: 310,
  },
  LocalClosePreparer: {
    category: "composable",
    summary:
      "Prepares local close work and reopen requests without reviewer authority.",
    capabilities: ["Close preparation", "Close submission", "Reopen requests"],
    recommendedScopes: ["LEGAL_ENTITY"],
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 320,
  },
  LocalCloseReviewer: {
    category: "composable",
    summary:
      "Reviews and approves local close governance steps without becoming the close preparer.",
    capabilities: ["Close review", "Close approval", "Close locking"],
    recommendedScopes: ["COUNTRY"],
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 330,
  },
  LocalCloseApproveLockAuthority: {
    code: "Local Close Approve & Lock",
    category: "composable",
    summary:
      "Final local-close authority for approval and lock decisions without inheriting preparation or reopen-admin duties.",
    capabilities: ["Close approval", "Close locking", "Final signoff"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY"],
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 331,
  },
  LocalCloseReopenAdminAuthority: {
    code: "Local Close Reopen Admin",
    category: "composable",
    summary:
      "Exceptional local-close authority for reopen, override, and admin intervention without acting as the preparer.",
    capabilities: ["Close reopen", "Override after lock", "Close admin"],
    recommendedScopes: ["COUNTRY", "GROUP"],
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 332,
  },
  PeriodCloseSupervisorAuthority: {
    code: "Period Close Supervisor",
    category: "composable",
    summary:
      "Approves governed period-close workflow steps without receiving final close execution, reopen, or admin authority. This role stays centrally managed and is not exposed through local user administration or bootstrap handoff presets.",
    capabilities: ["Period-close approval", "Supervisory signoff", "Workflow governance"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY", "GROUP"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 333,
  },
  PeriodCloseAuthority: {
    code: "Period Close Authority",
    category: "composable",
    summary:
      "Executes the governed final period close once workflow approval is complete, without inheriting reopen-admin or manual journal-posting authority.",
    capabilities: ["Period-close execution", "Final close action", "Governed close run"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 334,
  },
  PeriodReopenAuthority: {
    code: "Period Reopen Authority",
    category: "composable",
    summary:
      "Reopens previously closed periods when controlled corrections are required.",
    capabilities: ["Period reopen", "Controlled correction release"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 335,
  },
  PeriodAdminAuthority: {
    code: "Period Close Admin",
    category: "composable",
    summary:
      "Handles exceptional period-close repair and admin controls without becoming the routine close executor.",
    capabilities: ["Period admin", "Close override control", "Exceptional governance"],
    recommendedScopes: ["COUNTRY", "GROUP"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 336,
  },
  ClosedPeriodJournalOverrideAuthority: {
    code: "Closed-Period Journal Override",
    category: "composable",
    summary:
      "Exceptional authority for posting approved manual journals into soft-closed periods only after finance-governance signoff.",
    capabilities: ["Closed-period posting", "Exceptional journal override"],
    recommendedScopes: ["LEGAL_ENTITY", "COUNTRY", "GROUP"],
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 337,
  },
  GroupReportingController: {
    category: "composable",
    summary:
      "Owns consolidation, intercompany, and group reporting responsibilities.",
    capabilities: ["Consolidation", "Intercompany control", "Group reporting"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 340,
  },
  ConsolidationRunPreparer: {
    code: "Consolidation Run Preparer",
    category: "composable",
    summary:
      "Prepares group consolidation runs without execution, posting, or finalization authority.",
    capabilities: ["Run preparation", "Input readiness", "Consolidation staging"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 341,
  },
  ConsolidationRunExecutor: {
    code: "Consolidation Run Executor",
    category: "composable",
    summary:
      "Executes consolidation runs after preparation is complete without adjustment or finalization authority.",
    capabilities: ["Run execution", "Consolidation processing"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 342,
  },
  ConsolidationAdjustmentPoster: {
    code: "Consolidation Adjustment Poster",
    category: "composable",
    summary:
      "Posts consolidation adjustment entries without elimination or finalization authority.",
    capabilities: ["Adjustment drafting", "Adjustment posting"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 343,
  },
  ConsolidationEliminationPoster: {
    code: "Consolidation Elimination Poster",
    category: "composable",
    summary:
      "Posts elimination entries without taking over the rest of the consolidation workflow.",
    capabilities: ["Elimination drafting", "Elimination posting"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 344,
  },
  ConsolidationFinalizer: {
    code: "Consolidation Finalizer",
    category: "composable",
    summary:
      "Finalizes the group consolidation run after preparation and execution are complete.",
    capabilities: ["Run finalization", "Final group signoff"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 345,
  },
  ConsolidationSetupAdmin: {
    code: "Consolidation Setup Admin",
    category: "composable",
    summary:
      "Maintains consolidation groups, mappings, elimination placeholders, and intercompany setup without run finalization authority.",
    capabilities: ["Consolidation setup", "Mapping maintenance", "Intercompany setup"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 346,
  },
  BranchInventoryViewer: {
    code: "Branch Inventory Viewer",
    category: "readonly",
    summary:
      "Reads branch-owned warehouses, inventory movements, and item-card account mappings without maintenance authority.",
    capabilities: ["Branch inventory visibility", "Warehouse lookup", "Item-card mapping review"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 111,
  },
  BranchInventoryExecutor: {
    code: "Branch Inventory Executor",
    category: "scoped",
    summary:
      "Executes branch stock materialization, movement reversal, and transfer handling without item-card or warehouse setup authority.",
    capabilities: ["Stock materialization", "Movement reversal", "Transfer execution"],
    recommendedScopes: ["OPERATING_UNIT"],
    companionNote:
      "Auto-assigned with BranchOperator at the same OU scope. Item cards, warehouses, landed-cost vouchers, and transfer governance stay separate.",
    sortOrder: 112,
  },
  BranchInventoryOperator: {
    code: "Branch Inventory Operator",
    category: "scoped",
    summary:
      "Runs broad branch inventory operations including stock execution, warehouse setup, landed-cost maintenance, transfer governance, and shared item-card maintenance.",
    capabilities: ["Warehouse setup", "Inventory power-user control", "Item-card maintenance"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 113,
  },
  BranchFixedAssetViewer: {
    code: "Branch Fixed Asset Viewer",
    category: "readonly",
    summary:
      "Reads branch-owned fixed-asset registers, categories, custodians, and reports without lifecycle write authority.",
    capabilities: ["Branch asset visibility", "Category lookup", "Custodian lookup"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 114,
  },
  BranchFixedAssetOperator: {
    code: "Branch Fixed Asset Operator",
    category: "scoped",
    summary:
      "Creates and updates branch-owned fixed assets while keeping activation, disposal, transfer, and depreciation governance at entity scope.",
    capabilities: [
      "Branch asset drafting",
      "Custodian-aware updates",
      "Branch asset maintenance",
    ],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 115,
  },
  EntityInventoryViewer: {
    code: "Entity Inventory Viewer",
    category: "readonly",
    summary:
      "Reads entity inventory, warehouse setups, and item-card account mappings without write authority.",
    capabilities: ["Entity inventory visibility", "Warehouse review", "Item-card mapping review"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 241,
  },
  EntityInventoryOperator: {
    code: "Entity Inventory Operator",
    category: "scoped",
    summary:
      "Owns entity inventory execution, setup, landed-cost, transfer governance, and shared item-card maintenance without broader GL master-data write authority.",
    capabilities: ["Inventory execution", "Warehouse and landed-cost setup", "Item-card maintenance"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 242,
  },
  EntityFixedAssetViewer: {
    code: "Entity Fixed Asset Viewer",
    category: "readonly",
    summary:
      "Reads legal-entity fixed-asset registers, setup tables, custodians, and reports without lifecycle write authority.",
    capabilities: ["Entity asset visibility", "Setup review", "Fixed-asset reporting"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 243,
  },
  EntityFixedAssetOperator: {
    code: "Entity Fixed Asset Operator",
    category: "scoped",
    summary:
      "Owns legal-entity fixed-asset lifecycle, setup, depreciation, and custodian maintenance without broader GL override authority.",
    capabilities: ["Fixed-asset lifecycle", "Setup governance", "Depreciation control"],
    recommendedScopes: ["LEGAL_ENTITY"],
    sortOrder: 244,
  },
  AuditorReadOnly: {
    category: "readonly",
    summary:
      "Read-only audit visibility across governed surfaces without operational authority.",
    capabilities: ["Read-only visibility", "Audit review", "Reporting access"],
    recommendedScopes: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"],
    sortOrder: 360,
  },
  BranchOperator: {
    code: "Branch Accountant",
    category: "scoped",
    summary:
      "Operating-unit AP draft and operational-document role with bounded inventory and fixed-asset execution companions. Review, final posting, and setup authority stay separate.",
    capabilities: ["OU visibility", "Draft AP handling", "Bounded execution companions"],
    recommendedScopes: ["OPERATING_UNIT"],
    companionNote:
      "Assigning BranchOperator at OU scope also auto-assigns BranchInventoryExecutor and BranchFixedAssetOperator at the same OU scope.",
    replacementLabel: "Branch Accountant",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 110,
  },
});
export const BOOTSTRAP_HANDOFF_PRESET_CATALOG = Object.freeze({
  EntityAPController: Object.freeze({
    code: "EntityAPController",
    displayName: "Default Entity Accountant Roles",
    summary:
      "Default legal-entity accountant role bundle for local accounting operations, approvals, and readiness work.",
    workflowFamily: "AP_DOCUMENT_POSTING",
    category: "bootstrap_setup",
    sortOrder: 10,
    scopeType: "LEGAL_ENTITY",
    roleCodes: freezeList([
      "LocalUserAdmin",
      "MasterDataSteward",
      "CounterpartyCardEditor",
      "EntityAPController",
      "APApprover",
      "GLOperator",
      "TreasuryOperator",
      "PayrollOperator",
      "LocalClosePreparer",
      "ShareholderCapitalOperator",
    ]),
    optionalRoleCodes: freezeList(["GLPostingAuthority"]),
  }),
  BranchAccountant: Object.freeze({
    code: "BranchAccountant",
    displayName: "Branch Accountant",
    summary:
      "Operating-unit branch accountant bundle that currently grants branch accounting plus inventory and fixed-asset execution companions.",
    workflowFamily: "AP_DOCUMENT_POSTING",
    category: "bootstrap_setup",
    sortOrder: 20,
    scopeType: "OPERATING_UNIT",
    roleCodes: freezeList([
      "BranchOperator",
      "BranchInventoryExecutor",
      "BranchFixedAssetOperator",
    ]),
    assignmentRoleCodes: freezeList(["BranchOperator"]),
    optionalRoleCodes: freezeList([]),
  }),
});
const CATEGORY_ORDER = Object.freeze([
  "composable",
  "scoped",
  "readonly",
  "managed_authority",
  "system",
  "custom",
]);
function normalizeText(value) {
  return String(value || "").trim();
}
function normalizeRoleCatalogCode(roleCode) {
  const normalizedRoleCode = normalizeText(roleCode);
  return ROLE_CATALOG_CODE_ALIASES[normalizedRoleCode] || normalizedRoleCode;
}

function isWorkflowPackageAssignmentRoleCode(roleCode) {
  return normalizeText(roleCode).startsWith(WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX);
}

function buildManagedPackageRoleEntry(roleOrCode, requestedRoleCode) {
  const packageName = normalizeText(roleOrCode?.name);
  const runtimeCode = normalizeText(requestedRoleCode);
  const displayCode = packageName || runtimeCode;
  const metadata = buildMetadataEntry({
    modelType: "runtime_role",
    code: displayCode,
    displayName: displayCode,
    description:
      "Managed through workflow governance so the runtime permission set stays aligned to the shipped authority model.",
    category: "managed_authority",
    workflowFamily: "CROSS_WORKFLOW",
    sortOrder: 190,
  });

  return {
    ...metadata,
    runtimeCode,
    technicalCode: packageName ? runtimeCode : "",
    summary: metadata.description,
    capabilities: ["Workflow-governed authority mapping"],
    recommendedScopes: [],
    managedPackageRole: true,
    packageAuthorityOnly: true,
    companionOnly: false,
    companionNote: "",
  };
}
function normalizeBootstrapHandoffPresetCode(presetCode) {
  const normalizedPresetCode = normalizeText(presetCode);
  return BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES[normalizedPresetCode] || normalizedPresetCode;
}
function cloneList(values) {
  return Array.isArray(values) ? [...values] : [];
}
function getCategoryLabel(modelType, category) {
  const normalizedCategory = normalizeText(category);
  const labelMap = MODEL_CATEGORY_LABELS[modelType] || {};
  if (labelMap[normalizedCategory]) {
    return labelMap[normalizedCategory];
  }
  if (!normalizedCategory) {
    return "Unclassified";
  }
  return normalizedCategory === "unclassified" ? "Unclassified" : normalizedCategory;
}
function sortCatalogEntries(left, right) {
  const leftOrder = Number(left?.sortOrder || 9999);
  const rightOrder = Number(right?.sortOrder || 9999);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return normalizeText(left?.displayName || left?.code).localeCompare(
    normalizeText(right?.displayName || right?.code)
  );
}
function buildMetadataEntry({
  modelType,
  code,
  displayName,
  description,
  category,
  defaultScope = "",
  replacementLabel = "",
  workflowFamily = "CROSS_WORKFLOW",
  sortOrder = 9999,
}) {
  return {
    modelType,
    modelTypeLabel: getAccessModelTypeLabel(modelType),
    code,
    displayName,
    description,
    category,
    categoryLabel: getCategoryLabel(modelType, category),
    defaultScope,
    replacementLabel,
    workflowFamily,
    workflowFamilyLabel: getWorkflowFamilyLabel(workflowFamily),
    sortOrder: Number(sortOrder || 9999),
  };
}
function findWorkflowAuthorityDefinitionForPermission(workflowFamily, permissionCode) {
  const normalizedWorkflowFamily = normalizeText(workflowFamily).toUpperCase();
  const normalizedPermissionCode = normalizeText(permissionCode).toLowerCase();
  if (!normalizedPermissionCode) {
    return null;
  }
  const definitions =
    WORKFLOW_AUTHORITY_CATALOG[normalizedWorkflowFamily] ||
    WORKFLOW_AUTHORITY_CATALOG.CROSS_WORKFLOW ||
    [];
  return (
    definitions.find((authority) => {
      const permissionCodes = [
        ...cloneList(authority?.requiredPermissionCodes),
        ...cloneList(authority?.anyPermissionCodes),
      ].map((value) => normalizeText(value).toLowerCase());
      return permissionCodes.includes(normalizedPermissionCode);
    }) || null
  );
}

function getWorkflowAuthorityCode(workflowFamily, permissionCode) {
  return findWorkflowAuthorityDefinitionForPermission(workflowFamily, permissionCode)?.code || "";
}

function getWorkflowAuthorityDisplayName(workflowFamily, permissionCode) {
  const authorityDefinition = findWorkflowAuthorityDefinitionForPermission(
    workflowFamily,
    permissionCode
  );
  return authorityDefinition?.displayName || normalizeText(permissionCode);
}

/**
 * Returns the display label for one access-model item type.
 */
export function getAccessModelTypeLabel(modelType) {
  const normalizedModelType = normalizeText(modelType);
  return ACCESS_MODEL_TYPE_LABELS[normalizedModelType] || normalizedModelType || "Access Model Item";
}

/**
 * Returns the display label for one workflow family code.
 */
export function getWorkflowFamilyLabel(workflowFamily) {
  const normalizedWorkflowFamily = normalizeText(workflowFamily);
  return (
    WORKFLOW_FAMILY_LABELS[normalizedWorkflowFamily] ||
    WORKFLOW_FAMILY_LABELS.CROSS_WORKFLOW
  );
}

/**
 * Returns the role-native authority definitions for one governed workflow
 * family. These definitions stay permission-first so explainability and
 * diagnostics can reason directly from assigned roles instead of package
 * coverage.
 */
export function listWorkflowAuthorityDefinitions(workflowFamily) {
  const normalizedWorkflowFamily = normalizeText(workflowFamily).toUpperCase();
  return cloneList(
    WORKFLOW_AUTHORITY_CATALOG[normalizedWorkflowFamily] ||
      WORKFLOW_AUTHORITY_CATALOG.CROSS_WORKFLOW
  ).map((authority) => ({
    ...authority,
    requiredPermissionCodes: cloneList(authority?.requiredPermissionCodes),
    anyPermissionCodes: cloneList(authority?.anyPermissionCodes),
    allowedStepScopes: cloneList(authority?.allowedStepScopes),
  }));
}

/**
 * Returns the UX metadata for one bootstrap handoff preset.
 */
export function getBootstrapHandoffPresetEntry(presetCode) {
  const normalizedPresetCode = normalizeBootstrapHandoffPresetCode(presetCode);
  const base = BOOTSTRAP_HANDOFF_PRESET_CATALOG[normalizedPresetCode] || null;
  const metadata = buildMetadataEntry({
    modelType: "assignment_preset",
    code: normalizedPresetCode,
    displayName: base?.displayName || normalizedPresetCode,
    description:
      base?.summary ||
      "Bootstrap preset. Review included composable roles before assigning it broadly.",
    category: base?.category || "bootstrap_setup",
    defaultScope: base?.scopeType || "",
    workflowFamily: base?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: base?.sortOrder || 9999,
  });

  return {
    ...metadata,
    summary: metadata.description,
    scopeType: base?.scopeType || "",
    roleCodes: cloneList(base?.roleCodes),
    assignmentRoleCodes: cloneList(base?.assignmentRoleCodes || base?.roleCodes),
    roleLabels: cloneList(base?.roleCodes).map(
      (roleCode) => getRoleCatalogEntry(roleCode).displayName
    ),
    optionalRoleCodes: cloneList(base?.optionalRoleCodes),
    optionalRoleLabels: cloneList(base?.optionalRoleCodes).map(
      (roleCode) => getRoleCatalogEntry(roleCode).displayName
    ),
  };
}

/**
 * Returns the UX metadata used to explain a role in admin surfaces.
 * `code` is the business-facing label while `technicalCode` keeps the runtime
 * identifier visible when it differs from the display label.
 */
export function getRoleCatalogEntry(roleOrCode) {
  const requestedRoleCode =
    typeof roleOrCode === "string"
      ? normalizeText(roleOrCode)
      : normalizeText(roleOrCode?.code || roleOrCode?.roleCode);
  if (isWorkflowPackageAssignmentRoleCode(requestedRoleCode)) {
    return buildManagedPackageRoleEntry(roleOrCode, requestedRoleCode);
  }
  const normalizedRoleCode = normalizeRoleCatalogCode(requestedRoleCode);
  const base = ROLE_CATALOG[normalizedRoleCode] || null;
  const displayCode =
    base?.code || normalizedRoleCode || requestedRoleCode || normalizeText(roleOrCode?.roleCode);
  const showTechnicalCode = Boolean(requestedRoleCode && requestedRoleCode !== displayCode);
  const metadata = buildMetadataEntry({
    modelType: "runtime_role",
    code: displayCode,
    displayName: displayCode,
    description:
      base?.summary ||
      "Tenant-local role. Review its permission set carefully before assigning it broadly.",
    category: base?.category || "custom",
    defaultScope: cloneList(base?.recommendedScopes)[0] || "",
    replacementLabel: base?.replacementLabel || "",
    workflowFamily: base?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder:
      typeof base?.sortOrder === "number"
        ? base.sortOrder
        : (Math.max(CATEGORY_ORDER.indexOf(base?.category || "custom"), 0) + 1) * 100,
  });

  return {
    ...metadata,
    runtimeCode: normalizedRoleCode || requestedRoleCode || displayCode,
    technicalCode: showTechnicalCode ? requestedRoleCode : "",
    summary: metadata.description,
    capabilities: cloneList(base?.capabilities).length
      ? cloneList(base?.capabilities)
      : ["Tenant-specific permissions"],
    recommendedScopes: cloneList(base?.recommendedScopes),
    companionOnly: Boolean(base?.companionOnly),
    companionNote: base?.companionNote || "",
  };
}

/**
 * Returns whether the supplied role exists only as a managed authority managed
 * authority role that should stay hidden from role-native recommendations.
 */
export function isPackageAuthorityOnlyRole(roleOrCode) {
  return Boolean(getRoleCatalogEntry(roleOrCode)?.packageAuthorityOnly);
}

/**
 * Sorts roles into a stable management order using category and sort-order metadata.
 */
export function sortRolesForManagement(roles) {
  const safeRoles = Array.isArray(roles) ? roles : [];
  return [...safeRoles].sort((left, right) => {
    const leftEntry = getRoleCatalogEntry(left);
    const rightEntry = getRoleCatalogEntry(right);
    const leftCategoryIndex = CATEGORY_ORDER.indexOf(leftEntry.category);
    const rightCategoryIndex = CATEGORY_ORDER.indexOf(rightEntry.category);
    if (leftCategoryIndex !== rightCategoryIndex) {
      return leftCategoryIndex - rightCategoryIndex;
    }
    if (leftEntry.sortOrder !== rightEntry.sortOrder) {
      return leftEntry.sortOrder - rightEntry.sortOrder;
    }
    return normalizeText(leftEntry.code).localeCompare(normalizeText(rightEntry.code));
  });
}

/**
 * Returns the business-facing label for one bootstrap handoff preset while
 * preserving the stored preset code separately in forms and payloads.
 */
export function getBootstrapHandoffPresetDisplayLabel(presetCode) {
  const entry = getBootstrapHandoffPresetEntry(presetCode);
  return entry.displayName || entry.code;
}

/**
 * Groups roles by the UI category used on admin role-management screens.
 */
export function groupRolesForManagement(roles) {
  const grouped = new Map();
  for (const role of sortRolesForManagement(roles)) {
    const entry = getRoleCatalogEntry(role);
    const key = entry.category;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: entry.categoryLabel,
        roles: [],
      });
    }
    grouped.get(key).roles.push(role);
  }
  return Array.from(grouped.values());
}

/**
 * Builds a human-readable scope label using lookup rows when available.
 */
export function buildScopeLabel(scopeType, scopeId, lookups = {}, tenantScopeId = null) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  const numericScopeId = Number(scopeId || 0);
  if (!numericScopeId) {
    return `${normalizedScopeType || "SCOPE"} #?`;
  }
  if (normalizedScopeType === "TENANT") {
    return numericScopeId === Number(tenantScopeId || 0)
      ? `Tenant #${numericScopeId}`
      : `Tenant #${numericScopeId}`;
  }

  const sourceRows =
    normalizedScopeType === "GROUP"
      ? lookups.groups
      : normalizedScopeType === "COUNTRY"
        ? lookups.countries
        : normalizedScopeType === "LEGAL_ENTITY"
          ? lookups.legalEntities
          : normalizedScopeType === "OPERATING_UNIT"
            ? lookups.operatingUnits
            : [];
  const matchedRow = (Array.isArray(sourceRows) ? sourceRows : []).find(
    (row) => Number(row.id) === numericScopeId
  );
  if (!matchedRow) {
    return `${normalizedScopeType} #${numericScopeId}`;
  }
  if (normalizedScopeType === "COUNTRY") {
    return `${matchedRow.iso2 || matchedRow.iso3 || numericScopeId} - ${matchedRow.name || ""}`.trim();
  }
  return `${matchedRow.code || numericScopeId} - ${matchedRow.name || ""}`.trim();
}

/**
 * Returns whether the supplied scope type matches the role's recommended assignment shape.
 */
export function isRecommendedScopeForRole(roleOrCode, scopeType) {
  const entry = getRoleCatalogEntry(roleOrCode);
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  if (!normalizedScopeType || entry.recommendedScopes.length === 0) {
    return true;
  }
  return entry.recommendedScopes.includes(normalizedScopeType);
}
