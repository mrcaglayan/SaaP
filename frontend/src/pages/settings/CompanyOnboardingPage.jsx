
import { useEffect, useMemo, useState } from "react";
import { bootstrapCompany } from "../../api/onboarding.js";
import { listCountries, listCurrencies } from "../../api/orgAdmin.js";
import { getPolicyPack, listPolicyPacks } from "../../api/policyPacks.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const UNIT_TYPES = ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"];
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const NORMAL_SIDES = ["DEBIT", "CREDIT"];
const WIZARD_STEPS = Object.freeze([
Object.freeze({
  key: "country",
  titleEn: "Country + Company",
  titleTr: "Ulke + Sirket",
}),
Object.freeze({
  key: "entity",
  titleEn: "Company + Entities",
  titleTr: "Sirket + Birimler",
}),
Object.freeze({
  key: "template",
  titleEn: "CoA Template",
  titleTr: "Hesap Plani Sablonu",
}),
Object.freeze({
  key: "accountTree",
  titleEn: "Account Tree",
  titleTr: "Hesap Agaci",
}),
Object.freeze({ key: "branches", titleEn: "Branches", titleTr: "Subeler" }),
]);

const BASELINE_DEFAULT_ACCOUNTS = Object.freeze([
Object.freeze({
  code: "1000",
  name: "Cash and Cash Equivalents",
  accountType: "ASSET",
  normalSide: "DEBIT",
  allowPosting: true,
}),
Object.freeze({
  code: "1100",
  name: "Accounts Receivable",
  accountType: "ASSET",
  normalSide: "DEBIT",
  allowPosting: true,
}),
Object.freeze({
  code: "2000",
  name: "Accounts Payable",
  accountType: "LIABILITY",
  normalSide: "CREDIT",
  allowPosting: true,
}),
Object.freeze({
  code: "3000",
  name: "Retained Earnings",
  accountType: "EQUITY",
  normalSide: "CREDIT",
  allowPosting: true,
}),
Object.freeze({
  code: "4000",
  name: "Revenue",
  accountType: "REVENUE",
  normalSide: "CREDIT",
  allowPosting: true,
}),
Object.freeze({
  code: "5000",
  name: "Operating Expense",
  accountType: "EXPENSE",
  normalSide: "DEBIT",
  allowPosting: true,
}),
]);

