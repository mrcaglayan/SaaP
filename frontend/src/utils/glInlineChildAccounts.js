import { listAccounts, upsertAccount } from "../api/glAdmin.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function deriveSearchCodeCandidate(value) {
  const normalized = normalizeAccountCode(value);
  if (!normalized) {
    return "";
  }
  const compact = normalized.replace(/[^A-Z0-9.]/g, "");
  return compact.slice(0, 60);
}

function isActivePostableAccount(row) {
  const allowPosting = row?.allowPosting === true || Number(row?.allowPosting) === 1;
  const isActive = row?.isActive === true || Number(row?.isActive) === 1;
  return allowPosting && isActive;
}

function isActiveAccount(row) {
  return row?.isActive === true || Number(row?.isActive) === 1;
}

export function mapInlineAccountRows(response) {
  const rows = Array.isArray(response?.rows)
    ? response.rows
    : Array.isArray(response)
      ? response
      : [];
  return rows.map((row) => ({
    id: Number(row?.id || 0),
    coaId: Number(row?.coa_id || row?.coaId || 0) || null,
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    accountType: String(row?.account_type || row?.accountType || "").toUpperCase(),
    normalSide: String(row?.normal_side || row?.normalSide || "").toUpperCase(),
    allowPosting: Boolean(row?.allow_posting ?? row?.allowPosting),
    isActive: Boolean(row?.is_active ?? row?.isActive),
    parentAccountId:
      Number(row?.parent_account_id || row?.parentAccountId || 0) || null,
  }));
}

export function buildInlineParentAccountOptions(rows, expectedType) {
  const type = normalizeAccountCode(expectedType);
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        normalizeAccountCode(row?.accountType) === type &&
        isActiveAccount(row) &&
        toPositiveInt(row?.id)
    )
    .sort((left, right) =>
      normalizeAccountCode(left?.code).localeCompare(normalizeAccountCode(right?.code))
    );
}

export function findExactInlineCodeMatch(rows, candidateCode, expectedType) {
  const normalizedCode = normalizeAccountCode(candidateCode);
  const normalizedType = normalizeAccountCode(expectedType);
  if (!normalizedCode || !normalizedType) {
    return null;
  }
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) =>
        normalizeAccountCode(row?.code) === normalizedCode &&
        normalizeAccountCode(row?.accountType) === normalizedType &&
        isActivePostableAccount(row) &&
        toPositiveInt(row?.id)
    ) || null
  );
}

export function findBestParentAccount(candidateCode, parentAccountOptions) {
  const normalizedCandidate = normalizeAccountCode(candidateCode);
  if (!normalizedCandidate) {
    return null;
  }
  let bestParent = null;
  for (const row of Array.isArray(parentAccountOptions) ? parentAccountOptions : []) {
    const parentCode = normalizeAccountCode(row?.code);
    if (!parentCode || parentCode === normalizedCandidate) {
      continue;
    }
    if (
      normalizedCandidate.startsWith(`${parentCode}.`) ||
      normalizedCandidate.startsWith(`${parentCode}-`) ||
      normalizedCandidate.startsWith(parentCode)
    ) {
      if (
        !bestParent ||
        parentCode.length > normalizeAccountCode(bestParent?.code).length
      ) {
        bestParent = row;
      }
    }
  }
  return bestParent;
}

function parseInlineChildSequence(code, parentCode) {
  const normalizedCode = normalizeAccountCode(code);
  const normalizedParentCode = normalizeAccountCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }

  let suffix = "";
  if (normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(`${normalizedParentCode}-`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(normalizedParentCode)) {
    suffix = normalizedCode.slice(normalizedParentCode.length);
  } else {
    return null;
  }

  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const numeric = Number(suffix);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return {
    value: numeric,
    width: suffix.length,
  };
}

