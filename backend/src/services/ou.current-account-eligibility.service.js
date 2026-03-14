function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDraftOperatingUnitCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDraftOperatingUnitName(value) {
  return String(value || "").trim();
}

export function isEligibleDraftOperatingUnit(row) {
  const code = normalizeDraftOperatingUnitCode(row?.code);
  const name = normalizeDraftOperatingUnitName(row?.name);
  const status = normalizeUpperText(row?.status || "ACTIVE");

  if (!code || !name) {
    return false;
  }
  if (status && status !== "ACTIVE") {
    return false;
  }

  return true;
}

export function summarizeOperatingUnitCurrentAccountEligibility(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const eligibleOperatingUnits = sourceRows
    .filter((row) => isEligibleDraftOperatingUnit(row))
    .map((row) => ({
      code: normalizeDraftOperatingUnitCode(row?.code),
      name: normalizeDraftOperatingUnitName(row?.name),
      status: normalizeUpperText(row?.status || "ACTIVE"),
    }));

  const effectiveActiveOperatingUnitCount = eligibleOperatingUnits.length;
  const currentAccountSetupRecommended = effectiveActiveOperatingUnitCount > 1;
  const recommendationCode =
    effectiveActiveOperatingUnitCount > 1
      ? "MULTI_ACTIVE_OPERATING_UNITS"
      : effectiveActiveOperatingUnitCount === 1
        ? "SINGLE_ACTIVE_OPERATING_UNIT"
        : "NO_ACTIVE_OPERATING_UNITS";

  return {
    effectiveActiveOperatingUnitCount,
    currentAccountSetupRecommended,
    recommendationCode,
    eligibleOperatingUnits,
  };
}

export function buildDraftOperatingUnitCurrentAccountEligibilityPreview(
  legalEntities = []
) {
  const sourceRows = Array.isArray(legalEntities) ? legalEntities : [];
  return sourceRows.map((entity, index) => {
    const summary = summarizeOperatingUnitCurrentAccountEligibility(entity?.branches || []);
    return {
      index,
      legalEntityCode: normalizeDraftOperatingUnitCode(entity?.code),
      legalEntityName: normalizeDraftOperatingUnitName(entity?.name),
      ...summary,
    };
  });
}