const COUNTRY_STARTER_ACCOUNTS = Object.freeze({
TR: Object.freeze([
  Object.freeze({
    code: "100",
    name: "Kasa",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "102",
    name: "Bankalar",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "120",
    name: "Alicilar",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "320",
    name: "Saticilar",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "500",
    name: "Sermaye",
    accountType: "EQUITY",
    normalSide: "CREDIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "501",
    name: "Odenmemis Sermaye (-)",
    accountType: "EQUITY",
    normalSide: "DEBIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "600",
    name: "Yurtici Satislar",
    accountType: "REVENUE",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "770",
    name: "Genel Yonetim Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
]),
AF: Object.freeze([
  Object.freeze({
    code: "1000",
    name: "Cash and Cash Equivalents",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "1100",
    name: "Accounts Receivable",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "2000",
    name: "Accounts Payable",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "3100",
    name: "Share Capital",
    accountType: "EQUITY",
    normalSide: "CREDIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "3110",
    name: "Shareholder Commitment Receivable",
    accountType: "EQUITY",
    normalSide: "DEBIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "4000",
    name: "Sales Revenue",
    accountType: "REVENUE",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "5000",
    name: "Operating Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
]),
US: Object.freeze([
  Object.freeze({
    code: "1000",
    name: "Cash and Cash Equivalents",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "1100",
    name: "Accounts Receivable",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "2000",
    name: "Accounts Payable",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "3100",
    name: "Common Stock",
    accountType: "EQUITY",
    normalSide: "CREDIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "3110",
    name: "Stock Subscription Receivable",
    accountType: "EQUITY",
    normalSide: "DEBIT",
    allowPosting: false,
  }),
  Object.freeze({
    code: "4000",
    name: "Sales Revenue",
    accountType: "REVENUE",
    normalSide: "CREDIT",
    allowPosting: true,
  }),
  Object.freeze({
    code: "5000",
    name: "Operating Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
    allowPosting: true,
  }),
]),
});
function createId(prefix) {
return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function toUpper(value) {
return String(value || "").trim().toUpperCase();
}
function createAccountDraft(seed = {}) {
return {
  id: createId("account"),
  code: String(seed.code || "").trim().toUpperCase(),
  parentCode: toUpper(seed.parentCode ?? seed.parent_code),
  name: String(seed.name || "").trim(),
  accountType: toUpper(seed.accountType) || "ASSET",
  normalSide: toUpper(seed.normalSide) || "DEBIT",
  allowPosting:
    seed.allowPosting === undefined ? true : Boolean(seed.allowPosting),
};
}
function buildStarterAccountsFromCatalog(rows = []) {
return rows.map((row) => createAccountDraft(row));
}
function getCountryStarterAccounts(countryIso2) {
const normalizedCountryIso2 = toUpper(countryIso2);
const starterRows =
  COUNTRY_STARTER_ACCOUNTS[normalizedCountryIso2] || BASELINE_DEFAULT_ACCOUNTS;
return buildStarterAccountsFromCatalog(starterRows);
}
function deriveStarterAccountsFromPolicyPack(policyPack, countryIso2) {
const starterAccountTree = Array.isArray(policyPack?.starterAccountTree)
  ? policyPack.starterAccountTree
  : [];
if (starterAccountTree.length > 0) {
  return starterAccountTree.map((row) => createAccountDraft(row));
}

const byCode = new Map();
const modules = Array.isArray(policyPack?.modules) ? policyPack.modules : [];
for (const module of modules) {
  const purposeTargets = Array.isArray(module?.purposeTargets)
    ? module.purposeTargets
    : [];
  for (const target of purposeTargets) {
    const suggestion = target?.suggestCreate || null;
    const code = toUpper(suggestion?.code);
    const name = String(suggestion?.name || "").trim();
    if (!code || !name || byCode.has(code)) {
      continue;
    }
    byCode.set(
      code,
      createAccountDraft({
        code,
        name,
        accountType: suggestion.accountType,
        normalSide: suggestion.normalSide,
        allowPosting: suggestion.allowPosting,
      })
    );
  }
}
if (byCode.size > 0) {
  return Array.from(byCode.values());
}
return getCountryStarterAccounts(countryIso2);
}
function createBranchDraft() {
return {
  id: createId("branch"),
  code: "",
  name: "",
  unitType: "BRANCH",
  hasSubledger: false,
};
}
function createEntityDraft() {
return {
  id: createId("entity"),
  code: "",
  name: "",
  taxId: "",
  countryIso2: "",
  functionalCurrencyCode: "USD",
  isIntercompanyEnabled: true,
  intercompanyPartnerRequired: false,
  policyPackId: "",
  coaCode: "",
  coaName: "",
  bookCode: "",
  bookName: "",
  defaultAccounts: getCountryStarterAccounts("US"),
  branches: [createBranchDraft()],
};
}
function createInitialForm() {
const now = new Date();
return {
  groupCompany: {
    code: "",
    name: "",
  },
  fiscalCalendar: {
    code: "MAIN",
    name: "Main Calendar",
    yearStartMonth: 1,
    yearStartDay: 1,
  },
  fiscalYear: now.getUTCFullYear(),
  legalEntities: [createEntityDraft()],
};
}
function sanitizeDefaultAccounts(accounts) {
const rows = Array.isArray(accounts) ? accounts : [];
return rows
  .filter((account) => {
    return (
      String(account?.code || "").trim() && String(account?.name || "").trim()
    );
  })
  .map((account) => ({
    code: toUpper(account.code),
    ...(toUpper(account.parentCode ?? account.parent_code)
      ? { parentCode: toUpper(account.parentCode ?? account.parent_code) }
      : {}),
    name: String(account.name || "").trim(),
    accountType: toUpper(account.accountType) || "ASSET",
    normalSide: toUpper(account.normalSide) || "DEBIT",
    allowPosting:
      account.allowPosting === undefined ? true : Boolean(account.allowPosting),
  }));
}
function compareAccountsForTree(left, right) {
const leftCode = toUpper(left?.code);
const rightCode = toUpper(right?.code);
if (leftCode && rightCode && leftCode !== rightCode) {
  return leftCode.localeCompare(rightCode);
}
const leftName = String(left?.name || "").trim();
const rightName = String(right?.name || "").trim();
if (leftName !== rightName) {
  return leftName.localeCompare(rightName);
}
return String(left?.id || "").localeCompare(String(right?.id || ""));
}
function getAccountTreeVisitKey(account) {
if (account?.id) {
  return `ID:${String(account.id)}`;
}
const code = toUpper(account?.code);
if (code) {
  return `CODE:${code}`;
}
return `ROW:${String(account?.name || "")}`;
}
function buildAccountTreeRows(defaultAccounts = []) {
const rows = Array.isArray(defaultAccounts) ? defaultAccounts : [];
const accountByCode = new Map();
for (const account of rows) {
  const code = toUpper(account?.code);
  if (code && !accountByCode.has(code)) {
    accountByCode.set(code, account);
  }
}
const childrenByParentCode = new Map();
for (const account of rows) {
  const parentCode = toUpper(account?.parentCode ?? account?.parent_code);
  if (!parentCode) {
    continue;
  }
  if (!childrenByParentCode.has(parentCode)) {
    childrenByParentCode.set(parentCode, []);
  }
  childrenByParentCode.get(parentCode).push(account);
}
for (const children of childrenByParentCode.values()) {
  children.sort(compareAccountsForTree);
}
const roots = rows
  .filter((account) => {
    const code = toUpper(account?.code);
    const parentCode = toUpper(account?.parentCode ?? account?.parent_code);
    if (!parentCode) {
      return true;
    }
    if (parentCode === code) {
      return true;
    }
    return !accountByCode.has(parentCode);
  })
  .sort(compareAccountsForTree);
const treeRows = [];
const visited = new Set();
function walk(account, depth) {
  const visitKey = getAccountTreeVisitKey(account);
  if (!visitKey || visited.has(visitKey)) {
    return;
  }
  visited.add(visitKey);
  const code = toUpper(account?.code);
  const children = code ? childrenByParentCode.get(code) || [] : [];
  treeRows.push({
    account,
    depth,
    childCount: children.length,
  });
  for (const child of children) {
    walk(child, depth + 1);
  }
}
for (const root of roots) {
  walk(root, 0);
}
const unresolved = rows
  .filter((account) => !visited.has(getAccountTreeVisitKey(account)))
  .sort(compareAccountsForTree);
for (const account of unresolved) {
  walk(account, 0);
}
return treeRows;
}
function compactEntityPayload(entity) {
const branches = (entity.branches || [])
  .filter((branch) => branch.code.trim() && branch.name.trim())
  .map((branch) => ({
    code: branch.code.trim(),
    name: branch.name.trim(),
    unitType: String(branch.unitType || "BRANCH").toUpperCase(),
    hasSubledger: Boolean(branch.hasSubledger),
  }));

const defaultAccounts = sanitizeDefaultAccounts(entity.defaultAccounts);

return {
  code: entity.code.trim(),
  name: entity.name.trim(),
  functionalCurrencyCode: entity.functionalCurrencyCode.trim().toUpperCase(),
  isIntercompanyEnabled: Boolean(entity.isIntercompanyEnabled),
  intercompanyPartnerRequired: Boolean(entity.intercompanyPartnerRequired),
  ...(entity.taxId.trim() ? { taxId: entity.taxId.trim() } : {}),
  ...(entity.countryIso2.trim()
    ? { countryIso2: entity.countryIso2.trim().toUpperCase() }
    : {}),
  ...(entity.coaCode.trim() ? { coaCode: entity.coaCode.trim() } : {}),
  ...(entity.coaName.trim() ? { coaName: entity.coaName.trim() } : {}),
  ...(entity.bookCode.trim() ? { bookCode: entity.bookCode.trim() } : {}),
  ...(entity.bookName.trim() ? { bookName: entity.bookName.trim() } : {}),
  ...(entity.policyPackId.trim()
    ? { policyPackId: entity.policyPackId.trim().toUpperCase() }
    : {}),
  ...(defaultAccounts.length > 0 ? { defaultAccounts } : {}),
  ...(branches.length > 0 ? { branches } : {}),
};
}
function validateAccountTreeRows(defaultAccounts, prefix, l) {
const rows = sanitizeDefaultAccounts(defaultAccounts);
if (rows.length === 0) {
  return l(
    `${prefix}: at least one account row is required in account tree step.`,
    `${prefix}: hesap agaci adiminda en az bir hesap satiri zorunludur.`
  );
}
const rowByCode = new Map();
for (const row of rows) {
  if (rowByCode.has(row.code)) {
    return l(
      `${prefix}: duplicate account code detected (${row.code}).`,
      `${prefix}: yinelenen hesap kodu algilandi (${row.code}).`
    );
  }
  rowByCode.set(row.code, row);
}
for (const row of rows) {
  const parentCode = toUpper(row.parentCode);
  if (!parentCode) {
    continue;
  }
  if (parentCode === row.code) {
    return l(
      `${prefix}: account ${row.code} cannot use itself as parent.`,
      `${prefix}: ${row.code} hesabi kendisini ust hesap olarak secemez.`
    );
  }
  if (!rowByCode.has(parentCode)) {
    return l(
      `${prefix}: parentCode ${parentCode} is missing from account tree rows.`,
      `${prefix}: parentCode ${parentCode} hesap agaci satirlarinda bulunamadi.`
    );
  }
}
const visitStateByCode = new Map();
function hasCycle(code) {
  const state = visitStateByCode.get(code);
  if (state === "visiting") {
    return true;
  }
  if (state === "visited") {
    return false;
  }
  visitStateByCode.set(code, "visiting");
  const row = rowByCode.get(code);
  const parentCode = toUpper(row?.parentCode);
  if (parentCode && hasCycle(parentCode)) {
    return true;
  }
  visitStateByCode.set(code, "visited");
  return false;
}
for (const row of rows) {
  if (hasCycle(row.code)) {
    return l(
      `${prefix}: parent-child cycle detected in account tree.`,
      `${prefix}: hesap agacinda ust-alt iliski dongusu algilandi.`
    );
  }
}
return "";
}
function validateForm(form, l) {
if (!form.groupCompany.code.trim() || !form.groupCompany.name.trim()) {
  return l(
    "Group company code and name are required.",
    "Grup sirketi kodu ve adi zorunludur."
  );
}
if (!form.fiscalCalendar.code.trim() || !form.fiscalCalendar.name.trim()) {
  return l(
    "Fiscal calendar code and name are required.",
    "Mali takvim kodu ve adi zorunludur."
  );
}
const yearStartMonth = Number(form.fiscalCalendar.yearStartMonth);
const yearStartDay = Number(form.fiscalCalendar.yearStartDay);
if (yearStartMonth < 1 || yearStartMonth > 12) {
  return l(
    "Fiscal calendar start month must be between 1 and 12.",
    "Mali takvim baslangic ayi 1 ile 12 arasinda olmali."
  );
}
if (yearStartDay < 1 || yearStartDay > 31) {
  return l(
    "Fiscal calendar start day must be between 1 and 31.",
    "Mali takvim baslangic gunu 1 ile 31 arasinda olmali."
  );
}
const fiscalYear = Number(form.fiscalYear);
if (!Number.isInteger(fiscalYear) || fiscalYear <= 0) {
  return l(
    "Fiscal year must be a positive integer.",
    "Mali yil pozitif bir tam sayi olmali."
  );
}
if (!Array.isArray(form.legalEntities) || form.legalEntities.length === 0) {
  return l(
    "At least one legal entity is required.",
    "En az bir istirak / bagli ortak zorunludur."
  );
}
for (let index = 0; index < form.legalEntities.length; index += 1) {
  const entity = form.legalEntities[index];
  const prefix = `Legal entity ${index + 1}`;
  if (!entity.code.trim() || !entity.name.trim()) {
    return l(
      `${prefix}: code and name are required.`,
      `Istirak / bagli ortak ${index + 1}: kod ve ad zorunludur.`
    );
  }
  if (!entity.countryIso2.trim()) {
    return l(
      `${prefix}: country ISO2 is required (e.g. US, TR, DE).`,
      `Istirak / bagli ortak ${index + 1}: ulke ISO2 zorunludur (orn. US, TR, DE).`
    );
  }
  if (!entity.functionalCurrencyCode.trim()) {
    return l(
      `${prefix}: functional currency is required.`,
      `Istirak / bagli ortak ${index + 1}: fonksiyonel para birimi zorunludur.`
    );
  }
  const accountTreeError = validateAccountTreeRows(entity.defaultAccounts, prefix, l);
  if (accountTreeError) {
    return accountTreeError;
  }
}
return "";
}
function validateWizardStep(form, stepKey, l) {
if (stepKey === "country" || stepKey === "entity") {
  if (!form.groupCompany.code.trim() || !form.groupCompany.name.trim()) {
    return l(
      "Group company code and name are required.",
      "Grup sirketi kodu ve adi zorunludur."
    );
  }
  if (!form.fiscalCalendar.code.trim() || !form.fiscalCalendar.name.trim()) {
    return l(
      "Fiscal calendar code and name are required.",
      "Mali takvim kodu ve adi zorunludur."
    );
  }
  const yearStartMonth = Number(form.fiscalCalendar.yearStartMonth);
  const yearStartDay = Number(form.fiscalCalendar.yearStartDay);
  if (yearStartMonth < 1 || yearStartMonth > 12) {
    return l(
      "Fiscal calendar start month must be between 1 and 12.",
      "Mali takvim baslangic ayi 1 ile 12 arasinda olmali."
    );
  }
  if (yearStartDay < 1 || yearStartDay > 31) {
    return l(
      "Fiscal calendar start day must be between 1 and 31.",
      "Mali takvim baslangic gunu 1 ile 31 arasinda olmali."
    );
  }
  const fiscalYear = Number(form.fiscalYear);
  if (!Number.isInteger(fiscalYear) || fiscalYear <= 0) {
    return l(
      "Fiscal year must be a positive integer.",
      "Mali yil pozitif bir tam sayi olmali."
    );
  }
  for (let index = 0; index < form.legalEntities.length; index += 1) {
    const entity = form.legalEntities[index];
    if (!entity.code.trim() || !entity.name.trim()) {
      return l(
        `Legal entity ${index + 1}: code and name are required.`,
        `Istirak / bagli ortak ${index + 1}: kod ve ad zorunludur.`
      );
    }
    if (!entity.countryIso2.trim()) {
      return l(
        `Legal entity ${index + 1}: country ISO2 is required (e.g. US, TR, DE).`,
        `Istirak / bagli ortak ${index + 1}: ulke ISO2 zorunludur (orn. US, TR, DE).`
      );
    }
    if (!entity.functionalCurrencyCode.trim()) {
      return l(
        `Legal entity ${index + 1}: functional currency is required.`,
        `Istirak / bagli ortak ${index + 1}: fonksiyonel para birimi zorunludur.`
      );
    }
  }
}
if (stepKey === "accountTree") {
  for (let index = 0; index < form.legalEntities.length; index += 1) {
    const entity = form.legalEntities[index];
    const prefix = `Legal entity ${index + 1}`;
    const accountTreeError = validateAccountTreeRows(entity.defaultAccounts, prefix, l);
    if (accountTreeError) {
      return accountTreeError;
    }
  }
}
return "";
}
export default function CompanyOnboardingPage() {
const { hasPermission } = useAuth();
const { language } = useI18n();
const isTr = language === "tr";
const l = (en, tr) => (isTr ? tr : en);
const canSetupCompany = hasPermission("onboarding.company.setup");
const [form, setForm] = useState(createInitialForm());
const [activeStepIndex, setActiveStepIndex] = useState(0);
const [countries, setCountries] = useState([]);
const [currencies, setCurrencies] = useState([]);
const [policyPacks, setPolicyPacks] = useState([]);
const [policyPackDetailsById, setPolicyPackDetailsById] = useState({});
const [packBusyByEntityId, setPackBusyByEntityId] = useState({});
const [lookupWarning, setLookupWarning] = useState("");
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState("");
const [message, setMessage] = useState("");
const [result, setResult] = useState(null);
const [showAllPolicyPackOptions, setShowAllPolicyPackOptions] = useState(false);
const [selectedAccountIdByEntityId, setSelectedAccountIdByEntityId] = useState({});
const activeStep = WIZARD_STEPS[activeStepIndex] || WIZARD_STEPS[0];
const isLastStep = activeStepIndex >= WIZARD_STEPS.length - 1;
const entityCount = useMemo(
  () => form.legalEntities.length,
  [form.legalEntities.length]
);
const countryOptions = useMemo(() => {
  return [...countries].sort((left, right) =>
    String(left?.iso2 || "").localeCompare(String(right?.iso2 || ""))
  );
}, [countries]);
const currencyOptions = useMemo(() => {
  return [...currencies].sort((left, right) =>
    String(left?.code || "").localeCompare(String(right?.code || ""))
  );
}, [currencies]);
const countriesByIso2 = useMemo(() => {
  const map = new Map();
  for (const row of countryOptions) {
    const iso2 = toUpper(row?.iso2);
    if (iso2) {
      map.set(iso2, row);
    }
  }
  return map;
}, [countryOptions]);
const policyPacksByCountry = useMemo(() => {
  const map = new Map();
  for (const row of policyPacks || []) {
    const countryIso2 = toUpper(row?.countryIso2);
    if (!countryIso2) {
      continue;
    }
    if (!map.has(countryIso2)) {
      map.set(countryIso2, []);
    }
    map.get(countryIso2).push(row);
  }
  return map;
}, [policyPacks]);
const policyPackOptions = useMemo(() => {
  return [...(policyPacks || [])].sort((left, right) => {
    const leftCountry = toUpper(left?.countryIso2);
    const rightCountry = toUpper(right?.countryIso2);
    if (leftCountry !== rightCountry) {
      return leftCountry.localeCompare(rightCountry);
    }
    return String(left?.packId || "").localeCompare(String(right?.packId || ""));
  });
}, [policyPacks]);
useEffect(() => {
  let active = true;
  async function loadLookups() {
    if (!canSetupCompany) {
      return;
    }
    const warnings = [];
    try {
      const response = await listCountries();
      if (!active) return;
      setCountries(Array.isArray(response?.rows) ? response.rows : []);
    } catch (err) {
      if (!active) return;
      setCountries([]);
      warnings.push(err?.response?.data?.message || "Country lookup could not be loaded");
    }
    try {
      const response = await listCurrencies();
      if (!active) return;
      setCurrencies(Array.isArray(response?.rows) ? response.rows : []);
    } catch (err) {
      if (!active) return;
      setCurrencies([]);
      warnings.push(err?.response?.data?.message || "Currency lookup could not be loaded");
    }
    try {
      const response = await listPolicyPacks();
      if (!active) return;
      setPolicyPacks(Array.isArray(response?.rows) ? response.rows : []);
    } catch (err) {
      if (!active) return;
      setPolicyPacks([]);
      warnings.push(
        err?.response?.data?.message || "Policy pack list could not be loaded"
      );
    }
    if (!active) return;
    setLookupWarning(warnings.join(" | "));
  }
  loadLookups();
  return () => {
    active = false;
  };
}, [canSetupCompany]);
function setGroupCompanyField(field, value) {
  setForm((prev) => ({
    ...prev,
    groupCompany: {
      ...prev.groupCompany,
      [field]: value,
    },
  }));
}
function setFiscalCalendarField(field, value) {
  setForm((prev) => ({
    ...prev,
    fiscalCalendar: {
      ...prev.fiscalCalendar,
      [field]: value,
    },
  }));
}
function setEntityField(entityId, field, value) {
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) =>
      entity.id === entityId ? { ...entity, [field]: value } : entity
    ),
  }));
}
function setEntityCountry(entityId, rawIso2) {
  const nextCountryIso2 = toUpper(rawIso2).slice(0, 2);
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) => {
      if (entity.id !== entityId) {
        return entity;
      }
      const countryRow = countriesByIso2.get(nextCountryIso2) || null;
      const previousCountryIso2 = toUpper(entity.countryIso2);
      const previousRecommendedPackId = String(
        (policyPacksByCountry.get(previousCountryIso2) || [])[0]?.packId || ""
      ).trim();
      const recommendedPacks = policyPacksByCountry.get(nextCountryIso2) || [];
      const recommendedPackId = String(recommendedPacks[0]?.packId || "").trim();
      const shouldAutoSwitchPack =
        !toUpper(entity.policyPackId) ||
        toUpper(entity.policyPackId) === toUpper(previousRecommendedPackId);
      return {
        ...entity,
        countryIso2: nextCountryIso2,
        policyPackId: shouldAutoSwitchPack
          ? recommendedPackId || entity.policyPackId || ""
          : entity.policyPackId,
        functionalCurrencyCode: countryRow?.default_currency_code
          ? toUpper(countryRow.default_currency_code)
          : entity.functionalCurrencyCode,
        defaultAccounts:
          entity.defaultAccounts && entity.defaultAccounts.length > 0
            ? entity.defaultAccounts
            : getCountryStarterAccounts(nextCountryIso2),
      };
    }),
  }));
}
function addEntity() {
  setForm((prev) => ({
    ...prev,
    legalEntities: [...prev.legalEntities, createEntityDraft()],
  }));
}
function removeEntity(entityId) {
  setForm((prev) => {
    if (prev.legalEntities.length <= 1) {
      return prev;
    }
    return {
      ...prev,
      legalEntities: prev.legalEntities.filter((entity) => entity.id !== entityId),
    };
  });
  setSelectedAccountIdByEntityId((prev) => {
    if (!Object.prototype.hasOwnProperty.call(prev, entityId)) {
      return prev;
    }
    const next = { ...prev };
    delete next[entityId];
    return next;
  });
}
function setSelectedAccount(entityId, accountId) {
  setSelectedAccountIdByEntityId((prev) => ({
    ...prev,
    [entityId]: accountId,
  }));
}
function addDefaultAccount(entityId, parentCode = "") {
  const nextAccount = createAccountDraft({ parentCode });
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) =>
      entity.id === entityId
        ? { ...entity, defaultAccounts: [...entity.defaultAccounts, nextAccount] }
        : entity
    ),
  }));
  setSelectedAccount(entityId, nextAccount.id);
}
function setDefaultAccountField(entityId, accountId, field, value) {
  const normalizedValue =
    field === "code" ||
    field === "parentCode" ||
    field === "accountType" ||
    field === "normalSide"
      ? toUpper(value)
      : value;
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) => {
      if (entity.id !== entityId) {
        return entity;
      }
      return {
        ...entity,
        defaultAccounts: (entity.defaultAccounts || []).map((account) =>
          account.id === accountId
            ? { ...account, [field]: normalizedValue }
            : account
        ),
      };
    }),
  }));
}
function removeDefaultAccount(entityId, accountId) {
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) => {
      if (entity.id !== entityId) {
        return entity;
      }
      if ((entity.defaultAccounts || []).length <= 1) {
        return entity;
      }
      return {
        ...entity,
        defaultAccounts: entity.defaultAccounts.filter(
          (account) => account.id !== accountId
        ),
      };
    }),
  }));
  setSelectedAccountIdByEntityId((prev) => {
    if (prev?.[entityId] !== accountId) {
      return prev;
    }
    const next = { ...prev };
    delete next[entityId];
    return next;
  });
}
function setAllDefaultAccountsAllowPosting(entityId, allowPosting) {
  const nextValue = Boolean(allowPosting);
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) => {
      if (entity.id !== entityId) {
        return entity;
      }
      return {
        ...entity,
        defaultAccounts: (entity.defaultAccounts || []).map((account) => ({
          ...account,
          allowPosting: nextValue,
        })),
      };
    }),
  }));
}
function addBranch(entityId) {
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) =>
      entity.id === entityId
        ? { ...entity, branches: [...entity.branches, createBranchDraft()] }
        : entity
    ),
  }));
}
function setBranchField(entityId, branchId, field, value) {
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) =>
      entity.id === entityId
        ? {
            ...entity,
            branches: entity.branches.map((branch) =>
              branch.id === branchId ? { ...branch, [field]: value } : branch
            ),
          }
        : entity
    ),
  }));
}
function removeBranch(entityId, branchId) {
  setForm((prev) => ({
    ...prev,
    legalEntities: prev.legalEntities.map((entity) => {
      if (entity.id !== entityId) {
        return entity;
      }
      if (entity.branches.length <= 1) {
        return entity;
      }
      return {
        ...entity,
        branches: entity.branches.filter((branch) => branch.id !== branchId),
      };
    }),
  }));
}
async function ensurePolicyPackDetail(packId) {
  const normalizedPackId = toUpper(packId);
  if (!normalizedPackId) {
    return null;
  }
  if (policyPackDetailsById[normalizedPackId]) {
    return policyPackDetailsById[normalizedPackId];
  }
  const response = await getPolicyPack(normalizedPackId);
  const detail = response?.row || null;
  if (!detail) {
    return null;
  }
  setPolicyPackDetailsById((prev) => ({
    ...prev,
    [normalizedPackId]: detail,
  }));
  return detail;
}
async function applyPolicyPackTemplate(entityId, preferredPackId = null) {
  const entity = form.legalEntities.find((row) => row.id === entityId);
  if (!entity) {
    return;
  }
  const recommendedPackId = String(preferredPackId || entity.policyPackId || "").trim();
  if (!recommendedPackId) {
    setError(
      l(
        "No policy pack selected for this legal entity.",
        "Bu birim icin secili bir policy pack yok."
      )
    );
    return;
  }
  setPackBusyByEntityId((prev) => ({ ...prev, [entityId]: true }));
  setError("");
  setMessage("");
  try {
    const detail = await ensurePolicyPackDetail(recommendedPackId);
    if (!detail) {
      throw new Error("Policy pack not found");
    }
    const nextAccounts = deriveStarterAccountsFromPolicyPack(
      detail,
      entity.countryIso2
    );
    setForm((prev) => ({
      ...prev,
      legalEntities: prev.legalEntities.map((row) => {
        if (row.id !== entityId) {
          return row;
        }
        const country = toUpper(row.countryIso2) || "US";
        const fallbackEntityCode = toUpper(row.code || "LE");
        return {
          ...row,
          policyPackId: recommendedPackId,
          defaultAccounts: nextAccounts,
          coaCode: row.coaCode || `COA-${fallbackEntityCode}`,
          coaName:
            row.coaName ||
            `${country} ${l("Starter CoA", "Baslangic Hesap Plani")}`,
          bookCode: row.bookCode || `BOOK-${fallbackEntityCode}`,
          bookName: row.bookName || `${country} ${l("Local Book", "Yerel Defter")}`,
        };
      }),
    }));
    setMessage(
      l(
        `Starter template applied (${recommendedPackId}). You can still override manually.`,
        `Baslangic sablonu uygulandi (${recommendedPackId}). Yine de manuel olarak degistirebilirsiniz.`
      )
    );
  } catch (err) {
    setError(
      err?.response?.data?.message ||
        err?.message ||
        l(
          "Failed to apply selected policy pack template.",
          "Secilen policy pack sablonu uygulanamadi."
        )
    );
  } finally {
    setPackBusyByEntityId((prev) => ({ ...prev, [entityId]: false }));
  }
}
function loadSample() {
  setForm({
    groupCompany: {
      code: "GLOBAL",
      name: "Global Holdings",
    },
    fiscalCalendar: {
      code: "MAIN",
      name: "Main Calendar",
      yearStartMonth: 1,
      yearStartDay: 1,
    },
    fiscalYear: new Date().getUTCFullYear(),
    legalEntities: [
      {
        id: createId("entity"),
        code: "US01",
        name: "US Operations LLC",
        taxId: "",
        countryIso2: "US",
        functionalCurrencyCode: "USD",
        isIntercompanyEnabled: true,
        intercompanyPartnerRequired: false,
        policyPackId: "US_GAAP_STARTER_V1",
        coaCode: "COA-US01",
        coaName: "US Local CoA",
        bookCode: "BOOK-US01",
        bookName: "US Local Book",
        defaultAccounts: getCountryStarterAccounts("US"),
        branches: [
          {
            id: createId("branch"),
            code: "NYC",
            name: "New York Branch",
            unitType: "BRANCH",
            hasSubledger: true,
          },
        ],
      },
    ],
  });
  setActiveStepIndex(0);
  setResult(null);
  setError("");
  setMessage(l("Sample template loaded.", "Ornek sablon yuklendi."));
}
function resetForm() {
  setForm(createInitialForm());
  setActiveStepIndex(0);
  setResult(null);
  setError("");
  setMessage("");
}
function goToNextStep() {
  const validationError = validateWizardStep(form, activeStep.key, l);
  if (validationError) {
    setError(validationError);
    return;
  }
  setError("");
  setActiveStepIndex((prev) => Math.min(prev + 1, WIZARD_STEPS.length - 1));
}
function goToPreviousStep() {
  setError("");
  setActiveStepIndex((prev) => Math.max(prev - 1, 0));
}
async function handleSubmit(event) {
  event.preventDefault();
  setError("");
  setMessage("");
  setResult(null);
  if (!canSetupCompany) {
    setError(
      l(
        "Missing permission: onboarding.company.setup",
        "Eksik yetki: onboarding.company.setup"
      )
    );
    return;
  }
  const validationError = validateForm(form, l);
  if (validationError) {
    setError(validationError);
    return;
  }
  const payload = {
    groupCompany: {
      code: form.groupCompany.code.trim(),
      name: form.groupCompany.name.trim(),
    },
    fiscalCalendar: {
      code: form.fiscalCalendar.code.trim(),
      name: form.fiscalCalendar.name.trim(),
      yearStartMonth: Number(form.fiscalCalendar.yearStartMonth),
      yearStartDay: Number(form.fiscalCalendar.yearStartDay),
    },
    fiscalYear: Number(form.fiscalYear),
    legalEntities: form.legalEntities.map(compactEntityPayload),
  };
  setSubmitting(true);
  try {
    const response = await bootstrapCompany(payload);
    setResult(response);
    setMessage(
      l(
        "Company bootstrap completed successfully.",
        "Sirket temel kurulumu basariyla tamamlandi."
      )
    );
  } catch (err) {
    setError(
      err?.response?.data?.message ||
        l("Failed to bootstrap company.", "Sirket kurulumu tamamlanamadi.")
    );
  } finally {
    setSubmitting(false);
  }
}
return (
  <div className="space-y-4">
    <TenantReadinessChecklist />
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {l("Setup Wizard V2", "Kurulum Sihirbazi V2")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Company + Entities -> CoA Template -> Account Tree -> Branches",
              "Sirket + Birimler -> Hesap Plani Sablonu -> Hesap Agaci -> Subeler"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadSample}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {l("Load Sample", "Ornek Yukle")}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {l("Reset", "Sifirla")}
          </button>
        </div>
      </div>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <ol className="grid gap-2 sm:grid-cols-4">
        {WIZARD_STEPS.map((step, index) => {
          const isActive = index === activeStepIndex;
          const isCompleted = index < activeStepIndex;
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => {
                  if (index <= activeStepIndex) {
                    setActiveStepIndex(index);
                  }
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isCompleted
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide">
                  {l("Step", "Adim")} {index + 1}
                </div>
                <div>{isTr ? step.titleTr : step.titleEn}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
    {lookupWarning ? (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {lookupWarning}
      </div>
    ) : null}
    {error && (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {error}
      </div>
    )}
    {message && (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {message}
      </div>
    )}
    <form onSubmit={handleSubmit} className="space-y-4">
      {activeStep.key === "country" || activeStep.key === "entity" ? (
        <section className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              {l("Group Company", "Grup Sirketi")}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.groupCompany.code}
                onChange={(event) => setGroupCompanyField("code", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Code (e.g. GLOBAL)", "Kod (orn. GLOBAL)")}
                required
              />
              <input
                value={form.groupCompany.name}
                onChange={(event) => setGroupCompanyField("name", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Name", "Ad")}
                required
              />
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              {l("Fiscal Calendar", "Mali Takvim")}
            </h2>
            <div className="grid gap-3 md:grid-cols-5">
              <input
                value={form.fiscalCalendar.code}
                onChange={(event) =>
                  setFiscalCalendarField("code", event.target.value)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Calendar code", "Takvim kodu")}
                required
              />
              <input
                value={form.fiscalCalendar.name}
                onChange={(event) =>
                  setFiscalCalendarField("name", event.target.value)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={l("Calendar name", "Takvim adi")}
                required
              />
              <input
                type="number"
                min={1}
                max={12}
                value={form.fiscalCalendar.yearStartMonth}
                onChange={(event) =>
                  setFiscalCalendarField("yearStartMonth", event.target.value)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Start month", "Baslangic ayi")}
                required
              />
              <input
                type="number"
                min={1}
                max={31}
                value={form.fiscalCalendar.yearStartDay}
                onChange={(event) =>
                  setFiscalCalendarField("yearStartDay", event.target.value)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Start day", "Baslangic gunu")}
                required
              />
            </div>
            <div className="mt-3 grid gap-3 md:w-52">
              <input
                type="number"
                min={2000}
                value={form.fiscalYear}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, fiscalYear: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={l("Fiscal year", "Mali yil")}
                required
              />
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                {l("Legal Entities", "Istirakler / Bagli Ortaklar")} ({entityCount})
              </h2>
              <button
                type="button"
                onClick={addEntity}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Add Legal Entity", "Istirak / Bagli Ortak Ekle")}
              </button>
            </div>
            <div className="space-y-3">
              {form.legalEntities.map((entity, entityIndex) => {
                const countryIso2 = toUpper(entity.countryIso2);
                const recommendedPack =
                  (policyPacksByCountry.get(countryIso2) || [])[0] || null;
                return (
                  <article
                    key={entity.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                  >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {l("Entity", "Birim")} {entityIndex + 1}
                    </h3>
                    <button
                      type="button"
                      onClick={() => removeEntity(entity.id)}
                      disabled={form.legalEntities.length <= 1}
                      className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {l("Remove", "Kaldir")}
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <input
                      value={entity.code}
                      onChange={(event) =>
                        setEntityField(entity.id, "code", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={l("Entity code", "Birim kodu")}
                      required
                    />
                    <input
                      value={entity.name}
                      onChange={(event) =>
                        setEntityField(entity.id, "name", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                      placeholder={l("Entity name", "Birim adi")}
                      required
                    />
                    <input
                      value={entity.taxId}
                      onChange={(event) =>
                        setEntityField(entity.id, "taxId", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={l("Tax ID (optional)", "Vergi No (opsiyonel)")}
                    />
                    {countryOptions.length > 0 ? (
                      <select
                        value={countryIso2}
                        onChange={(event) =>
                          setEntityCountry(entity.id, event.target.value)
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        required
                      >
                        <option value="">
                          {l("Select country", "Ulke secin")}
                        </option>
                        {countryOptions.map((row) => {
                          const iso2 = toUpper(row?.iso2);
                          return (
                            <option key={iso2 || row?.id} value={iso2}>
                              {iso2} - {row?.name || "-"}
                            </option>
                          );
                        })}
                      </select>
                    ) : null}
                    <input
                      value={countryIso2}
                      onChange={(event) =>
                        setEntityCountry(entity.id, event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={l("Country ISO2 (manual)", "Ulke ISO2 (manuel)")}
                      maxLength={2}
                      required
                    />
                    {currencyOptions.length > 0 ? (
                      <select
                        value={entity.functionalCurrencyCode}
                        onChange={(event) =>
                          setEntityField(
                            entity.id,
                            "functionalCurrencyCode",
                            event.target.value
                          )
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        required
                      >
                        <option value="">
                          {l("Select currency", "Para birimi secin")}
                        </option>
                        {currencyOptions.map((row) => {
                          const code = toUpper(row?.code);
                          return (
                            <option key={code || row?.id} value={code}>
                              {code} - {row?.name || "-"}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <input
                        value={entity.functionalCurrencyCode}
                        onChange={(event) =>
                          setEntityField(
                            entity.id,
                            "functionalCurrencyCode",
                            event.target.value
                          )
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={l(
                          "Functional currency (e.g. USD)",
                          "Fonksiyonel para birimi (orn. USD)"
                        )}
                        maxLength={3}
                        required
                      />
                    )}
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 md:col-span-2">
                      {recommendedPack
                        ? l(
                            `Recommended pack: ${recommendedPack.packId}`,
                            `Onerilen paket: ${recommendedPack.packId}`
                          )
                        : l(
                            "No country-specific starter pack found; manual path is available.",
                            "Ulkeye ozel baslangic paketi bulunamadi; manuel yol kullanilabilir."
                          )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={entity.isIntercompanyEnabled}
                        onChange={(event) =>
                          setEntityField(
                            entity.id,
                            "isIntercompanyEnabled",
                            event.target.checked
                          )
                        }
                      />
                      {l("Intercompany enabled", "Intercompany aktif")}
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={entity.intercompanyPartnerRequired}
                        onChange={(event) =>
                          setEntityField(
                            entity.id,
                            "intercompanyPartnerRequired",
                            event.target.checked
                          )
                        }
                      />
                      {l(
                        "Intercompany partner required",
                        "Intercompany karsi taraf zorunlu"
                      )}
                    </label>
                  </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}
      {activeStep.key === "template" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("CoA Template and Defaults", "Hesap Plani Sablonu ve Varsayilanlar")}
          </h2>
          <p className="mb-3 text-xs text-slate-600">
            {l(
              "Wizard recommends a policy pack by selected country, then you can apply starter accounts or continue manually.",
              "Sihirbaz secilen ulkeye gore bir policy pack onerir; ardindan baslangic hesaplarini uygulayabilir veya manuel devam edebilirsiniz."
            )}
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAllPolicyPackOptions}
                onChange={(event) => setShowAllPolicyPackOptions(event.target.checked)}
              />
              {l(
                "Show templates from all countries",
                "Tum ulke sablonlarini goster"
              )}
            </label>
            <span>
              {showAllPolicyPackOptions
                ? l("All templates visible", "Tum sablonlar gorunur")
                : l(
                    "Recommended-country templates only",
                    "Yalnizca onerilen ulke sablonlari"
                  )}
            </span>
          </div>

          <div className="space-y-3">
            {form.legalEntities.map((entity, index) => {
              const countryIso2 = toUpper(entity.countryIso2);
              const countryPackRows = policyPacksByCountry.get(countryIso2) || [];
              const recommendedPack = countryPackRows[0] || null;
              const selectedPack =
                policyPackOptions.find(
                  (row) => toUpper(row?.packId) === toUpper(entity.policyPackId)
                ) || null;
              const selectedPackCountryIso2 = toUpper(selectedPack?.countryIso2);
              const isCrossCountrySelection =
                Boolean(selectedPack) &&
                Boolean(countryIso2) &&
                Boolean(selectedPackCountryIso2) &&
                selectedPackCountryIso2 !== countryIso2;
              const selectablePackRows = (() => {
                const baseRows = showAllPolicyPackOptions
                  ? [...policyPackOptions]
                  : [...countryPackRows];
                if (
                  !showAllPolicyPackOptions &&
                  selectedPack &&
                  !baseRows.some(
                    (row) => toUpper(row?.packId) === toUpper(selectedPack?.packId)
                  )
                ) {
                  baseRows.push(selectedPack);
                }
                return baseRows.sort((left, right) => {
                  const leftPackId = toUpper(left?.packId);
                  const rightPackId = toUpper(right?.packId);
                  const leftCountry = toUpper(left?.countryIso2);
                  const rightCountry = toUpper(right?.countryIso2);
                  if (showAllPolicyPackOptions) {
                    const leftPriority =
                      leftPackId && leftPackId === toUpper(recommendedPack?.packId)
                        ? 0
                        : leftCountry === countryIso2
                          ? 1
                          : 2;
                    const rightPriority =
                      rightPackId && rightPackId === toUpper(recommendedPack?.packId)
                        ? 0
                        : rightCountry === countryIso2
                          ? 1
                          : 2;
                    if (leftPriority !== rightPriority) {
                      return leftPriority - rightPriority;
                    }
                  } else {
                    const leftPriority = leftCountry === countryIso2 ? 0 : 1;
                    const rightPriority = rightCountry === countryIso2 ? 0 : 1;
                    if (leftPriority !== rightPriority) {
                      return leftPriority - rightPriority;
                    }
                  }
                  if (leftCountry !== rightCountry) {
                    return leftCountry.localeCompare(rightCountry);
                  }
                  return String(left?.packId || "").localeCompare(
                    String(right?.packId || "")
                  );
                });
              })();
              const isPackBusy = Boolean(packBusyByEntityId[entity.id]);
              return (
                <article
                  key={entity.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
                >
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    {l("Entity", "Birim")} {index + 1} -{" "}
                    {entity.code || l("No code", "Kod yok")}
                  </h3>

                  <div className="grid gap-2 md:grid-cols-4">
                    <select
                      value={entity.policyPackId}
                      onChange={(event) =>
                        setEntityField(entity.id, "policyPackId", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                    >
                      <option value="">
                        {l("Manual path (no policy pack)", "Manuel yol (policy pack yok)")}
                      </option>
                      {selectablePackRows.map((row) => (
                        <option key={row.packId} value={row.packId}>
                          {row.packId} - {row.label} ({toUpper(row.countryIso2) || "--"})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => applyPolicyPackTemplate(entity.id)}
                      disabled={isPackBusy || !entity.policyPackId}
                      className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-50"
                    >
                      {isPackBusy
                        ? l("Applying...", "Uygulaniyor...")
                        : l("Apply Starter Template", "Baslangic Sablonunu Uygula")}
                    </button>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      {l("Selected country", "Secili ulke")}: {countryIso2 || "-"}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      {l("Recommended pack", "Onerilen paket")}:{" "}
                      {recommendedPack?.packId || l("None", "Yok")}
                    </div>
                    <div
                      className={`rounded-lg px-3 py-2 text-xs md:col-span-2 ${
                        isCrossCountrySelection
                          ? "border border-amber-200 bg-amber-50 text-amber-800"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {isCrossCountrySelection
                        ? l(
                            `Selected template (${selectedPack?.packId || "-"}) belongs to ${selectedPackCountryIso2}. Country is ${countryIso2}.`,
                            `Secilen sablon (${selectedPack?.packId || "-"}) ${selectedPackCountryIso2} ulkesine ait. Birim ulkesi ${countryIso2}.`
                          )
                        : l(
                            "Selected template matches entity country or manual path is active.",
                            "Secilen sablon birim ulkesiyle uyumlu veya manuel yol aktif."
                          )}
                    </div>

                    <input
                      value={entity.coaCode}
                      onChange={(event) =>
                        setEntityField(entity.id, "coaCode", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={l(
                        "CoA code (optional override)",
                        "Hesap plani kodu (opsiyonel override)"
                      )}
                    />
                    <input
                      value={entity.coaName}
                      onChange={(event) =>
                        setEntityField(entity.id, "coaName", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                      placeholder={l(
                        "CoA name (optional override)",
                        "Hesap plani adi (opsiyonel override)"
                      )}
                    />
                    <input
                      value={entity.bookCode}
                      onChange={(event) =>
                        setEntityField(entity.id, "bookCode", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={l(
                        "Book code (optional override)",
                        "Defter kodu (opsiyonel override)"
                      )}
                    />
                    <input
                      value={entity.bookName}
                      onChange={(event) =>
                        setEntityField(entity.id, "bookName", event.target.value)
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                      placeholder={l(
                        "Book name (optional override)",
                        "Defter adi (opsiyonel override)"
                      )}
                    />
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      {l("Starter account rows", "Baslangic hesap satiri")}:{" "}
                      {sanitizeDefaultAccounts(entity.defaultAccounts).length}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {activeStep.key === "accountTree" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Account Tree (Starter Accounts)", "Hesap Agaci (Baslangic Hesaplari)")}
          </h2>
          <p className="mb-3 text-xs text-slate-600">
            {l(
              "Manual override is fully supported. Use Parent Code to build hierarchy; parent rows will be forced non-postable on backend.",
              "Manuel override tamamen desteklenir. Hiyerarsi icin Ust Kod kullanin; ust satirlar backend tarafinda post-edilemez yapilir."
            )}
          </p>
          <div className="space-y-3">
            {form.legalEntities.map((entity, entityIndex) => {
              const entityAccounts = Array.isArray(entity.defaultAccounts)
                ? entity.defaultAccounts
                : [];
              const treeRows = buildAccountTreeRows(entityAccounts);
              const selectedAccountId = selectedAccountIdByEntityId[entity.id];
              const selectedAccount =
                entityAccounts.find((account) => account.id === selectedAccountId) ||
                treeRows[0]?.account ||
                null;
              const accountCount = entityAccounts.length;
              const parentCodeListId = `parent-code-options-${entity.id}`;
              const parentCodeOptions = [...entityAccounts]
                .filter((account) => toUpper(account?.code))
                .sort(compareAccountsForTree);
              return (
                <article
                  key={entity.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {l("Entity", "Birim")} {entityIndex + 1} -{" "}
                      {entity.code || l("No code", "Kod yok")}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAllDefaultAccountsAllowPosting(entity.id, true)}
                        className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        {l("Select All Post", "Tumunu Post Sec")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAllDefaultAccountsAllowPosting(entity.id, false)}
                        className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                      >
                        {l("Unselect All Post", "Tumunu Post Kaldir")}
                      </button>
                      <button
                        type="button"
                        onClick={() => addDefaultAccount(entity.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {l("Add Root Account", "Kok Hesap Ekle")}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-12">
                    <div className="rounded-lg border border-slate-200 bg-white lg:col-span-7">
                      <div className="max-h-[420px] overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Code", "Kod")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Parent", "Ust")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Name", "Ad")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Type", "Tur")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Side", "Taraf")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Post", "Post")}
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                {l("Actions", "Islemler")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {treeRows.map(({ account, depth, childCount }) => {
                              const code = toUpper(account?.code);
                              const parentCode = toUpper(account?.parentCode);
                              const isSelected = selectedAccount?.id === account.id;
                              return (
                                <tr
                                  key={account.id}
                                  onClick={() => setSelectedAccount(entity.id, account.id)}
                                  className={`cursor-pointer border-t border-slate-100 ${
                                    isSelected ? "bg-cyan-50" : "hover:bg-slate-50"
                                  }`}
                                >
                                  <td className="px-2 py-1.5 font-semibold text-slate-700">
                                    <div
                                      className="flex items-center gap-1"
                                      style={{ paddingLeft: `${Math.max(0, depth) * 16}px` }}
                                    >
                                      <span className="text-[10px] text-slate-400">
                                        {childCount > 0 ? "▸" : "•"}
                                      </span>
                                      <span>{code || "-"}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">
                                    {parentCode || "-"}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-700">
                                    {String(account?.name || "").trim() || "-"}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">
                                    {toUpper(account?.accountType) || "-"}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">
                                    {toUpper(account?.normalSide) || "-"}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">
                                    {account?.allowPosting
                                      ? l("Yes", "Evet")
                                      : l("No", "Hayir")}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex flex-wrap items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedAccount(entity.id, account.id);
                                          addDefaultAccount(entity.id, code);
                                        }}
                                        disabled={!code}
                                        className="rounded border border-cyan-200 px-1.5 py-0.5 font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                                      >
                                        {l("Add Child", "Alt Hesap Ekle")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          removeDefaultAccount(entity.id, account.id);
                                        }}
                                        disabled={accountCount <= 1}
                                        className="rounded border border-rose-200 px-1.5 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                      >
                                        {l("Remove", "Kaldir")}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-5">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {l("Account Editor", "Hesap Duzenleyici")}
                      </h4>
                      {selectedAccount ? (
                        <div className="space-y-2">
                          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs text-cyan-800">
                            {l(
                              "Click rows to focus. Add child/edit/remove from this panel.",
                              "Odaklamak icin satira tiklayin. Bu panelden alt hesap ekleyin/duzenleyin/kaldirin."
                            )}
                          </div>
                          <input
                            value={selectedAccount.code}
                            onChange={(event) =>
                              setDefaultAccountField(
                                entity.id,
                                selectedAccount.id,
                                "code",
                                event.target.value
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            placeholder={l("Code", "Kod")}
                          />
                          <input
                            list={parentCodeListId}
                            value={selectedAccount.parentCode || ""}
                            onChange={(event) =>
                              setDefaultAccountField(
                                entity.id,
                                selectedAccount.id,
                                "parentCode",
                                event.target.value
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            placeholder={l("Parent code (optional)", "Ust kod (opsiyonel)")}
                          />
                          <datalist id={parentCodeListId}>
                            {parentCodeOptions.map((account) => {
                              const code = toUpper(account?.code);
                              if (!code || code === toUpper(selectedAccount.code)) {
                                return null;
                              }
                              return (
                                <option key={`${entity.id}-${account.id}`} value={code}>
                                  {code} - {String(account?.name || "").trim() || "-"}
                                </option>
                              );
                            })}
                          </datalist>
                          <input
                            value={selectedAccount.name}
                            onChange={(event) =>
                              setDefaultAccountField(
                                entity.id,
                                selectedAccount.id,
                                "name",
                                event.target.value
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            placeholder={l("Name", "Ad")}
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select
                              value={selectedAccount.accountType}
                              onChange={(event) =>
                                setDefaultAccountField(
                                  entity.id,
                                  selectedAccount.id,
                                  "accountType",
                                  event.target.value
                                )
                              }
                              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            >
                              {ACCOUNT_TYPES.map((accountType) => (
                                <option key={accountType} value={accountType}>
                                  {accountType}
                                </option>
                              ))}
                            </select>
                            <select
                              value={selectedAccount.normalSide}
                              onChange={(event) =>
                                setDefaultAccountField(
                                  entity.id,
                                  selectedAccount.id,
                                  "normalSide",
                                  event.target.value
                                )
                              }
                              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            >
                              {NORMAL_SIDES.map((normalSide) => (
                                <option key={normalSide} value={normalSide}>
                                  {normalSide}
                                </option>
                              ))}
                            </select>
                          </div>
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedAccount.allowPosting)}
                              onChange={(event) =>
                                setDefaultAccountField(
                                  entity.id,
                                  selectedAccount.id,
                                  "allowPosting",
                                  event.target.checked
                                )
                              }
                            />
                            {l("Allow posting", "Post etmeye izin ver")}
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                addDefaultAccount(entity.id, toUpper(selectedAccount.code))
                              }
                              disabled={!toUpper(selectedAccount.code)}
                              className="rounded-lg border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                            >
                              {l("Add Child Under Selected", "Secili Altina Alt Hesap Ekle")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                removeDefaultAccount(entity.id, selectedAccount.id)
                              }
                              disabled={accountCount <= 1}
                              className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {l("Remove Selected", "Secileni Kaldir")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">
                          {l(
                            "No account row found. Add a root account to continue.",
                            "Hesap satiri bulunamadi. Devam etmek icin kok hesap ekleyin."
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {activeStep.key === "branches" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Branches", "Subeler")}
          </h2>
          <div className="space-y-3">
            {form.legalEntities.map((entity, entityIndex) => (
              <article
                key={entity.id}
                className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {l("Entity", "Birim")} {entityIndex + 1} -{" "}
                    {entity.code || l("No code", "Kod yok")}
                  </h3>
                  <button
                    type="button"
                    onClick={() => addBranch(entity.id)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {l("Add Branch", "Sube Ekle")}
                  </button>
                </div>
                <div className="space-y-2">
                  {entity.branches.map((branch) => (
                    <div
                      key={branch.id}
                      className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2 md:grid-cols-12"
                    >
                      <input
                        value={branch.code}
                        onChange={(event) =>
                          setBranchField(
                            entity.id,
                            branch.id,
                            "code",
                            event.target.value
                          )
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs md:col-span-2"
                        placeholder={l("Branch code", "Sube kodu")}
                      />
                      <input
                        value={branch.name}
                        onChange={(event) =>
                          setBranchField(
                            entity.id,
                            branch.id,
                            "name",
                            event.target.value
                          )
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs md:col-span-4"
                        placeholder={l("Branch name", "Sube adi")}
                      />
                      <select
                        value={branch.unitType}
                        onChange={(event) =>
                          setBranchField(
                            entity.id,
                            branch.id,
                            "unitType",
                            event.target.value
                          )
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs md:col-span-2"
                      >
                        {UNIT_TYPES.map((unitType) => (
                          <option key={unitType} value={unitType}>
                            {unitType}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-1 text-xs text-slate-700 md:col-span-2">
                        <input
                          type="checkbox"
                          checked={branch.hasSubledger}
                          onChange={(event) =>
                            setBranchField(
                              entity.id,
                              branch.id,
                              "hasSubledger",
                              event.target.checked
                            )
                          }
                        />
                        {l("Subledger", "Alt defter")}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeBranch(entity.id, branch.id)}
                        disabled={entity.branches.length <= 1}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 md:col-span-2"
                      >
                        {l("Remove", "Kaldir")}
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goToPreviousStep}
          disabled={activeStepIndex <= 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {l("Back", "Geri")}
        </button>
        {!isLastStep ? (
          <button
            type="button"
            onClick={goToNextStep}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            {l("Next", "Ileri")}
          </button>
        ) : (
          <button
            type="submit"
            disabled={submitting || !canSetupCompany}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting
              ? l("Bootstrapping...", "Kurulum calisiyor...")
              : l("Run Company Bootstrap", "Sirket Kurulumunu Calistir")}
          </button>
        )}
      </div>
    </form>
    {result && (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h2 className="text-sm font-semibold text-emerald-900">
          {l("Bootstrap Result", "Kurulum Sonucu")}
        </h2>
        <div className="mt-2 grid gap-2 text-sm text-emerald-900 md:grid-cols-5">
          <div>
            <span className="font-semibold">{l("Tenant:", "Kiraci:")}</span>{" "}
            {result.tenantId}
          </div>
          <div>
            <span className="font-semibold">{l("Group ID:", "Grup ID:")}</span>{" "}
            {result.groupCompanyId}
          </div>
          <div>
            <span className="font-semibold">{l("Calendar ID:", "Takvim ID:")}</span>{" "}
            {result.calendarId}
          </div>
          <div>
            <span className="font-semibold">{l("Periods:", "Donemler:")}</span>{" "}
            {result.periodsGenerated}
          </div>
          <div>
            <span className="font-semibold">
              {l("Payment terms:", "Odeme kosullari:")}
            </span>{" "}
            +{Number(result?.paymentTerms?.createdCount || 0)} /{" "}
            {l("skipped", "atlandi")}{" "}
            {Number(result?.paymentTerms?.skippedCount || 0)}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-100/70 text-left text-emerald-900">
              <tr>
                <th className="px-3 py-2">{l("Entity Code", "Birim Kodu")}</th>
                <th className="px-3 py-2">
                  {l("Legal Entity ID", "Istirak / Bagli Ortak ID")}
                </th>
                <th className="px-3 py-2">{l("CoA Code", "Hesap Plani Kodu")}</th>
                <th className="px-3 py-2">{l("CoA ID", "Hesap Plani ID")}</th>
                <th className="px-3 py-2">{l("Branch Count", "Sube Sayisi")}</th>
              </tr>
            </thead>
            <tbody>
              {(result.legalEntities || []).map((entity) => (
                <tr
                  key={`${entity.code}-${entity.legalEntityId}`}
                  className="border-t border-emerald-100"
                >
                  <td className="px-3 py-2">{entity.code}</td>
                  <td className="px-3 py-2">{entity.legalEntityId}</td>
                  <td className="px-3 py-2">{entity.coaCode}</td>
                  <td className="px-3 py-2">{entity.coaId}</td>
                  <td className="px-3 py-2">{entity.branchCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
  </div>
);
}
