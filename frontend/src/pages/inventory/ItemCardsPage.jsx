import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  createItemCard,
  listItemCards,
  updateItemCard,
} from "../../api/itemCards.js";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { listTaxRules } from "../../api/taxAdmin.js";

const ITEM_TYPES = ["SERVICE", "NON_STOCK_GOOD", "STOCK_ITEM"];
const STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const INLINE_ACCOUNT_FIELD_CONFIG = Object.freeze({
  defaultSalesAccountId: {
    optionKey: "sales-account",
    labelEn: "Sales Revenue Account (optional)",
    labelTr: "Satis Gelir Hesabi (opsiyonel)",
    expectedAccountType: "REVENUE",
    childNameSuffixEn: "Sales",
    childNameSuffixTr: "Satis",
  },
  defaultPurchaseAccountId: {
    optionKey: "purchase-account",
    labelEn: "Purchase Expense Account (fallback)",
    labelTr: "Alim Gider Hesabi (yedek)",
    expectedAccountType: "EXPENSE",
    childNameSuffixEn: "Purchase",
    childNameSuffixTr: "Alim",
  },
  inventoryAssetAccountId: {
    optionKey: "inventory-account",
    labelEn: "Inventory Asset Account (optional)",
    labelTr: "Stok Varlik Hesabi (opsiyonel)",
    expectedAccountType: "ASSET",
    childNameSuffixEn: "Inventory",
    childNameSuffixTr: "Stok",
  },
  inventoryTransitAccountId: {
    optionKey: "inventory-transit-account",
    labelEn: "Inventory Transit Account (optional)",
    labelTr: "Stok Transit Hesabi (opsiyonel)",
    expectedAccountType: "ASSET",
    childNameSuffixEn: "Inventory Transit",
    childNameSuffixTr: "Stok Transit",
  },
  defaultCogsAccountId: {
    optionKey: "cogs-account",
    labelEn: "COGS Account (optional)",
    labelTr: "Maliyet Hesabi (opsiyonel)",
    expectedAccountType: "EXPENSE",
    childNameSuffixEn: "COGS",
    childNameSuffixTr: "Maliyet",
  },
});
const INLINE_ACCOUNT_FIELD_KEYS = Object.keys(INLINE_ACCOUNT_FIELD_CONFIG);

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isActiveAccount(row) {
  return parseDbBoolean(row?.isActive);
}

function isActivePostableAccount(row) {
  return isActiveAccount(row) && parseDbBoolean(row?.allowPosting);
}

function formatAccountOptionLabel(row) {
  const code = normalizeAccountCode(row?.code);
  const name = normalizeText(row?.name);
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(toPositiveInt(row?.id) || "-");
}

function formatAccountOptionDescription(row) {
  const breadcrumbCodes = normalizeText(
    row?.breadcrumbCodes ?? row?.account_breadcrumb_codes ?? row?.accountBreadcrumbCodes
  );
  if (breadcrumbCodes) {
    return breadcrumbCodes;
  }
  return normalizeAccountCode(row?.accountType ?? row?.account_type);
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
  const numeric = Number(suffix);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return {
    value: numeric,
    width: suffix.length,
  };
}

function buildNextChildAccountCode(rows, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentId) {
    return "";
  }

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const existingCodes = new Set(
    normalizedRows
      .map((row) => normalizeAccountCode(row?.code))
      .filter(Boolean)
  );
  const parsedChildren = normalizedRows
    .filter((row) => toPositiveInt(row?.parentAccountId) === parentId)
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

function createInitialForm() {
  return {
    legalEntityId: "",
    code: "",
    name: "",
    itemType: "SERVICE",
    defaultSalesAccountId: "",
    defaultPurchaseAccountId: "",
    inventoryAssetAccountId: "",
    inventoryTransitAccountId: "",
    defaultCogsAccountId: "",
    taxCategoryCode: "",
    status: "ACTIVE",
  };
}

function mapLegalEntityLookupOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) {
    return null;
  }
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `Legal entity #${value}`,
    description: normalizeText(row?.functional_currency_code || row?.functionalCurrencyCode),
  };
}

