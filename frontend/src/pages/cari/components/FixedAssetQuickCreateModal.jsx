import Combobox from "../../../components/Combobox.jsx";
import {
  buildFixedAssetCategorySetupIssue,
  createInitialQuickCreateFixedAssetForm,
  FIXED_ASSET_SETTINGS_PATH,
  formatFixedAssetCategorySetupRequirementList,
  normalizeCurrencyCode,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

export default function FixedAssetQuickCreateModal({
  open,
  l,
  form,
  saving,
  error,
  legalEntityId,
  acquisitionDate,
  currencyCode,
  categoryOptions,
  operatingUnitOptions,
  categoriesById,
  canReadSettings,
  canUpsertSettings,
  onChange,
  onClose,
  onSave,
}) {
  if (!open) {
    return null;
  }
  const normalizedForm = createInitialQuickCreateFixedAssetForm();
  const activeForm = {
    ...normalizedForm,
    ...(form || {}),
  };
  const selectedCategory = categoriesById.get(toPositiveInt(activeForm.categoryId)) || null;
  const selectedCategorySetupIssue = selectedCategory
    ? buildFixedAssetCategorySetupIssue(selectedCategory)
    : null;
  const setupRequirementList = selectedCategorySetupIssue
    ? formatFixedAssetCategorySetupRequirementList(
        selectedCategorySetupIssue.missingRequirements,
        l
      )
    : "";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {l("Create Draft Asset", "Taslak Varlik Olustur")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Create a lightweight draft asset and link it back to this CARI line.",
                "Hafif bir taslak varlik olusturun ve bu CARI satirina geri baglayin."
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {l("Close", "Kapat")}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Legal Entity", "Tuzel Kisilik")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {legalEntityId || "-"}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Acquisition Date", "Edinim Tarihi")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {acquisitionDate || "-"}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Currency", "Para Birimi")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {normalizeCurrencyCode(currencyCode) || "-"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("Asset Name", "Varlik Adi")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={activeForm.name}
              onChange={(event) => onChange({ name: event.target.value })}
              disabled={saving}
            />
          </label>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Category", "Kategori")}
              <Combobox
                className="mt-1"
                value={activeForm.categoryId}
                options={categoryOptions}
                disabled={saving}
                placeholder={l("Search category", "Kategori ara")}
                noOptionsText={l("No categories found.", "Kategori bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({ categoryId: nextValue ? String(nextValue) : "" })
                }
              />
            </label>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Owner OU", "Sahip OB")}
              <Combobox
                className="mt-1"
                value={activeForm.ownerOperatingUnitId}
                options={operatingUnitOptions}
                disabled={saving}
                placeholder={l("Search operating unit", "Operasyon birimi ara")}
                noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({
                    ownerOperatingUnitId: nextValue ? String(nextValue) : "",
                  })
                }
              />
            </label>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Location OU", "Konum OB")}
              <Combobox
                className="mt-1"
                value={activeForm.locationOperatingUnitId}
                options={operatingUnitOptions}
                disabled={saving}
                placeholder={l("Search operating unit", "Operasyon birimi ara")}
                noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({
                    locationOperatingUnitId: nextValue ? String(nextValue) : "",
                  })
                }
              />
            </label>
          </div>
        </div>

        {selectedCategory && !selectedCategorySetupIssue ? (
          <p className="mt-3 text-xs text-slate-500">
            {l(
              `Category defaults will be applied automatically: useful life ${
                selectedCategory.defaultUsefulLifeMonths || "-"
              } months, profile #${
                selectedCategory.defaultDepreciationProfileId || "-"
              }, salvage rule ${selectedCategory.defaultSalvageRuleType || "NONE"}.`,
              `Kategori varsayilanlari otomatik uygulanir: faydali omur ${
                selectedCategory.defaultUsefulLifeMonths || "-"
              } ay, profil #${
                selectedCategory.defaultDepreciationProfileId || "-"
              }, hurda kurali ${selectedCategory.defaultSalvageRuleType || "NONE"}.`
            )}
          </p>
        ) : null}
        {selectedCategorySetupIssue ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              {l(
                "This category is not ready for draft asset creation.",
                "Bu kategori taslak varlik olusturma icin hazir degil."
              )}
            </p>
            <p className="mt-1">
              {l(
                `Missing setup: ${setupRequirementList}.`,
                `Eksik kurulum: ${setupRequirementList}.`
              )}
            </p>
            {canReadSettings ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <a
                  href={FIXED_ASSET_SETTINGS_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline underline-offset-2"
                >
                  {l("Open Fixed Asset Settings", "Demirbas Ayarlarini Ac")}
                </a>
                {!canUpsertSettings ? (
                  <span className="text-amber-800">
                    {l(
                      "You can open the page, but you need fixed_assets.settings.upsert to update the category.",
                      "Sayfayi acabilirsiniz ancak kategoriyi guncellemek icin fixed_assets.settings.upsert gerekir."
                    )}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-800">
                {l(
                  "Missing permission: fixed_assets.settings.read",
                  "Eksik yetki: fixed_assets.settings.read"
                )}
              </p>
            )}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {l("Cancel", "Iptal")}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={onSave}
            disabled={saving || Boolean(selectedCategorySetupIssue)}
          >
            {saving
              ? l("Creating draft asset...", "Taslak varlik olusturuluyor...")
              : l("Create + Select", "Olustur + Sec")}
          </button>
        </div>
      </div>
    </div>
  );
}
