
function freezeList(values) {
  return Object.freeze(values);
}
function freezeStep(step) {
  return Object.freeze(step);
}
const CATEGORY_LABELS = Object.freeze({
  system: "System administration",
  composable: "Composable duty-boundary",
  scoped: "Scoped operations",
  readonly: "Read-only",
  business_label: "Business role label",
  package_authority: "Workflow package role",
  custom: "Custom tenant role",
});
const ACCESS_MODEL_TYPE_LABELS = Object.freeze({
  runtime_role: "Runtime Role",
  business_role: "Business Role",
  workflow_package: "Workflow Package",
  workflow_preset: "Workflow Preset",
  assignment_preset: "Assignment Preset",
});
const WORKFLOW_FAMILY_LABELS = Object.freeze({
  CROSS_WORKFLOW: "Cross-workflow",
  AP_DOCUMENT_POSTING: "AP Document Posting",
  LOCAL_CLOSE_PACK: "Local Close Pack",
  PERIOD_CLOSE: "Period Close",
  CONSOLIDATION_RUN: "Consolidation Run",
});
const BUSINESS_ROLE_CATEGORY_LABELS = Object.freeze({
  operating_unit_scope: "Operating unit scope",
  legal_entity_scope: "Legal entity scope",
  group_scope: "Group scope",
});
const WORKFLOW_PACKAGE_CATEGORY_LABELS = Object.freeze({
  shared_governance: "Shared governance",
  core_action: "Core action package",
  extension_package: "Extension package",
});
const WORKFLOW_PRESET_CATEGORY_LABELS = Object.freeze({
  baseline_preset: "Baseline preset",
  assisted_preset: "Assisted preset",
  controlled_preset: "Controlled preset",
  supervised_preset: "Supervised preset",
  executive_preset: "Executive preset",
  extension_preset: "Extension preset",
});
const ASSIGNMENT_PRESET_CATEGORY_LABELS = Object.freeze({
  bootstrap_setup: "Bootstrap setup",
});
const ACCESS_MODEL_SECTION_LABELS = Object.freeze({
  business_roles: "Business Roles",
  workflow_packages: "Workflow Packages",
  workflow_presets: "Workflow Presets",
});
const ACCESS_MODEL_SECTION_ORDER = Object.freeze({
  business_roles: 10,
  workflow_packages: 20,
  workflow_presets: 30,
});
const MODEL_CATEGORY_LABELS = Object.freeze({
  runtime_role: CATEGORY_LABELS,
  business_role: BUSINESS_ROLE_CATEGORY_LABELS,
  workflow_package: WORKFLOW_PACKAGE_CATEGORY_LABELS,
  workflow_preset: WORKFLOW_PRESET_CATEGORY_LABELS,
  assignment_preset: ASSIGNMENT_PRESET_CATEGORY_LABELS,
});
const ROLE_CATALOG_CODE_ALIASES = Object.freeze({
  CountryAPPoster: "CountryAPController",
});
const BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES = Object.freeze({
  EntitySetupManager: "EntityAPController",
  CountryFinanceSetupManager: "CountryAPApprover",
});
export const BUSINESS_ROLE_ASSIGNMENT_ROLE_PREFIX = "BUSINESS_ROLE__";
export const WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX = "WORKFLOW_PACKAGE__";
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
      "Companion authority for manual journal post, reversal, and period close. Pair it with a read-bearing accounting role.",
    capabilities: ["Manual posting", "Manual reversal", "Period close"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
    companionOnly: true,
    companionNote:
      "Pair with GLOperator or another read-bearing accounting role at the same or broader scope.",
    workflowFamily: "PERIOD_CLOSE",
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
  GroupReportingController: {
    category: "composable",
    summary:
      "Owns consolidation, intercompany, and group reporting responsibilities.",
    capabilities: ["Consolidation", "Intercompany control", "Group reporting"],
    recommendedScopes: ["GROUP"],
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 340,
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
  BranchInventoryOperator: {
    code: "Branch Inventory Operator",
    category: "scoped",
    summary:
      "Maintains branch-owned warehouses, materializes branch stock movements, and edits shared item cards from branch scope.",
    capabilities: ["Branch warehouse setup", "Stock movement handling", "Item-card maintenance"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 112,
  },
  BranchFixedAssetViewer: {
    code: "Branch Fixed Asset Viewer",
    category: "readonly",
    summary:
      "Reads branch-owned fixed-asset registers, categories, custodians, and reports without lifecycle write authority.",
    capabilities: ["Branch asset visibility", "Category lookup", "Custodian lookup"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 113,
  },
  BranchFixedAssetOperator: {
    code: "Branch Fixed Asset Operator",
    category: "scoped",
    summary:
      "Creates and updates branch-owned fixed-asset drafts while keeping posting, disposal, and depreciation governance at entity scope.",
    capabilities: ["Branch asset drafting", "Fixed-asset maintenance", "Custodian-aware updates"],
    recommendedScopes: ["OPERATING_UNIT"],
    sortOrder: 114,
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
      "Creates and updates entity warehouses, inventory movements, and shared item cards without broader GL master-data write authority.",
    capabilities: ["Entity warehouse setup", "Inventory operations", "Item-card maintenance"],
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
      "Operating-unit AP draft and operational-document role for creation, editing, and cancellation. Review and final posting stay separate.",
    capabilities: ["OU visibility", "Draft AP handling", "Operational documents"],
    recommendedScopes: ["OPERATING_UNIT"],
    replacementLabel: "Branch Accountant",
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 110,
  },
});
// Business roles stay separate from runtime roles because the plan explicitly
// requires human titles to remain non-authoritative helper labels.
const BUSINESS_ROLE_CATALOG = Object.freeze({
  BRANCH_ACCOUNTANT: Object.freeze({
    displayName: "Branch Accountant",
    description:
      "Branch-level finance operator who usually drafts and submits AP work and can support branch-assisted close preparation.",
    category: "operating_unit_scope",
    defaultScope: "OPERATING_UNIT",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-AP-DRAFT-SUBMIT"]),
    optionalPackageCodes: freezeList(["PKG-PC-READINESS"]),
    sortOrder: 110,
  }),
  BRANCH_MANAGER: Object.freeze({
    displayName: "Branch Manager",
    description:
      "Optional operating-unit reviewer or manager used when the tenant wants a branch-level review checkpoint.",
    category: "operating_unit_scope",
    defaultScope: "OPERATING_UNIT",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList([]),
    optionalPackageCodes: freezeList(["PKG-AP-APPROVE", "PKG-LC-REVIEW"]),
    sortOrder: 120,
  }),
  ENTITY_ACCOUNTANT: Object.freeze({
    displayName: "Entity Accountant",
    description:
      "Legal-entity accounting owner who usually reviews AP, prepares local close, and validates period-close readiness.",
    category: "legal_entity_scope",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-AP-APPROVE", "PKG-LC-PREPARE", "PKG-PC-READINESS"]),
    optionalPackageCodes: freezeList([]),
    sortOrder: 210,
  }),
  ENTITY_MANAGER: Object.freeze({
    displayName: "Entity Manager",
    description:
      "Legal-entity managerial approver used for review and controlled close checkpoints above day-to-day accounting work.",
    category: "legal_entity_scope",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-LC-REVIEW"]),
    optionalPackageCodes: freezeList(["PKG-AP-APPROVE", "PKG-PC-CLOSE"]),
    sortOrder: 220,
  }),
  ENTITY_CEO: Object.freeze({
    displayName: "Entity CEO",
    description:
      "Final legal-entity authority used for entity-level posting, close, and approval lock decisions.",
    category: "legal_entity_scope",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-LC-APPROVE-LOCK", "PKG-PC-CLOSE"]),
    optionalPackageCodes: freezeList(["PKG-AP-POST"]),
    sortOrder: 230,
  }),
  GROUP_CHECKER: Object.freeze({
    displayName: "Group Checker",
    description:
      "Group-level checker or reviewer who prepares consolidation work and can participate in controlled execution steps.",
    category: "group_scope",
    defaultScope: "GROUP",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-CON-PREPARE"]),
    optionalPackageCodes: freezeList(["PKG-CON-EXECUTE"]),
    sortOrder: 310,
  }),
  GROUP_APPROVER: Object.freeze({
    displayName: "Group Approver",
    description:
      "Group-level approver or finalizer used for consolidation finalization and selected controlled package handoffs.",
    category: "group_scope",
    defaultScope: "GROUP",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList(["PKG-CON-FINALIZE"]),
    optionalPackageCodes: freezeList(["PKG-CON-ADJUST", "PKG-CON-ELIM"]),
    sortOrder: 320,
  }),
  GROUP_CEO: Object.freeze({
    displayName: "Group CEO",
    description:
      "Executive group authority used when the tenant wants final consolidation signoff above the normal approver tier.",
    category: "group_scope",
    defaultScope: "GROUP",
    workflowFamily: "CROSS_WORKFLOW",
    starterPackageCodes: freezeList([]),
    optionalPackageCodes: freezeList(["PKG-CON-FINALIZE"]),
    sortOrder: 330,
  }),
});
const WORKFLOW_PACKAGE_CATALOG = Object.freeze({
  "PKG-WF-SETUP-ADMIN": Object.freeze({
    displayName: "Workflow Governance / Setup Admin",
    description:
      "Cross-workflow package for reading and editing workflow definitions, assignments, and approval policy setup.",
    category: "shared_governance",
    defaultScope: "TENANT",
    allowedScopes: freezeList(["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY"]),
    permissionCodes: freezeList([
      "workflow.definition.read",
      "workflow.definition.write",
      "workflow.assignment.read",
      "workflow.assignment.write",
      "approvals.policies.read",
      "approvals.policies.write",
    ]),
    workflowFamily: "CROSS_WORKFLOW",
    sortOrder: 10,
  }),
  "PKG-WF-QUEUE-VIEW": Object.freeze({
    displayName: "Workflow Governance / Queue Visibility",
    description:
      "Cross-workflow package for reading workflow definitions, assignments, and governed approval queues without setup authority.",
    category: "shared_governance",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY"]),
    permissionCodes: freezeList([
      "workflow.definition.read",
      "workflow.assignment.read",
      "approvals.requests.read",
    ]),
    workflowFamily: "CROSS_WORKFLOW",
    sortOrder: 20,
  }),
  "PKG-AP-VIEW": Object.freeze({
    displayName: "AP Documents / View",
    description:
      "Read package for governed AP documents, reporting, and audit surfaces without workflow action authority.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"]),
    permissionCodes: freezeList(["cari.doc.read", "cari.report.read", "cari.audit.read"]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 110,
  }),
  "PKG-AP-DRAFT-SUBMIT": Object.freeze({
    displayName: "AP Documents / Draft & Submit",
    description:
      "Maker package for creating, editing, submitting, and cancelling AP drafts before review or posting.",
    category: "core_action",
    defaultScope: "OPERATING_UNIT",
    allowedScopes: freezeList(["OPERATING_UNIT", "LEGAL_ENTITY"]),
    permissionCodes: freezeList([
      "cari.doc.read",
      "cari.doc.create",
      "cari.doc.update",
      "cari.doc.submit",
      "cari.doc.cancel",
    ]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 120,
  }),
  "PKG-AP-APPROVE": Object.freeze({
    displayName: "AP Documents / Approve",
    description:
      "Reviewer package for reading AP items and acting on approval requests without final posting rights.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList([
      "cari.doc.read",
      "approvals.policies.read",
      "approvals.requests.read",
      "approvals.requests.approve",
      "approvals.requests.reject",
    ]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 130,
  }),
  "PKG-AP-POST": Object.freeze({
    displayName: "AP Documents / Post",
    description:
      "Final-posting package for governed AP document posting at entity or country authority boundaries.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList(["cari.doc.read", "cari.doc.post"]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 140,
  }),
  "PKG-AP-REVERSE": Object.freeze({
    displayName: "AP Documents / Reverse",
    description:
      "Companion AP package for reversing already-posted documents without reopening draft authority.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList(["cari.doc.read", "cari.doc.reverse"]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 150,
  }),
  "PKG-AP-FX-OVERRIDE": Object.freeze({
    displayName: "AP Documents / FX Override",
    description:
      "Exceptional AP package for foreign-currency override decisions at entity or country scope.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList(["cari.doc.read", "cari.fx.override"]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 160,
  }),
  "PKG-AP-POST-GROUP": Object.freeze({
    displayName: "AP Documents / Group Post",
    description:
      "Clean future extension for tenants that want AP posting resolved at group scope without broad controller coverage.",
    category: "extension_package",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([]),
    workflowFamily: "AP_DOCUMENT_POSTING",
    sortOrder: 170,
    plannedExtension: true,
    extensionNote:
      "Do not enable until the backend package and entitlement model supports group-scoped AP posting.",
  }),
  "PKG-LC-VIEW": Object.freeze({
    displayName: "Local Close Pack / View",
    description:
      "Read package for local close pack visibility across entity, country, or group reporting layers.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY", "GROUP"]),
    permissionCodes: freezeList(["ouclose.read"]),
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 210,
  }),
  "PKG-LC-PREPARE": Object.freeze({
    displayName: "Local Close Pack / Prepare & Submit",
    description:
      "Maker package for preparing local close work, submitting it, and requesting reopen when needed.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY"]),
    permissionCodes: freezeList([
      "ouclose.read",
      "ouclose.prepare",
      "ouclose.submit",
      "ouclose.request_reopen",
    ]),
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 220,
  }),
  "PKG-LC-REVIEW": Object.freeze({
    displayName: "Local Close Pack / Review",
    description:
      "Review package for local close checkpoints before final approval and lock decisions.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList(["ouclose.read", "ouclose.review"]),
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 230,
  }),
  "PKG-LC-APPROVE-LOCK": Object.freeze({
    displayName: "Local Close Pack / Approve & Lock",
    description:
      "Final local close package for approval and locking at the supervising accounting boundary.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList(["ouclose.read", "ouclose.approve", "ouclose.lock"]),
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 240,
  }),
  "PKG-LC-REOPEN-ADMIN": Object.freeze({
    displayName: "Local Close Pack / Reopen & Admin",
    description:
      "Administrative local close package for reopen, override, and exceptional governance intervention.",
    category: "core_action",
    defaultScope: "COUNTRY",
    allowedScopes: freezeList(["COUNTRY", "GROUP"]),
    permissionCodes: freezeList([
      "ouclose.read",
      "ouclose.reopen",
      "ouclose.override_post_lock",
      "ouclose.admin",
    ]),
    workflowFamily: "LOCAL_CLOSE_PACK",
    sortOrder: 250,
  }),
  "PKG-PC-READINESS": Object.freeze({
    displayName: "Period Close / Readiness View",
    description:
      "Readiness package for reviewing fiscal periods, ledgers, journals, and reporting before close authority is used.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY", "GROUP"]),
    permissionCodes: freezeList([
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.report.local.read",
      "gl.report.ledger.read",
      "gl.report.statement.read",
    ]),
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 310,
  }),
  "PKG-PC-CLOSE": Object.freeze({
    displayName: "Period Close / Approve & Close",
    description:
      "Close authority package for approving and closing periods once readiness review is complete.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList([
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.report.local.read",
      "gl.report.ledger.read",
      "gl.report.statement.read",
      "gl.period.close",
    ]),
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 320,
  }),
  "PKG-PC-REOPEN": Object.freeze({
    displayName: "Period Close / Reopen",
    description:
      "Reopen authority package for reversing a completed period close when corrections are needed. Separate from close authority so reopen can be restricted to senior roles.",
    category: "core_action",
    defaultScope: "LEGAL_ENTITY",
    allowedScopes: freezeList(["LEGAL_ENTITY", "COUNTRY"]),
    permissionCodes: freezeList([
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.period.close",
      "gl.period.reopen",
    ]),
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 330,
  }),
  "PKG-PC-ADMIN": Object.freeze({
    displayName: "Period Close / Admin",
    description:
      "Administrative authority package for period close overrides and operational controls. Combines close, reopen, and admin permissions for power-admin use cases.",
    category: "core_action",
    defaultScope: "COUNTRY",
    allowedScopes: freezeList(["COUNTRY", "GROUP"]),
    permissionCodes: freezeList([
      "org.fiscal_period.read",
      "gl.book.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.period.close",
      "gl.period.reopen",
      "gl.period.admin",
    ]),
    workflowFamily: "PERIOD_CLOSE",
    sortOrder: 340,
  }),
  "PKG-CON-VIEW": Object.freeze({
    displayName: "Consolidation / View",
    description:
      "Read package for group consolidation inputs, runs, and reporting without operational run authority.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([
      "consolidation.group.read",
      "consolidation.coa_mapping.read",
      "consolidation.elimination_placeholder.read",
      "consolidation.run.read",
      "consolidation.report.trial_balance.read",
      "consolidation.report.summary.read",
      "consolidation.report.balance_sheet.read",
      "consolidation.report.income_statement.read",
    ]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 410,
  }),
  "PKG-CON-PREPARE": Object.freeze({
    displayName: "Consolidation / Prepare Run",
    description:
      "Preparation package for opening consolidation runs and readying source inputs before execution.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([
      "consolidation.group.read",
      "consolidation.coa_mapping.read",
      "consolidation.elimination_placeholder.read",
      "consolidation.run.read",
      "consolidation.run.create",
    ]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 420,
  }),
  "PKG-CON-EXECUTE": Object.freeze({
    displayName: "Consolidation / Execute Run",
    description:
      "Execution package for running consolidation once inputs and mappings are ready.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList(["consolidation.run.read", "consolidation.run.execute"]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 430,
  }),
  "PKG-CON-ADJUST": Object.freeze({
    displayName: "Consolidation / Post Adjustments",
    description:
      "Controlled consolidation package for posting group-level adjustment entries before finalization.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([
      "consolidation.run.read",
      "consolidation.adjustment.create",
      "consolidation.adjustment.post",
    ]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 440,
  }),
  "PKG-CON-ELIM": Object.freeze({
    displayName: "Consolidation / Post Eliminations",
    description:
      "Controlled consolidation package for posting elimination entries before final group signoff.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([
      "consolidation.run.read",
      "consolidation.elimination.create",
      "consolidation.elimination.post",
    ]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 450,
  }),
  "PKG-CON-FINALIZE": Object.freeze({
    displayName: "Consolidation / Finalize",
    description:
      "Final consolidation package for closing and finalizing the group run.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList(["consolidation.run.read", "consolidation.run.finalize"]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 460,
  }),
  "PKG-CON-SETUP": Object.freeze({
    displayName: "Consolidation / Setup Admin",
    description:
      "Administrative package for group structures, mappings, eliminations, and intercompany setup.",
    category: "core_action",
    defaultScope: "GROUP",
    allowedScopes: freezeList(["GROUP"]),
    permissionCodes: freezeList([
      "consolidation.group.read",
      "consolidation.group.upsert",
      "consolidation.group_member.upsert",
      "consolidation.coa_mapping.read",
      "consolidation.coa_mapping.upsert",
      "consolidation.elimination_placeholder.read",
      "consolidation.elimination_placeholder.upsert",
      "intercompany.flag.read",
      "intercompany.flag.upsert",
      "intercompany.pair.upsert",
    ]),
    workflowFamily: "CONSOLIDATION_RUN",
    sortOrder: 470,
  }),
});
const HELPER_BUNDLE_LABELS = Object.freeze({
  "close.operator": "Close operator bundle (close.operator)",
  "close.reviewer": "Close reviewer bundle (close.reviewer)",
  "gl.readonly": "GL read-only bundle (gl.readonly)",
  "gl.posting": "GL posting bundle (gl.posting)",
});
// These runtime mappings are explainability-only. They document how the
// package catalog is sourced from today's seeded roles and helper bundles
// without turning those source rows into the primary assignment model.
const WORKFLOW_PACKAGE_RUNTIME_METADATA = Object.freeze({
  "PKG-WF-SETUP-ADMIN": Object.freeze({
    runtimeMappingLabel: "SystemAdmin setup authority",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["SystemAdmin"]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-WF-QUEUE-VIEW": Object.freeze({
    runtimeMappingLabel: "SystemAdmin + APApprover source roles",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["SystemAdmin", "APApprover"]),
    runtimeNotes: freezeList([
      "Queue visibility is currently shared across setup/admin roles and the AP approval-engine helper role.",
    ]),
  }),
  "PKG-AP-VIEW": Object.freeze({
    runtimeMappingLabel: "Shared AP read source roles",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList([
      "BranchOperator",
      "OUAPSubmitter",
      "EntityAPController",
      "CountryAPApprover",
      "CountryAPPoster",
    ]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-AP-DRAFT-SUBMIT": Object.freeze({
    runtimeMappingLabel: "Branch / OU / entity AP submitter source roles",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList([
      "BranchOperator",
      "OUAPSubmitter",
      "EntityAPController",
    ]),
    runtimeNotes: freezeList([
      "BranchOperator now covers branch draft-and-submit access directly; OUAPSubmitter remains compatible with older runtime assignments.",
    ]),
  }),
  "PKG-AP-APPROVE": Object.freeze({
    runtimeMappingLabel: "AP Reviewer + APApprover source roles",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["CountryAPApprover", "APApprover"]),
    runtimeNotes: freezeList([
      "Approval-engine request authority still rides on APApprover in the current runtime model.",
    ]),
  }),
  "PKG-AP-POST": Object.freeze({
    runtimeMappingLabel: "AP Poster runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["CountryAPPoster"]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-AP-REVERSE": Object.freeze({
    runtimeMappingLabel: "AP Poster runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["CountryAPPoster"]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-AP-FX-OVERRIDE": Object.freeze({
    runtimeMappingLabel: "No standalone AP FX override role yet",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList([]),
    runtimeNotes: freezeList([
      "Tenants do not ship a dedicated AP FX override runtime role yet. Keep this as a catalog slice until the entitlement model is narrowed cleanly.",
    ]),
  }),
  "PKG-AP-POST-GROUP": Object.freeze({
    runtimeMappingLabel: "Planned extension only",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList([]),
    runtimeNotes: freezeList([
      "Enable this package only when the backend group-post extension ships.",
    ]),
  }),
  "PKG-LC-VIEW": Object.freeze({
    runtimeMappingLabel: "Shared local-close read source",
    helperBundleCodes: freezeList(["close.operator", "close.reviewer"]),
    runtimeRoleCodes: freezeList(["LocalClosePreparer", "LocalCloseReviewer"]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-LC-PREPARE": Object.freeze({
    runtimeMappingLabel: "LocalClosePreparer runtime role",
    helperBundleCodes: freezeList(["close.operator"]),
    runtimeRoleCodes: freezeList(["LocalClosePreparer"]),
    runtimeNotes: freezeList([]),
  }),
  "PKG-LC-REVIEW": Object.freeze({
    runtimeMappingLabel: "LocalCloseReviewer runtime role",
    helperBundleCodes: freezeList(["close.reviewer"]),
    runtimeRoleCodes: freezeList(["LocalCloseReviewer"]),
    runtimeNotes: freezeList([
      "Current LocalCloseReviewer also carries approve, lock, reopen, and admin powers. The package model narrows that behavior for the new UI.",
    ]),
  }),
  "PKG-LC-APPROVE-LOCK": Object.freeze({
    runtimeMappingLabel: "LocalCloseReviewer runtime role",
    helperBundleCodes: freezeList(["close.reviewer"]),
    runtimeRoleCodes: freezeList(["LocalCloseReviewer"]),
    runtimeNotes: freezeList([
      "Current LocalCloseReviewer bundles review, approve, lock, and reopen/admin into one broader runtime role.",
    ]),
  }),
  "PKG-LC-REOPEN-ADMIN": Object.freeze({
    runtimeMappingLabel: "LocalCloseReviewer runtime role",
    helperBundleCodes: freezeList(["close.reviewer"]),
    runtimeRoleCodes: freezeList(["LocalCloseReviewer"]),
    runtimeNotes: freezeList([
      "Current LocalCloseReviewer is broader than this clean reopen/admin slice and still includes review plus final lock powers.",
    ]),
  }),
  "PKG-PC-READINESS": Object.freeze({
    runtimeMappingLabel: "GL readiness source roles",
    helperBundleCodes: freezeList(["gl.readonly"]),
    runtimeRoleCodes: freezeList([
      "BranchOperator",
      "GLOperator",
      "GLPostingAuthority",
      "GroupReportingController",
    ]),
    runtimeNotes: freezeList([
      "The current runtime model exposes readiness visibility through broader accounting roles rather than a dedicated period-close reviewer package.",
    ]),
  }),
  "PKG-PC-CLOSE": Object.freeze({
    runtimeMappingLabel: "GLPostingAuthority companion role",
    helperBundleCodes: freezeList(["gl.posting"]),
    runtimeRoleCodes: freezeList(["GLPostingAuthority"]),
    runtimeNotes: freezeList([
      "The current runtime role is a broad manual-posting companion, not a full period-close governance family yet.",
    ]),
  }),
  "PKG-PC-REOPEN": Object.freeze({
    runtimeMappingLabel: "GLPostingAuthority period reopen authority",
    helperBundleCodes: freezeList(["gl.posting", "gl.period_governance"]),
    runtimeRoleCodes: freezeList(["GLPostingAuthority"]),
    runtimeNotes: freezeList([
      "Period reopen was previously guarded by the same gl.period.close permission. The new gl.period.reopen permission separates reopen authority from close authority.",
    ]),
  }),
  "PKG-PC-ADMIN": Object.freeze({
    runtimeMappingLabel: "GLPostingAuthority period admin authority",
    helperBundleCodes: freezeList(["gl.period_governance"]),
    runtimeRoleCodes: freezeList(["GLPostingAuthority"]),
    runtimeNotes: freezeList([
      "The gl.period.admin permission keeps period administration separate from close execution.",
    ]),
  }),
  "PKG-CON-VIEW": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList(["gl.readonly"]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController is broader than the clean consolidation package split shown in the new catalog.",
    ]),
  }),
  "PKG-CON-PREPARE": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController still bundles prepare, execute, adjust, eliminate, and finalize-style authority together.",
    ]),
  }),
  "PKG-CON-EXECUTE": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController is broader than this clean execute-run package.",
    ]),
  }),
  "PKG-CON-ADJUST": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController is broader than this controlled adjustment package.",
    ]),
  }),
  "PKG-CON-ELIM": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController is broader than this controlled elimination package.",
    ]),
  }),
  "PKG-CON-FINALIZE": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current GroupReportingController remains broader than the clean finalize-only package target.",
    ]),
  }),
  "PKG-CON-SETUP": Object.freeze({
    runtimeMappingLabel: "GroupReportingController runtime role",
    helperBundleCodes: freezeList([]),
    runtimeRoleCodes: freezeList(["GroupReportingController"]),
    runtimeNotes: freezeList([
      "Current consolidation setup authority still rides on a broader runtime role instead of a dedicated setup-only package.",
    ]),
  }),
});
const WORKFLOW_PRESET_CATALOG = Object.freeze({
  AP_LEAN_ENTITY: Object.freeze({
    displayName: "AP / Lean Entity",
    description:
      "Three-step AP flow with branch drafting, entity approval, and entity posting for lean entity teams.",
    category: "baseline_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "AP_DOCUMENT_POSTING",
    typicalActorCodes: freezeList(["BRANCH_ACCOUNTANT", "ENTITY_ACCOUNTANT"]),
    requiredPackageCodes: freezeList(["PKG-AP-DRAFT-SUBMIT", "PKG-AP-APPROVE", "PKG-AP-POST"]),
    usesExtension: false,
    sortOrder: 110,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Create / Edit / Submit",
        scopeType: "OPERATING_UNIT",
        requiredPackageCode: "PKG-AP-DRAFT-SUBMIT",
        eligibleBusinessRoleCodes: freezeList(["BRANCH_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Approve",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-APPROVE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Post",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-POST",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  AP_STANDARD_ENTITY: Object.freeze({
    displayName: "AP / Standard Entity",
    description:
      "Three-step AP flow with branch drafting, entity review, and final entity-ceo posting authority.",
    category: "baseline_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "AP_DOCUMENT_POSTING",
    typicalActorCodes: freezeList(["BRANCH_ACCOUNTANT", "ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "ENTITY_CEO"]),
    requiredPackageCodes: freezeList(["PKG-AP-DRAFT-SUBMIT", "PKG-AP-APPROVE", "PKG-AP-POST"]),
    usesExtension: false,
    sortOrder: 120,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Create / Edit / Submit",
        scopeType: "OPERATING_UNIT",
        requiredPackageCode: "PKG-AP-DRAFT-SUBMIT",
        eligibleBusinessRoleCodes: freezeList(["BRANCH_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Approve",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-APPROVE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Post",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-POST",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  AP_GROUP_CONTROLLED_POST: Object.freeze({
    displayName: "AP / Group-Controlled Post",
    description:
      "AP flow that lifts the final posting action to group authority through a clean extension package instead of controller reuse.",
    category: "extension_preset",
    defaultScope: "GROUP",
    workflowFamily: "AP_DOCUMENT_POSTING",
    typicalActorCodes: freezeList(["BRANCH_ACCOUNTANT", "ENTITY_ACCOUNTANT", "GROUP_APPROVER"]),
    requiredPackageCodes: freezeList([
      "PKG-AP-DRAFT-SUBMIT",
      "PKG-AP-APPROVE",
      "PKG-AP-POST-GROUP",
    ]),
    usesExtension: true,
    extensionNote:
      "Requires the optional group-scoped AP posting package before the final step can be activated.",
    sortOrder: 130,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Create / Edit / Submit",
        scopeType: "OPERATING_UNIT",
        requiredPackageCode: "PKG-AP-DRAFT-SUBMIT",
        eligibleBusinessRoleCodes: freezeList(["BRANCH_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Approve",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-APPROVE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Post",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-AP-POST-GROUP",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  LOCAL_CLOSE_STANDARD: Object.freeze({
    displayName: "Local Close / Standard",
    description:
      "Entity-owned local close flow with preparation, review, and final approval-lock at legal-entity scope.",
    category: "baseline_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "LOCAL_CLOSE_PACK",
    typicalActorCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "ENTITY_CEO"]),
    requiredPackageCodes: freezeList(["PKG-LC-PREPARE", "PKG-LC-REVIEW", "PKG-LC-APPROVE-LOCK"]),
    usesExtension: false,
    sortOrder: 210,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare & Submit",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Review",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-REVIEW",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_MANAGER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Approve & Lock",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-APPROVE-LOCK",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  LOCAL_CLOSE_BRANCH_ASSISTED: Object.freeze({
    displayName: "Local Close / Branch-Assisted",
    description:
      "Local close flow where branch accountants help prepare the working pack before entity review and final lock.",
    category: "assisted_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "LOCAL_CLOSE_PACK",
    typicalActorCodes: freezeList(["BRANCH_ACCOUNTANT", "ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "ENTITY_CEO"]),
    requiredPackageCodes: freezeList(["PKG-LC-PREPARE", "PKG-LC-REVIEW", "PKG-LC-APPROVE-LOCK"]),
    usesExtension: false,
    sortOrder: 220,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare working pack",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["BRANCH_ACCOUNTANT", "ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Review",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-REVIEW",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Approve & Lock",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-APPROVE-LOCK",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  LOCAL_CLOSE_GROUP_SUPERVISED: Object.freeze({
    displayName: "Local Close / Group-Supervised",
    description:
      "Local close flow that lifts the final supervision layer above the legal entity when the tenant wants centralized oversight.",
    category: "supervised_preset",
    defaultScope: "GROUP",
    workflowFamily: "LOCAL_CLOSE_PACK",
    typicalActorCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "GROUP_APPROVER"]),
    requiredPackageCodes: freezeList(["PKG-LC-PREPARE", "PKG-LC-REVIEW", "PKG-LC-APPROVE-LOCK"]),
    usesExtension: true,
    extensionNote:
      "Country supervision can reuse the shipped package scopes, but true group supervision needs a companion scope extension.",
    sortOrder: 230,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare & Submit",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Review",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-REVIEW",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_MANAGER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Approve & Lock",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-LC-APPROVE-LOCK",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  PERIOD_CLOSE_STANDARD: Object.freeze({
    displayName: "Period Close / Standard",
    description:
      "Two-step period close with readiness review followed by entity-managed close authority.",
    category: "baseline_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "PERIOD_CLOSE",
    typicalActorCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "ENTITY_CEO"]),
    requiredPackageCodes: freezeList(["PKG-PC-READINESS", "PKG-PC-CLOSE"]),
    usesExtension: false,
    sortOrder: 310,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Review readiness",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-READINESS",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Close period",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-CLOSE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_MANAGER", "ENTITY_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  PERIOD_CLOSE_CONTROLLED: Object.freeze({
    displayName: "Period Close / Controlled",
    description:
      "Three-step period close with an explicit internal-approval handoff before final entity close.",
    category: "controlled_preset",
    defaultScope: "LEGAL_ENTITY",
    workflowFamily: "PERIOD_CLOSE",
    typicalActorCodes: freezeList(["ENTITY_ACCOUNTANT", "ENTITY_MANAGER", "ENTITY_CEO"]),
    requiredPackageCodes: freezeList(["PKG-PC-READINESS", "PKG-PC-CLOSE"]),
    usesExtension: false,
    sortOrder: 320,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Review readiness",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-READINESS",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Internal approval",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-CLOSE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_MANAGER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Final close",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-CLOSE",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  PERIOD_CLOSE_GROUP_SUPERVISED: Object.freeze({
    displayName: "Period Close / Group-Supervised",
    description:
      "Period close flow that centralizes the final close decision above the legal entity when a supervisory extension is enabled.",
    category: "supervised_preset",
    defaultScope: "GROUP",
    workflowFamily: "PERIOD_CLOSE",
    typicalActorCodes: freezeList(["ENTITY_ACCOUNTANT", "GROUP_APPROVER"]),
    requiredPackageCodes: freezeList(["PKG-PC-READINESS", "PKG-PC-CLOSE"]),
    usesExtension: true,
    extensionNote:
      "The current family ships with legal-entity and country close scopes. Group-supervised final close needs a later extension.",
    sortOrder: 330,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Review readiness",
        scopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-READINESS",
        eligibleBusinessRoleCodes: freezeList(["ENTITY_ACCOUNTANT"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Final close",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-PC-CLOSE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  CONSOLIDATION_STANDARD: Object.freeze({
    displayName: "Consolidation / Standard",
    description:
      "Three-step consolidation run with prepare, execute, and finalize actions at group scope.",
    category: "baseline_preset",
    defaultScope: "GROUP",
    workflowFamily: "CONSOLIDATION_RUN",
    typicalActorCodes: freezeList(["GROUP_CHECKER", "GROUP_APPROVER"]),
    requiredPackageCodes: freezeList(["PKG-CON-PREPARE", "PKG-CON-EXECUTE", "PKG-CON-FINALIZE"]),
    usesExtension: false,
    sortOrder: 410,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare run",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Execute run",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-EXECUTE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER", "GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Finalize",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-FINALIZE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  CONSOLIDATION_CONTROLLED: Object.freeze({
    displayName: "Consolidation / Controlled",
    description:
      "Controlled consolidation flow that separates adjustments, eliminations, and finalization for tighter group governance.",
    category: "controlled_preset",
    defaultScope: "GROUP",
    workflowFamily: "CONSOLIDATION_RUN",
    typicalActorCodes: freezeList(["GROUP_CHECKER", "GROUP_APPROVER"]),
    requiredPackageCodes: freezeList([
      "PKG-CON-PREPARE",
      "PKG-CON-ADJUST",
      "PKG-CON-ELIM",
      "PKG-CON-FINALIZE",
    ]),
    usesExtension: false,
    sortOrder: 420,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare run",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Post adjustments",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-ADJUST",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Post eliminations",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-ELIM",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 4,
        actionLabel: "Finalize",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-FINALIZE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
  CONSOLIDATION_EXECUTIVE: Object.freeze({
    displayName: "Consolidation / Executive",
    description:
      "Consolidation flow that reserves final signoff for group-executive authority above the normal approver layer.",
    category: "executive_preset",
    defaultScope: "GROUP",
    workflowFamily: "CONSOLIDATION_RUN",
    typicalActorCodes: freezeList(["GROUP_CHECKER", "GROUP_APPROVER", "GROUP_CEO"]),
    requiredPackageCodes: freezeList(["PKG-CON-PREPARE", "PKG-CON-EXECUTE", "PKG-CON-FINALIZE"]),
    usesExtension: false,
    sortOrder: 430,
    steps: freezeList([
      freezeStep({
        stepNo: 1,
        actionLabel: "Prepare run",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-PREPARE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CHECKER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 2,
        actionLabel: "Execute run",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-EXECUTE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_APPROVER"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
      freezeStep({
        stepNo: 3,
        actionLabel: "Finalize",
        scopeType: "GROUP",
        requiredPackageCode: "PKG-CON-FINALIZE",
        eligibleBusinessRoleCodes: freezeList(["GROUP_CEO"]),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
      }),
    ]),
  }),
});
export const BOOTSTRAP_HANDOFF_PRESET_CATALOG = Object.freeze({
  EntityAPController: Object.freeze({
    code: "EntityAPController",
    displayName: "AP Submitter Setup Lead",
    summary:
      "Bootstrap preset for one legal-entity AP submitter setup lead using bounded composable operator roles.",
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
  CountryAPApprover: Object.freeze({
    code: "CountryAPApprover",
    displayName: "AP Reviewer Setup Lead",
    summary:
      "Bootstrap preset for one country-level AP reviewer setup lead using bounded composable AP, treasury, payroll, and close-review roles.",
    workflowFamily: "AP_DOCUMENT_POSTING",
    category: "bootstrap_setup",
    sortOrder: 20,
    scopeType: "COUNTRY",
    roleCodes: freezeList([
      "CountryAPApprover",
      "CountryAPPoster",
      "APApprover",
      "GLOperator",
      "TreasuryApprover",
      "PayrollApprover",
      "LocalCloseReviewer",
    ]),
    optionalRoleCodes: freezeList(["GLPostingAuthority"]),
  }),
});
const CATEGORY_ORDER = Object.freeze([
  "composable",
  "scoped",
  "readonly",
  "business_label",
  "package_authority",
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
function normalizeBootstrapHandoffPresetCode(presetCode) {
  const normalizedPresetCode = normalizeText(presetCode);
  return BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES[normalizedPresetCode] || normalizedPresetCode;
}
function normalizeBusinessRoleCode(roleCode) {
  return normalizeText(roleCode).toUpperCase();
}
function getBusinessRoleAssignmentBusinessRoleCode(roleCode) {
  const normalizedRoleCode = normalizeText(roleCode).toUpperCase();
  if (!normalizedRoleCode.startsWith(BUSINESS_ROLE_ASSIGNMENT_ROLE_PREFIX)) {
    return "";
  }
  const businessRoleCode = normalizedRoleCode.slice(
    BUSINESS_ROLE_ASSIGNMENT_ROLE_PREFIX.length
  );
  return BUSINESS_ROLE_CATALOG[businessRoleCode] ? businessRoleCode : "";
}
function getWorkflowPackageAssignmentPackageCode(roleCode) {
  const normalizedRoleCode = normalizeText(roleCode).toUpperCase();
  if (!normalizedRoleCode.startsWith(WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX)) {
    return "";
  }
  const packageCode = normalizedRoleCode.slice(
    WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX.length
  );
  return WORKFLOW_PACKAGE_CATALOG[packageCode] ? packageCode : "";
}
function normalizeWorkflowPackageCode(packageCode) {
  return normalizeText(packageCode).toUpperCase();
}
function normalizeWorkflowPresetCode(presetCode) {
  return normalizeText(presetCode).toUpperCase();
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
function getBusinessRoleDisplayName(roleCode) {
  const normalizedRoleCode = normalizeBusinessRoleCode(roleCode);
  return BUSINESS_ROLE_CATALOG[normalizedRoleCode]?.displayName || normalizedRoleCode;
}
function buildBusinessRoleAssignmentRoleEntry(roleCode) {
  const businessRoleCode = getBusinessRoleAssignmentBusinessRoleCode(roleCode);
  const businessRoleEntry = businessRoleCode
    ? getBusinessRoleCatalogEntry(businessRoleCode)
    : null;
  const runtimeCode =
    businessRoleCode || normalizeText(roleCode).toUpperCase() || "BUSINESS_ROLE_LABEL";
  const metadata = buildMetadataEntry({
    modelType: "runtime_role",
    code: businessRoleEntry?.displayName || runtimeCode,
    displayName: businessRoleEntry?.displayName || runtimeCode,
    description:
      businessRoleEntry?.description ||
      "Non-authoritative business role label. Assign workflow packages separately.",
    category: "business_label",
    defaultScope: businessRoleEntry?.defaultScope || "",
    replacementLabel: "",
    workflowFamily: businessRoleEntry?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: (businessRoleEntry?.sortOrder || 9999) + 1,
  });

  return {
    ...metadata,
    runtimeCode,
    technicalCode: runtimeCode,
    summary:
      "Business role label only. It does not grant package or permission authority by itself.",
    capabilities: ["Label only", "No direct authority", "Packages assigned separately"],
    recommendedScopes: metadata.defaultScope ? [metadata.defaultScope] : [],
    companionOnly: false,
    companionNote:
      "Assign workflow packages separately. This label is non-authoritative by design.",
    businessRoleCode,
    nonAuthoritative: true,
    businessLabelOnly: true,
  };
}
function buildWorkflowPackageAssignmentRoleEntry(roleCode) {
  const workflowPackageCode = getWorkflowPackageAssignmentPackageCode(roleCode);
  const workflowPackageEntry = workflowPackageCode
    ? getWorkflowPackageCatalogEntry(workflowPackageCode)
    : null;
  const runtimeCode =
    workflowPackageCode ||
    normalizeText(roleCode).toUpperCase() ||
    "WORKFLOW_PACKAGE_ROLE";
  const metadata = buildMetadataEntry({
    modelType: "runtime_role",
    code: workflowPackageEntry?.displayName || runtimeCode,
    displayName: workflowPackageEntry?.displayName || runtimeCode,
    description:
      workflowPackageEntry?.description ||
      "Managed workflow package role. Keep its permissions aligned to the package definition.",
    category: "package_authority",
    defaultScope: workflowPackageEntry?.defaultScope || "",
    replacementLabel: "",
    workflowFamily: workflowPackageEntry?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: (workflowPackageEntry?.sortOrder || 9999) + 2,
  });

  return {
    ...metadata,
    runtimeCode,
    technicalCode: runtimeCode,
    summary:
      "Managed workflow package role. It carries the exact package permission set for direct package assignment.",
    capabilities:
      cloneList(workflowPackageEntry?.permissionCodes).length > 0
        ? cloneList(workflowPackageEntry?.permissionCodes)
        : ["Managed package authority"],
    recommendedScopes: cloneList(workflowPackageEntry?.allowedScopes),
    companionOnly: false,
    companionNote:
      "Assign and remove this role through workflow package UX so the permission set stays aligned to the package definition.",
    workflowPackageCode,
    packageAuthorityOnly: true,
    managedPackageRole: true,
    permissionCodes: cloneList(workflowPackageEntry?.permissionCodes),
    allowedScopes: cloneList(workflowPackageEntry?.allowedScopes),
    plannedExtension: Boolean(workflowPackageEntry?.plannedExtension),
  };
}
function getWorkflowPackageDisplayName(packageCode) {
  const normalizedPackageCode = normalizeWorkflowPackageCode(packageCode);
  return WORKFLOW_PACKAGE_CATALOG[normalizedPackageCode]?.displayName || normalizedPackageCode;
}
function getWorkflowPresetDisplayName(presetCode) {
  const normalizedPresetCode = normalizeWorkflowPresetCode(presetCode);
  return WORKFLOW_PRESET_CATALOG[normalizedPresetCode]?.displayName || normalizedPresetCode;
}
function getHelperBundleLabel(bundleCode) {
  const normalizedBundleCode = normalizeText(bundleCode);
  return HELPER_BUNDLE_LABELS[normalizedBundleCode] || normalizedBundleCode;
}
function getRuntimeRoleMappingLabel(roleCode) {
  const normalizedRoleCode = normalizeText(roleCode);
  const roleEntry = getRoleCatalogEntry(normalizedRoleCode);
  if (!normalizedRoleCode) {
    return "";
  }
  if (roleEntry.displayName && roleEntry.displayName !== normalizedRoleCode) {
    return `${roleEntry.displayName} / ${normalizedRoleCode}`;
  }
  return normalizedRoleCode;
}
function getPresetCodesUsingPackage(packageCode) {
  const normalizedPackageCode = normalizeWorkflowPackageCode(packageCode);
  return Object.keys(WORKFLOW_PRESET_CATALOG).filter((presetCode) =>
    cloneList(WORKFLOW_PRESET_CATALOG[presetCode]?.requiredPackageCodes).includes(normalizedPackageCode)
  );
}

function getPresetCodesUsingBusinessRole(roleCode) {
  const normalizedRoleCode = normalizeBusinessRoleCode(roleCode);
  return Object.keys(WORKFLOW_PRESET_CATALOG)
    .filter((presetCode) => {
      const preset = WORKFLOW_PRESET_CATALOG[presetCode];
      const matchesTypicalActors = cloneList(preset?.typicalActorCodes)
        .map(normalizeBusinessRoleCode)
        .includes(normalizedRoleCode);
      if (matchesTypicalActors) {
        return true;
      }
      return cloneList(preset?.steps).some((step) =>
        cloneList(step?.eligibleBusinessRoleCodes)
          .map(normalizeBusinessRoleCode)
          .includes(normalizedRoleCode)
      );
    })
    .sort((leftCode, rightCode) =>
      sortCatalogEntries(WORKFLOW_PRESET_CATALOG[leftCode], WORKFLOW_PRESET_CATALOG[rightCode])
    );
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
 * Returns the UX metadata for one bootstrap handoff preset.
 * Preset aliases resolve to their canonical AP-facing preset codes.
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
 * Returns whether the supplied runtime role code is one of the dedicated
 * zero-permission business label roles used by the UI-2B assignment flow.
 */
export function isBusinessRoleAssignmentRoleCode(roleCode) {
  return Boolean(getBusinessRoleAssignmentBusinessRoleCode(roleCode));
}

/**
 * Returns whether the supplied runtime role code is one of the managed
 * workflow-package roles used by the UI-2C direct package assignment flow.
 */
export function isWorkflowPackageAssignmentRoleCode(roleCode) {
  return Boolean(getWorkflowPackageAssignmentPackageCode(roleCode));
}

/**
 * Returns the dedicated zero-permission runtime role code used to persist one
 * business-role label assignment safely inside the existing role-assignment
 * system.
 */
export function getBusinessRoleAssignmentRuntimeRoleCode(roleCode) {
  const normalizedRoleCode = normalizeBusinessRoleCode(roleCode);
  return BUSINESS_ROLE_CATALOG[normalizedRoleCode]
    ? `${BUSINESS_ROLE_ASSIGNMENT_ROLE_PREFIX}${normalizedRoleCode}`
    : "";
}

/**
 * Returns the dedicated runtime role code used to persist one workflow
 * package assignment with the exact package permission set.
 */
export function getWorkflowPackageAssignmentRuntimeRoleCode(packageCode) {
  const normalizedPackageCode = normalizeWorkflowPackageCode(packageCode);
  return WORKFLOW_PACKAGE_CATALOG[normalizedPackageCode]
    ? `${WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX}${normalizedPackageCode}`
    : "";
}

/**
 * Builds the non-authoritative tenant-role payload used when a business label
 * role must be created before assignment.
 */
export function getBusinessRoleAssignmentRoleDefinition(roleCode) {
  const normalizedRoleCode = normalizeBusinessRoleCode(roleCode);
  const businessRoleEntry = getBusinessRoleCatalogEntry(normalizedRoleCode);
  const runtimeRoleCode = getBusinessRoleAssignmentRuntimeRoleCode(normalizedRoleCode);
  if (!runtimeRoleCode || !businessRoleEntry.active) {
    return null;
  }

  return {
    businessRoleCode: normalizedRoleCode,
    roleCode: runtimeRoleCode,
    roleName: `Business Role Label / ${businessRoleEntry.displayName}`,
    displayName: businessRoleEntry.displayName,
    defaultScope: businessRoleEntry.defaultScope,
    description:
      "Non-authoritative business role label. Assign workflow packages separately.",
  };
}

/**
 * Builds the managed runtime-role payload used when a direct workflow package
 * assignment needs an exact package-backed role created or repaired.
 */
export function getWorkflowPackageAssignmentRoleDefinition(packageCode) {
  const normalizedPackageCode = normalizeWorkflowPackageCode(packageCode);
  const workflowPackageEntry = getWorkflowPackageCatalogEntry(normalizedPackageCode);
  const runtimeRoleCode =
    getWorkflowPackageAssignmentRuntimeRoleCode(normalizedPackageCode);
  if (!runtimeRoleCode || !workflowPackageEntry.code) {
    return null;
  }

  return {
    packageCode: normalizedPackageCode,
    roleCode: runtimeRoleCode,
    roleName: `Workflow Package / ${workflowPackageEntry.displayName}`,
    displayName: workflowPackageEntry.displayName,
    defaultScope: workflowPackageEntry.defaultScope,
    description: workflowPackageEntry.description,
    allowedScopes: cloneList(workflowPackageEntry.allowedScopes),
    permissionCodes: cloneList(workflowPackageEntry.permissionCodes),
    plannedExtension: Boolean(workflowPackageEntry.plannedExtension),
    extensionNote: workflowPackageEntry.extensionNote || "",
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
  if (isBusinessRoleAssignmentRoleCode(requestedRoleCode)) {
    return buildBusinessRoleAssignmentRoleEntry(requestedRoleCode);
  }
  if (isWorkflowPackageAssignmentRoleCode(requestedRoleCode)) {
    return buildWorkflowPackageAssignmentRoleEntry(requestedRoleCode);
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
 * Returns one business-role catalog entry from the plan-defined admin model.
 */
export function getBusinessRoleCatalogEntry(roleCode) {
  const normalizedRoleCode = normalizeBusinessRoleCode(roleCode);
  const base = BUSINESS_ROLE_CATALOG[normalizedRoleCode] || null;
  const metadata = buildMetadataEntry({
    modelType: "business_role",
    code: normalizedRoleCode,
    displayName: base?.displayName || normalizedRoleCode,
    description:
      base?.description ||
      "Business-facing title used only as an admin label. Assign workflow packages separately.",
    category: base?.category || "unclassified",
    defaultScope: base?.defaultScope || "",
    replacementLabel: "",
    workflowFamily: base?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: base?.sortOrder || 9999,
  });

  const starterPackageCodes = cloneList(base?.starterPackageCodes);
  const optionalPackageCodes = cloneList(base?.optionalPackageCodes);
  const usedInPresetCodes = getPresetCodesUsingBusinessRole(normalizedRoleCode);
  const hiddenFromPicker = Boolean(base?.hiddenFromPicker);
  return {
    ...metadata,
    starterPackageCodes,
    starterPackageLabels: starterPackageCodes.map(getWorkflowPackageDisplayName),
    optionalPackageCodes,
    optionalPackageLabels: optionalPackageCodes.map(getWorkflowPackageDisplayName),
    usedInPresetCodes,
    usedInPresetLabels: usedInPresetCodes.map(getWorkflowPresetDisplayName),
    hiddenFromPicker,
    statusLabel: hiddenFromPicker ? "Hidden" : "Active",
    active: Boolean(base),
  };
}

/**
 * Returns all business-role metadata entries in stable admin sort order.
 */
export function listBusinessRoleCatalogEntries() {
  return Object.keys(BUSINESS_ROLE_CATALOG)
    .map((roleCode) => getBusinessRoleCatalogEntry(roleCode))
    .sort(sortCatalogEntries);
}

/**
 * Returns one workflow-package catalog entry from the plan-defined admin model.
 */
export function getWorkflowPackageCatalogEntry(packageCode) {
  const normalizedPackageCode = normalizeWorkflowPackageCode(packageCode);
  const base = WORKFLOW_PACKAGE_CATALOG[normalizedPackageCode] || null;
  const runtimeMapping = WORKFLOW_PACKAGE_RUNTIME_METADATA[normalizedPackageCode] || null;
  const metadata = buildMetadataEntry({
    modelType: "workflow_package",
    code: normalizedPackageCode,
    displayName: base?.displayName || normalizedPackageCode,
    description:
      base?.description ||
      "Workflow package metadata is not defined yet for this code.",
    category: base?.category || "unclassified",
    defaultScope: base?.defaultScope || "",
    replacementLabel: "",
    workflowFamily: base?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: base?.sortOrder || 9999,
  });

  const usedInPresetCodes = getPresetCodesUsingPackage(normalizedPackageCode);
  const helperBundleCodes = cloneList(runtimeMapping?.helperBundleCodes);
  const runtimeRoleCodes = cloneList(runtimeMapping?.runtimeRoleCodes);
  const runtimeNotes = cloneList(runtimeMapping?.runtimeNotes);
  return {
    ...metadata,
    allowedScopes: cloneList(base?.allowedScopes),
    permissionCodes: cloneList(base?.permissionCodes),
    permissionCount: cloneList(base?.permissionCodes).length,
    runtimeMappingLabel:
      runtimeMapping?.runtimeMappingLabel ||
      "No current runtime mapping is documented for this package yet.",
    helperBundleCodes,
    helperBundleLabels: helperBundleCodes.map(getHelperBundleLabel),
    runtimeRoleCodes,
    runtimeRoleLabels: runtimeRoleCodes.map(getRuntimeRoleMappingLabel),
    runtimeNotes,
    usedInPresetCodes,
    usedInPresetLabels: usedInPresetCodes.map(getWorkflowPresetDisplayName),
    plannedExtension: Boolean(base?.plannedExtension),
    extensionNote: base?.extensionNote || "",
  };
}

/**
 * Returns all workflow-package metadata entries in stable admin sort order.
 */
export function listWorkflowPackageCatalogEntries() {
  return Object.keys(WORKFLOW_PACKAGE_CATALOG)
    .map((packageCode) => getWorkflowPackageCatalogEntry(packageCode))
    .sort(sortCatalogEntries);
}

/**
 * Resolves the clean workflow-package catalog entries explained by the
 * supplied runtime-role codes. This is a UI explainability helper for admin
 * screens that need package coverage from current runtime-role sources.
 */
export function resolveWorkflowPackagesForRuntimeRoles(roleCodes) {
  const requestedRoleCodes = Array.isArray(roleCodes) ? roleCodes : [];
  const directPackageEntries = requestedRoleCodes
    .map((roleCode) => getWorkflowPackageAssignmentPackageCode(roleCode))
    .filter(Boolean)
    .map((packageCode) => getWorkflowPackageCatalogEntry(packageCode));
  const normalizedRoleCodes = new Set(
    requestedRoleCodes
      .map((roleCode) => normalizeRoleCatalogCode(roleCode))
      .filter(Boolean)
  );
  if (normalizedRoleCodes.size === 0 && directPackageEntries.length === 0) {
    return [];
  }

  const mappedEntries = listWorkflowPackageCatalogEntries().filter((entry) =>
    cloneList(entry?.runtimeRoleCodes).some((roleCode) =>
      normalizedRoleCodes.has(normalizeRoleCatalogCode(roleCode))
    )
  );

  return Array.from(
    new Map(
      [...directPackageEntries, ...mappedEntries]
        .filter(Boolean)
        .map((entry) => [entry.code, entry])
    ).values()
  ).sort(sortCatalogEntries);
}

/**
 * Returns one workflow-preset catalog entry with step metadata ready for future catalog tabs.
 */
export function getWorkflowPresetCatalogEntry(presetCode) {
  const normalizedPresetCode = normalizeWorkflowPresetCode(presetCode);
  const base = WORKFLOW_PRESET_CATALOG[normalizedPresetCode] || null;
  const metadata = buildMetadataEntry({
    modelType: "workflow_preset",
    code: normalizedPresetCode,
    displayName: base?.displayName || normalizedPresetCode,
    description:
      base?.description ||
      "Workflow preset metadata is not defined yet for this code.",
    category: base?.category || "unclassified",
    defaultScope: base?.defaultScope || "",
    replacementLabel: "",
    workflowFamily: base?.workflowFamily || "CROSS_WORKFLOW",
    sortOrder: base?.sortOrder || 9999,
  });

  const requiredPackageCodes = cloneList(base?.requiredPackageCodes);
  const typicalActorCodes = cloneList(base?.typicalActorCodes);
  const draft = Boolean(base?.draft);
  const steps = cloneList(base?.steps).map((step) => ({
    stepNo: Number(step?.stepNo || 0),
    actionLabel: step?.actionLabel || "",
    scopeType: step?.scopeType || "",
    requiredPackageCode: step?.requiredPackageCode || "",
    requiredPackageLabel: getWorkflowPackageDisplayName(step?.requiredPackageCode),
    eligibleBusinessRoleCodes: cloneList(step?.eligibleBusinessRoleCodes),
    eligibleBusinessRoleLabels: cloneList(step?.eligibleBusinessRoleCodes).map(
      getBusinessRoleDisplayName
    ),
    minApproverCount: Number(step?.minApproverCount || 1),
    allowSelfApprove: Boolean(step?.allowSelfApprove),
    escalationAfterHours:
      typeof step?.escalationAfterHours === "number" ? step.escalationAfterHours : null,
  }));

  return {
    ...metadata,
    primaryScope: metadata.defaultScope,
    stepCount: steps.length,
    draft,
    statusLabel: draft ? "Draft" : "Active",
    typicalActorCodes,
    typicalActorLabels: typicalActorCodes.map(getBusinessRoleDisplayName),
    requiredPackageCodes,
    requiredPackageLabels: requiredPackageCodes.map(getWorkflowPackageDisplayName),
    usesExtension: Boolean(base?.usesExtension),
    usesExtensionLabel: base?.usesExtension ? "Yes" : "No",
    extensionNote: base?.extensionNote || "",
    steps,
  };
}

/**
 * Returns all workflow-preset metadata entries in stable admin sort order.
 */
export function listWorkflowPresetCatalogEntries() {
  return Object.keys(WORKFLOW_PRESET_CATALOG)
    .map((presetCode) => getWorkflowPresetCatalogEntry(presetCode))
    .sort(sortCatalogEntries);
}

/**
 * Returns the access-model catalog sections so tabs can render business roles,
 * workflow packages, and workflow presets from one shared source.
 */
export function listAccessModelCatalogSections() {
  return [
    {
      key: "business_roles",
      label: ACCESS_MODEL_SECTION_LABELS.business_roles,
      modelType: "business_role",
      modelTypeLabel: getAccessModelTypeLabel("business_role"),
      description:
        "Human-facing titles only. Workflow authority still comes from assigned packages.",
      sortOrder: ACCESS_MODEL_SECTION_ORDER.business_roles,
      entries: listBusinessRoleCatalogEntries(),
    },
    {
      key: "workflow_packages",
      label: ACCESS_MODEL_SECTION_LABELS.workflow_packages,
      modelType: "workflow_package",
      modelTypeLabel: getAccessModelTypeLabel("workflow_package"),
      description:
        "Reusable action packages that workflow steps bind to across AP, close, and consolidation.",
      sortOrder: ACCESS_MODEL_SECTION_ORDER.workflow_packages,
      entries: listWorkflowPackageCatalogEntries(),
    },
    {
      key: "workflow_presets",
      label: ACCESS_MODEL_SECTION_LABELS.workflow_presets,
      modelType: "workflow_preset",
      modelTypeLabel: getAccessModelTypeLabel("workflow_preset"),
      description:
        "Ready-made business flows admins can preview, clone, and later customize.",
      sortOrder: ACCESS_MODEL_SECTION_ORDER.workflow_presets,
      entries: listWorkflowPresetCatalogEntries(),
    },
  ].sort(sortCatalogEntries);
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
