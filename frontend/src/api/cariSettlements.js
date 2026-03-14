import { api } from "./client.js";
import { parseCariApiError } from "./cariCommon.js";

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function buildOperatingUnitContextLabel({
  operatingUnitId,
  operatingUnitCode = null,
  operatingUnitName = null,
  translate = (en) => en,
}) {
  const resolvedOperatingUnitId = toPositiveInt(operatingUnitId);
  if (!resolvedOperatingUnitId) {
    return translate("Central", "Merkez");
  }

  const code = normalizeText(operatingUnitCode);
  const name = normalizeText(operatingUnitName);
  return [code ? `OU: ${code}` : `OU: ${resolvedOperatingUnitId}`, name]
    .filter(Boolean)
    .join(" - ");
}

export function describeCariSettlementContext(
  row,
  { translate = (en) => en } = {}
) {
  const ownerOperatingUnitId = toPositiveInt(
    row?.ownerOperatingUnitId ?? row?.owner_operating_unit_id
  );
  const collectorOperatingUnitId = toPositiveInt(
    row?.collectorOperatingUnitId ?? row?.collector_operating_unit_id
  );
  const ownerOperatingUnitCode = normalizeText(
    row?.ownerOperatingUnitCode ?? row?.owner_operating_unit_code
  ) || null;
  const ownerOperatingUnitName = normalizeText(
    row?.ownerOperatingUnitName ?? row?.owner_operating_unit_name
  ) || null;
  const collectorOperatingUnitCode = normalizeText(
    row?.collectorOperatingUnitCode ?? row?.collector_operating_unit_code
  ) || null;
  const collectorOperatingUnitName = normalizeText(
    row?.collectorOperatingUnitName ?? row?.collector_operating_unit_name
  ) || null;
  const originatingCrossContextSettlementBatchId = toPositiveInt(
    row?.originatingCrossContextSettlementBatchId ??
      row?.originating_cross_context_settlement_batch_id
  );
  const isCrossContext =
    ownerOperatingUnitId !== collectorOperatingUnitId;

  return {
    ownerOperatingUnitId,
    ownerOperatingUnitCode,
    ownerOperatingUnitName,
    ownerContextLabel:
      normalizeText(row?.ownerContextLabel ?? row?.owner_context_label) ||
      buildOperatingUnitContextLabel({
        operatingUnitId: ownerOperatingUnitId,
        operatingUnitCode: ownerOperatingUnitCode,
        operatingUnitName: ownerOperatingUnitName,
        translate,
      }),
    collectorOperatingUnitId,
    collectorOperatingUnitCode,
    collectorOperatingUnitName,
    collectorContextLabel:
      normalizeText(row?.collectorContextLabel ?? row?.collector_context_label) ||
      buildOperatingUnitContextLabel({
        operatingUnitId: collectorOperatingUnitId,
        operatingUnitCode: collectorOperatingUnitCode,
        operatingUnitName: collectorOperatingUnitName,
        translate,
      }),
    originatingCrossContextSettlementBatchId,
    isCrossContext:
      row?.isCrossContext === true ||
      row?.is_cross_context === true ||
      row?.isCrossContext === 1 ||
      row?.is_cross_context === 1 ||
      isCrossContext,
  };
}

export function getCariSettlementErrorHint(errorLike, { translate = (en) => en } = {}) {
  const message = normalizeLowerText(
    errorLike?.message || errorLike?.response?.data?.message || errorLike
  );
  if (!message) {
    return "";
  }
  if (message.includes("multiple owner operating units")) {
    return translate(
      "Selected items span multiple owner contexts. Split the settlement by owner OU.",
      "Secili kalemler birden fazla owner baglami iceriyor. Mahsuplastirmayi owner OU bazinda bolun."
    );
  }
  if (
    message.includes("is limited to specific operating units") ||
    message.includes("is not assigned to counterparty")
  ) {
    return translate(
      "Open the counterparty card and check Primary Operating Unit and Allowed Operating Units. The settlement owner branch must be assigned on that card.",
      "Cari kartini acip Primary Operating Unit ve Allowed Operating Units alanlarini kontrol edin. Mahsuplastirmanin owner branch'i bu kartta tanimli olmalidir."
    );
  }
  if (
    message.includes("configure all four central <-> ou current-account fields") ||
    message.includes("central/ou self-balancing setup is invalid")
  ) {
    return translate(
      "Complete the central <-> OU current-account setup in Organization Management before retrying.",
      "Tekrar denemeden once Organization Management altinda merkez <-> OU cari hesap kurulumunu tamamlayin."
    );
  }
  if (
    message.includes("configure both directional partner current-account mappings") ||
    message.includes("required partner-specific current-account mappings are missing") ||
    message.includes("direct inter-branch current-account setup is invalid")
  ) {
    return translate(
      "Complete both directional partner-OU current-account mappings before retrying.",
      "Tekrar denemeden once iki yonlu partner OU cari hesap eslemelerini tamamlayin."
    );
  }
  if (message.includes("reverse downstream internal settlement first")) {
    return translate(
      "Reverse the downstream internal settlement first, then retry the original collection or cash reversal.",
      "Once downstream ic mahsuplastirmayi tersleyin, sonra orijinal tahsilat veya kasa ters kaydini tekrar deneyin."
    );
  }
  return "";
}

export async function applyCariSettlement(payload) {
  return run(() => api.post("/api/v1/cari/settlements/apply", payload));
}

export async function reverseCariSettlement(settlementBatchId, payload = {}) {
  return run(() =>
    api.post(`/api/v1/cari/settlements/${settlementBatchId}/reverse`, payload)
  );
}

export async function attachCariBankReference(payload) {
  return run(() => api.post("/api/v1/cari/bank/attach", payload));
}

export async function applyCariBankSettlement(payload) {
  return run(() => api.post("/api/v1/cari/bank/apply", payload));
}
