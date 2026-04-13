import {
  normalizeText,
  normalizeWorkflowGateState,
} from "./cariDocumentsPageHelpers.js";
import { listBusinessRoleCatalogEntries } from "../security/roleCatalog.js";
import { formatMoneyAmount } from "../../utils/money.js";

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

function resolveWorkflowRequiredScopeType(gate) {
  return normalizeText(gate?.currentStageScopeType || gate?.assignmentScopeType).toUpperCase();
}

function normalizeApWorkflowActionCode(value) {
  const normalizedValue = normalizeText(value).toUpperCase();
  return ["DRAFT", "SUBMIT", "APPROVE", "POST"].includes(normalizedValue)
    ? normalizedValue
    : "";
}

function resolveApCurrentActionCode(gate) {
  return normalizeApWorkflowActionCode(gate?.currentActionCode);
}

function resolveApNextActionCode(gate) {
  return normalizeApWorkflowActionCode(gate?.nextActionCode);
}

function resolveApRequiredPackageCodeFromAction(actionCode) {
  if (actionCode === "DRAFT" || actionCode === "SUBMIT") {
    return "PKG-AP-DRAFT-SUBMIT";
  }
  if (actionCode === "APPROVE") {
    return "PKG-AP-APPROVE";
  }
  if (actionCode === "POST") {
    return "PKG-AP-POST";
  }
  return "";
}

function buildApActionOwnershipLabel(actionCode, scopeLabel, l) {
  if (!actionCode || !scopeLabel) {
    return "";
  }
  if (actionCode === "DRAFT") {
    return l(`${scopeLabel} draft work`, `${scopeLabel} taslak calismasi`);
  }
  if (actionCode === "SUBMIT") {
    return l(`${scopeLabel} submission`, `${scopeLabel} gonderimi`);
  }
  if (actionCode === "APPROVE") {
    return l(`${scopeLabel} approval`, `${scopeLabel} onayi`);
  }
  return l(`${scopeLabel} posting`, `${scopeLabel} kaydi`);
}

function resolveApCurrentActionLabel(gate, l) {
  const currentActionCode = resolveApCurrentActionCode(gate);
  const currentScopeLabel =
    resolveWorkflowCurrentScopeLabel(gate, l) ||
    resolveWorkflowAssignmentScopeLabel(gate, l);
  return buildApActionOwnershipLabel(currentActionCode, currentScopeLabel, l);
}

