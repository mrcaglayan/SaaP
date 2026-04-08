import {
  getWorkflowPackageCatalogEntry,
  listBusinessRoleCatalogEntries,
} from "./security/roleCatalog.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function formatCloseStatusLabel(closeStatus, l) {
  const normalizedCloseStatus = normalizeText(closeStatus).toUpperCase();
  if (normalizedCloseStatus === "SOFT_CLOSED") {
    return l("Soft close", "Yumusak kapanis");
  }
  if (normalizedCloseStatus === "HARD_CLOSED") {
    return l("Hard close", "Sert kapanis");
  }
  return normalizedCloseStatus || l("Close", "Kapanis");
}

function resolveRequiredPackageCode(stage) {
  if (stage === "READINESS_REVIEW" || stage === "READINESS_BLOCKED") {
    return "PKG-PC-READINESS";
  }
  return "PKG-PC-CLOSE";
}

function buildEligibleRoleLabels(requiredPackageCode) {
  if (!requiredPackageCode) {
    return [];
  }
  return listBusinessRoleCatalogEntries()
    .filter((entry) => entry.defaultScope === "LEGAL_ENTITY")
    .filter((entry) => {
      const starterPackageCodes = Array.isArray(entry?.starterPackageCodes)
        ? entry.starterPackageCodes
        : [];
      const optionalPackageCodes = Array.isArray(entry?.optionalPackageCodes)
        ? entry.optionalPackageCodes
        : [];
      return [...starterPackageCodes, ...optionalPackageCodes].includes(requiredPackageCode);
    })
    .map((entry) => entry.displayName)
    .filter(Boolean);
}

function resolveCurrentStage({ latestRun, workflowGateBlock, fxGateBlock }) {
  if (fxGateBlock) {
    return "READINESS_BLOCKED";
  }
  if (workflowGateBlock) {
    return "CLOSE_PENDING_APPROVAL";
  }

  const runStatus = normalizeText(latestRun?.status).toUpperCase();
  if (runStatus === "COMPLETED") {
    return "CLOSED";
  }
  if (runStatus === "REOPENED") {
    return "READINESS_REVIEW";
  }
  if (runStatus === "FAILED") {
    return "CLOSE_RETRY";
  }
  if (runStatus === "IN_PROGRESS") {
    return "CLOSE_IN_PROGRESS";
  }
  return "READINESS_REVIEW";
}

function resolveTone(stage) {
  if (stage === "CLOSED") {
    return "emerald";
  }
  if (stage === "READINESS_BLOCKED" || stage === "CLOSE_PENDING_APPROVAL" || stage === "CLOSE_RETRY") {
    return "amber";
  }
  return "blue";
}

function resolveBadgeLabel(stage, workflowGateBlock, l) {
  if (stage === "READINESS_BLOCKED") {
    return l("Readiness blocked", "Hazirlik blokeli");
  }
  if (stage === "CLOSE_PENDING_APPROVAL") {
    const errorCode = normalizeText(workflowGateBlock?.code).toUpperCase();
    if (errorCode === "WORKFLOW_NOT_ASSIGNED") {
      return l("Workflow assignment missing", "Workflow atamasi eksik");
    }
    if (errorCode === "APPROVAL_INSTANCE_REJECTED") {
      return l("Workflow rejected", "Workflow reddedildi");
    }
    return l("Close approval pending", "Kapanis onayi bekliyor");
  }
  if (stage === "CLOSE_IN_PROGRESS") {
    return l("Close run in progress", "Kapanis calismasi suruyor");
  }
  if (stage === "CLOSE_RETRY") {
    return l("Close retry needed", "Kapanis yeniden denenmeli");
  }
  if (stage === "CLOSED") {
    return l("Closed", "Kapali");
  }
  return l("Readiness review", "Hazirlik incelemesi");
}

