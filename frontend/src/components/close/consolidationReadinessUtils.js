/**
 * Return the visual tone classes for a backend-owned consolidation readiness status.
 */
export function getConsolidationReadinessTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "READY_TO_START":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "READY_TO_FINALIZE":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "IN_PROGRESS":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "LOCKED":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "WAITING_FOR_ENTITY_CLOSE":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

/**
 * Translate backend readiness enum values into finance-friendly display labels.
 */
export function getConsolidationReadinessLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "WAITING_FOR_ENTITY_CLOSE":
      return l("Waiting for entity close", "Varlik kapanisi bekleniyor");
    case "READY_TO_START":
      return l("Ready to start", "Baslamaya hazir");
    case "IN_PROGRESS":
      return l("Consolidation in progress", "Konsolidasyon devam ediyor");
    case "READY_TO_FINALIZE":
      return l("Ready for final review", "Nihai incelemeye hazir");
    case "LOCKED":
      return l("Locked", "Kilitlendi");
    default:
      return l("Readiness unknown", "Hazirlik durumu bilinmiyor");
  }
}

/**
 * Build dynamic owner-aware waiting copy for ready states without start permission.
 */
export function getReadyToStartWaitingCopy(readiness, l) {
  return `${l("Ready to start - waiting for", "Baslamaya hazir - beklenen rol")}: ${getOwnerHint(readiness, l)}.`;
}

/**
 * Explain the current readiness status without changing backend readiness semantics.
 */
export function getConsolidationReadinessDescription(readiness, l) {
  switch (String(readiness?.status || "").trim().toUpperCase()) {
    case "WAITING_FOR_ENTITY_CLOSE":
      return l(
        "Consolidation cannot start yet because one or more required entity close packs are not ready.",
        "Bir veya daha fazla zorunlu varlik kapanis paketi hazir olmadigi icin konsolidasyon henuz baslayamaz.",
      );
    case "READY_TO_START":
      return l(
        "All mandatory entity close packs are locked and fresh. The official consolidation run can now be started.",
        "Tum zorunlu varlik kapanis paketleri kilitli ve guncel. Resmi konsolidasyon kosusu artik baslatilabilir.",
      );
    case "IN_PROGRESS":
      return l(
        "The official consolidation run has started, but operational checks are not complete yet.",
        "Resmi konsolidasyon kosusu basladi, ancak operasyonel kontroller henuz tamamlanmadi.",
      );
    case "READY_TO_FINALIZE":
      if (isWorkflowGateExplicitlyNotRequired(readiness)) {
        return l(
          "Operational checks are clear. A finalizer action is required before locking.",
          "Operasyonel kontroller temiz. Kilitlemeden once kesinlestirici aksiyonu gerekir.",
        );
      }
      return l(
        "Operational checks are clear. Final workflow approval or finalizer action may still be required before locking.",
        "Operasyonel kontroller temiz. Kilitlemeden once nihai is akisi onayi veya kesinlestirici aksiyonu gerekebilir.",
      );
    case "LOCKED":
      return l(
        "The official consolidation run has been finalized and locked.",
        "Resmi konsolidasyon kosusu kesinlestirildi ve kilitlendi.",
      );
    default:
      return l(
        "Consolidation readiness status is not available yet.",
        "Konsolidasyon hazirlik durumu henuz mevcut degil.",
      );
  }
}

/**
 * Resolve the next-action text while keeping start/open permissions separate.
 */
