import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query } from "./db.js";
import { getLoginRateLimiterHealth } from "./auth/loginRateLimiter.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import orgRoutes from "./routes/org.js";
import securityRoutes from "./routes/security.js";
import securitySensitiveDataAuditRoutes from "./routes/security.sensitiveDataAudit.routes.js";
import jobsAdminRoutes from "./routes/jobs.admin.routes.js";
import glRoutes from "./routes/gl.js";
import fxRoutes from "./routes/fx.js";
import intercompanyRoutes from "./routes/intercompany.js";
import consolidationRoutes from "./routes/consolidation.js";
import onboardingRoutes from "./routes/onboarding.js";
import onboardingPolicyPacksRoutes from "./routes/onboarding.policy-packs.routes.js";
import onboardingPolicyPacksResolveRoutes from "./routes/onboarding.policy-packs.resolve.routes.js";
import onboardingPolicyPacksApplyRoutes from "./routes/onboarding.policy-packs.apply.routes.js";
import onboardingModuleReadinessRoutes from "./routes/onboarding.module-readiness.routes.js";
import rbacRoutes from "./routes/rbac.js";
import providerRoutes from "./routes/provider.js";
import cashRegisterRoutes from "./routes/cash.register.routes.js";
import cashSessionRoutes from "./routes/cash.session.routes.js";
import cashTransactionRoutes from "./routes/cash.transaction.routes.js";
import cashConfigRoutes from "./routes/cash.config.routes.js";
import cashExceptionRoutes from "./routes/cash.exception.routes.js";
import bankAccountsRoutes from "./routes/bank.accounts.routes.js";
import bankConnectorsRoutes from "./routes/bank.connectors.routes.js";
import bankStatementsRoutes from "./routes/bank.statements.routes.js";
import bankReconciliationRoutes from "./routes/bank.reconciliation.routes.js";
import bankReconciliationRulesRoutes from "./routes/bank.reconciliationRules.routes.js";
import bankReconciliationPostingTemplatesRoutes from "./routes/bank.reconciliationPostingTemplates.routes.js";
import bankReconciliationDifferenceProfilesRoutes from "./routes/bank.reconciliationDifferenceProfiles.routes.js";
import bankReconciliationExceptionsRoutes from "./routes/bank.reconciliationExceptions.routes.js";
import bankPaymentFilesRoutes from "./routes/bank.paymentFiles.routes.js";
import bankPaymentReturnsRoutes from "./routes/bank.paymentReturns.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import payrollRunsRoutes from "./routes/payroll.runs.routes.js";
import payrollMappingsRoutes from "./routes/payroll.mappings.routes.js";
import payrollAccrualsRoutes from "./routes/payroll.accruals.routes.js";
import payrollLiabilitiesRoutes from "./routes/payroll.liabilities.routes.js";
import payrollPaymentSyncRoutes from "./routes/payroll.paymentSync.routes.js";
import payrollCorrectionsRoutes from "./routes/payroll.corrections.routes.js";
import payrollSettlementOverridesRoutes from "./routes/payroll.settlementOverrides.routes.js";
import payrollBeneficiariesRoutes from "./routes/payroll.beneficiaries.routes.js";
import payrollCloseRoutes from "./routes/payroll.close.routes.js";
import payrollProvidersRoutes from "./routes/payroll.providers.routes.js";
import cariRoutes from "./routes/cari.js";
import contractsRoutes from "./routes/contracts.js";
import revenueRecognitionRoutes from "./routes/revenue-recognition.js";
import { requireAuth } from "./middleware/auth.js";
import {
  buildRequestLogMeta,
  logError,
  logInfo,
  logWarn,
  resolveRequestId,
} from "./observability/logger.js";
import { assertEncryptionConfigured } from "./utils/cryptoEnvelope.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging") {
  try {
    assertEncryptionConfigured();
  } catch (err) {
    // Dev mode warning only; H01 enforces fail-fast in prod/staging.
    // eslint-disable-next-line no-console
    console.warn("[WARN] Encryption not fully configured (dev mode):", err?.message || err);
  }
} else {
  assertEncryptionConfigured();
}

const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Provider-Key",
    "X-Request-Id",
    "X-Correlation-Id",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(express.json());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use((req, res, next) => {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  return next();
});

