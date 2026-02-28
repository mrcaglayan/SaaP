import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const runDetailSource = await readFile(
    path.resolve(root, "frontend/src/pages/payroll/PayrollRunDetailPage.jsx"),
    "utf8"
  );
  const closeControlsSource = await readFile(
    path.resolve(root, "frontend/src/pages/payroll/PayrollCloseControlsPage.jsx"),
    "utf8"
  );

  assert(
    runDetailSource.includes('import StatusTimeline from "../../components/StatusTimeline.jsx";'),
    "PayrollRunDetailPage should import StatusTimeline"
  );
  assert(
    runDetailSource.includes("buildPayrollRunLifecycleEvents"),
    "PayrollRunDetailPage should map payroll run timestamps into lifecycle events"
  );
  assert(
    runDetailSource.includes('getLifecycleStatusMeta("payrollRun"') &&
      runDetailSource.includes('getLifecycleAllowedActions("payrollRun"') &&
      runDetailSource.includes('buildLifecycleTimelineSteps("payrollRun"'),
    "PayrollRunDetailPage should use shared lifecycle helpers for payrollRun"
  );
  assert(
    runDetailSource.includes("Lifecycle Snapshot") &&
      runDetailSource.includes("<StatusTimeline") &&
      runDetailSource.includes("Payroll Run Lifecycle Timeline"),
    "PayrollRunDetailPage should render lifecycle snapshot + timeline"
  );

  assert(
    closeControlsSource.includes('import StatusTimeline from "../../components/StatusTimeline.jsx";'),
    "PayrollCloseControlsPage should import StatusTimeline"
  );
  assert(
    closeControlsSource.includes("buildPayrollCloseLifecycleEvents"),
    "PayrollCloseControlsPage should map close timestamps/audit into lifecycle events"
  );
  assert(
    closeControlsSource.includes('getLifecycleStatusMeta("payrollClose"') &&
      closeControlsSource.includes('getLifecycleAllowedActions("payrollClose"') &&
      closeControlsSource.includes('buildLifecycleTimelineSteps(\n        "payrollClose"'),
    "PayrollCloseControlsPage should use shared lifecycle helpers for payrollClose"
  );
  assert(
    closeControlsSource.includes("Lifecycle Snapshot") &&
      closeControlsSource.includes("<StatusTimeline") &&
      closeControlsSource.includes("Payroll Close Lifecycle Timeline"),
    "PayrollCloseControlsPage should render lifecycle snapshot + timeline"
  );

  console.log(
    "PR-UX17 smoke test passed (Payroll run + payroll close lifecycle snapshot/timeline wiring)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
