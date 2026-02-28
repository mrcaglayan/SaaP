import { api } from "./client.js";

export async function getInvitePreview(token) {
  const response = await api.get(`/auth/invite/${encodeURIComponent(String(token || ""))}`, {
    skipAuthRedirect: true,
  });
  return response.data;
}

export async function acceptInvite(token, payload) {
  const response = await api.post(
    `/auth/invite/${encodeURIComponent(String(token || ""))}/accept`,
    payload,
    { skipAuthRedirect: true }
  );
  return response.data;
}

export async function requestPasswordReset(payload) {
  const response = await api.post("/auth/password-reset/request", payload, {
    skipAuthRedirect: true,
  });
  return response.data;
}

export async function getPasswordResetPreview(token) {
  const response = await api.get(
    `/auth/password-reset/${encodeURIComponent(String(token || ""))}`,
    {
      skipAuthRedirect: true,
    }
  );
  return response.data;
}

export async function completePasswordReset(token, payload) {
  const response = await api.post(
    `/auth/password-reset/${encodeURIComponent(String(token || ""))}/complete`,
    payload,
    {
      skipAuthRedirect: true,
    }
  );
  return response.data;
}
