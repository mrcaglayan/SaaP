import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetSettingsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/ayarlar/demirbas-ayarlari"
      description={l(
        "Category and depreciation-profile settings shell aligned to FA03, without introducing a separate brand-new master-data program inside this MVP.",
        "Bu MVP icinde ayri bir yepyeni master-data programi baslatmadan FA03 ile uyumlu kategori ve amortisman profili ayar iskeleti."
      )}
      currentScope={[
        l(
          "Reserve settings sections for categories, depreciation profiles, and account defaults.",
          "Kategori, amortisman profili ve hesap varsayimlari icin ayar bolumleri ayir."
        ),
        l(
          "Keep account-mapping defaults explicit so activation does not invent accounts silently.",
          "Aktiflestirme sirasinda hesaplar sessizce uretilmesin diye hesap varsayimlarini acik tut."
        ),
        l(
          "Leave broader master-data expansion unlocked for a separate decision.",
          "Daha genis master-data genislemesini ayri bir karara birak."
        ),
      ]}
      nextSteps={[
        l(
          "Implement categories and depreciation profiles through validators plus SQL-heavy services.",
          "Kategori ve amortisman profillerini entity katmani yerine validator ve SQL agirlikli servislerle uygula."
        ),
        l(
          "Support explicit uppercase enums for profile methods and category status fields.",
          "Profil yontemleri ve kategori durum alanlari icin acik buyuk harf enumlar kullan."
        ),
        l(
          "Expose OpenAPI definitions for settings endpoints when backend routes land.",
          "Backend route'lar geldikten sonra ayar endpointleri icin OpenAPI tanimlarini ekle."
        ),
      ]}
    />
  );
}
