import { badRequest, parsePositiveInt } from "../routes/_utils.js";

export const CONSOLIDATION_SCENARIO_CODES = Object.freeze([
  "TRIAL",
  "OFFICIAL",
  "RESTATED",
  "SIMULATION",
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Derive additive scenario metadata from the existing consolidation run-name
 * identity without changing the PR-01 OFFICIAL run-name contract.
 */
export function deriveConsolidationScenarioCode(runName) {
  const normalizedRunName = toUpperText(runName);
  if (normalizedRunName === "OFFICIAL") {
    return "OFFICIAL";
  }
  if (normalizedRunName.includes("RESTAT")) {
    return "RESTATED";
  }
  if (normalizedRunName.includes("SIMULAT")) {
    return "SIMULATION";
  }
  return "TRIAL";
}

/**
 * Normalize one requested consolidation scenario while enforcing the repo's
 * existing OFFICIAL run-name semantics for cycle-governed official runs.
 */
export function normalizeConsolidationScenarioCode(
  value,
  { runName = null } = {},
) {
  const normalizedRunName = toUpperText(runName);
  const scenarioCode = value
    ? toUpperText(value)
    : deriveConsolidationScenarioCode(normalizedRunName);

  if (!CONSOLIDATION_SCENARIO_CODES.includes(scenarioCode)) {
    throw badRequest(
      `scenarioCode must be one of ${CONSOLIDATION_SCENARIO_CODES.join(", ")}`,
    );
  }

  if (normalizedRunName === "OFFICIAL" && scenarioCode !== "OFFICIAL") {
    throw badRequest(
      "scenarioCode must be OFFICIAL when runName is OFFICIAL",
    );
  }
  if (scenarioCode === "OFFICIAL" && normalizedRunName !== "OFFICIAL") {
    throw badRequest(
      "scenarioCode OFFICIAL requires runName = OFFICIAL",
    );
  }

  return scenarioCode;
}

/**
 * Normalize the additive scenario version number used for PR-09 management
 * monitoring without changing the run-name identity contract.
 */
export function normalizeConsolidationVersionNo(value) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }

  const versionNo = parsePositiveInt(value);
  if (!versionNo) {
    throw badRequest("versionNo must be a positive integer");
  }
  return versionNo;
}

export default {
  CONSOLIDATION_SCENARIO_CODES,
  deriveConsolidationScenarioCode,
  normalizeConsolidationScenarioCode,
  normalizeConsolidationVersionNo,
};
