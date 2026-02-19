import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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
import { requireAuth } from "./middleware/auth.js";

dotenv.config();

const app = express();
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
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 200,
};

app.use(express.json());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/api/v1/org", requireAuth, orgRoutes);
app.use("/api/v1/security", requireAuth, securityRoutes);
app.use("/api/v1/gl", requireAuth, glRoutes);
app.use("/api/v1/fx", requireAuth, fxRoutes);
app.use("/api/v1/intercompany", requireAuth, intercompanyRoutes);
app.use("/api/v1/consolidation", requireAuth, consolidationRoutes);
app.use("/api/v1/onboarding", requireAuth, onboardingRoutes);
app.use("/api/v1/rbac", requireAuth, rbacRoutes);

app.use((req, res) => {
  return res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;
  const message = status >= 500 ? "Internal server error" : err.message;

  return res.status(status).json({ message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
