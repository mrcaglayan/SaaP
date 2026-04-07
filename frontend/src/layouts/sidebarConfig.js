import { LOCAL_REPORT_SIDEBAR_ITEMS } from "../reporting/localReportConfig.js";

const ROLE_PERMISSIONS_PAGE_PERMISSIONS = [
  "security.role.read",
  "security.permission.read",
  "security.role.upsert",
  "security.role_permissions.assign",
];
const ACCESS_MODEL_PAGE_PERMISSIONS = ROLE_PERMISSIONS_PAGE_PERMISSIONS;

const USER_ASSIGNMENTS_PAGE_PERMISSIONS = [
  "security.role_assignment.read",
  "security.role_assignment.upsert",
];
const BRANCH_OPERATOR_MANAGEMENT_PAGE_PERMISSIONS = [
  "security.user_admin.local",
  "security.user_admin.entity",
];

const SCOPE_ASSIGNMENTS_PAGE_PERMISSIONS = [
  "security.data_scope.read",
  "security.data_scope.upsert",
  "security.role_assignment.read",
];
const ROLE_MIGRATIONS_PAGE_PERMISSIONS = ["security.role.read"];
const ACCESS_DEBUGGER_PAGE_PERMISSIONS = ["security.role_assignment.read"];
const COMPLIANCE_REPORTS_PAGE_PERMISSIONS = [
  "security.audit.report.generate",
  "security.audit.report.export",
];
const FIELD_VISIBILITY_POLICIES_PAGE_PERMISSIONS = [
  "security.field_visibility.read",
  "security.field_visibility.write",
];
const APPROVAL_DELEGATIONS_PAGE_PERMISSIONS = [
  "approvals.policies.read",
  "approvals.policies.write",
];
const TEMPORARY_OPERATIONAL_COVERAGE_PAGE_PERMISSIONS = [
  "security.operational_coverage.read",
  "security.operational_coverage.request",
  "security.operational_coverage.review",
  "security.operational_coverage.revoke",
];

