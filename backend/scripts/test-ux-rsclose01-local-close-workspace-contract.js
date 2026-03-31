import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listLocalClosePacks } from "../src/services/local.close-packs.service.js";
import {
  listLocalClosePackAuditTrail,
  listLocalClosePackReportReviews,
} from "../src/services/local.close-pack.workspace.service.js";
import { parseLocalClosePackAuditListInput } from "../src/routes/local.close-packs.validators.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} is missing expected snippet: ${snippet}`);
}

async function readRepoFile(root, relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

function createPackRow(overrides = {}) {
  return {
    id: 6,
    tenant_id: 1,
    legal_entity_id: 11,
    legal_entity_code: "LE1",
    legal_entity_name: "Legal Entity 1",
    book_id: 21,
    book_code: "STAT",
    book_name: "Stat Book",
    fiscal_period_id: 31,
    fiscal_year: 2026,
    period_no: 3,
    period_name: "Mart",
    close_scope_type: "OPERATING_UNIT",
    scope_key: "OU-101",
    operating_unit_id: 101,
    operating_unit_code: "OU-101",
    operating_unit_name: "Ankara Branch",
    status: "IN_PROGRESS",
    note: "first-pass pack",
    owner_user_id: 91,
    owner_user_name: "Owner User",
    reviewer_user_id: 92,
    reviewer_user_name: "Reviewer User",
    workflow_instance_id: 501,
    workflow_instance_status: "OPEN",
    workflow_current_step_no: 2,
    pending_reopen_request_count: 1,
    evidence_count: 0,
    comment_count: 2,
    report_review_count: 3,
    last_report_reviewed_at: "2026-03-31T10:05:00.000Z",
    last_evidence_at: null,
    last_comment_at: "2026-03-31T10:10:00.000Z",
    last_audit_at: "2026-03-31T10:15:00.000Z",
    submitted_at: "2026-03-31T09:00:00.000Z",
    approved_at: null,
    locked_at: null,
    reopened_at: null,
    created_by_user_id: 91,
    created_by_user_name: "Owner User",
    updated_by_user_id: 92,
    updated_by_user_name: "Reviewer User",
    created_at: "2026-03-31T08:00:00.000Z",
    updated_at: "2026-03-31T09:30:00.000Z",
    ...overrides,
  };
}

async function runWorkspaceMetricScenario() {
  const row = createPackRow();
  const runQuery = async (sql) => {
    if (sql.includes("FROM local_close_packs lcp")) {
      return { rows: [row] };
    }
    throw new Error(`Unexpected workspace query in RS-CLOSE-01: ${sql}`);
  };

  const result = await listLocalClosePacks({
    req: { user: { tenantId: 1 } },
    tenantId: 1,
    filters: { limit: 20, offset: 0 },
    assertScopeAccess: () => {},
    runQuery,
  });

  assertEqual(result.total, 1, "Workspace list should return one visible pack");
  const pack = result.rows[0];
  assert(pack, "Workspace list should return a mapped pack row");
  assertEqual(pack.requiredReportCount, 5, "Workspace should expose five required report reviews");
  assertEqual(pack.reportReviewCount, 3, "Workspace should map reviewed-report count");
  assertEqual(pack.completionPercentage, 60, "Workspace completion should derive from reviewed reports");
  assertEqual(pack.blockerCount, 2, "Workspace blockers should track remaining required report reviews");
  assertEqual(pack.warningCount, 2, "Workspace warnings should include pending reopens and missing evidence");
  assertEqual(
    pack.lastActivityAt,
    "2026-03-31T10:15:00.000Z",
    "Workspace should pick the latest activity timestamp across report/evidence/comment/audit"
  );
}

async function runReportReviewScenario() {
  const runQuery = async (sql) => {
    if (sql.includes("FROM local_close_packs lcp")) {
      return { rows: [createPackRow()] };
    }
    if (sql.includes("FROM local_close_pack_report_reviews reviews")) {
      return {
        rows: [
          {
            id: 77,
            tenant_id: 1,
            local_close_pack_id: 6,
            report_key: "trialBalance",
            route_path: "/app/mizan-raporu",
            launch_mode: "PACK_SCOPE",
            query_json: JSON.stringify({ bookId: 21, closePackId: 6 }),
            response_snapshot_json: JSON.stringify({ rowCount: 12 }),
            fingerprint_sha256: "abc123",
            review_note: "Reviewed from close pack",
            reviewed_by_user_id: 92,
            reviewed_by_user_name: "Reviewer User",
            reviewed_at: "2026-03-31T10:05:00.000Z",
            created_at: "2026-03-31T10:05:00.000Z",
            updated_at: "2026-03-31T10:05:00.000Z",
          },
        ],
      };
    }
    throw new Error(`Unexpected report review query in RS-CLOSE-01: ${sql}`);
  };

  const rows = await listLocalClosePackReportReviews({
    req: { user: { tenantId: 1 } },
    tenantId: 1,
    packId: 6,
    assertScopeAccess: () => {},
    runQuery,
  });

  assertEqual(rows.length, 1, "Report review list should return one review row");
  assertEqual(rows[0].reportKey, "trialBalance", "Report review should preserve the report key");
  assertEqual(rows[0].query.closePackId, 6, "Report review should parse the saved query payload");
  assertEqual(rows[0].responseSnapshot.rowCount, 12, "Report review should parse the saved snapshot payload");
}

async function runAuditScenario() {
  const queryLog = [];
  const runQuery = async (sql, params = []) => {
    queryLog.push({ sql, params });
    if (sql.includes("FROM local_close_packs lcp")) {
      return { rows: [createPackRow()] };
    }
    if (sql.includes("SELECT COUNT(*) AS total") && sql.includes("FROM audit_logs al")) {
      return { rows: [{ total: 1 }] };
    }
    if (sql.includes("FROM audit_logs al") && sql.includes("LEFT JOIN users")) {
      return {
        rows: [
          {
            id: 901,
            tenant_id: 1,
            action: "local_close_pack.reviewed_report_saved",
            resource_type: "local_close_pack",
            resource_id: "6",
            scope_type: "OPERATING_UNIT",
            scope_id: 101,
            user_id: 92,
            actor_email: "reviewer@example.com",
            actor_name: "Reviewer User",
            request_id: "req-1",
            ip_address: "127.0.0.1",
            user_agent: "rsclose01",
            created_at: "2026-03-31T10:15:00.000Z",
            payload_json: JSON.stringify({
              localClosePackId: 6,
              reportKey: "trialBalance",
            }),
          },
        ],
      };
    }
    throw new Error(`Unexpected audit query in RS-CLOSE-01: ${sql}`);
  };

  const parsedInput = parseLocalClosePackAuditListInput({
    user: { tenantId: 1 },
    params: { packId: "6" },
    query: { limit: "100", includePayload: "true" },
  });
  assertEqual(parsedInput.includePayload, true, "Audit validator should parse includePayload boolean flags");
  assertEqual(parsedInput.limit, 100, "Audit validator should preserve the requested limit");

  const result = await listLocalClosePackAuditTrail({
    req: { user: { tenantId: 1 } },
    tenantId: 1,
    packId: 6,
    limit: parsedInput.limit,
    offset: parsedInput.offset,
    includePayload: parsedInput.includePayload,
    assertScopeAccess: () => {},
    runQuery,
  });

  assertEqual(result.total, 1, "Audit trail should return the counted audit rows");
  assertEqual(result.rows.length, 1, "Audit trail should return one audit row");
  assertEqual(result.rows[0].payload.localClosePackId, 6, "Audit trail should expose payload JSON when requested");

  const auditQueryCalls = queryLog.filter(
    ({ sql }) =>
      sql.includes("SELECT COUNT(*) AS total") ||
      sql.includes("LEFT JOIN users\n         ON users.tenant_id = al.tenant_id")
  );
  assert(auditQueryCalls.length >= 2, "Audit scenario should execute count and row queries");
  for (const call of auditQueryCalls) {
    assertEqual(typeof call.params[1], "number", "Audit lookup should bind numeric pack id for resource_id comparison");
    assertEqual(typeof call.params[2], "number", "Audit lookup should bind numeric pack id for payload comparison");
  }
}

async function runFrontendAndOpenApiScenario() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSource = await readRepoFile(root, "frontend/src/App.jsx");
  const workspaceSource = await readRepoFile(root, "frontend/src/pages/LocalCloseWorkspacePage.jsx");
  const detailSource = await readRepoFile(root, "frontend/src/pages/LocalClosePackDetailPage.jsx");
  const bannerSource = await readRepoFile(root, "frontend/src/components/LocalCloseReportBanner.jsx");
  const openApiSource = await readRepoFile(root, "backend/openapi.yaml");

  assertIncludes(
    appSource,
    'appPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri"',
    "Local close workspace route"
  );
  assertIncludes(
    appSource,
    'appPath: "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/:packId"',
    "Local close detail route"
  );
  for (const tabKey of [
    '"overview"',
    '"checklist"',
    '"reports"',
    '"exceptions"',
    '"evidence"',
    '"comments"',
    '"audit"',
  ]) {
    assertIncludes(detailSource, tabKey, `Local close detail tab ${tabKey}`);
  }
  assertIncludes(
    detailSource,
    '"ENTITY_STATEMENT_FALLBACK"',
    "Local close detail statutory fallback launch mode"
  );
  assertIncludes(
    workspaceSource,
    "Local close pack already exists. Opening the existing pack.",
    "Duplicate-pack recovery message"
  );
  assertIncludes(
    bannerSource,
    "Launched from local close pack",
    "Local close report banner copy"
  );

  for (const apiPath of [
    "/api/v1/gl/local-close-packs",
    "/api/v1/gl/local-close-packs/{packId}",
    "/api/v1/gl/local-close-packs/{packId}/report-reviews",
    "/api/v1/gl/local-close-packs/{packId}/evidence",
    "/api/v1/gl/local-close-packs/{packId}/comments",
    "/api/v1/gl/local-close-packs/{packId}/audit",
    "/api/v1/gl/local-close-packs/{packId}/reopen-requests",
  ]) {
    assertIncludes(openApiSource, `"${apiPath}"`, `OpenAPI path ${apiPath}`);
  }
}

async function main() {
  await runWorkspaceMetricScenario();
  await runReportReviewScenario();
  await runAuditScenario();
  await runFrontendAndOpenApiScenario();
  console.log(
    "RS-CLOSE-01 passed (RP07 local close workspace metrics, reviews, audit contract, and route/OpenAPI wiring are in place)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
