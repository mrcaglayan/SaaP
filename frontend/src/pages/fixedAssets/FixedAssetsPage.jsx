import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-karti-listesi"
      description={l(
        "Asset register and detail entry point aligned to FA04. This route separates the register from create, depreciation, disposal, and settings work queues.",
        "FA04 ile uyumlu demirbas register ve detay giris noktasi. Bu rota register yuzeyini olusturma, amortisman, satis ve ayarlar is kuyruklarindan ayirir."
      )}
      currentScope={[
        l(
          "Keep owner operating unit, location operating unit, and custodian visible as separate concepts in the register.",
          "Register icinde sahibi olan operasyon birimi, lokasyon operasyon birimi ve zimmetli kisiyi ayri kavramlar olarak goster."
        ),
        l(
          "Reserve filters for legal entity, owner OU, location OU, category, status, date ranges, and custodian.",
          "Legal entity, owner OU, location OU, kategori, durum, tarih araliklari ve zimmetli filtrelerini ayir."
        ),
        l(
          "Prepare list/detail wiring for evidence, transactions, depreciation schedule, and audit visibility.",
          "Kanit, hareketler, amortisman plani ve denetim gorunumleri icin liste/detay baglantisini hazirla."
        ),
      ]}
      nextSteps={[
        l(
          "Bind the register to GET /api/v1/fixed-assets with saved-view style filters.",
          "Register yuzeyini kaydedilmis gorunum benzeri filtrelerle GET /api/v1/fixed-assets endpointine bagla."
        ),
        l(
          "Add detail navigation and API-backed totals for original cost, accumulated depreciation, and NBV.",
          "Orijinal maliyet, birikmis amortisman ve NBV toplamlarini API destekli hale getirip detay gecisini ekle."
        ),
        l(
          "Expose transaction-level and run-level evidence once FA12 backend support lands.",
          "FA12 backend destegi geldikten sonra hareket ve run seviyesinde kanit gorunumlerini ac."
        ),
      ]}
      decisionItems={[
        l(
          "Status values stay repo-native uppercase across DB and API.",
          "Durum degerleri DB ve API boyunca repo-stili buyuk harf kalacak."
        ),
        l(
          "Foreign-currency capable assets store transaction and base amounts side by side.",
          "Yabanci para destekli demirbaslar islem ve baz tutarlari yan yana saklayacak."
        ),
      ]}
    />
  );
}