function resolveWorkflowNextActionLabel(gate, l) {
  const explicitLabel = normalizeText(gate?.nextActionLabel);
  const nextActionCode = resolveApNextActionCode(gate);
  const nextScopeLabel = translateWorkflowScopeLabel(
    gate?.nextActorType,
    explicitLabel,
    l
  );
  const explicitActionLabel = buildApActionOwnershipLabel(nextActionCode, nextScopeLabel, l);
  if (explicitActionLabel) {
    return explicitActionLabel;
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

function resolveWorkflowCurrentStepLabel(gate, surfaceState, l) {
  const currentStepNo = Number(gate?.currentStepNo || 0);
  const totalSteps = Number(gate?.totalSteps || 0);
  if (
    currentStepNo <= 0 ||
    totalSteps <= 0 ||
    surfaceState.stage === "POSTED" ||
    surfaceState.stage === "REVERSED" ||
    surfaceState.stage === "CANCELLED"
  ) {
    return "";
  }
  return l(
    `Step ${currentStepNo} of ${totalSteps}`,
    `${totalSteps} adimdan ${currentStepNo}. adim`
  );
}

function resolveApRequiredPackageCode(row, gate, surfaceState) {
  const documentDirection = normalizeText(row?.direction).toUpperCase();
  if (documentDirection !== "AP" || !gate?.workflowGoverned) {
    return "";
  }
  const explicitPackageCode = normalizeText(gate?.currentRequiredPackageCode).toUpperCase();
  if (explicitPackageCode) {
    return explicitPackageCode;
  }
  const actionPackageCode = resolveApRequiredPackageCodeFromAction(resolveApCurrentActionCode(gate));
  if (actionPackageCode) {
    return actionPackageCode;
  }
  if (surfaceState.stage === "BLOCKED" || surfaceState.stage === "RETURNED") {
    return "PKG-AP-DRAFT-SUBMIT";
  }
  if (surfaceState.stage === "PENDING") {
    return "PKG-AP-APPROVE";
  }
  if (
    surfaceState.stage === "APPROVED" ||
    surfaceState.stage === "POSTED" ||
    surfaceState.stage === "REVERSED"
  ) {
    return "PKG-AP-POST";
  }
  return "";
}

function translateApRequiredPackageLabel(packageCode, l) {
  if (packageCode === "PKG-AP-DRAFT-SUBMIT") {
    return l("AP Documents / Draft & Submit", "AP Belgeleri / Taslak ve Gonder");
  }
  if (packageCode === "PKG-AP-APPROVE") {
    return l("AP Documents / Approve", "AP Belgeleri / Onayla");
  }
  if (packageCode === "PKG-AP-POST") {
    return l("AP Documents / Post", "AP Belgeleri / Kaydet");
  }
  return "";
}

function resolveApEligibleBusinessRoleLabels(requiredPackageCode, requiredScopeType) {
  if (!requiredPackageCode || !requiredScopeType) {
    return [];
  }
  return listBusinessRoleCatalogEntries()
    .filter((entry) => entry.defaultScope === requiredScopeType)
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

function buildApCurrentGateLine(currentActionCode, requiredPackageLabel, requiredScopeLabel, l) {
  if (!currentActionCode || !requiredPackageLabel || !requiredScopeLabel) {
    return "";
  }
  if (currentActionCode === "DRAFT") {
    return l(
      `Draft work stays with ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
      `${requiredScopeLabel} kapsaminda taslak calismasi ${requiredPackageLabel} ile kalir.`
    );
  }
  if (currentActionCode === "SUBMIT") {
    return l(
      `Waiting for submission with ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} ile gonderim bekleniyor.`
    );
  }
  if (currentActionCode === "APPROVE") {
    return l(
      `Waiting for approval with ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} ile onay bekleniyor.`
    );
  }
  return l(
    `Waiting for posting with ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
    `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} ile kayit bekleniyor.`
  );
}

function resolveWorkflowEligibleActorSummary(
  surfaceState,
  currentActionCode,
  requiredPackageCode,
  requiredPackageLabel,
  requiredScopeLabel,
  l
) {
  if (surfaceState.stage === "DIRECT_POST") {
    return l(
      "No workflow action chain is required. Users with posting authority can act now.",
      "Workflow eylem zinciri gerekmiyor. Kayit yetkisi olan kullanicilar simdi islem yapabilir."
    );
  }
  if (!requiredPackageLabel || !requiredScopeLabel) {
    return "";
  }
  if (currentActionCode === "DRAFT") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can create or edit the current draft.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar mevcut taslagi olusturabilir veya duzenleyebilir.`
    );
  }
  if (currentActionCode === "SUBMIT" || requiredPackageCode === "PKG-AP-DRAFT-SUBMIT") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can submit or resubmit this document into the next workflow step.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar bu belgeyi bir sonraki workflow adimina gonderebilir veya yeniden gonderebilir.`
    );
  }
  if (currentActionCode === "APPROVE" || requiredPackageCode === "PKG-AP-APPROVE") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can approve the current step.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar mevcut adimi onaylayabilir.`
    );
  }
  if (currentActionCode === "POST" || requiredPackageCode === "PKG-AP-POST") {
    return l(
      `Users assigned ${requiredPackageLabel} at ${requiredScopeLabel} scope can post the document now.`,
      `${requiredScopeLabel} kapsaminda ${requiredPackageLabel} atanan kullanicilar belgeyi simdi kaydedebilir.`
    );
  }
  if (surfaceState.stage === "PENDING") {
    return l(
      `In-scope users at ${requiredScopeLabel} can act next.`,
      `${requiredScopeLabel} kapsamindaki kullanicilar sonraki islemi yapabilir.`
    );
  }
  return "";
}

function formatWorkflowDecisionLabel(decision, l) {
  const normalizedDecision = normalizeText(decision).toUpperCase();
  if (normalizedDecision === "APPROVE") {
    return l("Approved", "Onaylandi");
  }
  if (normalizedDecision === "REJECT") {
    return l("Rejected", "Reddedildi");
  }
  if (normalizedDecision === "RETURN") {
    return l("Returned", "Iade edildi");
  }
  return normalizedDecision || l("Workflow decision", "Workflow karari");
}

function toFiniteWorkflowNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function translateWorkflowAmountBasisLabel(amountBasis, l) {
  const normalizedAmountBasis = normalizeText(amountBasis).toUpperCase();
  if (normalizedAmountBasis === "BASE_AMOUNT") {
    return l("Base amount", "Baz tutar");
  }
  return normalizedAmountBasis;
}

function translateWorkflowRoutingMatchType(matchType, l) {
  const normalizedMatchType = normalizeText(matchType).toUpperCase();
  if (normalizedMatchType === "BAND") {
    return l("Amount band", "Tutar bandi");
  }
  if (normalizedMatchType === "FALLBACK") {
    return l("Fallback route", "Fallback rota");
  }
  if (normalizedMatchType === "LEGACY") {
    return l("Legacy unbanded rule", "Eski bantsiz kural");
  }
  if (normalizedMatchType === "NONE") {
    return l("No route matched", "Rota eslesmedi");
  }
  return normalizedMatchType;
}

function translateWorkflowRoutingNoMatchReason(noMatchReason, l) {
  const normalizedNoMatchReason = normalizeText(noMatchReason).toUpperCase();
  if (normalizedNoMatchReason === "THRESHOLD_AMOUNT_REQUIRED") {
    return l(
      "The evaluated threshold amount was missing for route selection.",
      "Rota secimi icin degerlendirilen esik tutar eksikti."
    );
  }
  if (normalizedNoMatchReason === "AMOUNT_BASIS_REQUIRED") {
    return l(
      "The route matrix required an amount basis before it could evaluate this document.",
      "Bu belgeyi degerlendirebilmek icin rota matrisinde tutar bazinin belirtilmesi gerekiyordu."
    );
  }
  if (normalizedNoMatchReason === "AMOUNT_BASIS_MISMATCH") {
    return l(
      "The document amount basis did not match the configured route basis.",
      "Belge tutar bazi, tanimli rota baziyla eslesmedi."
    );
  }
  if (normalizedNoMatchReason === "THRESHOLD_OUT_OF_RANGE") {
    return l(
      "The evaluated amount fell outside the configured amount bands.",
      "Degerlendirilen tutar, tanimli tutar bantlarinin disinda kaldi."
    );
  }
  if (normalizedNoMatchReason === "NO_BAND_MATCH_IN_SCOPE") {
    return l(
      "No amount band matched inside the selected scope layer.",
      "Secilen kapsam katmaninda hicbir tutar bandi eslesmedi."
    );
  }
  return normalizedNoMatchReason;
}

function resolveWorkflowDefinitionLabel(gate, workflowInstance) {
  const code = normalizeText(
    gate?.workflowDefinitionCode ||
      gate?.routingRuleSnapshot?.workflow_definition_code ||
      workflowInstance?.workflowDefinitionCode
  );
  const name = normalizeText(
    gate?.workflowDefinitionName ||
      gate?.routingRuleSnapshot?.workflow_definition_name ||
      workflowInstance?.workflowDefinitionName
  );
  const workflowDefinitionId = Number(
    gate?.workflowDefinitionId || workflowInstance?.workflowDefinitionId || 0
  );
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  return workflowDefinitionId > 0 ? `#${workflowDefinitionId}` : "";
}