function resolveHeadline(stage, workflowGateBlock, fxGateBlock, latestRun, l) {
  if (stage === "READINESS_BLOCKED") {
    return l(
      "Period close is blocked at the readiness stage.",
      "Donem kapanisi hazirlik asamasinda engellendi."
    );
  }
  if (stage === "CLOSE_PENDING_APPROVAL") {
    const errorCode = normalizeText(workflowGateBlock?.code).toUpperCase();
    if (errorCode === "WORKFLOW_NOT_ASSIGNED") {
      return l(
        "Period close cannot complete because no active workflow assignment was found for this scope.",
        "Bu kapsam icin aktif workflow atamasi bulunamadigi icin donem kapanisi tamamlanamiyor."
      );
    }
    if (errorCode === "APPROVAL_INSTANCE_REJECTED") {
      return l(
        "Period close is blocked because the workflow instance was rejected.",
        "Workflow instance reddedildigi icin donem kapanisi engellendi."
      );
    }
    return l(
      "Period close is waiting for workflow approval before completion.",
      "Donem kapanisi tamamlanmadan once workflow onayini bekliyor."
    );
  }
  if (stage === "CLOSE_IN_PROGRESS") {
    return l(
      "A period close run is in progress for the current selection.",
      "Mevcut secim icin bir donem kapanis calismasi suruyor."
    );
  }
  if (stage === "CLOSE_RETRY") {
    return l(
      "The last close run failed and needs another attempt after readiness is checked again.",
      "Son kapanis calismasi basarisiz oldu; hazirlik yeniden kontrol edildikten sonra tekrar denenmeli."
    );
  }
  if (stage === "CLOSED") {
    return l(
      "The latest period close run is completed.",
      "En son donem kapanis calismasi tamamlandi."
    );
  }
  if (normalizeText(latestRun?.reopenedAt)) {
    return l(
      "This period was reopened, so readiness should be reviewed before closing again.",
      "Bu donem yeniden acildi; tekrar kapatmadan once hazirlik yeniden gozden gecirilmelidir."
    );
  }
  return l(
    "Review readiness inputs first, then close the period once the gate is clear.",
    "Once hazirlik girdilerini gozden gecirin, sonra kapi temizlenince donemi kapatin."
  );
}

function resolveSupportingText({
  selectedBookLabel,
  selectedPeriodLabel,
  workflowGateBlock,
  fxGateBlock,
  latestRun,
}) {
  if (normalizeText(workflowGateBlock?.message)) {
    return normalizeText(workflowGateBlock.message);
  }
  if (normalizeText(fxGateBlock?.message)) {
    return normalizeText(fxGateBlock.message);
  }
  const selectionParts = [normalizeText(selectedBookLabel), normalizeText(selectedPeriodLabel)].filter(Boolean);
  if (selectionParts.length > 0) {
    return selectionParts.join(" | ");
  }
  if (normalizeText(latestRun?.note)) {
    return normalizeText(latestRun.note);
  }
  return "";
}

function resolveCurrentStepLabel(stage, l) {
  if (stage === "READINESS_BLOCKED") {
    return l("Readiness review", "Hazirlik incelemesi");
  }
  if (stage === "CLOSE_PENDING_APPROVAL" || stage === "CLOSE_IN_PROGRESS" || stage === "CLOSE_RETRY") {
    return l("Approve and close", "Onayla ve kapat");
  }
  if (stage === "CLOSED") {
    return l("Closed", "Kapandi");
  }
  return l("Review readiness", "Hazirligi incele");
}

function resolveEligibleActorSummary(stage, requiredPackageLabel, l) {
  if (!requiredPackageLabel) {
    return "";
  }
  if (stage === "READINESS_BLOCKED" || stage === "READINESS_REVIEW") {
    return l(
      `Users assigned ${requiredPackageLabel} at Legal Entity scope can review readiness inputs before close authority is used.`,
      `Legal Entity kapsaminda ${requiredPackageLabel} atanan kullanicilar, kapanis yetkisi kullanilmadan once hazirlik girdilerini gozden gecirebilir.`
    );
  }
  return l(
    `Users assigned ${requiredPackageLabel} at Legal Entity scope can complete the final period close action.`,
    `Legal Entity kapsaminda ${requiredPackageLabel} atanan kullanicilar son donem kapanisi aksiyonunu tamamlayabilir.`
  );
}

