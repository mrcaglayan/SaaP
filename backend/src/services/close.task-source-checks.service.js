import { badRequest } from "../routes/_utils.js";
import { isCloseTaskSourceCheckMode } from "./close.task-scope.service.js";

function buildSourceCheckPayload(taskRow) {
  return {
    sourceCheckCode: taskRow?.source_check_code || null,
    sourceRefType: taskRow?.source_ref_type || null,
    sourceRefId: taskRow?.source_ref_id || null,
    evaluator: "NOT_WIRED",
    message:
      "Source-check evaluator is not wired yet; this refresh only records that the task was checked.",
  };
}

/**
 * Evaluate a close task source-check contract and return a persistable result.
 *
 * PR-CTM-03 stores the refresh result on the task instance. Concrete source
 * adapters are intentionally added later, so this function reports
 * `NOT_WIRED` instead of pretending the business system check passed.
 */
export async function evaluateCloseTaskSourceCheck(taskRow) {
  if (!isCloseTaskSourceCheckMode(taskRow?.completion_mode)) {
    throw badRequest("refresh-source-check is only available for source-check task modes");
  }

  return {
    status: taskRow?.source_check_code ? "NOT_WIRED" : "NOT_CONFIGURED",
    payload: buildSourceCheckPayload(taskRow),
    autoComplete: false,
  };
}
