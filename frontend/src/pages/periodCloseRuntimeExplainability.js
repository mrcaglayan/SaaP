import {
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
} from "../../../shared/periodCloseGovernance.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function translateScopeTypeLabel(scopeType, l) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  if (normalizedScopeType === "OPERATING_UNIT") {
    return l("Operating Unit", "Operasyon Birimi");
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    return l("Legal Entity", "Tuzel Kisilik");
  }
  if (normalizedScopeType === "COUNTRY") {
    return l("Country", "Ulke");
  }
  if (normalizedScopeType === "GROUP") {
    return l("Group", "Grup");
  }
  if (normalizedScopeType === "TENANT") {
    return l("Tenant", "Tenant");
  }
  return normalizedScopeType;
}

function getPeriodCloseAuthorityLabel(requiredPermissionCode, l) {
  if (requiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE) {
    return l("Review period-close readiness", "Donem kapanisi hazirligini incele");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE) {
    return l("Approve period close", "Donem kapanisini onayla");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_EXECUTE_PERMISSION_CODE) {
    return l("Execute period close", "Donem kapanisini yurut");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_REOPEN_PERMISSION_CODE) {
    return l("Reopen periods", "Donemleri yeniden ac");
  }
  return "";
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

function resolveRequiredPermissionCode(stage) {
  if (stage === "READINESS_REVIEW" || stage === "READINESS_BLOCKED") {
    return PERIOD_CLOSE_READINESS_PERMISSION_CODE;
  }
  return PERIOD_CLOSE_APPROVE_PERMISSION_CODE;
}

function resolveWorkflowAssignmentScopeType(workflowGateBlock) {
  const assignment = workflowGateBlock?.details?.assignment || null;
  if (Number(assignment?.operatingUnitId) > 0) {
    return "OPERATING_UNIT";
  }
  if (Number(assignment?.legalEntityId) > 0) {
    return "LEGAL_ENTITY";
  }
  if (Number(assignment?.countryId) > 0) {
    return "COUNTRY";
  }
  if (Number(assignment?.groupCompanyId) > 0) {
    return "GROUP";
  }
  return "";
}

function resolveCurrentRequiredPermissionCode(stage, workflowGateBlock) {
  const gatePermissionCode = normalizeText(workflowGateBlock?.details?.requiredPermissionCode);
  if (
    (stage === "CLOSE_PENDING_APPROVAL" ||
      stage === "CLOSE_IN_PROGRESS" ||
      stage === "CLOSE_RETRY") &&
    gatePermissionCode
  ) {
    return gatePermissionCode;
  }
  return resolveRequiredPermissionCode(stage);
}

function resolveCurrentRequiredScopeType(stage, workflowGateBlock) {
  const gateScopeType = normalizeText(workflowGateBlock?.details?.stageScopeType).toUpperCase();
  if (gateScopeType) {
    return gateScopeType;
  }
  if (stage === "CLOSE_PENDING_APPROVAL") {
    const assignmentScopeType = resolveWorkflowAssignmentScopeType(workflowGateBlock);
    if (assignmentScopeType) {
      return assignmentScopeType;
    }
  }
  return "LEGAL_ENTITY";
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

function resolveCurrentStepLabel(stage, requiredPermissionCode, l) {
  if (stage === "READINESS_BLOCKED") {
    return l("Readiness review", "Hazirlik incelemesi");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE) {
    return l("Review readiness", "Hazirligi incele");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE) {
    return l("Approve workflow step", "Workflow adimini onayla");
  }
  if (requiredPermissionCode === PERIOD_CLOSE_EXECUTE_PERMISSION_CODE) {
    return l("Execute close run", "Kapanis calismasini yurut");
  }
  if (stage === "CLOSE_PENDING_APPROVAL" || stage === "CLOSE_IN_PROGRESS" || stage === "CLOSE_RETRY") {
    return l("Approve workflow step", "Workflow adimini onayla");
  }
  if (stage === "CLOSED") {
    return l("Closed", "Kapandi");
  }
  return l("Review readiness", "Hazirligi incele");
}

function resolveEligibleActorSummary(
  requiredPermissionCode,
  requiredAuthorityLabel,
  requiredScopeLabel,
  l
) {
  if (!requiredAuthorityLabel || !requiredScopeLabel) {
    return "";
  }
  if (requiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE) {
    return l(
      `Users assigned ${requiredAuthorityLabel} at ${requiredScopeLabel} scope can review readiness inputs before close authority is used.`,
      `${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} atanan kullanicilar, kapanis yetkisi kullanilmadan once hazirlik girdilerini gozden gecirebilir.`
    );
  }
  if (requiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE) {
    return l(
      `Users assigned ${requiredAuthorityLabel} at ${requiredScopeLabel} scope can approve the workflow step before execution starts.`,
      `${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} atanan kullanicilar, icra baslamadan once workflow adimini onaylayabilir.`
    );
  }
  return l(
    `Users assigned ${requiredAuthorityLabel} at ${requiredScopeLabel} scope can execute the final governed period close action.`,
    `${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} atanan kullanicilar yonetilen nihai donem kapanisi aksiyonunu yurutebilir.`
  );
}

function buildUserCapabilityLines({
  stage,
  canClosePeriod,
  canReadPeriods = false,
  canReopenPeriod = false,
  canReadTrialBalance,
  canReadJournals,
  canOverrideCashFxRevaluation,
  closeButtonDisabledReason,
  workflowGateBlock,
  latestRun,
  currentRequiredPermissionCode = "",
  requiredAuthorityLabel = "",
  requiredScopeLabel = "",
  l,
}) {
  const lines = [];

  if (!canClosePeriod) {
    if (
      currentRequiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE &&
      (canReadPeriods || canReadTrialBalance || canReadJournals)
    ) {
      lines.push(
        requiredAuthorityLabel && requiredScopeLabel
          ? l(
              `This workflow is waiting for ${requiredAuthorityLabel} at ${requiredScopeLabel} scope. You can review readiness here, but final close remains separate.`,
              `Bu workflow, ${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} bekliyor. Hazirligi burada inceleyebilirsiniz, ancak nihai kapanis ayridir.`
            )
          : l(
              "This workflow is waiting for readiness review. You can review readiness here, but final close remains separate.",
              "Bu workflow hazirlik incelemesini bekliyor. Hazirligi burada inceleyebilirsiniz, ancak nihai kapanis ayridir."
            )
      );
    } else if (
      currentRequiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE &&
      (canReadPeriods || canReadTrialBalance || canReadJournals)
    ) {
      lines.push(
        requiredAuthorityLabel && requiredScopeLabel
          ? l(
              `This workflow is waiting for ${requiredAuthorityLabel} at ${requiredScopeLabel} scope. You can inspect readiness here, but execution remains separate.`,
              `Bu workflow, ${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} bekliyor. Hazirligi burada inceleyebilirsiniz, ancak icra ayridir.`
            )
          : l(
              "This workflow is waiting for approval. You can inspect readiness here, but execution remains separate.",
              "Bu workflow onay bekliyor. Hazirligi burada inceleyebilirsiniz, ancak icra ayridir."
            )
      );
    } else {
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
    }
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
          "No active workflow assignment is configured for this scope, so period close cannot complete.",
          "Bu kapsam icin aktif workflow atamasi yok; bu nedenle donem kapanisi tamamlanamaz."
        )
      );
    } else if (errorCode === "APPROVAL_INSTANCE_REJECTED") {
      lines.push(
        l(
          "The workflow instance was rejected and must be corrected before close can finish.",
          "Workflow instance reddedildi; kapanis bitmeden once duzeltilmelidir."
        )
      );
    } else if (
      currentRequiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE &&
      requiredAuthorityLabel &&
      requiredScopeLabel
    ) {
      lines.push(
        l(
          `Workflow approval is waiting for ${requiredAuthorityLabel} at ${requiredScopeLabel} scope before close can continue.`,
          `Workflow onayi, kapanis devam etmeden once ${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} bekliyor.`
        )
      );
    } else if (requiredAuthorityLabel && requiredScopeLabel) {
      lines.push(
        l(
          `Workflow approval is still pending for ${requiredAuthorityLabel} at ${requiredScopeLabel} scope.`,
          `Workflow onayi, ${requiredScopeLabel} kapsaminda ${requiredAuthorityLabel} icin hala beklemede.`
        )
      );
    } else if (currentRequiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE) {
      lines.push(
        l(
          "Workflow approval is waiting for readiness review before close can continue.",
          "Workflow onayi, kapanis devam etmeden once hazirlik incelemesini bekliyor."
        )
      );
    } else if (currentRequiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE) {
      lines.push(
        l(
          "Workflow approval is still pending before execution can continue.",
          "Icra devam etmeden once workflow onayi hala beklemede."
        )
      );
    } else {
      lines.push(
        l(
          "Workflow approval is still pending for this period close run.",
          "Bu donem kapanis calismasi icin workflow onayi hala beklemede."
        )
      );
    }
    return lines;
  }

  if (stage === "CLOSED") {
    if (canReopenPeriod) {
      lines.push(
        l(
          "This period is already closed. You have reopen authority and can reopen it before running another close cycle.",
          "Bu donem zaten kapali. Yeniden acma yetkiniz var; yeni bir kapanis dongusu calistirmadan once yeniden acabilirsiniz."
        )
      );
    } else {
      lines.push(
        l(
          `This period is already closed. You do not have reopen authority. Ask someone with ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE} permission to reopen it.`,
          `Bu donem zaten kapali. Yeniden acma yetkiniz yok. ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE} yetkisine sahip birinden yeniden acmasini isteyin.`
        )
      );
    }
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
      "you do not have period-close execution authority on this screen",
      "bu ekranda donem kapanisi icra yetkiniz yok"
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
  canReadPeriods = false,
  canReopenPeriod = false,
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
  const currentRequiredPermissionCode = resolveCurrentRequiredPermissionCode(
    stage,
    workflowGateBlock
  );
  const requiredScopeLabel = translateScopeTypeLabel(
    resolveCurrentRequiredScopeType(stage, workflowGateBlock),
    l
  );
  const requiredAuthorityLabel = getPeriodCloseAuthorityLabel(
    currentRequiredPermissionCode,
    l
  );
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
  if (Number(workflowGateBlock?.details?.currentStepNo || workflowGateBlock?.details?.instance?.currentStepNo) > 0) {
    technicalItems.push({
      label: l("Workflow step", "Workflow adimi"),
      value: String(
        Number(
          workflowGateBlock?.details?.currentStepNo ||
            workflowGateBlock?.details?.instance?.currentStepNo
        )
      ),
    });
  }
  if (normalizeText(workflowGateBlock?.details?.stageScopeType)) {
    technicalItems.push({
      label: l("Current approval scope", "Guncel onay kapsami"),
      value: translateScopeTypeLabel(workflowGateBlock.details.stageScopeType, l),
    });
  }
  if (normalizeText(workflowGateBlock?.details?.requiredPermissionCode)) {
    technicalItems.push({
      label: l("Current approval permission", "Guncel onay yetkisi"),
      value: normalizeText(workflowGateBlock.details.requiredPermissionCode),
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
    currentStepLabel: resolveCurrentStepLabel(stage, currentRequiredPermissionCode, l),
    requiredAuthorityLabel,
    requiredScopeLabel,
    eligibleActorSummary: resolveEligibleActorSummary(
      currentRequiredPermissionCode,
      requiredAuthorityLabel,
      requiredScopeLabel,
      l
    ),
    userCapabilityLines: buildUserCapabilityLines({
      stage,
      canClosePeriod,
      canReadPeriods,
      canReopenPeriod,
      canReadTrialBalance,
      canReadJournals,
      canOverrideCashFxRevaluation,
      closeButtonDisabledReason,
      workflowGateBlock,
      latestRun,
      currentRequiredPermissionCode,
      requiredAuthorityLabel,
      requiredScopeLabel,
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
                `Workflow approval uses ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE}, execution uses ${PERIOD_CLOSE_EXECUTE_PERMISSION_CODE}, and reopen stays on ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE}.`,
                `Workflow onayi ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE}, icra ${PERIOD_CLOSE_EXECUTE_PERMISSION_CODE} ve yeniden acma ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE} ile yonetilir.`
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
