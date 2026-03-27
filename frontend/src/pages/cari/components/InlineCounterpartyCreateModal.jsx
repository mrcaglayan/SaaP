import { useEffect, useMemo, useState } from "react";
import { createCariCounterparty } from "../../../api/cariCounterparty.js";
import { listCariPaymentTerms } from "../../../api/cariPaymentTerms.js";
import { listAccounts, upsertAccount } from "../../../api/glAdmin.js";
import { listLegalEntities, listOperatingUnits } from "../../../api/orgAdmin.js";
import { useAuth } from "../../../auth/useAuth.js";
import CounterpartyForm from "../CounterpartyForm.jsx";
import {
  buildInitialCounterpartyForm,
  mapCounterpartyApiError,
  resolveCounterpartyAccountPickerGates,
  toPositiveInt,
} from "../counterpartyFormUtils.js";
import {
  buildInlineCounterpartyCode,
  resolveInlineCounterpartyRoleFlags,
} from "../counterpartyInlineCreate.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveRoleDefault(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (normalized === "AP") {
    return "VENDOR";
  }
  if (normalized === "AR") {
    return "CUSTOMER";
  }
  return "CUSTOMER";
}

function createSeedForm({ legalEntityId, direction, name }) {
  const roleDefault = resolveRoleDefault(direction);
  const normalizedLegalEntityId = normalizeText(legalEntityId);
  const normalizedName = normalizeText(name);
  return {
    ...buildInitialCounterpartyForm(roleDefault),
    legalEntityId: normalizedLegalEntityId,
    code: buildInlineCounterpartyCode({
      legalEntityId: normalizedLegalEntityId || "LE",
      name: normalizedName || roleDefault,
    }),
    name: normalizedName,
    status: "ACTIVE",
    ...resolveInlineCounterpartyRoleFlags(direction),
  };
}

function resolveLegalEntityCurrencyCode(legalEntity) {
  const normalized = String(
    legalEntity?.functional_currency_code || legalEntity?.functionalCurrencyCode || ""
  )
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, 3);
}

function mapAccountRows(response) {
  if (!Array.isArray(response?.rows)) {
    return [];
  }
  return response.rows.map((row) => ({
    id: Number(row?.id || 0),
    coaId: Number(row?.coa_id || row?.coaId || 0),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    accountType: String(row?.account_type || row?.accountType || "").toUpperCase(),
    normalSide: String(row?.normal_side || row?.normalSide || "").toUpperCase(),
    allowPosting: Boolean(row?.allow_posting ?? row?.allowPosting),
    isActive: Boolean(row?.is_active ?? row?.isActive),
    parentAccountId: Number(row?.parent_account_id || row?.parentAccountId || 0) || null,
    breadcrumb: String(row?.account_breadcrumb || row?.accountBreadcrumb || "").trim(),
    breadcrumbCodes: String(
      row?.account_breadcrumb_codes || row?.accountBreadcrumbCodes || ""
    ).trim(),
    breadcrumbNames: String(
      row?.account_breadcrumb_names || row?.accountBreadcrumbNames || ""
    ).trim(),
  }));
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function deriveSearchCodeCandidate(value) {
  const normalized = normalizeAccountCode(value);
  if (!normalized || /\s/.test(normalized)) {
    return "";
  }
  return normalized;
}

function findBestParentAccount(candidateCode, parentAccountOptions) {
  if (!candidateCode) {
    return null;
  }
  let bestParent = null;
  for (const row of parentAccountOptions || []) {
    const parentCode = normalizeAccountCode(row?.code);
    if (!parentCode || candidateCode === parentCode) {
      continue;
    }
    const matchesPrefix =
      candidateCode.startsWith(`${parentCode}.`) ||
      candidateCode.startsWith(`${parentCode}-`) ||
      candidateCode.startsWith(parentCode);
    if (!matchesPrefix) {
      continue;
    }
    if (
      !bestParent ||
      parentCode.length > normalizeAccountCode(bestParent?.code).length
    ) {
      bestParent = row;
    }
  }
  return bestParent;
}

function isActivePostableAccount(row) {
  const allowPosting = row?.allowPosting === true || Number(row?.allowPosting) === 1;
  const isActive = row?.isActive === true || Number(row?.isActive) === 1;
  return allowPosting && isActive;
}

function isActiveAccount(row) {
  return row?.isActive === true || Number(row?.isActive) === 1;
}

function buildInlineParentAccountOptions(rows, expectedType) {
  const type = normalizeAccountCode(expectedType);
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        normalizeAccountCode(row?.accountType) === type &&
        isActiveAccount(row) &&
        toPositiveInt(row?.id)
    )
    .sort((left, right) =>
      normalizeAccountCode(left?.code).localeCompare(normalizeAccountCode(right?.code))
    );
}

