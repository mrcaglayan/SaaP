import {
  getWorkflowPackageCatalogEntry,
} from "./security/roleCatalog.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function interpolateTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, key) => {
    if (!values || typeof values !== "object") {
      return "";
    }
    const resolvedValue = values[key];
    return resolvedValue == null ? "" : String(resolvedValue);
  });
}

function translate(l, english, turkish, values) {
  const template =
    typeof l === "function" ? l(english, turkish, values) : english;
  return interpolateTemplate(template, values);
}

function translateScopeTypeLabel(scopeType, l) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  if (normalizedScopeType === "GROUP") {
    return translate(l, "Group", "Grup");
  }
  if (normalizedScopeType === "COUNTRY") {
    return translate(l, "Country", "Ulke");
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    return translate(l, "Legal Entity", "Tuzel Kisilik");
  }
  if (normalizedScopeType === "OPERATING_UNIT") {
    return translate(l, "Operating Unit", "Operasyon Birimi");
  }
  if (normalizedScopeType === "TENANT") {
    return translate(l, "Tenant", "Tenant");
  }
  return normalizedScopeType;
}

function resolveWorkflowStatusLabel(workflowGate, reviewGateLoading, reviewGateError, l) {
  if (reviewGateLoading) {
    return translate(l, "Loading", "Yukleniyor");
  }
  if (reviewGateError) {
    return translate(l, "Unavailable", "Kullanilamaz");
  }
  if (!workflowGate?.required) {
    return translate(l, "Not required", "Gerekli degil");
  }
  if (workflowGate?.approved) {
    return translate(l, "Approved", "Onayli");
  }
  return (
    normalizeText(workflowGate?.instance?.status) ||
    normalizeText(workflowGate?.assignment?.status) ||
    translate(l, "Pending", "Beklemede")
  );
}

function getSelectedRunStatus(selectedRun, reviewGateData) {
  return normalizeText(
    reviewGateData?.run?.currentStatus || selectedRun?.status || selectedRun?.currentStatus
  ).toUpperCase();
}

function resolveCurrentStage({
  selectedRun,
  reviewGateData,
  reviewGateLoading,
  reviewGateError,
}) {
  const currentStatus = getSelectedRunStatus(selectedRun, reviewGateData);
  if (currentStatus === "LOCKED") {
    return "FINALIZED";
  }
  if (reviewGateLoading && !reviewGateData) {
    return "REVIEW_LOADING";
  }
  if (reviewGateError && !reviewGateData) {
    return "REVIEW_UNAVAILABLE";
  }
  if (currentStatus === "IN_PROGRESS") {
    return "EXECUTION_IN_PROGRESS";
  }
  if (currentStatus === "FAILED") {
    return "EXECUTION_RETRY";
  }

  const entryCount = Number(reviewGateData?.counts?.entryCount || 0);
  const draftAdjustmentCount = Number(reviewGateData?.counts?.draftAdjustmentCount || 0);
  const draftEliminationCount = Number(reviewGateData?.counts?.draftEliminationCount || 0);
  if (entryCount <= 0) {
    return "EXECUTION_PENDING";
  }
  if (draftAdjustmentCount > 0) {
    return "ADJUSTMENT_PENDING";
  }
  if (draftEliminationCount > 0) {
    return "ELIMINATION_PENDING";
  }
  if (reviewGateData?.workflowGate?.required && !reviewGateData?.workflowGate?.approved) {
    return "FINALIZE_PENDING_APPROVAL";
  }
  if (reviewGateData && !reviewGateData.canFinalize) {
    return "FINALIZE_BLOCKED";
  }
  return "READY_TO_FINALIZE";
}

function resolveRequiredPackageCode(stage) {
  if (
    stage === "EXECUTION_PENDING" ||
    stage === "EXECUTION_IN_PROGRESS" ||
    stage === "EXECUTION_RETRY"
  ) {
    return "PKG-CON-EXECUTE";
  }
  if (stage === "ADJUSTMENT_PENDING") {
    return "PKG-CON-ADJUST";
  }
  if (stage === "ELIMINATION_PENDING") {
    return "PKG-CON-ELIM";
  }
  if (
    stage === "FINALIZE_PENDING_APPROVAL" ||
    stage === "FINALIZE_BLOCKED" ||
    stage === "READY_TO_FINALIZE" ||
    stage === "FINALIZED"
  ) {
    return "PKG-CON-FINALIZE";
  }
  return "";
}

