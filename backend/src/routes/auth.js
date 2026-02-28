import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import {
  clearFailedLoginAttempts,
  getRateLimitBlockInfo,
  registerFailedLoginAttempt,
} from "../auth/loginRateLimiter.js";
import {
  getAuthCookieClearOptions,
  getAuthCookieName,
  getAuthCookieOptions,
} from "../auth/cookieSession.js";
import {
  acceptInviteByToken,
  getInvitePreviewByToken,
} from "../services/userInvites.service.js";
import {
  completePasswordResetByToken,
  getPasswordResetPreviewByToken,
  requestPasswordResetByEmail,
} from "../services/passwordReset.service.js";

const router = express.Router();
const AUTH_TOKEN_EXPIRES_IN = String(process.env.AUTH_TOKEN_EXPIRES_IN || "7d");

function resolveClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((segment) => segment.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp.slice(0, 64);
    }
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 64);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sendRateLimitResponse(res, retryAfterSeconds) {
  res.set("Retry-After", String(retryAfterSeconds));
  return res.status(429).json({
    message: "Too many login attempts. Try again later.",
    retryAfterSeconds,
  });
}

// POST /auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const loginEmail = String(email).trim();
    const clientIp = resolveClientIp(req);
    const rateKey = `${clientIp}|${normalizedEmail}`;
    const blockInfo = await getRateLimitBlockInfo(rateKey);
    if (blockInfo.blocked) {
      return sendRateLimitResponse(res, blockInfo.retryAfterSeconds);
    }

    const { rows } = await query(
      `SELECT id, email, password_hash, name, tenant_id, status
       FROM users
       WHERE email = ?`,
      [loginEmail]
    );

    const user = rows[0];
    if (!user) {
      const failedAttempt = await registerFailedLoginAttempt(rateKey);
      if (failedAttempt.blocked) {
        return sendRateLimitResponse(res, failedAttempt.retryAfterSeconds);
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok || String(user.status || "").toUpperCase() !== "ACTIVE") {
      const failedAttempt = await registerFailedLoginAttempt(rateKey);
      if (failedAttempt.blocked) {
        return sendRateLimitResponse(res, failedAttempt.retryAfterSeconds);
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }

    await clearFailedLoginAttempts(rateKey);

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, tenantId: user.tenant_id || null },
      process.env.JWT_SECRET,
      { expiresIn: AUTH_TOKEN_EXPIRES_IN }
    );

    res.cookie(getAuthCookieName(), token, getAuthCookieOptions());
    return res.json({
      ok: true,
      expiresIn: AUTH_TOKEN_EXPIRES_IN,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie(getAuthCookieName(), getAuthCookieClearOptions());
  return res.json({ ok: true });
});

// POST /auth/password-reset/request
router.post("/password-reset/request", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }
    const payload = await requestPasswordResetByEmail(email);
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

// GET /auth/password-reset/:token
router.get("/password-reset/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    const reset = await getPasswordResetPreviewByToken(token);
    if (!reset) {
      return res.status(404).json({ message: "Invalid reset token" });
    }
    return res.json({
      ok: true,
      reset,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/password-reset/:token/complete
router.post("/password-reset/:token/complete", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    const payload = await completePasswordResetByToken({
      rawToken: token,
      password: req.body?.password,
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

// GET /auth/invite/:token
router.get("/invite/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    const invite = await getInvitePreviewByToken(token);
    if (!invite) {
      return res.status(404).json({ message: "Invalid invite token" });
    }
    return res.json({
      ok: true,
      invite,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/invite/:token/accept
router.post("/invite/:token/accept", async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    const payload = await acceptInviteByToken({
      rawToken: token,
      password: req.body?.password,
      name: req.body?.name,
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
