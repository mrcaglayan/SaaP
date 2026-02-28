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

  const jobsRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/jobs.admin.routes.js"),
    "utf8"
  );
  const jobsServiceSource = await readFile(
    path.resolve(root, "backend/src/services/jobs.service.js"),
    "utf8"
  );
  const jobsApiSource = await readFile(
    path.resolve(root, "frontend/src/api/jobsAdmin.js"),
    "utf8"
  );
  const opsDashboardPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/OpsDashboardPage.jsx"),
    "utf8"
  );

  assert(
    jobsRoutesSource.includes('router.get(\n  "/"') &&
      jobsRoutesSource.includes('router.get(\n  "/:id"') &&
      jobsRoutesSource.includes('"/:id/requeue"') &&
      jobsRoutesSource.includes('"/:id/cancel"') &&
      jobsRoutesSource.includes('"/run-once"'),
    "Jobs admin routes should expose list/detail/requeue/cancel/run-once endpoints"
  );

  assert(
    jobsServiceSource.includes("export async function listJobs") &&
      jobsServiceSource.includes("export async function getJobById") &&
      jobsServiceSource.includes("export async function requeueJob") &&
      jobsServiceSource.includes("export async function cancelJob") &&
      jobsServiceSource.includes("export async function runOneAvailableJob"),
    "Jobs service should support list/detail/manage/run-once capabilities"
  );

  assert(
    jobsApiSource.includes('api.get("/api/v1/jobs"') &&
      jobsApiSource.includes('api.get(`/api/v1/jobs/${Number(jobId)}`)') &&
      jobsApiSource.includes('api.post(`/api/v1/jobs/${Number(jobId)}/requeue`') &&
      jobsApiSource.includes('api.post(`/api/v1/jobs/${Number(jobId)}/cancel`') &&
      jobsApiSource.includes('api.post("/api/v1/jobs/run-once"'),
    "Frontend jobs admin API client should wire list/detail/requeue/cancel/run-once calls"
  );

  assert(
    opsDashboardPageSource.includes("Jobs Queue (Progress + Retry)") &&
      opsDashboardPageSource.includes("listJobsAdmin") &&
      opsDashboardPageSource.includes("getJobAdmin") &&
      opsDashboardPageSource.includes("handleRequeueJob") &&
      opsDashboardPageSource.includes("handleCancelJob") &&
      opsDashboardPageSource.includes("handleRunOneJob") &&
      opsDashboardPageSource.includes("Missing permission: ops.jobs.read"),
    "Ops Dashboard should include jobs queue progress/retry UX with permission-aware actions"
  );

  console.log("PR-CORE04 smoke test passed (jobs progress/retry UX wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