function resolveWorkflowRoutingScopeLabel(gate, l) {
  return translateWorkflowScopeLabel(
    gate?.routingRuleSnapshot?.scope_type || gate?.assignmentScopeType,
    gate?.assignmentScopeLabel,
    l
  );
}

function resolveWorkflowRoutingRuleSummary(gate, l) {
  const routingRuleSnapshot = gate?.routingRuleSnapshot || null;
  if (!routingRuleSnapshot) {
    return gate?.assignmentResolved
      ? ""
      : l("No active workflow route matched.", "Aktif workflow rotasi eslesmedi.");
  }
  const scopeLabel = resolveWorkflowRoutingScopeLabel(gate, l) || l("Scope", "Kapsam");
  if (routingRuleSnapshot.is_fallback ?? routingRuleSnapshot.isFallback) {
    return l(`${scopeLabel} fallback route`, `${scopeLabel} fallback rota`);
  }
  const minAmount = toFiniteWorkflowNumber(
    routingRuleSnapshot.min_amount ?? routingRuleSnapshot.minAmount
  );
  const maxAmount = toFiniteWorkflowNumber(
    routingRuleSnapshot.max_amount ?? routingRuleSnapshot.maxAmount
  );
  const minAmountLabel = minAmount === null ? "" : formatMoneyAmount(minAmount);
  const maxAmountLabel = maxAmount === null ? "" : formatMoneyAmount(maxAmount);
  if (minAmount !== null && maxAmount !== null) {
    return l(
      `${scopeLabel} ${minAmountLabel} to ${maxAmountLabel}`,
      `${scopeLabel} ${minAmountLabel} - ${maxAmountLabel}`
    );
  }
  if (minAmount !== null) {
    return l(
      `${scopeLabel} ${minAmountLabel} and above`,
      `${scopeLabel} ${minAmountLabel} ve uzeri`
    );
  }
  if (maxAmount !== null) {
    return l(`${scopeLabel} up to ${maxAmountLabel}`, `${scopeLabel} ${maxAmountLabel}'e kadar`);
  }
  return l(`${scopeLabel} all amounts`, `${scopeLabel} tum tutarlar`);
}