app.get("/health", async (req, res) => {
  let ready = true;
  const checks = {};

  try {
    await query("SELECT 1 AS ok");
    checks.db = { status: "up" };
  } catch (err) {
    ready = false;
    checks.db = {
      status: "down",
      message: "Database ping failed",
    };
    logError(
      "Health check failed for database",
      buildRequestLogMeta(req),
      err
    );
  }

  try {
    const rateLimiterHealth = await getLoginRateLimiterHealth();
    checks.redis = {
      status: rateLimiterHealth.redis.status,
      mode: rateLimiterHealth.redis.mode,
      backend: rateLimiterHealth.redis.backend,
    };

    if (rateLimiterHealth.redis.status === "down") {
      ready = false;
    }
  } catch (err) {
    ready = false;
    checks.redis = {
      status: "down",
      mode: "unknown",
      backend: "unknown",
    };
    logError(
      "Health check failed for redis/rate limiter",
      buildRequestLogMeta(req),
      err
    );
  }

  const status = ready ? 200 : 503;
  return res.status(status).json({
    ok: ready,
    requestId: req.requestId || null,
    checks,
  });
});

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/api/v1/provider", providerRoutes);
app.use("/api/v1/org", requireAuth, orgRoutes);
app.use("/api/v1/security", requireAuth, securityRoutes);
app.use("/api/v1/security", requireAuth, securitySensitiveDataAuditRoutes);
app.use("/api/v1/jobs", requireAuth, jobsAdminRoutes);
app.use("/api/v1/gl", requireAuth, glRoutes);
app.use("/api/v1/fx", requireAuth, fxRoutes);
app.use("/api/v1/intercompany", requireAuth, intercompanyRoutes);
app.use("/api/v1/consolidation", requireAuth, consolidationRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingPolicyPacksRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingPolicyPacksResolveRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingPolicyPacksApplyRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingModuleReadinessRoutes);
app.use("/api/v1/rbac", requireAuth, rbacRoutes);
app.use("/api/v1/cash/registers", requireAuth, cashRegisterRoutes);
app.use("/api/v1/cash/sessions", requireAuth, cashSessionRoutes);
app.use("/api/v1/cash/transactions", requireAuth, cashTransactionRoutes);
app.use("/api/v1/cash/config", requireAuth, cashConfigRoutes);
app.use("/api/v1/cash/exceptions", requireAuth, cashExceptionRoutes);
app.use("/api/v1/bank/accounts", requireAuth, bankAccountsRoutes);
app.use("/api/v1/bank", requireAuth, bankConnectorsRoutes);
app.use("/api/v1/bank/statements", requireAuth, bankStatementsRoutes);
app.use("/api/v1/bank/reconciliation", requireAuth, bankReconciliationRoutes);
app.use("/api/v1/bank/reconciliation", requireAuth, bankReconciliationRulesRoutes);
app.use("/api/v1/bank/reconciliation", requireAuth, bankReconciliationPostingTemplatesRoutes);
app.use("/api/v1/bank/reconciliation", requireAuth, bankReconciliationDifferenceProfilesRoutes);
app.use("/api/v1/bank/reconciliation", requireAuth, bankReconciliationExceptionsRoutes);
app.use("/api/v1/bank", requireAuth, bankPaymentFilesRoutes);
app.use("/api/v1/bank", requireAuth, bankPaymentReturnsRoutes);
app.use("/api/v1/payments", requireAuth, paymentsRoutes);
app.use("/api/v1/payroll/runs", requireAuth, payrollRunsRoutes);
app.use("/api/v1/payroll/mappings", requireAuth, payrollMappingsRoutes);
app.use("/api/v1/payroll/runs", requireAuth, payrollAccrualsRoutes);
app.use("/api/v1/payroll/runs", requireAuth, payrollPaymentSyncRoutes);
app.use("/api/v1/payroll", requireAuth, payrollCorrectionsRoutes);
app.use("/api/v1/payroll", requireAuth, payrollSettlementOverridesRoutes);
app.use("/api/v1/payroll", requireAuth, payrollBeneficiariesRoutes);
app.use("/api/v1/payroll", requireAuth, payrollLiabilitiesRoutes);
app.use("/api/v1/payroll", requireAuth, payrollProvidersRoutes);
app.use("/api/v1/payroll/close-controls", requireAuth, payrollCloseRoutes);
app.use("/api/v1/cari", requireAuth, cariRoutes);
app.use("/api/v1/contracts", requireAuth, contractsRoutes);
app.use("/api/v1/revenue-recognition", requireAuth, revenueRecognitionRoutes);

app.use((req, res) => {
  return res.status(404).json({
    message: "Route not found",
    requestId: req.requestId || null,
  });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const logMeta = buildRequestLogMeta(req, { status });
  if (status >= 500) {
    logError("Unhandled request error", logMeta, err);
  } else {
    logWarn("Handled request error", logMeta, err);
  }

  if (res.headersSent) {
    return next(err);
  }

  const message = status >= 500 ? "Internal server error" : err.message;

  return res.status(status).json({
    message,
    requestId: req.requestId || null,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logInfo("API server started", {
    port: Number(port),
    baseUrl: `http://localhost:${port}`,
  });
});
