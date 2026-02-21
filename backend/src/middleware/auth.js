import jwt from "jsonwebtoken";
import { getAuthCookieName, readCookieValue } from "../auth/cookieSession.js";

function resolveBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return null;
  }
  return String(token).trim() || null;
}

function resolveAuthToken(req) {
  const cookieToken = readCookieValue(req, getAuthCookieName());
  const bearerToken = resolveBearerToken(req);

  const candidates = [];
  if (cookieToken) {
    candidates.push(cookieToken);
  }
  if (bearerToken && bearerToken !== cookieToken) {
    candidates.push(bearerToken);
  }

  return candidates;
}

export function requireAuth(req, res, next) {
  const tokenCandidates = resolveAuthToken(req);
  const jwtSecret = process.env.JWT_SECRET;

  if (!tokenCandidates.length) {
    return res.status(401).json({ message: "Missing token" });
  }

  if (!jwtSecret) {
    return res.status(500).json({ message: "JWT secret is not configured" });
  }

  for (const token of tokenCandidates) {
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = payload;
      return next();
    } catch {
      // Try next available token candidate.
    }
  }

  return res.status(401).json({ message: "Invalid or expired token" });
}
