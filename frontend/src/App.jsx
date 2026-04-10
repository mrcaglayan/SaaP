import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import AcceptInvitePage from "./pages/AcceptInvitePage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import AppLayout from "./layouts/AppLayout";
import RequireAuth from "./auth/RequireAuth";
import RequirePermission from "./auth/RequirePermission";
import { useAuth } from "./auth/useAuth.js";
import AcilisFisiOlustur from "./pages/AcilisFisiOlustur";
import JournalWorkbenchPage from "./pages/JournalWorkbenchPage";
import CompanyOnboardingPage from "./pages/settings/CompanyOnboardingPage";
import GlSetupPage from "./pages/settings/GlSetupPage";
import WorkflowSetupPage from "./pages/settings/WorkflowSetupPage.jsx";
import GlReclassificationPage from "./pages/settings/GlReclassificationPage.jsx";
import HesapPlaniOlustur from "./pages/settings/HesapPlaniOlustur";
import OrganizationManagementPage from "./pages/settings/OrganizationManagementPage";
import MyDelegationsPage from "./pages/settings/MyDelegationsPage.jsx";
import FxRatesPage from "./pages/settings/FxRatesPage";
import ConsolidationSetupPage from "./pages/settings/ConsolidationSetupPage";
import TaxSetupPage from "./pages/settings/TaxSetupPage.jsx";
import RolesPermissionsPage from "./pages/security/RolesPermissionsPage";
import AccessModelCatalogPage from "./pages/security/AccessModelCatalogPage.jsx";
import FieldVisibilityPoliciesPage from "./pages/security/FieldVisibilityPoliciesPage.jsx";
import ApprovalDelegationsPage from "./pages/security/ApprovalDelegationsPage.jsx";
import TemporaryOperationalCoveragePage from "./pages/security/TemporaryOperationalCoveragePage.jsx";
import UserAssignmentsPage from "./pages/security/UserAssignmentsPage";
import ScopeAssignmentsPage from "./pages/security/ScopeAssignmentsPage";
import BranchOperatorManagementPage from "./pages/security/BranchOperatorManagementPage.jsx";
import AccessDebuggerPage from "./pages/security/AccessDebuggerPage.jsx";
import GroupApPostExtensionPage from "./pages/security/GroupApPostExtensionPage.jsx";
import ComplianceReportsPage from "./pages/security/ComplianceReportsPage.jsx";
import RbacAuditLogsPage from "./pages/security/RbacAuditLogsPage";
import RawAuditLogsPage from "./pages/security/RawAuditLogsPage.jsx";
import SensitiveDataAuditPage from "./pages/security/SensitiveDataAuditPage.jsx";
import SecurityAdminOverviewPage from "./pages/security/SecurityAdminOverviewPage.jsx";
import OpsDashboardPage from "./pages/OpsDashboardPage.jsx";
import ExceptionsWorkbenchPage from "./pages/ExceptionsWorkbenchPage.jsx";
import RetentionAdminPage from "./pages/settings/RetentionAdminPage.jsx";
import IntercompanyReconciliationPage from "./pages/IntercompanyReconciliationPage";
import ProviderBootstrapPage from "./pages/ProviderBootstrapPage";
import ProviderLoginPage from "./pages/provider/ProviderLoginPage.jsx";
import ModulePlaceholderPage from "./pages/ModulePlaceholderPage";
import CashRegistersPage from "./pages/cash/CashRegistersPage.jsx";
import CashSessionsPage from "./pages/cash/CashSessionsPage.jsx";
import CashTransactionsPage from "./pages/cash/CashTransactionsPage.jsx";
import CashTransitTransfersPage from "./pages/cash/CashTransitTransfersPage.jsx";
import CashExchangesPage from "./pages/cash/CashExchangesPage.jsx";
import CashFxReportsPage from "./pages/cash/CashFxReportsPage.jsx";
import CashFxOpsDashboardPage from "./pages/cash/CashFxOpsDashboardPage.jsx";
import CashExceptionsPage from "./pages/cash/CashExceptionsPage.jsx";
import BankAccountsPage from "./pages/bank/BankAccountsPage.jsx";
import BankStatementImportPage from "./pages/bank/BankStatementImportPage.jsx";
import BankStatementQueuePage from "./pages/bank/BankStatementQueuePage.jsx";
import BankReconciliationPage from "./pages/bank/BankReconciliationPage.jsx";
import BankGovernancePage from "./pages/bank/BankGovernancePage.jsx";
import PaymentBatchListPage from "./pages/payments/PaymentBatchListPage.jsx";
import PaymentBatchDetailPage from "./pages/payments/PaymentBatchDetailPage.jsx";
import PayrollRunImportPage from "./pages/payroll/PayrollRunImportPage.jsx";
import PayrollRunsPage from "./pages/payroll/PayrollRunsPage.jsx";
import PayrollRunDetailPage from "./pages/payroll/PayrollRunDetailPage.jsx";
import PayrollComponentMappingsPage from "./pages/payroll/PayrollComponentMappingsPage.jsx";
import PayrollLiabilitiesPage from "./pages/payroll/PayrollLiabilitiesPage.jsx";
import PayrollBeneficiariesPage from "./pages/payroll/PayrollBeneficiariesPage.jsx";
import PayrollEmployeeOwnershipPage from "./pages/payroll/PayrollEmployeeOwnershipPage.jsx";
import PayrollCloseControlsPage from "./pages/payroll/PayrollCloseControlsPage.jsx";
import CariCounterpartyPage from "./pages/cari/CariCounterpartyPage.jsx";
import CariDocumentsPage from "./pages/cari/CariDocumentsPage.jsx";
import CariReportsPage from "./pages/cari/CariReportsPage.jsx";
import CariSettlementsPage from "./pages/cari/CariSettlementsPage.jsx";
import CariAuditPage from "./pages/cari/CariAuditPage.jsx";
import ItemCardsPage from "./pages/inventory/ItemCardsPage.jsx";
import InventoryLandedCostVoucherDetailPage from "./pages/inventory/InventoryLandedCostVoucherDetailPage.jsx";
import InventoryLandedCostVoucherNewPage from "./pages/inventory/InventoryLandedCostVoucherNewPage.jsx";
import InventoryLandedCostVouchersPage from "./pages/inventory/InventoryLandedCostVouchersPage.jsx";
import InventoryMovementsPage from "./pages/inventory/InventoryMovementsPage.jsx";
import InventoryTransfersPage from "./pages/inventory/InventoryTransfersPage.jsx";
import ContractsPage from "./pages/contracts/ContractsPage.jsx";
import FixedAssetsPage from "./pages/fixedAssets/FixedAssetsPage.jsx";
import FixedAssetDetailPage from "./pages/fixedAssets/FixedAssetDetailPage.jsx";
import FixedAssetFormPage from "./pages/fixedAssets/FixedAssetFormPage.jsx";
import FixedAssetAcquisitionsPage from "./pages/fixedAssets/FixedAssetAcquisitionsPage.jsx";
import FixedAssetDisposalsPage from "./pages/fixedAssets/FixedAssetDisposalsPage.jsx";
import FixedAssetOpsDashboardPage from "./pages/fixedAssets/FixedAssetOpsDashboardPage.jsx";
import FixedAssetDepreciationRunsPage from "./pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx";
import FixedAssetReportsPage from "./pages/fixedAssets/FixedAssetReportsPage.jsx";
import FixedAssetSettingsPage from "./pages/fixedAssets/FixedAssetSettingsPage.jsx";
import FixedAssetCustodiansPage from "./pages/fixedAssets/FixedAssetCustodiansPage.jsx";
import FutureYearRevenuePage from "./pages/revenue/FutureYearRevenuePage.jsx";
import {
  collectSidebarLinks,
  SECURITY_ADMIN_ROUTE_ADAPTERS,
  SECURITY_ADMIN_ROUTE_FAMILY,
  sidebarItems,
} from "./layouts/sidebarConfig.js";
import TenantReadinessProvider from "./readiness/TenantReadinessProvider.jsx";
import RequireTenantReadiness from "./readiness/RequireTenantReadiness.jsx";
import ModuleReadinessProvider from "./readiness/ModuleReadinessProvider.jsx";
import LegalEntityActivationProvider from "./readiness/LegalEntityActivationProvider.jsx";
import RequireProviderAuth from "./provider/RequireProviderAuth.jsx";

