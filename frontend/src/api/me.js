import { api } from "./client.js";

function toQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function getMePreferences() {
  const response = await api.get("/me/preferences");
  return response.data;
}

export async function updateMePreferences(payload = {}) {
  const response = await api.put("/me/preferences", payload);
  return response.data;
}

export async function listMeSavedViews(params = {}) {
  const response = await api.get(`/me/saved-views${toQueryString(params)}`);
  return response.data;
}

export async function createMeSavedView(payload = {}) {
  const response = await api.post("/me/saved-views", payload);
  return response.data;
}

export async function updateMeSavedView(savedViewId, payload = {}) {
  const response = await api.put(`/me/saved-views/${savedViewId}`, payload);
  return response.data;
}

export async function deleteMeSavedView(savedViewId) {
  const response = await api.delete(`/me/saved-views/${savedViewId}`);
  return response.data;
}

export async function listMeNotifications(params = {}) {
  const response = await api.get(`/me/notifications${toQueryString(params)}`);
  return response.data;
}

export async function markMeNotificationRead(notificationId) {
  const response = await api.put(`/me/notifications/${notificationId}/read`, {});
  return response.data;
}

export async function markAllMeNotificationsRead() {
  const response = await api.put("/me/notifications/read-all", {});
  return response.data;
}
