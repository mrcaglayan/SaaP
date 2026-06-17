import express from "express";
import { requireAnyPermission, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";
import {
  approveCloseTask,
  cancelCloseTask,
  createManualCloseTask,
  getCloseTaskById,
  listCloseTasks,
  refreshCloseTaskSourceCheck,
  reopenCloseTask,
  resolveCloseTaskCreatePayloadScope,
  resolveCloseTaskRouteScope,
  resolveCloseCycleTaskRouteScope,
  returnCloseTask,
  startCloseTask,
  submitCloseTask,
  updateCloseTask,
  waiveCloseTask,
} from "../services/close.tasks.service.js";
import {
  createCloseTaskTemplate,
  disableCloseTaskTemplate,
  listCloseTaskTemplates,
  updateCloseTaskTemplate,
} from "../services/close.task-templates.service.js";
import {
  attachCloseTaskEvidence,
  downloadCloseTaskEvidence,
  listCloseTaskEvidence,
  removeCloseTaskEvidence,
  uploadCloseTaskEvidenceContent,
} from "../services/close.task-evidence.service.js";
import {
  createCloseTaskComment,
  deleteCloseTaskComment,
  listCloseTaskComments,
} from "../services/close.task-comments.service.js";
import { listCloseTaskEvents } from "../services/close.task-events.service.js";
import {
  parseCloseCycleIdParam,
  parseCloseCycleTaskListInput,
  parseCloseTaskActionInput,
  parseCloseTaskCommentCreateInput,
  parseCloseTaskCommentDeleteInput,
  parseCloseTaskCreateInput,
  parseCloseTaskEvidenceAttachInput,
  parseCloseTaskEvidenceMutationInput,
  parseCloseTaskIdParam,
  parseCloseTaskListInput,
  parseCloseTaskPatchInput,
  parseCloseTaskTemplateCreateInput,
  parseCloseTaskTemplateIdParam,
  parseCloseTaskTemplateListInput,
  parseCloseTaskTemplatePatchInput,
} from "./close.tasks.validators.js";

const router = express.Router();

const readTaskScope = async (req, tenantId) =>
  resolveCloseTaskRouteScope(req.params?.taskId, tenantId);

const readCycleScope = async (req, tenantId) =>
  resolveCloseCycleTaskRouteScope(req.params?.cycleId ?? req.params?.id, tenantId);

const createTaskScope = async (req, tenantId) =>
  resolveCloseTaskCreatePayloadScope(req.body || {}, tenantId);

function buildActorCtx(input, req) {
  return {
    tenantId: input.tenantId,
    userId: input.userId || req.user?.userId,
    req,
  };
}

router.get(
  "/task-templates",
  requirePermission("close.task.template.read"),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskTemplateListInput(req);
    const result = await listCloseTaskTemplates(input, buildActorCtx(input, req));
    return res.json({ tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/task-templates",
  requirePermission("close.task.template.write"),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskTemplateCreateInput(req);
    const result = await createCloseTaskTemplate(input, buildActorCtx(input, req));
    return res.status(201).json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.patch(
  "/task-templates/:templateId",
  requirePermission("close.task.template.write"),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskTemplatePatchInput(req);
    const result = await updateCloseTaskTemplate(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/task-templates/:templateId/disable",
  requirePermission("close.task.template.write"),
  asyncHandler(async (req, res) => {
    const tenantId = parsePositiveInt(req.user?.tenantId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    const input = {
      tenantId,
      userId,
      templateId: parseCloseTaskTemplateIdParam(req),
    };
    const result = await disableCloseTaskTemplate(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.get(
  "/tasks",
  requirePermission("close.task.read"),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskListInput(req);
    const result = await listCloseTasks(input, buildActorCtx(input, req));
    return res.json({ tenantId: input.tenantId, ...result });
  }),
);

router.get(
  "/cycles/:cycleId/tasks",
  requirePermission("close.task.read", { resolveScope: readCycleScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseCycleTaskListInput(req);
    const result = await listCloseTasks(input, buildActorCtx(input, req));
    return res.json({ tenantId: input.tenantId, cycleId: input.closeCycleId, ...result });
  }),
);

router.post(
  "/cycles/:cycleId/tasks",
  requirePermission("close.task.create", { resolveScope: createTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskCreateInput(req);
    const result = await createManualCloseTask(input, buildActorCtx(input, req));
    return res.status(201).json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.get(
  "/tasks/:taskId",
  requirePermission("close.task.read", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const tenantId = parsePositiveInt(req.user?.tenantId);
    const taskId = parseCloseTaskIdParam(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    const result = await getCloseTaskById(taskId, { tenantId, userId: req.user?.userId, req });
    return res.json({ tenantId, row: result.row });
  }),
);

router.patch(
  "/tasks/:taskId",
  requireAnyPermission(["close.task.assign", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskPatchInput(req);
    const result = await updateCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/start",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await startCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/submit",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await submitCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/return",
  requireAnyPermission(["close.task.review", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req, { requireReason: true });
    const result = await returnCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/approve",
  requireAnyPermission(["close.task.review", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await approveCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/waive",
  requirePermission("close.task.waive", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req, { requireReason: true });
    const result = await waiveCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/cancel",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req, { requireReason: true });
    const result = await cancelCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/reopen",
  requirePermission("close.task.admin", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await reopenCloseTask(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/refresh-source-check",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await refreshCloseTaskSourceCheck(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, ...result });
  }),
);

router.get(
  "/tasks/:taskId/events",
  requirePermission("close.task.read", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const tenantId = parsePositiveInt(req.user?.tenantId);
    const taskId = parseCloseTaskIdParam(req);
    const result = await listCloseTaskEvents({ tenantId, taskId });
    return res.json({ tenantId, taskId, ...result });
  }),
);

router.get(
  "/tasks/:taskId/evidence",
  requirePermission("close.task.read", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await listCloseTaskEvidence(input, buildActorCtx(input, req));
    return res.json({ tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/evidence",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskEvidenceAttachInput(req);
    const result = await attachCloseTaskEvidence(input, buildActorCtx(input, req));
    return res.status(201).json({ ok: true, tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

router.put(
  "/tasks/:taskId/evidence/:evidenceId/content",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    parseCloseTaskEvidenceMutationInput(req);
    await uploadCloseTaskEvidenceContent();
    return res.status(204).send();
  }),
);

router.get(
  "/tasks/:taskId/evidence/:evidenceId/download",
  requirePermission("close.task.read", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    parseCloseTaskEvidenceMutationInput(req);
    await downloadCloseTaskEvidence();
    return res.status(204).send();
  }),
);

router.delete(
  "/tasks/:taskId/evidence/:evidenceId",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskEvidenceMutationInput(req);
    const result = await removeCloseTaskEvidence(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

router.get(
  "/tasks/:taskId/comments",
  requirePermission("close.task.read", { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskActionInput(req);
    const result = await listCloseTaskComments(input, buildActorCtx(input, req));
    return res.json({ tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

router.post(
  "/tasks/:taskId/comments",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskCommentCreateInput(req);
    const result = await createCloseTaskComment(input, buildActorCtx(input, req));
    return res.status(201).json({ ok: true, tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

router.delete(
  "/tasks/:taskId/comments/:commentId",
  requireAnyPermission(["close.task.work", "close.task.admin"], { resolveScope: readTaskScope }),
  asyncHandler(async (req, res) => {
    const input = parseCloseTaskCommentDeleteInput(req);
    const result = await deleteCloseTaskComment(input, buildActorCtx(input, req));
    return res.json({ ok: true, tenantId: input.tenantId, taskId: input.taskId, ...result });
  }),
);

export default router;
