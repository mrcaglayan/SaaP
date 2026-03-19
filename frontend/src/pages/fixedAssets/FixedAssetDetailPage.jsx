import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetDetailPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      title={l("Fixed asset detail", "Demirbas detayi")}
      route="/app/demirbas-karti-detayi/:assetId"
      description={l(
        "Asset detail shell for overview, accounting, depreciation schedule, transactions, evidence, and audit tabs.",
        "Genel bakis, muhasebe, amortisman plani, hareketler, kanit ve denetim sekmeleri icin demirbas detay iskeleti."
      )}
      currentScope={[
        l(
          "Keep master data, lifecycle transactions, and journal traceability on one page.",
          "Master data, yasam dongusu hareketleri ve fis izlenebilirligini tek sayfada tut."
        ),
        l(
          "Show the source CARI link, owner OU, location OU, and custodian without conflating their roles.",
          "Kaynak CARI bagini, owner OU, location OU ve zimmetliyi rollerini karistirmadan goster."
        ),
        l(
          "Reserve evidence panels for asset-level, transaction-level, and depreciation-run-level attachments.",
          "Kanit panellerini varlik, hareket ve amortisman run seviyeleri icin ayir."
        ),
      ]}
      nextSteps={[
        l(
          "Load tabs from fixed-assets detail, transaction, schedule, and evidence endpoints.",
          "Sekmeleri fixed-assets detay, hareket, plan ve kanit endpointlerinden besle."
        ),
        l(
          "Add journal source-link navigation once acquisition, depreciation, transfer, and disposal postings exist.",
          "Alim, amortisman, transfer ve satis postingleri geldikten sonra journal source-link gecisini ekle."
        ),
        l(
          "Expose open decision warnings where owner OU versus source-document OU rules are still unresolved.",
          "Owner OU ile kaynak belge OU kurallari hala acik ise bunu detayda gorunen bir uyari olarak goster."
        ),
      ]}
    />
  );
}
