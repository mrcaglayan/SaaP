import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function indexAfter(source, anchor, needle) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    return -1;
  }
  return source.indexOf(needle, anchorIndex);
}

function normalizeSource(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const sessionRoutes = normalizeSource(
    await readFile(path.resolve(root, "backend/src/routes/cash.session.routes.js"), "utf8")
  );
  const sessionRouteAnchor = 'router.get(\n  "/",\n  requirePermission("cash.register.read", {';
  assert(
    indexAfter(
      sessionRoutes,
      sessionRouteAnchor,
      'const registerId = parsePositiveInt(req.query?.registerId);'
    ) <
      indexAfter(
        sessionRoutes,
        sessionRouteAnchor,
        'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
      ),
    "cash.session.routes should resolve register scope before legalEntity scope on list reads"
  );

  const transactionRoutes = normalizeSource(
    await readFile(path.resolve(root, "backend/src/routes/cash.transaction.routes.js"), "utf8")
  );
  const txnListAnchor = 'router.get(\n  "/",\n  requirePermission("cash.txn.read", {';
  const transitListAnchor = 'router.get(\n  "/transit",\n  requirePermission("cash.txn.read", {';
  assert(
    indexAfter(
      transactionRoutes,
      txnListAnchor,
      'const registerId = parsePositiveInt(req.query?.registerId);'
    ) <
      indexAfter(
        transactionRoutes,
        txnListAnchor,
        'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
      ),
    "cash.transaction.routes should resolve register scope before legalEntity scope on transaction lists"
  );
  assert(
    indexAfter(
      transactionRoutes,
      transitListAnchor,
      'const sourceRegisterId = parsePositiveInt(req.query?.sourceRegisterId);'
    ) <
      indexAfter(
        transactionRoutes,
        transitListAnchor,
        'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
      ) &&
      indexAfter(
        transactionRoutes,
        transitListAnchor,
        'const targetRegisterId = parsePositiveInt(req.query?.targetRegisterId);'
      ) <
        indexAfter(
          transactionRoutes,
          transitListAnchor,
          'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
        ),
    "cash.transaction.routes should resolve source/target register scope before legalEntity scope on transit lists"
  );

  const exceptionRoutes = normalizeSource(
    await readFile(path.resolve(root, "backend/src/routes/cash.exception.routes.js"), "utf8")
  );
  assert(
    exceptionRoutes.includes('if (scopeInput.operatingUnitId) {') &&
      exceptionRoutes.indexOf("if (scopeInput.registerId) {") <
        exceptionRoutes.indexOf("if (scopeInput.legalEntityId) {") &&
      exceptionRoutes.indexOf("if (scopeInput.operatingUnitId) {") <
        exceptionRoutes.indexOf("if (scopeInput.legalEntityId) {"),
    "cash.exception.routes should resolve register or operating-unit scope before legalEntity scope"
  );

  const exchangeRoutes = normalizeSource(
    await readFile(path.resolve(root, "backend/src/routes/cash.exchange.routes.js"), "utf8")
  );
  const exchangeListAnchor = 'router.get(\n  "/",\n  requirePermission("cash.txn.read", {';
  assert(
    indexAfter(
      exchangeRoutes,
      exchangeListAnchor,
      'const sourceRegisterId = parsePositiveInt(req.query?.sourceRegisterId);'
    ) <
      indexAfter(
        exchangeRoutes,
        exchangeListAnchor,
        'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
      ) &&
      indexAfter(
        exchangeRoutes,
        exchangeListAnchor,
        'const targetRegisterId = parsePositiveInt(req.query?.targetRegisterId);'
      ) <
        indexAfter(
          exchangeRoutes,
          exchangeListAnchor,
          'const legalEntityId = parsePositiveInt(req.query?.legalEntityId);'
        ),
    "cash.exchange.routes should resolve source/target register scope before legalEntity scope on list reads"
  );
  assert(
    exchangeRoutes.includes('router.get(\n  "/:exchangeBatchId",\n  requirePermission("cash.txn.read"),') &&
      exchangeRoutes.includes(
        'router.post(\n  "/:exchangeBatchId/post",\n  requirePermission("cash.txn.create"),'
      ) &&
      exchangeRoutes.includes(
        'router.post(\n  "/:exchangeBatchId/reverse",\n  requirePermission("cash.txn.reverse"),'
      ),
    "cash.exchange.routes should defer multi-register detail/post/reverse scope checks to the service layer"
  );

  const reportRoutes = normalizeSource(
    await readFile(path.resolve(root, "backend/src/routes/cash.report.routes.js"), "utf8")
  );
  assert(
    reportRoutes.indexOf("if (scopeInput.registerId) {") <
      reportRoutes.indexOf("if (scopeInput.legalEntityId) {") &&
      reportRoutes.indexOf("if (scopeInput.sourceRegisterId) {") <
        reportRoutes.indexOf("if (scopeInput.legalEntityId) {") &&
      reportRoutes.indexOf("if (scopeInput.targetRegisterId) {") <
        reportRoutes.indexOf("if (scopeInput.legalEntityId) {"),
    "cash.report.routes should resolve register-scoped report reads before legalEntity scope"
  );

  const sessionService = normalizeSource(
    await readFile(path.resolve(root, "backend/src/services/cash.session.service.js"), "utf8")
  );
  assert(
    sessionService.includes("resolveCashRegisterScopedFilters({"),
    "cash.session.service should normalize register-scoped filters through the shared ownership helper"
  );

  const transactionService = normalizeSource(
    await readFile(path.resolve(root, "backend/src/services/cash.transaction.service.js"), "utf8")
  );
  assert(
    transactionService.includes("resolveCashRegisterScopedFilters({") &&
      transactionService.includes("sourceRegisterId does not belong to legalEntityId") &&
      transactionService.includes("targetRegisterId does not belong to legalEntityId"),
    "cash.transaction.service should treat legalEntityId as a relationship filter when register-scoped transit filters are present"
  );

  const exceptionService = normalizeSource(
    await readFile(path.resolve(root, "backend/src/services/cash.exception.service.js"), "utf8")
  );
  assert(
    exceptionService.includes("buildCashOwnershipScopeFilter(req, {") &&
      exceptionService.includes("resolveCashRegisterScopedFilters({") &&
      exceptionService.includes("jl_scope.operating_unit_id"),
    "cash.exception.service should use ownership-aware filters for sessions, transactions, and GL audit visibility"
  );

  const exchangeService = normalizeSource(
    await readFile(path.resolve(root, "backend/src/services/cash.exchange.service.js"), "utf8")
  );
  assert(
    exchangeService.includes("assertExchangeParticipantScopeAccess") &&
      exchangeService.includes("assertExchangePairScopeAccess") &&
      exchangeService.includes("sr.operating_unit_id") &&
      exchangeService.includes("tr.operating_unit_id"),
    "cash.exchange.service should distinguish participant visibility from dual-register action scope"
  );

  const reportService = normalizeSource(
    await readFile(path.resolve(root, "backend/src/services/cash.report.service.js"), "utf8")
  );
  assert(
    reportService.includes("buildCashOwnershipScopeFilter(req, {") &&
      reportService.includes("assertCashOwnershipScopeAccess(req, register, assertScopeAccess, \"registerId\")"),
    "cash.report.service should honor register ownership when foreign-cash reports are filtered to a cash register"
  );

  console.log("Cash register ownership CRO08 branch read scope smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
