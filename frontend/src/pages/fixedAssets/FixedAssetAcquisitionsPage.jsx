import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetAcquisitionsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-alim-islemleri"
      description={l(
        "Acquisition and capitalization work queue aligned to FA05 and FA06, covering both manual activation and CARI-linked capitalization.",
        "FA05 ve FA06 ile uyumlu alim ve kapitalizasyon is kuyrugu; hem manuel aktiflestirme hem de CARI bagli kapitalizasyonu kapsar."
      )}
      currentScope={[
        l(
          "Separate manual acquisition from source-linked capitalization, but keep them visible in one operational queue.",
          "Manuel alim ile kaynak bagli kapitalizasyonu ayir, ancak ikisini de tek operasyon kuyrugunda gorunur tut."
        ),
        l(
          "Prepare asset creation from eligible AP CARI lines with category defaults and source traceability.",
          "Uygun AP CARI satirlarindan kategori varsayimlari ve kaynak izlenebilirligi ile varlik olusturmaya hazirlan."
        ),
        l(
          "Keep posting actions period-aware and explicit instead of silently capitalizing on save.",
          "Kaydet aninda sessiz kapitalizasyon yapmak yerine posting aksiyonlarini donem farkindalikli ve acik tut."
        ),
      ]}
      nextSteps={[
        l(
          "Implement CARI line eligibility checks, one-line-to-one-asset constraints, and POSTED-document activation rules.",
          "CARI satiri uygunluk kontrolleri, bir-satir-bir-varlik kisiti ve POSTED belge aktiflestirme kurallarini uygula."
        ),
        l(
          "Load candidate AP lines from repo-native CARI services rather than a new AP module.",
          "Aday AP satirlarini yeni bir AP modulunden degil repo-uyumlu CARI servislerinden yukle."
        ),
        l(
          "Carry txn/base amounts into the asset master and the acquisition transaction row.",
          "Islem/baz tutarlari hem asset master hem de acquisition transaction satirina tasi."
        ),
      ]}
      decisionItems={[
        l(
          "CARI capitalization follows option A: the AP line posts directly to the fixed-asset account.",
          "CARI kapitalizasyonunda A secenegi kilitli: AP satiri dogrudan demirbas hesabina gider."
        ),
        l(
          "Source-document reversal handling stays open and must not be hidden inside the first implementation.",
          "Kaynak belge ters kayit davranisi acik kaliyor ve ilk implementasyon icinde gizlenmemeli."
        ),
      ]}
    />
  );
}