function resolveWorkflowEvaluatedAmountLabel(gate, l) {
  const evaluatedAmount = toFiniteWorkflowNumber(gate?.evaluatedAmount);
  if (evaluatedAmount === null) {
    return "";
  }
  const amountBasisLabel = translateWorkflowAmountBasisLabel(gate?.evaluatedAmountBasis, l);
  const amountLabel = formatMoneyAmount(evaluatedAmount);
  return amountBasisLabel ? `${amountLabel} (${amountBasisLabel})` : amountLabel;
}

function buildWorkflowHistoryItems(workflowInstance, l) {
  const decisions = Array.isArray(workflowInstance?.decisions)
    ? workflowInstance.decisions
    : [];
  return decisions.map((decision) => {
    const stepNo = Number(decision?.stepNo || 0);
    const actorLabel = normalizeText(decision?.decisionByUserName);
    const createdAt = normalizeText(decision?.createdAt);
    const historySummaryParts = [formatWorkflowDecisionLabel(decision?.decision, l)];
    if (actorLabel) {
      historySummaryParts.push(l(`by ${actorLabel}`, `${actorLabel} tarafindan`));
    }
    if (createdAt) {
      historySummaryParts.push(createdAt);
    }
    return {
      key: String(decision?.id || `${decision?.decision || "decision"}-${stepNo}`),
      title: stepNo
        ? l(`Step ${stepNo}`, `${stepNo}. adim`)
        : l("Workflow decision", "Workflow karari"),
      summary: historySummaryParts.join(" • "),
      note: normalizeText(decision?.decisionNote),
    };
  });
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
  const currentActionCode = resolveApCurrentActionCode(gate);
  const workflowGoverned = Boolean(gate?.workflowGoverned);
  const assignmentResolved = Boolean(gate?.assignmentResolved);
  const waitingForSummary = normalizeText(gate?.waitingForSummary);
  const blockingReasonDetail = normalizeText(gate?.blockingReasonDetail);
  const latestDecisionComment = normalizeText(
    gate?.latestDecisionComment || row?.returnReason || row?.return_reason
  );
  const gateMessage = normalizeText(gate?.message);

  if (POSTED_DOCUMENT_STATUSES.has(documentStatus)) {
    return {
      stage: "POSTED",
      tone: "emerald",
      badgeLabel: l("Posted", "Kaydedildi"),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
      chipClass: "border-emerald-200 bg-white/70 text-emerald-800",
      headline: l("Posted to ledger", "Muhasebeye kaydedildi"),
      supportingText: workflowGoverned
        ? l(
            "All required workflow actions were completed before posting.",
            "Kayit oncesinde gerekli workflow eylemlerinin tamami tamamlandi."
          )
        : l(
            "This document did not require a workflow action chain.",
            "Bu belge icin workflow eylem zinciri gerekmedi."
          ),
      latestDecisionComment,
    };
  }

  if (documentStatus === "REVERSED") {
    return {
      stage: "REVERSED",
      tone: "slate",
      badgeLabel: l("Reversed", "Ters kayit"),
      toneClass: "border-slate-200 bg-slate-100 text-slate-900",
      chipClass: "border-slate-300 bg-white/70 text-slate-700",
      headline: l("Reversed after posting", "Kayit sonrasinda terslendi"),
      supportingText: workflowGoverned
        ? l(
            "All required workflow actions had already completed before reversal.",
            "Ters kayit oncesinde gerekli workflow eylemlerinin tamami zaten tamamlanmisti."
          )
        : "",
      latestDecisionComment,
    };
  }

  if (documentStatus === "CANCELLED") {
    return {
      stage: "CANCELLED",
      tone: "slate",
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
      tone: "slate",
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
              "This document does not use a workflow action chain.",
              "Bu belge workflow eylem zinciri kullanmaz."
            )),
      latestDecisionComment,
    };
  }

  if (!assignmentResolved) {
    return {
      stage: "DIRECT_POST",
      tone: "slate",
      badgeLabel: l("Direct post", "Dogrudan kayit"),
      toneClass: "border-slate-200 bg-slate-50 text-slate-800",
      chipClass: "border-slate-300 bg-white/70 text-slate-700",
      headline: l("No workflow route matched", "Workflow rotasi eslesmedi"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        l(
          "No active workflow assignment is configured for this document scope.",
          "Bu belge kapsami icin aktif workflow atamasi tanimli degil."
        ),
      latestDecisionComment,
    };
  }

  if (documentStatus === "RETURNED" || gateState === "RETURNED") {
    return {
      stage: "RETURNED",
      tone: "amber",
      badgeLabel: l("Returned", "Iade"),
      toneClass: "border-amber-200 bg-amber-50 text-amber-950",
      chipClass: "border-amber-200 bg-white/80 text-amber-800",
      headline:
        waitingForSummary || l("Returned for correction", "Duzeltme icin iade edildi"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        l(
          "Update the document, then resubmit it into the workflow action chain.",
          "Belgeyi guncelleyip workflow eylem zincirine yeniden gonderin."
        ),
      latestDecisionComment,
    };
  }

  if (documentStatus === "APPROVED" || gateState === "APPROVED") {
    return {
      stage: "APPROVED",
      tone: "emerald",
      badgeLabel: l("Ready to post", "Kayda hazir"),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
      chipClass: "border-emerald-200 bg-white/80 text-emerald-800",
      headline: waitingForSummary || l("Ready for posting", "Kayda hazir"),
      supportingText:
        gateMessage || l("Posting authority may act now.", "Kayit yetkisi artik islem yapabilir."),
      latestDecisionComment,
    };
  }

  if (documentStatus === "SUBMITTED" || gateState === "PENDING") {
    return {
      stage: "PENDING",
      tone: "blue",
      badgeLabel: l("Pending step", "Adim bekleniyor"),
      toneClass: "border-sky-200 bg-sky-50 text-sky-950",
      chipClass: "border-sky-200 bg-white/80 text-sky-800",
      headline: waitingForSummary || l("Waiting for workflow step", "Workflow adimi bekleniyor"),
      supportingText:
        blockingReasonDetail ||
        gateMessage ||
        l(
          "A workflow step is still pending for this document.",
          "Bu belge icin bir workflow adimi halen beklemede."
        ),
      latestDecisionComment,
    };
  }

  return {
    stage: "BLOCKED",
    tone: "rose",
    badgeLabel:
      currentActionCode === "DRAFT"
        ? l("Draft step", "Taslak adimi")
        : l("Needs submission", "Gonderim gerekli"),
    toneClass: "border-rose-200 bg-rose-50 text-rose-950",
    chipClass: "border-rose-200 bg-white/80 text-rose-800",
    headline:
      waitingForSummary ||
      (currentActionCode === "DRAFT"
        ? l("Draft is in progress", "Taslak uzerinde calisiliyor")
        : l("Waiting for submission", "Gonderim bekleniyor")),
    supportingText:
      blockingReasonDetail ||
      gateMessage ||
      (currentActionCode === "DRAFT"
        ? l(
            "Complete the draft work before the workflow action chain can continue.",
            "Workflow eylem zinciri devam etmeden once taslak calismasini tamamlayin."
          )
        : l(
            "Submit the document before the workflow action chain can continue.",
            "Workflow eylem zinciri devam etmeden once belgeyi gonderin."
          )),
    latestDecisionComment,
  };
}

/**
 * Builds the workflow explanation model for the detail page card.
 * Optional workflow-instance decisions are included when available so the
 * shared runtime panel can show prior-step history without replacing full audit pages.
 */
export function buildCariWorkflowDetailCardModel(row, l, options = {}) {
  const gate = row?.workflowGate || null;
  if (!gate) {
    return null;
  }

  const surfaceState = buildWorkflowSurfaceState(row, l);
  const currentScopeLabel = resolveWorkflowCurrentScopeLabel(gate, l);
  const assignmentScopeLabel = resolveWorkflowAssignmentScopeLabel(gate, l);
  const currentActionCode = resolveApCurrentActionCode(gate);
  const currentActionLabel = resolveApCurrentActionLabel(gate, l);
  const currentStepLabel = resolveWorkflowCurrentStepLabel(gate, surfaceState, l);
  const requiredPackageCode = resolveApRequiredPackageCode(row, gate, surfaceState);
  const requiredPackageLabel = translateApRequiredPackageLabel(requiredPackageCode, l);
  const requiredScopeLabel = currentScopeLabel || assignmentScopeLabel;
  const requiredScopeType = resolveWorkflowRequiredScopeType(gate);
  const routeScopeLabel = resolveWorkflowRoutingScopeLabel(gate, l);
  const eligibleRoleLabels = resolveApEligibleBusinessRoleLabels(
    requiredPackageCode,
    requiredScopeType
  );
  const approvalAuthorityLabel = resolveWorkflowApprovalAuthorityLabel(
    gate,
    currentScopeLabel,
    l
  );
  const historyItems = buildWorkflowHistoryItems(options.workflowInstance, l);
  const workflowDefinitionLabel = resolveWorkflowDefinitionLabel(gate, options.workflowInstance);
  const routingRuleSummary = resolveWorkflowRoutingRuleSummary(gate, l);
  const evaluatedAmountLabel = resolveWorkflowEvaluatedAmountLabel(gate, l);
  const amountBasisLabel = translateWorkflowAmountBasisLabel(gate?.evaluatedAmountBasis, l);
  const factItems = [];
  const noteItems = [];
  const technicalItems = [];

  if (workflowDefinitionLabel) {
    appendWorkflowItem(
      factItems,
      l("Matched route", "Eslesen rota"),
      workflowDefinitionLabel
    );
  }
  if (routeScopeLabel && routeScopeLabel !== requiredScopeLabel && surfaceState.stage !== "DIRECT_POST") {
    appendWorkflowItem(
      factItems,
      l("Route scope", "Rota kapsami"),
      routeScopeLabel
    );
  }
  if (routingRuleSummary) {
    appendWorkflowItem(
      factItems,
      l("Matched rule", "Eslesen kural"),
      routingRuleSummary
    );
  }
  if (evaluatedAmountLabel) {
    appendWorkflowItem(
      factItems,
      l("Evaluated amount", "Degerlendirilen tutar"),
      evaluatedAmountLabel
    );
  }
  if (amountBasisLabel && evaluatedAmountLabel) {
    appendWorkflowItem(
      factItems,
      l("Amount basis", "Tutar bazi"),
      amountBasisLabel
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
  if (requiredPackageLabel && requiredScopeType) {
    appendWorkflowItem(
      noteItems,
      l("Current gate", "Guncel gecit"),
      buildApCurrentGateLine(
        currentActionCode,
        requiredPackageLabel,
        requiredScopeLabel || requiredScopeType,
        l
      )
    );
  }
  if (gate?.routingUsedFallback) {
    appendWorkflowItem(
      noteItems,
      l("Fallback route used", "Fallback rota kullanildi"),
      l(
        "No amount band matched in the selected scope, so the fallback route was used.",
        "Secilen kapsamda hicbir tutar bandi eslesmedigi icin fallback rota kullanildi."
      )
    );
  } else if (gate?.routingPriorityApplied) {
    appendWorkflowItem(
      noteItems,
      l("Priority tie-break", "Oncelik esitleyici"),
      l(
        "Multiple active routes matched. The highest-priority route was selected.",
        "Birden fazla aktif rota eslesti. En yuksek oncelikli rota secildi."
      )
    );
  } else if (!gate?.assignmentResolved) {
    appendWorkflowItem(
      noteItems,
      l("Routing decision", "Rota karari"),
      translateWorkflowRoutingNoMatchReason(gate?.routingNoMatchReason, l) ||
        l(
          "No active workflow route is configured for this document scope.",
          "Bu belge kapsami icin aktif workflow rotasi tanimli degil."
        )
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
  if (gate?.routingMatchType) {
    appendWorkflowItem(
      technicalItems,
      l("Routing match type", "Rota eslesme tipi"),
      translateWorkflowRoutingMatchType(gate?.routingMatchType, l)
    );
  }
  if (gate?.routingMatchedScopeLayer) {
    appendWorkflowItem(
      technicalItems,
      l("Matched scope layer", "Eslesen kapsam katmani"),
      translateWorkflowScopeLabel(gate?.routingMatchedScopeLayer, gate?.routingMatchedScopeLayer, l)
    );
  }
  if (gate?.routingNoMatchReason) {
    appendWorkflowItem(
      technicalItems,
      l("Routing no-match reason", "Rota eslesmeme nedeni"),
      translateWorkflowRoutingNoMatchReason(gate?.routingNoMatchReason, l)
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
    workflowStatusLabel: normalizeText(gate?.workflowInstanceStatus),
    currentActionCode,
    currentActionLabel,
    currentStepLabel,
    requiredPackageCode,
    requiredPackageLabel,
    requiredScopeType,
    requiredScopeLabel,
    eligibleActorSummary: resolveWorkflowEligibleActorSummary(
      surfaceState,
      currentActionCode,
      requiredPackageCode,
      requiredPackageLabel,
      requiredScopeLabel,
      l
    ),
    eligibleRoleLabels,
    userCapabilityLines: [],
    factSectionTitle: l("Routing context", "Yonlendirme baglami"),
    historyItems,
    factItems,
    noteItems,
    technicalItems,
  };
}

function buildCariWorkflowUserCapabilityLines({
  row,
  canReadSelected,
  canSubmitSelected,
  canApproveSelected,
  canApproveWorkflow,
  canPostSelected,
  l,
}) {
  const gate = row?.workflowGate || null;
  const docStatus = normalizeText(row?.status).toUpperCase();
  const direction = normalizeText(row?.direction).toUpperCase();
  const isAp = direction === "AP";
  const gateState = normalizeWorkflowGateState(gate?.state);
  const surfaceState = buildWorkflowSurfaceState(row, l);
  const currentActionCode = resolveApCurrentActionCode(gate);
  const requiredPackageCode = resolveApRequiredPackageCode(
    row,
    gate,
    surfaceState
  );
  const requiredPackageLabel = translateApRequiredPackageLabel(requiredPackageCode, l);
  const requiredScopeLabel =
    resolveWorkflowCurrentScopeLabel(gate, l) || resolveWorkflowAssignmentScopeLabel(gate, l);
  if (!isAp || !gate?.workflowGoverned) {
    return [];
  }

  const userCapabilityLines = [];
  if (canSubmitSelected) {
    userCapabilityLines.push(
      docStatus === "RETURNED"
        ? l("You can resubmit this document.", "Bu belgeyi yeniden gonderebilirsiniz.")
        : l(
            "You can submit this document into the next workflow step.",
            "Bu belgeyi bir sonraki workflow adimina gonderebilirsiniz."
      )
    );
  }
  if (
    (surfaceState.stage === "BLOCKED" || surfaceState.stage === "RETURNED") &&
    canReadSelected &&
    !canSubmitSelected
  ) {
    userCapabilityLines.push(
      surfaceState.stage === "RETURNED"
        ? l(
            "You can view this document but cannot resubmit it.",
            "Bu belgeyi goruntuleyebilirsiniz ancak yeniden gonderemezsiniz."
          )
        : l(
            "You can view this document but cannot submit it.",
            "Bu belgeyi goruntuleyebilirsiniz ancak gonderemezsiniz."
          )
    );
    if (requiredPackageLabel && requiredScopeLabel) {
      userCapabilityLines.push(
        l(
          `Submission requires ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
          `Gonderim icin ${requiredScopeLabel} kapsaminda ${requiredPackageLabel} gerekir.`
        )
      );
    }
  }
  if (canApproveSelected) {
    userCapabilityLines.push(
      l(
        "You can approve, return, or reject this document.",
        "Bu belgeyi onaylayabilir, iade edebilir veya reddedebilirsiniz."
      )
    );
  } else if (gateState === "PENDING" && canReadSelected) {
    userCapabilityLines.push(
      l(
        "You can view this document but cannot approve it.",
        "Bu belgeyi goruntuleyebilirsiniz ancak onaylayamazsiniz."
      )
    );
    if (!canApproveWorkflow && requiredPackageLabel && requiredScopeLabel) {
      userCapabilityLines.push(
        l(
          `This step requires ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
          `Bu adim ${requiredScopeLabel} kapsaminda ${requiredPackageLabel} gerektirir.`
        )
      );
      userCapabilityLines.push(
        l(
          "You do not have approval authority for this step.",
          "Bu adim icin onay yetkiniz yok."
        )
      );
    } else if (!canApproveWorkflow) {
      userCapabilityLines.push(
        l(
          "You do not have approval authority for this step.",
          "Bu adim icin onay yetkiniz yok."
        )
      );
    }
  }
  if (canPostSelected) {
    userCapabilityLines.push(
      surfaceState.stage === "DIRECT_POST"
        ? l(
            "No workflow action chain is required. You can post this document now.",
            "Workflow eylem zinciri gerekmiyor. Bu belgeyi simdi kaydedebilirsiniz."
          )
        : l("You can post this document.", "Bu belgeyi kaydedebilirsiniz.")
    );
  } else if (gateState === "APPROVED" && canReadSelected) {
    userCapabilityLines.push(
      l(
        "You can view this document but cannot post it.",
        "Bu belgeyi goruntuleyebilirsiniz ancak kaydedemezsiniz."
      )
    );
    if (requiredPackageLabel && requiredScopeLabel) {
      userCapabilityLines.push(
        l(
          `Posting requires ${requiredPackageLabel} at ${requiredScopeLabel} scope.`,
          `Kayit icin ${requiredScopeLabel} kapsaminda ${requiredPackageLabel} gerekir.`
        )
      );
    }
  } else if (surfaceState.stage === "DIRECT_POST" && canReadSelected) {
    userCapabilityLines.push(
      l(
        "No workflow action chain is required, but you do not have posting authority for this document.",
        "Workflow eylem zinciri gerekmiyor ancak bu belge icin kayit yetkiniz yok."
      )
    );
  } else if (gateState === "PENDING" || currentActionCode === "APPROVE") {
    userCapabilityLines.push(
      l(
        "You cannot post because the document is still waiting at an approval step.",
        "Belge hala bir onay adiminda bekledigi icin kaydedemezsiniz."
      )
    );
  } else if (currentActionCode === "DRAFT") {
    userCapabilityLines.push(
      l(
        "You cannot post because the document is still in its draft step.",
        "Belge hala taslak adiminda oldugu icin kaydedemezsiniz."
      )
    );
  } else if (gateState === "BLOCKED" || currentActionCode === "SUBMIT") {
    userCapabilityLines.push(
      l(
        "You cannot post because the submission step is still pending.",
        "Gonderim adimi halen bekledigi icin kaydedemezsiniz."
      )
    );
  }
  return userCapabilityLines;
}

/**
 * Builds the shared runtime explainability model for AP action panels.
 */
export function buildCariWorkflowActionExplainabilityModel({
  row,
  workflowInstance = null,
  canReadSelected = false,
  canSubmitSelected = false,
  canApproveSelected = false,
  canApproveWorkflow = false,
  canPostSelected = false,
  l,
}) {
  const gate = row?.workflowGate || null;
  if (!gate?.workflowGoverned || normalizeText(row?.direction).toUpperCase() !== "AP") {
    return null;
  }

  return {
    ...buildCariWorkflowDetailCardModel(row, l, { workflowInstance }),
    userCapabilityLines: buildCariWorkflowUserCapabilityLines({
      row,
      canReadSelected,
      canSubmitSelected,
      canApproveSelected,
      canApproveWorkflow,
      canPostSelected,
      l,
    }),
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
