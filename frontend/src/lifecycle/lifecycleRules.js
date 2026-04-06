function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function translateLifecycleText(translate, enText, trText) {
  return typeof translate === "function" ? translate(enText, trText) : enText;
}

const LIFECYCLE_DEFINITIONS = {
  cariDocument: {
    id: "cariDocument",
    label: "Cari Document",
    labelTr: "Cari Belge",
    terminalStatuses: ["SETTLED", "CANCELLED", "REVERSED"],
    statuses: [
      {
        code: "DRAFT",
        label: "Draft",
        labelTr: "Taslak",
        description: "Document is editable.",
        descriptionTr: "Belge duzenlenebilir.",
      },
      {
        code: "SUBMITTED",
        label: "Submitted",
        labelTr: "Gonderildi",
        description: "Governed AP review is in progress.",
        descriptionTr: "Yonetime tabi AP incelemesi suruyor.",
      },
      {
        code: "RETURNED",
        label: "Returned",
        labelTr: "Duzeltmeye Iade",
        description: "Document was returned for correction.",
        descriptionTr: "Belge duzeltme icin iade edildi.",
      },
      {
        code: "APPROVED",
        label: "Approved",
        labelTr: "Onaylandi",
        description: "Document is approved and ready for posting.",
        descriptionTr: "Belge onaylandi ve kayda hazir.",
      },
      {
        code: "POSTED",
        label: "Posted",
        labelTr: "Kaydedildi",
        description: "Document has posted journal entries.",
        descriptionTr: "Belgenin yevmiye kayitlari olusturuldu.",
      },
      {
        code: "PARTIALLY_SETTLED",
        label: "Partially Settled",
        labelTr: "Kismen Mahsuplastirildi",
        description: "Document has partial settlement allocations.",
        descriptionTr: "Belgenin kismi mahsuplastirma dagitimlari var.",
      },
      {
        code: "SETTLED",
        label: "Settled",
        labelTr: "Mahsuplastirildi",
        description: "Document is fully settled.",
        descriptionTr: "Belge tamamen mahsuplastirildi.",
      },
      {
        code: "CANCELLED",
        label: "Cancelled",
        labelTr: "Iptal Edildi",
        description: "Draft was cancelled before posting.",
        descriptionTr: "Taslak kayit oncesi iptal edildi.",
      },
      {
        code: "REVERSED",
        label: "Reversed",
        labelTr: "Terslendi",
        description: "Posted document was reversed.",
        descriptionTr: "Kaydedilmis belge terslendi.",
      },
    ],
    transitions: {
      submit: {
        from: ["DRAFT", "RETURNED"],
        to: "SUBMITTED",
        label: "Submit",
        labelTr: "Gonder",
      },
      return: {
        from: ["SUBMITTED", "APPROVED"],
        to: "RETURNED",
        label: "Return",
        labelTr: "Iade Et",
      },
      approve: {
        from: ["SUBMITTED"],
        to: "APPROVED",
        label: "Approve",
        labelTr: "Onayla",
      },
      post: {
        from: ["DRAFT", "APPROVED"],
        to: "POSTED",
        label: "Post",
        labelTr: "Kaydet",
      },
      settlePartial: {
        from: ["POSTED", "PARTIALLY_SETTLED"],
        to: "PARTIALLY_SETTLED",
        label: "Settle (Partial)",
        labelTr: "Mahsuplastir (Kismi)",
      },
      settleFull: {
        from: ["POSTED", "PARTIALLY_SETTLED"],
        to: "SETTLED",
        label: "Settle (Full)",
        labelTr: "Mahsuplastir (Tam)",
      },
      cancel: {
        from: ["DRAFT", "RETURNED"],
        to: "CANCELLED",
        label: "Cancel",
        labelTr: "Iptal Et",
      },
      reverse: { from: ["POSTED"], to: "REVERSED", label: "Reverse", labelTr: "Tersle" },
    },
  },
  cashTransaction: {
    id: "cashTransaction",
    label: "Cash Transaction",
    labelTr: "Kasa Islemi",
    terminalStatuses: ["POSTED", "CANCELLED", "REVERSED"],
    statuses: [
      {
        code: "DRAFT",
        label: "Draft",
        labelTr: "Taslak",
        description: "Awaiting submit/review.",
        descriptionTr: "Gonderim/inceleme bekliyor.",
      },
      {
        code: "SUBMITTED",
        label: "Submitted",
        labelTr: "Gonderildi",
        description: "Submitted for approval.",
        descriptionTr: "Onay icin gonderildi.",
      },
      {
        code: "APPROVED",
        label: "Approved",
        labelTr: "Onaylandi",
        description: "Approved for posting.",
        descriptionTr: "Kayit icin onaylandi.",
      },
      {
        code: "POSTED",
        label: "Posted",
        labelTr: "Kaydedildi",
        description: "Posted to ledger.",
        descriptionTr: "Deftere kaydedildi.",
      },
      {
        code: "REVERSED",
        label: "Reversed",
        labelTr: "Terslendi",
        description: "Reversal posted.",
        descriptionTr: "Ters kayit olusturuldu.",
      },
      {
        code: "CANCELLED",
        label: "Cancelled",
        labelTr: "Iptal Edildi",
        description: "Cancelled before posting.",
        descriptionTr: "Kayit oncesi iptal edildi.",
      },
    ],
    transitions: {
      submit: { from: ["DRAFT"], to: "SUBMITTED", label: "Submit", labelTr: "Gonder" },
      approve: { from: ["SUBMITTED"], to: "APPROVED", label: "Approve", labelTr: "Onayla" },
      post: {
        from: ["DRAFT", "SUBMITTED", "APPROVED"],
        to: "POSTED",
        label: "Post",
        labelTr: "Kaydet",
      },
      cancel: {
        from: ["DRAFT", "SUBMITTED"],
        to: "CANCELLED",
        label: "Cancel",
        labelTr: "Iptal Et",
      },
      reverse: { from: ["POSTED"], to: "REVERSED", label: "Reverse", labelTr: "Tersle" },
    },
  },
  cashSession: {
    id: "cashSession",
    label: "Cash Session",
    labelTr: "Kasa Oturumu",
    terminalStatuses: ["CLOSED"],
    statuses: [
      {
        code: "OPEN",
        label: "Open",
        labelTr: "Acik",
        description: "Session is accepting transactions.",
        descriptionTr: "Oturum islem kabul ediyor.",
      },
      {
        code: "CLOSED",
        label: "Closed",
        labelTr: "Kapali",
        description: "Session was closed and reconciled.",
        descriptionTr: "Oturum kapatildi ve mutabik hale getirildi.",
      },
    ],
    transitions: {
      close: { from: ["OPEN"], to: "CLOSED", label: "Close Session", labelTr: "Oturumu Kapat" },
    },
  },
  payrollRun: {
    id: "payrollRun",
    label: "Payroll Run",
    labelTr: "Bordro Calistirma",
    terminalStatuses: ["FINALIZED"],
    statuses: [
      {
        code: "DRAFT",
        label: "Draft",
        labelTr: "Taslak",
        description: "Adjustment shell or pre-import draft.",
        descriptionTr: "Duzeltme kabugu veya ice aktarim oncesi taslak.",
      },
      {
        code: "IMPORTED",
        label: "Imported",
        labelTr: "Ice Aktarildi",
        description: "Provider file imported.",
        descriptionTr: "Saglayici dosyasi ice aktarildi.",
      },
      {
        code: "REVIEWED",
        label: "Reviewed",
        labelTr: "Incelendi",
        description: "Validated and reviewed.",
        descriptionTr: "Dogrulandi ve incelendi.",
      },
      {
        code: "FINALIZED",
        label: "Finalized",
        labelTr: "Tamamlandi",
        description: "Finalized for posting/close.",
        descriptionTr: "Kayit/kapanis icin tamamlandi.",
      },
    ],
    transitions: {
      import: { from: ["DRAFT"], to: "IMPORTED", label: "Import", labelTr: "Ice Aktar" },
      review: { from: ["IMPORTED"], to: "REVIEWED", label: "Review", labelTr: "Incele" },
      finalize: { from: ["REVIEWED"], to: "FINALIZED", label: "Finalize", labelTr: "Tamamla" },
    },
  },
  payrollClose: {
    id: "payrollClose",
    label: "Payroll Close",
    labelTr: "Bordro Kapanis",
    terminalStatuses: ["CLOSED", "REOPENED"],
    statuses: [
      {
        code: "DRAFT",
        label: "Draft",
        labelTr: "Taslak",
        description: "Checklist is being prepared.",
        descriptionTr: "Kontrol listesi hazirlaniyor.",
      },
      {
        code: "READY",
        label: "Ready",
        labelTr: "Hazir",
        description: "Checks passed and ready for request.",
        descriptionTr: "Kontroller gecti ve talep icin hazir.",
      },
      {
        code: "REQUESTED",
        label: "Requested",
        labelTr: "Talep Edildi",
        description: "Awaiting close approval.",
        descriptionTr: "Kapanis onayi bekleniyor.",
      },
      {
        code: "CLOSED",
        label: "Closed",
        labelTr: "Kapali",
        description: "Payroll period is closed.",
        descriptionTr: "Bordro donemi kapatildi.",
      },
      {
        code: "REOPENED",
        label: "Reopened",
        labelTr: "Yeniden Acildi",
        description: "Closed period has been reopened.",
        descriptionTr: "Kapatilan donem yeniden acildi.",
      },
    ],
    transitions: {
      prepare: { from: ["DRAFT"], to: "READY", label: "Prepare", labelTr: "Hazirla" },
      request: { from: ["READY"], to: "REQUESTED", label: "Request Close", labelTr: "Kapanis Talep Et" },
      approveClose: {
        from: ["REQUESTED"],
        to: "CLOSED",
        label: "Approve & Close",
        labelTr: "Onayla ve Kapat",
      },
      reopen: { from: ["CLOSED"], to: "REOPENED", label: "Reopen", labelTr: "Yeniden Ac" },
    },
  },
};

