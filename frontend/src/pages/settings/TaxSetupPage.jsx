
import { useCallback, useEffect, useMemo, useState } from "react";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import { listCountries, listLegalEntities } from "../../api/orgAdmin.js";
import {
createTaxAccountMapping,
createTaxCode,
createTaxRegime,
createTaxRule,
listTaxAccountMappings,
listTaxCodes,
listTaxRegimes,
listTaxRules,
previewTaxComputation,
updateTaxAccountMapping,
updateTaxCode,
updateTaxRegime,
updateTaxRule,
} from "../../api/taxAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";
const STATUS_OPTIONS = ["ACTIVE", "INACTIVE"];
const TAX_KIND_OPTIONS = ["VAT", "WITHHOLDING", "STAMP", "OTHER"];
const CALCULATION_MODE_OPTIONS = ["EXCLUSIVE", "INCLUSIVE"];
const RECOVERABILITY_OPTIONS = ["FULL", "PARTIAL", "NONE"];
const MODULE_CODE_OPTIONS = ["CARI", "BANK", "PAYROLL", "CONTRACTS", "GL_MANUAL"];
const COUNTERPARTY_TYPE_OPTIONS = [
"CUSTOMER",
"VENDOR",
"EMPLOYEE",
"GOVERNMENT",
"OTHER",
];
const TAX_PURPOSE_OPTIONS = [
"VAT_INPUT",
"VAT_OUTPUT",
"VAT_PAYABLE",
"VAT_RECEIVABLE",
"WITHHOLDING_PAYABLE",
"WITHHOLDING_RECEIVABLE",
"ROUNDING",
];
const DIRECTION_OPTIONS = ["PURCHASE", "SALE"];
function toPositiveInt(value) {
const parsed = Number(value);
return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}
function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}
function normalizeAccountCode(value) {
  return String(value || "").trim().toUpperCase();
}
function getAccountId(row) {
  return toPositiveInt(row?.id);
}
function getAccountCode(row) {
  return normalizeAccountCode(row?.code);
}
function getAccountName(row) {
  return String(row?.name || "").trim();
}
function getAccountCoaId(row) {
  return toPositiveInt(row?.coa_id ?? row?.coaId);
}
function getAccountType(row) {
  return toUpper(row?.account_type ?? row?.accountType);
}
function getAccountNormalSide(row) {
  return toUpper(row?.normal_side ?? row?.normalSide);
}
function isActiveAccount(row) {
  return parseDbBoolean(row?.is_active ?? row?.isActive);
}
function isPostingAccount(row) {
  return parseDbBoolean(row?.allow_posting ?? row?.allowPosting);
}
function hasActiveChildren(row) {
  return parseDbBoolean(row?.has_active_children ?? row?.hasActiveChildren);
}
function buildAccountOptionLabel(row) {
  const breadcrumb = String(row?.account_breadcrumb || "").trim();
  if (breadcrumb) {
    return breadcrumb;
  }
  const code = getAccountCode(row);
  const name = getAccountName(row);
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || "";
}
function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
function toApiError(err, fallback) {
return err?.response?.data?.message || fallback;
}
function defaultRegimeForm() {
return {
  countryId: "",
  legalEntityId: "",
  code: "",
  name: "",
  currencyCode: "USD",
  effectiveFrom: todayIsoDate(),
  effectiveTo: "",
  status: "ACTIVE",
};
}
function defaultCodeForm() {
return {
  regimeId: "",
  code: "",
  name: "",
  taxKind: "VAT",
  ratePct: "20",
  calculationMode: "EXCLUSIVE",
  recoverability: "FULL",
  isReverseCharge: false,
  status: "ACTIVE",
};
}
function defaultRuleForm() {
return {
  regimeId: "",
  taxCodeId: "",
  moduleCode: "CARI",
  documentType: "",
  counterpartyType: "",
  applyPriority: "100",
  thresholdAmount: "",
  formulaJson: JSON.stringify({ type: "RATE" }, null, 2),
  status: "ACTIVE",
  effectiveFrom: todayIsoDate(),
  effectiveTo: "",
};
}
function defaultMappingForm() {
return {
  regimeId: "",
  legalEntityId: "",
  taxCodeId: "",
  taxPurposeCode: "VAT_OUTPUT",
  accountId: "",
  status: "ACTIVE",
};
}
function defaultPreviewForm() {
return {
  postingDate: todayIsoDate(),
  legalEntityId: "",
  countryId: "",
  moduleCode: "CARI",
  documentType: "",
  counterpartyType: "",
  taxCodeId: "",
  taxCode: "",
  baseAmount: "1000",
  direction: "SALE",
  taxPurposeCode: "",
  currencyCode: "",
};
}
export default function TaxSetupPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
const canRead = hasPermission("org.tree.read");
const canWrite = hasPermission("onboarding.company.setup");
const canReadAccounts = hasPermission("gl.account.read");
const canUpsertAccounts = hasPermission("gl.account.upsert");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
const [countries, setCountries] = useState([]);
const [legalEntities, setLegalEntities] = useState([]);
const [accounts, setAccounts] = useState([]);
const [selectedCountryId, setSelectedCountryId] = useState("");
const [selectedLegalEntityId, setSelectedLegalEntityId] = useState("");
  const [selectedRegimeId, setSelectedRegimeId] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [inlineChildParentAccountId, setInlineChildParentAccountId] = useState("");
  const [inlineChildCode, setInlineChildCode] = useState("");
  const [inlineChildName, setInlineChildName] = useState("");
  const [inlineChildSaving, setInlineChildSaving] = useState(false);
  const [regimes, setRegimes] = useState([]);
