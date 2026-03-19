import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetCustodiansPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/ayarlar/demirbas-zimmetlileri"
      description={l(
        "Interim custodian setup shell aligned to FA02 for assignment and reporting, while leaving a future HR-grade master-data path open.",
        "Gorevlendirme ve raporlama icin FA02 ile uyumlu gecici zimmetli kurulum iskeleti; gelecekte IK seviyesinde master-data yolunu da acik birakir."
      )}
      currentScope={[
        l(
          "Keep custodian responsibility separate from accounting ownership.",
          "Zimmetli sorumlulugunu muhasebe sahipliginden ayri tut."
        ),
        l(
          "Prepare lightweight fields for employee code, display name, OU, status, and notes.",
          "Employee code, display name, OU, durum ve not alanlari icin hafif bir sema hazirla."
        ),
        l(
          "Support reuse in asset forms, detail pages, and reports without coupling to payroll employee ownership.",
          "Bordro employee ownership katmanina baglanmadan asset formu, detay ve raporlarda yeniden kullan."
        ),
      ]}
      nextSteps={[
        l(
          "Implement custodian CRUD via fixed-assets validators and service SQL.",
          "Zimmetli CRUD akisini fixed-assets validator ve servis SQL katmani uzerinden uygula."
        ),
        l(
          "Wire asset forms and reports to this surface before any HR integration work starts.",
          "Herhangi bir IK entegrasyonu baslamadan once asset formlari ve raporlari bu yuzeye bagla."
        ),
        l(
          "Add custodian read/write permissions to sidebar gating and action controls.",
          "Sidebar yetkilendirmesi ve aksiyon kontrollerine zimmetli okuma/yazma yetkilerini ekle."
        ),
      ]}
    />
  );
}
