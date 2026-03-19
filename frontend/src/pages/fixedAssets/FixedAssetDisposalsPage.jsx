import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetDisposalsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-satis-islemleri"
      description={l(
        "Disposal, sale, and write-off queue aligned to FA11, with explicit NBV, gain/loss, and schedule-cutoff behavior.",
        "FA11 ile uyumlu satis, elden cikarma ve hurda kuyrugu; acik NBV, kar/zarar ve plan-kesme davranisini hedefler."
      )}
      currentScope={[
        l(
          "Keep disposal separate from physical move and ownership transfer.",
          "Satis/elden cikarmayi fiziksel hareket ve ownership transfer akisindan ayir."
        ),
        l(
          "Prepare queue columns for disposal date, proceeds, NBV, gain/loss, and journal traceability.",
          "Kuyruk kolonlarini disposal tarihi, tahsilat, NBV, kar/zarar ve fis izlenebilirligi icin hazirla."
        ),
        l(
          "Show period-open and posting prerequisites before allowing the disposal action.",
          "Disposal aksiyonundan once donem-acik ve posting on kosullarini goster."
        ),
      ]}
      nextSteps={[
        l(
          "Implement disposal and write-off endpoints with owner-OU posting validation.",
          "Owner-OU posting kontrolu ile disposal ve write-off endpointlerini uygula."
        ),
        l(
          "Stop future depreciation schedule lines after disposal posting.",
          "Disposal posting sonrasinda gelecek amortisman plan satirlarini durdur."
        ),
        l(
          "Surface reversal policy only after the source and disposal accounting rules are locked.",
          "Ters kayit politikasini ancak kaynak ve disposal muhasebe kurallari kilitlendikten sonra ac."
        ),
      ]}
      decisionItems={[
        l(
          "Every posting action must enforce book, fiscal-period-open, and posting-date legality checks.",
          "Tum posting aksiyonlari defter, mali donem-acik ve posting tarihi uygunluk kontrollerini uygulamali."
        ),
      ]}
    />
  );
}
