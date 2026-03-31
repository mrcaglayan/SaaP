function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }
  if (value && typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = stableSortValue(value[key]);
    }
    return normalized;
  }
  return value;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHashHex(value) {
  const states = [
    0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f,
    0x165667b1, 0xd3a2646c,
  ];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      const next =
        (((states[stateIndex] << 5) + states[stateIndex]) ^
          (codePoint + stateIndex)) >>>
        0;
      states[stateIndex] = next;
    }
  }
  return states
    .map((valuePart) => valuePart.toString(16).padStart(8, "0"))
    .join("");
}

async function sha256Hex(value) {
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(value ?? "")),
    );
    return toHex(digest);
  }
  return fallbackHashHex(String(value ?? ""));
}

/**
 * Serialize report payloads with recursively sorted object keys so audit
 * fingerprints stay stable across harmless key-order differences.
 */
export function stableReportStringify(value) {
  return JSON.stringify(stableSortValue(value));
}

/**
 * Build the additive RP13 fingerprint basis for one loaded report instance.
 */
export function buildReportFingerprintBasis({
  reportKey,
  routePath,
  parameters = {},
  context = {},
  reportSnapshot = {},
} = {}) {
  return {
    reportKey: String(reportKey || "").trim(),
    routePath: String(routePath || "").trim(),
    parameters: stableSortValue(parameters),
    context: stableSortValue(context),
    reportSnapshot: stableSortValue(reportSnapshot),
  };
}

/**
 * Create one stable frontend report fingerprint plus the normalized JSON basis
 * used to derive it. The browser uses SHA-256 when Web Crypto is available.
 */
export async function createReportFingerprint(input = {}) {
  const basis = buildReportFingerprintBasis(input);
  const basisJson = stableReportStringify(basis);
  const fingerprintSha256 = await sha256Hex(basisJson);
  return {
    basis,
    basisJson,
    fingerprintSha256,
  };
}
