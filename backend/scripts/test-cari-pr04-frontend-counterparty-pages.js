import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fileContains(filePath, expectedSnippet) {
  const source = await readFile(filePath, "utf8");
  return source.includes(expectedSnippet);
}

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..", "..");

  const appPath = path.resolve(repoRoot, "frontend/src/App.jsx");
  const sidebarPath = path.resolve(repoRoot, "frontend/src/layouts/sidebarConfig.js");
  const pagePath = path.resolve(repoRoot, "frontend/src/pages/cari/CariCounterpartyPage.jsx");
  const formPath = path.resolve(repoRoot, "frontend/src/pages/cari/CounterpartyForm.jsx");
  const apiPath = path.resolve(repoRoot, "frontend/src/api/cariCounterparty.js");
  const utilsPath = path.resolve(
    repoRoot,
    "frontend/src/pages/cari/counterpartyFormUtils.js"
  );

  const {
    collectSidebarLinks,
    sidebarItems,
  } = await import("../../frontend/src/layouts/sidebarConfig.js");
  const links = collectSidebarLinks(sidebarItems);
  const linkByPath = new Map(links.map((row) => [String(row.to), row]));

  const expectedSidebarRoutes = [
    {
      path: "/app/musteri-kartlari",
      permission: "cari.card.read",
    },
    {
      path: "/app/tedarikci-kartlari",
      permission: "cari.card.read",
    },
  ];

  const expectedCanonicalRoutes = [
    {
      path: "/app/musteri-kartlari/olustur",
      permissionPath: "/app/musteri-kartlari",
      pageKey: "buyerCreate",
    },
    {
      path: "/app/musteri-kartlari",
      permissionPath: null,
      pageKey: "buyerList",
    },
    {
      path: "/app/tedarikci-kartlari/olustur",
      permissionPath: "/app/tedarikci-kartlari",
      pageKey: "vendorCreate",
    },
    {
      path: "/app/tedarikci-kartlari",
      permissionPath: null,
      pageKey: "vendorList",
    },
  ];

  const expectedLegacyAliasRoutes = [
    {
      path: "/app/alici-kart-olustur",
      permissionPath: "/app/musteri-kartlari",
      redirectTo: "/app/musteri-kartlari/olustur",
    },
    {
      path: "/app/alici-kart-listesi",
      permissionPath: "/app/musteri-kartlari",
      redirectTo: "/app/musteri-kartlari",
    },
    {
      path: "/app/satici-kart-olustur",
      permissionPath: "/app/tedarikci-kartlari",
      redirectTo: "/app/tedarikci-kartlari/olustur",
    },
    {
      path: "/app/satici-kart-listesi",
      permissionPath: "/app/tedarikci-kartlari",
      redirectTo: "/app/tedarikci-kartlari",
    },
  ];

  for (const row of expectedSidebarRoutes) {
    const link = linkByPath.get(row.path);
    assert(link, `Sidebar link missing for ${row.path}`);
    assert(link.implemented === true, `Sidebar link should be implemented for ${row.path}`);
    const requiredPermissions = Array.isArray(link.requiredPermissions)
      ? link.requiredPermissions
      : [];
    assert(
      requiredPermissions.includes(row.permission),
      `Sidebar link ${row.path} should require ${row.permission}`
    );
  }

  const appSource = await readFile(appPath, "utf8");
  for (const row of expectedCanonicalRoutes) {
    const routePattern = new RegExp(
      `appPath:\\s*"${escapeForRegex(row.path)}"[\\s\\S]*?` +
        (row.permissionPath
          ? `permissionPath:\\s*"${escapeForRegex(row.permissionPath)}"[\\s\\S]*?`
          : "") +
        `pageKey="${escapeForRegex(row.pageKey)}"`,
      "m"
    );
    assert(
      routePattern.test(appSource),
      `App route should wire ${row.path} to pageKey=${row.pageKey}`
    );
  }

  for (const row of expectedLegacyAliasRoutes) {
    const aliasPattern = new RegExp(
      `appPath:\\s*"${escapeForRegex(row.path)}"[\\s\\S]*?` +
        `permissionPath:\\s*"${escapeForRegex(row.permissionPath)}"[\\s\\S]*?` +
        `LegacyRouteRedirect\\s+to="${escapeForRegex(row.redirectTo)}"`,
      "m"
    );
    assert(aliasPattern.test(appSource), `Legacy alias route is missing for ${row.path}`);
  }

  const permissionGuardPattern =
    /element=\{withPermissionGuard\(\s*route\.appPath,\s*route\.element,\s*hasAnyFeature,\s*\)\}/m;
  assert(
    permissionGuardPattern.test(appSource),
    "App routes should stay wrapped in permission guard"
  );

  const pageSource = await readFile(pagePath, "utf8");
  assert(
    !pageSource.includes("RBAC korumasi aktif"),
    "Cari page should no longer be PR-02 placeholder copy"
  );
  assert(
    pageSource.includes("CounterpartyForm"),
    "Cari page should use shared CounterpartyForm component"
  );
  assert(
    pageSource.includes("createCariCounterparty") &&
      pageSource.includes("listCariCounterparties") &&
      pageSource.includes("getCariCounterparty") &&
      pageSource.includes("updateCariCounterparty"),
    "Cari page should call CRUD API module functions"
  );

  assert(
    await fileContains(formPath, "Add Contact"),
    "Shared counterparty form should include contact editor UI"
  );
  assert(
    await fileContains(formPath, "Add Address"),
    "Shared counterparty form should include address editor UI"
  );
  assert(
    await fileContains(apiPath, "/api/v1/cari/counterparties"),
    "Cari API module should target real counterparty endpoints"
  );

  const formUtils = await import("../../frontend/src/pages/cari/counterpartyFormUtils.js");
  const buyerForm = formUtils.buildInitialCounterpartyForm("CUSTOMER");
  const vendorForm = formUtils.buildInitialCounterpartyForm("VENDOR");
  assert(
    buyerForm.isCustomer === true && buyerForm.isVendor === false,
    "Buyer initial form should preconfigure customer role"
  );
  assert(
    vendorForm.isCustomer === false && vendorForm.isVendor === true,
    "Vendor initial form should preconfigure vendor role"
  );

  const validPayload = formUtils.buildCounterpartyPayload(
    {
      ...buyerForm,
      legalEntityId: "11",
      code: "CP-001",
      name: "Counterparty 001",
      contacts: [
        {
          id: "",
          contactName: "Main Contact",
          email: "main@example.com",
          phone: "",
          title: "",
          isPrimary: true,
          status: "ACTIVE",
        },
      ],
      addresses: [
        {
          id: "",
          addressType: "BILLING",
          addressLine1: "Street 1",
          addressLine2: "",
          city: "",
          stateRegion: "",
          postalCode: "",
          countryId: "",
          isPrimary: true,
          status: "ACTIVE",
        },
      ],
    },
    { mode: "create" }
  );
  assert(
    validPayload.legalEntityId === 11 && validPayload.code === "CP-001",
    "Payload builder should normalize legalEntityId/code"
  );

  const invalidValidation = formUtils.validateCounterpartyForm(
    {
      ...buyerForm,
      legalEntityId: "",
      code: "",
      name: "",
      isCustomer: false,
      isVendor: false,
      contacts: [{ ...formUtils.createEmptyContact(), contactName: "" }],
      addresses: [{ ...formUtils.createEmptyAddress(), addressLine1: "" }],
    },
    { mode: "create" }
  );
  assert(
    invalidValidation.hasErrors === true,
    "Validation helper should catch missing required fields"
  );

  console.log("CARI PR-04 frontend counterparty page smoke test passed.");
  console.log(
    JSON.stringify(
      {
        checkedSidebarRouteCount: expectedSidebarRoutes.length,
        checkedCanonicalRouteCount: expectedCanonicalRoutes.length,
        checkedLegacyAliasRouteCount: expectedLegacyAliasRoutes.length,
        checkedFiles: [appPath, sidebarPath, pagePath, formPath, apiPath, utilsPath].length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
