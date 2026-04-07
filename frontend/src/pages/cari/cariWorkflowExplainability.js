import {
  normalizeText,
  normalizeWorkflowGateState,
} from "./cariDocumentsPageHelpers.js";

const POSTED_DOCUMENT_STATUSES = new Set(["POSTED", "PARTIALLY_SETTLED", "SETTLED"]);

function translateWorkflowScopeLabel(scopeType, fallbackLabel, l) {
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
  return normalizeText(fallbackLabel);
}

function resolveWorkflowCurrentScopeLabel(gate, l) {
  return translateWorkflowScopeLabel(
    gate?.currentStageScopeType,
    gate?.currentStageScopeLabel || gate?.assignmentScopeLabel,
    l
  );
}

function resolveWorkflowAssignmentScopeLabel(gate, l) {
  return translateWorkflowScopeLabel(
    gate?.assignmentScopeType,
    gate?.assignmentScopeLabel,
    l
  );
}

function resolveWorkflowNextActionLabel(gate, l) {
  const explicitLabel = normalizeText(gate?.nextActionLabel);
  const nextActionCode = normalizeText(gate?.nextActionCode).toUpperCase();
  const nextActorType = normalizeText(gate?.nextActorType).toUpperCase();
  if (nextActionCode === "APPROVE") {
    const nextScopeLabel = translateWorkflowScopeLabel(nextActorType, explicitLabel, l);
    return nextScopeLabel
      ? l(`${nextScopeLabel} approval`, `${nextScopeLabel} onayi`)
      : explicitLabel;
  }
  if (nextActionCode === "POST") {
    const postScopeLabel =
      resolveWorkflowCurrentScopeLabel(gate, l) ||
      resolveWorkflowAssignmentScopeLabel(gate, l);
    return postScopeLabel
      ? l(`${postScopeLabel} posting`, `${postScopeLabel} kaydi`)
      : explicitLabel;
  }
  return explicitLabel;
}

function resolveWorkflowApprovalAuthorityLabel(gate, currentScopeLabel, l) {
  const permissionCode = normalizeText(gate?.effectiveApprovalPermissionCode);
  const explicitLabel = normalizeText(gate?.effectiveApprovalPermissionLabel);
  if (permissionCode === "approvals.requests.approve" && currentScopeLabel) {
    return l(
      `AP approval at ${currentScopeLabel} scope`,
      `${currentScopeLabel} kapsaminda AP onayi`
    );
  }
  return explicitLabel || permissionCode;
}

function appendWorkflowItem(items, label, value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return;
  }
  if (items.some((item) => item.label === label && item.value === normalizedValue)) {
    return;
  }
  items.push({ label, value: normalizedValue });
}

