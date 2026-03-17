import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import {
  listPayrollMappings,
  setPayrollMappingActive,
  upsertPayrollMapping,
} from "../../api/payrollMappings.js";
import { useAuth } from "../../auth/useAuth.js";

const COMPONENT_OPTIONS = [
  {
    code: "BASE_SALARY_EXPENSE",
    side: "DEBIT",
    label: "Base Salary Expense",
    help: "Gross salary base expense.",
    suggestedTrAccount: "770.01 - Personel Ucret Giderleri",
  },
  {
    code: "OVERTIME_EXPENSE",
    side: "DEBIT",
    label: "Overtime Expense",
    help: "Overtime payroll expense.",
    suggestedTrAccount: "770.02 - Fazla Mesai Giderleri",
  },
  {
    code: "BONUS_EXPENSE",
    side: "DEBIT",
    label: "Bonus Expense",
    help: "Bonus and premium expense.",
    suggestedTrAccount: "770.03 - Prim ve Ikramiye Giderleri",
  },
  {
    code: "ALLOWANCES_EXPENSE",
    side: "DEBIT",
    label: "Allowances Expense",
    help: "Allowance and benefit expense portion.",
    suggestedTrAccount: "770.04 - Yardim ve Yan Hak Giderleri",
  },
  {
    code: "EMPLOYER_TAX_EXPENSE",
    side: "DEBIT",
    label: "Employer Tax Expense",
    help: "Employer tax expense accrual.",
    suggestedTrAccount: "770.05 - Isveren Vergi Giderleri",
  },
  {
    code: "EMPLOYER_SOCIAL_SECURITY_EXPENSE",
    side: "DEBIT",
    label: "Employer Social Security Expense",
    help: "Employer SGK/SS expense accrual.",
    suggestedTrAccount: "770.06 - Isveren SGK Giderleri",
  },
  {
    code: "PAYROLL_NET_PAYABLE",
    side: "CREDIT",
    label: "Payroll Net Payable",
    help: "Net salary liability to employees.",
    suggestedTrAccount: "335.01 - Personele Borclar",
  },
  {
    code: "EMPLOYEE_TAX_PAYABLE",
    side: "CREDIT",
    label: "Employee Tax Payable",
    help: "Withheld employee tax liability.",
    suggestedTrAccount: "360.01 - Odenecek Personel Vergi Kesintileri",
  },
  {
    code: "EMPLOYEE_SOCIAL_SECURITY_PAYABLE",
    side: "CREDIT",
    label: "Employee Social Security Payable",
    help: "Withheld employee SGK/SS liability.",
    suggestedTrAccount: "361.01 - Odenecek Personel SGK Kesintileri",
  },
  {
    code: "EMPLOYER_TAX_PAYABLE",
    side: "CREDIT",
    label: "Employer Tax Payable",
    help: "Employer tax liability.",
    suggestedTrAccount: "360.02 - Odenecek Isveren Vergi Yukumlulukleri",
  },
  {
    code: "EMPLOYER_SOCIAL_SECURITY_PAYABLE",
    side: "CREDIT",
    label: "Employer Social Security Payable",
    help: "Employer SGK/SS liability.",
    suggestedTrAccount: "361.02 - Odenecek Isveren SGK Yukumlulukleri",
  },
  {
    code: "OTHER_DEDUCTIONS_PAYABLE",
    side: "CREDIT",
    label: "Other Deductions Payable",
    help: "Other payroll deductions to third parties.",
    suggestedTrAccount: "369.01 - Odenecek Diger Kesintiler",
  },
];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
}

function resolveLegalEntityCurrencyCode(legalEntity) {
  return normalizeCurrencyCode(
    legalEntity?.functional_currency_code || legalEntity?.functionalCurrencyCode || ""
  );
}

function parseChildCodeSequence(code, parentCode) {
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
  const value = Number(suffix);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return {
    value,
    width: suffix.length,
  };
}

function buildNextChildAccountCode(rows, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentAccountId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentAccountId) {
    return "";
  }

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const existingCodes = new Set(
    normalizedRows.map((row) => normalizeAccountCode(row?.code)).filter(Boolean)
  );
  const parsedChildren = normalizedRows
    .filter(
      (row) =>
        toPositiveInt(row?.parent_account_id ?? row?.parentAccountId) === parentAccountId
    )
    .map((row) => parseChildCodeSequence(row?.code, parentCode))
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

function deriveSearchCodeCandidate(value) {
  const normalized = normalizeAccountCode(value);
  if (!normalized || /\s/.test(normalized)) {
    return "";
  }
  return normalized;
}

