import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query } from "./db.js";
import { getLoginRateLimiterHealth } from "./auth/loginRateLimiter.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import orgRoutes from "./routes/org.js";
import securityRoutes from "./routes/security.js";
import glRoutes from "./routes/gl.js";
import fxRoutes from "./routes/fx.js";
import intercompanyRoutes from "./routes/intercompany.js";
import consolidationRoutes from "./routes/consolidation.js";
import onboardingRoutes from "./routes/onboarding.js";
import rbacRoutes from "./routes/rbac.js";
import providerRoutes from "./routes/provider.js";
import { requireAuth } from "./middleware/auth.js";
import {
  buildRequestLogMeta,
  logError,
  logInfo,
  logWarn,
  resolveRequestId,
} from "./observability/logger.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
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
app.use("/api/v1/gl", requireAuth, glRoutes);
app.use("/api/v1/fx", requireAuth, fxRoutes);
app.use("/api/v1/intercompany", requireAuth, intercompanyRoutes);
app.use("/api/v1/consolidation", requireAuth, consolidationRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingRoutes);
app.use("/api/v1/rbac", requireAuth, rbacRoutes);

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
