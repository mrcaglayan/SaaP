import { useI18n } from "../../i18n/useI18n.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

export default function FixedAssetDepreciationRunsPage() {
  const { l } = useI18n();

  return (
    <FixedAssetModulePage
      route="/app/demirbas-amortisman-islemleri"
      description={l(
        "Depreciation run preview, post, and reverse surface aligned to FA07 and FA08.",
        "FA07 ve FA08 ile uyumlu amortisman run onizleme, post ve reverse yuzeyi."
      )}
      currentScope={[
        l(
          "Keep schedule generation separate from run execution, but make both visible from the same route family.",
          "Plan uretimini run calistirmadan ayir, ancak ikisini ayni rota ailesi icinde gorunur tut."
        ),
        l(
          "Reserve run detail space for skipped assets, per-run errors, totals, and posted journals.",
          "Run detayi icinde atlanan varliklar, run-hatalari, toplamlar ve olusan fisler icin alan ayir."
        ),
        l(
          "Prepare transaction-level traceability so one asset and one period cannot be posted twice.",
          "Bir varlik ve bir donem icin cift posting olmasin diye hareket seviyesinde izlenebilirlik hazirla."
        ),
      ]}
      nextSteps={[
        l(
          "Back the UI with run, run-line, schedule, preview, post, and reverse endpoints.",
          "UI'yi run, run-line, plan, onizleme, post ve reverse endpointleri ile destekle."
        ),
        l(
          "Enforce one-asset-per-period posting with DB constraints, not only service checks.",
          "Bir-varlik-bir-donem posting kuralini sadece servis degil DB constraint ile de uygula."
        ),
        l(
          "Validate fiscal period openness for preview-to-post transitions and reversals.",
          "Onizleme-post gecisi ve reversaller icin mali donem aciklik kontrolu yap."
        ),
      ]}
      decisionItems={[
        l(
          "The run schema needs a dedicated run-lines table for auditability and totals.",
          "Run semasi denetim izi ve toplamlar icin ayri bir run-lines tablosu gerektiriyor."
        ),
        l(
          "Transaction-level and run-level evidence are in scope, not asset-level only.",
          "Sadece varlik seviyesi degil, hareket ve run seviyesi kanit da kapsam icinde."
        ),
      ]}
    />
  );
}