const [codes, setCodes] = useState([]);
const [rules, setRules] = useState([]);
const [mappings, setMappings] = useState([]);
const [regimeForm, setRegimeForm] = useState(defaultRegimeForm);
const [codeForm, setCodeForm] = useState(defaultCodeForm);
const [ruleForm, setRuleForm] = useState(defaultRuleForm);
const [mappingForm, setMappingForm] = useState(defaultMappingForm);
const [previewForm, setPreviewForm] = useState(defaultPreviewForm);
const [previewResult, setPreviewResult] = useState(null);
const activeRegimeId = toPositiveInt(selectedRegimeId);
const activeRegime = useMemo(
  () => regimes.find((row) => toPositiveInt(row?.id) === activeRegimeId) || null,
  [regimes, activeRegimeId]
);
  const activeRegimeTaxCodes = useMemo(
    () => codes.filter((row) => toPositiveInt(row?.regimeId) === activeRegimeId),
    [codes, activeRegimeId]
  );
  const accountById = useMemo(() => {
    const map = new Map();
    for (const row of accounts) {
      const accountId = getAccountId(row);
      if (!accountId) {
        continue;
      }
      map.set(accountId, row);
    }
    return map;
  }, [accounts]);
  const accountByCode = useMemo(() => {
    const map = new Map();
    for (const row of accounts) {
      const code = getAccountCode(row);
      if (!code || map.has(code)) {
        continue;
      }
      map.set(code, row);
    }
    return map;
  }, [accounts]);
  const postingLeafAccounts = useMemo(
    () =>
      accounts.filter(
        (row) =>
          isActiveAccount(row) &&
          isPostingAccount(row) &&
          !hasActiveChildren(row)
      ),
    [accounts]
  );
  const parentAccountOptions = useMemo(
    () => accounts.filter((row) => isActiveAccount(row)),
    [accounts]
  );
  const countryById = useMemo(() => {
  const map = new Map();
  for (const row of countries) {
    const id = toPositiveInt(row?.id);
    if (!id) {
      continue;
    }
    map.set(id, row);
  }
  return map;
}, [countries]);
const loadReferenceData = useCallback(async () => {
  if (!canRead) {
    return;
  }
  try {
    const [countriesRes, entitiesRes] = await Promise.all([
      listCountries({ limit: 400 }),
      listLegalEntities({ limit: 400 }),
    ]);
    const countryRows = Array.isArray(countriesRes?.rows) ? countriesRes.rows : [];
    const entityRows = Array.isArray(entitiesRes?.rows) ? entitiesRes.rows : [];
    setCountries(countryRows);
    setLegalEntities(entityRows);
    if (!selectedCountryId && countryRows[0]?.id) {
      setSelectedCountryId(String(countryRows[0].id));
    }
    if (!selectedLegalEntityId && entityRows[0]?.id) {
      setSelectedLegalEntityId(String(entityRows[0].id));
    }
    setRegimeForm((prev) => ({
      ...prev,
      countryId: prev.countryId || String(countryRows[0]?.id || ""),
      legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
    }));
    setMappingForm((prev) => ({
      ...prev,
      legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
    }));
    setPreviewForm((prev) => ({
      ...prev,
      legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
    }));
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to load countries/legal entities.", "Ulke/legal entity verileri yuklenemedi.")
      )
    );
  }
}, [canRead, l, selectedCountryId, selectedLegalEntityId]);
const loadRegimes = useCallback(async () => {
  const response = await listTaxRegimes({
    limit: 300,
    countryId: toPositiveInt(selectedCountryId) || undefined,
    legalEntityId: toPositiveInt(selectedLegalEntityId) || undefined,
  });
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  setRegimes(rows);
  const selected = toPositiveInt(selectedRegimeId);
  const hasSelected = selected
    ? rows.some((row) => toPositiveInt(row?.id) === selected)
    : false;
  const nextId = hasSelected ? selected : toPositiveInt(rows[0]?.id);
  setSelectedRegimeId(nextId ? String(nextId) : "");
  return nextId;
}, [selectedCountryId, selectedLegalEntityId, selectedRegimeId]);
const loadRegimeDetails = useCallback(
  async (nextRegimeId) => {
    const regimeId = toPositiveInt(nextRegimeId);
    const [codesRes, rulesRes, mappingsRes] = await Promise.all([
      listTaxCodes({ limit: 300, regimeId: regimeId || undefined }),
      listTaxRules({ limit: 300, regimeId: regimeId || undefined }),
      listTaxAccountMappings({
        limit: 300,
        regimeId: regimeId || undefined,
        legalEntityId: toPositiveInt(selectedLegalEntityId) || undefined,
      }),
    ]);
    setCodes(Array.isArray(codesRes?.rows) ? codesRes.rows : []);
    setRules(Array.isArray(rulesRes?.rows) ? rulesRes.rows : []);
    setMappings(Array.isArray(mappingsRes?.rows) ? mappingsRes.rows : []);
  },
  [selectedLegalEntityId]
);
const refreshTaxData = useCallback(async () => {
  if (!canRead) {
    return;
  }
  setLoading(true);
  setError("");
  try {
    const nextRegimeId = await loadRegimes();
    await loadRegimeDetails(nextRegimeId);
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to load tax setup.", "Vergi kurulum verisi yuklenemedi.")
      )
    );
  } finally {
    setLoading(false);
  }
}, [canRead, l, loadRegimes, loadRegimeDetails]);
useEffect(() => {
  loadReferenceData();
}, [loadReferenceData]);
useEffect(() => {
  refreshTaxData();
}, [refreshTaxData]);
useEffect(() => {
  if (!activeRegimeId) {
    return;
  }
  setCodeForm((prev) => ({ ...prev, regimeId: prev.regimeId || String(activeRegimeId) }));
  setRuleForm((prev) => ({ ...prev, regimeId: prev.regimeId || String(activeRegimeId) }));
  setMappingForm((prev) => ({
    ...prev,
    regimeId: prev.regimeId || String(activeRegimeId),
    legalEntityId: prev.legalEntityId || selectedLegalEntityId,
  }));
}, [activeRegimeId, selectedLegalEntityId]);
  const fetchAccounts = useCallback(
    async ({
      legalEntityId,
      q = accountSearch,
      includeInactive = false,
      limit = 250,
    } = {}) => {
      const resolvedLegalEntityId = toPositiveInt(legalEntityId);
      if (!canReadAccounts || !resolvedLegalEntityId) {
        return [];
      }
      const response = await listAccounts({
        legalEntityId: resolvedLegalEntityId,
        limit,
        q: q || undefined,
        includeInactive: includeInactive ? true : undefined,
      });
      return Array.isArray(response?.rows) ? response.rows : [];
    },
    [accountSearch, canReadAccounts]
  );
  useEffect(() => {
    if (!canReadAccounts) {
      setAccounts([]);
      return;
    }
    const legalEntityId = toPositiveInt(mappingForm.legalEntityId);
    if (!legalEntityId) {
      setAccounts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchAccounts({ legalEntityId });
        if (!cancelled) {
          setAccounts(rows);
        }
      } catch {
        if (!cancelled) {
          setAccounts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canReadAccounts, fetchAccounts, mappingForm.legalEntityId]);
  useEffect(() => {
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
  }, [mappingForm.legalEntityId]);
async function onCreateRegime(event) {
  event.preventDefault();
  if (!canWrite) {
    setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
    return;
  }
  const countryId = toPositiveInt(regimeForm.countryId);
  if (!countryId) {
    setError(l("countryId is required.", "countryId zorunludur."));
    return;
  }
  setSaving("regime");
  setError("");
  setMessage("");
  try {
    const response = await createTaxRegime({
      countryId,
      legalEntityId: toPositiveInt(regimeForm.legalEntityId) || undefined,
      code: toUpper(regimeForm.code),
      name: String(regimeForm.name || "").trim(),
      currencyCode: toUpper(regimeForm.currencyCode),
      effectiveFrom: regimeForm.effectiveFrom,
      effectiveTo: regimeForm.effectiveTo || undefined,
      status: toUpper(regimeForm.status || "ACTIVE"),
    });
    const createdRegimeId = toPositiveInt(response?.row?.id);
    if (createdRegimeId) {
      setSelectedRegimeId(String(createdRegimeId));
    }
    setMessage(l("Tax regime saved.", "Tax rejimi kaydedildi."));
    await refreshTaxData();
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to save tax regime.", "Tax rejimi kaydedilemedi.")
      )
    );
  } finally {
    setSaving("");
  }
}
async function onCreateCode(event) {
  event.preventDefault();
  if (!canWrite) {
    setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
    return;
  }
  const regimeId = toPositiveInt(codeForm.regimeId) || activeRegimeId;
  if (!regimeId) {
    setError(l("Select a regime first.", "Once rejim secin."));
    return;
  }
  setSaving("code");
  setError("");
  setMessage("");
  try {
    await createTaxCode({
      regimeId,
      code: toUpper(codeForm.code),
      name: String(codeForm.name || "").trim(),
      taxKind: toUpper(codeForm.taxKind),
      ratePct: Number(codeForm.ratePct),
      calculationMode: toUpper(codeForm.calculationMode),
      recoverability: toUpper(codeForm.recoverability),
      isReverseCharge: Boolean(codeForm.isReverseCharge),
      status: toUpper(codeForm.status || "ACTIVE"),
    });
    setMessage(l("Tax code saved.", "Tax kodu kaydedildi."));
    await loadRegimeDetails(regimeId);
  } catch (err) {
    setError(
      toApiError(err, l("Failed to save tax code.", "Tax kodu kaydedilemedi."))
    );
  } finally {
    setSaving("");
  }
}
async function onCreateRule(event) {
  event.preventDefault();
  if (!canWrite) {
    setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
    return;
  }
  const regimeId = toPositiveInt(ruleForm.regimeId) || activeRegimeId;
  const taxCodeId = toPositiveInt(ruleForm.taxCodeId);
  if (!regimeId || !taxCodeId) {
    setError(l("regimeId and taxCodeId are required.", "regimeId ve taxCodeId zorunludur."));
    return;
  }
  let formulaJson = null;
  try {
    formulaJson = JSON.parse(String(ruleForm.formulaJson || "{}"));
  } catch {
    setError(l("formulaJson must be valid JSON.", "formulaJson gecerli JSON olmali."));
    return;
  }
  setSaving("rule");
  setError("");
  setMessage("");
  try {
    await createTaxRule({
      regimeId,
      taxCodeId,
      moduleCode: toUpper(ruleForm.moduleCode),
      documentType: String(ruleForm.documentType || "").trim() || undefined,
      counterpartyType: toUpper(ruleForm.counterpartyType) || undefined,
      applyPriority: Number(ruleForm.applyPriority || 100),
      thresholdAmount:
        String(ruleForm.thresholdAmount || "").trim() === ""
          ? undefined
          : Number(ruleForm.thresholdAmount),
      formulaJson,
      status: toUpper(ruleForm.status || "ACTIVE"),
      effectiveFrom: ruleForm.effectiveFrom,
      effectiveTo: ruleForm.effectiveTo || undefined,
    });
    setMessage(l("Tax rule saved.", "Tax kurali kaydedildi."));
    await loadRegimeDetails(regimeId);
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to save tax rule.", "Tax kurali kaydedilemedi.")
      )
    );
  } finally {
    setSaving("");
  }
}
  async function onCreateMapping(event) {
  event.preventDefault();
  if (!canWrite) {
    setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
    return;
  }
  const regimeId = toPositiveInt(mappingForm.regimeId) || activeRegimeId;
  const legalEntityId =
    toPositiveInt(mappingForm.legalEntityId) || toPositiveInt(selectedLegalEntityId);
    const taxCodeId = toPositiveInt(mappingForm.taxCodeId);
    const accountId = toPositiveInt(mappingForm.accountId);
    if (!regimeId || !legalEntityId || !taxCodeId || !accountId) {
    setError(
      l(
        "regimeId, legalEntityId, taxCodeId and accountId are required.",
        "regimeId, legalEntityId, taxCodeId ve accountId zorunludur."
      )
    );
      return;
    }
    const selectedAccount = accountById.get(accountId) || null;
    if (
      selectedAccount &&
      (!isActiveAccount(selectedAccount) ||
        !isPostingAccount(selectedAccount) ||
        hasActiveChildren(selectedAccount))
    ) {
      setError(
        l(
          "Select an active posting leaf account for tax mapping.",
          "Tax eslemesi icin aktif, postable ve alt hesabi olmayan bir hesap secin."
        )
      );
      return;
    }
    setSaving("mapping");
  setError("");
  setMessage("");
  try {
    await createTaxAccountMapping({
      regimeId,
      legalEntityId,
      taxCodeId,
      taxPurposeCode: toUpper(mappingForm.taxPurposeCode),
      accountId,
      status: toUpper(mappingForm.status || "ACTIVE"),
    });
    setMessage(l("Tax account mapping saved.", "Tax hesap eslemesi kaydedildi."));
    await loadRegimeDetails(regimeId);
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to save tax account mapping.", "Tax hesap eslemesi kaydedilemedi.")
      )
    );
  } finally {
      setSaving("");
    }
  }
  async function handleCreateInlineChildAccount() {
    if (!canUpsertAccounts) {
      setError(
        l(
          "Missing permission: gl.account.upsert",
          "Eksik yetki: gl.account.upsert"
        )
      );
      return;
    }
    const legalEntityId =
      toPositiveInt(mappingForm.legalEntityId) || toPositiveInt(selectedLegalEntityId);
    if (!legalEntityId) {
      setError(
        l("legalEntityId is required.", "legalEntityId zorunludur.")
      );
      return;
    }
    const parentAccountId = toPositiveInt(inlineChildParentAccountId);
    const parentAccount = parentAccountId
      ? accountById.get(parentAccountId) || null
      : null;
    if (!parentAccountId || !parentAccount || !isActiveAccount(parentAccount)) {
      setError(
        l("Parent account is required.", "Ust hesap secilmelidir.")
      );
      return;
    }

    const childCode = normalizeAccountCode(inlineChildCode);
    const childName = String(inlineChildName || "").trim();
    if (!childCode) {
      setError(
        l("Child account code is required.", "Alt hesap kodu zorunludur.")
      );
      return;
    }
    if (!childName) {
      setError(
        l("Child account name is required.", "Alt hesap adi zorunludur.")
      );
      return;
    }
    const parentCode = getAccountCode(parentAccount);
    if (parentCode && childCode === parentCode) {
      setError(
        l(
          "Child account code must differ from parent account code.",
          "Alt hesap kodu ust hesap kodu ile ayni olamaz."
        )
      );
      return;
    }

    const existingAccount = accountByCode.get(childCode) || null;
    const existingAccountId = getAccountId(existingAccount);
    if (existingAccountId) {
      if (
        isActiveAccount(existingAccount) &&
        isPostingAccount(existingAccount) &&
        !hasActiveChildren(existingAccount)
      ) {
        setMappingForm((prev) => ({ ...prev, accountId: String(existingAccountId) }));
        setInlineChildParentAccountId("");
        setInlineChildCode("");
        setInlineChildName("");
        setError("");
        setMessage(
          l(
            `Existing account selected: ${childCode}`,
            `Mevcut hesap secildi: ${childCode}`
          )
        );
        return;
      }
      setError(
        l(
          "This account code already exists but is not a posting leaf account.",
          "Bu hesap kodu zaten var ancak postable leaf hesap degil."
        )
      );
      return;
    }

    const coaId = getAccountCoaId(parentAccount);
    if (!coaId) {
      setError(
        l(
          "Selected parent account has no coaId.",
          "Secilen ust hesap icin coaId bulunamadi."
        )
      );
      return;
    }

    setInlineChildSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await upsertAccount({
        coaId,
        code: childCode,
        name: childName,
        accountType: getAccountType(parentAccount) || "ASSET",
        normalSide: getAccountNormalSide(parentAccount) || "DEBIT",
        allowPosting: true,
        parentAccountId,
      });
      const responseId = toPositiveInt(response?.id ?? response?.row?.id);
      const refreshedRows = await fetchAccounts({
        legalEntityId,
        q: "",
        includeInactive: true,
        limit: 1000,
      });
      setAccounts(refreshedRows);
      setAccountSearch("");

      const resolvedRow =
        refreshedRows.find(
          (row) =>
            getAccountCode(row) === childCode &&
            isPostingAccount(row) &&
            !hasActiveChildren(row)
        ) || null;
      const resolvedId = responseId || getAccountId(resolvedRow);
      if (resolvedId) {
        setMappingForm((prev) => ({ ...prev, accountId: String(resolvedId) }));
      }

      setInlineChildParentAccountId("");
      setInlineChildCode("");
      setInlineChildName("");
      setMessage(
        l(
          `Child account created and selected: ${childCode}`,
          `Alt hesap olusturuldu ve secildi: ${childCode}`
        )
      );
    } catch (err) {
      setError(
        toApiError(
          err,
          l(
            "Failed to create child account.",
            "Alt hesap olusturulamadi."
          )
        )
      );
    } finally {
      setInlineChildSaving(false);
    }
  }
