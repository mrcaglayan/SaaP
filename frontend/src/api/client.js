import axios from "axios";

let onUnauthorized = null;
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
  timeout: 20000,
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const skipAuthRedirect = Boolean(err?.config?.skipAuthRedirect);
    if (status === 401) {
      // Cookie session expired/invalid.
      if (!skipAuthRedirect && typeof onUnauthorized === "function") onUnauthorized();
    }
    return Promise.reject(err);
  }
);
