import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScriptChain } from "./_run-script-chain.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRunbook(runbookPath) {
  const source = await readFile(runbookPath, "utf8");
  const requiredHeadings = [
    "## Setup Requirements",
    "## Month-End Checklist",
    "## Year-End Checklist",
    "## Rollback and Reversal Procedures",
    "## Reporting Endpoints",
    "## Release Gate Command",
  ];
  for (const heading of requiredHeadings) {
    assert(source.includes(heading), `Runbook heading missing: ${heading}`);
  }

  const lower = source.toLowerCase();
  const requiredKeywords = [
    "exchange",
    "revaluation",
    "settlement",
    "idempotency",
    "override",
    "foreign cash",
  ];
  for (const keyword of requiredKeywords) {
    assert(lower.includes(keyword), `Runbook keyword missing: ${keyword}`);
  }
}

async function assertRouteWiring(backendRoot) {
  const cashReportRoutePath = path.resolve(backendRoot, "src/routes/cash.report.routes.js");
  const cashReportSource = await readFile(cashReportRoutePath, "utf8");
  for (const routeToken of [
    "/exchange-history",
    "/foreign-balances",
    "/revaluation-runs",
  ]) {
    assert(
      cashReportSource.includes(routeToken),
      `Cash report route missing token: ${routeToken}`
    );
  }

  const cariRoutePath = path.resolve(backendRoot, "src/routes/cari.js");
  const cariRouteSource = await readFile(cariRoutePath, "utf8");
  assert(
    cariRouteSource.includes("/reports/settlement-realized-fx"),
    "Cari route missing /reports/settlement-realized-fx"
  );
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const runbookPath = path.resolve(repoRoot, "docs", "runbooks", "cash-fx-exchange-operations.md");

  await runScriptChain({
    title: "PR-EX06 release-gate chain (EX01..EX05)",
    scripts: [
      "test-cash-ex01-schema-backfill.js",
      "test-cash-ex02-foreign-currency-posting.js",
      "test-cash-ex03-exchange-workflow.js",
      "test-cari-ex04-settlement-foreign-cash-usage.js",
      "test-cari-ex04-settlement-fx-persistence.js",
      "test-cari-ex04-frontend-settlement-currency-flow.js",
      "test-cash-ex05-month-end-revaluation.js",
      "test-cash-ex05-year-end-revaluation-and-close-gate.js",
      "test-cash-ex05-revaluation-job-idempotency.js",
    ],
  });

  await assertRunbook(runbookPath);
  await assertRouteWiring(backendRoot);

  console.log("PR-EX06 release-gate checks passed.");
  console.log(
    JSON.stringify(
      {
        runbookPath,
        checkedRoutes: [
          "/api/v1/cash/reports/exchange-history",
          "/api/v1/cash/reports/foreign-balances",
          "/api/v1/cash/reports/revaluation-runs",
          "/api/v1/cari/reports/settlement-realized-fx",
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("PR-EX06 release-gate checks failed.");
  console.error(error);
  process.exitCode = 1;
});
