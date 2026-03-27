import {
  FIXED_ASSET_SETTINGS_PATH,
  formatFixedAssetCategorySetupRequirementLabel,
} from "../cariDocumentsPageHelpers.js";

export default function FixedAssetCategorySetupModal({
  open,
  l,
  categoryLabel,
  missingRequirements,
  canReadSettings,
  canUpsertSettings,
  onClose,
}) {
  if (!open) {
    return null;
  }
  const missingRequirementLabels = (Array.isArray(missingRequirements)
    ? missingRequirements
    : []
  ).map((requirementKey) =>
    formatFixedAssetCategorySetupRequirementLabel(requirementKey, l)
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {l("Asset Setup Required", "Varlik Kurulumu Gerekli")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                `"${categoryLabel}" cannot be used for fixed asset creation until its required defaults are configured.`,
                `"${categoryLabel}" kategorisi gerekli varsayilanlar tanimlanmadan duran varlik olusturma icin kullanilamaz.`
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            onClick={onClose}
          >
            {l("Close", "Kapat")}
          </button>
        </div>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          {missingRequirementLabels.length > 0 ? (
            <>
              <p className="font-semibold">
                {l("Missing setup", "Eksik kurulum")}
              </p>
              <ul className="mt-2 list-disc pl-5">
                {missingRequirementLabels.map((label) => (
                  <li key={`fa-category-setup-${label}`}>{label}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p>
            {l(
              "Open Fixed Asset Settings, configure the category, then come back and select it again.",
              "Demirbas Ayarlari sayfasini acin, kategoriyi yapilandirin ve sonra geri gelip yeniden secin."
            )}
          </p>
          {canReadSettings ? (
            !canUpsertSettings ? (
              <p className="mt-2 text-xs text-amber-800">
                {l(
                  "You can open the settings page, but you need fixed_assets.settings.upsert to update the category.",
                  "Ayarlar sayfasini acabilirsiniz ancak kategoriyi guncellemek icin fixed_assets.settings.upsert gerekir."
                )}
              </p>
            ) : null
          ) : (
            <p className="mt-2 text-xs text-amber-800">
              {l(
                "Missing permission: fixed_assets.settings.read",
                "Eksik yetki: fixed_assets.settings.read"
              )}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={onClose}
          >
            {l("Cancel", "Iptal")}
          </button>
          {canReadSettings ? (
            <a
              href={FIXED_ASSET_SETTINGS_PATH}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={onClose}
            >
              {l("Open Fixed Asset Settings", "Demirbas Ayarlarini Ac")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
