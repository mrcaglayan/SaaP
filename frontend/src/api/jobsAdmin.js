import { api } from "./client.js";

export async function listJobsAdmin(params = {}) {
  const response = await api.get("/api/v1/jobs", { params });
  return response.data;
}

export async function getJobAdmin(jobId) {
  const response = await api.get(`/api/v1/jobs/${Number(jobId)}`);
  return response.data;
}

export async function cancelJobAdmin(jobId) {
  const response = await api.post(`/api/v1/jobs/${Number(jobId)}/cancel`, {});
  return response.data;
}

export async function requeueJobAdmin(jobId, payload = {}) {
  const response = await api.post(`/api/v1/jobs/${Number(jobId)}/requeue`, payload);
  return response.data;
}

export async function runOneJobAdmin(payload = {}) {
  const response = await api.post("/api/v1/jobs/run-once", payload);
  return response.data;
}

