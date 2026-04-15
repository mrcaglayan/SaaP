import {
  getWorkflowPackageCatalogEntry,
} from "./security/roleCatalog.js";

const PREPARATION_STATUSES = new Set([
  "NOT_OPENED",
  "OPEN",
  "IN_PROGRESS",
  "RETURNED",
  "REOPENED",
]);

const ACTION_HISTORY_LABELS = Object.freeze({
  "ouclose.submit": {
    title: "Submitted",
    noteFallback: "Submitted into review.",
  },
  "ouclose.return": {
    title: "Returned",
    noteFallback: "Returned for correction.",
  },
  "ouclose.approve": {
    title: "Approved",
    noteFallback: "Approved for final lock.",
  },
  "ouclose.lock": {
    title: "Locked",
    noteFallback: "Locked after approval.",
  },
});

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

function formatPackContentScopeLabel(pack, l) {
  if (normalizeText(pack?.closeScopeType).toUpperCase() === "OPERATING_UNIT") {
    const code = normalizeText(pack?.operatingUnitCode);
    const name = normalizeText(pack?.operatingUnitName);
    return code && name ? `${code} - ${name}` : code || name || l("Operating Unit", "Operasyon Birimi");
  }
  return l("HQ / Central", "Merkez / HQ");
}

function resolveCurrentPackageCode(pack, reviewGate) {
  const currentStatus = normalizeText(reviewGate?.currentStatus || pack?.status).toUpperCase();
  if (currentStatus === "LOCKED") {
    return "";
  }
  if (currentStatus === "APPROVED") {
    return "PKG-LC-APPROVE-LOCK";
  }
  if (currentStatus === "READY_FOR_REVIEW") {
    return "PKG-LC-REVIEW";
  }
  if (PREPARATION_STATUSES.has(currentStatus)) {
    return "PKG-LC-PREPARE";
  }
  return "";
}

function resolveStageBadgeLabel(currentStatus, workflowGate, l) {
  if (currentStatus === "LOCKED") {
    return l("Locked", "Kilitli");
  }
  if (currentStatus === "APPROVED") {
    return l("Approved", "Onayli");
  }
  if (currentStatus === "READY_FOR_REVIEW" && workflowGate?.required && !workflowGate?.approved) {
    return l("Workflow approval pending", "Workflow onayi bekliyor");
  }
  if (currentStatus === "READY_FOR_REVIEW") {
    return l("Review stage", "Inceleme asamasi");
  }
  if (currentStatus === "RETURNED") {
    return l("Returned for correction", "Duzeltme icin iade");
  }
  if (currentStatus === "REOPENED") {
    return l("Reopened", "Yeniden acildi");
  }
  return l("Preparation", "Hazirlik");
}

function resolveTone(currentStatus, reviewGate) {
  if (currentStatus === "LOCKED") {
    return "emerald";
  }
  if (currentStatus === "APPROVED") {
    return "blue";
  }
  if (
    currentStatus === "RETURNED" ||
    currentStatus === "REOPENED" ||
    Number(reviewGate?.blockerCount || 0) > 0 ||
    (reviewGate?.workflowGate?.required && !reviewGate?.workflowGate?.approved)
  ) {
    return "amber";
  }
  return "blue";
}

function resolveCurrentStepLabel(currentStatus, requiredPackageLabel, l) {
  if (currentStatus === "LOCKED") {
    return l("Locked", "Kilitli");
  }
  if (currentStatus === "APPROVED") {
    return l("Final lock", "Son kilit");
  }
  if (currentStatus === "READY_FOR_REVIEW") {
    return l("Review and approval", "Inceleme ve onay");
  }
  if (currentStatus === "RETURNED" || currentStatus === "REOPENED") {
    return l("Correction and resubmission", "Duzeltme ve yeniden gonderim");
  }
  return requiredPackageLabel || l("Prepare and submit", "Hazirla ve gonder");
}

