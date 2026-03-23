import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROUTE_WIRING_RULES = [
  {
    routePath: "/app/ayarlar/operasyon-dashboard",
    apiNeedles: ["../api/opsDashboard.js", "../api/jobsAdmin.js"],
  },
  {
    routePath: "/app/ayarlar/exception-workbench",
    apiNeedles: ["../api/exceptionsWorkbench.js"],
  },
  {
    routePath: "/app/alis-faturalari",
    apiNeedles: ["../../api/cariDocuments.js"],
  },
  {
    routePath: "/app/satis-faturalari",
    apiNeedles: ["../../api/cariDocuments.js"],
  },
  {
    routePath: "/app/tedarikci-odemeler",
    apiNeedles: ["../../api/cariSettlements.js"],
  },
  {
    routePath: "/app/musteri-tahsilatlar",
    apiNeedles: ["../../api/cariSettlements.js"],
  },
  {
    routePath: "/app/ayarlar/cari-denetim",
    apiNeedles: ["../../api/cariAudit.js"],
  },
  {
    routePath: "/app/musteri-kartlari",
    apiNeedles: ["../../api/cariCounterparty.js"],
  },
  {
    routePath: "/app/tedarikci-kartlari",
    apiNeedles: ["../../api/cariCounterparty.js"],
  },
  {
    routePath: "/app/tedarikci-raporlari",
    apiNeedles: ["../../api/cariReports.js"],
  },
  {
    routePath: "/app/musteri-raporlari",
    apiNeedles: ["../../api/cariReports.js"],
  },
  {
    routePath: "/app/kasa-islemleri",
    apiNeedles: ["../../api/cashAdmin.js"],
  },
  {
    routePath: "/app/kasa-oturumlari",
    apiNeedles: ["../../api/cashAdmin.js"],
  },
  {
    routePath: "/app/kasa-transit-transferleri",
    apiNeedles: ["../../api/cashAdmin.js"],
  },
  {
    routePath: "/app/stok-transferleri",
    apiNeedles: ["../../api/inventory.js"],
  },
  {
    routePath: "/app/contracts",
    apiNeedles: ["../../api/contracts.js"],
  },
  {
    routePath: "/app/payroll-runs",
    apiNeedles: ["../../api/payrollRuns.js"],
  },
  {
    routePath: "/app/payroll-close-controls",
    apiNeedles: ["../../api/payrollClose.js"],
  },
];

function resolveRouteComponentName(appSource, routePath) {
  const routeRegex = new RegExp(
    `appPath:\\s*"${escapeForRegex(routePath)}"[\\s\\S]*?element:\\s*<([A-Za-z0-9_]+)`,
    "m"
  );
  const match = appSource.match(routeRegex);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

function resolveComponentImportPath(appSource, componentName) {
  const importRegex = new RegExp(
    `import\\s+${escapeForRegex(componentName)}\\s+from\\s+"([^"]+)"`,
    "m"
  );
  const match = appSource.match(importRegex);
  return match?.[1] || null;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appPath = path.resolve(root, "frontend/src/App.jsx");
  const sidebarPath = path.resolve(root, "frontend/src/layouts/sidebarConfig.js");
  const messagesPath = path.resolve(root, "frontend/src/i18n/messages.js");

  const [appSource, sidebarSource, messagesSource] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(sidebarPath, "utf8"),
    readFile(messagesPath, "utf8"),
  ]);

  assert(
    messagesSource.includes("cariSplit:") &&
      messagesSource.includes("vendorBills:") &&
      messagesSource.includes("salesInvoices:") &&
      messagesSource.includes("vendors:") &&
      messagesSource.includes("customers:") &&
      messagesSource.includes("apPayments:") &&
      messagesSource.includes("arReceipts:"),
    "messages.js split-route labels missing from cariSplit block"
  );

  for (const rule of ROUTE_WIRING_RULES) {
    const routePath = rule.routePath;

    assert(
      appSource.includes(`appPath: "${routePath}"`),
      `App.jsx route missing for ${routePath}`
    );
    assert(
      sidebarSource.includes(`to: "${routePath}"`),
      `sidebarConfig.js link missing for ${routePath}`
    );
    const componentName = resolveRouteComponentName(appSource, routePath);
    assert(componentName, `Could not resolve component from App route ${routePath}`);
    assert(
      componentName !== "Navigate",
      `Route ${routePath} resolved to Navigate alias; use canonical page route in RS-WIRE-01 checks`
    );

    const importPath = resolveComponentImportPath(appSource, componentName);
    assert(
      importPath,
      `Could not resolve App.jsx import path for component ${componentName} (${routePath})`
    );

    const componentFilePath = path.resolve(root, "frontend/src", importPath.replace("./", ""));
    const componentSource = await readFile(componentFilePath, "utf8");
    const apiNeedles = Array.isArray(rule.apiNeedles) ? rule.apiNeedles : [];
    assert(
      apiNeedles.length > 0,
      `No API wiring needles configured for ${routePath}; add at least one api import needle`
    );
    for (const apiNeedle of apiNeedles) {
      assert(
        componentSource.includes(apiNeedle),
        `API client wiring missing in ${componentName} for ${routePath}: expected import containing ${apiNeedle}`
      );
    }
  }

  console.log(
    "RS-WIRE-01 smoke test passed (route/sidebar/messages/API wiring checks for improvement routes)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
