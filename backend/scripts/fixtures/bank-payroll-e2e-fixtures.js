export const BANK_PAYROLL_RELEASE_STAGES = [
  {
    id: "bank-flow",
    title: "Bank flow: batch, export/ack, reconciliation, exceptions, approvals",
    scripts: [
      "test:payments:prb04",
      "test:bank:prb06",
      "test:bank:prb03",
      "test:bank:prb07",
      "test:bank:prb08a",
      "test:bank:prb08b",
      "test:bank:prb09",
    ],
  },
  {
    id: "payroll-flow",
    title: "Payroll flow: import, ownership/settlement contract, corrections, and close controls",
    scripts: [
      "test:payroll:release-gate",
    ],
  },
  {
    id: "cross-flow",
    title: "Cross-flow hardening: jobs, approvals, ops, exceptions, retention, isolation",
    scripts: [
      "test:hardening:prh02",
      "test:hardening:prh04",
      "test:hardening:prh05",
      "test:hardening:prh06",
      "test:hardening:prh07",
      "test:hardening:prh09",
    ],
  },
];

export default {
  BANK_PAYROLL_RELEASE_STAGES,
};