function resolveHeadline(currentStatus, reviewGate, l) {
  if (currentStatus === "LOCKED") {
    return l(
      "This local close pack is locked.",
      "Bu yerel kapanis paketi kilitlidir."
    );
  }
  if (currentStatus === "APPROVED") {
    return l(
      "This local close pack is approved and waiting for final lock.",
      "Bu yerel kapanis paketi onayli ve son kilidi bekliyor."
    );
  }
  if (currentStatus === "RETURNED" || currentStatus === "REOPENED") {
    return l(
      "This local close pack must be corrected and resubmitted before review can resume.",
      "Bu yerel kapanis paketi, inceleme yeniden baslamadan once duzeltilip tekrar gonderilmelidir."
    );
  }
  if (currentStatus === "READY_FOR_REVIEW" && reviewGate?.workflowGate?.required && !reviewGate?.workflowGate?.approved) {
    return l(
      "This local close pack is in review, but workflow approval still blocks final approval.",
      "Bu yerel kapanis paketi incelemede, ancak workflow onayi nihai onayi hala engelliyor."
    );
  }
  if (currentStatus === "READY_FOR_REVIEW") {
    return l(
      "This local close pack is waiting for review or approval actions.",
      "Bu yerel kapanis paketi inceleme veya onay aksiyonlarini bekliyor."
    );
  }
  return l(
    "This local close pack is still in preparation and has not reached review yet.",
    "Bu yerel kapanis paketi hala hazirlik asamasinda ve henuz incelemeye ulasmadi."
  );
}

function resolveSupportingText(pack, reviewGate, requiredScopeLabel, l) {
  const workflowMessage = normalizeText(reviewGate?.workflowGate?.message);
  const packContentScopeLabel = formatPackContentScopeLabel(pack, l);
  if (workflowMessage) {
    return workflowMessage;
  }
  if (
    packContentScopeLabel &&
    requiredScopeLabel &&
    packContentScopeLabel !== requiredScopeLabel
  ) {
    // The pack can be content-scoped to an operating unit while governance still
    // resolves against the supervising legal-entity package boundary.
    return l(
      `Pack content stays at ${packContentScopeLabel}, while this gate is evaluated at ${requiredScopeLabel} scope.`,
      `Paket icerigi ${packContentScopeLabel} kapsaminda kalir; ancak bu kapi ${requiredScopeLabel} kapsaminda degerlendirilir.`
    );
  }
  return "";
}

function resolveWorkflowStatusLabel(workflowGate, l) {
  if (!workflowGate?.required) {
    return l("Not required", "Gerekli degil");
  }
  if (workflowGate?.approved) {
    return l("Approved", "Onayli");
  }
  return normalizeText(workflowGate?.workflowInstanceStatus) || l("Pending", "Beklemede");
}

function buildEligibleActorSummary(requiredPackageCode, requiredPackageLabel, requiredScopeLabel, currentStatus, l) {
  if (!requiredPackageLabel || !requiredScopeLabel) {
    return "";
  }
  if (requiredPackageCode === "PKG-LC-PREPARE") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can prepare and submit this pack.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu paketi hazirlayip gonderebilir.`
    );
  }
  if (requiredPackageCode === "PKG-LC-REVIEW") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can review or return this pack.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu paketi inceleyebilir veya iade edebilir.`
    );
  }
  if (requiredPackageCode === "PKG-LC-APPROVE-LOCK") {
    return currentStatus === "APPROVED"
      ? l(
          `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can lock this pack now.`,
          `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu paketi simdi kilitleyebilir.`
        )
      : l(
          `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can approve and lock this pack after the earlier gates clear.`,
          `Daha onceki kapilar temizlendikten sonra ${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu paketi onaylayip kilitleyebilir.`
        );
  }
  return "";
}

function findBlockingMessages(actionKey, reviewGate) {
  const blockers = Array.isArray(reviewGate?.blockers) ? reviewGate.blockers : [];
  return blockers
    .filter((row) => Array.isArray(row?.appliesToActions) && row.appliesToActions.includes(actionKey))
    .map((row) => normalizeText(row?.message))
    .filter(Boolean);
}

/**
 * Returns the current block reason for one local-close action button.
 */
