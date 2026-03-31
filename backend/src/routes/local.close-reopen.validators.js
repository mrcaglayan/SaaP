import { badRequest } from "./_utils.js";
import {
  normalizeEnum,
  normalizeText,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import { LOCAL_CLOSE_PACK_REOPEN_ACTION_TYPES } from "../services/local.close-packs.shared.js";

const LOCAL_CLOSE_PACK_REOPEN_REQUEST_STATUS_VALUES = Object.freeze([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
]);

const LOCAL_CLOSE_PACK_REOPEN_MATERIALITY_LEVEL_VALUES = Object.freeze([
  "UNKNOWN",
  "IMMATERIAL",
  "MATERIAL",
]);

const LOCAL_CLOSE_PACK_REOPEN_DOWNSTREAM_STAGE_VALUES = Object.freeze([
  "ENTITY_NOT_SUBMITTED",
  "ENTITY_SUBMITTED",
  "GROUP_REVIEW",
  "GROUP_PUBLISHED",
]);

function normalizeReasonCode(value, label = "reasonCode") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!/^[A-Z0-9_:-]+$/.test(normalized)) {
    throw badRequest(`${label} contains invalid characters`);
  }
  if (normalized.length > 80) {
    throw badRequest(`${label} cannot exceed 80 characters`);
  }
  return normalized;
}

/**
 * Parse create input for governed local close-pack reopen requests.
 */
export function parseLocalClosePackReopenRequestCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  return {
    tenantId,
    userId,
    packId: requirePositiveInt(req.params?.packId, "packId"),
    reasonCode: normalizeReasonCode(body.reasonCode ?? body.reason_code),
    requestedActionType: normalizeEnum(
      body.requestedActionType ?? body.requested_action_type,
      "requestedActionType",
      LOCAL_CLOSE_PACK_REOPEN_ACTION_TYPES
    ),
    explanation: normalizeText(body.explanation, "explanation", 2000, {
      required: true,
    }),
    materialityLevel:
      normalizeEnum(
        body.materialityLevel ?? body.materiality_level ?? "UNKNOWN",
        "materialityLevel",
        LOCAL_CLOSE_PACK_REOPEN_MATERIALITY_LEVEL_VALUES
      ) || "UNKNOWN",
    estimatedImpactNote: normalizeText(
      body.estimatedImpactNote ?? body.estimated_impact_note,
      "estimatedImpactNote",
      500
    ),
    downstreamStage:
      normalizeEnum(
        body.downstreamStage ?? body.downstream_stage ?? "ENTITY_NOT_SUBMITTED",
        "downstreamStage",
        LOCAL_CLOSE_PACK_REOPEN_DOWNSTREAM_STAGE_VALUES
      ) || "ENTITY_NOT_SUBMITTED",
  };
}

/**
 * Parse list filters for local close-pack reopen requests.
 */
export function parseLocalClosePackReopenRequestListInput(req) {
  return {
    tenantId: requireTenantId(req),
    packId: requirePositiveInt(req.params?.packId, "packId"),
    requestStatus: req.query?.requestStatus
      ? normalizeEnum(
          req.query.requestStatus,
          "requestStatus",
          LOCAL_CLOSE_PACK_REOPEN_REQUEST_STATUS_VALUES
        )
      : null,
  };
}

/**
 * Parse approve/reject input for local close-pack reopen requests.
 */
export function parseLocalClosePackReopenRequestDecisionInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  return {
    tenantId,
    userId,
    packId: requirePositiveInt(req.params?.packId, "packId"),
    requestId: requirePositiveInt(req.params?.requestId, "requestId"),
    decisionNote: normalizeText(
      body.decisionNote ?? body.decision_note ?? body.note,
      "decisionNote",
      1000
    ),
  };
}

export default {
  parseLocalClosePackReopenRequestCreateInput,
  parseLocalClosePackReopenRequestListInput,
  parseLocalClosePackReopenRequestDecisionInput,
};
