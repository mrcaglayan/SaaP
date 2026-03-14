export const OU_CURRENT_ACCOUNT_SETUP_PATH = "/app/ayarlar/organizasyon-yonetimi";

function formatLegalEntityLabel(row) {
  const code = String(row?.legalEntityCode || "").trim();
  const name = String(row?.legalEntityName || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || `#${Number(row?.legalEntityId || 0) || "?"}`;
}

export function formatOperatingUnitCurrentAccountBlocker(row, l) {
  const legalEntityLabel = formatLegalEntityLabel(row);
  const blockerCode = String(row?.blockerCode || "").trim().toUpperCase();
  if (blockerCode === "MISSING_CONFIG") {
    return l(
      `${legalEntityLabel}: save the Due From / Due To parent config in Organization Management.`,
      `${legalEntityLabel}: Organizasyon Yonetimi icinden Alacak / Borc parent konfigurasyonunu kaydedin.`
    );
  }
  if (blockerCode === "CONFIG_SAVED_NOT_APPLIED") {
    return l(
      `${legalEntityLabel}: saved config exists but has not been applied yet. Run Repair missing only in Organization Management.`,
      `${legalEntityLabel}: kaydedilen konfigurasyon var ama henuz uygulanmadi. Organizasyon Yonetimi icinden Sadece eksikleri onar islemini calistirin.`
    );
  }
  if (blockerCode === "MAPPING_DRIFT") {
    return l(
      `${legalEntityLabel}: saved config exists but branch mappings are still incomplete. Review drift and run Repair missing only in Organization Management.`,
      `${legalEntityLabel}: kaydedilen konfigurasyon var ancak sube eslemeleri halen eksik. Drift durumunu inceleyip Organizasyon Yonetimi icinden Sadece eksikleri onar islemini calistirin.`
    );
  }
  if (blockerCode === "NOT_APPLICABLE") {
    return l(
      `${legalEntityLabel}: current-account setup is not required because this legal entity has zero or one active branch in scope.`,
      `${legalEntityLabel}: bu legal entity kapsaminda sifir veya tek aktif sube oldugu icin cari hesap kurulumu gerekli degil.`
    );
  }
  return l(
    `${legalEntityLabel}: review current-account readiness in Organization Management.`,
    `${legalEntityLabel}: cari hesap hazirligini Organizasyon Yonetimi icinden kontrol edin.`
  );
}