export const LIFECYCLE_ENTITY_TYPES = Object.freeze(Object.keys(LIFECYCLE_DEFINITIONS));

export function getLifecycleDefinition(entityType) {
  const key = String(entityType || "").trim();
  return LIFECYCLE_DEFINITIONS[key] || null;
}

export function getLifecycleStatusMeta(entityType, statusCode, translate) {
  const definition = getLifecycleDefinition(entityType);
  if (!definition) {
    return null;
  }
  const normalizedStatus = toUpper(statusCode);
  const matched = definition.statuses.find((row) => row.code === normalizedStatus) || null;
  if (!matched) {
    return null;
  }
  return {
    ...matched,
    label: translateLifecycleText(translate, matched.label, matched.labelTr),
    description: translateLifecycleText(
      translate,
      matched.description || "",
      matched.descriptionTr || matched.description || ""
    ),
  };
}

export function getLifecycleAllowedActions(entityType, currentStatus, translate) {
  const definition = getLifecycleDefinition(entityType);
  if (!definition) {
    return [];
  }
  const normalizedStatus = toUpper(currentStatus);
  return Object.entries(definition.transitions)
    .filter(([, transition]) => transition.from.includes(normalizedStatus))
    .map(([action, transition]) => ({
      action,
      label: translateLifecycleText(translate, transition.label, transition.labelTr),
      toStatus: transition.to,
    }));
}