function resolveTone(stage) {
  if (stage === "FINALIZED") {
    return "emerald";
  }
  if (
    stage === "ADJUSTMENT_PENDING" ||
    stage === "ELIMINATION_PENDING" ||
    stage === "FINALIZE_PENDING_APPROVAL" ||
    stage === "FINALIZE_BLOCKED" ||
    stage === "EXECUTION_RETRY"
  ) {
    return "amber";
  }
  if (stage === "REVIEW_UNAVAILABLE") {
    return "slate";
  }
  return "blue";
}

function resolveBadgeLabel(stage, l) {
  if (stage === "FINALIZED") {
    return translate(l, "Finalized", "Sonlandirildi");
  }
  if (stage === "REVIEW_LOADING") {
    return translate(l, "Review gate loading", "Inceleme kapisi yukleniyor");
  }
  if (stage === "REVIEW_UNAVAILABLE") {
    return translate(l, "Review gate unavailable", "Inceleme kapisi kullanilamaz");
  }
  if (stage === "EXECUTION_IN_PROGRESS") {
    return translate(l, "Run execution in progress", "Calistirma suruyor");
  }
  if (stage === "EXECUTION_RETRY") {
    return translate(l, "Run execution failed", "Calistirma basarisiz");
  }
  if (stage === "EXECUTION_PENDING") {
    return translate(l, "Execute run", "Calistirmayi yurut");
  }
  if (stage === "ADJUSTMENT_PENDING") {
    return translate(l, "Draft adjustments pending", "Taslak duzeltmeler bekliyor");
  }
  if (stage === "ELIMINATION_PENDING") {
    return translate(l, "Draft eliminations pending", "Taslak eliminasyonlar bekliyor");
  }
  if (stage === "FINALIZE_PENDING_APPROVAL") {
    return translate(l, "Finalize approval pending", "Sonlandirma onayi bekliyor");
  }
  if (stage === "FINALIZE_BLOCKED") {
    return translate(l, "Finalize blocked", "Sonlandirma blokeli");
  }
  return translate(l, "Ready to finalize", "Sonlandirmaya hazir");
}

function resolveHeadline(stage, reviewGateData, l) {
  const firstBlocker = Array.isArray(reviewGateData?.blockers) ? reviewGateData.blockers[0] : null;
  if (stage === "FINALIZED") {
    return translate(
      l,
      "This consolidation run is finalized and locked.",
      "Bu konsolidasyon calistirmasi sonlandirildi ve kilitlendi."
    );
  }
  if (stage === "REVIEW_LOADING") {
    return translate(
      l,
      "The page is loading the live consolidation review gate for this run.",
      "Bu calistirma icin canli konsolidasyon inceleme kapisi yukleniyor."
    );
  }
  if (stage === "REVIEW_UNAVAILABLE") {
    return translate(
      l,
      "The consolidation review gate could not be loaded, so finalize readiness is not fully explainable yet.",
      "Konsolidasyon inceleme kapisi yuklenemedi; bu nedenle sonlandirma hazirligi henuz tam aciklanamiyor."
    );
  }
  if (stage === "EXECUTION_IN_PROGRESS") {
    return translate(
      l,
      "This consolidation run is currently executing.",
      "Bu konsolidasyon calistirmasi su anda yurutuluyor."
    );
  }
  if (stage === "EXECUTION_RETRY") {
    return translate(
      l,
      "The last consolidation execution failed and needs another attempt.",
      "Son konsolidasyon calistirmasi basarisiz oldu ve yeniden denenmeli."
    );
  }
  if (stage === "EXECUTION_PENDING") {
    return translate(
      l,
      "This run exists, but it still needs execution before group review and finalization can continue.",
      "Bu calistirma var, ancak grup incelemesi ve sonlandirma devam etmeden once halen yurutulmelidir."
    );
  }
  if (stage === "ADJUSTMENT_PENDING") {
    return translate(
      l,
      "Draft consolidation adjustments still block finalization.",
      "Taslak konsolidasyon duzeltmeleri sonlandirmayi hala engelliyor."
    );
  }
  if (stage === "ELIMINATION_PENDING") {
    return translate(
      l,
      "Draft consolidation eliminations still block finalization.",
      "Taslak konsolidasyon eliminasyonlari sonlandirmayi hala engelliyor."
    );
  }
  if (stage === "FINALIZE_PENDING_APPROVAL") {
    return translate(
      l,
      "This run is waiting for workflow approval before finalization can continue.",
      "Bu calistirma sonlandirma devam etmeden once workflow onayini bekliyor."
    );
  }
  if (firstBlocker?.message) {
    return firstBlocker.message;
  }
  return translate(
    l,
    "This run is ready for group finalization.",
    "Bu calistirma grup sonlandirmasi icin hazir."
  );
}

