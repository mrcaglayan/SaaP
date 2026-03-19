import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetReportsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-raporu"
      description={l(
        "Reporting shell aligned to FA13 for register, rollforward, additions, disposals, transfers, and depreciation views.",
        "FA13 ile uyumlu raporlama iskeleti; register, rollforward, alimlar, satislar, transferler ve amortisman gorunumlerini hedefler."
      )}
      currentScope={[
        l(
          "Keep owner OU, location OU, and custodian reporting separated in both filters and totals.",
          "Owner OU, location OU ve zimmetli raporlamasini hem filtrede hem toplamda ayri tut."
        ),
        l(
          "Reserve export-ready views for register, depreciation schedule, additions, disposals, and transfers.",
          "Register, amortisman plani, alim, satis ve transfer gorunumleri icin export hazir yuzeyler ayir."
        ),
        l(
          "Prepare rollforward reporting to reconcile opening, additions, depreciation, transfers, and disposals.",
          "Acilis, ilaveler, amortisman, transfer ve satis hareketlerini baglayacak rollforward raporuna hazirlan."
        ),
      ]}
      nextSteps={[
        l(
          "Bind report filters to fixed-assets reporting SQL rather than repurposing inventory reports.",
          "Rapor filtrelerini inventory raporlarini yeniden kullanmak yerine fixed-assets reporting SQL katmanina bagla."
        ),
        l(
          "Expose txn/base amounts where foreign-currency acquisition exists.",
          "Yabanci para kaynakli alim varsa islem ve baz tutarlari raporla."
        ),
        l(
          "Add cross-links back to asset detail, transactions, and depreciation runs.",
          "Rapor satirlarindan asset detay, hareket ve amortisman run ekranlarina geri baglantilar ekle."
        ),
      ]}
    />
  );
}
