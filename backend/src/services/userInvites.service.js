import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { query, withTransaction } from "../db.js";

const INVITE_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
});

const DEFAULT_INVITE_TTL_HOURS = 72;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeInviteTtlHours() {
  const configured = Number(process.env.INVITE_TOKEN_TTL_HOURS || DEFAULT_INVITE_TTL_HOURS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_INVITE_TTL_HOURS;
  }
  return Math.min(24 * 30, Math.floor(configured));
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

function hashInviteToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function resolveInviteBaseUrl() {
  const configured =
    process.env.INVITE_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5173";
  return String(configured).replace(/\/+$/, "");
}

export function buildInviteUrl(rawToken) {
  const baseUrl = resolveInviteBaseUrl();
  const encodedToken = encodeURIComponent(String(rawToken || ""));
  return `${baseUrl}/accept-invite?token=${encodedToken}`;
}

function toInviteStatus(row) {
  const now = Date.now();
  if (!row) return null;
  if (row.status === INVITE_STATUS.ACCEPTED || row.accepted_at) {
    return INVITE_STATUS.ACCEPTED;
  }
  if (row.status === INVITE_STATUS.REVOKED || row.revoked_at) {
    return INVITE_STATUS.REVOKED;
  }
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt > 0 && expiresAt < now) {
    return INVITE_STATUS.EXPIRED;
  }
  return INVITE_STATUS.PENDING;
}

async function getInviteRowByTokenHash(inviteTokenHash, runQuery = query) {
  const result = await runQuery(
    `SELECT
       ui.id,
       ui.tenant_id,
       ui.user_id,
       ui.email,
       ui.status,
       ui.expires_at,
       ui.accepted_at,
       ui.revoked_at,
       ui.created_at,
       u.name AS user_name
     FROM user_invites ui
     JOIN users u
       ON u.id = ui.user_id
      AND u.tenant_id = ui.tenant_id
     WHERE ui.invite_token_hash = ?
     LIMIT 1`,
    [inviteTokenHash]
  );
  return result.rows?.[0] || null;
}

export async function getInvitePreviewByToken(rawToken) {
  const inviteToken = String(rawToken || "").trim();
  if (!inviteToken) {
    return null;
  }
  const tokenHash = hashInviteToken(inviteToken);
  const row = await getInviteRowByTokenHash(tokenHash);
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    userId: Number(row.user_id),
    email: row.email,
    name: row.user_name || "",
    status: toInviteStatus(row),
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
  };
}

/**
 * Creates or refreshes a tenant-local invite for a disabled or new user.
 *
 * Callers may provide a transaction-bound `runQuery` implementation when the
 * invite must commit together with related tenant setup, role assignment, or
 * audit-sensitive provisioning work.
 */