export function buildNextInlineChildCode(accounts, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentId) {
    return "";
  }

  const rows = Array.isArray(accounts) ? accounts : [];
  const existingCodes = new Set(
    rows.map((row) => normalizeAccountCode(row?.code)).filter(Boolean)
  );

  const parsedChildren = rows
    .filter((row) => toPositiveInt(row?.parentAccountId) === parentId)
    .map((row) => parseInlineChildSequence(row?.code, parentCode))
    .filter(Boolean);

  const maxSequence = parsedChildren.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.value || 0)),
    0
  );
  const width = Math.max(
    2,
    parsedChildren.reduce(
      (maxWidth, row) => Math.max(maxWidth, Number(row?.width || 0)),
      0
    )
  );

  let next = Math.max(1, maxSequence + 1);
  while (next <= 999999) {
    const candidate = `${parentCode}.${String(next).padStart(width, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    next += 1;
  }
  return "";
}

function defaultNormalSideForAccountType(expectedType) {
  const normalizedType = normalizeAccountCode(expectedType);
  if (normalizedType === "REVENUE" || normalizedType === "LIABILITY" || normalizedType === "EQUITY") {
    return "CREDIT";
  }
  return "DEBIT";
}

function selectDefaultParentAccount(accounts, expectedType) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const normalizedType = normalizeAccountCode(expectedType);
  const rootByType = rows.find(
    (row) =>
      !toPositiveInt(row?.parentAccountId) &&
      normalizeAccountCode(row?.accountType) === normalizedType &&
      toPositiveInt(row?.id)
  );
  if (rootByType) {
    return rootByType;
  }
  return (
    rows.find(
      (row) =>
        normalizeAccountCode(row?.accountType) === normalizedType &&
        toPositiveInt(row?.id)
    ) || null
  );
}

export async function runInlineChildAccountCreate({
  legalEntityId,
  lookupName,
  parentAccountIdValue = "",
  childCodeValue = "",
  childNameValue = "",
  accountType,
  fallbackNormalSide = "",
  l = (en) => en,
}) {
  const parsedLegalEntityId = toPositiveInt(legalEntityId);
  const normalizedLookupName = normalizeText(lookupName);
  const normalizedName = normalizeText(childNameValue) || normalizedLookupName;
  const requestedCode = normalizeAccountCode(
    childCodeValue || deriveSearchCodeCandidate(lookupName)
  );

  if (!parsedLegalEntityId) {
    throw new Error(l("Select legal entity first.", "Once tuzel kisilik secin."));
  }
  if (!normalizedName) {
    throw new Error(l("Type account name first.", "Once hesap adini yazin."));
  }

  const fullAccountResponse = await listAccounts({
    legalEntityId: parsedLegalEntityId,
    includeInactive: true,
    limit: 1000,
    offset: 0,
  });
  const fullAccountRows = mapInlineAccountRows(fullAccountResponse);

  if (requestedCode) {
    const exactExisting = findExactInlineCodeMatch(
      fullAccountRows,
      requestedCode,
      accountType
    );
    if (exactExisting) {
      return {
        mode: "existing",
        accountId: toPositiveInt(exactExisting.id),
        accountRow: exactExisting,
        accountRows: fullAccountRows,
        parentAccount: null,
        code: normalizeAccountCode(exactExisting.code),
      };
    }
  }

  const parentAccountOptions = buildInlineParentAccountOptions(
    fullAccountRows,
    accountType
  );
  const selectedParentId = toPositiveInt(parentAccountIdValue);
  let parentAccount =
    parentAccountOptions.find(
      (row) => toPositiveInt(row?.id) === selectedParentId
    ) || null;

  if (!parentAccount && requestedCode) {
    parentAccount = findBestParentAccount(requestedCode, parentAccountOptions);
  }
  if (!parentAccount) {
    parentAccount = selectDefaultParentAccount(parentAccountOptions, accountType);
  }
  if (!parentAccount) {
    throw new Error(
      l(
        `No active parent account found for ${accountType}.`,
        `${accountType} icin aktif parent hesap bulunamadi.`
      )
    );
  }

  const coaId = toPositiveInt(parentAccount?.coaId);
  if (!coaId) {
    throw new Error(
      l(
        "Unable to resolve coaId for selected parent account.",
        "Secilen parent hesap icin coaId cozulmedi."
      )
    );
  }

  let nextCode = requestedCode;
  if (!nextCode) {
    nextCode = buildNextInlineChildCode(fullAccountRows, parentAccount);
  }
  if (!nextCode) {
    throw new Error(
      l(
        "Unable to generate next child account code.",
        "Sonraki child hesap kodu uretilemedi."
      )
    );
  }

  const parentCode = normalizeAccountCode(parentAccount?.code);
  if (parentCode && nextCode === parentCode) {
    throw new Error(
      l(
        "Child account code must differ from parent account code.",
        "Child hesap kodu parent hesap kodundan farkli olmalidir."
      )
    );
  }

  const upsertResponse = await upsertAccount({
    coaId,
    code: nextCode,
    name: normalizedName,
    accountType: normalizeAccountCode(accountType),
    normalSide:
      normalizeAccountCode(parentAccount?.normalSide) ||
      normalizeAccountCode(fallbackNormalSide) ||
      defaultNormalSideForAccountType(accountType),
    allowPosting: true,
    parentAccountId: toPositiveInt(parentAccount?.id) || undefined,
  });

  const refreshedResponse = await listAccounts({
    legalEntityId: parsedLegalEntityId,
    includeInactive: true,
    limit: 1000,
    offset: 0,
  });
  const refreshedRows = mapInlineAccountRows(refreshedResponse);

  const createdRow =
    refreshedRows.find(
      (row) =>
        normalizeAccountCode(row?.code) === nextCode &&
        normalizeAccountCode(row?.accountType) === normalizeAccountCode(accountType) &&
        toPositiveInt(row?.id)
    ) || null;
  const createdAccountId =
    toPositiveInt(upsertResponse?.id) ||
    toPositiveInt(upsertResponse?.row?.id) ||
    toPositiveInt(createdRow?.id);
  if (!createdAccountId) {
    throw new Error(
      l(
        "Account create response missing id.",
        "Hesap olusturma yanitinda id yok."
      )
    );
  }

  return {
    mode: "created",
    accountId: createdAccountId,
    accountRow: createdRow,
    accountRows: refreshedRows,
    parentAccount,
    code: nextCode,
  };
}