function mapAccountRows(responseRows = []) {
  return (Array.isArray(responseRows) ? responseRows : [])
    .map((row) => ({
      id: Number(row?.id || 0),
      coaId: Number(row?.coa_id || row?.coaId || 0) || null,
      code: normalizeAccountCode(row?.code),
      name: normalizeText(row?.name),
      accountType: normalizeAccountCode(row?.account_type || row?.accountType),
      normalSide: normalizeAccountCode(row?.normal_side || row?.normalSide),
      allowPosting: parseDbBoolean(row?.allow_posting ?? row?.allowPosting),
      isActive: parseDbBoolean(row?.is_active ?? row?.isActive),
      parentAccountId: Number(row?.parent_account_id || row?.parentAccountId || 0) || null,
      breadcrumbCodes: normalizeText(
        row?.account_breadcrumb_codes ?? row?.accountBreadcrumbCodes
      ),
    }))
    .filter((row) => row.id > 0 && row.code)
    .sort((left, right) =>
      String(left.code || "").localeCompare(String(right.code || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

async function fetchAccountRowsForLegalEntity(legalEntityId) {
  if (!toPositiveInt(legalEntityId)) {
    return [];
  }
  const response = await listAccounts({
    legalEntityId,
    includeInactive: true,
    limit: 1000,
    offset: 0,
  });
  return mapAccountRows(response?.rows);
}

function mapItemCardRowToForm(row) {
  return {
    legalEntityId: String(row?.legalEntityId || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    itemType: String(row?.itemType || "SERVICE"),
    defaultSalesAccountId: String(row?.defaultSalesAccountId || ""),
    defaultPurchaseAccountId: String(row?.defaultPurchaseAccountId || ""),
    inventoryAssetAccountId: String(row?.inventoryAssetAccountId || ""),
    inventoryTransitAccountId: String(row?.inventoryTransitAccountId || ""),
    defaultCogsAccountId: String(row?.defaultCogsAccountId || ""),
    taxCategoryCode: String(row?.taxCategoryCode || ""),
    status: String(row?.status || "ACTIVE"),
  };
}

function buildPayload(form) {
  return {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    code: normalizeText(form.code).toUpperCase(),
    name: normalizeText(form.name),
    itemType: normalizeText(form.itemType).toUpperCase(),
    defaultSalesAccountId: toPositiveInt(form.defaultSalesAccountId) || undefined,
    defaultPurchaseAccountId: toPositiveInt(form.defaultPurchaseAccountId) || undefined,
    inventoryAssetAccountId: toPositiveInt(form.inventoryAssetAccountId) || undefined,
    inventoryTransitAccountId: toPositiveInt(form.inventoryTransitAccountId) || undefined,
    defaultCogsAccountId: toPositiveInt(form.defaultCogsAccountId) || undefined,
    taxCategoryCode: normalizeText(form.taxCategoryCode).toUpperCase() || undefined,
    status: normalizeText(form.status).toUpperCase(),
  };
}

function isStockItemType(value) {
  return normalizeText(value).toUpperCase() === "STOCK_ITEM";
}

function describeTransitSetup(row, translate = (en) => en) {
  if (!isStockItemType(row?.itemType)) {
    return {
      label: translate("Not used", "Kullanilmaz"),
      className: "border border-slate-200 bg-slate-100 text-slate-700",
    };
  }
  if (toPositiveInt(row?.inventoryTransitAccountId)) {
    return {
      label: translate("Configured", "Tanimli"),
      className: "border border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }
  return {
    label: translate("Missing", "Eksik"),
    className: "border border-amber-200 bg-amber-50 text-amber-800",
  };
}

export default function ItemCardsPage({ pageKey = "list" }) {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const {
    legalEntities: workingContextLegalEntities,
    loading: workingContextLoading,
    error: workingContextError,
  } = useWorkingContext();

  const canRead = hasPermission("item.card.read");
  const canUpsert = hasPermission("item.card.upsert");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canUpsertGlAccounts = hasPermission("gl.account.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");

  const [fallbackLegalEntityRows, setFallbackLegalEntityRows] = useState([]);
  const [fallbackLegalEntityLoading, setFallbackLegalEntityLoading] = useState(false);
  const [fallbackLegalEntityError, setFallbackLegalEntityError] = useState("");

  useEffect(() => {
    if (!canReadOrgTree) {
      setFallbackLegalEntityRows([]);
      setFallbackLegalEntityLoading(false);
      setFallbackLegalEntityError("");
      return;
    }

    if (
      Array.isArray(workingContextLegalEntities) &&
      workingContextLegalEntities.length > 0
    ) {
      setFallbackLegalEntityRows([]);
      setFallbackLegalEntityLoading(false);
      setFallbackLegalEntityError("");
      return;
    }

    if (workingContextLoading) {
      return;
    }

    let active = true;
    async function loadFallbackLegalEntities() {
      setFallbackLegalEntityLoading(true);
      setFallbackLegalEntityError("");
      try {
        const response = await listLegalEntities({
          limit: 500,
          includeInactive: true,
        });
        if (!active) {
          return;
        }
        setFallbackLegalEntityRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setFallbackLegalEntityRows([]);
        setFallbackLegalEntityError(
          normalizeApiError(
            error,
            l("Failed to load legal entity options.", "Tuzel kisilik secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setFallbackLegalEntityLoading(false);
        }
      }
    }

    loadFallbackLegalEntities();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, l, workingContextLegalEntities, workingContextLoading]);

  const legalEntityRows = useMemo(() => {
    if (
      Array.isArray(workingContextLegalEntities) &&
      workingContextLegalEntities.length > 0
    ) {
      return workingContextLegalEntities;
    }
    return Array.isArray(fallbackLegalEntityRows) ? fallbackLegalEntityRows : [];
  }, [fallbackLegalEntityRows, workingContextLegalEntities]);

  const legalEntityOptions = useMemo(
    () =>
      legalEntityRows.map(mapLegalEntityLookupOption).filter(Boolean),
    [legalEntityRows]
  );
  const legalEntityLookupLoading =
    fallbackLegalEntityLoading ||
    (workingContextLoading && legalEntityOptions.length === 0);
  const legalEntityLookupError =
    fallbackLegalEntityError ||
    (legalEntityOptions.length === 0 ? String(workingContextError || "").trim() : "");

  const [filters, setFilters] = useState({
    legalEntityId: "",
    status: "ACTIVE",
    itemType: "",
    q: "",
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [form, setForm] = useState(() => createInitialForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [accountRows, setAccountRows] = useState([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [inlineChildFieldKey, setInlineChildFieldKey] = useState("");
  const [inlineChildParentAccountId, setInlineChildParentAccountId] = useState("");
  const [inlineChildCode, setInlineChildCode] = useState("");
  const [inlineChildName, setInlineChildName] = useState("");
  const [inlineChildSaving, setInlineChildSaving] = useState(false);
  const [taxRuleRows, setTaxRuleRows] = useState([]);
  const [taxCategoryError, setTaxCategoryError] = useState("");
  const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
  const formTransitSetup = describeTransitSetup(form, l);

  function clearInlineChildState() {
    setInlineChildFieldKey("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setInlineChildSaving(false);
  }

  function buildDefaultInlineChildName(fieldKey) {
    const fieldConfig = INLINE_ACCOUNT_FIELD_CONFIG[fieldKey];
    const baseName = normalizeText(form.name);
    const suffix = fieldConfig
      ? l(fieldConfig.childNameSuffixEn, fieldConfig.childNameSuffixTr)
      : "";
    return [baseName, suffix].filter(Boolean).join(" ");
  }

  useEffect(() => {
    if (pageKey === "create" && !filters.legalEntityId && legalEntityOptions.length === 1) {
      const onlyValue = legalEntityOptions[0]?.value || "";
      setFilters((previous) => ({ ...previous, legalEntityId: onlyValue }));
      setForm((previous) => ({ ...previous, legalEntityId: onlyValue }));
    }
  }, [legalEntityOptions, pageKey, filters.legalEntityId]);

  useEffect(() => {
    setInlineChildFieldKey("");
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName("");
    setInlineChildSaving(false);
  }, [form.legalEntityId]);

  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setLoading(false);
      setListError(l("Missing permission: item.card.read", "Eksik yetki: item.card.read"));
      return;
    }

    let active = true;
    async function loadRows() {
      setLoading(true);
      setListError("");
      try {
        const response = await listItemCards({
          legalEntityId: filters.legalEntityId || undefined,
          status: filters.status || undefined,
          itemType: filters.itemType || undefined,
          q: filters.q || undefined,
          limit: 200,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setRows([]);
        setListError(
          normalizeApiError(
            error,
            l("Failed to load item cards.", "Urun kartlari yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRows();
    return () => {
      active = false;
    };
  }, [canRead, filters, l]);

  useEffect(() => {
    setAccountError("");
    if (!canReadGlAccounts || !selectedLegalEntityId) {
      setAccountRows([]);
      setAccountLoading(false);
      return;
    }

    let active = true;
    async function loadAccounts() {
      setAccountLoading(true);
      try {
        const nextRows = await fetchAccountRowsForLegalEntity(selectedLegalEntityId);
        if (!active) {
          return;
        }
        setAccountRows(nextRows);
      } catch (error) {
        if (!active) {
          return;
        }
        setAccountRows([]);
        setAccountError(
          normalizeApiError(
            error,
            l("Failed to load account options.", "Hesap secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setAccountLoading(false);
        }
      }
    }

    loadAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, l, selectedLegalEntityId]);

  useEffect(() => {
    setTaxCategoryError("");
    if (!canReadOrgTree) {
      setTaxRuleRows([]);
      return;
    }

    let active = true;
    async function loadTaxRules() {
      try {
        const response = await listTaxRules({
          moduleCode: "CARI",
          status: "ACTIVE",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setTaxRuleRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setTaxRuleRows([]);
        setTaxCategoryError(
          normalizeApiError(
            error,
            l("Failed to load tax category options.", "Vergi kategori secenekleri yuklenemedi.")
          )
        );
      }
    }

    loadTaxRules();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, l]);

  const postableAccountRows = useMemo(
    () => accountRows.filter((row) => isActivePostableAccount(row)),
    [accountRows]
  );
  const selectedAccountRowById = useMemo(() => {
    const nextMap = new Map();
    accountRows.forEach((row) => {
      const rowId = toPositiveInt(row?.id);
      if (rowId) {
        nextMap.set(rowId, row);
      }
    });
    return nextMap;
  }, [accountRows]);
  const accountOptions = useMemo(() => {
    const optionIds = new Set(postableAccountRows.map((row) => Number(row.id || 0)));
    const selectedIds = INLINE_ACCOUNT_FIELD_KEYS.map((fieldKey) => form[fieldKey])
      .map((value) => Number(value || 0))
      .filter((id) => Number.isInteger(id) && id > 0);
    const nextRows = [...postableAccountRows];
    selectedIds.forEach((id) => {
      if (optionIds.has(id)) {
        return;
      }
      const selectedRow = selectedAccountRowById.get(id);
      nextRows.unshift(
        selectedRow || {
          id,
          code: `#${id}`,
          name: "Selected account is outside current lookup scope.",
          accountType: "",
          normalSide: "",
          allowPosting: true,
          isActive: true,
          parentAccountId: null,
          breadcrumbCodes: "",
        }
      );
      optionIds.add(id);
    });
    return nextRows;
  }, [form, postableAccountRows, selectedAccountRowById]);
  const inlineFieldConfig = inlineChildFieldKey
    ? INLINE_ACCOUNT_FIELD_CONFIG[inlineChildFieldKey] || null
    : null;
  const inlineParentAccountRows = useMemo(() => {
    if (!inlineFieldConfig) {
      return [];
    }
    return accountRows.filter(
      (row) =>
        isActiveAccount(row) &&
        (!inlineFieldConfig.expectedAccountType ||
          normalizeAccountCode(row?.accountType) ===
            inlineFieldConfig.expectedAccountType)
    );
  }, [accountRows, inlineFieldConfig]);
  const inlineParentAccountLookupOptions = useMemo(
    () =>
      inlineParentAccountRows.map((row) => ({
        value: String(row.id || ""),
        label: formatAccountOptionLabel(row),
        description: formatAccountOptionDescription(row),
      })),
    [inlineParentAccountRows]
  );
  const selectedInlineParentAccount = useMemo(
    () =>
      inlineParentAccountRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(inlineChildParentAccountId)
      ) || null,
    [inlineChildParentAccountId, inlineParentAccountRows]
  );
  const suggestedInlineChildCode = useMemo(
    () => buildNextChildAccountCode(accountRows, selectedInlineParentAccount),
    [accountRows, selectedInlineParentAccount]
  );

  const taxCategoryOptions = useMemo(() => {
    const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
    const values = new Set();
    for (const row of taxRuleRows) {
      const taxCategoryCode = normalizeText(row?.taxCategoryCode).toUpperCase();
      if (!taxCategoryCode) {
        continue;
      }
      const regimeLegalEntityId = toPositiveInt(row?.regimeLegalEntityId);
      if (
        selectedLegalEntityId &&
        regimeLegalEntityId &&
        regimeLegalEntityId !== selectedLegalEntityId
      ) {
        continue;
      }
      values.add(taxCategoryCode);
    }

    const selectedValue = normalizeText(form.taxCategoryCode).toUpperCase();
    if (selectedValue) {
      values.add(selectedValue);
    }

    return Array.from(values)
      .sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .map((value) => ({ value, label: value }));
  }, [form.legalEntityId, form.taxCategoryCode, taxRuleRows]);

  useEffect(() => {
    if (!inlineChildFieldKey) {
      return;
    }
    const fieldConfig = INLINE_ACCOUNT_FIELD_CONFIG[inlineChildFieldKey] || null;
    const baseName = normalizeText(form.name);
    const suffix = fieldConfig
      ? l(fieldConfig.childNameSuffixEn, fieldConfig.childNameSuffixTr)
      : "";
    const nextDefaultName = [baseName, suffix].filter(Boolean).join(" ");
    setInlineChildName((previous) => previous || nextDefaultName);
  }, [form.name, inlineChildFieldKey, l]);

  useEffect(() => {
    if (!inlineChildFieldKey || !suggestedInlineChildCode) {
      return;
    }
    setInlineChildCode((previous) => previous || suggestedInlineChildCode);
  }, [inlineChildFieldKey, suggestedInlineChildCode]);

  function resetForm(nextLegalEntityId = form.legalEntityId) {
    setSelectedRow(null);
    setForm({
      ...createInitialForm(),
      legalEntityId: nextLegalEntityId || "",
    });
    clearInlineChildState();
    setFormError("");
    setFormMessage("");
  }

  function validateForm() {
    const payload = buildPayload(form);
    const errors = [];
    if (!payload.code) {
      errors.push(l("Code is required.", "Kod zorunludur."));
    }
    if (!payload.name) {
      errors.push(l("Name is required.", "Ad zorunludur."));
    }
    if (!ITEM_TYPES.includes(payload.itemType)) {
      errors.push(l("Item type is invalid.", "Urun tipi gecersiz."));
    }
    if (!STATUS_VALUES.includes(payload.status)) {
      errors.push(l("Status is invalid.", "Durum gecersiz."));
    }
    return { payload, errors };
  }

  function toggleInlineChildPanel(fieldKey) {
    const nextFieldKey = inlineChildFieldKey === fieldKey ? "" : fieldKey;
    setInlineChildFieldKey(nextFieldKey);
    setInlineChildParentAccountId("");
    setInlineChildCode("");
    setInlineChildName(nextFieldKey ? buildDefaultInlineChildName(nextFieldKey) : "");
  }

  async function handleCreateInlineChildAccount() {
    if (!inlineFieldConfig || !inlineChildFieldKey) {
      return;
    }
    if (!canUpsertGlAccounts) {
      setFormError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }
    if (!selectedLegalEntityId) {
      setFormError(l("Select legal entity first.", "Once tuzel kisilik secin."));
      return;
    }

    const parentAccountId = toPositiveInt(inlineChildParentAccountId);
    const parentAccount =
      inlineParentAccountRows.find((row) => toPositiveInt(row?.id) === parentAccountId) || null;
    if (!parentAccountId || !parentAccount) {
      setFormError(l("Select a parent account first.", "Once ust hesap secin."));
      return;
    }

    const childCode = normalizeAccountCode(inlineChildCode);
    const childName = normalizeText(inlineChildName);
    if (!childCode) {
      setFormError(l("Child account code is required.", "Alt hesap kodu zorunludur."));
      return;
    }
    if (!childName) {
      setFormError(l("Child account name is required.", "Alt hesap adi zorunludur."));
      return;
    }

    const parentCode = normalizeAccountCode(parentAccount?.code);
    if (parentCode && childCode === parentCode) {
      setFormError(
        l(
          "Child account code must differ from parent account code.",
          "Alt hesap kodu ust hesap koduyla ayni olamaz."
        )
      );
      return;
    }

    const existingAccount =
      accountRows.find((row) => normalizeAccountCode(row?.code) === childCode) || null;
    if (existingAccount) {
      if (
        inlineFieldConfig.expectedAccountType &&
        normalizeAccountCode(existingAccount?.accountType) !==
          inlineFieldConfig.expectedAccountType
      ) {
        setFormError(
          l(
            "The entered child code already belongs to a different account type.",
            "Girilen alt hesap kodu farkli bir hesap tipine ait."
          )
        );
        return;
      }
      if (isActivePostableAccount(existingAccount)) {
        setForm((previous) => ({
          ...previous,
          [inlineChildFieldKey]: String(existingAccount.id),
        }));
        clearInlineChildState();
        setFormError("");
        setFormMessage(
          `${l("Existing account selected", "Mevcut hesap secildi")}: ${formatAccountOptionLabel(existingAccount)}`
        );
        return;
      }
      setFormError(
        l(
          "The entered child code already belongs to an inactive or non-postable account.",
          "Girilen alt hesap kodu aktif olmayan veya kaydedilemeyen bir hesaba ait."
        )
      );
      return;
    }

    const coaId = toPositiveInt(parentAccount?.coaId);
    if (!coaId) {
      setFormError(
        l(
          "Selected parent account has no chart of accounts id.",
          "Secilen ust hesabin hesap plani kimligi yok."
        )
      );
      return;
    }

    const accountType = normalizeAccountCode(parentAccount?.accountType);
    if (!accountType) {
      setFormError(
        l(
          "Selected parent account has no account type.",
          "Secilen ust hesabin hesap tipi yok."
        )
      );
      return;
    }
    if (
      inlineFieldConfig.expectedAccountType &&
      accountType !== inlineFieldConfig.expectedAccountType
    ) {
      setFormError(
        l(
          "Selected parent account type does not match this field.",
          "Secilen ust hesap tipi bu alanla uyusmuyor."
        )
      );
      return;
    }

    setInlineChildSaving(true);
    setFormError("");
    setFormMessage("");
    try {
      const defaultNormalSide =
        accountType === "LIABILITY" || accountType === "REVENUE" ? "CREDIT" : "DEBIT";
      await upsertAccount({
        coaId,
        code: childCode,
        name: childName,
        accountType,
        normalSide: normalizeAccountCode(parentAccount?.normalSide) || defaultNormalSide,
        allowPosting: true,
        parentAccountId,
      });

      const refreshedRows = await fetchAccountRowsForLegalEntity(selectedLegalEntityId);
      setAccountRows(refreshedRows);
      const resolvedAccount =
        refreshedRows.find((row) => normalizeAccountCode(row?.code) === childCode) || null;
      const resolvedAccountId = toPositiveInt(resolvedAccount?.id);
      if (!resolvedAccountId) {
        throw new Error(
          l(
            "Created account could not be resolved from the refreshed lookup.",
            "Olusturulan hesap yenilenen listede bulunamadi."
          )
        );
      }

      setForm((previous) => ({
        ...previous,
        [inlineChildFieldKey]: String(resolvedAccountId),
      }));
      clearInlineChildState();
      setFormMessage(
        `${l("Child account created and selected", "Alt hesap olusturulup secildi")}: ${childCode} - ${childName}`
      );
    } catch (error) {
      setFormError(
        normalizeApiError(
          error,
          l("Failed to create child account.", "Alt hesap olusturulamadi.")
        )
      );
    } finally {
      setInlineChildSaving(false);
    }
  }

  function renderAccountField(fieldKey, helperContent = null) {
    const fieldConfig = INLINE_ACCOUNT_FIELD_CONFIG[fieldKey];
    if (!fieldConfig) {
      return null;
    }
    const isInlinePanelOpen = inlineChildFieldKey === fieldKey;
    return (
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        <label className="block">
          {l(fieldConfig.labelEn, fieldConfig.labelTr)}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            value={form[fieldKey]}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                [fieldKey]: event.target.value,
              }))
            }
            disabled={saving || accountLoading || !canReadGlAccounts}
          >
            <option value="">{l("None", "Yok")}</option>
            {accountOptions.map((row) => (
              <option
                key={`${fieldConfig.optionKey}-${row.id}`}
                value={String(row.id)}
              >
                {formatAccountOptionLabel(row)}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] normal-case tracking-normal">
          <button
            type="button"
            className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-800 hover:bg-cyan-50 disabled:opacity-60"
            onClick={() => toggleInlineChildPanel(fieldKey)}
            disabled={saving || accountLoading || !canReadGlAccounts || !selectedLegalEntityId}
          >
            {isInlinePanelOpen
              ? l("Close child creator", "Alt hesap panelini kapat")
              : l("Add child account", "Alt hesap ekle")}
          </button>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
            {l("Expected type", "Beklenen tip")}: {fieldConfig.expectedAccountType}
          </span>
          {!selectedLegalEntityId ? (
            <span className="text-amber-700">
              {l(
                "Select a legal entity first to create a child account.",
                "Alt hesap olusturmak icin once tuzel kisilik secin."
              )}
            </span>
          ) : null}
        </div>
        {isInlinePanelOpen ? (
          <div className="mt-2 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 normal-case tracking-normal">
            <p className="text-xs text-cyan-800">
              {l(
                "Create a postable child account under the selected parent, then link it to this item card field.",
                "Secilen ust hesap altinda kaydedilebilir bir alt hesap olusturun ve bu urun karti alanina baglayin."
              )}
            </p>
            <Combobox
              value={inlineChildParentAccountId || null}
              options={inlineParentAccountLookupOptions}
              placeholder={l("Select parent account", "Ust hesap secin")}
              noOptionsText={l("No parent accounts found.", "Ust hesap bulunamadi.")}
              onChange={(nextValue) =>
                setInlineChildParentAccountId(nextValue ? String(nextValue) : "")
              }
              disabled={saving || accountLoading || inlineChildSaving}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs uppercase"
                value={inlineChildCode}
                onChange={(event) => setInlineChildCode(normalizeAccountCode(event.target.value))}
                placeholder={l("Child account code", "Alt hesap kodu")}
                maxLength={60}
              />
              <input
                type="text"
                className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs"
                value={inlineChildName}
                onChange={(event) => setInlineChildName(event.target.value)}
                placeholder={l("Child account name", "Alt hesap adi")}
                maxLength={255}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                onClick={() => setInlineChildCode(suggestedInlineChildCode)}
                disabled={!suggestedInlineChildCode || !selectedInlineParentAccount}
              >
                {l("Use next child code", "Sonraki alt kodu kullan")}
              </button>
              <button
                type="button"
                className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                onClick={handleCreateInlineChildAccount}
                disabled={saving || inlineChildSaving || !canUpsertGlAccounts}
              >
                {inlineChildSaving
                  ? l("Creating child...", "Alt hesap olusturuluyor...")
                  : l("Create child account", "Alt hesap olustur")}
              </button>
            </div>
            {!canUpsertGlAccounts ? (
              <p className="text-[11px] text-amber-700">
                {l(
                  "Need gl.account.upsert permission to create child accounts here.",
                  "Burada alt hesap olusturmak icin gl.account.upsert yetkisi gerekir."
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        {helperContent ? (
          <div className="mt-2 space-y-1 text-[11px] normal-case tracking-normal">
            {helperContent}
          </div>
        ) : null}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canUpsert) {
      setFormError(l("Missing permission: item.card.upsert", "Eksik yetki: item.card.upsert"));
      return;
    }
    const { payload, errors } = validateForm();
    if (errors.length > 0) {
      setFormError(errors.join(" "));
      return;
    }
    setSaving(true);
    setFormError("");
    setFormMessage("");
    try {
      const response = selectedRow?.id
        ? await updateItemCard(selectedRow.id, payload)
        : await createItemCard(payload);
      const nextRow = response?.row || null;
      setFormMessage(
        selectedRow?.id
          ? l("Item card updated.", "Urun karti guncellendi.")
          : l("Item card created.", "Urun karti olusturuldu.")
      );
      if (nextRow) {
        setSelectedRow(nextRow);
        setForm(mapItemCardRowToForm(nextRow));
        clearInlineChildState();
      }
      const refreshed = await listItemCards({
        legalEntityId: filters.legalEntityId || undefined,
        status: filters.status || undefined,
        itemType: filters.itemType || undefined,
        q: filters.q || undefined,
        limit: 200,
        offset: 0,
      });
      setRows(Array.isArray(refreshed?.rows) ? refreshed.rows : []);
    } catch (error) {
      setFormError(
        normalizeApiError(
          error,
          l("Failed to save item card.", "Urun karti kaydedilemedi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Item Cards", "Urun Kartlari")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Reusable finance-first item masters for CARI lines. They can default tax and account mappings before full inventory exists.",
            "Tam envanter gelmeden once CARI satirlari icin vergi ve hesap varsayilanlari verebilen finans odakli urun kartlari."
          )}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Filters", "Filtreler")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={filters.legalEntityId}
                options={legalEntityOptions}
                loading={legalEntityLookupLoading}
                placeholder={l("Search legal entity", "Tuzel kisilik ara")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) =>
                  setFilters((previous) => ({
                    ...previous,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
              />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Item Type", "Urun Tipi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.itemType}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, itemType: event.target.value }))
              }
            >
              <option value="">{l("All", "Tumleri")}</option>
              {ITEM_TYPES.map((itemType) => (
                <option key={`filter-item-type-${itemType}`} value={itemType}>
                  {itemType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.status}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, status: event.target.value }))
              }
            >
              <option value="">{l("All", "Tumleri")}</option>
              {STATUS_VALUES.map((status) => (
                <option key={`filter-item-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Search", "Ara")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.q}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, q: event.target.value }))
              }
              placeholder={l("code / name", "kod / ad")}
            />
          </label>
        </div>
        {legalEntityLookupError ? (
          <p className="mt-3 text-sm text-amber-700">{legalEntityLookupError}</p>
        ) : null}
        {listError ? <p className="mt-3 text-sm text-rose-700">{listError}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedRow?.id
              ? l("Edit Item Card", "Urun Kartini Duzenle")
              : l("Create Item Card", "Urun Karti Olustur")}
          </h2>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
            onClick={() => resetForm()}
            disabled={saving}
          >
            {l("Reset", "Sifirla")}
          </button>
        </div>
        {formError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div> : null}
        {formMessage ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{formMessage}</div> : null}
        {accountError ? <p className="mt-3 text-sm text-amber-700">{accountError}</p> : null}
        {taxCategoryError ? <p className="mt-3 text-sm text-amber-700">{taxCategoryError}</p> : null}
        <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={handleSubmit}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity (optional)", "Tuzel Kisilik (opsiyonel)")}
              <Combobox
                className="mt-1"
                value={form.legalEntityId}
                options={legalEntityOptions}
                loading={legalEntityLookupLoading}
                placeholder={l("Search legal entity", "Tuzel kisilik ara")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) =>
                  setForm((previous) => ({
                    ...previous,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                disabled={saving}
              />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Code", "Kod")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
              value={form.code}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, code: event.target.value }))
              }
              disabled={saving}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Name", "Ad")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.name}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, name: event.target.value }))
              }
              disabled={saving}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Item Type", "Urun Tipi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.itemType}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, itemType: event.target.value }))
              }
              disabled={saving}
            >
              {ITEM_TYPES.map((itemType) => (
                <option key={`form-item-type-${itemType}`} value={itemType}>
                  {itemType}
                </option>
              ))}
            </select>
          </label>
          {renderAccountField(
            "defaultSalesAccountId",
            <p className="text-slate-500">
              {l(
                "Revenue-side default for AR sales lines that use this item card.",
                "Bu urun kartini kullanan AR satis satirlari icin gelir varsayilanidir."
              )}
            </p>
          )}
          {renderAccountField(
            "defaultPurchaseAccountId",
            <p className="text-slate-500">
              {l(
                "For SERVICE / NON_STOCK_GOOD, use an expense account such as 770 / 760 / 740. For STOCK_ITEM, use Inventory Asset as the main purchase account; this field is backup only.",
                "SERVICE / NON_STOCK_GOOD icin 770 / 760 / 740 gibi bir gider hesabi kullanin. STOCK_ITEM icin ana alim hesabi olarak Stok Varlik kullanin; bu alan sadece yedektir."
              )}
            </p>
          )}
          {renderAccountField(
            "inventoryAssetAccountId",
            <p className="text-slate-500">
              {l(
                "Main stock account for STOCK_ITEM purchase receipt and on-hand inventory balance.",
                "STOCK_ITEM alim girisi ve eldeki stok bakiyesi icin ana stok hesabidir."
              )}
            </p>
          )}
          {renderAccountField(
            "inventoryTransitAccountId",
            <>
              <span
                className={`inline-flex rounded-full px-2 py-1 font-semibold ${formTransitSetup.className}`}
              >
                {l("Transit setup", "Transit ayari")}: {formTransitSetup.label}
              </span>
              {isStockItemType(form.itemType) ? (
                <p className="text-slate-500">
                  {toPositiveInt(form.inventoryTransitAccountId)
                    ? l(
                        "Stock transfer shipment and receipt postings can reuse this transit account.",
                        "Stok transferi sevkiyat ve teslim alma kayitlari bu transit hesabini kullanabilir."
                      )
                    : l(
                        "Cross-context stock transfers should have a transit account before shipment starts.",
                        "Baglamlar arasi stok transferlerinde sevkiyat baslamadan once transit hesabi tanimlanmalidir."
                      )}
                </p>
              ) : (
                <p className="text-slate-500">
                  {l(
                    "Transit account is only used for STOCK_ITEM transfer workflow.",
                    "Transit hesabi sadece STOCK_ITEM transfer akisi icin kullanilir."
                  )}
                </p>
              )}
            </>
          )}
          {renderAccountField("defaultCogsAccountId")}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Tax Category Code (optional)", "Vergi Kategori Kodu (opsiyonel)")}
            {taxCategoryOptions.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={form.taxCategoryCode}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    taxCategoryCode: event.target.value,
                  }))
                }
                disabled={saving}
              >
                <option value="">{l("None", "Yok")}</option>
                {taxCategoryOptions.map((option) => (
                  <option key={`tax-category-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                value={form.taxCategoryCode}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    taxCategoryCode: event.target.value,
                  }))
                }
                disabled={saving}
              />
            )}
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.status}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, status: event.target.value }))
              }
              disabled={saving}
            >
              {STATUS_VALUES.map((status) => (
                <option key={`form-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canUpsert || saving}
            >
              {saving
                ? l("Saving...", "Kaydediliyor...")
                : selectedRow?.id
                  ? l("Update Item Card", "Urun Kartini Guncelle")
                  : l("Create Item Card", "Urun Karti Olustur")}
            </button>
            {!canUpsert ? (
              <p className="self-center text-sm text-slate-500">
                {l("Missing permission: item.card.upsert", "Eksik yetki: item.card.upsert")}
              </p>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Item Card List", "Urun Karti Listesi")}
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-600">
            {l("Loading item cards...", "Urun kartlari yukleniyor...")}
          </p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {l("No item cards found for the current filters.", "Guncel filtrelerde urun karti bulunamadi.")}
          </p>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tip")}</th>
                  <th className="px-3 py-2">{l("Entity", "Tuzel Kisilik")}</th>
                  <th className="px-3 py-2">{l("Transit setup", "Transit ayari")}</th>
                  <th className="px-3 py-2">{l("Tax Category", "Vergi Kategorisi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`item-card-row-${row.id}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.code || "-"}</td>
                    <td className="px-3 py-2">{row.name || "-"}</td>
                    <td className="px-3 py-2">{row.itemType || "-"}</td>
                    <td className="px-3 py-2">{row.legalEntityId || "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${describeTransitSetup(row, l).className}`}
                      >
                        {describeTransitSetup(row, l).label}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.taxCategoryCode || "-"}</td>
                    <td className="px-3 py-2">{row.status || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                        onClick={() => {
                          setSelectedRow(row);
                          setForm(mapItemCardRowToForm(row));
                          clearInlineChildState();
                          setFormError("");
                          setFormMessage("");
                        }}
                        disabled={!canUpsert}
                      >
                        {l("Edit", "Duzenle")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