export function buildLocalCloseActionDisabledReason({ actionKey, reviewGate, l }) {
  const normalizedActionKey = normalizeText(actionKey).toLowerCase();
  const actionAvailability = reviewGate?.actionAvailability?.[normalizedActionKey];
  if (actionAvailability?.allowed) {
    return "";
  }

  const blockingMessages = findBlockingMessages(normalizedActionKey, reviewGate);
  if (blockingMessages.length > 0) {
    return blockingMessages.join(" ");
  }

  const currentStatus = normalizeText(reviewGate?.currentStatus).toUpperCase();
  if (normalizedActionKey === "submit") {
    return PREPARATION_STATUSES.has(currentStatus)
      ? l(
          "This pack still has open blockers before it can be submitted.",
          "Bu paket gonderilmeden once hala acik blokajlar tasiyor."
        )
      : l(
          "This pack is already past the submit stage.",
          "Bu paket zaten gonderim asamasini gecti."
        );
  }
  if (normalizedActionKey === "return") {
    return l(
      "Only packs in review can be returned for correction.",
      "Yalnizca incelemedeki paketler duzeltme icin iade edilebilir."
    );
  }
  if (normalizedActionKey === "approve") {
    return currentStatus !== "READY_FOR_REVIEW"
      ? l(
          "Only packs in review can be approved.",
          "Yalnizca incelemedeki paketler onaylanabilir."
        )
      : l(
          "Approval is still blocked for this pack.",
          "Bu paket icin onay hala blokaj altinda."
        );
  }
  if (normalizedActionKey === "lock") {
    return currentStatus !== "APPROVED"
      ? l(
          "This pack must be approved before it can be locked.",
          "Bu paket kilitlenmeden once onaylanmalidir."
        )
      : l(
          "Lock is still blocked for this pack.",
          "Bu paket icin kilit hala blokaj altinda."
        );
  }
  return "";
}

function buildUserCapabilityLines({
  pack,
  reviewGate,
  canRead,
  canPrepare,
  canSubmit,
  canReview,
  canApprove,
  canLock,
  l,
}) {
  if (!canRead) {
    return [l("You cannot open this local close pack.", "Bu yerel kapanis paketini acamazsiniz.")];
  }

  const lines = [];
  const currentStatus = normalizeText(reviewGate?.currentStatus || pack?.status).toUpperCase();
  const submitBlockedReason = buildLocalCloseActionDisabledReason({
    actionKey: "submit",
    reviewGate,
    l,
  });
  const returnBlockedReason = buildLocalCloseActionDisabledReason({
    actionKey: "return",
    reviewGate,
    l,
  });
  const approveBlockedReason = buildLocalCloseActionDisabledReason({
    actionKey: "approve",
    reviewGate,
    l,
  });
  const lockBlockedReason = buildLocalCloseActionDisabledReason({
    actionKey: "lock",
    reviewGate,
    l,
  });

  if (PREPARATION_STATUSES.has(currentStatus)) {
    if (canSubmit && reviewGate?.actionAvailability?.submit?.allowed) {
      lines.push(l("You can submit this pack now.", "Bu paketi simdi gonderebilirsiniz."));
    } else if (canSubmit && submitBlockedReason) {
      lines.push(
        l(
          `You have submit authority, but ${submitBlockedReason}`,
          `Gonderim yetkiniz var, ancak ${submitBlockedReason}`
        )
      );
    } else if (canPrepare || canSubmit) {
      lines.push(
        l(
          "You can work on preparation, but this pack is not ready to submit yet.",
          "Hazirlik uzerinde calisabilirsiniz, ancak bu paket henuz gonderime hazir degil."
        )
      );
    } else {
      lines.push(
        l(
          "You can view this pack but cannot prepare or submit it.",
          "Bu paketi goruntuleyebilirsiniz ancak hazirlayamaz veya gonderemezsiniz."
        )
      );
    }
  } else if (currentStatus === "READY_FOR_REVIEW") {
    if (canReview && reviewGate?.actionAvailability?.return?.allowed) {
      lines.push(
        l(
          "You can return this pack for correction.",
          "Bu paketi duzeltme icin iade edebilirsiniz."
        )
      );
    } else if (canReview && returnBlockedReason) {
      lines.push(returnBlockedReason);
    }

    if (canApprove && reviewGate?.actionAvailability?.approve?.allowed) {
      lines.push(l("You can approve this pack now.", "Bu paketi simdi onaylayabilirsiniz."));
    } else if (canApprove && approveBlockedReason) {
      lines.push(
        l(
          `You have approval authority, but ${approveBlockedReason}`,
          `Onay yetkiniz var, ancak ${approveBlockedReason}`
        )
      );
    } else if (!canReview && !canApprove && !canLock) {
      lines.push(
        l(
          "You can view this pack but cannot review, approve, or lock it.",
          "Bu paketi goruntuleyebilirsiniz ancak inceleyemez, onaylayamaz veya kilitleyemezsiniz."
        )
      );
    }
  } else if (currentStatus === "APPROVED") {
    if (canLock && reviewGate?.actionAvailability?.lock?.allowed) {
      lines.push(l("You can lock this pack now.", "Bu paketi simdi kilitleyebilirsiniz."));
    } else if (canLock && lockBlockedReason) {
      lines.push(
        l(
          `You have final-lock authority, but ${lockBlockedReason}`,
          `Son kilit yetkiniz var, ancak ${lockBlockedReason}`
        )
      );
    } else {
      lines.push(
        l(
          "You can view this approved pack but cannot perform the final lock.",
          "Bu onayli paketi goruntuleyebilirsiniz ancak son kilidi gerceklestiremezsiniz."
        )
      );
    }
  } else if (currentStatus === "LOCKED") {
    lines.push(
      l(
        "You can view this locked pack. No further close-stage action is pending.",
        "Bu kilitli paketi goruntuleyebilirsiniz. Bekleyen ek kapanis asamasi aksiyonu yok."
      )
    );
  }

  return Array.from(new Set(lines.filter(Boolean)));
}

