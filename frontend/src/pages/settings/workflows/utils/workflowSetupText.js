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
        label: l("Approval Steps", "Onay Adimlari"),
        description: l("Who approves", "Kim onaylar"),
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
          level: l("Country", "Ulke"),
          minApprovers: "1",
          selfApproval: l("Not allowed", "Izin verilmez"),
          permissionCode: l("Leave empty", "Bos birakin"),
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
          l("Use 1 country-level approval step.", "1 adet ulke seviyesinde onay adimi kullanin."),
          l(
            "Leave reviewer permission empty. AP reviewer authority comes from scope assignment.",
            "Inceleyen yetkisini bos birakin. AP inceleyen yetkisi kapsam atamasindan gelir."
          ),
          l("Turn self-approval off.", "Kendi kendine onayi kapali tutun."),
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
      l("A workflow is the approval recipe.", "Workflow onay tarifidir."),
      l("Steps define who approves and in what order.", "Adimlar kimin hangi sirada onay verecegini tanimlar."),
      l("An assignment decides where the workflow is active.", "Atama workflow'un nerede aktif olacagini belirler."),
    ],
    apBusinessTemplates: {
      "branch-entity-country": {
        label: l(
          "Branch submits \u2192 Entity approves \u2192 Country posts",
          "Sube gonderir \u2192 Entity onaylar \u2192 Ulke kaydeder"
        ),
        description: l(
          "Two-step approval: Legal Entity reviewer approves first, then Country reviewer. Country poster posts after approval.",
          "Iki adimli onay: Ilk olarak Legal Entity inceleyicisi, ardindan Ulke inceleyicisi onaylar. Onaydan sonra Ulke kayit yetkisi kaydeder."
        ),
      },
      "branch-country": {
        label: l(
          "Branch submits \u2192 Country approves \u2192 Country posts",
          "Sube gonderir \u2192 Ulke onaylar \u2192 Ulke kaydeder"
        ),
        description: l(
          "Single-step approval at Country level. The most common AP flow.",
          "Ulke seviyesinde tek adimli onay. En yaygin AP akisi."
        ),
      },
      "branch-entity": {
        label: l(
          "Branch submits \u2192 Entity approves \u2192 Entity posts",
          "Sube gonderir \u2192 Entity onaylar \u2192 Entity kaydeder"
        ),
        description: l(
          "Single-step approval at Legal Entity level. Entity poster posts after approval.",
          "Legal Entity seviyesinde tek adimli onay. Onaydan sonra Entity kayit yetkisi kaydeder."
        ),
      },
      "direct-post": {
        label: l(
          "Direct post without workflow approval",
          "Workflow onayi olmadan dogrudan kayit"
        ),
        description: l(
          "No approval steps. Documents can be posted directly after submission by an authorized poster.",
          "Onay adimi yok. Belgeler yetkili bir kayit sorumlusu tarafindan gonderimden sonra dogrudan kaydedilebilir."
        ),
      },
    },
    apBusinessLabels: {
      templateSectionTitle: l("AP business flow template", "AP is akisi sablonu"),
      templateSectionDescription: l(
        "Choose a predefined approval flow or customize the steps below.",
        "Onceden tanimlanmis bir onay akisi secin veya adimlari asagidan ozellestirin."
      ),
      customTemplate: l("Custom (configure manually)", "Ozel (manuel yapilandir)"),
      businessPreviewTitle: l("Business process preview", "Is sureci onizlemesi"),
      whoReviews: l("Who reviews this step", "Bu adimi kim inceler"),
      atWhichScope: l("At which organizational scope", "Hangi organizasyon kapsaminda"),
      whoPostsAfter: l("Who posts after approval", "Onaydan sonra kim kaydeder"),
      reviewerAuthority: l(
        "Reviewer authority comes from the workflow assignment scope, not from a step-level permission code.",
        "Inceleyen yetkisi adim seviyesindeki bir yetki kodundan degil, workflow atama kapsamindan gelir."
      ),
      effectivePermission: l(
        "Effective permission: approvals.requests.approve at the step\u2019s scope",
        "Gecerli yetki: adimin kapsaminda approvals.requests.approve"
      ),
    },
  };
}

export default {
  getWorkflowSetupText,
};