const AUDIT_LOGS_PAGE_PERMISSIONS = ["security.audit.read"];
const SENSITIVE_DATA_AUDIT_PAGE_PERMISSIONS = [
  "security.sensitive_data.audit.read",
];
const OPS_DASHBOARD_PAGE_PERMISSIONS = ["ops.dashboard.read"];
const OPS_EXCEPTION_WORKBENCH_PAGE_PERMISSIONS = ["ops.exceptions.read"];
const OPS_RETENTION_PAGE_PERMISSIONS = [
  "ops.retention.read",
  "ops.export_snapshot.read",
];
const COMPANY_SETTINGS_PAGE_PERMISSIONS = ["onboarding.company.setup"];
const ORG_SETTINGS_PAGE_PERMISSIONS = [
  "org.tree.read",
  "org.fiscal_calendar.read",
];
const ENTITY_ACTIVATION_WORKSPACE_PAGE_PERMISSIONS = [
  "org.tree.read",
  "org.fiscal_calendar.read",
  "org.fiscal_period.read",
  "gl.book.read",
  "gl.coa.read",
  "gl.account.read",
  "org.operating_unit.upsert",
  "org.shareholder.upsert",
  "org.shareholder.capital_fulfillment.upsert",
  "bank.accounts.read",
  "cash.register.read",
  "ouclose.read",
];
const GL_SETUP_PAGE_PERMISSIONS = [
  "gl.book.read",
  "gl.coa.read",
  "gl.account.read",
  "gl.book.upsert",
  "gl.coa.upsert",
  "gl.account.upsert",
  "gl.account_mapping.upsert",
];
const WORKFLOW_SETUP_PAGE_PERMISSIONS = [
  "workflow.definition.read",
  "workflow.definition.write",
  "workflow.assignment.read",
  "workflow.assignment.write",
];
const RECLASS_PAGE_PERMISSIONS = [
  "org.tree.read",
  "gl.book.read",
  "gl.account.read",
  "org.fiscal_period.read",
  "gl.trial_balance.read",
  "gl.journal.create",
  "gl.journal.read",
];
const JOURNAL_PAGE_PERMISSIONS = [
  "gl.journal.read",
  "gl.journal.create",
  "gl.journal.post",
  "gl.journal.reverse",
  "gl.trial_balance.read",
  "gl.period.close",
];
const INTERCOMPANY_RECONCILIATION_PAGE_PERMISSIONS = [
  "intercompany.reconcile.run",
];
const CONSOLIDATION_REPORT_PAGE_PERMISSIONS = [
  "consolidation.run.read",
  "consolidation.report.balance_sheet.read",
  "consolidation.report.income_statement.read",
];
const FX_RATE_PAGE_PERMISSIONS = ["fx.rate.read", "fx.rate.bulk_upsert"];
const TAX_SETUP_PAGE_PERMISSIONS = [
  "org.tree.read",
  "onboarding.company.setup",
];
const CONSOLIDATION_SETUP_PAGE_PERMISSIONS = [
  "consolidation.group.read",
  "consolidation.group.upsert",
  "consolidation.group_member.upsert",
  "consolidation.coa_mapping.read",
  "consolidation.coa_mapping.upsert",
  "consolidation.elimination_placeholder.read",
  "consolidation.elimination_placeholder.upsert",
  "consolidation.run.read",
  "consolidation.run.create",
  "consolidation.run.execute",
  "consolidation.run.finalize",
];
export const sidebarItems = [
  {
    type: "link",
    label: "Dashboard",
    to: "/app",
    end: true,
    icon: "dashboard",
    implemented: true,
  },
  {
    type: "section",
    title: "Donem Islemleri",
    icon: "spark",
    matchPrefix: "/app/donem-islemleri",
    items: [
      {
        label: "Acilis Fisi Olustur",
        to: "/app/acilis-fisi",
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Kasa",
    icon: "vault",
    items: [
      {
        label: "Odemeler",
        to: "/app/tediye-islemleri",
        requiredPermissions: ["cash.txn.read"],
        implemented: true,
      },
      {
        label: "Tahsilat",
        to: "/app/tahsilat-islemleri",
        requiredPermissions: ["cash.txn.read"],
        implemented: true,
      },
      {
        label: "Kasa Oturumlari",
        to: "/app/kasa-oturumlari",
        requiredPermissions: ["cash.register.read"],
        implemented: true,
      },
      {
        label: "Kasa Tanimlari",
        to: "/app/kasa-tanimlari",
        requiredPermissions: ["cash.register.read"],
        implemented: true,
      },
      {
        label: "Kasa Transit Transferleri",
        to: "/app/kasa-transit-transferleri",
        requiredPermissions: ["cash.txn.read"],
        implemented: true,
      },
      {
        label: "Kasa Kur Degisimleri",
        to: "/app/kasa-kur-degisimleri",
        requiredPermissions: ["cash.txn.read"],
        implemented: true,
      },
      {
        label: "Kasa Kur Raporlari",
        to: "/app/kasa-kur-raporlari",
        requiredPermissions: ["cash.report.read"],
        implemented: true,
      },
      {
        label: "Kasa Kur Ops Dashboard",
        to: "/app/kasa-kur-ops-dashboard",
        requiredPermissions: ["cash.report.read"],
        implemented: true,
      },
      {
        label: "Kasa Istisnalari",
        to: "/app/kasa-istisnalari",
        requiredPermissions: ["cash.report.read"],
        implemented: true,
      },
      {
        label: "Kasa Islemleri",
        to: "/app/kasa-islemleri",
        requiredPermissions: ["cash.txn.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Yevmiye Kayitlari",
    icon: "journal",
    matchPrefix: "/app/yevmiye-kayitlari",
    items: [
      {
        label: "Mahsup",
        to: "/app/mahsup-islemleri",
        requiredPermissions: JOURNAL_PAGE_PERMISSIONS,
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Banka Islemleri",
    icon: "bank",
    matchPrefix: "/app/banka-islemleri",
    items: [
      {
        label: "Banka Tanimla",
        to: "/app/banka-tanimla",
        requiredPermissions: ["bank.accounts.read"],
        implemented: true,
      },
      {
        label: "Banka Ekstre Ice Aktar",
        to: "/app/banka-ekstre-ice-aktar",
        requiredPermissions: ["bank.statements.import"],
        implemented: true,
      },
      {
        label: "Banka Ekstre Kuyrugu",
        to: "/app/banka-ekstre-kuyrugu",
        requiredPermissions: ["bank.statements.read"],
        implemented: true,
      },
      {
        label: "Banka Mutabakat",
        to: "/app/banka-mutabakat",
        requiredPermissions: ["bank.reconcile.read"],
        implemented: true,
      },
      {
        label: "Banka Onaylari",
        to: "/app/banka-onaylar",
        requiredPermissions: [
          "bank.approvals.policies.read",
          "bank.approvals.requests.read",
        ],
        implemented: true,
      },
      {
        label: "Banka Islemleri",
        to: "/app/banka-islemleri",
        requiredPermissions: ["bank.statements.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Satinalma",
    icon: "journal",
    items: [
      {
        label: "Alis Faturalari",
        to: "/app/alis-faturalari",
        requiredPermissions: ["cari.doc.read"],
        implemented: true,
      },
      {
        label: "Tedarikci Kartlari",
        to: "/app/tedarikci-kartlari",
        requiredPermissions: ["cari.card.read"],
        implemented: true,
      },
      {
        label: "Tedarikci Odemeler",
        to: "/app/tedarikci-odemeler",
        requiredPermissions: [
          "cari.settlement.apply",
          "cari.settlement.reverse",
          "cari.bank.attach",
          "cari.bank.apply",
        ],
        implemented: true,
      },
      {
        label: "Tedarikci Bakiyeleri",
        to: "/app/tedarikci-raporlari?report=balances",
        requiredPermissions: ["cari.report.read"],
        implemented: true,
      },
      {
        label: "Tedarikci Raporlari",
        to: "/app/tedarikci-raporlari",
        requiredPermissions: ["cari.report.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Satis",
    icon: "report",
    items: [
      {
        label: "Satis Faturalari",
        to: "/app/satis-faturalari",
        requiredPermissions: ["cari.doc.read"],
        implemented: true,
      },
      {
        label: "Musteri Kartlari",
        to: "/app/musteri-kartlari",
        requiredPermissions: ["cari.card.read"],
        implemented: true,
      },
      {
        label: "Musteri Tahsilatlar",
        to: "/app/musteri-tahsilatlar",
        requiredPermissions: [
          "cari.settlement.apply",
          "cari.settlement.reverse",
          "cari.bank.attach",
          "cari.bank.apply",
        ],
        implemented: true,
      },
      {
        label: "Musteri Bakiyeleri",
        to: "/app/musteri-raporlari?report=balances",
        requiredPermissions: ["cari.report.read"],
        implemented: true,
      },
      {
        label: "Musteri Raporlari",
        to: "/app/musteri-raporlari",
        requiredPermissions: ["cari.report.read"],
        implemented: true,
      },
      {
        label: "Sozlesmeler",
        to: "/app/contracts",
        requiredPermissions: ["contract.read"],
        implemented: true,
      },
      {
        label: "Donemsellik ve Tahakkuklar",
        to: "/app/gelecek-yillar-gelirleri",
        requiredPermissions: [
          "revenue.schedule.read",
          "revenue.run.read",
          "revenue.report.read",
        ],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Odeme Islemleri",
    icon: "bank",
    matchPrefix: "/app/odeme-batchleri",
    items: [
      {
        label: "Odeme Batchleri",
        to: "/app/odeme-batchleri",
        requiredPermissions: ["payments.batch.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Bordro Islemleri",
    icon: "company",
    matchPrefix: "/app/payroll",
    items: [
      {
        label: "Bordro Runlari",
        to: "/app/payroll-runs",
        requiredPermissions: ["payroll.runs.read"],
        implemented: true,
      },
      {
        label: "Bordro Import",
        to: "/app/payroll-runs/import",
        requiredPermissions: ["payroll.runs.import"],
        implemented: true,
      },
      {
        label: "Bordro Mappingleri",
        to: "/app/payroll-mappings",
        requiredPermissions: ["payroll.mappings.read"],
        implemented: true,
      },
      {
        label: "Bordro Ownership",
        to: "/app/payroll-ownership",
        requiredPermissions: ["payroll.ownership.read"],
        implemented: true,
      },
      {
        label: "Bordro Liabilities",
        to: "/app/payroll-liabilities",
        requiredPermissions: ["payroll.liabilities.read"],
        implemented: true,
      },
      {
        label: "Bordro Beneficiaries",
        to: "/app/payroll-beneficiaries",
        requiredPermissions: ["payroll.beneficiary.read"],
        implemented: true,
      },
      {
        label: "Bordro Kapanis Kontrolleri",
        to: "/app/payroll-close-controls",
        requiredPermissions: ["payroll.close.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Stoklar",
    icon: "box",
    matchPrefix: "/app/stoklar",
    items: [
      {
        label: "Stok Karti Olustur",
        to: "/app/stok-karti-olustur",
        requiredPermissions: ["item.card.upsert"],
        implemented: true,
      },
      {
        label: "Stok Yansitma Islemleri",
        to: "/app/stok-yansitma-islemleri",
        requiredPermissions: ["inventory.read"],
        implemented: true,
      },
      {
        label: "Stok Transferleri",
        to: "/app/stok-transferleri",
        requiredPermissions: ["inventory.read"],
        implemented: true,
      },
      {
        label: "Stok Maliyet Voucherleri",
        to: "/app/stok-maliyet-voucherleri",
        requiredPermissions: ["inventory.read"],
        implemented: true,
      },
      {
        label: "Stok Karti Listesi",
        to: "/app/stok-karti-listesi",
        requiredPermissions: ["item.card.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Demirbaslar",
    icon: "inventory",
    matchPrefix: "/app/demirbas",
    items: [
      {
        label: "Demirbas Karti Listesi",
        to: "/app/demirbas-karti-listesi",
        requiredPermissions: ["fixed_assets.read"],
        implemented: true,
      },
      {
        label: "Demirbas Karti Olustur",
        to: "/app/demirbas-karti-olustur",
        requiredPermissions: ["fixed_assets.upsert"],
        implemented: true,
      },
      {
        label: "Demirbas Alim Islemleri",
        to: "/app/demirbas-alim-islemleri",
        requiredPermissions: ["fixed_assets.read"],
        implemented: true,
      },
      {
        label: "Demirbas Satis Islemleri",
        to: "/app/demirbas-satis-islemleri",
        requiredPermissions: ["fixed_assets.read"],
        implemented: true,
      },
      {
        label: "Demirbas Ops Dashboard",
        to: "/app/demirbas-ops-dashboard",
        requiredPermissions: [
          "fixed_assets.read",
          "fixed_assets.depreciation.run",
        ],
        implemented: true,
      },
      {
        label: "Amortisman Islemleri",
        to: "/app/demirbas-amortisman-islemleri",
        requiredPermissions: ["fixed_assets.depreciation.run"],
        implemented: true,
      },
      {
        label: "Demirbas Raporu",
        to: "/app/demirbas-raporu",
        requiredPermissions: ["fixed_assets.report.read"],
        implemented: true,
      },
      {
        label: "Demirbas Ayarlari",
        to: "/app/ayarlar/demirbas-ayarlari",
        requiredPermissions: ["fixed_assets.settings.read"],
        implemented: true,
      },
      {
        label: "Demirbas Zimmetlileri",
        to: "/app/ayarlar/demirbas-zimmetlileri",
        requiredPermissions: ["fixed_assets.custodian.read"],
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Donem Sonu Islemler",
    icon: "calendar",
    matchPrefix: "/app/donem-sonu-islemler",
    items: [
      {
        type: "section",
        title: "Aysonu \u0130\u015flemler",
        icon: "calendar",
        matchPrefix: "/app/donem-sonu-islemler/aylik",
        items: [
          {
            label: "De\u011ferleme \u0130\u015flemleri",
            to: "/app/donem-sonu-islemler/aylik/degerleme-islemleri",
          },
          {
            label: "Amortisman Islemleri",
            to: "/app/donem-sonu-islemler/aylik/amortisman-islemleri",
          },
          {
            label: "Beyanname Islemleri",
            to: "/app/donem-sonu-islemler/aylik/beyanname-islemleri",
          },
          {
            label: "Intercompany Mutabakat",
            to: "/app/donem-sonu-islemler/aylik/intercompany-mutabakat",
            requiredPermissions: INTERCOMPANY_RECONCILIATION_PAGE_PERMISSIONS,
            implemented: true,
          },
        ],
      },
      {
        type: "section",
        title: "Y\u0131lsonu \u0130\u015flemler",
        icon: "calendar",
        matchPrefix: "/app/donem-sonu-islemler/yillik",
        items: [
          {
            label: "Envanter Islemleri",
            to: "/app/donem-sonu-islemler/yillik/envanter-islemleri",
          },
          {
            label: "Kapanis Islemleri",
            to: "/app/donem-sonu-islemler/yillik/kapanis-islemleri",
            implemented: true,
          },
          {
            label: "Yerel Kapanis Paketleri",
            to: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
            requiredPermissions: ["ouclose.read"],
            implemented: true,
          },
          {
            label: "Yansitma Islemleri",
            to: "/app/donem-sonu-islemler/yillik/yansitma-islemleri",
          },
          {
            label: "Konsolidasyon Raporlari",
            to: "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari",
            requiredPermissions: CONSOLIDATION_REPORT_PAGE_PERMISSIONS,
            implemented: true,
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Raporlar",
    icon: "report",
    matchPrefix: "/app/raporlar",
    items: [
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.generalLedger,
        to: "/app/defter-i-kebir",
      },
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.subsidiaryLedger,
        to: "/app/muavin",
      },
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.cariControlReconciliation,
        to: "/app/cari-kontrol-mutabakati",
      },
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.balanceSheet,
        to: "/app/bilanco",
      },
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.incomeStatement,
        to: "/app/gelir-tablosu",
      },
      {
        label: "Stok Raporu",
        to: "/app/stok-raporu",
      },
      {
        ...LOCAL_REPORT_SIDEBAR_ITEMS.trialBalance,
        to: "/app/mizan-raporu",
      },
    ],
  },
  {
    type: "section",
    title: "Ayarlar",
    icon: "settings",
    matchPrefix: "/app/ayarlar",
    items: [
      {
        label: "Delegasyonlarim",
        to: "/app/ayarlar/delegasyonlarim",
        implemented: true,
      },
      {
        label: "Yerel Kullanici Yonetimi",
        to: "/app/ayarlar/sube-operatorleri",
        requiredPermissions: BRANCH_OPERATOR_MANAGEMENT_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Erisim Modeli",
        to: "/app/ayarlar/rbac/access-model",
        requiredPermissions: ACCESS_MODEL_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Roller ve Yetkiler",
        to: "/app/ayarlar/rbac/roles-permissions",
        requiredPermissions: ROLE_PERMISSIONS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Kullanici Rol Atamalari",
        to: "/app/ayarlar/rbac/user-assignments",
        requiredPermissions: USER_ASSIGNMENTS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Scope Atamalari",
        to: "/app/ayarlar/rbac/scope-assignments",
        requiredPermissions: SCOPE_ASSIGNMENTS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Alan Gorunurluk Politikalari",
        to: "/app/ayarlar/rbac/field-visibility-policies",
        requiredPermissions: FIELD_VISIBILITY_POLICIES_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Rol Gecisleri",
        to: "/app/ayarlar/rbac/role-migrations",
        requiredPermissions: ROLE_MIGRATIONS_PAGE_PERMISSIONS,
        adminUiStateKey: "roleMigrations",
        implemented: true,
      },
      {
        label: "Onay Delegasyonlari",
        to: "/app/ayarlar/rbac/delegations",
        requiredPermissions: APPROVAL_DELEGATIONS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Gecici Operasyonel Kapsama",
        to: "/app/ayarlar/rbac/temporary-coverage",
        requiredPermissions: TEMPORARY_OPERATIONAL_COVERAGE_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Erisim Hata Ayiklayici",
        to: "/app/ayarlar/rbac/access-debugger",
        requiredPermissions: ACCESS_DEBUGGER_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Uyum Raporlari",
        to: "/app/ayarlar/rbac/compliance-reports",
        requiredPermissions: COMPLIANCE_REPORTS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "RBAC Denetim Loglari",
        to: "/app/ayarlar/rbac/audit-logs",
        requiredPermissions: AUDIT_LOGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Ham Denetim Loglari",
        to: "/app/ayarlar/rbac/raw-audit-logs",
        requiredPermissions: AUDIT_LOGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Cari Denetim Izleri",
        to: "/app/ayarlar/cari-denetim",
        requiredPermissions: ["cari.audit.read"],
        implemented: true,
      },
      {
        label: "Hassas Veri Denetim Kayitlari",
        to: "/app/ayarlar/rbac/sensitive-data-audit",
        requiredPermissions: SENSITIVE_DATA_AUDIT_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Operasyon Dashboard",
        to: "/app/ayarlar/operasyon-dashboard",
        requiredPermissions: OPS_DASHBOARD_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Exception Workbench",
        to: "/app/ayarlar/exception-workbench",
        requiredPermissions: OPS_EXCEPTION_WORKBENCH_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Veri Saklama ve Snapshot",
        to: "/app/ayarlar/veri-saklama-snapshot",
        requiredPermissions: OPS_RETENTION_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Sirket Ayarlari",
        to: "/app/ayarlar/sirket-ayarlari",
        requiredPermissions: COMPANY_SETTINGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Organizasyon Yonetimi",
        to: "/app/ayarlar/organizasyon-yonetimi",
        requiredPermissions: ORG_SETTINGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Entity Aktivasyon Alani",
        to: "/app/ayarlar/entity-aktivasyon-alani",
        requiredPermissions: ENTITY_ACTIVATION_WORKSPACE_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Hesap Plani Olustur",
        to: "/app/ayarlar/hesap-plani-olustur",
        implemented: true,
      },
      {
        label: "Hesap Plani Ayarlari",
        to: "/app/ayarlar/hesap-plani-ayarlari",
        requiredPermissions: GL_SETUP_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Workflow Yonetimi",
        to: "/app/ayarlar/workflow-kurulumu",
        requiredPermissions: WORKFLOW_SETUP_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Hesap Yeniden Siniflandirma",
        to: "/app/ayarlar/hesap-yeniden-siniflandirma",
        requiredPermissions: RECLASS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Kur Yonetimi",
        to: "/app/ayarlar/kur-yonetimi",
        requiredPermissions: FX_RATE_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Vergi Kurulumu",
        to: "/app/ayarlar/vergi-kurulumu",
        requiredPermissions: TAX_SETUP_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Konsolidasyon Kurulumu",
        to: "/app/ayarlar/konsolidasyon-kurulumu",
        requiredPermissions: CONSOLIDATION_SETUP_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Stok Ayarlari",
        to: "/app/ayarlar/stok-ayarlari",
      },
    ],
  },
];

function isSectionItem(item) {
  return item?.type === "section" || Array.isArray(item?.items);
}

export function collectSidebarLinks(items = sidebarItems) {
  const byPath = new Map();

  function walk(nodes) {
    if (!Array.isArray(nodes)) {
      return;
    }

    for (const node of nodes) {
      if (isSectionItem(node)) {
        walk(node.items);
        continue;
      }

      if (node?.to && !byPath.has(node.to)) {
        byPath.set(node.to, node);
      }
    }
  }

  walk(items);
  return Array.from(byPath.values());
}
