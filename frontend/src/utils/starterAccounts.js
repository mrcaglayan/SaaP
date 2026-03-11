import { getPolicyPack as getStarterPolicyPack } from "../../../backend/src/services/policy-packs.service.js";

const DEFAULT_POLICY_PACK_ID_BY_COUNTRY = Object.freeze({
  TR: "TR_UNIFORM_V1",
  AF: "AF_STARTER_V1",
  US: "US_GAAP_STARTER_V1",
});

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function cloneStarterRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    code: toUpper(row?.code),
    ...(toUpper(row?.parentCode ?? row?.parent_code)
      ? { parentCode: toUpper(row?.parentCode ?? row?.parent_code) }
      : {}),
    name: String(row?.name || "").trim(),
    accountType: toUpper(row?.accountType ?? row?.account_type),
    normalSide: toUpper(row?.normalSide ?? row?.normal_side),
    allowPosting: row?.allowPosting === undefined ? true : Boolean(row.allowPosting),
  }));
}

export function getDefaultPolicyPackIdForCountry(countryIso2) {
  const normalizedCountryIso2 = toUpper(countryIso2);
  return DEFAULT_POLICY_PACK_ID_BY_COUNTRY[normalizedCountryIso2] || "";
}

export function getPolicyPackStarterAccounts(packId) {
  const pack = getStarterPolicyPack(packId);
  return cloneStarterRows(pack?.starterAccountTree || []);
}

export function getCountryStarterAccountRows(countryIso2, fallbackRows = []) {
  const packId = getDefaultPolicyPackIdForCountry(countryIso2);
  if (packId) {
    const starterRows = getPolicyPackStarterAccounts(packId);
    if (starterRows.length > 0) {
      return starterRows;
    }
  }
  return cloneStarterRows(fallbackRows);
}
