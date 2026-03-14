function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatAccountOptionLabel(account) {
  const breadcrumb = String(account?.account_breadcrumb || "").trim();
  if (breadcrumb) {
    return breadcrumb;
  }
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || "-";
}

function buildAccountSearchText(account) {
  return normalizeUpperText(
    [
      account?.account_breadcrumb,
      account?.code,
      account?.name,
      account?.operating_unit_code,
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function hasCodeToken(text, code) {
  const normalizedText = normalizeUpperText(text);
  const normalizedCode = normalizeUpperText(code);
  if (!normalizedText || !normalizedCode) {
    return false;
  }
  const matcher = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(normalizedCode)}([^A-Z0-9]|$)`);
  return matcher.test(normalizedText);
}

function buildManualMatchMetadata(account, { sourceOperatingUnitCode, partnerOperatingUnitCode }) {
  const sourceCode = normalizeUpperText(sourceOperatingUnitCode);
  const partnerCode = normalizeUpperText(partnerOperatingUnitCode);
  const searchText = buildAccountSearchText(account);
  const sourceMatch = hasCodeToken(searchText, sourceCode);
  const partnerMatch = hasCodeToken(searchText, partnerCode);

  if (sourceCode && partnerCode && sourceMatch && partnerMatch) {
    return {
      manualMatchKind: "EXACT",
      manualMatchReason: "PAIR",
      manualSortRank: 0,
    };
  }
  if (sourceCode && sourceMatch) {
    return {
      manualMatchKind: "EXACT",
      manualMatchReason: "SOURCE",
      manualSortRank: 0,
    };
  }
  return {
    manualMatchKind: "FALLBACK",
    manualMatchReason: "ENTITY",
    manualSortRank: 1,
  };
}

export function buildRankedOperatingUnitCurrentAccountOptions(
  accounts = [],
  { sourceOperatingUnitCode = "", partnerOperatingUnitCode = "" } = {}
) {
  const sourceRows = Array.isArray(accounts) ? accounts : [];
  return sourceRows
    .map((account) => ({
      ...account,
      ...buildManualMatchMetadata(account, {
        sourceOperatingUnitCode,
        partnerOperatingUnitCode,
      }),
    }))
    .sort((left, right) => {
      if (left.manualSortRank !== right.manualSortRank) {
        return left.manualSortRank - right.manualSortRank;
      }
      return formatAccountOptionLabel(left).localeCompare(formatAccountOptionLabel(right));
    });
}

export function formatRankedOperatingUnitCurrentAccountOptionLabel(account, l) {
  const baseLabel = formatAccountOptionLabel(account);
  const reason = normalizeUpperText(account?.manualMatchReason);
  const kind = normalizeUpperText(account?.manualMatchKind);
  if (kind === "EXACT" && reason === "PAIR") {
    return `${baseLabel} (${l("Exact branch-pair match", "Tam sube-cifti eslesmesi")})`;
  }
  if (kind === "EXACT") {
    return `${baseLabel} (${l("Exact branch match", "Tam sube eslesmesi")})`;
  }
  return `${baseLabel} (${l("Fallback same-entity account", "Ayni entity icin yedek hesap")})`;
}

function isEligibleOperatingUnit(row) {
  return (
    normalizeUpperText(row?.status || "ACTIVE") === "ACTIVE" &&
    Boolean(String(row?.code || "").trim()) &&
    Boolean(String(row?.name || "").trim())
  );
}

export function summarizeOperatingUnitCurrentAccountConfigDrift(
  configRow,
  operatingUnits = [],
  partnerRows = []
) {
  const legalEntityId = toNumber(configRow?.legal_entity_id);
  const configured =
    toNumber(configRow?.due_from_parent_account_id) > 0 &&
    toNumber(configRow?.due_to_parent_account_id) > 0;
  const configUpdatedAt = configRow?.updated_at ? new Date(configRow.updated_at) : null;
  const lastAppliedAt = configRow?.last_applied_at ? new Date(configRow.last_applied_at) : null;
  const configChangedSinceLastApply =
    configured &&
    (!lastAppliedAt ||
      Number.isNaN(lastAppliedAt.getTime()) ||
      (configUpdatedAt && !Number.isNaN(configUpdatedAt.getTime()) && configUpdatedAt > lastAppliedAt));

  const legalEntityOperatingUnits = (Array.isArray(operatingUnits) ? operatingUnits : []).filter(
    (row) => toNumber(row?.legal_entity_id) === legalEntityId
  );
  const activeOperatingUnits = legalEntityOperatingUnits.filter((row) => isEligibleOperatingUnit(row));
  const activeOperatingUnitIds = new Set(
    activeOperatingUnits.map((row) => toNumber(row?.id)).filter(Boolean)
  );
  const missingCentralMappingOperatingUnitCount = activeOperatingUnits.filter(
    (row) => !row?.cross_context_self_balancing_ready
  ).length;

  const directionalMappingKeys = new Set();
  for (const row of Array.isArray(partnerRows) ? partnerRows : []) {
    if (toNumber(row?.legal_entity_id) !== legalEntityId) {
      continue;
    }
    const operatingUnitId = toNumber(row?.operating_unit_id);
    const partnerOperatingUnitId = toNumber(row?.partner_operating_unit_id);
    if (!activeOperatingUnitIds.has(operatingUnitId) || !activeOperatingUnitIds.has(partnerOperatingUnitId)) {
      continue;
    }
    if (!toNumber(row?.due_from_account_id) || !toNumber(row?.due_to_account_id)) {
      continue;
    }
    directionalMappingKeys.add(`${operatingUnitId}:${partnerOperatingUnitId}`);
  }

  const effectiveActiveOperatingUnitCount = activeOperatingUnits.length;
  const currentAccountSetupExpected = effectiveActiveOperatingUnitCount > 1;
  const expectedPartnerDirectionCount = currentAccountSetupExpected
    ? effectiveActiveOperatingUnitCount * (effectiveActiveOperatingUnitCount - 1)
    : 0;
  const readyPartnerDirectionCount = directionalMappingKeys.size;
  const missingPartnerDirectionCount = Math.max(
    expectedPartnerDirectionCount - readyPartnerDirectionCount,
    0
  );
  const legalEntityStillNotReady =
    configured &&
    currentAccountSetupExpected &&
    (missingCentralMappingOperatingUnitCount > 0 || missingPartnerDirectionCount > 0);
  const hasDrift = legalEntityStillNotReady || configChangedSinceLastApply;

  return {
    configured,
    configChangedSinceLastApply,
    effectiveActiveOperatingUnitCount,
    currentAccountSetupExpected,
    missingCentralMappingOperatingUnitCount,
    expectedPartnerDirectionCount,
    readyPartnerDirectionCount,
    missingPartnerDirectionCount,
    legalEntityStillNotReady,
    hasDrift,
  };
}