function buildHistoryItems(auditRows, l) {
  const rows = Array.isArray(auditRows) ? auditRows : [];
  return rows
    .filter((row) => ACTION_HISTORY_LABELS[normalizeText(row?.action)])
    .slice(0, 5)
    .map((row) => {
      const actionKey = normalizeText(row?.action);
      const actionMeta = ACTION_HISTORY_LABELS[actionKey];
      const actorLabel =
        normalizeText(row?.actorName) ||
        normalizeText(row?.actorEmail) ||
        normalizeText(row?.actorUserId);
      const createdAt = normalizeText(row?.createdAt);
      const summaryParts = [l(actionMeta.title, actionMeta.title)];
      if (actorLabel) {
        summaryParts.push(l(`by ${actorLabel}`, `${actorLabel} tarafindan`));
      }
      if (createdAt) {
        summaryParts.push(createdAt);
      }
      const payloadDecisionNote = normalizeText(row?.payload?.decisionNote);
      return {
        key: String(row?.auditLogId || `${actionKey}-${createdAt}`),
        title:
          actionMeta.title === "Submitted"
            ? l("Submitted", "Gonderildi")
            : actionMeta.title === "Returned"
              ? l("Returned", "Iade edildi")
              : actionMeta.title === "Approved"
                ? l("Approved", "Onaylandi")
                : actionMeta.title === "Locked"
                  ? l("Locked", "Kilitlendi")
                  : l(actionMeta.title, actionMeta.title),
        summary: summaryParts.join(" | "),
        note: payloadDecisionNote || l(actionMeta.noteFallback, actionMeta.noteFallback),
      };
    });
}

function buildStageRequirementValue(requiredPackageCode, workflowGate, l) {
  if (requiredPackageCode === "PKG-LC-PREPARE") {
    return l(
      "Prepare the working pack and resubmit it into review before later approval or lock can happen.",
      "Daha sonraki onay veya kilit once, calisma paketini hazirlayip tekrar incelemeye gonderin."
    );
  }
  if (requiredPackageCode === "PKG-LC-REVIEW") {
    return workflowGate?.required && !workflowGate?.approved
      ? l(
          "Review remains visible, but workflow approval must clear before final local-close approval can proceed.",
          "Inceleme gorunur kalir, ancak nihai yerel kapanis onayi ilerlemeden once workflow onayi temizlenmelidir."
        )
      : l(
          "Review or return this pack before the final approve-and-lock boundary can take over.",
          "Son onay-ve-kilit siniri devralmadan once bu paketi inceleyin veya iade edin."
        );
  }
  if (requiredPackageCode === "PKG-LC-APPROVE-LOCK") {
    return l(
      "The final approve-and-lock package now governs the remaining close decision.",
      "Kalan kapanis kararini artik son onay-ve-kilit paketi yonetir."
    );
  }
  return "";
}