export function getConsolidationReadinessNextActionCopy(
  readiness,
  l,
  {
    canCreateConsolidationRun = Boolean(readiness?.canStart),
    canReadConsolidationRun = Boolean(readiness?.canOpenRun),
  } = {},
) {
  switch (String(readiness?.status || "").trim().toUpperCase()) {
    case "WAITING_FOR_ENTITY_CLOSE":
      return l(
        "Resolve blocking entity close packs",
        "Bloke eden varlik kapanis paketlerini gider",
      );
    case "READY_TO_START":
      return readiness?.canStart && canCreateConsolidationRun
        ? l(
            "Start official consolidation run",
            "Resmi konsolidasyon kosusunu baslat",
          )
        : getReadyToStartWaitingCopy(readiness, l);
    case "IN_PROGRESS":
      return readiness?.canOpenRun && canReadConsolidationRun
        ? l("Open consolidation run", "Konsolidasyon kosusunu ac")
        : l(
            "The official run is in progress.",
            "Resmi kosu devam ediyor.",
          );
    case "READY_TO_FINALIZE":
      return readiness?.canOpenRun && canReadConsolidationRun
        ? l("Open finalization review", "Kesinlestirme incelemesini ac")
        : l(
            "Final review requires consolidation run access.",
            "Nihai inceleme icin konsolidasyon kosusu erisimi gerekir.",
          );
    case "LOCKED":
      return l("No action required", "Aksiyon gerekmiyor");
    default:
      return l("Review readiness status", "Hazirlik durumunu incele");
  }
}

/**
 * Resolve the concrete action affordance for the readiness CTA surface.
 */
export function getConsolidationReadinessActionState({
  readiness,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  l,
}) {
  const status = String(readiness?.status || "").trim().toUpperCase();
  if (status === "READY_TO_START") {
    return readiness?.canStart && canCreateConsolidationRun
      ? {
          actionTone: "emerald",
          buttonLabel: l("Start official consolidation run", "Resmi konsolidasyon kosusunu baslat"),
          helperText: l(
            "This will create the official consolidation run for this group and period.",
            "Bu aksiyon bu grup ve donem icin resmi konsolidasyon kosusunu olusturur.",
          ),
          kind: "start",
        }
      : {
          helperText: l(
            "You can view readiness status, but you do not have permission to start the official consolidation run.",
            "Hazirlik durumunu goruntuleyebilirsiniz, ancak resmi konsolidasyon kosusunu baslatma yetkiniz yok.",
          ),
          kind: "text",
          text: getReadyToStartWaitingCopy(readiness, l),
        };
  }

  if (status === "IN_PROGRESS") {
    return readiness?.canOpenRun && canReadConsolidationRun
      ? {
          actionTone: "sky",
          buttonLabel: l("Open consolidation run", "Konsolidasyon kosusunu ac"),
          helperText: l(
            "Review consolidation entries, adjustments, eliminations, and report checks.",
            "Konsolidasyon kayitlarini, duzeltmeleri, eliminasyonlari ve rapor kontrollerini inceleyin.",
          ),
          kind: "open",
        }
      : {
          helperText: l(
            "You can view cockpit readiness status, but opening the run requires consolidation.run.read.",
            "Kokpit hazirlik durumunu goruntuleyebilirsiniz, ancak kosuyu acmak icin consolidation.run.read gerekir.",
          ),
          kind: "text",
          text: l(
            "The official run is in progress.",
            "Resmi kosu devam ediyor.",
          ),
        };
  }

  if (status === "READY_TO_FINALIZE") {
    return readiness?.canOpenRun && canReadConsolidationRun
      ? {
          actionTone: "cyan",
          buttonLabel: l("Open finalization review", "Kesinlestirme incelemesini ac"),
          helperText: isWorkflowGateExplicitlyNotRequired(readiness)
            ? l(
                "Operational checks are clear. A finalizer action is required before locking.",
                "Operasyonel kontroller temiz. Kilitlemeden once kesinlestirici aksiyonu gerekir.",
              )
            : l(
                "Operational checks are clear. Final approval may still be required before locking.",
                "Operasyonel kontroller temiz. Kilitlemeden once nihai onay gerekebilir.",
              ),
          kind: "open",
        }
      : {
          helperText: l(
            "You can view cockpit readiness status, but opening final review requires consolidation.run.read.",
            "Kokpit hazirlik durumunu goruntuleyebilirsiniz, ancak nihai incelemeyi acmak icin consolidation.run.read gerekir.",
          ),
          kind: "text",
          text: l(
            "Ready for final review.",
            "Nihai incelemeye hazir.",
          ),
        };
  }

  if (status === "LOCKED") {
    return {
      helperText: l(
        "The official consolidation run is finalized and locked.",
        "Resmi konsolidasyon kosusu kesinlestirildi ve kilitlendi.",
      ),
      kind: "text",
      text: l("Consolidation locked", "Konsolidasyon kilitlendi"),
    };
  }

  if (status === "WAITING_FOR_ENTITY_CLOSE") {
    return {
      helperText: l(
        "Resolve the blocking local close packs before the official consolidation run can start.",
        "Resmi konsolidasyon kosusu baslamadan once bloke eden yerel kapanis paketlerini giderin.",
      ),
      kind: "text",
      text: l("Waiting for entity close", "Varlik kapanisi bekleniyor"),
    };
  }

  return {
    helperText: l(
      "Use the readiness status to decide the next consolidation action.",
      "Sonraki konsolidasyon aksiyonunu belirlemek icin hazirlik durumunu kullanin.",
    ),
    kind: "text",
    text: l("Readiness unknown", "Hazirlik durumu bilinmiyor"),
  };
}