function buildUserCapabilityLines({
  stage,
  canClosePeriod,
  canReadTrialBalance,
  canReadJournals,
  canOverrideCashFxRevaluation,
  closeButtonDisabledReason,
  workflowGateBlock,
  latestRun,
  l,
}) {
  const lines = [];

  if (!canClosePeriod) {
    lines.push(
      canReadTrialBalance || canReadJournals
        ? l(
            "You can inspect readiness inputs on this workbench, but you cannot close the period from your current authority.",
            "Bu ekranda hazirlik girdilerini inceleyebilirsiniz, ancak mevcut yetkinizle donemi kapatamazsiniz."
          )
        : l(
            "You cannot close this period from your current role mix.",
            "Mevcut rol karisiminizle bu donemi kapatamazsiniz."
          )
    );
    return lines;
  }

  if (closeButtonDisabledReason) {
    lines.push(
      l(
        `The close button is disabled because ${closeButtonDisabledReason}`,
        `Kapat butonu su nedenle devre disi: ${closeButtonDisabledReason}`
      )
    );
  }

  if (stage === "READINESS_BLOCKED") {
    lines.push(
      canOverrideCashFxRevaluation
        ? l(
            "You have close authority, but the cash FX gate must be satisfied or explicitly overridden before close can continue.",
            "Kapanis yetkiniz var, ancak kapanis devam etmeden once nakit kur kapisi ya saglanmali ya da acikca override edilmelidir."
          )
        : l(
            "You have close authority, but the cash FX gate must be satisfied before close can continue.",
            "Kapanis yetkiniz var, ancak kapanis devam etmeden once nakit kur kapisi saglanmalidir."
          )
    );
    return lines;
  }

  if (stage === "CLOSE_PENDING_APPROVAL") {
    const errorCode = normalizeText(workflowGateBlock?.code).toUpperCase();
    if (errorCode === "WORKFLOW_NOT_ASSIGNED") {
      lines.push(
        l(
          "You have close authority, but no active workflow assignment is configured for this scope.",
          "Kapanis yetkiniz var, ancak bu kapsam icin aktif workflow atamasi yok."
        )
      );
    } else if (errorCode === "APPROVAL_INSTANCE_REJECTED") {
      lines.push(
        l(
          "You have close authority, but the workflow instance was rejected and must be corrected before close can finish.",
          "Kapanis yetkiniz var, ancak workflow instance reddedildi; kapanis bitmeden once duzeltilmelidir."
        )
      );
    } else {
      lines.push(
        l(
          "You have close authority, but workflow approval is still pending for this period close run.",
          "Kapanis yetkiniz var, ancak bu donem kapanis calismasi icin workflow onayi hala beklemede."
        )
      );
    }
    return lines;
  }

  if (stage === "CLOSED") {
    lines.push(
      l(
        "This period is already closed. Reopen it before running another close cycle.",
        "Bu donem zaten kapali. Yeni bir kapanis dongusu calistirmadan once yeniden acin."
      )
    );
    return lines;
  }

  if (stage === "CLOSE_IN_PROGRESS") {
    lines.push(
      l(
        "You have close authority. The current run is already in progress for this period.",
        "Kapanis yetkiniz var. Mevcut calisma bu donem icin zaten suruyor."
      )
    );
    return lines;
  }

  if (stage === "CLOSE_RETRY") {
    lines.push(
      l(
        "You can rerun period close after checking the readiness inputs and the failed run context.",
        "Hazirlik girdilerini ve basarisiz calisma baglamini kontrol ettikten sonra donem kapanisini tekrar calistirabilirsiniz."
      )
    );
    return lines;
  }

  lines.push(
    l(
      "You can review readiness inputs and then run period close from this screen.",
      "Hazirlik girdilerini inceleyip sonra donem kapanisini bu ekrandan calistirabilirsiniz."
    )
  );
  if (normalizeText(latestRun?.status).toUpperCase() === "REOPENED") {
    lines.push(
      l(
        "The latest run was reopened, so the readiness view should be checked again before closing.",
        "En son calisma yeniden acildi; bu nedenle kapatmadan once hazirlik gorunumu tekrar kontrol edilmelidir."
      )
    );
  }
  return lines;
}

function buildHistoryItems(periodCloseRuns, l) {
  return (Array.isArray(periodCloseRuns) ? periodCloseRuns : []).slice(0, 5).map((row) => {
    const status = normalizeText(row?.status).toUpperCase();
    const title =
      status === "COMPLETED"
        ? l("Close run completed", "Kapanis calismasi tamamlandi")
        : status === "REOPENED"
          ? l("Close run reopened", "Kapanis calismasi yeniden acildi")
          : status === "FAILED"
            ? l("Close run failed", "Kapanis calismasi basarisiz")
            : l("Close run started", "Kapanis calismasi basladi");
    const eventAt =
      normalizeText(row?.completedAt) ||
      normalizeText(row?.reopenedAt) ||
      normalizeText(row?.startedAt);
    const summaryParts = [
      `Run #${normalizeText(row?.id) || "?"}`,
      normalizeText(row?.status) || "-",
      formatCloseStatusLabel(row?.closeStatus, l),
    ];
    if (eventAt) {
      summaryParts.push(eventAt);
    }
    return {
      key: String(row?.id || `${status}-${eventAt}`),
      title,
      summary: summaryParts.join(" | "),
      note: normalizeText(row?.note),
    };
  });
}

/**
 * Returns the close-button disabled reason for the current period-close selection.
 */
export function buildPeriodCloseRunDisabledReason({
  canClosePeriod,
  bookId,
  fiscalPeriodId,
  saving = "",
  l = (en) => en,
}) {
  if (normalizeText(saving) === "periodCloseRun") {
    return l("a close run is already being executed", "bir kapanis calismasi zaten yurutuluyor");
  }
  if (!canClosePeriod) {
    return l(
      "you do not have Period Close / Approve & Close authority on this screen",
      "bu ekranda Period Close / Approve & Close yetkiniz yok"
    );
  }
  if (!normalizeText(bookId) || !normalizeText(fiscalPeriodId)) {
    return l(
      "select a book and fiscal period first",
      "once bir defter ve mali donem secin"
    );
  }
  return "";
}