function buildWorkflowSurfaceState(row, l) {
  const gate = row?.workflowGate || null;
  const gateState = normalizeWorkflowGateState(gate?.state);
  const documentStatus = normalizeText(row?.status).toUpperCase();
  const documentDirection = normalizeText(row?.direction).toUpperCase();
  const workflowGoverned = Boolean(gate?.workflowGoverned);
  const waitingForSummary = normalizeText(gate?.waitingForSummary);
  const blockingReasonDetail = normalizeText(gate?.blockingReasonDetail);
  const latestDecisionComment = normalizeText(
    gate?.latestDecisionComment || row?.returnReason || row?.return_reason
  );
  const gateMessage = normalizeText(gate?.message);

  if (POSTED_DOCUMENT_STATUSES.has(documentStatus)) {
    return {
      stage: "POSTED",
      badgeLabel: l("Posted", "Kaydedildi"),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
      chipClass: "border-emerald-200 bg-white/70 text-emerald-800",
      headline: l("Posted to ledger", "Muhasebeye kaydedildi"),
      supportingText: workflowGoverned
        ? l(
            "Workflow approval was completed before posting.",
            "Workflow onayi kayit oncesinde tamamlandi."
          )
        : l(
            "This document did not require workflow approval.",
            "Bu belge icin workflow onayi gerekmedi."
          ),
      latestDecisionComment,
    };
  }

  if (documentStatus === "REVERSED") {
    return {
      stage: "REVERSED",
      badgeLabel: l("Reversed", "Ters kayit"),
      toneClass: "border-slate-200 bg-slate-100 text-slate-900",
      chipClass: "border-slate-300 bg-white/70 text-slate-700",
      headline: l("Reversed after posting", "Kayit sonrasinda terslendi"),
      supportingText: workflowGoverned
        ? l(
            "Workflow approval had already completed before reversal.",
            "Workflow onayi ters kayit oncesinde tamamlanmisti."
          )
        : "",
      latestDecisionComment,
    };
  }

  if (documentStatus === "CANCELLED") {
    return {
      stage: "CANCELLED",
      badgeLabel: l("Cancelled", "Iptal"),
      toneClass: "border-slate-200 bg-slate-50 text-slate-800",
      chipClass: "border-slate-300 bg-white/70 text-slate-700",
      headline: l("Cancelled before completion", "Tamamlanmadan iptal edildi"),
      supportingText: gateMessage,
      latestDecisionComment,
    };
  }

  if (!workflowGoverned) {
    const isApDocument = documentDirection === "AP";
    return {
      stage: "DIRECT_POST",
      badgeLabel: isApDocument
        ? l("Direct post", "Dogrudan kayit")
        : l("No workflow", "Workflow yok"),
      toneClass: "border-slate-200 bg-slate-50 text-slate-800",
      chipClass: "border-slate-300 bg-white/70 text-slate-700",
      headline: isApDocument
        ? l("Direct post without workflow", "Workflow olmadan dogrudan kayit")
        : l("No workflow required", "Workflow gerekmiyor"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        (isApDocument
          ? l(
              "No active workflow assignment is configured for this document scope.",
              "Bu belge kapsami icin aktif workflow atamasi tanimli degil."
            )
          : l(
              "This document does not use workflow approval.",
              "Bu belge workflow onayi kullanmaz."
            )),
      latestDecisionComment,
    };
  }

  if (documentStatus === "RETURNED" || gateState === "RETURNED") {
    return {
      stage: "RETURNED",
      badgeLabel: l("Returned", "Iade"),
      toneClass: "border-amber-200 bg-amber-50 text-amber-950",
      chipClass: "border-amber-200 bg-white/80 text-amber-800",
      headline:
        waitingForSummary || l("Returned for correction", "Duzeltme icin iade edildi"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        l(
          "Update the document, then resubmit it for approval.",
          "Belgeyi guncelleyip yeniden onaya gonderin."
        ),
      latestDecisionComment,
    };
  }

  if (documentStatus === "APPROVED" || gateState === "APPROVED") {
    return {
      stage: "APPROVED",
      badgeLabel: l("Ready to post", "Kayda hazir"),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
      chipClass: "border-emerald-200 bg-white/80 text-emerald-800",
      headline: waitingForSummary || l("Workflow approval is complete", "Workflow onayi tamam"),
      supportingText:
        gateMessage || l("Posting authority may act now.", "Kayit yetkisi artik islem yapabilir."),
      latestDecisionComment,
    };
  }

  if (documentStatus === "SUBMITTED" || gateState === "PENDING") {
    return {
      stage: "PENDING",
      badgeLabel: l("Pending approval", "Onay bekleniyor"),
      toneClass: "border-sky-200 bg-sky-50 text-sky-950",
      chipClass: "border-sky-200 bg-white/80 text-sky-800",
      headline: waitingForSummary || l("Waiting for approval", "Onay bekleniyor"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        l(
          "Workflow approval is still pending for this document.",
          "Bu belge icin workflow onayi halen beklemede."
        ),
      latestDecisionComment,
    };
  }

  return {
    stage: "BLOCKED",
    badgeLabel: l("Needs submission", "Gonderim gerekli"),
    toneClass: "border-rose-200 bg-rose-50 text-rose-950",
    chipClass: "border-rose-200 bg-white/80 text-rose-800",
    headline: waitingForSummary || l("Waiting for submission", "Gonderim bekleniyor"),
    supportingText:
      blockingReasonDetail ||
      gateMessage ||
      l(
        "Submit the document before workflow approval can begin.",
        "Workflow onayi baslamadan once belgeyi gonderin."
      ),
    latestDecisionComment,
  };
}

/**
 * Builds the workflow explanation model for the detail page card.
 */
export function buildCariWorkflowDetailCardModel(row, l) {
  const gate = row?.workflowGate || null;
  if (!gate) {
    return null;
  }

  const surfaceState = buildWorkflowSurfaceState(row, l);
  const currentScopeLabel = resolveWorkflowCurrentScopeLabel(gate, l);
  const assignmentScopeLabel = resolveWorkflowAssignmentScopeLabel(gate, l);
  const nextActionLabel = resolveWorkflowNextActionLabel(gate, l);
  const approvalAuthorityLabel = resolveWorkflowApprovalAuthorityLabel(
    gate,
    currentScopeLabel,
    l
  );
  const factItems = [];
  const noteItems = [];
  const technicalItems = [];
  const showProgress =
    Number(gate?.currentStepNo) > 0 &&
    Number(gate?.totalSteps) > 0 &&
    surfaceState.stage !== "POSTED" &&
    surfaceState.stage !== "REVERSED" &&
    surfaceState.stage !== "CANCELLED";

  if (showProgress) {
    appendWorkflowItem(
      factItems,
      l("Current step", "Guncel adim"),
      l(
        `Step ${gate.currentStepNo} of ${gate.totalSteps}`,
        `${gate.totalSteps} adimdan ${gate.currentStepNo}. adim`
      )
    );
  }
  if (currentScopeLabel && surfaceState.stage !== "DIRECT_POST") {
    appendWorkflowItem(
      factItems,
      l("Active scope", "Aktif kapsam"),
      currentScopeLabel
    );
  }
  if (nextActionLabel && surfaceState.stage !== "POSTED" && surfaceState.stage !== "REVERSED") {
    appendWorkflowItem(
      factItems,
      l("Next action", "Sonraki islem"),
      nextActionLabel
    );
  }
  if (
    assignmentScopeLabel &&
    assignmentScopeLabel !== currentScopeLabel &&
    surfaceState.stage !== "DIRECT_POST"
  ) {
    appendWorkflowItem(
      factItems,
      l("Assignment scope", "Atama kapsami"),
      assignmentScopeLabel
    );
  }

  if (surfaceState.stage === "RETURNED") {
    appendWorkflowItem(
      noteItems,
      l("Return reason", "Iade nedeni"),
      surfaceState.latestDecisionComment ||
        l("No return reason recorded.", "Iade nedeni kayitli degil.")
    );
  } else if (surfaceState.latestDecisionComment) {
    appendWorkflowItem(
      noteItems,
      l("Latest review note", "Son inceleme notu"),
      surfaceState.latestDecisionComment
    );
  }

  if (approvalAuthorityLabel && surfaceState.stage !== "DIRECT_POST") {
    appendWorkflowItem(
      technicalItems,
      l("Required authority", "Gerekli yetki"),
      approvalAuthorityLabel
    );
  }
  if (normalizeText(gate?.effectiveApprovalPermissionCode) && surfaceState.stage !== "DIRECT_POST") {
    appendWorkflowItem(
      technicalItems,
      l("Technical permission", "Teknik yetki"),
      gate.effectiveApprovalPermissionCode
    );
  }
  if (assignmentScopeLabel) {
    appendWorkflowItem(
      technicalItems,
      l("Workflow assignment", "Workflow atamasi"),
      assignmentScopeLabel
    );
  }
  if (Number(gate?.workflowInstanceId) > 0) {
    appendWorkflowItem(
      technicalItems,
      "workflowInstanceId",
      `#${gate.workflowInstanceId}`
    );
  }

  return {
    ...surfaceState,
    factItems,
    noteItems,
    technicalItems,
  };
}

/**
 * Builds the compact workflow summary model for list rows.
 */
export function buildCariWorkflowListSummaryModel(row, l) {
  const gate = row?.workflowGate || null;
  if (!gate) {
    return null;
  }

  const surfaceState = buildWorkflowSurfaceState(row, l);
  const currentScopeLabel = resolveWorkflowCurrentScopeLabel(gate, l);
  const nextActionLabel = resolveWorkflowNextActionLabel(gate, l);
  const summaryParts = [];

  if (
    Number(gate?.currentStepNo) > 0 &&
    Number(gate?.totalSteps) > 0 &&
    surfaceState.stage !== "POSTED" &&
    surfaceState.stage !== "REVERSED" &&
    surfaceState.stage !== "CANCELLED"
  ) {
    summaryParts.push(
      l(
        `Step ${gate.currentStepNo} of ${gate.totalSteps}`,
        `${gate.totalSteps} adimdan ${gate.currentStepNo}. adim`
      )
    );
  }

  if (
    currentScopeLabel &&
    (surfaceState.stage === "PENDING" || surfaceState.stage === "APPROVED")
  ) {
    summaryParts.push(currentScopeLabel);
  }

  if (surfaceState.stage === "RETURNED" && surfaceState.latestDecisionComment) {
    summaryParts.push(surfaceState.latestDecisionComment);
  } else if (
    nextActionLabel &&
    surfaceState.stage !== "POSTED" &&
    surfaceState.stage !== "REVERSED" &&
    surfaceState.stage !== "CANCELLED"
  ) {
    summaryParts.push(
      `${l("Next", "Sonraki")}: ${nextActionLabel}`
    );
  } else if (surfaceState.supportingText) {
    summaryParts.push(surfaceState.supportingText);
  }

  return {
    badgeLabel: surfaceState.badgeLabel,
    toneClass: surfaceState.chipClass,
    headline: surfaceState.headline,
    detail: summaryParts.join(" | "),
  };
}
