import crypto from "node:crypto";
import { query } from "../db.js";

function hashFingerprint(payload) {
  const normalized = JSON.stringify(payload ?? null);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function createBadRequestError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function mapStoredRow(row) {
  if (!row) return null;
  const status = Number(row.response_status || 200);
  const payload =
    typeof row.response_json === "object" && row.response_json
      ? row.response_json
      : JSON.parse(String(row.response_json || "{}"));
  return {
    status,
    payload,
    fingerprint: String(row.request_fingerprint || ""),
  };
}

async function getStoredReplay({ scopeCode, idempotencyKey }) {
  const result = await query(
    `SELECT request_fingerprint, response_status, response_json
     FROM idempotency_keys
     WHERE scope_code = ?
       AND idempotency_key = ?
     LIMIT 1`,
    [scopeCode, idempotencyKey]
  );
  return mapStoredRow(result.rows?.[0] || null);
}

export async function executeIdempotentRequest({
  scopeCode,
  idempotencyKey = "",
  requestFingerprintInput = null,
  execute,
}) {
  const normalizedScope = String(scopeCode || "").trim().toUpperCase();
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedScope || !normalizedKey) {
    const result = await execute();
    return {
      idempotentReplay: false,
      status: Number(result?.status || 200),
      payload: result?.payload ?? {},
    };
  }

  const fingerprint = hashFingerprint(requestFingerprintInput);

  let existing = null;
  try {
    existing = await getStoredReplay({
      scopeCode: normalizedScope,
      idempotencyKey: normalizedKey,
    });
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    const fallbackResult = await execute();
    return {
      idempotentReplay: false,
      status: Number(fallbackResult?.status || 200),
      payload: fallbackResult?.payload ?? {},
    };
  }

  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw createBadRequestError(
        "Idempotency-Key was already used with a different request payload"
      );
    }
    return {
      idempotentReplay: true,
      status: existing.status,
      payload: existing.payload,
    };
  }

  const executed = await execute();
  const status = Number(executed?.status || 200);
  const payload = executed?.payload ?? {};
  const payloadJson = JSON.stringify(payload);

  try {
    await query(
      `INSERT INTO idempotency_keys (
         scope_code,
         idempotency_key,
         request_fingerprint,
         response_status,
         response_json
       ) VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [normalizedScope, normalizedKey, fingerprint, status, payloadJson]
    );
  } catch (err) {
    if (Number(err?.errno) === 1062) {
      const replay = await getStoredReplay({
        scopeCode: normalizedScope,
        idempotencyKey: normalizedKey,
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          throw createBadRequestError(
            "Idempotency-Key was already used with a different request payload"
          );
        }
        return {
          idempotentReplay: true,
          status: replay.status,
          payload: replay.payload,
        };
      }
    }
    if (!isMissingTableError(err)) {
      throw err;
    }
  }

  return {
    idempotentReplay: false,
    status,
    payload,
  };
}