/**
 * Builds the shared explainability model for the local-close detail page.
 */
export function buildLocalCloseRuntimeExplainabilityModel({
  pack,
  reviewGate,
  auditRows = [],
  canRead = false,
  canPrepare = false,
  canSubmit = false,
  canReview = false,
  canApprove = false,
  canLock = false,
  l = (en) => en,
}) {
  if (!pack || !reviewGate) {
    return null;
  }

  const currentStatus = normalizeText(reviewGate.currentStatus || pack.status).toUpperCase();
  const requiredPackageCode = resolveCurrentPackageCode(pack, reviewGate);
  const requiredPackageEntry = requiredPackageCode
    ? getWorkflowPackageCatalogEntry(requiredPackageCode)
    : null;
  const requiredPackageLabel = normalizeText(requiredPackageEntry?.displayName);
  const requiredScopeType = normalizeText(requiredPackageEntry?.defaultScope).toUpperCase();
  const requiredScopeLabel = translateScopeTypeLabel(requiredScopeType, l);
  const noteItems = [];
  const packContentScopeLabel = formatPackContentScopeLabel(pack, l);

  if (packContentScopeLabel) {
    noteItems.push({
      label: l("Pack content scope", "Paket icerik kapsami"),
      value: packContentScopeLabel,
    });
  }

  const stageRequirementValue = buildStageRequirementValue(requiredPackageCode, reviewGate.workflowGate, l);
  if (stageRequirementValue) {
    noteItems.push({
      label: l("Review / approve / lock requirement", "Inceleme / onay / kilit gereksinimi"),
      value: stageRequirementValue,
    });
  }

  if (normalizeText(reviewGate?.workflowGate?.message)) {
    noteItems.push({
      label: l("Workflow gate", "Workflow kapisi"),
      value: normalizeText(reviewGate.workflowGate.message),
    });
  }

  const technicalItems = [
    {
      label: l("Pack status", "Paket durumu"),
      value: currentStatus,
    },
    {
      label: l("Workflow status", "Workflow durumu"),
      value: resolveWorkflowStatusLabel(reviewGate.workflowGate, l),
    },
  ];

  const workflowInstanceId = Number(reviewGate?.workflowGate?.workflowInstanceId || 0);
  if (workflowInstanceId > 0) {
    technicalItems.push({
      label: l("Workflow instance", "Workflow instance"),
      value: String(workflowInstanceId),
    });
  }

  const blockedCodes = Array.from(
    new Set(
      ["submit", "approve", "lock"]
        .flatMap((actionKey) =>
          Array.isArray(reviewGate?.actionAvailability?.[actionKey]?.blockedByCodes)
            ? reviewGate.actionAvailability[actionKey].blockedByCodes
            : []
        )
        .filter(Boolean)
    )
  );
  if (blockedCodes.length > 0) {
    technicalItems.push({
      label: l("Blocked by codes", "Engel kodlari"),
      value: blockedCodes.join(", "),
    });
  }

  return {
    tone: resolveTone(currentStatus, reviewGate),
    badgeLabel: resolveStageBadgeLabel(currentStatus, reviewGate.workflowGate, l),
    headline: resolveHeadline(currentStatus, reviewGate, l),
    supportingText: resolveSupportingText(pack, reviewGate, requiredScopeLabel, l),
    workflowStatusLabel: resolveWorkflowStatusLabel(reviewGate.workflowGate, l),
    currentStepLabel: resolveCurrentStepLabel(currentStatus, requiredPackageLabel, l),
    requiredPackageLabel,
    requiredScopeLabel,
    eligibleActorSummary: buildEligibleActorSummary(
      requiredPackageCode,
      requiredPackageLabel,
      requiredScopeLabel,
      currentStatus,
      l
    ),
    userCapabilityLines: buildUserCapabilityLines({
      pack,
      reviewGate,
      canRead,
      canPrepare,
      canSubmit,
      canReview,
      canApprove,
      canLock,
      l,
    }),
    noteItems,
    historyItems: buildHistoryItems(auditRows, l),
    technicalItems,
  };
}
