import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} is missing expected snippet: ${snippet}`);
}

async function readRepoFile(root, relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const reportConfigSource = await readRepoFile(root, "frontend/src/reporting/localReportConfig.js");
  const reportApiSource = await readRepoFile(root, "frontend/src/api/glReports.js");
  const trialBalanceSource = await readRepoFile(root, "frontend/src/pages/TrialBalancePage.jsx");
  const generalLedgerSource = await readRepoFile(root, "frontend/src/pages/GeneralLedgerPage.jsx");
  const statementSource = await readRepoFile(root, "frontend/src/pages/LocalStatementPage.jsx");
  const openApiSource = await readRepoFile(root, "backend/openapi.yaml");

  const requiredRoutes = [
    { key: "trialBalance", appPath: "/app/mizan-raporu" },
    { key: "generalLedger", appPath: "/app/defter-i-kebir" },
    { key: "subsidiaryLedger", appPath: "/app/muavin" },
    { key: "balanceSheet", appPath: "/app/bilanco" },
    { key: "incomeStatement", appPath: "/app/gelir-tablosu" },
  ];

  for (const route of requiredRoutes) {
    assertIncludes(
      reportConfigSource,
      `key: "${route.key}"`,
      `Local report config key for ${route.appPath}`
    );
    assertIncludes(
      reportConfigSource,
      `appPath: "${route.appPath}"`,
      `Local report config app path for ${route.key}`
    );
    assertIncludes(
      reportConfigSource,
      "implemented: true",
      `Local report config implemented flag for ${route.key}`
    );
  }

  assertIncludes(
    reportApiSource,
    'export const LOCAL_REPORT_CONTEXT_QUERY_KEYS = Object.freeze([',
    "Local report context query key export"
  );
  assertIncludes(
    reportApiSource,
    '"closePackId"',
    "closePackId report context key"
  );
  assertIncludes(
    reportApiSource,
    '"closeLaunchMode"',
    "closeLaunchMode report context key"
  );
  assertIncludes(
    reportApiSource,
    "export function appendLocalReportContextParams",
    "Local report context append helper"
  );

  for (const [label, source] of [
    ["TrialBalancePage", trialBalanceSource],
    ["GeneralLedgerPage", generalLedgerSource],
    ["LocalStatementPage", statementSource],
  ]) {
    assertIncludes(source, "LocalCloseReportBanner", `${label} close-report banner wiring`);
    assertIncludes(
      source,
      "appendLocalReportContextParams",
      `${label} close-context query preservation`
    );
  }

  for (const apiPath of [
    "/api/v1/gl/trial-balance",
    "/api/v1/gl/ledger-report",
    "/api/v1/gl/balance-sheet-report",
    "/api/v1/gl/income-statement-report",
    "/api/v1/gl/statement-account-summary",
  ]) {
    assertIncludes(openApiSource, `"${apiPath}"`, `OpenAPI path ${apiPath}`);
  }

  console.log(
    "RS-REP-01 passed (local report-family routes, close-context wiring, and OpenAPI export are present)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