export function getMissingFactValue(l) {
  return l("\u2014", "\u2014");
}

export function isWorkflowGateExplicitlyNotRequired(readiness) {
  const source = readiness?.source || {};
  return (
    Object.prototype.hasOwnProperty.call(source, "workflowGateRequired") &&
    !source.workflowGateRequired
  );
}

function getNumericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasSourceField(readiness, fieldName) {
  return Object.prototype.hasOwnProperty.call(readiness?.source || {}, fieldName);
}

function getSourceCount(readiness, fieldName) {
  if (!hasSourceField(readiness, fieldName)) {
    return null;
  }
  return getNumericValue(readiness.source[fieldName]);
}

function formatFactCount(value, l) {
  const count = getNumericValue(value);
  return count === null ? getMissingFactValue(l) : String(count);
}

function countBlockingReasonsByCode(readiness, codeFragment) {
  const normalizedFragment = String(codeFragment || "").trim().toUpperCase();
  if (!normalizedFragment || !Array.isArray(readiness?.blockingReasons)) {
    return 0;
  }
  return readiness.blockingReasons.reduce((total, reason) => {
    const code = String(reason?.code || "").trim().toUpperCase();
    if (!code.includes(normalizedFragment)) {
      return total;
    }
    const count = getNumericValue(reason?.count);
    return total + (count ?? 1);
  }, 0);
}

function getReadinessBlockerType(reason) {
  const code = String(reason?.code || "").trim().toUpperCase();
  if (code.includes("WORKFLOW")) {
    return "workflow";
  }
  if (code.includes("STALE")) {
    return "stale";
  }
  if (code.includes("NOT_LOCKED")) {
    return "notLocked";
  }
  if (code.includes("MISSING")) {
    return "missing";
  }
  return "operational";
}

function getWorkflowApprovalFact(readiness, l) {
  const source = readiness?.source || {};
  if (!hasSourceField(readiness, "workflowGateRequired")) {
    return getMissingFactValue(l);
  }
  if (!source.workflowGateRequired) {
    return l("Not required", "Gerekli degil");
  }
  if (source.workflowGateApproved) {
    return l("Approved", "Onaylandi");
  }
  const workflowBlockerCount = getSourceCount(readiness, "workflowBlockerCount");
  return workflowBlockerCount > 0
    ? `${l("Pending", "Beklemede")} (${workflowBlockerCount})`
    : l("Pending", "Beklemede");
}

