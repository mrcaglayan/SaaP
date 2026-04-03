import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import {
  assertApprovalAssignmentNarrowsPolicyScope,
  validateApprovalPolicyDraft,
} from "../src/services/approval.policy.validation.service.js";

const TENANT_ID = 777;

function buildMockRunQuery() {
  return async (sql, params = []) => {
    const normalizedSql = String(sql || "").replace(/\s+/g, " ").trim();

    if (normalizedSql.includes("FROM group_companies")) {
      const [, groupId] = params;
      if (Number(groupId) === 10) {
        return { rows: [{ id: 10 }] };
      }
      return { rows: [] };
    }

    if (normalizedSql.includes("FROM countries")) {
      const [countryId] = params;
      if (Number(countryId) === 20 || Number(countryId) === 21) {
        return { rows: [{ id: Number(countryId) }] };
      }
      return { rows: [] };
    }

    if (
      normalizedSql.includes("FROM legal_entities") &&
      !normalizedSql.includes("JOIN legal_entities")
    ) {
      const [, legalEntityId] = params;
      if (Number(legalEntityId) === 100) {
        return { rows: [{ id: 100, group_company_id: 10, country_id: 20 }] };
      }
      if (Number(legalEntityId) === 101) {
        return { rows: [{ id: 101, group_company_id: 10, country_id: 21 }] };
      }
      if (Number(legalEntityId) === 102) {
        return { rows: [{ id: 102, group_company_id: 11, country_id: 20 }] };
      }
      return { rows: [] };
    }

    if (normalizedSql.includes("FROM operating_units ou")) {
      const [, operatingUnitId] = params;
      if (Number(operatingUnitId) === 500) {
        return {
          rows: [{ id: 500, legal_entity_id: 100, group_company_id: 10, country_id: 20 }],
        };
      }
      if (Number(operatingUnitId) === 501) {
        return {
          rows: [{ id: 501, legal_entity_id: 101, group_company_id: 10, country_id: 21 }],
        };
      }
      if (Number(operatingUnitId) === 502) {
        return {
          rows: [{ id: 502, legal_entity_id: 102, group_company_id: 11, country_id: 20 }],
        };
      }
      return { rows: [] };
    }

    throw new Error(`Unexpected mock query in PR-3A test: ${normalizedSql}`);
  };
}

async function assertTablesExist() {
  const expectedTables = [
    "approval_policies",
    "approval_policy_assignments",
    "approval_policy_steps",
    "approval_requests",
    "approval_decisions",
  ];

  const tableRes = await query(`SHOW TABLES LIKE 'approval_%'`);
  const actualTables = tableRes.rows
    .map((row) => Object.values(row)[0])
    .filter(Boolean)
    .sort();

  assert.deepEqual(
    actualTables,
    [...expectedTables].sort(),
    "PR-3A tables should exist after migration"
  );

  const approvalPoliciesColumns = await query(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'approval_policies'
       AND column_name IN (
         'module_code',
         'version_no',
         'scope_type',
         'scope_id',
         'approver_permission_code'
       )`
  );
  assert.equal(
    approvalPoliciesColumns.rows.length,
    5,
    "approval_policies should include the generic policy columns"
  );

  const requestColumns = await query(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'approval_requests'
       AND column_name IN (
         'request_status',
         'execution_status',
         'scope_type',
         'scope_id',
         'policy_version_no'
       )`
  );
  assert.equal(
    requestColumns.rows.length,
    5,
    "approval_requests should separate review status, execution status, and explicit scope"
  );

  const uniqueReviewerIndex = await query(
    `SELECT INDEX_NAME AS index_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'approval_decisions'
       AND index_name = 'uk_approval_decisions_request_step_reviewer'
     GROUP BY index_name`
  );
  assert.equal(
    uniqueReviewerIndex.rows.length,
    1,
    "approval_decisions should enforce reviewer-unique counting per request step"
  );
}

async function assertScopeValidation() {
  const runQuery = buildMockRunQuery();

  await assert.doesNotReject(async () =>
    assertApprovalAssignmentNarrowsPolicyScope({
      tenantId: TENANT_ID,
      policyScope: { scopeType: "TENANT", scopeId: TENANT_ID },
      assignmentScope: { scopeType: "COUNTRY", scopeId: 20 },
      runQuery,
    })
  );

  await assert.doesNotReject(async () =>
    assertApprovalAssignmentNarrowsPolicyScope({
      tenantId: TENANT_ID,
      policyScope: { scopeType: "LEGAL_ENTITY", scopeId: 100 },
      assignmentScope: { scopeType: "OPERATING_UNIT", scopeId: 500 },
      runQuery,
    })
  );

  await assert.rejects(
    () =>
      assertApprovalAssignmentNarrowsPolicyScope({
        tenantId: TENANT_ID,
        policyScope: { scopeType: "LEGAL_ENTITY", scopeId: 100 },
        assignmentScope: { scopeType: "LEGAL_ENTITY", scopeId: 101 },
        runQuery,
      }),
    /must narrow or match the policy scope/i,
    "Different legal entities should not be accepted as a narrowing assignment"
  );

  await assert.rejects(
    () =>
      assertApprovalAssignmentNarrowsPolicyScope({
        tenantId: TENANT_ID,
        policyScope: { scopeType: "GROUP", scopeId: 10 },
        assignmentScope: { scopeType: "COUNTRY", scopeId: 20 },
        runQuery,
      }),
    /must narrow or match the policy scope/i,
    "Cross-axis country assignments should not pass as a narrower group scope"
  );

  await assert.doesNotReject(async () =>
    validateApprovalPolicyDraft({
      tenantId: TENANT_ID,
      policy: {
        scopeType: "COUNTRY",
        scopeId: 20,
        minApprovals: 1,
        stepCount: 2,
      },
      assignments: [{ scopeType: "LEGAL_ENTITY", scopeId: 100 }],
      steps: [
        {
          stepNo: 1,
          requiredPermissionCode: "approvals.requests.approve",
          minApprovals: 1,
        },
        {
          stepNo: 2,
          requiredPermissionCode: "approvals.requests.approve",
          minApprovals: 1,
        },
      ],
      runQuery,
    })
  );

  await assert.rejects(
    () =>
      validateApprovalPolicyDraft({
        tenantId: TENANT_ID,
        policy: {
          scopeType: "COUNTRY",
          scopeId: 20,
          minApprovals: 1,
          stepCount: 2,
        },
        assignments: [{ scopeType: "LEGAL_ENTITY", scopeId: 100 }],
        steps: [
          {
            stepNo: 1,
            requiredPermissionCode: "approvals.requests.approve",
            minApprovals: 1,
          },
          {
            stepNo: 1,
            requiredPermissionCode: "approvals.requests.approve",
            minApprovals: 1,
          },
        ],
        runQuery,
      }),
    /stepNo values must be unique/i,
    "Duplicate step numbers should be rejected before persistence"
  );
}

async function main() {
  try {
    await assertTablesExist();
    await assertScopeValidation();
    console.log("PR-3A generic approval schema checks passed");
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
