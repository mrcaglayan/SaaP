export const LOCAL_REPORT_PERMISSION_CODES = Object.freeze({
  summary: "gl.report.local.read",
  ledger: "gl.report.ledger.read",
  statement: "gl.report.statement.read",
});

const LOCAL_REPORT_ROUTES = Object.freeze({
  generalLedger: Object.freeze({
    key: "generalLedger",
    appPath: "/app/defter-i-kebir",
    childPath: "defter-i-kebir",
    label: "Defter-i Kebir",
    requiredPermissions: [LOCAL_REPORT_PERMISSION_CODES.ledger],
    implemented: true,
    showInSidebar: true,
  }),
  balanceSheet: Object.freeze({
    key: "balanceSheet",
    appPath: "/app/bilanco",
    childPath: "bilanco",
    label: "Bilanco",
    requiredPermissions: [LOCAL_REPORT_PERMISSION_CODES.statement],
    implemented: true,
    showInSidebar: true,
  }),
  incomeStatement: Object.freeze({
    key: "incomeStatement",
    appPath: "/app/gelir-tablosu",
    childPath: "gelir-tablosu",
    label: "Gelir Tablosu",
    requiredPermissions: [LOCAL_REPORT_PERMISSION_CODES.statement],
    implemented: true,
    showInSidebar: true,
  }),
  trialBalance: Object.freeze({
    key: "trialBalance",
    appPath: "/app/mizan-raporu",
    childPath: "mizan-raporu",
    label: "Mizan Raporu",
    requiredPermissions: [LOCAL_REPORT_PERMISSION_CODES.summary],
    implemented: true,
    showInSidebar: true,
  }),
  subsidiaryLedger: Object.freeze({
    key: "subsidiaryLedger",
    appPath: "/app/muavin",
    childPath: "muavin",
    label: "Muavin",
    requiredPermissions: [LOCAL_REPORT_PERMISSION_CODES.ledger],
    implemented: true,
    showInSidebar: true,
  }),
  cariControlReconciliation: Object.freeze({
    key: "cariControlReconciliation",
    appPath: "/app/cari-kontrol-mutabakati",
    childPath: "cari-kontrol-mutabakati",
    label: "Cari Kontrol Mutabakati",
    requiredPermissions: [
      LOCAL_REPORT_PERMISSION_CODES.ledger,
      "cari.report.read",
    ],
    implemented: true,
    showInSidebar: true,
  }),
});

export const LOCAL_REPORT_ROUTE_PATHS = Object.freeze(
  Object.fromEntries(
    Object.entries(LOCAL_REPORT_ROUTES).map(([key, route]) => [
      key,
      route.appPath,
    ]),
  ),
);

export const LOCAL_REPORT_SIDEBAR_ITEMS = Object.freeze({
  generalLedger: Object.freeze({
    label: LOCAL_REPORT_ROUTES.generalLedger.label,
    to: LOCAL_REPORT_ROUTES.generalLedger.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.generalLedger.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.generalLedger.implemented,
  }),
  balanceSheet: Object.freeze({
    label: LOCAL_REPORT_ROUTES.balanceSheet.label,
    to: LOCAL_REPORT_ROUTES.balanceSheet.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.balanceSheet.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.balanceSheet.implemented,
  }),
  incomeStatement: Object.freeze({
    label: LOCAL_REPORT_ROUTES.incomeStatement.label,
    to: LOCAL_REPORT_ROUTES.incomeStatement.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.incomeStatement.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.incomeStatement.implemented,
  }),
  trialBalance: Object.freeze({
    label: LOCAL_REPORT_ROUTES.trialBalance.label,
    to: LOCAL_REPORT_ROUTES.trialBalance.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.trialBalance.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.trialBalance.implemented,
  }),
  subsidiaryLedger: Object.freeze({
    label: LOCAL_REPORT_ROUTES.subsidiaryLedger.label,
    to: LOCAL_REPORT_ROUTES.subsidiaryLedger.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.subsidiaryLedger.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.subsidiaryLedger.implemented,
  }),
  cariControlReconciliation: Object.freeze({
    label: LOCAL_REPORT_ROUTES.cariControlReconciliation.label,
    to: LOCAL_REPORT_ROUTES.cariControlReconciliation.appPath,
    requiredPermissions: [
      ...LOCAL_REPORT_ROUTES.cariControlReconciliation.requiredPermissions,
    ],
    implemented: LOCAL_REPORT_ROUTES.cariControlReconciliation.implemented,
  }),
});

/**
 * Resolve local-report route metadata from an app path.
 */
export function getLocalReportRouteConfig(appPath) {
  return (
    Object.values(LOCAL_REPORT_ROUTES).find(
      (route) => route.appPath === appPath,
    ) || null
  );
}