function getOfficialRunFact(readiness, l) {
  const status = String(readiness?.status || "").trim().toUpperCase();
  if (status === "LOCKED") {
    return l("Locked", "Kilitlendi");
  }
  if (readiness?.runId || status === "IN_PROGRESS" || status === "READY_TO_FINALIZE") {
    return l("Started", "Basladi");
  }
  if (status === "WAITING_FOR_ENTITY_CLOSE" || status === "READY_TO_START") {
    return l("Not started", "Baslamadi");
  }
  return getMissingFactValue(l);
}

function getLocalCloseFact(readiness, memberRows, l) {
  const memberBlockCount = getSourceCount(readiness, "memberReadinessBlockCount");
  const localCloseRows = Array.isArray(memberRows) ? memberRows : [];
  if (localCloseRows.length > 0) {
    const lockedCount = localCloseRows.filter(
      (row) => String(row?.businessStatus || "").trim().toUpperCase() === "LOCKED",
    ).length;
    return `${lockedCount} / ${localCloseRows.length} ${l("locked", "kilitli")}`;
  }
  if (memberBlockCount === null) {
    return getMissingFactValue(l);
  }
  return memberBlockCount === 0
    ? l("Ready", "Hazir")
    : `${l("Waiting", "Bekliyor")} (${memberBlockCount})`;
}

function getStalePacksFact(readiness, memberRows, l) {
  const localCloseRows = Array.isArray(memberRows) ? memberRows : [];
  if (localCloseRows.length > 0) {
    return String(
      localCloseRows.filter(
        (row) => String(row?.staleStatus || "FRESH").trim().toUpperCase() !== "FRESH",
      ).length,
    );
  }
  const staleBlockCount = countBlockingReasonsByCode(readiness, "STALE");
  if (staleBlockCount > 0) {
    return String(staleBlockCount);
  }
  if (!Array.isArray(readiness?.blockingReasons)) {
    return getMissingFactValue(l);
  }
  return l("0", "0");
}

function getOperationalBlockersFact(readiness, l) {
  const nonWorkflowBlockerCount = getSourceCount(readiness, "nonWorkflowBlockerCount");
  if (nonWorkflowBlockerCount !== null) {
    return formatFactCount(nonWorkflowBlockerCount, l);
  }
  if (Array.isArray(readiness?.blockingReasons)) {
    return String(
      readiness.blockingReasons.reduce((total, reason) => {
        if (getReadinessBlockerType(reason) !== "operational") {
          return total;
        }
        const count = getNumericValue(reason?.count);
        return total + (count ?? 1);
      }, 0),
    );
  }
  return getMissingFactValue(l);
}

function getRunWorkloadFact(readiness, l) {
  const status = String(readiness?.status || "").trim().toUpperCase();
  const runStarted =
    Boolean(readiness?.runId) ||
    status === "IN_PROGRESS" ||
    status === "READY_TO_FINALIZE" ||
    status === "LOCKED";
  if (!runStarted) {
    return getMissingFactValue(l);
  }

  const entryCount = getSourceCount(readiness, "entryCount");
  const draftAdjustmentCount = getSourceCount(readiness, "draftAdjustmentCount");
  const draftEliminationCount = getSourceCount(readiness, "draftEliminationCount");
  if (
    entryCount === null &&
    draftAdjustmentCount === null &&
    draftEliminationCount === null
  ) {
    return getMissingFactValue(l);
  }

  const draftCount =
    draftAdjustmentCount === null && draftEliminationCount === null
      ? null
      : (draftAdjustmentCount || 0) + (draftEliminationCount || 0);
  return `${formatFactCount(entryCount, l)} ${l("entries", "kayit")} / ${formatFactCount(
    draftCount,
    l,
  )} ${l("drafts", "taslak")}`;
}

/**
 * Build compact readiness facts from the existing readiness payload and member rows.
 */
