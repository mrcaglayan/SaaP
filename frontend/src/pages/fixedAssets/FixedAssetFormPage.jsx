import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetFormPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-karti-olustur"
      description={l(
        "Manual create, edit, and activation surface aligned to FA05. Draft capture stays separate from posting and depreciation actions.",
        "FA05 ile uyumlu manuel olusturma, duzenleme ve aktiflestirme yuzeyi. Taslak kayit, muhasebelestirme ve amortisman aksiyonlarindan ayri kalir."
      )}
      currentScope={[
        l(
          "Collect category defaults, owner/location OU, depreciation profile, and txn/base acquisition amounts.",
          "Kategori varsayimlari, owner/location OU, amortisman profili ve islem/baz alim tutarlarini topla."
        ),
        l(
          "Allow draft save before activation so accounting validation and posting stay explicit.",
          "Muhasebe dogrulama ve posting acik kalsin diye aktiflestirme oncesi taslak kayda izin ver."
        ),
        l(
          "Reserve room for source-linked capitalization metadata without forcing a separate master-data redesign.",
          "Ayrica bir master-data yeniden tasarimi zorunlu kilmadan kaynak bagli kapitalizasyon metadatasi icin alan ayir."
        ),
      ]}
      nextSteps={[
        l(
          "Wire form validation to fixed-assets validators instead of embedding business rules in components.",
          "Is kurallarini component icine gommek yerine form dogrulamasini fixed-assets validator katmanina bagla."
        ),
        l(
          "Add controlled activate flow with period-open checks and schedule generation.",
          "Donem-acik kontrolu ve plan uretimi ile kontrollu aktiflestirme akisina gec."
        ),
        l(
          "Support category-account defaulting with explicit override permissions.",
          "Kategori-hesap varsayimlarini acik override yetkileri ile destekle."
        ),
      ]}
      decisionItems={[
        l(
          "Activation from a CARI source should require the source document to be POSTED.",
          "CARI kaynakli aktiflestirme icin kaynak belgenin POSTED olmasi gerekmeli."
        ),
        l(
          "Brand-new master-data modules stay outside this MVP until separately approved.",
          "Yepyeni master-data modulleri ayri onay gelene kadar bu MVP disinda kalacak."
        ),
      ]}
    />
  );
}