function findBestParentAccount(candidateCode, parentAccounts) {
  if (!candidateCode) {
    return null;
  }
  let bestParent = null;
  for (const row of Array.isArray(parentAccounts) ? parentAccounts : []) {
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
    if (!bestParent || parentCode.length > normalizeAccountCode(bestParent?.code).length) {
      bestParent = row;
    }
  }
  return bestParent;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function InfoHint({ text }) {
  return (
    <span
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-600"
      title={text}
      aria-label={text}
    >
      i
    </span>
  );
}

export default function PayrollComponentMappingsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("payroll.mappings.read");
  const canWrite = hasPermission("payroll.mappings.write");
  const canReadOrg = hasPermission("org.tree.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canUpsertGlAccounts = hasPermission("gl.account.upsert");
  const filterPreviousLegalEntityIdRef = useRef("");
  const formPreviousLegalEntityIdRef = useRef("");

  const [legalEntities, setLegalEntities] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [lookupWarning, setLookupWarning] = useState("");
  const [accountLookupWarning, setAccountLookupWarning] = useState("");
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null);
  const [inlineChildSaving, setInlineChildSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [templateSource, setTemplateSource] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [glAccountLookupQuery, setGlAccountLookupQuery] = useState("");
  const [inlineChildParentAccountId, setInlineChildParentAccountId] = useState("");
  const [inlineChildCode, setInlineChildCode] = useState("");
  const [inlineChildName, setInlineChildName] = useState("");
  const [showOnlyMissingComponents, setShowOnlyMissingComponents] = useState(false);
  const [componentCoverageRows, setComponentCoverageRows] = useState([]);
  const [loadingComponentCoverage, setLoadingComponentCoverage] = useState(false);
  const [componentCoverageWarning, setComponentCoverageWarning] = useState("");
  const [componentCoverageRefreshKey, setComponentCoverageRefreshKey] = useState(0);
  const [filters, setFilters] = useState({
    legalEntityId: "",
    providerCode: "",
    currencyCode: "",
    componentCode: "",
    asOfDate: "",
    activeOnly: true,
  });
  const [form, setForm] = useState({
    legalEntityId: "",
    providerCode: "",
    currencyCode: "",
    componentCode: COMPONENT_OPTIONS[0].code,
    entrySide: COMPONENT_OPTIONS[0].side,
    glAccountId: "",
    effectiveFrom: "",
    effectiveTo: "",
    closePreviousOpenMapping: true,
    notes: "",
  });

  const legalEntityOptions = useMemo(
    () =>
      [...(legalEntities || [])].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [legalEntities]
  );
  const legalEntityById = useMemo(() => {
    const byId = new Map();
    for (const row of legalEntityOptions) {
      const id = String(row?.id || "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, row);
    }
    return byId;
  }, [legalEntityOptions]);

  const selectedComponentMeta = useMemo(
    () => COMPONENT_OPTIONS.find((item) => item.code === form.componentCode) || COMPONENT_OPTIONS[0],
    [form.componentCode]
  );
  const selectedFilterLegalEntityCurrencyCode = useMemo(
    () => resolveLegalEntityCurrencyCode(legalEntityById.get(String(filters.legalEntityId || "").trim())),
    [filters.legalEntityId, legalEntityById]
  );
  const selectedFormLegalEntityCurrencyCode = useMemo(
    () => resolveLegalEntityCurrencyCode(legalEntityById.get(String(form.legalEntityId || "").trim())),
    [form.legalEntityId, legalEntityById]
  );
  const normalizedFormProviderCode = useMemo(
    () => normalizeAccountCode(form.providerCode),
    [form.providerCode]
  );
  const normalizedFormCurrencyCode = useMemo(
    () => normalizeCurrencyCode(form.currencyCode),
    [form.currencyCode]
  );
  const componentCoverageAsOfDate = useMemo(
    () => form.effectiveFrom || todayIsoDate(),
    [form.effectiveFrom]
  );
  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const selectedEntityAccounts = useMemo(() => {
    if (!selectedLegalEntityId) return [];
    return (accounts || []).filter(
      (row) => toPositiveInt(row?.legal_entity_id ?? row?.legalEntityId) === selectedLegalEntityId
    );
  }, [accounts, selectedLegalEntityId]);
  const selectedEntityAccountByCode = useMemo(() => {
    const map = new Map();
    for (const row of selectedEntityAccounts) {
      const code = normalizeAccountCode(row?.code);
      if (!code || map.has(code)) continue;
      map.set(code, row);
    }
    return map;
  }, [selectedEntityAccounts]);
  const accountLookupOptions = useMemo(
    () =>
      selectedEntityAccounts
        .filter((row) => Boolean(row?.allow_posting ?? row?.allowPosting ?? true))
        .map((row) => ({
          id: row.id,
          label: `${row.code || row.id} - ${row.name || ""}`.trim(),
          description: `${row.account_type || row.accountType || ""} ${row.is_active === 0 ? "INACTIVE" : ""}`.trim(),
        })),
    [selectedEntityAccounts]
  );
  const parentAccountLookupOptions = useMemo(
    () =>
      selectedEntityAccounts.map((row) => ({
        id: row.id,
        label: `${row.code || row.id} - ${row.name || ""}`.trim(),
        description: `${row.account_type || row.accountType || ""} ${
          row.allow_posting ?? row.allowPosting ? "POSTABLE" : "HEADER"
        }`.trim(),
      })),
    [selectedEntityAccounts]
  );
  const selectedGlAccount =
    selectedEntityAccounts.find((row) => toPositiveInt(row?.id) === toPositiveInt(form.glAccountId)) || null;
  const glAccountSearchCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(glAccountLookupQuery),
    [glAccountLookupQuery]
  );
  const exactMatchedAccount = selectedEntityAccountByCode.get(glAccountSearchCodeCandidate) || null;
  const showInlineChildCreate =
    canReadGlAccounts &&
    Boolean(selectedLegalEntityId) &&
    Boolean(String(glAccountLookupQuery || "").trim()) &&
    !exactMatchedAccount;
  const selectedInlineParentAccount =
    selectedEntityAccounts.find((row) => toPositiveInt(row?.id) === toPositiveInt(inlineChildParentAccountId)) || null;
  const suggestedNextChildCode = useMemo(
    () => buildNextChildAccountCode(selectedEntityAccounts, selectedInlineParentAccount),
    [selectedEntityAccounts, selectedInlineParentAccount]
  );
  const applicableCoverageRows = useMemo(
    () =>
      (componentCoverageRows || []).filter((row) => {
        const rowProviderCode = normalizeAccountCode(row?.provider_code || row?.providerCode);
        if (!normalizedFormProviderCode) {
          return !rowProviderCode;
        }
        return !rowProviderCode || rowProviderCode === normalizedFormProviderCode;
      }),
    [componentCoverageRows, normalizedFormProviderCode]
  );
  const mappedComponentCodeSet = useMemo(() => {
    const codes = new Set();
    for (const row of applicableCoverageRows) {
      const code = normalizeAccountCode(row?.component_code || row?.componentCode);
      if (!code) continue;
      codes.add(code);
    }
    return codes;
  }, [applicableCoverageRows]);
  const missingComponentOptions = useMemo(
    () =>
      COMPONENT_OPTIONS.filter((item) => !mappedComponentCodeSet.has(item.code)).map((item) => item.code),
    [mappedComponentCodeSet]
  );
  const missingComponentEntries = useMemo(
    () => COMPONENT_OPTIONS.filter((item) => !mappedComponentCodeSet.has(item.code)),
    [mappedComponentCodeSet]
  );
  const selectedComponentCode = useMemo(
    () => normalizeAccountCode(form.componentCode),
    [form.componentCode]
  );
  const selectedComponentIsMapped = useMemo(
    () => Boolean(selectedComponentCode) && mappedComponentCodeSet.has(selectedComponentCode),
    [mappedComponentCodeSet, selectedComponentCode]
  );
  const preserveSelectedMappedComponent = useMemo(
    () =>
      showOnlyMissingComponents &&
      selectedComponentIsMapped &&
      Boolean(templateSource?.id) &&
      missingComponentEntries.length > 0,
    [missingComponentEntries.length, selectedComponentIsMapped, showOnlyMissingComponents, templateSource]
  );
  const componentOptionsForForm = useMemo(() => {
    if (!showOnlyMissingComponents) {
      return COMPONENT_OPTIONS;
    }
    if (missingComponentEntries.length === 0) {
      return COMPONENT_OPTIONS.filter((item) => item.code === selectedComponentCode);
    }
    if (preserveSelectedMappedComponent) {
      return COMPONENT_OPTIONS.filter(
        (item) => !mappedComponentCodeSet.has(item.code) || item.code === selectedComponentCode
      );
    }
    return missingComponentEntries;
  }, [
    mappedComponentCodeSet,
    missingComponentEntries,
    preserveSelectedMappedComponent,
    selectedComponentCode,
    showOnlyMissingComponents,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!canReadOrg) {
      setLegalEntities([]);
      setLookupWarning((canRead || canWrite) ? "org.tree.read yok: legalEntityId manuel girin." : "");
      return undefined;
    }

    (async () => {
      setLoadingLookups(true);
      try {
        const res = await listLegalEntities({ limit: 500, offset: 0 });
        if (!cancelled) {
          setLegalEntities(res?.rows || []);
          setLookupWarning("");
        }
      } catch (err) {
        if (!cancelled) {
          setLegalEntities([]);
          setLookupWarning(err?.response?.data?.message || "Legal entity listesi yuklenemedi");
        }
      } finally {
        if (!cancelled) {
          setLoadingLookups(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRead, canReadOrg, canWrite]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedLegalEntityId || !canReadGlAccounts) {
      setAccounts([]);
      setAccountLookupWarning(
        selectedLegalEntityId || !canWrite ? "Missing permission: gl.account.read" : ""
      );
      return undefined;
    }

    (async () => {
      setLoadingAccounts(true);
      try {
        const res = await listAccounts({
          legalEntityId: selectedLegalEntityId,
          includeInactive: true,
          limit: 1000,
        });
        if (!cancelled) {
          setAccounts(res?.rows || []);
          setAccountLookupWarning("");
        }
      } catch (err) {
        if (!cancelled) {
          setAccounts([]);
          setAccountLookupWarning(err?.response?.data?.message || "GL account listesi yuklenemedi");
        }
      } finally {
        if (!cancelled) {
          setLoadingAccounts(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadGlAccounts, canWrite, selectedLegalEntityId]);

  useEffect(() => {
    if (!legalEntityOptions.length) {
      return;
    }
    setFilters((prev) =>
      prev.legalEntityId ? prev : { ...prev, legalEntityId: String(legalEntityOptions[0].id) }
    );
    setForm((prev) =>
      prev.legalEntityId ? prev : { ...prev, legalEntityId: String(legalEntityOptions[0].id) }
    );
  }, [legalEntityOptions]);

  useEffect(() => {
    const selectedLegalEntityId = String(filters.legalEntityId || "").trim();
    if (!selectedLegalEntityId) {
      filterPreviousLegalEntityIdRef.current = "";
      return;
    }
    if (!selectedFilterLegalEntityCurrencyCode) {
      filterPreviousLegalEntityIdRef.current = selectedLegalEntityId;
      return;
    }
    const previousLegalEntityId = filterPreviousLegalEntityIdRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    const currentCurrency = normalizeCurrencyCode(filters.currencyCode);
    const shouldSyncCurrency = !currentCurrency || legalEntityChanged;
    filterPreviousLegalEntityIdRef.current = selectedLegalEntityId;
    if (!shouldSyncCurrency || currentCurrency === selectedFilterLegalEntityCurrencyCode) {
      return;
    }
    setFilters((prev) => {
      if (String(prev.legalEntityId || "").trim() !== selectedLegalEntityId) {
        return prev;
      }
      const prevCurrency = normalizeCurrencyCode(prev.currencyCode);
      if (!legalEntityChanged && prevCurrency) {
        return prev;
      }
      return {
        ...prev,
        currencyCode: selectedFilterLegalEntityCurrencyCode,
      };
    });
  }, [filters.currencyCode, filters.legalEntityId, selectedFilterLegalEntityCurrencyCode]);

  useEffect(() => {
    const selectedLegalEntityId = String(form.legalEntityId || "").trim();
    if (!selectedLegalEntityId) {
      formPreviousLegalEntityIdRef.current = "";
      return;
    }
    if (!selectedFormLegalEntityCurrencyCode) {
      formPreviousLegalEntityIdRef.current = selectedLegalEntityId;
      return;
    }
    const previousLegalEntityId = formPreviousLegalEntityIdRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    const currentCurrency = normalizeCurrencyCode(form.currencyCode);
    const shouldSyncCurrency = !currentCurrency || legalEntityChanged;
    formPreviousLegalEntityIdRef.current = selectedLegalEntityId;
    if (!shouldSyncCurrency || currentCurrency === selectedFormLegalEntityCurrencyCode) {
      return;
    }
    setForm((prev) => {
      if (String(prev.legalEntityId || "").trim() !== selectedLegalEntityId) {
        return prev;
      }
      const prevCurrency = normalizeCurrencyCode(prev.currencyCode);
      if (!legalEntityChanged && prevCurrency) {
        return prev;
      }
      return {
        ...prev,
        currencyCode: selectedFormLegalEntityCurrencyCode,
      };
    });
  }, [form.currencyCode, form.legalEntityId, selectedFormLegalEntityCurrencyCode]);

  useEffect(() => {
    if (form.effectiveFrom) {
      return;
    }
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    setForm((prev) => ({ ...prev, effectiveFrom: firstDay }));
  }, [form.effectiveFrom]);

  useEffect(() => {
    let cancelled = false;
    if (!showOnlyMissingComponents) {
      setComponentCoverageRows([]);
      setComponentCoverageWarning("");
      return undefined;
    }
    if (!canRead) {
      setComponentCoverageRows([]);
      setComponentCoverageWarning("Missing permission: payroll.mappings.read");
      return undefined;
    }
    if (!selectedLegalEntityId || !normalizedFormCurrencyCode || !componentCoverageAsOfDate) {
      setComponentCoverageRows([]);
      setComponentCoverageWarning("");
      return undefined;
    }

    (async () => {
      setLoadingComponentCoverage(true);
      try {
        const res = await listPayrollMappings({
          limit: 500,
          offset: 0,
          legalEntityId: selectedLegalEntityId,
          providerCode: normalizedFormProviderCode || undefined,
          currencyCode: normalizedFormCurrencyCode,
          asOfDate: componentCoverageAsOfDate,
          activeOnly: true,
        });
        if (!cancelled) {
          setComponentCoverageRows(res?.rows || []);
          setComponentCoverageWarning("");
        }
      } catch (err) {
        if (!cancelled) {
          setComponentCoverageRows([]);
          setComponentCoverageWarning(
            err?.response?.data?.message || "Component coverage kontrolu yuklenemedi"
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingComponentCoverage(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canRead,
    componentCoverageAsOfDate,
    componentCoverageRefreshKey,
    normalizedFormCurrencyCode,
    normalizedFormProviderCode,
    selectedLegalEntityId,
    showOnlyMissingComponents,
  ]);

  useEffect(() => {
    if (!showOnlyMissingComponents || loadingComponentCoverage || componentCoverageWarning) {
      return;
    }
    if (templateSource?.id || missingComponentEntries.length === 0 || !selectedComponentIsMapped) {
      return;
    }
    const nextComponent = missingComponentEntries[0] || null;
    if (!nextComponent?.code || nextComponent.code === selectedComponentCode) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      componentCode: nextComponent.code,
      entrySide: nextComponent.side || prev.entrySide,
    }));
  }, [
    componentCoverageWarning,
    loadingComponentCoverage,
    missingComponentEntries,
    selectedComponentCode,
    selectedComponentIsMapped,
    showOnlyMissingComponents,
    templateSource,
  ]);

  useEffect(() => {
    setGlAccountLookupQuery("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
  }, [form.legalEntityId]);

  useEffect(() => {
    if (!showInlineChildCreate) {
      return;
    }
    setInlineChildCode((prev) => prev || glAccountSearchCodeCandidate);
    setInlineChildName((prev) => prev || String(glAccountLookupQuery || "").trim());
  }, [showInlineChildCreate, glAccountSearchCodeCandidate, glAccountLookupQuery]);

  useEffect(() => {
    if (!showInlineChildCreate || !suggestedNextChildCode) {
      return;
    }
    setInlineChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(glAccountSearchCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return suggestedNextChildCode;
      }
      return prev;
    });
  }, [showInlineChildCreate, suggestedNextChildCode, glAccountSearchCodeCandidate]);

  useEffect(() => {
    if (!showInlineChildCreate || toPositiveInt(inlineChildParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(inlineChildCode || glAccountSearchCodeCandidate);
    if (!candidateCode) {
      return;
    }
    const bestParent = findBestParentAccount(candidateCode, selectedEntityAccounts);
    if (toPositiveInt(bestParent?.id)) {
      setInlineChildParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineChildCreate,
    inlineChildParentAccountId,
    inlineChildCode,
    glAccountSearchCodeCandidate,
    selectedEntityAccounts,
  ]);

  async function handleCreateChildAccount() {
    if (!canUpsertGlAccounts) {
      setError("Missing permission: gl.account.upsert");
      return;
    }
    if (!selectedLegalEntityId) {
      setError("Legal entity gerekli");
      return;
    }

    const parentAccountId = toPositiveInt(inlineChildParentAccountId);
    const parentAccount =
      selectedEntityAccounts.find((row) => toPositiveInt(row?.id) === parentAccountId) || null;
    if (!parentAccountId || !parentAccount) {
      setError("Once child account icin parent account sec");
      return;
    }

    const childCode = normalizeAccountCode(inlineChildCode || glAccountSearchCodeCandidate);
    const childName = String(inlineChildName || "").trim();
    if (!childCode) {
      setError("Child account code gerekli");
      return;
    }
    if (!childName) {
      setError("Child account name gerekli");
      return;
    }

    const existing = selectedEntityAccountByCode.get(childCode) || null;
    if (existing?.id) {
      setForm((prev) => ({ ...prev, glAccountId: String(existing.id) }));
      setMessage(`Mevcut hesap secildi: ${childCode}`);
      return;
    }

    const coaId = toPositiveInt(parentAccount?.coa_id ?? parentAccount?.coaId);
    if (!coaId) {
      setError("Parent account icin coaId bulunamadi");
      return;
    }

    setInlineChildSaving(true);
    setError("");
    setMessage("");
    try {
      const accountType =
        normalizeAccountCode(parentAccount?.account_type ?? parentAccount?.accountType) || "ASSET";
      const normalSide =
        normalizeAccountCode(parentAccount?.normal_side ?? parentAccount?.normalSide) || "DEBIT";
      const upsertResponse = await upsertAccount({
        coaId,
        code: childCode,
        name: childName,
        accountType,
        normalSide,
        allowPosting: true,
        parentAccountId,
      });
      const responseId = toPositiveInt(upsertResponse?.id ?? upsertResponse?.row?.id);

      const refreshResponse = await listAccounts({
        legalEntityId: selectedLegalEntityId,
        includeInactive: true,
        limit: 1000,
      });
      const refreshedRows = refreshResponse?.rows || [];
      setAccounts(refreshedRows);
      const resolvedRow =
        refreshedRows.find((row) => normalizeAccountCode(row?.code) === childCode) || null;
      const resolvedId = responseId || toPositiveInt(resolvedRow?.id);
      if (resolvedId) {
        setForm((prev) => ({ ...prev, glAccountId: String(resolvedId) }));
      }
      setGlAccountLookupQuery("");
      setInlineChildParentAccountId("");
      setInlineChildCode("");
      setInlineChildName("");
      setMessage(`Child account olusturuldu ve secildi: ${childCode}`);
    } catch (err) {
      setError(err?.response?.data?.message || "Child account olusturulamadi");
    } finally {
      setInlineChildSaving(false);
    }
  }

  function loadRowIntoForm(row, { replaceFromToday = false } = {}) {
    const nextEffectiveFrom = replaceFromToday ? todayIsoDate() : formatDate(row?.effective_from);
    formPreviousLegalEntityIdRef.current = String(
      row?.legal_entity_id || row?.legalEntityId || ""
    ).trim();
    setForm((prev) => ({
      ...prev,
      legalEntityId: String(row?.legal_entity_id || row?.legalEntityId || ""),
      providerCode: String(row?.provider_code || row?.providerCode || ""),
      currencyCode: String(row?.currency_code || row?.currencyCode || "").toUpperCase(),
      componentCode: String(row?.component_code || row?.componentCode || prev.componentCode),
      entrySide: String(row?.entry_side || row?.entrySide || prev.entrySide).toUpperCase(),
      glAccountId: String(row?.gl_account_id || row?.glAccountId || ""),
      effectiveFrom: nextEffectiveFrom || prev.effectiveFrom,
      effectiveTo: replaceFromToday ? "" : String(row?.effective_to || row?.effectiveTo || ""),
      closePreviousOpenMapping: true,
      notes: String(row?.notes || ""),
    }));
    setTemplateSource({
      id: row?.id,
      mode: replaceFromToday ? "replace" : "template",
      componentCode: row?.component_code || row?.componentCode || "",
      providerCode: row?.provider_code || row?.providerCode || "",
    });
    setError("");
    setMessage(
      replaceFromToday
        ? `Mapping #${row?.id} replacement icin forma tasindi. Effective From tarihini kontrol edip kaydet.`
        : `Mapping #${row?.id} formu doldurmak icin kopyalandi. Cakisma olmamasi icin tarihleri kontrol et.`
    );
  }

  async function handleToggleMappingActive(row) {
    const mappingId = toPositiveInt(row?.id);
    if (!mappingId) {
      return;
    }
    const nextIsActive = !row?.is_active;
    setStatusBusyId(mappingId);
    setError("");
    setMessage("");
    try {
      await setPayrollMappingActive(mappingId, {
        isActive: nextIsActive,
        note: nextIsActive
          ? "Reactivated from payroll mappings list"
          : "Deactivated from payroll mappings list",
      });
      setMessage(
        nextIsActive
          ? `Mapping #${mappingId} yeniden aktif yapildi`
          : `Mapping #${mappingId} pasife alindi`
      );
      await loadMappings();
    } catch (err) {
      setError(err?.response?.data?.message || "Mapping status guncellenemedi");
    } finally {
      setStatusBusyId(null);
    }
  }

  async function loadMappings() {
    if (!canRead) {
      setRows([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await listPayrollMappings({
        limit: 300,
        offset: 0,
        legalEntityId: filters.legalEntityId || undefined,
        providerCode: filters.providerCode || undefined,
        currencyCode: filters.currencyCode || undefined,
        componentCode: filters.componentCode || undefined,
        asOfDate: filters.asOfDate || undefined,
        activeOnly: filters.activeOnly,
      });
      setRows(res?.rows || []);
      setTotal(Number(res?.total || 0));
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err?.response?.data?.message || "Payroll mapping listesi yuklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canWrite) {
      setError("Missing permission: payroll.mappings.write");
      return;
    }

    const legalEntityId = toPositiveInt(form.legalEntityId);
    const glAccountId = toPositiveInt(form.glAccountId);
    if (!legalEntityId) {
      setError("legalEntityId gerekli");
      return;
    }
    if (!glAccountId) {
      setError("glAccountId gerekli");
      return;
    }
    if (!form.effectiveFrom) {
      setError("effectiveFrom gerekli");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await upsertPayrollMapping({
        legalEntityId,
        providerCode: String(form.providerCode || "").trim().toUpperCase() || null,
        currencyCode: String(form.currencyCode || "").trim().toUpperCase(),
        componentCode: form.componentCode,
        entrySide: form.entrySide,
        glAccountId,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        closePreviousOpenMapping: Boolean(form.closePreviousOpenMapping),
        notes: String(form.notes || "").trim() || null,
      });
      setMessage("Payroll mapping kaydedildi");
      setTemplateSource(null);
      filterPreviousLegalEntityIdRef.current = String(legalEntityId);
      setFilters((prev) => ({
        ...prev,
        legalEntityId: String(legalEntityId),
        providerCode: String(form.providerCode || "").trim().toUpperCase(),
        currencyCode: String(form.currencyCode || "").trim().toUpperCase(),
      }));
      setComponentCoverageRefreshKey((prev) => prev + 1);
      await loadMappings();
    } catch (err) {
      setError(err?.response?.data?.message || "Payroll mapping kaydi basarisiz");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bordro Mappingleri</h1>
          <p className="mt-1 text-sm text-slate-600">
            PR-P02: Payroll component to GL hesap eslemeleri (effective-dated). Tahakkuk preview ve
            finalize bu kayitlari kullanir.
          </p>
        </div>
        <Link
          to="/app/payroll-runs"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          Bordro Runlari
        </Link>
      </div>

      {!canRead ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Missing permission: <code>payroll.mappings.read</code>
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Mapping Listesi</h2>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              onClick={loadMappings}
              disabled={loading || !canRead}
            >
              Yenile
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Legal Entity</label>
              {canReadOrg ? (
                <select
                  value={filters.legalEntityId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={loadingLookups}
                >
                  <option value="">Tum yetkili</option>
                  {legalEntityOptions.map((le) => (
                    <option key={le.id} value={le.id}>
                      {le.code} - {le.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={filters.legalEntityId}
                  onChange={(e) => setFilters((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="legalEntityId"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Provider</label>
              <input
                value={filters.providerCode}
                onChange={(e) => setFilters((prev) => ({ ...prev, providerCode: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Currency</label>
              <input
                value={filters.currencyCode}
                onChange={(e) => setFilters((prev) => ({ ...prev, currencyCode: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="TRY"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Component</label>
              <select
                value={filters.componentCode}
                onChange={(e) => setFilters((prev) => ({ ...prev, componentCode: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Tum componentler</option>
                {COMPONENT_OPTIONS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">As Of Date</label>
              <input
                type="date"
                value={filters.asOfDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, asOfDate: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(filters.activeOnly)}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, activeOnly: Boolean(e.target.checked) }))
                  }
                />
                Sadece aktif
              </label>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm"
                onClick={loadMappings}
                disabled={loading || !canRead}
              >
                Listele
              </button>
            </div>
          </div>

          {lookupWarning ? (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              {lookupWarning}
            </div>
          ) : null}
          {accountLookupWarning ? (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              {accountLookupWarning}
            </div>
          ) : null}

            <div className="mt-3 text-xs text-slate-500">Toplam kayit: {total}</div>

          <div className="mt-4 overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left">Actions</th>
                  <th className="p-2 text-left">Component</th>
                  <th className="p-2 text-left">Side</th>
                  <th className="p-2 text-left">GL</th>
                  <th className="p-2 text-left">Entity</th>
                  <th className="p-2 text-left">Provider</th>
                  <th className="p-2 text-left">Effective</th>
                  <th className="p-2 text-left">Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="p-2">
                      <div className="flex min-w-[180px] flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => loadRowIntoForm(row)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                        >
                          Use as template
                        </button>
                        <button
                          type="button"
                          onClick={() => loadRowIntoForm(row, { replaceFromToday: true })}
                          className="rounded border border-cyan-300 px-2 py-1 text-xs font-medium text-cyan-800"
                        >
                          Replace from today
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMappingActive(row)}
                          disabled={statusBusyId === toPositiveInt(row.id) || !canWrite}
                          className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 disabled:opacity-60"
                        >
                          {statusBusyId === toPositiveInt(row.id)
                            ? "Updating..."
                            : row.is_active
                              ? "Deactivate"
                              : "Reactivate"}
                        </button>
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{row.component_code}</div>
                      {row.notes ? (
                        <div className="mt-1 text-xs text-slate-500">{row.notes}</div>
                      ) : null}
                    </td>
                    <td className="p-2">{row.entry_side}</td>
                    <td className="p-2">
                      <div>{row.gl_account_code || row.gl_account_id}</div>
                      <div className="text-xs text-slate-500">{row.gl_account_name || "-"}</div>
                    </td>
                    <td className="p-2">
                      <div>{row.entity_code}</div>
                      <div className="text-xs text-slate-500">{row.legal_entity_name || ""}</div>
                    </td>
                    <td className="p-2">{row.provider_code || "*"}</td>
                    <td className="p-2">
                      <div>
                        {formatDate(row.effective_from)} {"->"}{" "}
                        {row.effective_to ? formatDate(row.effective_to) : "open"}
                      </div>
                      <div className="text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                    </td>
                    <td className="p-2">{row.is_active ? "ACTIVE" : "INACTIVE"}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-3 text-slate-500" colSpan={8}>
                      Kayit yok.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Yeni Mapping</h2>
          <p className="mt-1 text-xs text-slate-600">
            Bir payroll componentini belirli tarih araliginda bir GL hesaba baglar. Provider bos ise
            fallback mapping olarak kullanilir.
          </p>

          {!canWrite ? (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Missing permission: payroll.mappings.write
            </div>
          ) : null}
          {templateSource ? (
            <div className="mt-3 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
              Source mapping #{templateSource.id} loaded in{" "}
              <b>{templateSource.mode === "replace" ? "replace" : "template"}</b> mode.
              {templateSource.mode === "replace"
                ? " Save to create a new effective-dated version and close the previous open mapping."
                : " Review effective dates before saving to avoid overlap."}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Legal Entity</label>
              {canReadOrg ? (
                <select
                  value={form.legalEntityId}
                  onChange={(e) => setForm((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  disabled={loadingLookups || saving}
                >
                  <option value="">Secin</option>
                  {legalEntityOptions.map((le) => (
                    <option key={le.id} value={le.id}>
                      {le.code} - {le.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.legalEntityId}
                  onChange={(e) => setForm((prev) => ({ ...prev, legalEntityId: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="legalEntityId"
                />
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Provider (optional)</label>
                <input
                  value={form.providerCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, providerCode: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="OUTSOURCED_PAYROLL_X"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Currency</label>
                <input
                  value={form.currencyCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, currencyCode: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="TRY"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-700">Component</label>
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={showOnlyMissingComponents}
                    onChange={(e) => setShowOnlyMissingComponents(e.target.checked)}
                    disabled={!canRead}
                  />
                  <span>Only missing for this context</span>
                  <InfoHint text="Secili legal entity, provider, currency ve Effective From baglaminda zaten uygulanabilir mappingi olan componentleri listeden gizler. Bu yardimci ilk kurulum hizini artirir. Replacement, future-dated degisiklik veya provider-specific override acacaksan kapatip tum component listesini tekrar gorebilirsin." />
                </label>
              </div>
              <select
                value={form.componentCode}
                onChange={(e) => {
                  const nextCode = e.target.value;
                  const meta = COMPONENT_OPTIONS.find((item) => item.code === nextCode);
                  setForm((prev) => ({
                    ...prev,
                    componentCode: nextCode,
                    entrySide: meta?.side || prev.entrySide,
                  }));
                }}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                {componentOptionsForForm.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
              {showOnlyMissingComponents ? (
                <div className="mt-1 space-y-1">
                  {loadingComponentCoverage ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      Current context mapping coverage is loading...
                    </div>
                  ) : null}
                  {!loadingComponentCoverage && componentCoverageWarning ? (
                    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      {componentCoverageWarning}
                    </div>
                  ) : null}
                  {!loadingComponentCoverage && !componentCoverageWarning ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      Missing components for current context:{" "}
                      <b>{missingComponentOptions.length}</b> / {COMPONENT_OPTIONS.length}.
                    </div>
                  ) : null}
                  {!loadingComponentCoverage &&
                  !componentCoverageWarning &&
                  preserveSelectedMappedComponent ? (
                    <div className="rounded border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs text-cyan-800">
                      Selected component is already mapped, but it is kept visible because template /
                      replace mode is active.
                    </div>
                  ) : null}
                  {!loadingComponentCoverage &&
                  !componentCoverageWarning &&
                  missingComponentOptions.length === 0 ? (
                    <div className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
                      All components already have an applicable mapping for this context. Turn this
                      option off if you want to create a replacement version or a provider-specific
                      override.
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                Expected side: <b>{selectedComponentMeta.side}</b>. {selectedComponentMeta.help}
              </div>
              <div className="mt-1 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
                Onerilen TR hesap plani kodu: <b>{selectedComponentMeta.suggestedTrAccount}</b>.
                Sirket hesap planina gore degisebilir; secmeden once kendi COA yapinla kontrol et.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Entry Side</label>
                <select
                  value={form.entrySide}
                  onChange={(e) => setForm((prev) => ({ ...prev, entrySide: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="DEBIT">DEBIT</option>
                  <option value="CREDIT">CREDIT</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="mb-1 block text-xs font-medium text-slate-700">GL Account</label>
                {canReadGlAccounts ? (
                  <>
                    <Combobox
                      value={form.glAccountId || null}
                      options={accountLookupOptions}
                      disabled={saving || loadingAccounts || !selectedLegalEntityId}
                      placeholder={
                        selectedLegalEntityId ? "Search account code/name" : "Select legal entity first"
                      }
                      noOptionsText="No GL accounts found."
                      onInputChange={(nextValue, meta) => {
                        if (meta?.reason === "input" || meta?.reason === "clear") {
                          setGlAccountLookupQuery(nextValue);
                          setInlineChildName(String(nextValue || "").trim());
                        }
                      }}
                      onChange={(nextValue) => {
                        setForm((prev) => ({
                          ...prev,
                          glAccountId: nextValue ? String(nextValue) : "",
                        }));
                        setGlAccountLookupQuery("");
                      }}
                    />
                    <p className="text-[11px] text-slate-500">
                      Search by account code or name. If the exact code does not exist, create a child
                      account below.
                    </p>
                    {selectedGlAccount ? (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        Selected: <b>{selectedGlAccount.code || selectedGlAccount.id}</b> -{" "}
                        {selectedGlAccount.name || "-"}
                      </div>
                    ) : null}
                    {showInlineChildCreate ? (
                      <div className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2">
                        <p className="text-xs text-cyan-800">
                          No exact account found for `"{glAccountSearchCodeCandidate || glAccountLookupQuery}"`.
                          Create a child account below.
                        </p>
                        <Combobox
                          value={inlineChildParentAccountId || null}
                          options={parentAccountLookupOptions}
                          disabled={saving || inlineChildSaving || !selectedLegalEntityId}
                          placeholder="Select parent account"
                          noOptionsText="No parent accounts found."
                          onChange={(nextValue) =>
                            setInlineChildParentAccountId(nextValue ? String(nextValue) : "")
                          }
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            value={inlineChildCode}
                            onChange={(e) => setInlineChildCode(normalizeAccountCode(e.target.value))}
                            className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-xs"
                            placeholder="Child account code"
                            maxLength={60}
                          />
                          <input
                            value={inlineChildName}
                            onChange={(e) => setInlineChildName(e.target.value)}
                            className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-xs"
                            placeholder="New child account name"
                            maxLength={255}
                          />
                        </div>
                        {selectedInlineParentAccount ? (
                          <div className="rounded border border-cyan-200 bg-white/70 px-2 py-1 text-[11px] text-cyan-900">
                            Suggested next child code under <b>{selectedInlineParentAccount.code}</b>:{" "}
                            <b>{suggestedNextChildCode || "-"}</b>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setInlineChildCode(glAccountSearchCodeCandidate)}
                            disabled={!glAccountSearchCodeCandidate}
                            className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 disabled:opacity-60"
                          >
                            Use searched code
                          </button>
                          <button
                            type="button"
                            onClick={() => setInlineChildCode(suggestedNextChildCode)}
                            disabled={!suggestedNextChildCode || !selectedInlineParentAccount}
                            className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 disabled:opacity-60"
                          >
                            Use next child code
                          </button>
                          <button
                            type="button"
                            onClick={handleCreateChildAccount}
                            disabled={saving || inlineChildSaving || !canUpsertGlAccounts}
                            className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                          >
                            {inlineChildSaving ? "Creating child..." : "Create child account"}
                          </button>
                        </div>
                        {!canUpsertGlAccounts ? (
                          <p className="text-[11px] text-amber-700">
                            Missing permission: gl.account.upsert
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <input
                    value={form.glAccountId}
                    onChange={(e) => setForm((prev) => ({ ...prev, glAccountId: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="glAccountId"
                  />
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span>Effective From</span>
                  <InfoHint text="Bu mappingin hangi tarihten itibaren gecerli olacagini belirler. Genelde ilk kullanim ayinin ilk gunu verilir. Her ay yeniden mapping acman gerekmez; hesap plani degismedikce ayni mapping acik kalabilir." />
                </label>
                <input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span>Effective To</span>
                  <InfoHint text="Bu mappingin hangi tarihe kadar gecerli oldugunu belirler. Bos birakirsan mapping acik uclu devam eder. Yalniz yeni bir hesap veya yeni politika devreye girecekse eski mappingi burada kapatip yeni mappingi yeni baslangic tarihiyle acarsin." />
                </label>
                <input
                  type="date"
                  value={form.effectiveTo}
                  onChange={(e) => setForm((prev) => ({ ...prev, effectiveTo: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional rationale"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.closePreviousOpenMapping)}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    closePreviousOpenMapping: Boolean(e.target.checked),
                  }))
                }
              />
              Ayni key icin onceki acik mappingi kapat
            </label>

            <button
              type="submit"
              disabled={!canWrite || saving}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Kaydediliyor..." : "Mapping Kaydet"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