const ConsolidationReportsPage = lazy(
  () => import("./pages/ConsolidationReportsPage.jsx"),
);
const YearEndRevrecChecklistPage = lazy(
  () => import("./pages/YearEndRevrecChecklistPage.jsx"),
);
const TrialBalancePage = lazy(() => import("./pages/TrialBalancePage.jsx"));
const GeneralLedgerPage = lazy(() => import("./pages/GeneralLedgerPage.jsx"));
const CariControlReconciliationPage = lazy(
  () => import("./pages/CariControlReconciliationPage.jsx"),
);
const LocalStatementPage = lazy(() => import("./pages/LocalStatementPage.jsx"));
const LocalCloseWorkspacePage = lazy(
  () => import("./pages/LocalCloseWorkspacePage.jsx"),
);
const LocalClosePackDetailPage = lazy(
  () => import("./pages/LocalClosePackDetailPage.jsx"),
);

function toRoutePath(value) {
  return String(value || "").replace(/[?#].*$/, "");
}

const rawSidebarLinks = collectSidebarLinks(sidebarItems);
const sidebarRouteLinks = [];
const sidebarLinkByPath = new Map();
for (const link of rawSidebarLinks) {
  const routePath = toRoutePath(link?.to);
  if (!routePath) {
    continue;
  }

  const existing = sidebarLinkByPath.get(routePath);
  if (!existing) {
    const normalizedLink = { ...link, routePath };
    sidebarLinkByPath.set(routePath, normalizedLink);
    sidebarRouteLinks.push(normalizedLink);
    continue;
  }

  const existingPermissions = Array.isArray(existing.requiredPermissions)
    ? existing.requiredPermissions
    : [];
  const nextPermissions = Array.isArray(link.requiredPermissions)
    ? link.requiredPermissions
    : [];
  const existingFeatureCodes = Array.isArray(existing.requiredFeatureCodes)
    ? existing.requiredFeatureCodes
    : [];
  const nextFeatureCodes = Array.isArray(link.requiredFeatureCodes)
    ? link.requiredFeatureCodes
    : [];
  if (nextPermissions.length > 0) {
    existing.requiredPermissions = Array.from(
      new Set([...existingPermissions, ...nextPermissions]),
    );
  }
  if (nextFeatureCodes.length > 0) {
    existing.requiredFeatureCodes = Array.from(
      new Set([...existingFeatureCodes, ...nextFeatureCodes]),
    );
  }
}
const MODULE_PREVIEW_ADMIN_PERMISSIONS = [
  "security.role.upsert",
  "security.role_permissions.assign",
];
const PERIODIZATION_REVENUE_CANONICAL_PATH = "/app/gelecek-yillar-gelirleri";
const routeLoadingFallback = (
  <div className="grid min-h-[32vh] place-items-center">
    <div className="text-sm text-slate-600">Loading module...</div>
  </div>
);

function buildMergedNavigationTarget(to, currentSearch = "", currentHash = "") {
  const targetUrl = new URL(String(to || ""), "https://example.invalid");
  const nextSearchParams = new URLSearchParams(targetUrl.search);
  const incomingSearchParams = new URLSearchParams(String(currentSearch || ""));

  for (const [key, value] of incomingSearchParams.entries()) {
    nextSearchParams.set(key, value);
  }

  const nextSearch = nextSearchParams.toString();
  const nextHash = targetUrl.hash || String(currentHash || "");
  return `${targetUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash}`;
}

function renderSecurityAdminSurface(surfaceKey) {
  switch (surfaceKey) {
    case "access-model":
      return <AccessModelCatalogPage />;
    case "roles-permissions":
      return <RolesPermissionsPage />;
    case "user-assignments":
      return <UserAssignmentsPage />;
    case "scope-assignments":
      return <ScopeAssignmentsPage />;
    case "field-visibility-policies":
      return <FieldVisibilityPoliciesPage />;
    case "delegations":
      return <ApprovalDelegationsPage />;
    case "temporary-coverage":
      return <TemporaryOperationalCoveragePage />;
    case "access-debugger":
      return <AccessDebuggerPage />;
    case "group-ap-post-extension":
      return <GroupApPostExtensionPage />;
    case "compliance-reports":
      return <ComplianceReportsPage />;
    case "audit-logs":
      return <RbacAuditLogsPage />;
    case "raw-audit-logs":
      return <RawAuditLogsPage />;
    case "sensitive-data-audit":
      return <SensitiveDataAuditPage />;
    case "workflow-setup":
      return <WorkflowSetupPage />;
    default:
      return <Navigate to="/app" replace />;
  }
}

// Keep heavy route bundles behind RequirePermission so unauthorized users do not
// fetch report chunks they cannot open.
function withLazyRoute(Component, props = {}) {
  return (
    <Suspense fallback={routeLoadingFallback}>
      <Component {...props} />
    </Suspense>
  );
}

const implementedRoutes = [
  {
    appPath: "/app/acilis-fisi",
    childPath: "acilis-fisi",
    element: <AcilisFisiOlustur />,
  },
  {
    appPath: "/app/mahsup-islemleri",
    childPath: "mahsup-islemleri",
    element: <JournalWorkbenchPage />,
  },
  {
    appPath: "/app/mizan-raporu",
    childPath: "mizan-raporu",
    element: withLazyRoute(TrialBalancePage),
  },
  {
    appPath: "/app/defter-i-kebir",
    childPath: "defter-i-kebir",
    element: withLazyRoute(GeneralLedgerPage, {
      reportMode: "GENERAL_LEDGER",
    }),
  },
  {
    appPath: "/app/muavin",
    childPath: "muavin",
    element: withLazyRoute(GeneralLedgerPage, { reportMode: "MUAVIN" }),
  },
  {
    appPath: "/app/cari-kontrol-mutabakati",
    childPath: "cari-kontrol-mutabakati",
    element: withLazyRoute(CariControlReconciliationPage),
  },
  {
    appPath: "/app/bilanco",
    childPath: "bilanco",
    element: withLazyRoute(LocalStatementPage, {
      statementType: "BALANCE_SHEET",
    }),
  },
  {
    appPath: "/app/gelir-tablosu",
    childPath: "gelir-tablosu",
    element: withLazyRoute(LocalStatementPage, {
      statementType: "INCOME_STATEMENT",
    }),
  },
  {
    appPath: "/app/kasa-tanimlari",
    childPath: "kasa-tanimlari",
    element: <CashRegistersPage />,
  },
  {
    appPath: "/app/kasa-oturumlari",
    childPath: "kasa-oturumlari",
    element: <CashSessionsPage />,
  },
  {
    appPath: "/app/tediye-islemleri",
    childPath: "tediye-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/tahsilat-islemleri",
    childPath: "tahsilat-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/kasa-islemleri",
    childPath: "kasa-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/kasa-transit-transferleri",
    childPath: "kasa-transit-transferleri",
    element: <CashTransitTransfersPage />,
  },
  {
    appPath: "/app/kasa-kur-degisimleri",
    childPath: "kasa-kur-degisimleri",
    element: <CashExchangesPage />,
  },
  {
    appPath: "/app/kasa-kur-raporlari",
    childPath: "kasa-kur-raporlari",
    element: <CashFxReportsPage />,
  },
  {
    appPath: "/app/kasa-kur-ops-dashboard",
    childPath: "kasa-kur-ops-dashboard",
    element: <CashFxOpsDashboardPage />,
  },
  {
    appPath: "/app/cash-transit-transfers",
    childPath: "cash-transit-transfers",
    permissionPath: "/app/kasa-transit-transferleri",
    element: <Navigate to="/app/kasa-transit-transferleri" replace />,
  },
  {
    appPath: "/app/kasa-istisnalari",
    childPath: "kasa-istisnalari",
    element: <CashExceptionsPage />,
  },
  {
    appPath: "/app/banka-tanimla",
    childPath: "banka-tanimla",
    element: <BankAccountsPage />,
  },
  {
    appPath: "/app/banka-hesaplari",
    childPath: "banka-hesaplari",
    permissionPath: "/app/banka-tanimla",
    element: <Navigate to="/app/banka-tanimla" replace />,
  },
  {
    appPath: "/app/banka-ekstre-ice-aktar",
    childPath: "banka-ekstre-ice-aktar",
    element: <BankStatementImportPage />,
  },
  {
    appPath: "/app/banka-ekstre-kuyrugu",
    childPath: "banka-ekstre-kuyrugu",
    element: <BankStatementQueuePage />,
  },
  {
    appPath: "/app/banka-mutabakat",
    childPath: "banka-mutabakat",
    element: <BankReconciliationPage />,
  },
  {
    appPath: "/app/banka-onaylar",
    childPath: "banka-onaylar",
    element: <BankGovernancePage />,
  },
  {
    appPath: "/app/banka-islemleri",
    childPath: "banka-islemleri",
    permissionPath: "/app/banka-ekstre-kuyrugu",
    element: <Navigate to="/app/banka-ekstre-kuyrugu" replace />,
  },
  {
    appPath: "/app/odeme-batchleri",
    childPath: "odeme-batchleri",
    element: <PaymentBatchListPage />,
  },
  {
    appPath: "/app/odeme-batchleri/:batchId",
    childPath: "odeme-batchleri/:batchId",
    permissionPath: "/app/odeme-batchleri",
    element: <PaymentBatchDetailPage />,
  },
  {
    appPath: "/app/payroll-runs",
    childPath: "payroll-runs",
    element: <PayrollRunsPage />,
  },
  {
    appPath: "/app/payroll-runs/import",
    childPath: "payroll-runs/import",
    element: <PayrollRunImportPage />,
  },
  {
    appPath: "/app/payroll-mappings",
    childPath: "payroll-mappings",
    element: <PayrollComponentMappingsPage />,
  },
  {
    appPath: "/app/payroll-ownership",
    childPath: "payroll-ownership",
    element: <PayrollEmployeeOwnershipPage />,
  },
  {
    appPath: "/app/payroll-liabilities",
    childPath: "payroll-liabilities",
    element: <PayrollLiabilitiesPage />,
  },
  {
    appPath: "/app/payroll-beneficiaries",
    childPath: "payroll-beneficiaries",
    element: <PayrollBeneficiariesPage />,
  },
  {
    appPath: "/app/payroll-close-controls",
    childPath: "payroll-close-controls",
    element: <PayrollCloseControlsPage />,
  },
  {
    appPath: "/app/payroll-runs/:runId",
    childPath: "payroll-runs/:runId",
    permissionPath: "/app/payroll-runs",
    element: <PayrollRunDetailPage />,
  },
  {
    appPath: "/app/payroll-runs/:runId/liabilities",
    childPath: "payroll-runs/:runId/liabilities",
    permissionPath: "/app/payroll-liabilities",
    element: <PayrollLiabilitiesPage />,
  },
  {
    appPath: "/app/alici-kart-olustur",
    childPath: "alici-kart-olustur",
    permissionPath: "/app/musteri-kartlari",
    element: <LegacyRouteRedirect to="/app/musteri-kartlari/olustur" />,
  },
  {
    appPath: "/app/musteri-kartlari/olustur",
    childPath: "musteri-kartlari/olustur",
    permissionPath: "/app/musteri-kartlari",
    element: <CariCounterpartyPage pageKey="buyerCreate" />,
  },
  {
    appPath: "/app/alici-kart-listesi",
    childPath: "alici-kart-listesi",
    permissionPath: "/app/musteri-kartlari",
    element: <LegacyRouteRedirect to="/app/musteri-kartlari" />,
  },
  {
    appPath: "/app/musteri-kartlari",
    childPath: "musteri-kartlari",
    element: <CariCounterpartyPage pageKey="buyerList" />,
  },
  {
    appPath: "/app/satici-kart-olustur",
    childPath: "satici-kart-olustur",
    permissionPath: "/app/tedarikci-kartlari",
    element: <LegacyRouteRedirect to="/app/tedarikci-kartlari/olustur" />,
  },
  {
    appPath: "/app/tedarikci-kartlari/olustur",
    childPath: "tedarikci-kartlari/olustur",
    permissionPath: "/app/tedarikci-kartlari",
    element: <CariCounterpartyPage pageKey="vendorCreate" />,
  },
  {
    appPath: "/app/satici-kart-listesi",
    childPath: "satici-kart-listesi",
    permissionPath: "/app/tedarikci-kartlari",
    element: <LegacyRouteRedirect to="/app/tedarikci-kartlari" />,
  },
  {
    appPath: "/app/tedarikci-kartlari",
    childPath: "tedarikci-kartlari",
    element: <CariCounterpartyPage pageKey="vendorList" />,
  },
  {
    appPath: "/app/cari-raporlari",
    childPath: "cari-raporlari",
    permissionPath: "/app/tedarikci-raporlari",
    element: <LegacyRouteRedirect to="/app/tedarikci-raporlari" />,
  },
  {
    appPath: "/app/tedarikci-raporlari",
    childPath: "tedarikci-raporlari",
    element: <CariReportsPage direction="AP" />,
  },
  {
    appPath: "/app/musteri-raporlari",
    childPath: "musteri-raporlari",
    element: <CariReportsPage direction="AR" />,
  },
  {
    appPath: "/app/cari-belgeler",
    childPath: "cari-belgeler",
    permissionPath: "/app/alis-faturalari",
    element: <LegacyRouteRedirect to="/app/alis-faturalari" />,
  },
  {
    appPath: "/app/alis-faturalari",
    childPath: "alis-faturalari",
    element: <CariDocumentsPage direction="AP" />,
  },
  {
    appPath: "/app/satis-faturalari",
    childPath: "satis-faturalari",
    element: <CariDocumentsPage direction="AR" />,
  },
  {
    appPath: "/app/cari-settlements",
    childPath: "cari-settlements",
    permissionPath: "/app/tedarikci-odemeler",
    element: <LegacyRouteRedirect to="/app/tedarikci-odemeler" />,
  },
  {
    appPath: "/app/tedarikci-odemeler",
    childPath: "tedarikci-odemeler",
    element: <CariSettlementsPage direction="AP" />,
  },
  {
    appPath: "/app/musteri-tahsilatlar",
    childPath: "musteri-tahsilatlar",
    element: <CariSettlementsPage direction="AR" />,
  },
  {
    appPath: "/app/cari-audit",
    childPath: "cari-audit",
    permissionPath: "/app/ayarlar/cari-denetim",
    element: <LegacyRouteRedirect to="/app/ayarlar/cari-denetim" />,
  },
  {
    appPath: "/app/ayarlar/cari-denetim",
    childPath: "ayarlar/cari-denetim",
    element: <CariAuditPage />,
  },
  {
    appPath: "/app/stok-karti-olustur",
    childPath: "stok-karti-olustur",
    element: <ItemCardsPage pageKey="create" />,
  },
  {
    appPath: "/app/stok-karti-listesi",
    childPath: "stok-karti-listesi",
    element: <ItemCardsPage pageKey="list" />,
  },
  {
    appPath: "/app/stok-yansitma-islemleri",
    childPath: "stok-yansitma-islemleri",
    element: <InventoryMovementsPage />,
  },
  {
    appPath: "/app/stok-maliyet-voucherleri",
    childPath: "stok-maliyet-voucherleri",
    element: <InventoryLandedCostVouchersPage />,
  },
  {
    appPath: "/app/stok-maliyet-voucherleri/yeni",
    childPath: "stok-maliyet-voucherleri/yeni",
    permissionPath: "/app/stok-maliyet-voucherleri",
    element: <InventoryLandedCostVoucherNewPage />,
  },
  {
    appPath: "/app/stok-maliyet-voucherleri/:voucherId",
    childPath: "stok-maliyet-voucherleri/:voucherId",
    permissionPath: "/app/stok-maliyet-voucherleri",
    element: <InventoryLandedCostVoucherDetailPage />,
  },
  {
    appPath: "/app/stok-transferleri",
    childPath: "stok-transferleri",
    element: <InventoryTransfersPage />,
  },
  {
    appPath: "/app/demirbaslar",
    childPath: "demirbaslar",
    permissionPath: "/app/demirbas-karti-listesi",
    element: <Navigate to="/app/demirbas-karti-listesi" replace />,
  },
  {
    appPath: "/app/demirbas-karti-listesi",
    childPath: "demirbas-karti-listesi",
    element: <FixedAssetsPage />,
  },
  {
    appPath: "/app/demirbas-karti-olustur",
    childPath: "demirbas-karti-olustur",
    permissionPath: "/app/demirbas-karti-listesi",
    element: <FixedAssetFormPage />,
  },
  {
    appPath: "/app/demirbas-karti-detayi/:assetId",
    childPath: "demirbas-karti-detayi/:assetId",
    permissionPath: "/app/demirbas-karti-listesi",
    element: <FixedAssetDetailPage />,
  },
  {
    appPath: "/app/demirbas-alim-islemleri",
    childPath: "demirbas-alim-islemleri",
    element: <FixedAssetAcquisitionsPage />,
  },
  {
    appPath: "/app/demirbas-satis-islemleri",
    childPath: "demirbas-satis-islemleri",
    element: <FixedAssetDisposalsPage />,
  },
  {
    appPath: "/app/demirbas-ops-dashboard",
    childPath: "demirbas-ops-dashboard",
    element: <FixedAssetOpsDashboardPage />,
  },
  {
    appPath: "/app/demirbas-amortisman-islemleri",
    childPath: "demirbas-amortisman-islemleri",
    element: <FixedAssetDepreciationRunsPage />,
  },
  {
    appPath: "/app/demirbas-amortisman-ayarlar",
    childPath: "demirbas-amortisman-ayarlar",
    permissionPath: "/app/demirbas-amortisman-islemleri",
    element: <Navigate to="/app/demirbas-amortisman-islemleri" replace />,
  },
  {
    appPath: "/app/demirbas-raporu",
    childPath: "demirbas-raporu",
    element: <FixedAssetReportsPage />,
  },
  {
    appPath: "/app/ayarlar/demirbas-ayarlari",
    childPath: "ayarlar/demirbas-ayarlari",
    element: <FixedAssetSettingsPage />,
  },
  {
    appPath: "/app/ayarlar/demirbas-zimmetlileri",
    childPath: "ayarlar/demirbas-zimmetlileri",
    element: <FixedAssetCustodiansPage />,
  },
  {
    appPath: "/app/contracts",
    childPath: "contracts",
    element: <ContractsPage />,
  },
  {
    appPath: "/app/sozlesmeler",
    childPath: "sozlesmeler",
    permissionPath: "/app/contracts",
    element: <Navigate to="/app/contracts" replace />,
  },
  {
    appPath: "/app/contracts-and-revenue",
    childPath: "contracts-and-revenue",
    permissionPath: "/app/contracts",
    element: <Navigate to="/app/contracts" replace />,
  },
  {
    appPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    childPath: "gelecek-yillar-gelirleri",
    element: <FutureYearRevenuePage />,
  },
  {
    appPath: "/app/donemsellik-ve-tahakkuklar",
    childPath: "donemsellik-ve-tahakkuklar",
    permissionPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    element: <Navigate to={PERIODIZATION_REVENUE_CANONICAL_PATH} replace />,
  },
  {
    appPath: "/app/periodization-and-accruals",
    childPath: "periodization-and-accruals",
    permissionPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    element: <Navigate to={PERIODIZATION_REVENUE_CANONICAL_PATH} replace />,
  },
  {
    appPath: "/app/ayarlar/hesap-plani-olustur",
    childPath: "ayarlar/hesap-plani-olustur",
    element: <HesapPlaniOlustur />,
  },
  {
    appPath: "/app/ayarlar/hesap-plani-ayarlari",
    childPath: "ayarlar/hesap-plani-ayarlari",
    element: <GlSetupPage />,
  },
  {
    appPath: "/app/ayarlar/workflow-kurulumu",
    childPath: "ayarlar/workflow-kurulumu",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/workflows?tab=definitions"
      />
    ),
  },
  {
    appPath: SECURITY_ADMIN_ROUTE_FAMILY.overview,
    childPath: "ayarlar/security-admin",
    element: <SecurityAdminOverviewPage />,
  },
  ...SECURITY_ADMIN_ROUTE_ADAPTERS.map((route) => ({
    appPath: route.appPath,
    childPath: route.childPath,
    permissionPath: route.permissionPath,
    element: <SecurityAdminWorkbenchAdapter routeKey={route.key} />,
  })),
  {
    appPath: "/app/ayarlar/hesap-yeniden-siniflandirma",
    childPath: "ayarlar/hesap-yeniden-siniflandirma",
    element: <GlReclassificationPage />,
  },
  {
    appPath: "/app/ayarlar/delegasyonlarim",
    childPath: "ayarlar/delegasyonlarim",
    element: <MyDelegationsPage />,
  },
  {
    appPath: "/app/ayarlar/sirket-ayarlari",
    childPath: "ayarlar/sirket-ayarlari",
    element: <CompanyOnboardingPage />,
  },
  {
    appPath: "/app/ayarlar/organizasyon-yonetimi",
    childPath: "ayarlar/organizasyon-yonetimi",
    element: <OrganizationManagementPage />,
  },
  {
    appPath: "/app/ayarlar/entity-aktivasyon-alani",
    childPath: "ayarlar/entity-aktivasyon-alani",
    element: <OrganizationManagementPage workspaceMode="activation" />,
  },
  {
    appPath: "/app/ayarlar/kur-yonetimi",
    childPath: "ayarlar/kur-yonetimi",
    element: <FxRatesPage />,
  },
  {
    appPath: "/app/ayarlar/vergi-kurulumu",
    childPath: "ayarlar/vergi-kurulumu",
    element: <TaxSetupPage />,
  },
  {
    appPath: "/app/ayarlar/konsolidasyon-kurulumu",
    childPath: "ayarlar/konsolidasyon-kurulumu",
    element: <ConsolidationSetupPage />,
  },
  {
    appPath: "/app/ayarlar/sube-operatorleri",
    childPath: "ayarlar/sube-operatorleri",
    element: <BranchOperatorManagementPage />,
  },
  {
    appPath: "/app/ayarlar/rbac/access-model",
    childPath: "ayarlar/rbac/access-model",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/catalog?tab=access-model"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/roles-permissions",
    childPath: "ayarlar/rbac/roles-permissions",
    element: (
      <LegacyRouteRedirect to="/app/ayarlar/security-admin/catalog?tab=roles" />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/user-assignments",
    childPath: "ayarlar/rbac/user-assignments",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/users?tab=assignments"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/scope-assignments",
    childPath: "ayarlar/rbac/scope-assignments",
    element: (
      <LegacyRouteRedirect to="/app/ayarlar/security-admin/users?tab=scopes" />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/field-visibility-policies",
    childPath: "ayarlar/rbac/field-visibility-policies",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/catalog?tab=field-visibility"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/delegations",
    childPath: "ayarlar/rbac/delegations",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/users?tab=delegations"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/temporary-coverage",
    childPath: "ayarlar/rbac/temporary-coverage",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/users?tab=coverage"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/access-debugger",
    childPath: "ayarlar/rbac/access-debugger",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/diagnostics?tab=access"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/group-ap-post-extension",
    childPath: "ayarlar/rbac/group-ap-post-extension",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/catalog?tab=group-ap-post"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/compliance-reports",
    childPath: "ayarlar/rbac/compliance-reports",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/diagnostics?tab=compliance"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/audit-logs",
    childPath: "ayarlar/rbac/audit-logs",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/diagnostics?tab=audit"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/raw-audit-logs",
    childPath: "ayarlar/rbac/raw-audit-logs",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/diagnostics?tab=raw-audit"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/rbac/sensitive-data-audit",
    childPath: "ayarlar/rbac/sensitive-data-audit",
    element: (
      <LegacyRouteRedirect
        to="/app/ayarlar/security-admin/diagnostics?tab=sensitive-data"
      />
    ),
  },
  {
    appPath: "/app/ayarlar/operasyon-dashboard",
    childPath: "ayarlar/operasyon-dashboard",
    element: <OpsDashboardPage />,
  },
  {
    appPath: "/app/ayarlar/exception-workbench",
    childPath: "ayarlar/exception-workbench",
    element: <ExceptionsWorkbenchPage />,
  },
  {
    appPath: "/app/ayarlar/veri-saklama-snapshot",
    childPath: "ayarlar/veri-saklama-snapshot",
    element: <RetentionAdminPage />,
  },
  {
    appPath: "/app/donem-sonu-islemler/aylik/intercompany-mutabakat",
    childPath: "donem-sonu-islemler/aylik/intercompany-mutabakat",
    element: <IntercompanyReconciliationPage />,
  },
  {
    appPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
    childPath: "donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
    element: withLazyRoute(LocalCloseWorkspacePage),
  },
  {
    appPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/:packId",
    childPath: "donem-sonu-islemler/yillik/yerel-kapanis-paketleri/:packId",
    permissionPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
    element: withLazyRoute(LocalClosePackDetailPage),
  },
  {
    appPath: "/app/donem-sonu-islemler/yillik/kapanis-islemleri",
    childPath: "donem-sonu-islemler/yillik/kapanis-islemleri",
    element: withLazyRoute(YearEndRevrecChecklistPage),
  },
  {
    appPath: "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari",
    childPath: "donem-sonu-islemler/yillik/konsolidasyon-raporlari",
    element: withLazyRoute(ConsolidationReportsPage),
  },
];

for (const route of implementedRoutes) {
  const permissionPath = route.permissionPath || route.appPath;
  if (permissionPath === route.appPath) {
    continue;
  }

  const baseLink = sidebarLinkByPath.get(permissionPath);
  if (!baseLink) {
    continue;
  }

  const aliasLink = sidebarLinkByPath.get(route.appPath);
  const basePermissions = Array.isArray(baseLink.requiredPermissions)
    ? baseLink.requiredPermissions
    : [];
  const aliasPermissions = Array.isArray(aliasLink?.requiredPermissions)
    ? aliasLink.requiredPermissions
    : [];
  const baseFeatureCodes = Array.isArray(baseLink.requiredFeatureCodes)
    ? baseLink.requiredFeatureCodes
    : [];
  const aliasFeatureCodes = Array.isArray(aliasLink?.requiredFeatureCodes)
    ? aliasLink.requiredFeatureCodes
    : [];
  const mergedPermissions = Array.from(
    new Set([...aliasPermissions, ...basePermissions]),
  );
  const mergedFeatureCodes = Array.from(
    new Set([...aliasFeatureCodes, ...baseFeatureCodes]),
  );

  sidebarLinkByPath.set(route.appPath, {
    ...(aliasLink || baseLink),
    to: route.appPath,
    routePath: route.appPath,
    requiredPermissions: mergedPermissions,
    requiredFeatureCodes: mergedFeatureCodes,
  });
}

const implementedPaths = new Set([
  "/app",
  ...implementedRoutes.map((route) => route.appPath),
]);

const allPlaceholderRoutes = sidebarRouteLinks.filter(
  (link) =>
    link.routePath.startsWith("/app/") && !implementedPaths.has(link.routePath),
);

function withPermissionGuard(pathForPermissions, element, hasAnyFeature) {
  const linkConfig = sidebarLinkByPath.get(pathForPermissions) || {};
  const requiredPermissions = linkConfig?.requiredPermissions;
  const requiredFeatureCodes = Array.isArray(linkConfig?.requiredFeatureCodes)
    ? linkConfig.requiredFeatureCodes
    : [];
  const isFeatureEnabled =
    requiredFeatureCodes.length === 0 || hasAnyFeature(requiredFeatureCodes);
  if (!isFeatureEnabled) {
    return <Navigate to="/app" replace />;
  }
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
    return element;
  }

  return (
    <RequirePermission anyOf={requiredPermissions}>{element}</RequirePermission>
  );
}

function toChildPath(appPath) {
  return toRoutePath(appPath).replace(/^\/app\//, "");
}

function LegacyRouteRedirect({ to }) {
  const location = useLocation();
  return (
    <Navigate
      to={buildMergedNavigationTarget(to, location.search, location.hash)}
      replace
    />
  );
}

function resolveSidebarRouteAccess(path, hasAnyPermission, hasAnyFeature) {
  const sidebarItem = sidebarLinkByPath.get(path);
  if (!sidebarItem) {
    return {
      locked: false,
      visible: true,
    };
  }

  const requiredPermissions = Array.isArray(sidebarItem.requiredPermissions)
    ? sidebarItem.requiredPermissions
    : [];
  const requiredFeatureCodes = Array.isArray(sidebarItem.requiredFeatureCodes)
    ? sidebarItem.requiredFeatureCodes
    : [];
  const visible =
    requiredFeatureCodes.length === 0 || hasAnyFeature(requiredFeatureCodes);

  return {
    locked:
      requiredPermissions.length > 0 && !hasAnyPermission(requiredPermissions),
    visible,
  };
}

function SecurityAdminWorkbenchAdapter({ routeKey }) {
  const location = useLocation();
  const { hasAnyFeature, hasAnyPermission } = useAuth();
  const route = SECURITY_ADMIN_ROUTE_ADAPTERS.find(
    (entry) => entry.key === routeKey,
  );

  if (!route) {
    return <Navigate to="/app" replace />;
  }

  const accessibleTabs = Array.isArray(route.tabs)
    ? route.tabs.filter((tab) => {
        const access = resolveSidebarRouteAccess(
          tab.permissionPath || route.permissionPath,
          hasAnyPermission,
          hasAnyFeature,
        );
        return access.visible && !access.locked;
      })
    : [];

  if (accessibleTabs.length === 0) {
    return <Navigate to="/app" replace />;
  }

  const searchParams = new URLSearchParams(location.search);
  const requestedTab = String(searchParams.get("tab") || route.defaultTab || "");
  const activeTab =
    accessibleTabs.find((tab) => tab.key === requestedTab) || accessibleTabs[0];

  if (searchParams.get("tab") !== activeTab.key) {
    searchParams.set("tab", activeTab.key);
    const nextSearch = searchParams.toString();
    return (
      <Navigate
        to={`${route.appPath}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`}
        replace
      />
    );
  }

  return renderSecurityAdminSurface(activeTab.surfaceKey);
}

/**
 * Renders the authenticated application route tree and keeps the heaviest
 * Track 51 report surfaces on lazy-loaded route chunks.
 */
export default function App() {
  const { hasAllPermissions, hasAnyFeature } = useAuth();
  const canViewUnimplementedModules = hasAllPermissions(
    MODULE_PREVIEW_ADMIN_PERMISSIONS,
  );
  const providerPanelEnabled =
    import.meta.env.DEV ||
    String(import.meta.env.VITE_PROVIDER_PANEL_ENABLED || "")
      .trim()
      .toLowerCase() === "true" ||
    String(import.meta.env.VITE_PROVIDER_BOOTSTRAP_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const placeholderRoutes = canViewUnimplementedModules
    ? allPlaceholderRoutes
    : [];

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {providerPanelEnabled ? (
        <>
          <Route
            path="/provider"
            element={<Navigate to="/provider/login" replace />}
          />
          <Route path="/provider/login" element={<ProviderLoginPage />} />
          <Route
            path="/provider/bootstrap"
            element={
              <RequireProviderAuth>
                <ProviderBootstrapPage />
              </RequireProviderAuth>
            }
          />
          <Route
            path="/provider/admin/tenants"
            element={<Navigate to="/provider/bootstrap" replace />}
          />
        </>
      ) : null}

      <Route
        path="/app"
        element={
          <RequireAuth>
            <TenantReadinessProvider>
              <ModuleReadinessProvider>
                <LegalEntityActivationProvider>
                  <RequireTenantReadiness>
                    <AppLayout />
                  </RequireTenantReadiness>
                </LegalEntityActivationProvider>
              </ModuleReadinessProvider>
            </TenantReadinessProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />

        {implementedRoutes.map((route) => (
          <Route
            key={route.appPath}
            path={route.childPath}
            element={withPermissionGuard(
              route.appPath,
              route.element,
              hasAnyFeature,
            )}
          />
        ))}

        {placeholderRoutes.map((link) => (
          <Route
            key={link.routePath}
            path={toChildPath(link.routePath)}
            element={withPermissionGuard(
              link.routePath,
              <ModulePlaceholderPage
                title={link.label || "Module"}
                path={link.routePath}
              />,
              hasAnyFeature,
            )}
          />
        ))}
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