async function onPreview(event) {
  event.preventDefault();
  if (!canRead) {
    return;
  }
  const legalEntityId = toPositiveInt(previewForm.legalEntityId);
  const baseAmount = Number(previewForm.baseAmount);
  if (!legalEntityId || !Number.isFinite(baseAmount) || baseAmount <= 0) {
    setError(
      l(
        "postingDate, legalEntityId and positive baseAmount are required.",
        "postingDate, legalEntityId ve pozitif baseAmount zorunludur."
      )
    );
    return;
  }
  setSaving("preview");
  setError("");
  setMessage("");
  setPreviewResult(null);
  try {
    const result = await previewTaxComputation({
      postingDate: previewForm.postingDate,
      legalEntityId,
      countryId: toPositiveInt(previewForm.countryId) || undefined,
      moduleCode: toUpper(previewForm.moduleCode),
      documentType: String(previewForm.documentType || "").trim() || undefined,
      counterpartyType: toUpper(previewForm.counterpartyType) || undefined,
      taxCodeId: toPositiveInt(previewForm.taxCodeId) || undefined,
      taxCode: toUpper(previewForm.taxCode) || undefined,
      baseAmount,
      direction: toUpper(previewForm.direction || "SALE"),
      taxPurposeCode: toUpper(previewForm.taxPurposeCode) || undefined,
      currencyCode: toUpper(previewForm.currencyCode) || undefined,
    });
    setPreviewResult(result || null);
    setMessage(l("Tax preview completed.", "Tax preview tamamlandi."));
  } catch (err) {
    setError(
      toApiError(err, l("Tax preview failed.", "Tax preview basarisiz."))
    );
  } finally {
    setSaving("");
  }
}
async function onToggleStatus(type, row) {
  if (!canWrite) {
    return;
  }
  const rowId = toPositiveInt(row?.id);
  if (!rowId) {
    return;
  }
  const nextStatus = String(row?.status || "").toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  setSaving(`${type}-${rowId}`);
  setError("");
  setMessage("");
  try {
    if (type === "regime") {
      await updateTaxRegime(rowId, { status: nextStatus });
    } else if (type === "code") {
      await updateTaxCode(rowId, { status: nextStatus });
    } else if (type === "rule") {
      await updateTaxRule(rowId, { status: nextStatus });
    } else if (type === "mapping") {
      await updateTaxAccountMapping(rowId, { status: nextStatus });
    }
    if (type === "regime") {
      await refreshTaxData();
    } else {
      await loadRegimeDetails(activeRegimeId);
    }
  } catch (err) {
    setError(
      toApiError(
        err,
        l("Failed to update status.", "Durum guncellenemedi.")
      )
    );
  } finally {
    setSaving("");
  }
}
const previewBreakdown = previewResult?.breakdown || null;
const previewLines = Array.isArray(previewResult?.journalLines)
  ? previewResult.journalLines
  : [];