export function buildLifecycleTimelineSteps(entityType, currentStatus, events = [], translate) {
  const definition = getLifecycleDefinition(entityType);
  if (!definition) {
    return [];
  }

  const normalizedStatus = toUpper(currentStatus);
  const statusIndex = definition.statuses.findIndex((status) => status.code === normalizedStatus);
  const timelineRows = definition.statuses.map((status, index) => {
    let state = "upcoming";
    if (status.code === normalizedStatus) {
      state = "current";
    } else if (statusIndex >= 0 && index < statusIndex) {
      state = "done";
    } else if (statusIndex === -1 && index === 0) {
      state = "current";
    }
    return {
      key: status.code,
      statusCode: status.code,
      label: translateLifecycleText(translate, status.label, status.labelTr),
      description: translateLifecycleText(
        translate,
        status.description || "",
        status.descriptionTr || status.description || ""
      ),
      state,
      eventAt: null,
      actorName: null,
      note: null,
    };
  });

  const eventMap = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const eventStatus = toUpper(event?.statusCode || event?.toStatus || event?.status);
    if (!eventStatus) {
      continue;
    }
    const existing = eventMap.get(eventStatus);
    const at = normalizeDate(event?.at || event?.createdAt || event?.created_at);
    const actorName = normalizeOptionalText(
      event?.actorName || event?.actor || event?.performedBy || event?.performed_by
    );
    const note = normalizeOptionalText(event?.note || event?.reason || event?.description);
    if (!existing) {
      eventMap.set(eventStatus, {
        at,
        actorName,
        note,
      });
      continue;
    }
    const existingDate = existing.at ? Date.parse(existing.at) : Number.NaN;
    const incomingDate = at ? Date.parse(at) : Number.NaN;
    if (Number.isFinite(existingDate) && Number.isFinite(incomingDate) && incomingDate > existingDate) {
      eventMap.set(eventStatus, { at, actorName, note });
    }
  }

  return timelineRows.map((row) => {
    const match = eventMap.get(row.statusCode);
    if (!match) {
      return row;
    }
    return {
      ...row,
      eventAt: match.at || null,
      actorName: match.actorName || null,
      note: match.note || null,
    };
  });
}
