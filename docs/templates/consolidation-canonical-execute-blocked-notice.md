# Consolidation Execute Blocked - Finance Communication Template

Subject: Consolidation Execute Temporarily Blocked - Action in Progress

Hello Finance Team,

We have intentionally blocked consolidation execute for:
- Tenant: `{{tenantId}}`
- Group: `{{groupId}}`
- Run: `{{runId}}`
- Period: `{{periodLabel}}`
- Detected at (UTC): `{{detectedAtUtc}}`
- Request ID: `{{requestId}}`

Reason
- Canonical mapping coverage/control check failed.
- Primary reason codes: `{{reasonCodes}}`
- Impacted legal entities (sample): `{{legalEntitySample}}`
- Impacted local accounts (sample): `{{accountCodeSample}}`

What we are doing
1. Containing execution/finalization for this scope.
2. Correcting canonical mappings (scope/date/status) with audit reason.
3. Re-running preflight checks.
4. Executing a new consolidation run after controls pass.

Business impact
- Consolidation execution is delayed for this scope until controls pass.
- No unauthorized/bypassed execution is performed.

Next update
- ETA (UTC): `{{nextUpdateUtc}}`
- Incident owner: `{{ownerName}}` (`{{ownerEmail}}`)

Recovery confirmation (send once fixed)
- New run id: `{{recoveryRunId}}`
- Execute status: `{{recoveryStatus}}`
- Completed at (UTC): `{{recoveredAtUtc}}`

Thanks,
`{{senderName}}`