function resolveSupportingText(selectedRun, reviewGateData, reviewGateError) {
  if (normalizeText(reviewGateError)) {
    return normalizeText(reviewGateError);
  }
  const workflowMessage = normalizeText(reviewGateData?.workflowGate?.message);
  if (workflowMessage) {
    return workflowMessage;
  }
  const groupCode = normalizeText(
    reviewGateData?.run?.consolidationGroupCode || selectedRun?.consolidation_group_code
  );
  const groupName = normalizeText(
    reviewGateData?.run?.consolidationGroupName || selectedRun?.consolidation_group_name
  );
  const fiscalYear = normalizeText(selectedRun?.fiscal_year);
  const periodNo = normalizeText(selectedRun?.period_no).padStart(2, "0");
  const periodName = normalizeText(selectedRun?.period_name);
  const parts = [];
  if (groupCode || groupName) {
    parts.push([groupCode, groupName].filter(Boolean).join(" - "));
  }
  if (fiscalYear || periodNo || periodName) {
    parts.push(
      [fiscalYear, periodNo ? `P${periodNo}` : "", periodName].filter(Boolean).join(" ")
    );
  }
  return parts.join(" | ");
}

function resolveCurrentStepLabel(stage, l) {
  if (stage === "FINALIZED") {
    return translate(l, "Finalized", "Sonlandirildi");
  }
  if (stage === "REVIEW_LOADING" || stage === "REVIEW_UNAVAILABLE") {
    return translate(l, "Review gate", "Inceleme kapisi");
  }
  if (
    stage === "EXECUTION_PENDING" ||
    stage === "EXECUTION_IN_PROGRESS" ||
    stage === "EXECUTION_RETRY"
  ) {
    return translate(l, "Execute run", "Calistirmayi yurut");
  }
  if (stage === "ADJUSTMENT_PENDING") {
    return translate(l, "Post adjustments", "Duzeltmeleri post et");
  }
  if (stage === "ELIMINATION_PENDING") {
    return translate(l, "Post eliminations", "Eliminasyonlari post et");
  }
  return translate(l, "Finalize", "Sonlandir");
}