function findExactInlineCodeMatch(rows, candidateCode, expectedType) {
  const normalizedCode = normalizeAccountCode(candidateCode);
  const normalizedType = normalizeAccountCode(expectedType);
  if (!normalizedCode || !normalizedType) {
    return null;
  }
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) =>
        normalizeAccountCode(row?.code) === normalizedCode &&
        normalizeAccountCode(row?.accountType) === normalizedType &&
        isActivePostableAccount(row) &&
        toPositiveInt(row?.id)
    ) || null
  );
}

function resolveInlineControlAccountSpec(direction) {
  const normalizedDirection = String(direction || "").trim().toUpperCase();
  if (normalizedDirection === "AR") {
    return {
      direction: "AR",
      controlCode: "120",
      accountType: "ASSET",
      normalSide: "DEBIT",
      fieldName: "arAccountId",
    };
  }
  return {
    direction: "AP",
    controlCode: "320",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    fieldName: "apAccountId",
  };
}

function selectInlineControlParentAccount(accounts, spec) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const expectedType = normalizeAccountCode(spec?.accountType);
  const preferredControlCode = normalizeAccountCode(spec?.controlCode);

  const exactControl = rows.find(
    (row) =>
      normalizeAccountCode(row?.code) === preferredControlCode &&
      normalizeAccountCode(row?.accountType) === expectedType &&
      toPositiveInt(row?.id)
  );
  if (exactControl) {
    return exactControl;
  }

  const rootByType = rows.find(
    (row) =>
      !toPositiveInt(row?.parentAccountId) &&
      normalizeAccountCode(row?.accountType) === expectedType &&
      toPositiveInt(row?.id)
  );
  if (rootByType) {
    return rootByType;
  }

  return (
    rows.find(
      (row) =>
        normalizeAccountCode(row?.accountType) === expectedType &&
        toPositiveInt(row?.id)
    ) || null
  );
}

function parseInlineChildSequence(code, parentCode) {
  const normalizedCode = normalizeAccountCode(code);
  const normalizedParentCode = normalizeAccountCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }

  let suffix = "";
  if (normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(`${normalizedParentCode}-`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(normalizedParentCode)) {
    suffix = normalizedCode.slice(normalizedParentCode.length);
  } else {
    return null;
  }

  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const numeric = Number(suffix);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return {
    value: numeric,
    width: suffix.length,
  };
}

