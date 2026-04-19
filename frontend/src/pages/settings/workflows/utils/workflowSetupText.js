/**
 * Returns the translated copy map for the guided workflow setup UI.
 */
export function getWorkflowSetupText(l) {
  return {
    workflowTypeLabels: {
      AP_DOCUMENT_POSTING: l("AP Document Posting", "AP Belge Kaydi"),
      PERIOD_CLOSE: l("Period Close", "Donem Kapanisi"),
      CONSOLIDATION_RUN: l("Consolidation Run", "Konsolidasyon Calistirma"),
      LOCAL_CLOSE_PACK: l("Local Close Pack", "Yerel Kapanis Paketi"),
    },
    scopeTypeLabels: {
      TENANT: l("Tenant", "Tenant"),
      GROUP: l("Group", "Grup"),
      COUNTRY: l("Country", "Ulke"),
      LEGAL_ENTITY: l("Legal Entity", "Legal Entity"),
      OPERATING_UNIT: l("Operating Unit", "Operating Unit"),
    },
    stepScopeLabels: {
      OPERATING_UNIT: l("Operating Unit", "Operating Unit"),
      LEGAL_ENTITY: l("Legal Entity", "Legal Entity"),
      COUNTRY: l("Country", "Ulke"),
      GROUP: l("Group", "Grup"),
    },
    progressSteps: [
      {
        label: l("Workflow Type", "Workflow Turu"),
        description: l("Choose the process", "Sureci secin"),
      },
      {
        label: l("Target Scope", "Hedef Kapsam"),
        description: l("Where it applies", "Nerede gecerli"),
      },
      {
        label: l("Definition", "Tanim"),
        description: l("Name and code", "Ad ve kod"),
      },
      {
        label: l("Workflow Steps", "Workflow Adimlari"),
        description: l("Actions and order", "Eylemler ve sira"),
      },
      {
        label: l("Review", "Inceleme"),
        description: l("Confirm and save", "Dogrula ve kaydet"),
      },
    ],
    workflowTypeMeta: {
      AP_DOCUMENT_POSTING: {
        shortCode: "AP",
        description: l(
          "Approve vendor invoices and governed AP documents before accounting posting. This gate is for AP document posting, not consolidation finalization.",
          "Satici faturalarini ve yonetilen AP belgelerini muhasebe kaydi oncesi onaylar. Bu kapi konsolidasyon finalizasyonu icin degil, AP belge kaydi icindir."
        ),
        tone: {
          icon: "border-blue-200 bg-blue-50 text-blue-700",
          active: "border-blue-500 bg-blue-50 ring-2 ring-blue-200",
        },
        recommended: {
          level: l("Action-specific", "Eylem bazli"),
          minApprovers: l("Only on APPROVE", "Yalnizca APPROVE icin"),
          selfApproval: l("Only on APPROVE", "Yalnizca APPROVE icin"),
          permissionCode: l("Action-bound permission", "Eyleme bagli yetki"),
        },
      },
      PERIOD_CLOSE: {
        shortCode: "PC",
        description: l(
          "Multi-stage approval chain for the monthly accounting close.",
          "Aylik muhasebe kapanisi icin cok adimli onay zinciri."
        ),
        tone: {
          icon: "border-emerald-200 bg-emerald-50 text-emerald-700",
          active: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200",
        },
        recommended: {
          level: l("OU -> Legal Entity -> Group", "OU -> Legal Entity -> Grup"),
          minApprovers: "1",
          selfApproval: l("Not allowed", "Izin verilmez"),
          permissionCode: "gl.period.close",
        },
      },
      CONSOLIDATION_RUN: {
        shortCode: "CR",
        description: l(
          "Approve whether a consolidation run may be finalized and locked after the run has been executed and reviewed. This gate is for consolidation finalization, not AP document posting.",
          "Bir konsolidasyon run'inin calistirildiktan ve gozden gecirildikten sonra finalize edilip kilitlenip kilitlenemeyecegini onaylar. Bu kapi AP belge kaydi icin degil, konsolidasyon finalizasyonu icindir."
        ),
        tone: {
          icon: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
          active: "border-fuchsia-500 bg-fuchsia-50 ring-2 ring-fuchsia-200",
        },
        recommended: {
          level: l("Group", "Grup"),
          minApprovers: "1",
          selfApproval: l("Not allowed", "Izin verilmez"),
          permissionCode: "consolidation.run.finalize",
        },
      },
      LOCAL_CLOSE_PACK: {
        shortCode: "LP",
        description: l(
          "Approval chain for local close packs before group submission.",
          "Gruba gonderim oncesi yerel kapanis paketlerinin onay zinciri."
        ),
        tone: {
          icon: "border-amber-200 bg-amber-50 text-amber-700",
          active: "border-amber-500 bg-amber-50 ring-2 ring-amber-200",
        },
        recommended: {
          level: l("Legal Entity", "Legal Entity"),
          minApprovers: "1",
          selfApproval: l("Not allowed", "Izin verilmez"),
          permissionCode: l("Depends on policy", "Politikaya bagli"),
        },
      },
    },
    scopeTypeMeta: {
      TENANT: {
        shortCode: "TN",
        description: l(
          "Apply this workflow across the whole tenant.",
          "Bu workflow'u tum tenant genelinde uygula."
        ),
      },
      GROUP: {
        shortCode: "GR",
        description: l(
          "Apply to all entities under one group.",
          "Tek bir grubun altindaki tum entity'lerde uygula."
        ),
      },
      COUNTRY: {
        shortCode: "CT",
        description: l(
          "Apply to one country and everything under it.",
          "Tek bir ulkede ve altindaki tum kayitlarda uygula."
        ),
      },
      LEGAL_ENTITY: {
        shortCode: "LE",
        description: l(
          "Apply only to one legal entity.",
          "Yalnizca tek bir legal entity icin uygula."
        ),
      },
      OPERATING_UNIT: {
        shortCode: "OU",
        description: l(
          "Apply only to one operating unit.",
          "Yalnizca tek bir operating unit icin uygula."
        ),
      },
    },
    processRecommendations: {
      AP_DOCUMENT_POSTING: {
        title: l("Recommended for AP posting", "AP kaydi icin onerilen"),
        points: [
          l(
            "Add each AP action explicitly: DRAFT, SUBMIT, APPROVE, and POST only when you need them.",
            "Her AP eylemini acikca ekleyin: DRAFT, SUBMIT, APPROVE ve POST yalnizca gerekiyorsa kullanin."
          ),
          l("Turn self-approval off.", "Kendi kendine onayi kapali tutun."),
          l(
            "The selected action determines the required permission; scope determines who owns that step.",
            "Secilen eylem gerekli yetkiyi belirler; kapsam ise o adimin kimde olacagini belirler."
          ),
          l("Typical assignment scope: Country.", "Tipik atama kapsami: Ulke."),
        ],
      },
      PERIOD_CLOSE: {
        title: l("Recommended for period close", "Donem kapanisi icin onerilen"),
        points: [
          l(
            "Use 3 steps: Operating Unit, Legal Entity, Group.",
            "3 adim kullanin: Operating Unit, Legal Entity, Grup."
          ),
          l(
            'Use reviewer permission "gl.period.close".',
            '"gl.period.close" inceleyen yetkisini kullanin.'
          ),
        ],
      },
      CONSOLIDATION_RUN: {
        title: l(
          "Recommended for consolidation finalization",
          "Konsolidasyon finalizasyonu icin onerilen"
        ),
        points: [
          l(
            "Use 3 steps: Operating Unit, Legal Entity, Group.",
            "3 adim kullanin: Operating Unit, Legal Entity, Grup."
          ),
          l(
            'Use reviewer permission "consolidation.run.finalize".',
            '"consolidation.run.finalize" inceleyen yetkisini kullanin.'
          ),
          l(
            "This workflow approves the consolidation run itself, not the underlying AP documents.",
            "Bu workflow alttaki AP belgelerini degil, konsolidasyon run'inin kendisini onaylar."
          ),
        ],
      },
      LOCAL_CLOSE_PACK: {
        title: l("Recommended for local close packs", "Yerel kapanis paketleri icin onerilen"),
        points: [
          l(
            "Start with 1 legal-entity approval step.",
            "1 adet legal entity seviyesinde onay adimi ile baslayin."
          ),
          l(
            "Adjust only if you need custom escalation or routing.",
            "Yalnizca ozel escalation veya yonlendirme gerekiyorsa degistirin."
          ),
        ],
      },
    },
    quickGuide: [
      l("A workflow is the reusable process recipe.", "Workflow tekrar kullanilabilir surec tarifidir."),
      l("Steps define which action happens and in what order.", "Adimlar hangi eylemin hangi sirayla olacagini tanimlar."),
      l("An assignment decides where the workflow is active.", "Atama workflow'un nerede aktif olacagini belirler."),
    ],
    apBusinessLabels: {
      atWhichScope: l("At which organizational scope", "Hangi organizasyon kapsaminda"),
      effectivePermission: l(
        "For AP, the selected action locks the required permission for this step. Scope decides which users can act.",
        "AP icin, secilen eylem bu adimin gerekli yetkisini kilitler. Hangi kullanicilarin islem yapabilecegini kapsam belirler."
      ),
    },
  };
}

export default {
  getWorkflowSetupText,
};