export async function createInviteForTenantUser({
  tenantId,
  actorUserId = null,
  email,
  name,
  runQuery = query,
}) {
  const normalizedTenantId = Number(tenantId);
  if (!Number.isInteger(normalizedTenantId) || normalizedTenantId <= 0) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
    const err = new Error("email is invalid");
    err.status = 400;
    throw err;
  }
  if (!normalizedName) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }

  const userLookup = await runQuery(
    `SELECT id, tenant_id, status
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [normalizedEmail]
  );
  const existingUser = userLookup.rows?.[0] || null;
  if (existingUser && Number(existingUser.tenant_id) !== normalizedTenantId) {
    const err = new Error("email already exists");
    err.status = 400;
    throw err;
  }

  let userId = Number(existingUser?.id || 0);
  if (userId > 0) {
    const userStatus = String(existingUser.status || "").toUpperCase();
    if (userStatus === "ACTIVE") {
      const err = new Error("email already belongs to an active user");
      err.status = 400;
      throw err;
    }
    await runQuery(
      `UPDATE users
       SET name = ?,
           status = 'DISABLED'
       WHERE id = ?
         AND tenant_id = ?`,
      [normalizedName, userId, normalizedTenantId]
    );
  } else {
    const pendingPasswordHash = await bcrypt.hash(generateInviteToken(), 10);
    const insertResult = await runQuery(
      `INSERT INTO users (
         tenant_id,
         email,
         password_hash,
         name,
         status
       )
       VALUES (?, ?, ?, ?, 'DISABLED')`,
      [normalizedTenantId, normalizedEmail, pendingPasswordHash, normalizedName]
    );
    userId = Number(insertResult.rows?.insertId || 0);
  }

  await runQuery(
    `UPDATE user_invites
     SET status = 'REVOKED',
         revoked_at = UTC_TIMESTAMP()
     WHERE tenant_id = ?
       AND user_id = ?
       AND status = 'PENDING'
       AND accepted_at IS NULL
       AND revoked_at IS NULL`,
    [normalizedTenantId, userId]
  );

  const rawToken = generateInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const ttlHours = normalizeInviteTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const inviteInsert = await runQuery(
    `INSERT INTO user_invites (
       tenant_id,
       user_id,
       email,
       invite_token_hash,
       status,
       expires_at,
       created_by_user_id
     )
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      normalizedTenantId,
      userId,
      normalizedEmail,
      tokenHash,
      expiresAt,
      Number.isInteger(Number(actorUserId)) ? Number(actorUserId) : null,
    ]
  );

  return {
    id: Number(inviteInsert.rows?.insertId || 0),
    tenantId: normalizedTenantId,
    userId,
    email: normalizedEmail,
    name: normalizedName,
    status: INVITE_STATUS.PENDING,
    expiresAt,
    inviteUrl: buildInviteUrl(rawToken),
    inviteToken: rawToken,
  };
}

export async function acceptInviteByToken({
  rawToken,
  password,
  name,
}) {
  const inviteToken = String(rawToken || "").trim();
  if (!inviteToken) {
    const err = new Error("invite token is required");
    err.status = 400;
    throw err;
  }
  const nextPassword = validatePasswordOrThrow(password);
  const nextName = normalizeName(name);

  const tokenHash = hashInviteToken(inviteToken);
  const passwordHash = await bcrypt.hash(nextPassword, 10);

  return withTransaction(async (tx) => {
    const inviteRow = await getInviteRowByTokenHash(tokenHash, tx.query);
    if (!inviteRow) {
      const err = new Error("Invalid invite token");
      err.status = 404;
      throw err;
    }

    const currentStatus = toInviteStatus(inviteRow);
    if (currentStatus !== INVITE_STATUS.PENDING) {
      const err = new Error(`Invite is ${currentStatus.toLowerCase()}`);
      err.status = 400;
      throw err;
    }

    await tx.query(
      `UPDATE users
       SET password_hash = ?,
           name = ?,
           status = 'ACTIVE'
       WHERE id = ?
         AND tenant_id = ?`,
      [passwordHash, nextName || inviteRow.user_name || inviteRow.email, inviteRow.user_id, inviteRow.tenant_id]
    );

    await tx.query(
      `UPDATE user_invites
       SET status = 'ACCEPTED',
           accepted_at = UTC_TIMESTAMP(),
           accepted_by_user_id = user_id
       WHERE id = ?`,
      [inviteRow.id]
    );

    await tx.query(
      `UPDATE user_invites
       SET status = 'REVOKED',
           revoked_at = UTC_TIMESTAMP()
       WHERE tenant_id = ?
         AND user_id = ?
         AND id <> ?
         AND status = 'PENDING'
         AND accepted_at IS NULL
         AND revoked_at IS NULL`,
      [inviteRow.tenant_id, inviteRow.user_id, inviteRow.id]
    );

    return {
      ok: true,
      tenantId: Number(inviteRow.tenant_id),
      userId: Number(inviteRow.user_id),
      email: inviteRow.email,
    };
  });
}