function buildNextInlineChildCode(accounts, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentId) {
    return "";
  }

  const rows = Array.isArray(accounts) ? accounts : [];
  const existingCodes = new Set(
    rows.map((row) => normalizeAccountCode(row?.code)).filter(Boolean)
  );

  const parsedChildren = rows
    .filter((row) => toPositiveInt(row?.parentAccountId) === parentId)
    .map((row) => parseInlineChildSequence(row?.code, parentCode))
    .filter(Boolean);

  const maxSequence = parsedChildren.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.value || 0)),
    0
  );
  const width = Math.max(
    2,
    parsedChildren.reduce(
      (maxWidth, row) => Math.max(maxWidth, Number(row?.width || 0)),
      0
    )
  );

  let next = Math.max(1, maxSequence + 1);
  while (next <= 999999) {
    const candidate = `${parentCode}.${String(next).padStart(width, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    next += 1;
  }
  return "";
}

export default function InlineCounterpartyCreateModal({
  open = false,
  legalEntityId = "",
  direction = "",
  initialName = "",
  l = (en) => en,
  onClose,
  onCreated,
}) {
  const { hasPermission, permissions } = useAuth();
  const canUpsert = hasPermission("cari.card.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");
  const accountPickerGates = useMemo(
    () => resolveCounterpartyAccountPickerGates(permissions),
    [permissions]
  );

  const [form, setForm] = useState(() =>
    createSeedForm({ legalEntityId, direction, name: initialName })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [legalEntities, setLegalEntities] = useState([]);
  const [legalEntitiesLoading, setLegalEntitiesLoading] = useState(false);
  const [legalEntitiesError, setLegalEntitiesError] = useState("");

  const [operatingUnits, setOperatingUnits] = useState([]);
  const [operatingUnitsLoading, setOperatingUnitsLoading] = useState(false);
  const [operatingUnitsError, setOperatingUnitsError] = useState("");

  const [paymentTerms, setPaymentTerms] = useState([]);
  const [paymentTermsLoading, setPaymentTermsLoading] = useState(false);
  const [paymentTermsError, setPaymentTermsError] = useState("");

  const [accountOptions, setAccountOptions] = useState([]);
  const [accountOptionsLoading, setAccountOptionsLoading] = useState(false);
  const [accountOptionsError, setAccountOptionsError] = useState("");
  const [arAccountLookupQuery, setArAccountLookupQuery] = useState("");
  const [apAccountLookupQuery, setApAccountLookupQuery] = useState("");
  const [inlineArParentAccountId, setInlineArParentAccountId] = useState("");
  const [inlineArChildCode, setInlineArChildCode] = useState("");
  const [inlineArChildName, setInlineArChildName] = useState("");
  const [inlineApParentAccountId, setInlineApParentAccountId] = useState("");
  const [inlineApChildCode, setInlineApChildCode] = useState("");
  const [inlineApChildName, setInlineApChildName] = useState("");
  const [inlineArAccountSaving, setInlineArAccountSaving] = useState(false);
  const [inlineArAccountError, setInlineArAccountError] = useState("");
  const [inlineArAccountMessage, setInlineArAccountMessage] = useState("");
  const [inlineApAccountSaving, setInlineApAccountSaving] = useState(false);
  const [inlineApAccountError, setInlineApAccountError] = useState("");
  const [inlineApAccountMessage, setInlineApAccountMessage] = useState("");

  const legalEntityById = useMemo(() => {
    const nextMap = new Map();
    for (const row of legalEntities) {
      nextMap.set(String(row?.id || ""), row);
    }
    return nextMap;
  }, [legalEntities]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(createSeedForm({ legalEntityId, direction, name: initialName }));
    setSaving(false);
    setError("");
    setMessage("");
    setOperatingUnits([]);
    setOperatingUnitsLoading(false);
    setOperatingUnitsError("");
    setPaymentTerms([]);
    setPaymentTermsLoading(false);
    setPaymentTermsError("");
    setAccountOptions([]);
    setAccountOptionsLoading(false);
    setAccountOptionsError("");
    setArAccountLookupQuery("");
    setApAccountLookupQuery("");
    setInlineArParentAccountId("");
    setInlineArChildCode("");
    setInlineArChildName("");
    setInlineApParentAccountId("");
    setInlineApChildCode("");
    setInlineApChildName("");
    setInlineArAccountSaving(false);
    setInlineArAccountError("");
    setInlineArAccountMessage("");
    setInlineApAccountSaving(false);
    setInlineApAccountError("");
    setInlineApAccountMessage("");
  }, [open, legalEntityId, direction, initialName]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!canReadOrgTree) {
      setLegalEntities([]);
      setLegalEntitiesError("");
      setLegalEntitiesLoading(false);
      return;
    }

    let cancelled = false;
    async function loadLegalEntityOptions() {
      setLegalEntitiesLoading(true);
      setLegalEntitiesError("");
      try {
        const response = await listLegalEntities({ limit: 500, includeInactive: true });
        if (cancelled) {
          return;
        }
        setLegalEntities(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setLegalEntities([]);
        setLegalEntitiesError(
          String(err?.response?.data?.message || l("Failed to load legal entities.", "Tuzel kisilikler yuklenemedi."))
        );
      } finally {
        if (!cancelled) {
          setLegalEntitiesLoading(false);
        }
      }
    }

    void loadLegalEntityOptions();
    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, l, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedLegalEntityId = normalizeText(form.legalEntityId);
    if (!selectedLegalEntityId) {
      setOperatingUnits([]);
      setOperatingUnitsError("");
      setOperatingUnitsLoading(false);
      setPaymentTerms([]);
      setPaymentTermsError("");
      setPaymentTermsLoading(false);
      setAccountOptions([]);
      setAccountOptionsError("");
      setAccountOptionsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadOperatingUnitOptions() {
      if (!canReadOrgTree) {
        setOperatingUnits([]);
        setOperatingUnitsError(
          l(
            "Operating unit list permission missing. Enter branch ids manually on the full card page if needed.",
            "Operating unit liste yetkisi eksik. Gerekirse tam kart sayfasinda sube id'lerini manuel girin."
          )
        );
        setOperatingUnitsLoading(false);
        return;
      }
      setOperatingUnitsLoading(true);
      setOperatingUnitsError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId: selectedLegalEntityId,
          includeInactive: true,
          limit: 500,
        });
        if (cancelled) {
          return;
        }
        setOperatingUnits(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setOperatingUnits([]);
        setOperatingUnitsError(
          String(
            err?.response?.data?.message ||
              l(
                "Failed to load operating units for the selected legal entity.",
                "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
              )
          )
        );
      } finally {
        if (!cancelled) {
          setOperatingUnitsLoading(false);
        }
      }
    }

    async function loadPaymentTermOptions() {
      setPaymentTermsLoading(true);
      setPaymentTermsError("");
      try {
        const response = await listCariPaymentTerms({
          legalEntityId: selectedLegalEntityId,
          limit: 300,
          offset: 0,
        });
        if (cancelled) {
          return;
        }
        setPaymentTerms(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setPaymentTerms([]);
        setPaymentTermsError(
          mapCounterpartyApiError(
            err,
            l(
              "Failed to load payment terms for the selected legal entity.",
              "Secili tuzel kisilik icin odeme kosullari yuklenemedi."
            )
          )
        );
      } finally {
        if (!cancelled) {
          setPaymentTermsLoading(false);
        }
      }
    }

    async function loadAccountChoices() {
      if (!accountPickerGates.shouldFetchGlAccounts) {
        setAccountOptions([]);
        setAccountOptionsError("");
        setAccountOptionsLoading(false);
        return;
      }
      setAccountOptionsLoading(true);
      setAccountOptionsError("");
      try {
        const response = await listAccounts({
          legalEntityId: selectedLegalEntityId,
          includeInactive: true,
          limit: 1000,
        });
        if (cancelled) {
          return;
        }
        setAccountOptions(mapAccountRows(response));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setAccountOptions([]);
        setAccountOptionsError(
          mapCounterpartyApiError(
            err,
            l(
              "Failed to load account options for the selected legal entity.",
              "Secili tuzel kisilik icin hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (!cancelled) {
          setAccountOptionsLoading(false);
        }
      }
    }

    void loadOperatingUnitOptions();
    void loadPaymentTermOptions();
    void loadAccountChoices();

    return () => {
      cancelled = true;
    };
  }, [
    accountPickerGates.shouldFetchGlAccounts,
    canReadOrgTree,
    form.legalEntityId,
    l,
    open,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedLegalEntity = legalEntityById.get(normalizeText(form.legalEntityId));
    const defaultCurrencyCode = resolveLegalEntityCurrencyCode(selectedLegalEntity);
    if (!defaultCurrencyCode) {
      return;
    }
    setForm((prev) => {
      if (normalizeText(prev.defaultCurrencyCode)) {
        return prev;
      }
      if (normalizeText(prev.legalEntityId) !== normalizeText(form.legalEntityId)) {
        return prev;
      }
      return {
        ...prev,
        defaultCurrencyCode: defaultCurrencyCode,
      };
    });
  }, [form.legalEntityId, legalEntityById, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setArAccountLookupQuery("");
    setApAccountLookupQuery("");
    setInlineArParentAccountId("");
    setInlineArChildCode("");
    setInlineArChildName("");
    setInlineApParentAccountId("");
    setInlineApChildCode("");
    setInlineApChildName("");
    setInlineArAccountSaving(false);
    setInlineArAccountError("");
    setInlineArAccountMessage("");
    setInlineApAccountSaving(false);
    setInlineApAccountError("");
    setInlineApAccountMessage("");
  }, [form.legalEntityId, open]);

  function handleAccountLookupInput(nextValue, meta = {}, lookupDirection = "AR") {
    const reason = String(meta?.reason || "").trim().toLowerCase();
    const targetDirection = String(lookupDirection || "AR").trim().toUpperCase();
    if (reason === "select" || reason === "clear") {
      if (targetDirection === "AP") {
        setApAccountLookupQuery("");
        setInlineApParentAccountId("");
        setInlineApChildCode("");
        setInlineApChildName("");
      } else {
        setArAccountLookupQuery("");
        setInlineArParentAccountId("");
        setInlineArChildCode("");
        setInlineArChildName("");
      }
      return;
    }
    setInlineArAccountError("");
    setInlineArAccountMessage("");
    setInlineApAccountError("");
    setInlineApAccountMessage("");
    const normalized = normalizeText(nextValue);
    if (targetDirection === "AP") {
      setApAccountLookupQuery(normalized);
      setInlineApParentAccountId("");
      setInlineApChildCode("");
      setInlineApChildName(normalized);
    } else {
      setArAccountLookupQuery(normalized);
      setInlineArParentAccountId("");
      setInlineArChildCode("");
      setInlineArChildName(normalized);
    }
  }

  async function runInlineControlAccountCreate({
    legalEntityId: targetLegalEntityId,
    lookupName,
    direction: targetDirection,
    parentAccountIdValue = "",
    childCodeValue = "",
    childNameValue = "",
    setSaving: setInlineSaving,
    setError: setInlineError,
    setMessage: setInlineMessage,
    setLookupQuery,
    clearInlinePanel,
  }) {
    if (!accountPickerGates.canUpsertGlAccounts) {
      setInlineError(
        l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert")
      );
      return;
    }

    const parsedLegalEntityId = toPositiveInt(targetLegalEntityId);
    const normalizedLookupName = normalizeText(lookupName);
    const normalizedName = normalizeText(childNameValue) || normalizedLookupName;
    const requestedCode = normalizeAccountCode(
      childCodeValue || deriveSearchCodeCandidate(lookupName)
    );
    if (!parsedLegalEntityId) {
      setInlineError(
        l("Select legal entity first.", "Once tuzel kisilik secin.")
      );
      return;
    }
    if (!normalizedName) {
      setInlineError(l("Type account name first.", "Once hesap adini yazin."));
      return;
    }

    const spec = resolveInlineControlAccountSpec(targetDirection);
    setInlineSaving(true);
    setInlineError("");
    setInlineMessage("");
    try {
      const fullAccountResponse = await listAccounts({
        legalEntityId: parsedLegalEntityId,
        includeInactive: true,
        limit: 1000,
        offset: 0,
      });
      const fullAccountRows = mapAccountRows(fullAccountResponse);
      if (requestedCode) {
        const exactExisting = findExactInlineCodeMatch(
          fullAccountRows,
          requestedCode,
          spec.accountType
        );
        if (exactExisting) {
          const exactExistingId = toPositiveInt(exactExisting.id);
          setForm((prev) => ({
            ...prev,
            [spec.fieldName]: String(exactExistingId),
          }));
          setLookupQuery("");
          setAccountOptions((prevRows) => {
            const nextRows = Array.isArray(prevRows) ? [...prevRows] : [];
            const alreadyInRows = nextRows.some(
              (row) => toPositiveInt(row?.id) === exactExistingId
            );
            return alreadyInRows ? nextRows : [exactExisting, ...nextRows];
          });
          setInlineMessage(
            l(
              `${spec.direction} account selected: ${exactExisting.code || "-"} - ${exactExisting.name || "-"}`,
              `${spec.direction} hesabi secildi: ${exactExisting.code || "-"} - ${exactExisting.name || "-"}`
            )
          );
          return;
        }
      }

      const selectedParentId = toPositiveInt(parentAccountIdValue);
      const parentAccountOptions = buildInlineParentAccountOptions(
        fullAccountRows,
        spec.accountType
      );
      let parentAccount =
        parentAccountOptions.find(
          (row) => toPositiveInt(row?.id) === selectedParentId
        ) || null;
      if (!parentAccount && requestedCode) {
        parentAccount = findBestParentAccount(requestedCode, parentAccountOptions);
      }
      if (!parentAccount) {
        parentAccount =
          selectInlineControlParentAccount(parentAccountOptions, spec) ||
          selectInlineControlParentAccount(fullAccountRows, spec);
      }
      if (!parentAccount) {
        throw new Error(
          l(
            `${spec.controlCode} control parent not found for ${spec.direction}.`,
            `${spec.direction} icin ${spec.controlCode} kontrol parent hesabi bulunamadi.`
          )
        );
      }

      const coaId = toPositiveInt(parentAccount?.coaId);
      if (!coaId) {
        throw new Error(
          l(
            "Unable to resolve coaId for selected parent account.",
            "Secilen parent hesap icin coaId cozulmedi."
          )
        );
      }

      let nextCode = requestedCode;
      if (!nextCode) {
        nextCode = buildNextInlineChildCode(fullAccountRows, parentAccount);
      }
      if (!nextCode) {
        throw new Error(
          l(
            "Unable to generate next child account code.",
            "Sonraki child hesap kodu uretilemedi."
          )
        );
      }
      const parentCode = normalizeAccountCode(parentAccount?.code);
      if (parentCode && nextCode === parentCode) {
        throw new Error(
          l(
            "Child account code must differ from parent account code.",
            "Child hesap kodu parent hesap kodundan farkli olmalidir."
          )
        );
      }

      const upsertResponse = await upsertAccount({
        coaId,
        code: nextCode,
        name: normalizedName,
        accountType: spec.accountType,
        normalSide: parentAccount?.normalSide || spec.normalSide,
        allowPosting: true,
        parentAccountId: toPositiveInt(parentAccount?.id) || undefined,
      });

      const refreshedResponse = await listAccounts({
        legalEntityId: parsedLegalEntityId,
        includeInactive: true,
        limit: 1000,
        offset: 0,
      });
      const refreshedRows = mapAccountRows(refreshedResponse);
      setAccountOptions(refreshedRows);

      const createdRow =
        refreshedRows.find(
          (row) =>
            normalizeAccountCode(row?.code) === nextCode &&
            normalizeAccountCode(row?.accountType) === spec.accountType &&
            toPositiveInt(row?.id)
        ) || null;
      const createdAccountId =
        toPositiveInt(upsertResponse?.id) ||
        toPositiveInt(upsertResponse?.row?.id) ||
        toPositiveInt(createdRow?.id);
      if (!createdAccountId) {
        throw new Error(
          l(
            "Account create response missing id.",
            "Hesap olusturma yanitinda id yok."
          )
        );
      }

      setForm((prev) => ({
        ...prev,
        [spec.fieldName]: String(createdAccountId),
      }));
      setLookupQuery("");
      clearInlinePanel?.();
      setInlineMessage(
        l(
          `${spec.direction} sub-account created: ${nextCode} - ${normalizedName} (parent ${parentAccount.code || "-"})`,
          `${spec.direction} alt hesap olusturuldu: ${nextCode} - ${normalizedName} (parent ${parentAccount.code || "-"})`
        )
      );
    } catch (err) {
      setInlineError(
        mapCounterpartyApiError(
          err,
          l(
            `Failed to create ${targetDirection} sub-account.`,
            `${targetDirection} alt hesap olusturulamadi.`
          )
        )
      );
    } finally {
      setInlineSaving(false);
    }
  }

  async function handleInlineCreateArAccount() {
    await runInlineControlAccountCreate({
      legalEntityId: form.legalEntityId,
      lookupName: arAccountLookupQuery,
      direction: "AR",
      parentAccountIdValue: inlineArParentAccountId,
      childCodeValue: inlineArChildCode,
      childNameValue: inlineArChildName,
      setSaving: setInlineArAccountSaving,
      setError: setInlineArAccountError,
      setMessage: setInlineArAccountMessage,
      setLookupQuery: setArAccountLookupQuery,
      clearInlinePanel: () => {
        setInlineArParentAccountId("");
        setInlineArChildCode("");
        setInlineArChildName("");
      },
    });
  }

  async function handleInlineCreateApAccount() {
    await runInlineControlAccountCreate({
      legalEntityId: form.legalEntityId,
      lookupName: apAccountLookupQuery,
      direction: "AP",
      parentAccountIdValue: inlineApParentAccountId,
      childCodeValue: inlineApChildCode,
      childNameValue: inlineApChildName,
      setSaving: setInlineApAccountSaving,
      setError: setInlineApAccountError,
      setMessage: setInlineApAccountMessage,
      setLookupQuery: setApAccountLookupQuery,
      clearInlinePanel: () => {
        setInlineApParentAccountId("");
        setInlineApChildCode("");
        setInlineApChildName("");
      },
    });
  }

  const inlineArAccountName = normalizeText(arAccountLookupQuery);
  const inlineApAccountName = normalizeText(apAccountLookupQuery);
  const arCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(arAccountLookupQuery),
    [arAccountLookupQuery]
  );
  const apCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(apAccountLookupQuery),
    [apAccountLookupQuery]
  );
  const arParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(accountOptions, "ASSET"),
    [accountOptions]
  );
  const apParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(accountOptions, "LIABILITY"),
    [accountOptions]
  );
  const arExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(accountOptions, arCodeCandidate, "ASSET"),
    [accountOptions, arCodeCandidate]
  );
  const apExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(accountOptions, apCodeCandidate, "LIABILITY"),
    [accountOptions, apCodeCandidate]
  );
  const showInlineCreateArAccountPanel =
    Boolean(toPositiveInt(form.legalEntityId)) &&
    Boolean(form.isCustomer) &&
    Boolean(inlineArAccountName) &&
    !(Boolean(arCodeCandidate) && Boolean(arExactCodeMatch));
  const showInlineCreateApAccountPanel =
    Boolean(toPositiveInt(form.legalEntityId)) &&
    Boolean(form.isVendor) &&
    Boolean(inlineApAccountName) &&
    !(Boolean(apCodeCandidate) && Boolean(apExactCodeMatch));
  const selectedArInlineParentAccount = useMemo(
    () =>
      arParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(inlineArParentAccountId)
      ) || null,
    [arParentAccountOptions, inlineArParentAccountId]
  );
  const selectedApInlineParentAccount = useMemo(
    () =>
      apParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(inlineApParentAccountId)
      ) || null,
    [apParentAccountOptions, inlineApParentAccountId]
  );
  const arSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(accountOptions, selectedArInlineParentAccount),
    [accountOptions, selectedArInlineParentAccount]
  );
  const apSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(accountOptions, selectedApInlineParentAccount),
    [accountOptions, selectedApInlineParentAccount]
  );
  const canInlineCreateArAccount =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(toPositiveInt(form.legalEntityId)) &&
    Boolean(form.isCustomer) &&
    Boolean(inlineArAccountName) &&
    !(Boolean(arCodeCandidate) && Boolean(arExactCodeMatch));
  const canInlineCreateApAccount =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(toPositiveInt(form.legalEntityId)) &&
    Boolean(form.isVendor) &&
    Boolean(inlineApAccountName) &&
    !(Boolean(apCodeCandidate) && Boolean(apExactCodeMatch));

  useEffect(() => {
    if (!showInlineCreateArAccountPanel) {
      return;
    }
    setInlineArChildCode((prev) => prev || arCodeCandidate);
    setInlineArChildName(
      (prev) => prev || String(inlineArAccountName || form.name || "").trim()
    );
  }, [showInlineCreateArAccountPanel, arCodeCandidate, inlineArAccountName, form.name]);

  useEffect(() => {
    if (!showInlineCreateArAccountPanel || !arSuggestedNextCode) {
      return;
    }
    setInlineArChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(arCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return arSuggestedNextCode;
      }
      return prev;
    });
  }, [showInlineCreateArAccountPanel, arSuggestedNextCode, arCodeCandidate]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanel) {
      return;
    }
    setInlineApChildCode((prev) => prev || apCodeCandidate);
    setInlineApChildName(
      (prev) => prev || String(inlineApAccountName || form.name || "").trim()
    );
  }, [showInlineCreateApAccountPanel, apCodeCandidate, inlineApAccountName, form.name]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanel || !apSuggestedNextCode) {
      return;
    }
    setInlineApChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(apCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return apSuggestedNextCode;
      }
      return prev;
    });
  }, [showInlineCreateApAccountPanel, apSuggestedNextCode, apCodeCandidate]);

  useEffect(() => {
    if (!showInlineCreateArAccountPanel || toPositiveInt(inlineArParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(inlineArChildCode || arCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, arParentAccountOptions) ||
      selectInlineControlParentAccount(
        arParentAccountOptions,
        resolveInlineControlAccountSpec("AR")
      );
    if (toPositiveInt(bestParent?.id)) {
      setInlineArParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateArAccountPanel,
    inlineArParentAccountId,
    inlineArChildCode,
    arCodeCandidate,
    arParentAccountOptions,
  ]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanel || toPositiveInt(inlineApParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(inlineApChildCode || apCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, apParentAccountOptions) ||
      selectInlineControlParentAccount(
        apParentAccountOptions,
        resolveInlineControlAccountSpec("AP")
      );
    if (toPositiveInt(bestParent?.id)) {
      setInlineApParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateApAccountPanel,
    inlineApParentAccountId,
    inlineApChildCode,
    apCodeCandidate,
    apParentAccountOptions,
  ]);

  async function handleSubmit(payload) {
    if (!canUpsert) {
      setError(l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await createCariCounterparty(payload);
      const row = response?.row || null;
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        throw new Error(
          l(
            "Counterparty create response is missing row.id.",
            "Cari olusturma yanitinda row.id yok."
          )
        );
      }
      onCreated?.(row);
      onClose?.();
    } catch (err) {
      setError(
        mapCounterpartyApiError(
          err,
          l("Failed to create counterparty.", "Cari olusturulamadi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-slate-100 p-4 shadow-2xl">
        <CounterpartyForm
          title={l("Create Counterparty", "Cari Olustur")}
          description={l(
            "Fill the card details before using this counterparty in the current flow.",
            "Bu cari karti mevcut akista kullanmadan once kart detaylarini doldurun."
          )}
          mode="create"
          form={form}
          setForm={setForm}
          legalEntities={legalEntities}
          legalEntitiesLoading={legalEntitiesLoading}
          legalEntitiesError={legalEntitiesError}
          operatingUnits={operatingUnits}
          operatingUnitsLoading={operatingUnitsLoading}
          operatingUnitsError={operatingUnitsError}
          paymentTerms={paymentTerms}
          paymentTermsLoading={paymentTermsLoading}
          paymentTermsError={paymentTermsError}
          accountOptions={accountOptions}
          accountOptionsLoading={accountOptionsLoading}
          accountOptionsError={accountOptionsError}
          onAccountLookupQueryChange={handleAccountLookupInput}
          canUpsertGlAccounts={accountPickerGates.canUpsertGlAccounts}
          canInlineCreateArAccount={canInlineCreateArAccount}
          inlineCreateArAccountLabel={inlineArAccountName}
          inlineCreateArAccountSaving={inlineArAccountSaving}
          onInlineCreateArAccount={handleInlineCreateArAccount}
          inlineCreateArAccountError={inlineArAccountError}
          inlineCreateArAccountMessage={inlineArAccountMessage}
          showInlineCreateArAccountPanel={showInlineCreateArAccountPanel}
          inlineCreateArCodeCandidate={arCodeCandidate}
          inlineCreateArSearchText={inlineArAccountName}
          inlineCreateArParentAccountOptions={arParentAccountOptions}
          inlineCreateArParentAccountId={inlineArParentAccountId}
          onInlineCreateArParentAccountIdChange={setInlineArParentAccountId}
          inlineCreateArChildCode={inlineArChildCode}
          onInlineCreateArChildCodeChange={setInlineArChildCode}
          inlineCreateArChildName={inlineArChildName}
          onInlineCreateArChildNameChange={setInlineArChildName}
          inlineCreateArSuggestedNextCode={arSuggestedNextCode}
          onInlineCreateArUseTypedCode={() => setInlineArChildCode(arCodeCandidate)}
          onInlineCreateArUseNextCode={() => setInlineArChildCode(arSuggestedNextCode)}
          canInlineCreateApAccount={canInlineCreateApAccount}
          inlineCreateApAccountLabel={inlineApAccountName}
          inlineCreateApAccountSaving={inlineApAccountSaving}
          onInlineCreateApAccount={handleInlineCreateApAccount}
          inlineCreateApAccountError={inlineApAccountError}
          inlineCreateApAccountMessage={inlineApAccountMessage}
          showInlineCreateApAccountPanel={showInlineCreateApAccountPanel}
          inlineCreateApCodeCandidate={apCodeCandidate}
          inlineCreateApSearchText={inlineApAccountName}
          inlineCreateApParentAccountOptions={apParentAccountOptions}
          inlineCreateApParentAccountId={inlineApParentAccountId}
          onInlineCreateApParentAccountIdChange={setInlineApParentAccountId}
          inlineCreateApChildCode={inlineApChildCode}
          onInlineCreateApChildCodeChange={setInlineApChildCode}
          inlineCreateApChildName={inlineApChildName}
          onInlineCreateApChildNameChange={setInlineApChildName}
          inlineCreateApSuggestedNextCode={apSuggestedNextCode}
          onInlineCreateApUseTypedCode={() => setInlineApChildCode(apCodeCandidate)}
          onInlineCreateApUseNextCode={() => setInlineApChildCode(apSuggestedNextCode)}
          canReadGlAccounts={accountPickerGates.showAccountPickers}
          accountUpsertFallbackMessage={l(
            "Missing permission: gl.account.upsert",
            "Eksik yetki: gl.account.upsert"
          )}
          accountReadFallbackMessage={l(
            "Missing permission: gl.account.read. AR/AP account selectors are hidden.",
            "Eksik yetki: gl.account.read. AR/AP hesap secicileri gizlendi."
          )}
          canSubmit={canUpsert}
          submitting={saving}
          onSubmit={handleSubmit}
          onReset={() => {
            setForm(createSeedForm({ legalEntityId, direction, name: initialName }));
            setError("");
            setMessage("");
            setArAccountLookupQuery("");
            setApAccountLookupQuery("");
            setInlineArParentAccountId("");
            setInlineArChildCode("");
            setInlineArChildName("");
            setInlineApParentAccountId("");
            setInlineApChildCode("");
            setInlineApChildName("");
            setInlineArAccountSaving(false);
            setInlineArAccountError("");
            setInlineArAccountMessage("");
            setInlineApAccountSaving(false);
            setInlineApAccountError("");
            setInlineApAccountMessage("");
          }}
          onCancel={() => {
            if (!saving) {
              onClose?.();
            }
          }}
          submitLabel={l("Create + Select", "Olustur + Sec")}
          serverError={error}
          serverMessage={message}
          roleHint={l(
            `Default role preset: ${resolveRoleDefault(direction)}`,
            `Varsayilan rol onayari: ${resolveRoleDefault(direction)}`
          )}
          enforceRoleAccountRequirement={false}
        />
      </div>
    </div>
  );
}