return (
  <div className="space-y-4">
    <TenantReadinessChecklist />
    <div>
      <h1 className="text-xl font-semibold text-slate-900">
        {l("Tax Setup", "Vergi Kurulumu")}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "Configure country/legal-entity tax regimes, codes, rules, account mappings, and run preview.",
          "Ulke/legal entity tax rejimi, kod, kural, hesap eslemelerini yonetin ve preview calistirin."
        )}
      </p>
    </div>
    {error ? (
      <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {error}
      </div>
    ) : null}
    {message ? (
      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {message}
      </div>
    ) : null}
    {!canRead ? (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {l("Missing permission: org.tree.read", "Eksik yetki: org.tree.read")}
      </div>
    ) : null}
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          {l("Filters", "Filtreler")}
        </h2>
        <button
          type="button"
          onClick={() => refreshTaxData()}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          {loading ? l("Refreshing...", "Yenileniyor...") : l("Refresh", "Yenile")}
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">
          {l("Country", "Ulke")}
          <select
            value={selectedCountryId}
            onChange={(event) => setSelectedCountryId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">{l("All countries", "Tum ulkeler")}</option>
            {countries.map((row) => (
              <option key={row.id} value={row.id}>
                {row.iso2} - {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          {l("Legal entity", "Legal entity")}
          <select
            value={selectedLegalEntityId}
            onChange={(event) => setSelectedLegalEntityId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">{l("All legal entities", "Tum legal entity")}</option>
            {legalEntities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          {l("Active regime", "Aktif rejim")}
          <select
            value={selectedRegimeId}
            onChange={async (event) => {
              const nextId = toPositiveInt(event.target.value);
              setSelectedRegimeId(nextId ? String(nextId) : "");
              await loadRegimeDetails(nextId);
            }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">{l("Select regime", "Rejim secin")}</option>
            {regimes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Create Tax Regime", "Tax Rejimi Olustur")}
        </h2>
        <form onSubmit={onCreateRegime} className="grid gap-2 md:grid-cols-2">
          <select
            value={regimeForm.countryId}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, countryId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select country", "Ulke secin")}</option>
            {countries.map((row) => (
              <option key={row.id} value={row.id}>
                {row.iso2} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={regimeForm.legalEntityId}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{l("Tenant-wide", "Tenant geneli")}</option>
            {legalEntities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <input
            value={regimeForm.code}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Regime code", "Rejim kodu")}
            required
          />
          <input
            value={regimeForm.name}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, name: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Regime name", "Rejim adi")}
            required
          />
          <input
            value={regimeForm.currencyCode}
            onChange={(event) =>
              setRegimeForm((prev) => ({
                ...prev,
                currencyCode: event.target.value.toUpperCase(),
              }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            maxLength={3}
            placeholder={l("Currency", "Para birimi")}
            required
          />
          <select
            value={regimeForm.status}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={regimeForm.effectiveFrom}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="date"
            value={regimeForm.effectiveTo}
            onChange={(event) =>
              setRegimeForm((prev) => ({ ...prev, effectiveTo: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving === "regime" || !canWrite}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
          >
            {saving === "regime"
              ? l("Saving...", "Kaydediliyor...")
              : l("Save regime", "Rejimi kaydet")}
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Create Tax Code", "Tax Kodu Olustur")}
        </h2>
        <form onSubmit={onCreateCode} className="grid gap-2 md:grid-cols-2">
          <select
            value={codeForm.regimeId || selectedRegimeId}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, regimeId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select regime", "Rejim secin")}</option>
            {regimes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={codeForm.taxKind}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, taxKind: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {TAX_KIND_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <input
            value={codeForm.code}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Code", "Kod")}
            required
          />
          <input
            value={codeForm.name}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, name: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Name", "Ad")}
            required
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.0001"
            value={codeForm.ratePct}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, ratePct: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Rate %", "Oran %")}
            required
          />
          <select
            value={codeForm.calculationMode}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, calculationMode: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {CALCULATION_MODE_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <select
            value={codeForm.recoverability}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, recoverability: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {RECOVERABILITY_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <select
            value={codeForm.status}
            onChange={(event) =>
              setCodeForm((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(codeForm.isReverseCharge)}
              onChange={(event) =>
                setCodeForm((prev) => ({
                  ...prev,
                  isReverseCharge: event.target.checked,
                }))
              }
            />
            {l("Reverse charge", "Ters vergi")}
          </label>
          <button
            type="submit"
            disabled={saving === "code" || !canWrite}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
          >
            {saving === "code"
              ? l("Saving...", "Kaydediliyor...")
              : l("Save code", "Kodu kaydet")}
          </button>
        </form>
      </section>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Create Tax Rule", "Tax Kurali Olustur")}
        </h2>
        <form onSubmit={onCreateRule} className="grid gap-2 md:grid-cols-2">
          <select
            value={ruleForm.regimeId || selectedRegimeId}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, regimeId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select regime", "Rejim secin")}</option>
            {regimes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={ruleForm.taxCodeId}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, taxCodeId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select tax code", "Tax kodu secin")}</option>
            {activeRegimeTaxCodes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={ruleForm.moduleCode}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, moduleCode: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {MODULE_CODE_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <input
            value={ruleForm.documentType}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, documentType: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Document type (optional)", "Belge tipi (opsiyonel)")}
          />
          <select
            value={ruleForm.counterpartyType}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, counterpartyType: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{l("Counterparty (optional)", "Taraf (opsiyonel)")}</option>
            {COUNTERPARTY_TYPE_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={ruleForm.applyPriority}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, applyPriority: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Priority", "Oncelik")}
          />
          <input
            type="number"
            min="0"
            step="0.000001"
            value={ruleForm.thresholdAmount}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, thresholdAmount: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={l(
              "Threshold amount (optional)",
              "Esik tutari (opsiyonel)"
            )}
          />
          <select
            value={ruleForm.status}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={ruleForm.effectiveFrom}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="date"
            value={ruleForm.effectiveTo}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, effectiveTo: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500 md:col-span-2">
            {l(
              "Threshold is supported for CARI + VENDOR rules. It uses cumulative posted AP base in the fiscal period and taxes only the current excess.",
              "Esik yalnizca CARI + VENDOR kurallarinda desteklenir. Mali donemdeki kayitli AP taban tutari birikir ve vergi sadece mevcut asan kisim icin uygulanir."
            )}
          </p>
          <textarea
            value={ruleForm.formulaJson}
            onChange={(event) =>
              setRuleForm((prev) => ({ ...prev, formulaJson: event.target.value }))
            }
            className="min-h-[140px] rounded border border-slate-300 px-3 py-2 font-mono text-xs md:col-span-2"
            placeholder='{"type":"RATE"}'
            required
          />
          <button
            type="submit"
            disabled={saving === "rule" || !canWrite}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
          >
            {saving === "rule"
              ? l("Saving...", "Kaydediliyor...")
              : l("Save rule", "Kurali kaydet")}
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Create Tax Account Mapping", "Tax Hesap Eslemesi Olustur")}
        </h2>
        <form onSubmit={onCreateMapping} className="grid gap-2 md:grid-cols-2">
          <select
            value={mappingForm.regimeId || selectedRegimeId}
            onChange={(event) =>
              setMappingForm((prev) => ({ ...prev, regimeId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select regime", "Rejim secin")}</option>
            {regimes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={mappingForm.legalEntityId || selectedLegalEntityId}
            onChange={(event) =>
              setMappingForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select legal entity", "Legal entity secin")}</option>
            {legalEntities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={mappingForm.taxCodeId}
            onChange={(event) =>
              setMappingForm((prev) => ({ ...prev, taxCodeId: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select tax code", "Tax kodu secin")}</option>
            {activeRegimeTaxCodes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={mappingForm.taxPurposeCode}
            onChange={(event) =>
              setMappingForm((prev) => ({ ...prev, taxPurposeCode: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {TAX_PURPOSE_OPTIONS.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
          {canReadAccounts ? (
            <>
               <input
                 value={accountSearch}
                 onChange={(event) => setAccountSearch(event.target.value)}
                 className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                 placeholder={l("Search account code/name", "Hesap kod/adi ara")}
               />
               <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:col-span-2">
                 {l(
                   "Only active posting leaf accounts are shown for tax mapping. Use the helper below if you need to create a new child under a parent tax account.",
                   "Tax eslemesi icin yalnizca aktif, postable ve alt hesabi olmayan hesaplar gosterilir. Ust vergi hesabi altina yeni alt hesap acmaniz gerekiyorsa asagidaki yardimci alani kullanin."
                 )}
               </div>
               <select
                 value={mappingForm.accountId}
                 onChange={(event) =>
                   setMappingForm((prev) => ({ ...prev, accountId: event.target.value }))
                 }
                 className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                 required
               >
                 <option value="">{l("Select posting account", "Postable hesap secin")}</option>
                 {postingLeafAccounts.map((row) => (
                   <option key={row.id} value={row.id}>
                     {buildAccountOptionLabel(row)}
                   </option>
                 ))}
               </select>
               {canUpsertAccounts ? (
                 <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 md:col-span-2">
                   <p className="text-xs font-semibold text-slate-700">
                     {l(
                       "Create posting child account",
                       "Postable alt hesap olustur"
                     )}
                   </p>
                   <p className="mt-1 text-xs text-slate-600">
                     {l(
                       "Pick a parent tax account, create a posting child under it, and the new child will be auto-selected for mapping.",
                       "Ust vergi hesabini secin, altina postable alt hesap olusturun; yeni alt hesap esleme icin otomatik secilir."
                     )}
                   </p>
                   <div className="mt-3 grid gap-2 md:grid-cols-3">
                     <select
                       value={inlineChildParentAccountId}
                       onChange={(event) =>
                         setInlineChildParentAccountId(event.target.value)
                       }
                       className="rounded border border-slate-300 px-3 py-2 text-sm"
                     >
                       <option value="">
                         {l("Select parent account", "Ust hesap secin")}
                       </option>
                       {parentAccountOptions.map((row) => (
                         <option key={row.id} value={row.id}>
                           {buildAccountOptionLabel(row)}
                         </option>
                       ))}
                     </select>
                     <input
                       value={inlineChildCode}
                       onChange={(event) =>
                         setInlineChildCode(event.target.value.toUpperCase())
                       }
                       className="rounded border border-slate-300 px-3 py-2 text-sm"
                       placeholder={l("Child code", "Alt hesap kodu")}
                     />
                     <input
                       value={inlineChildName}
                       onChange={(event) =>
                         setInlineChildName(event.target.value)
                       }
                       className="rounded border border-slate-300 px-3 py-2 text-sm"
                       placeholder={l("Child name", "Alt hesap adi")}
                     />
                   </div>
                   <div className="mt-3 flex justify-end">
                     <button
                       type="button"
                       onClick={() => handleCreateInlineChildAccount()}
                       disabled={inlineChildSaving || saving === "mapping"}
                       className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                     >
                       {inlineChildSaving
                         ? l("Creating...", "Olusturuluyor...")
                         : l("Create and select child", "Alt hesabi olustur ve sec")}
                     </button>
                   </div>
                 </div>
               ) : (
                 <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-2">
                   {l(
                     "Need gl.account.upsert permission to create child accounts here.",
                     "Burada alt hesap olusturmak icin gl.account.upsert yetkisi gerekir."
                   )}
                 </div>
               )}
             </>
           ) : (
            <input
              value={mappingForm.accountId}
              onChange={(event) =>
                setMappingForm((prev) => ({ ...prev, accountId: event.target.value }))
              }
              className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Account ID", "Hesap ID")}
              required
            />
          )}
          <select
            value={mappingForm.status}
            onChange={(event) =>
              setMappingForm((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving === "mapping" || !canWrite}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving === "mapping"
              ? l("Saving...", "Kaydediliyor...")
              : l("Save mapping", "Eslemeyi kaydet")}
          </button>
        </form>
      </section>
    </div>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        {l("Preview Tax Computation", "Tax Hesaplama Preview")}
      </h2>
      <form onSubmit={onPreview} className="grid gap-2 md:grid-cols-5">
        <input
          type="date"
          value={previewForm.postingDate}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, postingDate: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          required
        />
        <select
          value={previewForm.legalEntityId}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="">{l("Select legal entity", "Legal entity secin")}</option>
          {legalEntities.map((row) => (
            <option key={row.id} value={row.id}>
              {row.code} - {row.name}
            </option>
          ))}
        </select>
        <select
          value={previewForm.countryId}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, countryId: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{l("Use entity country", "Entity ulkesini kullan")}</option>
          {countries.map((row) => (
            <option key={row.id} value={row.id}>
              {row.iso2} - {row.name}
            </option>
          ))}
        </select>
        <select
          value={previewForm.moduleCode}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, moduleCode: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {MODULE_CODE_OPTIONS.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          value={previewForm.baseAmount}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, baseAmount: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={l("Base amount", "Tutar")}
          required
        />
        <input
          value={previewForm.documentType}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, documentType: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={l("Document type", "Belge tipi")}
        />
        <select
          value={previewForm.counterpartyType}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, counterpartyType: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{l("Counterparty type", "Taraf tipi")}</option>
          {COUNTERPARTY_TYPE_OPTIONS.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>
        <input
          value={previewForm.taxCodeId}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, taxCodeId: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={l("taxCodeId (optional)", "taxCodeId (opsiyonel)")}
        />
        <input
          value={previewForm.taxCode}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, taxCode: event.target.value.toUpperCase() }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={l("taxCode (optional)", "taxCode (opsiyonel)")}
        />
        <select
          value={previewForm.direction}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, direction: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {DIRECTION_OPTIONS.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>
        <select
          value={previewForm.taxPurposeCode}
          onChange={(event) =>
            setPreviewForm((prev) => ({ ...prev, taxPurposeCode: event.target.value }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{l("Tax purpose (auto)", "Tax purpose (otomatik)")}</option>
          {TAX_PURPOSE_OPTIONS.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>
        <input
          value={previewForm.currencyCode}
          onChange={(event) =>
            setPreviewForm((prev) => ({
              ...prev,
              currencyCode: event.target.value.toUpperCase(),
            }))
          }
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          maxLength={3}
          placeholder={l("Currency (optional)", "Para birimi (opsiyonel)")}
        />
        <button
          type="submit"
          disabled={saving === "preview" || !canRead}
          className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving === "preview"
            ? l("Computing...", "Hesaplaniyor...")
            : l("Run preview", "Preview calistir")}
        </button>
      </form>
      {previewBreakdown ? (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">{l("Net", "Net")}</div>
            <div className="font-semibold">{previewBreakdown.netAmount}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">{l("Tax", "Vergi")}</div>
            <div className="font-semibold">{previewBreakdown.taxAmount}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">{l("Gross", "Brut")}</div>
            <div className="font-semibold">{previewBreakdown.grossAmount}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">{l("Rate %", "Oran %")}</div>
            <div className="font-semibold">{previewBreakdown.ratePct}</div>
          </div>
        </div>
      ) : null}
      {previewLines.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">{l("Direction", "Yon")}</th>
                <th className="px-2 py-2">{l("Purpose", "Amac")}</th>
                <th className="px-2 py-2">{l("Account", "Hesap")}</th>
                <th className="px-2 py-2">{l("Amount", "Tutar")}</th>
              </tr>
            </thead>
            <tbody>
              {previewLines.map((row, index) => (
                <tr key={`preview-line-${index}`} className="border-t border-slate-100">
                  <td className="px-2 py-2">{row.direction || "-"}</td>
                  <td className="px-2 py-2">{row.taxPurposeCode || "-"}</td>
                  <td className="px-2 py-2">
                    {row.accountCode || row.accountId || "-"} {row.accountName ? `- ${row.accountName}` : ""}
                  </td>
                  <td className="px-2 py-2">{row.amount ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Regimes", "Rejimler")}
        </h2>
        <div className="max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">{l("Code", "Kod")}</th>
                <th className="px-2 py-2">{l("Country", "Ulke")}</th>
                <th className="px-2 py-2">{l("Entity", "Entity")}</th>
                <th className="px-2 py-2">{l("Status", "Durum")}</th>
                <th className="px-2 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {regimes.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const rowSaving = saving === `regime-${rowId}`;
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-slate-100 ${
                      rowId === activeRegimeId ? "bg-cyan-50" : ""
                    }`}
                  >
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedRegimeId(String(row.id));
                          await loadRegimeDetails(row.id);
                        }}
                        className="font-semibold text-cyan-700 underline"
                      >
                        {row.code}
                      </button>
                    </td>
                    <td className="px-2 py-2">{row.countryIso2 || row.countryName || "-"}</td>
                    <td className="px-2 py-2">{row.legalEntityCode || "-"}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={!canWrite || rowSaving}
                        onClick={() => onToggleStatus("regime", row)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        {rowSaving
                          ? l("Saving...", "Kaydediliyor...")
                          : row.status === "ACTIVE"
                          ? "INACTIVE"
                          : "ACTIVE"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {regimes.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-slate-500">
                    {l("No regimes found.", "Rejim bulunamadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Tax Codes", "Tax Kodlari")}
        </h2>
        <div className="max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">{l("Code", "Kod")}</th>
                <th className="px-2 py-2">{l("Kind", "Tur")}</th>
                <th className="px-2 py-2">{l("Rate", "Oran")}</th>
                <th className="px-2 py-2">{l("Status", "Durum")}</th>
                <th className="px-2 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const rowSaving = saving === `code-${rowId}`;
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">
                      {row.code} - {row.name}
                    </td>
                    <td className="px-2 py-2">{row.taxKind}</td>
                    <td className="px-2 py-2">{row.ratePct}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={!canWrite || rowSaving}
                        onClick={() => onToggleStatus("code", row)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        {rowSaving
                          ? l("Saving...", "Kaydediliyor...")
                          : row.status === "ACTIVE"
                          ? "INACTIVE"
                          : "ACTIVE"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {codes.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-slate-500">
                    {l("No tax codes found.", "Tax kodu bulunamadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Tax Rules", "Tax Kurallari")}
        </h2>
        <div className="max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">{l("Code", "Kod")}</th>
                <th className="px-2 py-2">{l("Module", "Modul")}</th>
                <th className="px-2 py-2">{l("Priority", "Oncelik")}</th>
                <th className="px-2 py-2">{l("Threshold", "Esik")}</th>
                <th className="px-2 py-2">{l("Status", "Durum")}</th>
                <th className="px-2 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const rowSaving = saving === `rule-${rowId}`;
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.taxCode || "-"}</td>
                    <td className="px-2 py-2">{row.moduleCode}</td>
                    <td className="px-2 py-2">{row.applyPriority}</td>
                    <td className="px-2 py-2">
                      {row.thresholdAmount === null || row.thresholdAmount === undefined
                        ? "-"
                        : row.thresholdAmount}
                    </td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={!canWrite || rowSaving}
                        onClick={() => onToggleStatus("rule", row)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        {rowSaving
                          ? l("Saving...", "Kaydediliyor...")
                          : row.status === "ACTIVE"
                          ? "INACTIVE"
                          : "ACTIVE"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-slate-500">
                    {l("No tax rules found.", "Tax kurali bulunamadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {l("Tax Account Mappings", "Tax Hesap Eslemeleri")}
        </h2>
        <div className="max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">{l("Tax Code", "Tax Kodu")}</th>
                <th className="px-2 py-2">{l("Purpose", "Amac")}</th>
                <th className="px-2 py-2">{l("Account", "Hesap")}</th>
                <th className="px-2 py-2">{l("Status", "Durum")}</th>
                <th className="px-2 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((row) => {
                const rowId = toPositiveInt(row?.id);
                const rowSaving = saving === `mapping-${rowId}`;
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.taxCode || "-"}</td>
                    <td className="px-2 py-2">{row.taxPurposeCode || "-"}</td>
                    <td className="px-2 py-2">
                      {row.accountCode || row.accountId || "-"} {row.accountName ? `- ${row.accountName}` : ""}
                    </td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={!canWrite || rowSaving}
                        onClick={() => onToggleStatus("mapping", row)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        {rowSaving
                          ? l("Saving...", "Kaydediliyor...")
                          : row.status === "ACTIVE"
                          ? "INACTIVE"
                          : "ACTIVE"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {mappings.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-slate-500">
                    {l("No tax account mappings found.", "Tax hesap eslemesi bulunamadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    {previewResult ? (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          {l("Preview Details", "Preview Detayi")}
        </h2>
        <pre className="max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          {JSON.stringify(previewResult, null, 2)}
        </pre>
        <p className="mt-2 text-xs text-slate-500">
          {l(
            "Resolved country: ",
            "Cozulen ulke: "
          )}
          {activeRegime?.countryIso2 ||
            countryById.get(toPositiveInt(previewForm.countryId))?.iso2 ||
            "-"}
        </p>
      </section>
    ) : null}
  </div>
);
}
