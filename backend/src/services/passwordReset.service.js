import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { query, withTransaction } from "../db.js";

const RESET_STATUS = Object.freeze({
  PENDING: "PENDING",
  USED: "USED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
});

const DEFAULT_RESET_TTL_MINUTES = 30;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeResetTtlMinutes() {
  const configured = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || DEFAULT_RESET_TTL_MINUTES);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RESET_TTL_MINUTES;
  }
  return Math.min(24 * 60, Math.floor(configured));
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function resolvePasswordResetBaseUrl() {
  const configured =
    process.env.PASSWORD_RESET_BASE_URL ||
    process.env.INVITE_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5173";
  return String(configured).replace(/\/+$/, "");
}

function validatePasswordOrThrow(password) {
  const normalized = String(password || "");
  if (normalized.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    err.status = 400;
    throw err;
  }
  if (normalized.length > MAX_PASSWORD_LENGTH) {
    const err = new Error(`password cannot exceed ${MAX_PASSWORD_LENGTH} characters`);
    err.status = 400;
    throw err;
  }
  return normalized;
}

function toResetStatus(row) {
  if (!row) return null;
  const now = Date.now();
  if (row.status === RESET_STATUS.USED || row.used_at) {
    return RESET_STATUS.USED;
  }
  if (row.status === RESET_STATUS.REVOKED || row.revoked_at) {
    return RESET_STATUS.REVOKED;
  }
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAtMs > 0 && expiresAtMs < now) {
    return RESET_STATUS.EXPIRED;
  }
  return RESET_STATUS.PENDING;
}

function buildResetUrl(rawToken) {
  const baseUrl = resolvePasswordResetBaseUrl();
  const encodedToken = encodeURIComponent(String(rawToken || ""));
  return `${baseUrl}/reset-password?token=${encodedToken}`;
}

async function getResetRowByTokenHash(tokenHash, runQuery = query) {
  const result = await runQuery(
    `SELECT
       upr.id,
       upr.tenant_id,
       upr.user_id,
       upr.email,
       upr.status,
       upr.expires_at,
       upr.used_at,
       upr.revoked_at,
       upr.created_at,
       u.name AS user_name
     FROM user_password_resets upr
     JOIN users u
       ON u.id = upr.user_id
      AND u.tenant_id = upr.tenant_id
     WHERE upr.reset_token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows?.[0] || null;
}

export async function requestPasswordResetByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
    const err = new Error("email is invalid");
    err.status = 400;
    throw err;
  }

  const userResult = await query(
    `SELECT id, tenant_id, email, status
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [normalizedEmail]
  );
  const user = userResult.rows?.[0] || null;
  if (!user || String(user.status || "").toUpperCase() !== "ACTIVE") {
    return {
      ok: true,
      reset: null,
    };
  }

  await query(
    `UPDATE user_password_resets
     SET status = 'REVOKED',
         revoked_at = UTC_TIMESTAMP()
     WHERE tenant_id = ?
       AND user_id = ?
       AND status = 'PENDING'
       AND used_at IS NULL
       AND revoked_at IS NULL`,
    [user.tenant_id, user.id]
  );

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const ttlMinutes = normalizeResetTtlMinutes();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const insertResult = await query(
    `INSERT INTO user_password_resets (
       tenant_id,
       user_id,
       email,
       reset_token_hash,
       status,
       expires_at
     )
     VALUES (?, ?, ?, ?, 'PENDING', ?)`,
    [user.tenant_id, user.id, normalizedEmail, tokenHash, expiresAt]
  );

  return {
    ok: true,
    reset: {
      id: Number(insertResult.rows?.insertId || 0),
      tenantId: Number(user.tenant_id),
      userId: Number(user.id),
      email: normalizedEmail,
      expiresAt,
      resetUrl: buildResetUrl(rawToken),
    },
  };
}

export async function getPasswordResetPreviewByToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const row = await getResetRowByTokenHash(tokenHash);
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    userId: Number(row.user_id),
    email: row.email,
    name: row.user_name || "",
    status: toResetStatus(row),
    expiresAt: row.expires_at,
    usedAt: row.used_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
  };
}

export async function completePasswordResetByToken({ rawToken, password }) {
  const token = String(rawToken || "").trim();
  if (!token) {
    const err = new Error("reset token is required");
    err.status = 400;
    throw err;
  }
  const validatedPassword = validatePasswordOrThrow(password);
  const nextPasswordHash = await bcrypt.hash(validatedPassword, 10);
  const tokenHash = hashToken(token);

  return withTransaction(async (tx) => {
    const row = await getResetRowByTokenHash(tokenHash, tx.query);
    if (!row) {
      const err = new Error("Invalid reset token");
      err.status = 404;
      throw err;
    }

    const resolvedStatus = toResetStatus(row);
    if (resolvedStatus !== RESET_STATUS.PENDING) {
      const err = new Error(`Reset token is ${resolvedStatus.toLowerCase()}`);
      err.status = 400;
      throw err;
    }

    await tx.query(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [nextPasswordHash, row.user_id, row.tenant_id]
    );

    await tx.query(
      `UPDATE user_password_resets
       SET status = 'USED',
           used_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.id]
    );

    await tx.query(
      `UPDATE user_password_resets
       SET status = 'REVOKED',
           revoked_at = UTC_TIMESTAMP()
       WHERE tenant_id = ?
         AND user_id = ?
         AND id <> ?
         AND status = 'PENDING'
         AND used_at IS NULL
         AND revoked_at IS NULL`,
      [row.tenant_id, row.user_id, row.id]
    );

    return {
      ok: true,
      tenantId: Number(row.tenant_id),
      userId: Number(row.user_id),
      email: row.email,
    };
  });
}