export function getConsolidationReadinessFacts(readiness, memberRows, l) {
  return [
    {
      label: l("Local close packs", "Varlik kapanis paketleri"),
      value: getLocalCloseFact(readiness, memberRows, l),
    },
    {
      label: l("Stale packs", "Bayat paketler"),
      value: getStalePacksFact(readiness, memberRows, l),
    },
    {
      label: l("Official run", "Resmi kosu"),
      value: getOfficialRunFact(readiness, l),
    },
    {
      label: l("Operational blockers", "Operasyonel blokajlar"),
      value: getOperationalBlockersFact(readiness, l),
    },
    {
      label: l("Run workload", "Kosu is yuku"),
      value: getRunWorkloadFact(readiness, l),
    },
    {
      label: l("Workflow approval", "Is akisi onayi"),
      value: getWorkflowApprovalFact(readiness, l),
    },
    {
      label: l("Owner", "Sahip"),
      value: getOwnerHint(readiness, l),
    },
  ];
}

/**
 * Return helper text for the current readiness CTA state.
 */
export function getConsolidationReadinessActionHelper({
  readiness,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  l,
}) {
  return getConsolidationReadinessActionState({
    readiness,
    canCreateConsolidationRun,
    canReadConsolidationRun,
    l,
  }).helperText;
}