/**
 * Builds the shared runtime explainability model for the period-close workbench.
 */
export function buildPeriodCloseRuntimeExplainabilityModel({
  selectedBookLabel = "",
  selectedPeriodLabel = "",
  requestedCloseStatus = "",
  latestRun = null,
  periodCloseRuns = [],
  workflowGateBlock = null,
  fxGateBlock = null,
  canClosePeriod = false,
  canReadTrialBalance = false,
  canReadJournals = false,
  canOverrideCashFxRevaluation = false,
  closeButtonDisabledReason = "",
  l = (en) => en,
}) {
  const hasSelection = normalizeText(selectedBookLabel) && normalizeText(selectedPeriodLabel);
  if (!hasSelection && !latestRun && !workflowGateBlock && !fxGateBlock) {
    return null;
  }

  const stage = resolveCurrentStage({
    latestRun,
    workflowGateBlock,
    fxGateBlock,
  });
  const requiredPackageCode = resolveRequiredPackageCode(stage);
  const requiredPackageEntry = getWorkflowPackageCatalogEntry(requiredPackageCode);
  const requiredPackageLabel = normalizeText(requiredPackageEntry?.displayName);
  const eligibleRoleLabels = buildEligibleRoleLabels(requiredPackageCode);
  const requestedCloseStatusLabel = formatCloseStatusLabel(requestedCloseStatus, l);
  const technicalItems = [];

  if (normalizeText(latestRun?.id)) {
    technicalItems.push({
      label: l("Latest run", "Son calisma"),
      value: `#${normalizeText(latestRun.id)}`,
    });
  }
  if (normalizeText(latestRun?.status)) {
    technicalItems.push({
      label: l("Run status", "Calisma durumu"),
      value: normalizeText(latestRun.status),
    });
  }
  if (normalizeText(latestRun?.closeStatus)) {
    technicalItems.push({
      label: l("Close target", "Kapanis hedefi"),
      value: normalizeText(latestRun.closeStatus),
    });
  }
  if (normalizeText(workflowGateBlock?.details?.instance?.id)) {
    technicalItems.push({
      label: l("Workflow instance", "Workflow instance"),
      value: String(workflowGateBlock.details.instance.id),
    });
  }
  if (normalizeText(workflowGateBlock?.requestId) || normalizeText(fxGateBlock?.requestId)) {
    technicalItems.push({
      label: l("Request id", "Istek id"),
      value: normalizeText(workflowGateBlock?.requestId || fxGateBlock?.requestId),
    });
  }

  return {
    tone: resolveTone(stage),
    badgeLabel: resolveBadgeLabel(stage, workflowGateBlock, l),
    headline: resolveHeadline(stage, workflowGateBlock, fxGateBlock, latestRun, l),
    supportingText: resolveSupportingText({
      selectedBookLabel,
      selectedPeriodLabel,
      workflowGateBlock,
      fxGateBlock,
      latestRun,
    }),
    currentStepLabel: resolveCurrentStepLabel(stage, l),
    requiredPackageLabel,
    requiredScopeLabel: l("Legal Entity", "Tuzel Kisilik"),
    eligibleActorSummary: resolveEligibleActorSummary(stage, requiredPackageLabel, l),
    eligibleRoleLabels,
    userCapabilityLines: buildUserCapabilityLines({
      stage,
      canClosePeriod,
      canReadTrialBalance,
      canReadJournals,
      canOverrideCashFxRevaluation,
      closeButtonDisabledReason,
      workflowGateBlock,
      latestRun,
      l,
    }),
    noteItems: [
      {
        label: l("Readiness vs close", "Hazirlik ve kapanis ayrimi"),
        value:
          stage === "READINESS_BLOCKED" || stage === "READINESS_REVIEW"
            ? l(
                "Readiness review stays separate from the final close action. This surface shows both stages explicitly.",
                "Hazirlik incelemesi, nihai kapanis aksiyonundan ayridir. Bu yuzey iki asamayi da acikca gosterir."
              )
            : l(
                "The current runtime bridge still uses gl.period.close for final close authority while the package-first model is rolling out.",
                "Paket-oncelikli model yayilirken mevcut runtime bridge, nihai kapanis yetkisi icin hala gl.period.close kullanir."
              ),
      },
      {
        label: l("Current selection", "Mevcut secim"),
        value: [normalizeText(selectedBookLabel), normalizeText(selectedPeriodLabel)]
          .filter(Boolean)
          .join(" | "),
      },
      {
        label: l("Requested close target", "Istenen kapanis hedefi"),
        value: requestedCloseStatusLabel,
      },
    ].filter((item) => normalizeText(item?.value)),
    historyItems: buildHistoryItems(periodCloseRuns, l),
    technicalItems,
  };
}