function resolveEligibleActorSummary(stage, requiredPackageLabel, requiredScopeLabel, l) {
  if (!requiredPackageLabel || !requiredScopeLabel) {
    return "";
  }
  if (
    stage === "EXECUTION_PENDING" ||
    stage === "EXECUTION_IN_PROGRESS" ||
    stage === "EXECUTION_RETRY"
  ) {
    return translate(
      l,
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can execute this run once preparation is complete.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar hazirlik tamamlandiginda bu calistirmayi yurutabilir.`
    );
  }
  if (stage === "ADJUSTMENT_PENDING") {
    return translate(
      l,
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can post draft consolidation adjustments now.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar taslak konsolidasyon duzeltmelerini simdi post edebilir.`
    );
  }
  if (stage === "ELIMINATION_PENDING") {
    return translate(
      l,
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can post draft eliminations now.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar taslak eliminasyonlari simdi post edebilir.`
    );
  }
  if (stage === "FINALIZED") {
    return translate(
      l,
      `This run is already locked; no further ${requiredPackageLabel} action is required.`,
      `Bu calistirma zaten kilitli; ek ${requiredPackageLabel} aksiyonu gerekmiyor.`
    );
  }
  return translate(
    l,
    `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can finalize this run once the blockers clear.`,
    `Engeller temizlendikten sonra ${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu calistirmayi sonlandirabilir.`
  );
}

function buildUserCapabilityLines({
  stage,
  canCreateRun,
  canExecuteRun,
  canPostAdjustment,
  canPostElimination,
  canFinalizeRuns,
  finalizeDisabledReason,
  l,
}) {
  const lines = [];
  if (stage === "EXECUTION_PENDING" || stage === "EXECUTION_IN_PROGRESS" || stage === "EXECUTION_RETRY") {
    lines.push(
      canExecuteRun
        ? translate(
            l,
            "You can execute this run from the current group scope.",
            "Mevcut grup kapsaminda bu calistirmayi yurutebilirsiniz."
          )
        : translate(
            l,
            "You can review this run, but you cannot execute it from your current authority.",
            "Bu calistirmayi inceleyebilirsiniz, ancak mevcut yetkinizle yurutemezsiniz."
          )
    );
    if (canCreateRun) {
      lines.push(
        translate(
          l,
          "You can also prepare new consolidation runs for group periods.",
          "Grup donemleri icin yeni konsolidasyon calistirmalari da hazirlayabilirsiniz."
        )
      );
    }
    return lines;
  }

  if (stage === "ADJUSTMENT_PENDING") {
    lines.push(
      canPostAdjustment
        ? translate(
            l,
            "You can post draft adjustments for this run now.",
            "Bu calistirma icin taslak duzeltmeleri simdi post edebilirsiniz."
          )
        : translate(
            l,
            "You can review draft adjustments, but you cannot post them from your current authority.",
            "Taslak duzeltmeleri inceleyebilirsiniz, ancak mevcut yetkinizle post edemezsiniz."
          )
    );
    return lines;
  }

  if (stage === "ELIMINATION_PENDING") {
    lines.push(
      canPostElimination
        ? translate(
            l,
            "You can post draft eliminations for this run now.",
            "Bu calistirma icin taslak eliminasyonlari simdi post edebilirsiniz."
          )
        : translate(
            l,
            "You can review draft eliminations, but you cannot post them from your current authority.",
            "Taslak eliminasyonlari inceleyebilirsiniz, ancak mevcut yetkinizle post edemezsiniz."
          )
    );
    return lines;
  }

  if (stage === "FINALIZED") {
    lines.push(
      translate(
        l,
        "This run is already finalized, so no further action is available here.",
        "Bu calistirma zaten sonlandirildigi icin burada ek aksiyon bulunmuyor."
      )
    );
    return lines;
  }

  if (canFinalizeRuns) {
    if (finalizeDisabledReason) {
      lines.push(
        translate(
          l,
          "You have finalize authority, but the finalize button is disabled until the remaining blockers clear.",
          "Sonlandirma yetkiniz var, ancak kalan engeller temizlenene kadar sonlandirma butonu devre disi."
        )
      );
      lines.push(
        translate(
          l,
          `Disabled reason: ${finalizeDisabledReason}`,
          `Devre disi nedeni: ${finalizeDisabledReason}`
        )
      );
    } else {
      lines.push(
        translate(
          l,
          "You can finalize this run now.",
          "Bu calistirmayi simdi sonlandirabilirsiniz."
        )
      );
    }
    return lines;
  }

  lines.push(
    translate(
      l,
      "You can review finalize readiness here, but you do not have finalization authority.",
      "Burada sonlandirma hazirligini inceleyebilirsiniz, ancak sonlandirma yetkiniz yok."
    )
  );
  return lines;
}

function buildPackageStageNoteItem(packageCode, label, englishVerb, turkishVerb, l) {
  const packageEntry = getWorkflowPackageCatalogEntry(packageCode);
  if (!packageEntry?.displayName || !packageEntry?.defaultScope) {
    return null;
  }
  return {
    label,
    value: translate(l, "{{package}} governs {{verb}} at {{scope}} scope.", "{{package}}, {{scope}} kapsaminda {{verb}} yonetir.", {
      package: packageEntry.displayName,
      verb: translate(l, englishVerb, turkishVerb),
      scope: translateScopeTypeLabel(packageEntry.defaultScope, l),
    }),
  };
}

function buildStageVisibilityItems(reviewGateData, l) {
  const entryCount = Number(reviewGateData?.counts?.entryCount || 0);
  const draftAdjustmentCount = Number(reviewGateData?.counts?.draftAdjustmentCount || 0);
  const draftEliminationCount = Number(reviewGateData?.counts?.draftEliminationCount || 0);
  const blockerCount = Array.isArray(reviewGateData?.blockers) ? reviewGateData.blockers.length : 0;
  const warningCount = Array.isArray(reviewGateData?.warnings) ? reviewGateData.warnings.length : 0;
  return [
    buildPackageStageNoteItem(
      "PKG-CON-PREPARE",
      translate(l, "Prepare stage", "Hazirlik asamasi"),
      "preparing this run",
      "bu calistirmayi hazirlama",
      l
    ),
    {
      label: translate(l, "Execute stage", "Yurutme asamasi"),
      value:
        entryCount > 0
          ? translate(
              l,
              "{{count}} consolidation entries are already present for this run.",
              "Bu calistirma icin {{count}} konsolidasyon kaydi zaten mevcut.",
              { count: entryCount }
            )
          : translate(
              l,
              "Execution has not produced consolidation entries yet.",
              "Yurutme henuz konsolidasyon kaydi uretmedi."
            ),
    },
    {
      label: translate(l, "Adjustment stage", "Duzeltme asamasi"),
      value:
        draftAdjustmentCount > 0
          ? translate(
              l,
              "{{count}} draft adjustments remain and must be posted before finalization.",
              "{{count}} taslak duzeltme kaldi; sonlandirma oncesinde post edilmelidir.",
              { count: draftAdjustmentCount }
            )
          : translate(
              l,
              "No draft adjustments remain for this run.",
              "Bu calistirma icin taslak duzeltme kalmadi."
            ),
    },
    {
      label: translate(l, "Elimination stage", "Eliminasyon asamasi"),
      value:
        draftEliminationCount > 0
          ? translate(
              l,
              "{{count}} draft eliminations remain and must be posted before finalization.",
              "{{count}} taslak eliminasyon kaldi; sonlandirma oncesinde post edilmelidir.",
              { count: draftEliminationCount }
            )
          : translate(
              l,
              "No draft eliminations remain for this run.",
              "Bu calistirma icin taslak eliminasyon kalmadi."
            ),
    },
    {
      label: translate(l, "Finalize stage", "Sonlandirma asamasi"),
      value: translate(
        l,
        "Publish state: {{state}} | Blockers: {{blockers}} | Warnings: {{warnings}}",
        "Yayin durumu: {{state}} | Engeller: {{blockers}} | Uyarilar: {{warnings}}",
        {
          state: normalizeText(reviewGateData?.publishState || "-"),
          blockers: blockerCount,
          warnings: warningCount,
        }
      ),
    },
  ].filter(Boolean);
}

/**
 * Returns the disabled reason for the consolidation finalize action.
 */
export function buildConsolidationFinalizeDisabledReason({
  selectedRun = null,
  reviewGateLoading = false,
  reviewGateData = null,
  canFinalizeRuns = false,
  saving = "",
  l,
}) {
  if (saving === "finalize") {
    return translate(l, "finalization is already in progress", "sonlandirma zaten isleniyor");
  }
  if (!selectedRun) {
    return translate(l, "select a consolidation run first", "once bir konsolidasyon calistirmasi secin");
  }
  if (!canFinalizeRuns) {
    return translate(
      l,
      "you do not have Consolidation / Finalize authority at Group scope",
      "Grup kapsaminda Konsolidasyon / Sonlandir yetkiniz yok"
    );
  }
  if (reviewGateLoading) {
    return translate(
      l,
      "wait for the consolidation review gate to finish loading",
      "konsolidasyon inceleme kapisi yuklemeyi bitirsin"
    );
  }
  if (getSelectedRunStatus(selectedRun, reviewGateData) === "LOCKED") {
    return translate(l, "this run is already finalized", "bu calistirma zaten sonlandirildi");
  }
  if (reviewGateData && !reviewGateData.canFinalize) {
    const firstBlocker = Array.isArray(reviewGateData?.blockers) ? reviewGateData.blockers[0] : null;
    return normalizeText(firstBlocker?.message) || translate(
      l,
      "review-gate blockers still need to clear",
      "inceleme kapisi engellerinin halen temizlenmesi gerekiyor"
    );
  }
  return "";
}

/**
 * Builds the shared consolidation runtime explainability model for the
 * consolidation run page from the live RP12 review-gate payload.
 */
export function buildConsolidationRuntimeExplainabilityModel({
  selectedRun = null,
  reviewGateData = null,
  reviewGateLoading = false,
  reviewGateError = "",
  canCreateRun = false,
  canExecuteRun = false,
  canPostAdjustment = false,
  canPostElimination = false,
  canFinalizeRuns = false,
  finalizeDisabledReason = "",
  l,
}) {
  if (!selectedRun) {
    return null;
  }

  const stage = resolveCurrentStage({
    selectedRun,
    reviewGateData,
    reviewGateLoading,
    reviewGateError,
  });
  const requiredPackageCode = resolveRequiredPackageCode(stage);
  const requiredPackageEntry = requiredPackageCode
    ? getWorkflowPackageCatalogEntry(requiredPackageCode)
    : null;
  const requiredScopeType = normalizeText(requiredPackageEntry?.defaultScope).toUpperCase();
  const requiredScopeLabel = translateScopeTypeLabel(requiredScopeType, l);

  return {
    tone: resolveTone(stage),
    badgeLabel: resolveBadgeLabel(stage, l),
    headline: resolveHeadline(stage, reviewGateData, l),
    supportingText: resolveSupportingText(selectedRun, reviewGateData, reviewGateError),
    currentStepLabel: resolveCurrentStepLabel(stage, l),
    requiredPackageLabel: requiredPackageEntry?.displayName || "",
    requiredScopeLabel,
    eligibleActorSummary: resolveEligibleActorSummary(
      stage,
      requiredPackageEntry?.displayName || "",
      requiredScopeLabel,
      l
    ),
    userCapabilityLines: buildUserCapabilityLines({
      stage,
      canCreateRun,
      canExecuteRun,
      canPostAdjustment,
      canPostElimination,
      canFinalizeRuns,
      finalizeDisabledReason,
      l,
    }),
    workflowStatusLabel: resolveWorkflowStatusLabel(
      reviewGateData?.workflowGate,
      reviewGateLoading,
      reviewGateError,
      l
    ),
    noteItems: reviewGateData ? buildStageVisibilityItems(reviewGateData, l) : [],
    historyItems: [],
    technicalItems: [
      {
        label: translate(l, "Run id", "Calistirma no"),
        value: String(toPositiveInt(selectedRun?.id || reviewGateData?.run?.id) || "-"),
      },
      {
        label: translate(l, "Run status", "Calistirma durumu"),
        value: getSelectedRunStatus(selectedRun, reviewGateData) || "-",
      },
      {
        label: translate(l, "Publish state", "Yayin durumu"),
        value: normalizeText(reviewGateData?.publishState || "-"),
      },
      {
        label: translate(l, "Workflow gate", "Workflow kapisi"),
        value:
          normalizeText(reviewGateData?.workflowGate?.errorCode) ||
          resolveWorkflowStatusLabel(reviewGateData?.workflowGate, reviewGateLoading, reviewGateError, l),
      },
      {
        label: translate(l, "Entry count", "Kayit sayisi"),
        value: String(Number(reviewGateData?.counts?.entryCount || 0)),
      },
      {
        label: translate(l, "Draft adjustments", "Taslak duzeltmeler"),
        value: String(Number(reviewGateData?.counts?.draftAdjustmentCount || 0)),
      },
      {
        label: translate(l, "Draft eliminations", "Taslak eliminasyonlar"),
        value: String(Number(reviewGateData?.counts?.draftEliminationCount || 0)),
      },
    ],
  };
}