function formatCountedPackCopy(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getWaitingStatusWhyLines(readiness, l) {
  const missingCount = countBlockingReasonsByCode(readiness, "MISSING");
  const notLockedCount = countBlockingReasonsByCode(readiness, "NOT_LOCKED");
  const staleCount = countBlockingReasonsByCode(readiness, "STALE");
  const sourceMemberBlockCount = getSourceCount(readiness, "memberReadinessBlockCount");
  const directBlockCount = Array.isArray(readiness?.blockingReasons)
    ? readiness.blockingReasons.length
    : 0;
  const totalCount =
    notLockedCount + staleCount ||
    sourceMemberBlockCount ||
    missingCount ||
    directBlockCount;

  let reasonLine = l(
    "Consolidation is waiting for required entity close packs to be locked and up to date.",
    "Konsolidasyon, zorunlu varlik kapanis paketlerinin kilitlenmesini ve guncel olmasini bekliyor.",
  );

  if (notLockedCount > 0 && staleCount > 0) {
    reasonLine = l(
      `Consolidation is waiting because ${formatCountedPackCopy(
        totalCount,
        "entity close pack is",
        "entity close packs are",
      )} not locked or stale.`,
      `Konsolidasyon bekliyor cunku ${totalCount} varlik kapanis paketi kilitli degil veya bayat.`,
    );
  } else if (notLockedCount > 0) {
    reasonLine = l(
      `Consolidation is waiting because ${formatCountedPackCopy(
        notLockedCount,
        "entity close pack is",
        "entity close packs are",
      )} not locked.`,
      `Konsolidasyon bekliyor cunku ${notLockedCount} varlik kapanis paketi kilitli degil.`,
    );
  } else if (staleCount > 0) {
    reasonLine = l(
      `Consolidation is waiting because ${formatCountedPackCopy(
        staleCount,
        "entity close pack is",
        "entity close packs are",
      )} stale.`,
      `Konsolidasyon bekliyor cunku ${staleCount} varlik kapanis paketi bayat.`,
    );
  } else if (missingCount > 0) {
    reasonLine = l(
      "Consolidation is waiting because required local close packs are missing.",
      "Konsolidasyon bekliyor cunku zorunlu yerel kapanis paketleri eksik.",
    );
  } else if (totalCount > 0) {
    reasonLine = l(
      `Consolidation is waiting because ${formatCountedPackCopy(
        totalCount,
        "entity close pack is",
        "entity close packs are",
      )} not ready.`,
      `Konsolidasyon bekliyor cunku ${totalCount} varlik kapanis paketi hazir degil.`,
    );
  }

  return [
    reasonLine,
    l(
      "Open the blocking items below to resolve them.",
      "Cozmek icin asagidaki bloke eden kalemleri acin.",
    ),
  ];
}

/**
 * Explain why the current readiness status exists using existing payload fields.
 */
export function getConsolidationReadinessWhyLines(readiness, l) {
  const status = String(readiness?.status || "").trim().toUpperCase();
  if (status === "READY_TO_START") {
    return [
      l(
        "All mandatory entity close packs are locked and up to date.",
        "Tum zorunlu varlik kapanis paketleri kilitli ve guncel.",
      ),
      l(
        "There is no official consolidation run yet, so it can be started now.",
        "Henuz resmi konsolidasyon kosusu yok, bu nedenle simdi baslatilabilir.",
      ),
    ];
  }
  if (status === "WAITING_FOR_ENTITY_CLOSE") {
    return getWaitingStatusWhyLines(readiness, l);
  }
  if (status === "IN_PROGRESS") {
    const operationalBlockerCount = getOperationalBlockersFact(readiness, l);
    const hasKnownBlockerCount = operationalBlockerCount !== getMissingFactValue(l);
    return [
      hasKnownBlockerCount
        ? l(
            `The official consolidation run is in progress with ${operationalBlockerCount} operational blockers still open.`,
            `Resmi konsolidasyon kosusu devam ediyor ve ${operationalBlockerCount} operasyonel blokaj hala acik.`,
          )
        : l(
            "The official consolidation run is in progress and operational checks are still being completed.",
            "Resmi konsolidasyon kosusu devam ediyor ve operasyonel kontroller tamamlanmaya devam ediyor.",
          ),
      l(
        "Review the run to clear entries, adjustments, eliminations, and report checks.",
        "Kayitlari, duzeltmeleri, eliminasyonlari ve rapor kontrollerini temizlemek icin kosuyu inceleyin.",
      ),
    ];
  }
  if (status === "READY_TO_FINALIZE") {
    const workflowRequired = Boolean(readiness?.source?.workflowGateRequired);
    const workflowApproved = Boolean(readiness?.source?.workflowGateApproved);
    if (workflowRequired && !workflowApproved) {
      return [
        l(
          "Operational checks are clear. Final workflow approval is still pending before locking the run.",
          "Operasyonel kontroller temiz. Kosuyu kilitlemeden once nihai is akisi onayi hala beklemede.",
        ),
      ];
    }
    if (isWorkflowGateExplicitlyNotRequired(readiness)) {
      return [
        l(
          "Operational checks are clear. A finalizer action is required before locking the run.",
          "Operasyonel kontroller temiz. Kosuyu kilitlemeden once kesinlestirici aksiyonu gerekir.",
        ),
      ];
    }
    return [
      l(
        "Operational checks are clear. Final workflow approval or finalizer action may still be required before locking the run.",
        "Operasyonel kontroller temiz. Kosuyu kilitlemeden once nihai is akisi onayi veya kesinlestirici aksiyonu gerekebilir.",
      ),
    ];
  }
  if (status === "LOCKED") {
    return [
      l(
        "The official consolidation run has been finalized and locked.",
        "Resmi konsolidasyon kosusu kesinlestirildi ve kilitlendi.",
      ),
      l(
        "No readiness action is required for this cycle.",
        "Bu dongu icin hazirlik aksiyonu gerekmiyor.",
      ),
    ];
  }
  return [
    l(
      "Consolidation readiness status is not available yet.",
      "Konsolidasyon hazirlik durumu henuz mevcut degil.",
    ),
  ];
}

export function getReadinessBlockerGroupLabel(type, l) {
  switch (type) {
    case "missing":
      return l("Missing local close pack", "Eksik yerel kapanis paketi");
    case "notLocked":
      return l("Not locked", "Kilitli degil");
    case "stale":
      return l("Stale", "Bayat");
    case "workflow":
      return l("Workflow approval", "Is akisi onayi");
    default:
      return l("Operational blocker", "Operasyonel blokaj");
  }
}

function getReadinessBlockerReason(type, reason, l) {
  switch (type) {
    case "missing":
      return l(
        "A required local close pack is not available for this group close cycle.",
        "Bu grup kapanis dongusu icin zorunlu yerel kapanis paketi mevcut degil.",
      );
    case "notLocked":
      return l(
        "The local close pack must be locked before consolidation can start.",
        "Konsolidasyon baslamadan once yerel kapanis paketi kilitlenmelidir.",
      );
    case "stale":
      return l(
        "The local close pack is locked but has changes that must be reviewed.",
        "Yerel kapanis paketi kilitli, ancak incelenmesi gereken degisiklikler var.",
      );
    case "workflow":
      return l(
        "Final workflow approval is required before the run can be locked.",
        "Kosu kilitlenmeden once nihai is akisi onayi gerekir.",
      );
    default:
      return (
        String(reason?.message || "").trim() ||
        l(
          "A consolidation operational check still requires attention.",
          "Bir konsolidasyon operasyonel kontrolu hala dikkat gerektiriyor.",
        )
      );
  }
}

function getReadinessBlockerAction(type, l) {
  switch (type) {
    case "missing":
      return l("Provision required local close pack", "Zorunlu yerel kapanis paketini olustur");
    case "notLocked":
      return l("Open local close pack", "Yerel kapanis paketini ac");
    case "stale":
      return l("Review stale changes", "Bayat degisiklikleri incele");
    case "workflow":
      return l("Complete workflow approval", "Is akisi onayini tamamla");
    default:
      return l("Review consolidation checks", "Konsolidasyon kontrollerini incele");
  }
}

function getReadinessBlockerRowLabel(row, l) {
  if (!row) {
    return l("Entity close pack", "Varlik kapanis paketi");
  }
  const baseLabel =
    row.legalEntityLabel ||
    row.scopeLabel ||
    row.itemKey ||
    l("Entity close pack", "Varlik kapanis paketi");
  return row.bookLabel ? `${baseLabel} / ${row.bookLabel}` : baseLabel;
}

function getReadinessBlockerTitle(type, row, reason, l) {
  const rowLabel = getReadinessBlockerRowLabel(row, l);
  if (row) {
    if (type === "notLocked") {
      return `${rowLabel} ${l("close pack is not locked", "kapanis paketi kilitli degil")}`;
    }
    if (type === "stale") {
      return `${rowLabel} ${l("close pack is stale", "kapanis paketi bayat")}`;
    }
  }
  switch (type) {
    case "missing":
      return l("Required local close pack is missing", "Zorunlu yerel kapanis paketi eksik");
    case "notLocked":
      return l("Required local close packs are not locked", "Zorunlu yerel kapanis paketleri kilitli degil");
    case "stale":
      return l("Required local close packs are stale", "Zorunlu yerel kapanis paketleri bayat");
    case "workflow":
      return l("Workflow approval is pending", "Is akisi onayi beklemede");
    default:
      return (
        String(reason?.message || "").trim() ||
        l("Operational blocker needs review", "Operasyonel blokaj incelenmeli")
      );
  }
}

function getReadinessBlockerMeta(type, reason, row, getBusinessStatusLabel, getStaleStatusLabel, l) {
  if (row) {
    if (type === "stale") {
      const businessStatus = String(row?.businessStatus || "").trim().toUpperCase();
      const staleStatus = String(row?.staleStatus || "FRESH").trim().toUpperCase();
      if (businessStatus === "LOCKED" && staleStatus !== "FRESH") {
        return l("Status: Locked but outdated", "Durum: Kilitli ama guncel degil");
      }
      return `${l("Status", "Durum")}: ${getStaleStatusLabel(row?.staleStatus)}`;
    }
    return `${l("Status", "Durum")}: ${getBusinessStatusLabel(row?.businessStatus)}`;
  }
  const count = getNumericValue(reason?.count);
  if (count !== null) {
    return `${l("Count", "Adet")}: ${count}`;
  }
  return `${l("Status", "Durum")}: ${l("Blocking", "Bloke ediyor")}`;
}

/**
 * Convert backend blocking reasons into grouped, user-facing drill-down rows.
 */
export function buildReadinessBlockerItems({
  readiness,
  memberRows,
  getBusinessStatusLabel,
  getStaleStatusLabel,
  l,
}) {
  const rowById = new Map(
    (Array.isArray(memberRows) ? memberRows : [])
      .map((row) => [Number(row?.id || 0), row])
      .filter(([id]) => id > 0),
  );
  const reasons = Array.isArray(readiness?.blockingReasons)
    ? readiness.blockingReasons
    : [];
  const items = [];

  for (const reason of reasons) {
    const type = getReadinessBlockerType(reason);
    const itemIds = Array.isArray(reason?.itemIds)
      ? reason.itemIds.map((itemId) => Number(itemId || 0)).filter((itemId) => itemId > 0)
      : [];

    if (itemIds.length > 0) {
      for (const itemId of itemIds) {
        const row = rowById.get(itemId);
        items.push({
          action: getReadinessBlockerAction(type, l),
          group: type,
          key: `${type}:${itemId}`,
          meta: getReadinessBlockerMeta(
            type,
            reason,
            row,
            getBusinessStatusLabel,
            getStaleStatusLabel,
            l,
          ),
          reason: getReadinessBlockerReason(type, reason, l),
          title: getReadinessBlockerTitle(type, row, reason, l),
          to: row?.drillPath || "",
        });
      }
      continue;
    }

    items.push({
      action: getReadinessBlockerAction(type, l),
      group: type,
      key: `${type}:${reason?.code || reason?.message || items.length}`,
      meta: getReadinessBlockerMeta(
        type,
        reason,
        null,
        getBusinessStatusLabel,
        getStaleStatusLabel,
        l,
      ),
      reason: getReadinessBlockerReason(type, reason, l),
      title: getReadinessBlockerTitle(type, null, reason, l),
      to: "",
    });
  }

  const workflowPending =
    Boolean(readiness?.source?.workflowGateRequired) &&
    !readiness?.source?.workflowGateApproved;
  if (workflowPending && !items.some((item) => item.group === "workflow")) {
    const workflowReason = { code: "WORKFLOW_APPROVAL_PENDING", count: 1 };
    items.push({
      action: getReadinessBlockerAction("workflow", l),
      group: "workflow",
      key: "workflow:approval-pending",
      meta: `${l("Status", "Durum")}: ${l("Pending", "Beklemede")}`,
      reason: getReadinessBlockerReason("workflow", workflowReason, l),
      title: getReadinessBlockerTitle("workflow", null, workflowReason, l),
      to: "",
    });
  }

  return items;
}

export function groupReadinessBlockerItems(items = []) {
  const order = ["missing", "notLocked", "stale", "operational", "workflow"];
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.group) || [];
    current.push(item);
    groups.set(item.group, current);
  }
  return order
    .filter((group) => groups.has(group))
    .map((group) => ({ group, items: groups.get(group) }));
}

/**
 * Resolve the owner hint for readiness actions from backend role/user hints.
 */
export function getOwnerHint(readiness, l) {
  const ownerUserId = Number(readiness?.ownerUserId || 0);
  const rawHint = String(readiness?.ownerRoleHint || "").trim();
  const normalizedHint = rawHint.replace(/[\s_-]/g, "").toUpperCase();
  let hintLabel = rawHint;
  if (!rawHint || normalizedHint === "GROUPREPORTINGCONTROLLER") {
    hintLabel = l(
      "Group reporting controller / consolidation preparer",
      "Grup raporlama kontroloru / konsolidasyon hazirlayicisi",
    );
  }
  if (ownerUserId > 0) {
    return `${l("User", "Kullanici")} #${ownerUserId} / ${hintLabel}`;
  }
  return hintLabel;
}
