# Consolidation Requirement Analysis
## Complete Step-by-Step Flow (Backward from Execution)

**Document Date:** 2026-04-15  
**Version:** 1.0

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [High-Level Consolidation Flow](#high-level-consolidation-flow)
3. [Detailed Step-by-Step Breakdown (Backward Approach)](#detailed-step-by-step-breakdown)
4. [Role-Based Permissions Matrix](#role-based-permissions-matrix)
5. [User Configuration & Prerequisites](#user-configuration--prerequisites)
6. [End-to-End Example Scenarios](#end-to-end-example-scenarios)

---

## Executive Summary

The consolidation process is a multi-stage, controlled workflow that transforms local entity financial data into group-level consolidated reports. The system enforces data integrity through canonical mapping governance, workflow approvals, and audit trails at each step.

### Key Principles
- **Separation of Duties:** Mapping changes, execution, adjustments, and finalization require different roles
- **Governance Gates:** Mandatory readiness checks and mapping coverage validation before execution
- **Audit Trail:** All mapping changes, overrides, and execution events are recorded with source attribution
- **Role-Based Control:** Permissions are granular, scoped to consolidation group and organizational level

---

## High-Level Consolidation Flow

```
STEP 1: Prepare Consolidation Context
├─ Define Consolidation Groups
├─ Assign Group Members (Legal Entities)
└─ Configure Chart of Accounts Mappings

STEP 2: Map Financial Accounts (Canonical Mappings)
├─ Preview Mapping Candidates
├─ Apply Safe Deterministic Mappings
├─ Create Manual Mappings (Local → Canonical → Group)
├─ Define Bulk Rules for Reusable Patterns
└─ Review Mapping Governance & Coverage

STEP 3: Prepare Run & Validate Readiness
├─ Create Consolidation Run
├─ Open Run Compatibility Snapshot
├─ Verify Canonical Mapping Coverage = 100%
└─ Review Eliminated Accounts

STEP 4: Execute Consolidation
├─ Trigger Execute Endpoint (POST /api/v1/consolidation/runs/:runId/execute)
├─ System Calculates Consolidated Balances
├─ FX Revaluation Applied
└─ Generate Trial Balance & Reports

STEP 5: Post Adjustments & Eliminations (Optional)
├─ Create Adjustment Entries (Group-level journal)
├─ Create Elimination Entries (Intercompany, consolidation adjustments)
├─ Post Draft Entries to Consolidation Ledger
└─ Review Posted Adjustments

STEP 6: Finalize & Lock Run
├─ Review Final Consolidated Reports
├─ Finalize Run (Mark as COMPLETED/LOCKED)
├─ Emit Audit Events for Finalization
└─ Generate Final Export/Signoff
```

---

## Detailed Step-by-Step Breakdown

### STEP 6: FINALIZE CONSOLIDATION RUN (Backward Step 1)

**Endpoint:** `POST /api/v1/consolidation/runs/:runId/finalize`

**Prerequisite States:**
- Run status: `COMPLETED` (from Execute step)
- Adjustment & elimination entries are posted (if applicable)
- Final reports have been reviewed
- Approval workflow complete (if `FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1` enabled)

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Run Manager / CFO** | `consolidation.run.finalize` | GROUP | <ul><li>Sign-off on final consolidated reports</li><li>Trigger finalization</li><li>Lock run from further edits</li></ul> |
| **Group Reporting Controller** (Recommended) | `consolidation.run.finalize` | GROUP | Primary finalization authority |

**Configuration Example:**
```
User: CFO_USER_001 (Sarah Finance)
├─ Role: GroupReportingController (or custom consolidation role)
├─ Permissions:
│  ├─ consolidation.run.finalize
│  ├─ consolidation.run.read
│  └─ consolidation.report.*  (all report read access)
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-01-01 onwards
```

**Data Changes:**
- `consolidation_runs.status` → `LOCKED`
- `consolidation_runs.finished_at` → CURRENT_TIMESTAMP
- Audit log entry: `action=consolidation.run.finalize, userId=CFO_USER_001`

---

### STEP 5: POST ADJUSTMENTS & ELIMINATIONS (Backward Step 2)

**Endpoints:**
- Create adjustment: `POST /api/v1/consolidation/runs/:runId/adjustments`
- Post adjustment: `POST /api/v1/consolidation/runs/:runId/adjustments/:adjId/post`
- Create elimination: `POST /api/v1/consolidation/runs/:runId/eliminations`
- Post elimination: `POST /api/v1/consolidation/runs/:runId/eliminations/:elimId/post`

**Prerequisite States:**
- Run has status: `COMPLETED` (after Execute in Step 4)
- Run is NOT LOCKED yet
- All mapped source journals are available

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Adjustment Operator** | `consolidation.adjustment.create`, `consolidation.adjustment.post` | GROUP | <ul><li>Create group-level adjustment entries</li><li>Post to consolidation ledger</li></ul> |
| **Consolidation Elimination Operator** | `consolidation.elimination.create`, `consolidation.elimination.post` | GROUP | <ul><li>Create intercompany elimination entries</li><li>Post consolidation-specific eliminations</li></ul> |
| **GL Posting Authority** (Optional companion) | `glposting.manual_post` | COUNTRY | If adjustments integrate with GL posting workflow |

**Configuration Examples:**

```
User: ADJUSTER_USER_001 (Maria Adjustments)
├─ Role: ConsolidationAdjustmentOperator (custom role)
├─ Permissions:
│  ├─ consolidation.adjustment.create
│  ├─ consolidation.adjustment.post
│  ├─ consolidation.run.read
│  ├─ consolidation.elimination_placeholder.read
│  └─ gladdress.read  (for GL code selection)
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

```
User: ELIM_USER_001 (David Eliminations)
├─ Role: ConsolidationEliminationOperator (custom role)
├─ Permissions:
│  ├─ consolidation.elimination.create
│  ├─ consolidation.elimination.post
│  ├─ consolidation.run.read
│  ├─ consolidation.elimination_placeholder.read
│  └─ consolidation.coa_mapping.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**Data Changes:**
- `consolidation_run_entries` → INSERT for adjustment entries
- `consolidation_run_entries` → INSERT for elimination entries
- Audit log entries: `action=consolidation.adjustment.create/post`, `action=consolidation.elimination.post`

**Governance Notes:**
- Run must NOT be LOCKED to accept adjustments/eliminations
- Each entry requires valid GL account mapping
- High-risk remaps require audit reason field
- May trigger approval workflow if configured

---

### STEP 4: EXECUTE CONSOLIDATION (Backward Step 3)

**Endpoint:** `POST /api/v1/consolidation/runs/:runId/execute`

**Prerequisite States:**
- Run status: `READY` (from Step 3 preparation)
- Run must pass compatibility snapshot check:
  - `compatibility.subaccounts.checks.canonicalMappingCoverage === true`
  - All unmapped accounts must be resolved
- No LOCKED run entries exist
- Fiscal period and FX rates configured

**Request Payload:**
```json
{
  "rateType": "CLOSING"  // or "SPOT", "AVERAGE"
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Execute Operator** | `consolidation.run.execute` | GROUP + LEGAL_ENTITY | <ul><li>Verify pre-flight readiness</li><li>Execute consolidation run</li><li>Monitor execution completion</li></ul> |
| **Group Reporting Controller** (Recommended) | `consolidation.run.execute`, `consolidation.run.read`, `consolidation.coa_mapping.read` | GROUP | Primary execution authority |
| **Finance Operations Manager** (Alternative) | `consolidation.run.execute` | GROUP | Secondary execution authority if required |

**Configuration Example:**
```
User: EXEC_USER_001 (Thomas Operations)
├─ Role: GroupReportingController (or ConsolidationExecutor custom role)
├─ Permissions:
│  ├─ consolidation.run.execute    ← KEY PERMISSION
│  ├─ consolidation.run.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.elimination_placeholder.read
│  ├─ consolidation.group.read
│  └─ fxrates.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  ├─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
│  └─ LEGAL_ENTITY: LE_GERMANY, LE_FRANCE, LE_ITALY  (all members)
└─ Effective Date: 2026-02-01 onwards
```

**System Processing:**
1. **Pre-Flight Validation:**
   - Verify `consolidation.run.execute` permission with GROUP + LEGAL_ENTITY scope
   - Check run status is `READY`
   - Load run compatibility snapshot
   - Validate canonical mapping coverage = 100%

2. **Execute Phase:**
   - For each legal entity in group:
     - Load posted journal entries from fiscal period
     - Apply local → canonical → group account mappings
     - Accumulate balances by canonical key and group account
   - Apply FX revaluation (if multi-currency group)
   - Calculate intercompany balances
   - Generate consolidated trial balance

3. **Data Output:**
   - `consolidation_run_entries` → INSERT consolidated balance rows
   - `consolidation_run_entries.status` → `POSTED`
   - `consolidation_runs.status` → `COMPLETED`
   - `consolidation_runs.finished_at` → CURRENT_TIMESTAMP

4. **Audit Trail:**
   - Action: `consolidation.run.execute`
   - Recorded fields: `tenantId`, `runId`, `userId`, `rateType`, `timestamp`
   - If failure occurs: `action=consolidation.execute.failure.canonical_mapping`

**Response:**
```json
{
  "ok": true,
  "runId": 123,
  "status": "COMPLETED",
  "preferredRateType": "CLOSING",
  "insertedRowCount": 2450,
  "totals": {
    "debitSum": 50000000,
    "creditSum": 50000000,
    "balanceByAccountType": {}
  }
}
```

**Failure Handling:**
If execution fails due to canonical mapping coverage:
- HTTP 400 response
- `consolidation_runs.status` → `FAILED`
- Audit event: `CONSOLIDATION_CANONICAL_EXECUTE_FAILURE`
- Error details include: `reasonCounts` (breakdown by failure type) and `sampleRows`
- Common failure codes:
  - `LOCAL_MAPPING_MISSING`: Posting account has no active local→canonical mapping
  - `LOCAL_MAPPING_INACTIVE`: Mapping exists but is outside effective date range
  - `LOCAL_MAPPING_DATE_MISMATCH`: Posting date doesn't match mapping effectiveFrom/effectiveTo
  - `GROUP_MAPPING_MISSING`: Canonical key has no active canonical→group mapping
  - `GROUP_MAPPING_INACTIVE`: Group mapping exists but outside effective date range

**Monitoring & Alerts:**
- Environment variable: `CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES` (default: 60)
- Environment variable: `CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD` (default: 3)
- Alert event: `CONSOLIDATION_CANONICAL_EXECUTE_FAILURE_ALERT` emitted if threshold breached

---

### STEP 3: PREPARE RUN & VALIDATE READINESS (Backward Step 4)

**Primary Endpoint:** `POST /api/v1/consolidation/runs`

**Secondary Validation Endpoints:**
- Check readiness: `GET /api/v1/consolidation/groups/:groupId/canonical-readiness`
- Check run compatibility: `GET /api/v1/consolidation/runs/:runId`

**Prerequisite States:**
- Consolidation group exists with all members assigned (from Step 1)
- All canonical mappings complete and validated (from Step 2)
- Fiscal period exists and is open for consolidation
- FX rates are configured for multi-currency scenarios

**Request Payload (Create Run):**
```json
{
  "consolidationGroupId": 1,
  "fiscalPeriodId": 2,
  "consolidationDateIso": "2026-03-31",
  "preferredFxRateType": "CLOSING"  // default fallback
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Setup Manager** | `consolidation.run.create`, `consolidation.run.read` | GROUP | <ul><li>Create new consolidation run</li><li>Verify readiness before execution</li></ul> |
| **Finance Manager / Group Accountant** | `consolidation.run.create`, `consolidation.coa_mapping.read` | GROUP | Can initiate runs after verifying mappings |

**Configuration Example:**
```
User: SETUP_USER_001 (Alice Setup)
├─ Role: ConsolidationSetupManager (or GroupAccountant)
├─ Permissions:
│  ├─ consolidation.run.create        ← KEY PERMISSION
│  ├─ consolidation.run.read
│  ├─ consolidation.group.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.elimination_placeholder.read
│  ├─ fiscal_period.read
│  └─ fxrates.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**System Processing:**

**A) Create Run Phase:**
```
POST /api/v1/consolidation/runs
│
├─ Validate consolidation.run.create permission
├─ Assert consolidation group belongs to tenant
├─ Assert fiscal period is open
├─ Assert all legal entities in group have no LOCKED runs in same period
│
└─ INSERT consolidation_runs
   ├─ status: 'READY'
   ├─ consolidation_group_id: 1
   ├─ fiscal_period_id: 2
   ├─ consolidation_date: '2026-03-31'
   ├─ created_by_user_id: SETUP_USER_001
   └─ created_at: CURRENT_TIMESTAMP
```

**B) Readiness Validation Phase:**

```
GET /api/v1/consolidation/groups/:groupId/canonical-readiness
│
├─ Load all active canonical mappings for group
├─ Load all unposted journal entries in fiscal period
├─ For each legal entity in group:
│  └─ For each posted account:
│     ├─ Check local mapping exists: (tenantId, groupId, legalEntityId, accountId, effectiveOn)
│     ├─ Check local mapping is ACTIVE
│     ├─ Check date matches: effectiveFrom ≤ consolidationDate ≤ effectiveTo
│     ├─ Check canonical key exists and is ACTIVE
│     ├─ Check group mapping exists: (tenantId, groupId, canonicalKeyId, effectiveOn)
│     └─ Check group mapping is ACTIVE and date matches
│
└─ Return Readiness Snapshot:
   {
     "ready": true|false,
     "coverageDetected": true|false,
     "blockedReason": null | "MISSING_MAPPINGS",
     "summary": {
       "safe": 124,
       "unresolved": 8,
       "missing": 3,
       "ambiguous": 2
     },
     "perEntityReadiness": [
       {
         "legalEntityId": 1,
         "entityCode": "GERMANY_AG",
         "readyCount": 450,
         "unmappedCount": 15
       }
     ]
   }
```

**C) Run Compatibility Snapshot Phase:**

```
GET /api/v1/consolidation/runs/:runId
│
├─ Load run record with status='READY'
│
└─ Return Run Snapshot:
   {
     "id": 123,
     "status": "READY",
     "consolidationGroupId": 1,
     "consolidationDate": "2026-03-31",
     "compatibility": {
       "subaccounts": {
         "checks": {
           "canonicalMappingCoverage": true,    ← MUST BE TRUE before execute
           "legalEntitySetupComplete": true,
           "fxRatesConfigured": true
         }
       },
       "unmappedPostedCount": 0,
       "mappingGaps": []
     }
   }
```

**Validation Checks Before Execute:**
1. ✓ Run status must be `READY` (not COMPLETED, FAILED, or LOCKED)
2. ✓ Canonical mapping coverage must be 100% (`compatibility.subaccounts.checks.canonicalMappingCoverage === true`)
3. ✓ No unmapped posted accounts exist in fiscal period
4. ✓ All mappings have correct effective dates
5. ✓ All group members have posting ledger data
6. ✓ FX rates exist (if multi-currency)

**Data Created:**
- `consolidation_runs` → INSERT row
- Run status: `READY`
- Audit log: `action=consolidation.run.create`

---

### STEP 2: MAP FINANCIAL ACCOUNTS (Canonical Mappings) (Backward Step 5)

**Core Concept:** Three-tier account mapping
```
Local Account (Entity-specific GL account)
           ↓
      Canonical Key (Semantic meaning: e.g., "AR_TRADE", "AP_TRADE", "CASH")
           ↓
   Group COA Account (Consolidated financial statement account)
```

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/v1/consolidation/groups/:groupId/canonical-mappings` | GET | List all mappings |
| `GET /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates` | GET | Preview auto-mapped candidates |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates/apply` | POST | Apply SAFE candidates |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local` | POST | Upsert local mapping |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/group` | POST | Upsert group mapping |
| `GET /api/v1/consolidation/groups/:groupId/canonical-mappings/rules` | GET | List saved mapping rules |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules` | POST | Create reusable rule |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/preview` | POST | Preview rule application |
| `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/apply` | POST | Apply rule to generate local mappings |
| `GET /api/v1/consolidation/groups/:groupId/canonical-governance-review` | GET | Month-end governance snapshot |

---

#### **STEP 2.1: Preview Candidate Mappings**

**Endpoint:** `GET /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates`

**Prerequisites:**
- Consolidation group exists
- Group members (legal entities) are assigned
- Chart of accounts has been configured
- Posted journal entries exist in source systems

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Mapping Reviewer** | `consolidation.coa_mapping.read` | GROUP | <ul><li>Review candidate mappings</li><li>Understand mapping coverage gaps</li><li>Decide which candidates are SAFE to apply</li></ul> |
| **Data Steward / Master Data Manager** | `consolidation.coa_mapping.read` | GROUP | Alternative role for map review |

**Configuration Example:**
```
User: REVIEW_USER_001 (Rebecca Mapping)
├─ Role: ConsolidationMappingReviewer (custom role)
├─ Permissions:
│  ├─ consolidation.coa_mapping.read         ← KEY PERMISSION
│  ├─ consolidation.group.read
│  ├─ consolidation.elimination_placeholder.read
│  └─ chartofaccounts.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**Response Format:**
```json
{
  "candidates": [
    {
      "id": "cand_123",
      "status": "SAFE",
      "localLegalEntityId": 1,
      "localAccountCode": "100000",
      "localAccountName": "Cash in Bank",
      "matchingCriteria": "EXACT_CODE_MATCH",
      "proposedCanonicalKey": "CASH",
      "proposedGroupAccountId": 50,
      "proposedGroupAccountCode": "1000",
      "proposedGroupAccountName": "Cash and Equivalents",
      "riskLevel": "NONE",
      "semanticWarnings": []
    },
    {
      "id": "cand_124",
      "status": "PARTIAL_MAPPING",
      "localLegalEntityId": 2,
      "localAccountCode": "310500",
      "localAccountName": "Vendor Accruals - Various",
      "matchingCriteria": "PARENT_GROUP_MATCH",
      "proposedCanonicalKey": "AP_ACCRUAL",
      "riskLevel": "MEDIUM",
      "semanticWarnings": [
        {
          "type": "ACCOUNT_TYPE_INCONSISTENCY",
          "message": "Local account is LIABILITY but parent is MIXED (includes ASSETS)"
        }
      ]
    },
    {
      "id": "cand_125",
      "status": "AMBIGUOUS_GROUP_MATCH",
      "localLegalEntityId": 3,
      "localAccountCode": "500000",
      "localAccountName": "Revenue",
      "possibleMatches": [
        { "canonicalKey": "REVENUE_PRODUCT", "groupAccountId": 70 },
        { "canonicalKey": "REVENUE_SERVICE", "groupAccountId": 71 }
      ],
      "riskLevel": "HIGH",
      "semanticWarnings": []
    }
  ],
  "summary": {
    "total": 2450,
    "safe": 2100,
    "partialMapping": 200,
    "missingGroupMatch": 100,
    "ambiguousGroupMatch": 50
  }
}
```

**Candidate Statuses Explained:**

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `SAFE` | Account code matched exactly, canonical key is deterministic, group account is unique | Can be auto-applied; low risk |
| `PARTIAL_MAPPING` | Account has parent-group match but not exact leaf; semantic warning raised | Requires manual review or bulk rule |
| `MISSING_GROUP_MATCH` | Local→canonical mapping is clear but no matching group COA account | Requires manual group mapping setup |
| `AMBIGUOUS_GROUP_MATCH` | Multiple possible canonical keys or group accounts could match | Requires manual disambiguation |

---

#### **STEP 2.2: Apply Safe Candidate Mappings**

**Endpoint:** `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates/apply`

**Prerequisites:**
- Candidates have been previewed (Step 2.1)
- User has identified SAFE candidates to apply
- No high-risk semantic overrides without reason field

**Request Payload:**
```json
{
  "candidateIds": ["cand_123", "cand_124"],
  "reason": "FUP-CM01 wave1 safe apply",
  "includePartialMappings": false
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Mapping Operator** | `consolidation.coa_mapping.upsert` | GROUP | <ul><li>Apply deterministic mappings</li><li>Provide audit reason for applied rules</li><li>Verify applied count matches expectation</li></ul> |
| **Consolidation Mapping Manager** (Recommended) | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | GROUP | Primary operator; more senior authority |

**Configuration Example:**
```
User: APPLY_USER_001 (Chris Mapping)
├─ Role: ConsolidationMappingOperator (or Manager)
├─ Permissions:
│  ├─ consolidation.coa_mapping.upsert       ← KEY PERMISSION
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.group.read
│  └─ audit.log.write  (to record reason)
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**System Processing:**
```
POST /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates/apply
│
├─ Validate consolidation.coa_mapping.upsert permission
├─ For each candidateId:
│  ├─ Load candidate from preview result
│  ├─ If status is SAFE or (includePartialMappings AND approved):
│  │  ├─ Create or update local mapping:
│  │  │  └─ INSERT/UPDATE canonical_local_mappings
│  │  │     (tenant, group, legalEntity, localAccount, canonicalKey, ...)
│  │  ├─ Create or update group mapping:
│  │  │  └─ INSERT/UPDATE canonical_group_mappings
│  │  │     (tenant, group, canonicalKey, groupAccount, ...)
│  │  └─ Record audit event:
│  │     └─ INSERT audit_logs
│  │        (action, userId, source, reason, timestamp)
│  └─ Skip if status is AMBIGUOUS or MISSING
│
└─ Return Applied Result:
   {
     "ok": true,
     "appliedCount": 2,
     "skippedCount": 0,
     "localMappingsCreated": 2,
     "groupMappingsCreated": 1,
     "auditTrail": [
       {
         "candidateId": "cand_123",
         "status": "APPLIED",
         "reason": "FUP-CM01 wave1 safe apply"
       }
     ]
   }
```

**Data Created:**
- `canonical_local_mappings` → INSERT (local account → canonical key)
- `canonical_group_mappings` → INSERT (canonical key → group account)
- `audit_logs` → INSERT entries with reason, source, userId
- Effective dates automatically set from run date

**Audit Trail Recorded:**
- Action: `consolidation.canonical_mapping.auto_apply`
- Fields: `candidateIds`, `reason`, `appliedCount`, `timestamp`, `userId`

---

#### **STEP 2.3: Create Manual Canonical Mappings**

**Endpoints:**
- Local mapping: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local`
- Group mapping: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/group`

**Prerequisites:**
- Candidate is not SAFE or requires manual review
- Canonical key has been selected by user
- Target group account has been verified
- Effective date window determined (e.g., 2026-02-01 to 2026-12-31)

**Request Payload (Local Mapping):**
```json
{
  "legalEntityId": 1,
  "localAccountId": 123,
  "canonicalKey": "AR_TRADE",
  "effectiveFrom": "2026-02-01",
  "effectiveTo": "2026-12-31",
  "status": "ACTIVE",
  "reason": "Manual mapping review; local account 210000 is clearly customer receivables",
  "source": "MANUAL_MAPPING_WORKBENCH"
}
```

**Request Payload (Group Mapping):**
```json
{
  "canonicalKey": "AR_TRADE",
  "groupAccountId": 50,
  "effectiveFrom": "2026-02-01",
  "effectiveTo": "2026-12-31",
  "status": "ACTIVE",
  "reason": "Manual review; canonical AR_TRADE maps to group receivables account",
  "source": "MANUAL_MAPPING_WORKBENCH"
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Mapping Specialist** | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | GROUP | <ul><li>Understand account semantics</li><li>Make manual mapping decisions</li><li>Provide justification for each mapping</li><li>Ensure consistency across entities</li></ul> |
| **Senior Accountant / Consolidation Manager** (Recommended) | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | GROUP | Primary authority for high-risk mappings |

**Configuration Example:**
```
User: MANUAL_USER_001 (Emma Specialist)
├─ Role: ConsolidationMappingSpecialist (custom role)
├─ Permissions:
│  ├─ consolidation.coa_mapping.upsert       ← KEY PERMISSION
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.group.read
│  ├─ chartofaccounts.read  (to understand account structure)
│  └─ audit.log.write  (to record reasons)
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**System Processing:**
```
POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local
│
├─ Validate consolidation.coa_mapping.upsert permission
├─ Assert local account belongs to legal entity in group
├─ Validate effectiveFrom ≤ effectiveTo
├─ If HIGH_RISK (type/normal-side mismatch):
│  └─ Require reason field to be non-empty
│
└─ INSERT/UPDATE canonical_local_mappings
   ├─ UNIQUE constraint: (tenant_id, consolidation_group_id, legal_entity_id, local_account_id)
   ├─ ON DUPLICATE KEY UPDATE:
   │  ├─ canonical_key = NEW_VALUE
   │  ├─ effective_from = NEW_VALUE
   │  ├─ effective_to = NEW_VALUE
   │  ├─ status = NEW_VALUE
   │  ├─ updated_by_user_id = CURRENT_USER
   │  └─ updated_at = CURRENT_TIMESTAMP
   │
   └─ Audit log entry:
      ├─ action: consolidation.canonical_mapping.upsert
      ├─ old_value: (previous mapping or null)
      ├─ new_value: (new mapping)
      ├─ reason: (user-provided justification)
      ├─ source: MANUAL_MAPPING_WORKBENCH
      └─ timestamp: CURRENT_TIMESTAMP
```

**Data Created:**
- `canonical_local_mappings` → INSERT/UPDATE
- `canonical_group_mappings` → INSERT/UPDATE (for group mapping request)
- `audit_logs` → INSERT with full old/new value, reason, timestamp

---

#### **STEP 2.4: Define Bulk Mapping Rules**

**Endpoints:**
- Create rule: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules`
- List rules: `GET /api/v1/consolidation/groups/:groupId/canonical-mappings/rules`
- Preview rule: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/preview`
- Apply rule: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/apply`

**Use Cases:**
1. **CODE_PREFIX:** Many accounts with same prefix share one canonical key
   - Example: `120.* → AR_TRADE`, `121.* → AR_TAX`, `122.* → AR_OTHER`
   
2. **DESCENDANTS_OF_ACCOUNT:** All child accounts under a parent map to one canonical key
   - Example: All descendants of account `320` (AP parent) → `AP_TRADE`

**Request Payload (Create Rule):**
```json
{
  "ruleType": "CODE_PREFIX",
  "ruleName": "AR Accounts Prefix Rule",
  "description": "All receivables accounts starting with 120 map to AR_TRADE",
  "matchPattern": "120.*",
  "canonicalKey": "AR_TRADE",
  "effectiveFrom": "2026-02-01",
  "effectiveTo": "2026-12-31",
  "status": "ACTIVE",
  "reason": "Reusable rule for consistent AR account mapping across entities"
}
```

**Request Payload (Apply Rule):**
```json
{
  "ruleIds": ["rule_ar_001", "rule_ap_001"],
  "reason": "FUP-CM01: Apply reusable bulk rules to complete mapping coverage"
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Mapping Manager** | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | GROUP | <ul><li>Define bulk rules</li><li>Preview rule impact before apply</li><li>Apply rules with audit justification</li><li>Manage rule lifecycle (create/deactivate)</li></ul> |

**Configuration Example:**
```
User: RULES_USER_001 (Frank Rules)
├─ Role: ConsolidationMappingManager (custom role)
├─ Permissions:
│  ├─ consolidation.coa_mapping.upsert
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.group.read
│  └─ audit.log.write
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**System Processing:**

**Step 2.4a: Create Rule**
```
POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules
│
├─ Validate consolidation.coa_mapping.upsert permission
├─ Validate ruleType is CODE_PREFIX or DESCENDANTS_OF_ACCOUNT
├─ If CODE_PREFIX: validate matchPattern is valid regex
├─ If DESCENDANTS_OF_ACCOUNT: validate parentAccountId exists
│
└─ INSERT canonical_mapping_rules
   ├─ rule_type
   ├─ rule_name
   ├─ match_pattern (or parent_account_id)
   ├─ canonical_key
   ├─ effective_from
   ├─ effective_to
   ├─ status: ACTIVE
   ├─ created_by_user_id: CURRENT_USER
   └─ created_at: CURRENT_TIMESTAMP
```

**Step 2.4b: Preview Rule**
```
POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/preview
│
├─ Load rule definition
├─ For each legal entity in group:
│  └─ For each unposted account:
│     ├─ If ruleType=CODE_PREFIX: test localAccountCode REGEX match
│     ├─ If ruleType=DESCENDANTS_OF_ACCOUNT: test hierarchical relationship
│     └─ Accumulate matching results
│
└─ Return Preview:
   {
     "ruleId": "rule_ar_001",
     "ruleType": "CODE_PREFIX",
     "matchPattern": "120.*",
     "estimatedMatches": 156,
     "sampleMatches": [
       {
         "legalEntityCode": "GERMANY_AG",
         "localAccountCode": "120000",
         "localAccountName": "Customer Receivables",
         "canonicalKeyProposed": "AR_TRADE",
         "willCreateNewMapping": true
       }
     ]
   }
```

**Step 2.4c: Apply Rule**
```
POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/apply
│
├─ Validate consolidation.coa_mapping.upsert permission
├─ For each matched account:
│  ├─ Create local mapping (if not exists):
│  │  └─ INSERT/UPDATE canonical_local_mappings
│  │     (effective_from, effective_to from rule)
│  └─ Create group mapping (if not exists):
│     └─ INSERT/UPDATE canonical_group_mappings
│        (maps canonicalKey to group account)
│
├─ Record rule application event:
│  └─ INSERT audit_logs
│     (action, ruleId, matchCount, timestamp, reason)
│
└─ Return Applied Result:
   {
     "ruleId": "rule_ar_001",
     "status": "APPLIED",
     "localMappingsCreated": 156,
     "groupMappingsCreated": 1,
     "totalImpact": "156 accounts now have complete mapping coverage"
   }
```

**Governance Notes:**
- Saved rules are **additive only** — they generate explicit local/group mappings; execute-time resolution always uses explicit mappings
- Deactivate rules when no longer applicable (mark status='INACTIVE')
- Rule changes are subject to audit trail — all applications recorded with reason
- Future rerun workflow: preview saved rule again when new leaves appear, apply to materialize new mappings

---

#### **STEP 2.5: Review Mapping Governance & Coverage**

**Endpoint:** `GET /api/v1/consolidation/groups/:groupId/canonical-governance-review`

**Prerequisites:**
- All local mappings have been created
- All group mappings have been verified
- Month-end window: `fromDate` and `toDate` parameters specified

**Request Parameters:**
```
GET /api/v1/consolidation/groups/:groupId/canonical-governance-review
?fromDate=2026-02-01&toDate=2026-02-28
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Governance Officer** | `consolidation.coa_mapping.read`, `consolidation.run.read` | GROUP | <ul><li>Review mapping changes in period</li><li>Identify high-risk overrides</li><li>Ensure maker-checker completeness</li><li>Sign-off on governance status</li></ul> |
| **Consolidation Controller** (Recommended) | `consolidation.coa_mapping.read`, `consolidation.run.read`, `audit.log.read` | GROUP | Primary governance reviewer |

**Configuration Example:**
```
User: GOV_USER_001 (Grace Governance)
├─ Role: ConsolidationGovernanceOfficer (custom role)
├─ Permissions:
│  ├─ consolidation.coa_mapping.read         ← KEY PERMISSION
│  ├─ consolidation.run.read
│  ├─ audit.log.read
│  └─ consolidation.group.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-02-01 onwards
```

**Response Format:**
```json
{
  "period": {
    "fromDate": "2026-02-01",
    "toDate": "2026-02-28"
  },
  "groupId": 1,
  "readinessSnapshot": {
    "ready": true,
    "coverageDetected": true,
    "blockedReason": null,
    "summary": {
      "safe": 2100,
      "unresolved": 0,
      "missing": 0,
      "ambiguous": 0
    }
  },
  "unmappedPostedAccounts": [
    {
      "legalEntityId": 1,
      "legalEntityCode": "GERMANY_AG",
      "localAccountCode": "800000",
      "localAccountName": "Depreciation Expense",
      "postedCount": 25,
      "lastPostedDate": "2026-02-28",
      "mappingStatus": "MISSING",
      "savedRuleMatches": []  ← Can be covered by saved rules if applied
    }
  ],
  "recentMappingChanges": [
    {
      "changeType": "LOCAL_MAPPING_UPSERT",
      "changedOn": "2026-02-15",
      "changedByUserId": 201,
      "changedByEmail": "emma@example.com",
      "legalEntityCode": "GERMANY_AG",
      "localAccountCode": "210000",
      "canonicalKeyOld": null,
      "canonicalKeyNew": "AR_TRADE",
      "reason": "Manual mapping review; customer receivables account"
    }
  ],
  "highRiskOverrides": [
    {
      "changeId": "audit_456",
      "changeType": "GROUP_MAPPING_REMAP",
      "makerUserId": 205,
      "makerEmail": "chris@example.com",
      "checkerUserId": null,  ← Not yet reviewed
      "checkerEmail": null,
      "semanticWarning": "NORMAL_SIDE_MISMATCH",
      "reason": "Reclassification of credit facility; now classified as long-term debt",
      "reviewStatus": "PENDING_CHECKER_REVIEW"
    }
  ],
  "pendingCheckerReview": [
    {
      "requirementType": "AMBIGUOUS_CANDIDATE_SELECTION",
      "count": 1,
      "pendingUserCount": 2
    }
  ],
  "savedRulesSummary": [
    {
      "ruleId": "rule_ar_001",
      "ruleName": "AR Accounts Prefix Rule",
      "ruleType": "CODE_PREFIX",
      "matchPattern": "120.*",
      "canonicalKey": "AR_TRADE",
      "createdOn": "2026-02-01",
      "totalApplications": 3,
      "activeStatus": "ACTIVE"
    }
  ]
}
```

**Mandatory Month-End Review Checklist:**
- ✓ Review all `unmapped posted accounts` and resolve mapping gaps
- ✓ Review `recently changed canonical mappings` for scope/date/semantic correctness
- ✓ Review `high-risk overrides` and complete checker sign-off before execution windows
- ✓ Verify `pending checker review` items are addressed (if maker-checker policy enforced)
- ✓ Check `saved rules summary` and validate rule effectiveness

---

### STEP 1: PREPARE CONSOLIDATION CONTEXT (Backward Step 6)

#### **STEP 1.1: Define Consolidation Groups**

**Endpoint:** `POST /api/v1/consolidation/groups`

**Prerequisites:**
- Tenant is onboarded
- User has administrative access to tenant
- Legal entities to be consolidated are already created
- Chart of accounts has been established

**Request Payload:**
```json
{
  "groupCode": "EMEA_2026",
  "groupName": "EMEA Consolidation Group - 2026",
  "groupDescription": "Consolidates all EMEA legal entities for quarterly and annual reporting",
  "currency": "EUR",
  "status": "ACTIVE",
  "parentGroupId": null,  // optional, for hierarchical consolidations
  "ownerUserId": 100      // primary responsible party
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Setup Administrator** | `consolidation.group.upsert` | TENANT | <ul><li>Define consolidation group structure</li><li>Assign group configuration</li><li>Set up reporting entity hierarchy</li></ul> |
| **System Administrator** | `consolidation.group.upsert`, `consolidation.group.read` | TENANT | Can perform setup; usually delegates to Finance |
| **Group Finance Manager** | `consolidation.group.upsert` | GROUP | Senior finance responsible for consolidation |

**Configuration Example:**
```
User: ADMIN_USER_001 (Henry Admin)
├─ Role: SystemAdmin or ConsolidationSetupAdmin
├─ Permissions:
│  ├─ consolidation.group.upsert             ← KEY PERMISSION
│  ├─ consolidation.group.read
│  ├─ legal_entity.read
│  ├─ org_structure.read
│  └─ chartofaccounts.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ Recommended to have full TENANT scope for setup
└─ Effective Date: 2026-01-01 onwards
```

**System Processing:**
```
POST /api/v1/consolidation/groups
│
├─ Validate consolidation.group.upsert permission (TENANT scope required)
├─ Assert groupCode is unique per tenant
├─ Validate currency code
├─ If parentGroupId provided: assert parent group exists
│
└─ INSERT consolidation_groups
   ├─ tenant_id: TENANT_001
   ├─ group_code: "EMEA_2026"
   ├─ group_name: "EMEA Consolidation Group - 2026"
   ├─ currency: "EUR"
   ├─ status: "ACTIVE"
   ├─ parent_group_id: null
   ├─ owner_user_id: 100
   ├─ created_by_user_id: ADMIN_USER_001
   └─ created_at: CURRENT_TIMESTAMP
```

**Data Created:**
- `consolidation_groups` → INSERT row
- Audit log: `action=consolidation.group.create, groupCode=EMEA_2026`

---

#### **STEP 1.2: Assign Group Members (Legal Entities)**

**Endpoint:** `POST /api/v1/consolidation/groups/:groupId/members`

**Prerequisites:**
- Consolidation group has been created (Step 1.1)
- Legal entities to be consolidated already exist in tenant
- Each legal entity has a functional currency and chart of accounts

**Request Payload:**
```json
{
  "legalEntityId": 10,
  "role": "REPORTING_ENTITY",  // or "ELIMINATION_ENTITY", "PARENT_ENTITY"
  "intercompanyAccount": "290000",  // for tracking intercompany transactions
  "legalEntityCurrency": "EUR",
  "includeInConsolidation": true,
  "status": "ACTIVE"
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Consolidation Group Manager** | `consolidation.group_member.upsert` | GROUP | <ul><li>Add/remove legal entities from consolidation group</li><li>Configure entity-specific consolidation roles</li><li>Set up intercompany account mappings</li></ul> |
| **Finance Controller** (Alternative) | `consolidation.group_member.upsert` | GROUP | Can manage group membership for their scope |

**Configuration Example:**
```
User: GROUP_USER_001 (Iris Group)
├─ Role: ConsolidationGroupManager (custom role)
├─ Permissions:
│  ├─ consolidation.group_member.upsert      ← KEY PERMISSION
│  ├─ consolidation.group.read
│  ├─ legal_entity.read
│  └─ consolidation.coa_mapping.read
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-01-01 onwards
```

**System Processing:**
```
POST /api/v1/consolidation/groups/:groupId/members
│
├─ Validate consolidation.group_member.upsert permission (GROUP scope)
├─ Assert consolidation group exists
├─ Assert legal entity exists in tenant
├─ Assert legal entity is not already a member of this group
├─ Validate legalEntityCurrency is valid
│
└─ INSERT consolidation_group_members
   ├─ consolidation_group_id: 1
   ├─ legal_entity_id: 10
   ├─ role: "REPORTING_ENTITY"
   ├─ intercompany_account_id: (lookup by code 290000)
   ├─ functional_currency: "EUR"
   ├─ include_in_consolidation: true
   ├─ status: "ACTIVE"
   ├─ added_by_user_id: GROUP_USER_001
   └─ added_at: CURRENT_TIMESTAMP
```

**Data Created:**
- `consolidation_group_members` → INSERT row per entity
- Audit log: `action=consolidation.group_member.add, groupId=1, legalEntityId=10`

**Recommended Member Assignment Example:**

| Entity | Role | Intercompany Account | Currency | Include in Consolidation |
|--------|------|---------------------|----------|--------------------------|
| Germany AG | REPORTING_ENTITY | 290010 | EUR | YES |
| France SARL | REPORTING_ENTITY | 290020 | EUR | YES |
| Italy SpA | REPORTING_ENTITY | 290030 | EUR | YES |
| Holding BV | PARENT_ENTITY | 290040 | EUR | YES |
| Treasury GmbH | ELIMINATION_ENTITY | 290050 | EUR | YES |

---

#### **STEP 1.3: Configure Chart of Accounts Mappings**

**Endpoint:** `POST /api/v1/consolidation/groups/:groupId/coa-mappings`

**Prerequisites:**
- Consolidation group has been created (Step 1.1)
- All legal entities have been assigned to group (Step 1.2)
- Group chart of accounts has been established

**Request Payload:**
```json
{
  "groupAccountId": 50,
  "groupAccountCode": "1000",
  "groupAccountName": "Cash and Equivalents",
  "accountType": "ASSET",
  "normalSide": "DEBIT",
  "reportingCategory": "BALANCE_SHEET",
  "status": "ACTIVE"
}
```

**User Requirements:**

| Role | Permissions Required | Scope | Responsibilities |
|------|---------------------|-------|------------------|
| **Chart of Accounts Steward** | `consolidation.coa_mapping.upsert` | GROUP | <ul><li>Maintain group chart of accounts</li><li>Map local accounts to group accounts</li><li>Ensure account hierarchy correctness</li></ul> |
| **Consolidation Setup Manager** | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | GROUP | Alternative role for COA setup |

**Configuration Example:**
```
User: COA_USER_001 (Jack COA)
├─ Role: ChartOfAccountsSteward (custom role)
├─ Permissions:
│  ├─ consolidation.coa_mapping.upsert       ← KEY PERMISSION
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.group.read
│  ├─ chartofaccounts.read  (source of truth for account codes)
│  └─ audit.log.write
├─ Scopes:
│  ├─ TENANT: TENANT_001
│  └─ CONSOLIDATION_GROUP: GROUP_EMEA_2026
└─ Effective Date: 2026-01-01 onwards
```

**System Processing:**
```
POST /api/v1/consolidation/groups/:groupId/coa-mappings
│
├─ Validate consolidation.coa_mapping.upsert permission
├─ Assert consolidation group exists
├─ Validate accountType, normalSide, reportingCategory are valid enums
├─ Assert groupAccountCode is unique per group
│
└─ INSERT group_coa_mappings
   ├─ consolidation_group_id: 1
   ├─ group_account_id: 50
   ├─ group_account_code: "1000"
   ├─ group_account_name: "Cash and Equivalents"
   ├─ account_type: "ASSET"
   ├─ normal_side: "DEBIT"
   ├─ reporting_category: "BALANCE_SHEET"
   ├─ status: "ACTIVE"
   ├─ created_by_user_id: COA_USER_001
   └─ created_at: CURRENT_TIMESTAMP
```

**Data Created:**
- `group_coa_mappings` → INSERT row per group account
- Audit log: `action=consolidation.coa_mapping.create`

---

## Role-Based Permissions Matrix

### **Complete Consolidation RBAC Structure**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONSOLIDATION PERMISSION CATALOG                          │
└─────────────────────────────────────────────────────────────────────────────┘

1. consolidation.group.read
   ├─ Scope: TENANT, GROUP
   ├─ Allows: View consolidation groups, members, configuration
   └─ Required for: Any read-only consolidation access

2. consolidation.group.upsert
   ├─ Scope: TENANT, GROUP
   ├─ Allows: Create/edit consolidation groups, update group metadata
   └─ Used by: System Admin, Consolidation Setup Admin

3. consolidation.group_member.upsert
   ├─ Scope: GROUP
   ├─ Allows: Add/remove legal entities from consolidation group
   └─ Used by: Group Manager, Finance Controller

4. consolidation.coa_mapping.read
   ├─ Scope: TENANT, GROUP
   ├─ Allows: View chart of accounts mappings (local, canonical, group)
   └─ Used by: Mapping reviewers, auditors, readers

5. consolidation.coa_mapping.upsert
   ├─ Scope: GROUP
   ├─ Allows: Create/update local, canonical, and group mappings; manage rules
   └─ Used by: Mapping operators, specialists, managers

6. consolidation.elimination_placeholder.read
   ├─ Scope: TENANT, GROUP
   ├─ Allows: View elimination account templates and definitions
   └─ Used by: Consolidation team, auditors

7. consolidation.elimination_placeholder.upsert
   ├─ Scope: GROUP
   ├─ Allows: Create/edit elimination account templates
   └─ Used by: Consolidation setup, finance controllers

8. consolidation.run.read
   ├─ Scope: TENANT, GROUP, LEGAL_ENTITY
   ├─ Allows: View run history, readiness snapshots, governance reviews
   └─ Used by: All consolidation users (read-only)

9. consolidation.run.create
   ├─ Scope: GROUP
   ├─ Allows: Create new consolidation runs
   └─ Used by: Setup managers, consolidation operators

10. consolidation.run.execute
    ├─ Scope: GROUP, LEGAL_ENTITY
    ├─ Allows: Execute consolidation calculation (most critical permission)
    └─ Used by: Consolidation operators, group controllers

11. consolidation.adjustment.create
    ├─ Scope: GROUP
    ├─ Allows: Create group-level adjustment entries
    └─ Used by: Adjustment operators

12. consolidation.adjustment.post
    ├─ Scope: GROUP
    ├─ Allows: Post adjustment entries to consolidation ledger
    └─ Used by: Adjustment operators

13. consolidation.elimination.create
    ├─ Scope: GROUP
    ├─ Allows: Create elimination entries
    └─ Used by: Elimination operators

14. consolidation.elimination.post
    ├─ Scope: GROUP
    ├─ Allows: Post elimination entries to consolidation ledger
    └─ Used by: Elimination operators

15. consolidation.run.finalize
    ├─ Scope: GROUP
    ├─ Allows: Lock run, mark as complete, finalize consolidated reports
    └─ Used by: CFO, group reporting controller (final authority)

16. consolidation.report.* (Read permissions)
    ├─ consolidation.report.trial_balance.read
    ├─ consolidation.report.summary.read
    ├─ consolidation.report.balance_sheet.read
    ├─ consolidation.report.income_statement.read
    ├─ Scope: TENANT, GROUP, LEGAL_ENTITY
    └─ Used by: Reporters, auditors, finance stakeholders
```

---

### **Recommended Role Templates**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RECOMMENDED ROLE PACKAGES                              │
└─────────────────────────────────────────────────────────────────────────────┘

ROLE: Consolidation / View
├─ Category: Read-only
├─ Permissions:
│  ├─ consolidation.group.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.elimination_placeholder.read
│  ├─ consolidation.run.read
│  ├─ consolidation.report.trial_balance.read
│  ├─ consolidation.report.summary.read
│  ├─ consolidation.report.balance_sheet.read
│  └─ consolidation.report.income_statement.read
├─ Recommended Scopes: GROUP, LEGAL_ENTITY
└─ Use Case: Finance team visibility without operational authority

ROLE: Consolidation / Prepare Run
├─ Category: Operational
├─ Permissions:
│  ├─ consolidation.group.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.elimination_placeholder.read
│  ├─ consolidation.run.read
│  ├─ consolidation.run.create
│  ├─ consolidation.report.trial_balance.read
│  └─ consolidation.report.summary.read
├─ Recommended Scopes: GROUP
└─ Use Case: Setup and preparation before execution

ROLE: Consolidation / Execute Run
├─ Category: Operational
├─ Permissions:
│  ├─ consolidation.run.read
│  └─ consolidation.run.execute
├─ Recommended Scopes: GROUP, LEGAL_ENTITY
└─ Use Case: Run execution only (limited scope)

ROLE: Consolidation / Post Adjustments
├─ Category: Operational
├─ Permissions:
│  ├─ consolidation.run.read
│  ├─ consolidation.adjustment.create
│  ├─ consolidation.adjustment.post
│  ├─ consolidation.elimination_placeholder.read
│  ├─ consolidation.coa_mapping.read
│  └─ gladdress.read  (for GL code selection)
├─ Recommended Scopes: GROUP
└─ Use Case: Post-execution adjustments

ROLE: Consolidation / Post Eliminations
├─ Category: Operational
├─ Permissions:
│  ├─ consolidation.run.read
│  ├─ consolidation.elimination.create
│  ├─ consolidation.elimination.post
│  ├─ consolidation.coa_mapping.read
│  └─ consolidation.elimination_placeholder.read
├─ Recommended Scopes: GROUP
└─ Use Case: Intercompany elimination management

ROLE: Consolidation / Mapping Management
├─ Category: Operational
├─ Permissions:
│  ├─ consolidation.group.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.coa_mapping.upsert
│  ├─ consolidation.run.read
│  ├─ audit.log.read
│  └─ audit.log.write
├─ Recommended Scopes: GROUP
└─ Use Case: Canonical mapping creation and governance

ROLE: GroupReportingController
├─ Category: Primary operational authority
├─ Permissions:
│  ├─ consolidation.group.read
│  ├─ consolidation.coa_mapping.read
│  ├─ consolidation.elimination_placeholder.read
│  ├─ consolidation.run.read
│  ├─ consolidation.run.create
│  ├─ consolidation.run.execute
│  ├─ consolidation.run.finalize
│  ├─ consolidation.adjustment.create
│  ├─ consolidation.adjustment.post
│  ├─ consolidation.elimination.create
│  ├─ consolidation.elimination.post
│  ├─ consolidation.report.*  (all read)
│  └─ audit.log.read
├─ Recommended Scopes: GROUP
└─ Use Case: Full consolidation lifecycle authority
```

---

## User Configuration & Prerequisites

### **Step-by-Step User Setup**

#### **Phase 1: Identify Required Users**

| User Type | Count | Min. Permissions | Example Roles |
|-----------|-------|------------------|---------------|
| Consolidation Admins | 1-2 | `consolidation.group.upsert`, `consolidation.group_member.upsert` | SystemAdmin, ConsolidationSetupAdmin |
| Mapping Specialists | 2-3 | `consolidation.coa_mapping.upsert`, `consolidation.coa_mapping.read` | MappingSpecialist, MappingManager |
| Consolidation Operators | 2-4 | `consolidation.run.create`, `consolidation.run.execute` | ConsolidationOperator, GroupReportingController |
| Adjustment Operators | 1-2 | `consolidation.adjustment.create`, `consolidation.adjustment.post` | AdjustmentOperator |
| Elimination Operators | 1-2 | `consolidation.elimination.create`, `consolidation.elimination.post` | EliminationOperator |
| Finance Controllers | 1-2 | `consolidation.run.finalize`, all read perms | GroupReportingController, CFO |
| Readers / Auditors | 3-5 | `consolidation.*read` | Reader, Auditor |

#### **Phase 2: Role Assignment**

**Example Role Assignment (Tenant EMEA_2026):**

```yaml
User: henry.admin@company.com (Henry Admin)
  Role: SystemAdmin
  Permissions:
    - consolidation.group.upsert
    - consolidation.group.read
    - consolidation.group_member.upsert
  Scopes:
    - TENANT: TENANT_001
  EffectiveFrom: 2026-01-01
  EffectiveTo: null  (ongoing)
  ApprovedBy: Security Admin
  CreatedAt: 2026-01-15

User: emma.specialist@company.com (Emma Specialist)
  Role: ConsolidationMappingSpecialist
  Permissions:
    - consolidation.coa_mapping.upsert
    - consolidation.coa_mapping.read
    - consolidation.group.read
    - chartofaccounts.read
    - audit.log.write
  Scopes:
    - TENANT: TENANT_001
    - CONSOLIDATION_GROUP: GROUP_EMEA_2026
  EffectiveFrom: 2026-01-15
  EffectiveTo: null
  ApprovedBy: Group Finance Manager
  CreatedAt: 2026-01-15

User: thomas.ops@company.com (Thomas Operations)
  Role: GroupReportingController
  Permissions:
    - consolidation.run.execute
    - consolidation.run.read
    - consolidation.coa_mapping.read
    - consolidation.elimination_placeholder.read
    - consolidation.group.read
    - fxrates.read
    - consolidation.report.trial_balance.read
  Scopes:
    - TENANT: TENANT_001
    - CONSOLIDATION_GROUP: GROUP_EMEA_2026
    - LEGAL_ENTITY: LE_GERMANY, LE_FRANCE, LE_ITALY
  EffectiveFrom: 2026-02-01
  EffectiveTo: null
  ApprovedBy: Group Finance Manager
  CreatedAt: 2026-01-20

User: sarah.finance@company.com (Sarah Finance - CFO)
  Role: GroupReportingController (Senior)
  Permissions:
    - consolidation.group.read
    - consolidation.coa_mapping.read
    - consolidation.elimination_placeholder.read
    - consolidation.run.read
    - consolidation.run.execute
    - consolidation.run.finalize
    - consolidation.adjustment.create
    - consolidation.adjustment.post
    - consolidation.elimination.create
    - consolidation.elimination.post
    - consolidation.report.*  (all)
    - audit.log.read
  Scopes:
    - TENANT: TENANT_001
    - CONSOLIDATION_GROUP: GROUP_EMEA_2026
  EffectiveFrom: 2026-01-01
  EffectiveTo: null
  ApprovedBy: Group Executive
  CreatedAt: 2026-01-10
```

#### **Phase 3: Environment & System Prerequisites**

**Required Environment Variables:**

```bash
# Canonical Mapping Execution Monitoring
export CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES=60       # Monitoring window
export CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD=3             # Alert threshold

# FX Rate Handling
export DEFAULT_FX_RATE_TYPE=CLOSING                                   # Fallback rate type
export ALLOW_MISSING_FX_RATES=false                                   # Strict validation

# Feature Flags (if applicable)
export FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1=true                   # Approval workflow
export FEATURE_SUBACCOUNTS_V1=true                                    # Subaccount support
export FEATURE_TAX_ENGINE_V1=true                                     # Tax integration
```

**Required Migrations:**

```bash
cd backend
npm run db:migrate  # Ensures all consolidation schema migrations applied

# Key migrations:
# - m001_global_multi_entity.js           → Consolidation core tables
# - m003_rbac_audit_and_consolidation_run_entries.js → Run entries & audit
# - m082_close_consolidation_workflow_approvals.js    → Workflow integration
# - m166_workflow_generic_bridge.js       → Workflow governance bridge
```

**Database Prerequisites:**

```sql
-- Verify consolidation tables exist
SELECT COUNT(*) FROM consolidation_groups;
SELECT COUNT(*) FROM consolidation_group_members;
SELECT COUNT(*) FROM group_coa_mappings;
SELECT COUNT(*) FROM canonical_local_mappings;
SELECT COUNT(*) FROM canonical_group_mappings;
SELECT COUNT(*) FROM consolidation_runs;
SELECT COUNT(*) FROM consolidation_run_entries;
SELECT COUNT(*) FROM canonical_mapping_rules;
```

---

## End-to-End Example Scenarios

### **Scenario 1: Simple Single-Entity Consolidation**

**Context:**
- Tenant: TENANT_SMALL (small company)
- One legal entity consolidating with itself for reporting
- Chart of accounts already established
- No intercompany transactions
- Timeline: 2026-03-01 to 2026-03-31

**Actors:**
1. **Admin** (henryadmin@company.com) - SystemAdmin role
2. **Accountant** (alice@company.com) - Finance role with mapping permissions
3. **CFO** (sarah@company.com) - CFO role with finalization authority

**Step-by-Step Execution:**

```
Week 1: Setup
┌──────────────────────────────────────────────────────────────┐
1. Admin (Henry) creates consolidation group
   POST /api/v1/consolidation/groups
   ├─ groupCode: SINGLE_ENTITY_2026
   ├─ groupName: Single Entity Consolidation - 2026
   ├─ currency: EUR
   └─ status: ACTIVE
   Result: GROUP_ID = 1

2. Admin (Henry) assigns legal entity to group
   POST /api/v1/consolidation/groups/1/members
   ├─ legalEntityId: 10
   ├─ role: REPORTING_ENTITY
   └─ status: ACTIVE
   Result: Entity assigned, ready for mapping

3. Accountant (Alice) reviews group COA
   GET /api/v1/consolidation/groups/1/coa-mappings
   Result: 250 group accounts defined
└──────────────────────────────────────────────────────────────┘

Week 2: Mapping
┌──────────────────────────────────────────────────────────────┐
4. Accountant (Alice) previews mapping candidates
   GET /api/v1/consolidation/groups/1/canonical-mappings/candidates
   Result: 250 candidates identified
           - 245 SAFE (100% match)
           - 5 PARTIAL_MAPPING (parent account match)

5. Accountant (Alice) applies all SAFE candidates
   POST /api/v1/consolidation/groups/1/canonical-mappings/candidates/apply
   ├─ candidateIds: all SAFE candidates
   ├─ reason: "Week 2: Automatic safe candidate application"
   └─ includePartialMappings: false
   Result: 245 local + group mappings created

6. Accountant (Alice) manually maps 5 PARTIAL accounts
   POST /api/v1/consolidation/groups/1/canonical-mappings/local (5 times)
   ├─ Example 1: Account 500000 (Revenue) → REVENUE_PRODUCT
   ├─ Example 2: Account 600000 (COGS) → COGS_MATERIALS
   └─ ... (3 more)
   Result: All 250 accounts now have complete mappings

7. Accountant (Alice) verifies mapping coverage
   GET /api/v1/consolidation/groups/1/canonical-readiness
   Result:
   ├─ ready: true
   ├─ coverageDetected: true
   ├─ summary: { safe: 245, unresolved: 0, missing: 0, ambiguous: 0 }
   └─ All systems GO for execution
└──────────────────────────────────────────────────────────────┘

Week 3: Execution
┌──────────────────────────────────────────────────────────────┐
8. Accountant (Alice) creates consolidation run for March
   POST /api/v1/consolidation/runs
   ├─ consolidationGroupId: 1
   ├─ fiscalPeriodId: 202603
   ├─ consolidationDateIso: "2026-03-31"
   └─ preferredFxRateType: CLOSING
   Result: RUN_ID = 100

9. Accountant (Alice) verifies pre-flight readiness
   GET /api/v1/consolidation/runs/100
   Result:
   ├─ status: READY
   ├─ compatibility.subaccounts.checks.canonicalMappingCoverage: true
   └─ All green lights for execution

10. Accountant (Alice) executes consolidation
    POST /api/v1/consolidation/runs/100/execute
    ├─ rateType: CLOSING
    └─ Request successful; processing begins
    
    System processes:
    ├─ Load 1,500 posted journal entries from March
    ├─ Apply 250 account mappings
    ├─ Accumulate balances by canonical key
    ├─ Generate consolidated trial balance
    └─ Status → COMPLETED

    Result:
    ├─ insertedRowCount: 250
    ├─ totals.debitSum: 1,250,000
    ├─ totals.creditSum: 1,250,000
    └─ Balance verified!

11. CFO (Sarah) reviews consolidated reports
    GET /api/v1/consolidation/runs/100/report/balance-sheet
    Result: Balance Sheet for March shows assets/liabilities in balance

12. CFO (Sarah) finalizes consolidation run
    POST /api/v1/consolidation/runs/100/finalize
    Result:
    ├─ Run status → LOCKED
    ├─ finished_at: 2026-03-22 11:45:30
    └─ Consolidation COMPLETE
└──────────────────────────────────────────────────────────────┘

Timeline Summary:
├─ Total duration: 3 weeks
├─ Mapping effort: ~10 hours (Accountant Alice)
├─ Execution time: ~5 minutes (system processing)
└─ Final approval: ~30 minutes (CFO Sarah review)
```

---

### **Scenario 2: Complex Multi-Entity Consolidation with Adjustments**

**Context:**
- Tenant: TENANT_EMEA (large multinational)
- Consolidation Group: EMEA_2026 (5 legal entities, 3 currencies)
- Chart of accounts: 500+ accounts
- Requires intercompany eliminations and tax adjustments
- Timeline: 2026-02-01 to 2026-03-31 (2-month close)

**Actors:**
1. **Setup Admin** (henry@company.com) - SystemAdmin
2. **Group Manager** (iris@company.com) - Group membership manager
3. **Mapping Specialist** (emma@company.com) - Mapping expert
4. **Consolidation Operator** (thomas@company.com) - Execution authority
5. **Adjustment Operator** (maria@company.com) - Adjustment posting
6. **Elimination Operator** (david@company.com) - Elimination posting
7. **Finance Controller** (grace@company.com) - Governance review
8. **CFO** (sarah@company.com) - Final authority

**Step-by-Step Execution:**

```
Phase 1: Consolidation Group Setup (1 week)
┌──────────────────────────────────────────────────────────────────┐
1. Setup Admin (Henry) creates EMEA consolidation group
   POST /api/v1/consolidation/groups
   ├─ groupCode: EMEA_2026
   ├─ groupName: EMEA Consolidation Group - 2026
   ├─ currency: EUR
   ├─ parentGroupId: null
   └─ ownerUserId: thomas
   Result: GROUP_ID = 5

2. Group Manager (Iris) assigns 5 legal entities to group
   POST /api/v1/consolidation/groups/5/members (×5)
   ├─ LE 10: Germany AG (REPORTING_ENTITY, intercompany 290010)
   ├─ LE 20: France SARL (REPORTING_ENTITY, intercompany 290020)
   ├─ LE 30: Italy SpA (REPORTING_ENTITY, intercompany 290030)
   ├─ LE 40: Holding BV (PARENT_ENTITY, intercompany 290040)
   └─ LE 50: Treasury GmbH (ELIMINATION_ENTITY, intercompany 290050)
   Result: All entities assigned

3. Setup Admin (Henry) configures group COA (500 accounts)
   POST /api/v1/consolidation/groups/5/coa-mappings (×500)
   ├─ Group accounts organized by:
   │  ├─ BALANCE_SHEET: Assets, Liabilities, Equity
   │  └─ INCOME_STATEMENT: Revenues, Expenses
   └─ All account types mapped (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE)
   Result: 500 group accounts ready
└──────────────────────────────────────────────────────────────────┘

Phase 2: Canonical Account Mapping (2 weeks)
┌──────────────────────────────────────────────────────────────────┐
4. Mapping Specialist (Emma) previews candidates for all 5 entities
   GET /api/v1/consolidation/groups/5/canonical-mappings/candidates
   Result:
   ├─ Total accounts across entities: 2,100 (accounting for local variation)
   ├─ SAFE candidates: 1,850 (88%)
   ├─ PARTIAL_MAPPING: 180 (9%)
   ├─ MISSING_GROUP_MATCH: 50 (2%)
   └─ AMBIGUOUS_GROUP_MATCH: 20 (1%)

5. Emma applies all SAFE candidates automatically
   POST /api/v1/consolidation/groups/5/canonical-mappings/candidates/apply
   ├─ candidateIds: 1,850 SAFE candidates
   ├─ reason: "Phase 2, Week 1: Safe candidate batch application"
   └─ includePartialMappings: false
   Result: 1,850 explicit mappings created

6. Emma defines 4 reusable bulk mapping rules
   POST /api/v1/consolidation/groups/5/canonical-mappings/rules (×4)
   ├─ Rule 1: CODE_PREFIX "1[0-2]0.*" → AR_TRADE (accounts receivable)
   ├─ Rule 2: CODE_PREFIX "2[0-2]0.*" → AP_TRADE (accounts payable)
   ├─ Rule 3: CODE_PREFIX "5[0-2]0.*" → REVENUE_* (various revenue types)
   └─ Rule 4: DESCENDANTS_OF_ACCOUNT "600000" → COGS_* (cost of goods)
   Result: 4 reusable rules saved

7. Emma applies rules to generate additional mappings
   POST /api/v1/consolidation/groups/5/canonical-mappings/rules/preview (×4)
   Result: Rules will match 180 accounts (the PARTIAL_MAPPING ones)

   POST /api/v1/consolidation/groups/5/canonical-mappings/rules/apply (×4)
   ├─ Rule applications create 180 new explicit mappings
   └─ Reason: "Phase 2, Week 1: Bulk rule application for partial mappings"
   Result: 1,850 + 180 = 2,030 total mappings created

8. Emma manually maps remaining 50 + 20 = 70 ambiguous accounts
   POST /api/v1/consolidation/groups/5/canonical-mappings/local (×70)
   ├─ Reviews each ambiguous account individually
   ├─ Consults with France accountant for context
   ├─ Documents decision for each account with high-risk reason
   └─ Example: Account "440000" (Provision) → "LIABILITY_PROVISION" + "HIGH_RISK_OVERRIDE_REASON"
   Result: 2,030 + 70 = 2,100 total mappings (100% coverage)

9. Finance Controller (Grace) conducts month-end governance review
   GET /api/v1/consolidation/groups/5/canonical-governance-review
   ?fromDate=2026-02-01&toDate=2026-02-28
   
   Review results:
   ├─ unmappedPostedAccounts: [] (empty — all covered!)
   ├─ recentMappingChanges: 2,100 entries
   ├─ highRiskOverrides: 8 entries (documented with reasons)
   ├─ pendingCheckerReview: 0 entries
   └─ Governance Status: ✓ APPROVED

10. Emma verifies final mapping coverage
    GET /api/v1/consolidation/groups/5/canonical-readiness
    Result:
    ├─ ready: true
    ├─ coverageDetected: true
    ├─ summary: { safe: 2030, unresolved: 0, missing: 0, ambiguous: 0 }
    └─ All 5 entities have 100% mapping coverage
└──────────────────────────────────────────────────────────────────┘

Phase 3: Run Execution (1 week)
┌──────────────────────────────────────────────────────────────────┐
11. Setup Admin (Henry) initializes FX rates for EUR/GBP/USD
    POST /api/v1/fxrates (×30 rates for 3 months)
    ├─ Source: ECB closing rates
    ├─ Rates for: 2026-02-01 through 2026-03-31
    └─ Rate types: CLOSING (primary)

12. Consolidation Operator (Thomas) creates consolidation run
    POST /api/v1/consolidation/runs
    ├─ consolidationGroupId: 5
    ├─ fiscalPeriodId: 202602  (February)
    ├─ consolidationDateIso: "2026-02-28"
    └─ preferredFxRateType: CLOSING
    Result: RUN_ID = 500

13. Thomas verifies pre-execution readiness
    GET /api/v1/consolidation/runs/500
    Result:
    ├─ status: READY
    ├─ compatibility.subaccounts.checks.canonicalMappingCoverage: true
    └─ All 5 entities ready

14. Thomas executes consolidation
    POST /api/v1/consolidation/runs/500/execute
    ├─ rateType: CLOSING
    └─ Processing begins
    
    System:
    ├─ Loads 45,000 posted entries (Feb, 5 entities × ~9,000 entries)
    ├─ Applies 2,100 account mappings
    ├─ FX revaluates non-EUR entities (France EUR, Germany EUR, Italy EUR)
    ├─ Accumulates consolidated balances
    ├─ Generates trial balance with 500 accounts
    └─ Status → COMPLETED

    Result: ✓ Execution successful!
    ├─ insertedRowCount: 500 (one row per group account)
    ├─ totals.debitSum: 150,000,000 EUR
    ├─ totals.creditSum: 150,000,000 EUR
    └─ Trial balance balanced!

15. Thomas repeats for March (FY end consolidation)
    POST /api/v1/consolidation/runs
    ├─ consolidationGroupId: 5
    ├─ fiscalPeriodId: 202603  (March)
    ├─ consolidationDateIso: "2026-03-31"
    └─ preferredFxRateType: CLOSING
    Result: RUN_ID = 501 (March run)
    
    POST /api/v1/consolidation/runs/501/execute
    Result: ✓ March consolidation complete
└──────────────────────────────────────────────────────────────────┘

Phase 4: Post-Execution Adjustments (1 week)
┌──────────────────────────────────────────────────────────────────┐
16. Adjustment Operator (Maria) identifies need for tax provision adjustment
    ├─ Current consolidated: Tax provision account under-accrued by 500K
    ├─ Requires: 500K adjustment to tax expense
    └─ Supporting: Tax audit confirmation received

17. Maria creates tax adjustment entry
    POST /api/v1/consolidation/runs/501/adjustments
    ├─ groupAccountId: 150 (Tax Expense)
    ├─ debit: 500,000
    ├─ credit: 0
    ├─ description: "Tax provision adjustment per audit"
    └─ referenceId: "TAX_AUDIT_2026_MAR"
    Result: ADJUSTMENT_ID = adj_001

18. Maria posts adjustment to consolidation ledger
    POST /api/v1/consolidation/runs/501/adjustments/adj_001/post
    Result:
    ├─ Entry posted to consolidation ledger
    ├─ Consolidation_run_entries updated
    └─ Updated consolidated balances reflect adjustment

19. Elimination Operator (David) identifies intercompany transactions
    ├─ Holding BV (LE 40) sold equipment to Germany AG (LE 10)
    ├─ Original sale: 1,000,000
    ├─ Profit in transaction: 200,000
    ├─ Elimination required: Reverse profit + remove intercompany debt
    └─ Supporting: Intercompany sales register provided

20. David creates intercompany elimination entry
    POST /api/v1/consolidation/runs/501/eliminations
    ├─ eliminationType: INTERCOMPANY_TRANSACTION
    ├─ entries:
    │  ├─ Entry 1: Debit Equity (200K profit reversal)
    │  ├─ Entry 2: Credit Intercompany Receivable (1M balance)
    │  └─ Entry 3: Credit Fixed Asset Revaluation (200K)
    ├─ referenceId: "INTERCO_EQUIPMENT_2026_01"
    └─ reason: "Eliminate intercompany profit on equipment sale"
    Result: ELIMINATION_ID = elim_001

21. David posts elimination entries
    POST /api/v1/consolidation/runs/501/eliminations/elim_001/post
    Result:
    ├─ Elimination entries posted
    ├─ Intercompany accounts removed from consolidated view
    └─ Consolidated balances updated (now truly consolidated)

22. Finance Controller (Grace) reviews post-adjustment state
    GET /api/v1/consolidation/runs/501/report/balance-sheet
    Result:
    ├─ Assets: 148,500,000 (reduced by equipment + profit reversal)
    ├─ Liabilities: 95,000,000 (intercompany debt eliminated)
    ├─ Equity: 53,500,000 (profit reversal affects equity)
    └─ Balance Sheet balances: ✓
└──────────────────────────────────────────────────────────────────┘

Phase 5: Finalization (1 day)
┌──────────────────────────────────────────────────────────────────┐
23. CFO (Sarah) reviews all consolidated reports
    GET /api/v1/consolidation/runs/501/report/balance-sheet
    GET /api/v1/consolidation/runs/501/report/income-statement
    GET /api/v1/consolidation/runs/501/report/cash-flow  (if applicable)
    
    Reviews:
    ├─ Balance Sheet: Assets = Liabilities + Equity ✓
    ├─ Income Statement: Revenues - Expenses = Net Income ✓
    ├─ Intercompany eliminations: Accounted for ✓
    ├─ FX adjustments: Properly reflected ✓
    └─ Audit adjustments: Documented & reasonable ✓

24. CFO (Sarah) finalizes consolidation run
    POST /api/v1/consolidation/runs/501/finalize
    Result:
    ├─ Run status → LOCKED
    ├─ finished_at: 2026-03-31 17:30:00
    ├─ Audit log: action=consolidation.run.finalize, userId=CFO
    └─ Consolidation complete and locked against further changes

25. System exports final consolidated financial statements
    Outputs (for statutory/regulatory filing):
    ├─ Consolidated Balance Sheet (as of 2026-03-31)
    ├─ Consolidated Income Statement (2026 YTD)
    ├─ Consolidated Cash Flow Statement (2026 YTD)
    ├─ Consolidation notes (mapping, eliminations, adjustments)
    └─ Audit trail (all changes, approvers, timestamps)
└──────────────────────────────────────────────────────────────────┘

Timeline Summary:
├─ Phase 1 (Setup): 1 week
├─ Phase 2 (Mapping): 2 weeks
├─ Phase 3 (Execution): 1 week (2 monthly runs)
├─ Phase 4 (Adjustments): 1 week
├─ Phase 5 (Finalization): 1 day
├─ Total elapsed: ~5 weeks
└─ Automation level: ~90% (only mapping spec & adjustment review manual)
```

---

## Summary: Consolidation Requirements Checklist

**Before You Execute Consolidation, Verify:**

- [ ] All users have required roles assigned
- [ ] All users have appropriate scopes (TENANT, GROUP, LEGAL_ENTITY)
- [ ] Consolidation group created and all members assigned
- [ ] Chart of accounts configured for group (500+ accounts typical)
- [ ] All local accounts have canonical mappings (100% coverage)
- [ ] Canonical readiness snapshot shows `ready=true`
- [ ] Run compatibility snapshot shows `canonicalMappingCoverage=true`
- [ ] FX rates configured (if multi-currency)
- [ ] Fiscal period is open and contains posted entries
- [ ] Pre-flight readiness verified before executing
- [ ] Execution completed successfully (status=COMPLETED)
- [ ] All adjustments and eliminations posted
- [ ] Final reports reviewed and balanced
- [ ] Approval workflow completed (if enforced)
- [ ] Run finalized and locked
- [ ] Audit trail fully documented

**Key Contact Points:**

- **Setup Questions?** → Henry (Admin)
- **Mapping Issues?** → Emma (Specialist)
- **Execution Problems?** → Thomas (Operator)
- **Adjustments/Eliminations?** → Maria & David
- **Governance Review?** → Grace (Controller)
- **Final Sign-off?** → Sarah (CFO)

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-15  
**Next Review:** 2026-05-15
