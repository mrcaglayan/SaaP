import { useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import {
  ADDRESS_STATUSES,
  ADDRESS_TYPES,
  CONTACT_STATUSES,
  COUNTERPARTY_STATUSES,
  buildCounterpartyPayload,
  createEmptyAddress,
  createEmptyContact,
  toPositiveInt,
  validateCounterpartyForm,
} from "./counterpartyFormUtils.js";

function FieldError({ message }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-xs text-rose-700">{message}</p>;
}

function findFieldError(fieldErrors, key) {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return "";
  }
  return String(fieldErrors[key] || "");
}

function normalizeRoleLabel(isCustomer, isVendor) {
  if (isCustomer && isVendor) {
    return "Customer + Vendor";
  }
  if (isCustomer) {
    return "Customer";
  }
  if (isVendor) {
    return "Vendor";
  }
  return "None";
}

function buildAccountLookupLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  return String(row?.id || "-");
}

function buildAccountLookupDescription(row) {
  const breadcrumb = String(
    row?.breadcrumb || row?.breadcrumbCodes || row?.breadcrumbNames || ""
  ).trim();
  if (breadcrumb) {
    return breadcrumb;
  }
  const accountType = String(row?.accountType || "").trim().toUpperCase();
  return accountType || "";
}

function buildPaymentTermLookupLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  return String(row?.id || "-");
}

function buildPaymentTermLookupDescription(row) {
  const parts = [];
  const dueDays = Number(row?.dueDays ?? row?.due_days);
  const graceDays = Number(row?.graceDays ?? row?.grace_days);
  const isEndOfMonth = row?.isEndOfMonth === true || row?.is_end_of_month === true;
  const status = String(row?.status || "ACTIVE").trim().toUpperCase();

  if (Number.isFinite(dueDays) && dueDays >= 0) {
    parts.push(`Due ${dueDays}d`);
  }
  if (Number.isFinite(graceDays) && graceDays > 0) {
    parts.push(`Grace ${graceDays}d`);
  }
  if (isEndOfMonth) {
    parts.push("EOM");
  }
  if (status === "INACTIVE") {
    parts.push("INACTIVE");
  }
  return parts.join(" | ");
}

function buildOperatingUnitLookupLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  return String(row?.id || "-");
}

function buildOperatingUnitLookupDescription(row) {
  const status = String(row?.status || "ACTIVE").trim().toUpperCase();
  return status === "ACTIVE" ? "" : status;
}

function isActivePostableAccount(row) {
  const allowPosting = row?.allowPosting === true || Number(row?.allowPosting) === 1;
  const isActive = row?.isActive === true || Number(row?.isActive) === 1;
  return allowPosting && isActive;
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function renderInlineChildCreatePanel({
  codeCandidate,
  searchText,
  parentAccountLookupOptions,
  parentAccountId,
  onParentAccountIdChange,
  childCode,
  onChildCodeChange,
  childName,
  onChildNameChange,
  onUseTypedCode,
  onUseNextCode,
  suggestedNextCode,
  hasSelectedParent,
  onCreateChild,
  creating,
  canUpsertAccounts,
  submitting,
  permissionHint,
}) {
  const displayQuery = String(codeCandidate || searchText || "").trim();
  const canUseTypedCode = Boolean(String(codeCandidate || "").trim());

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2">
      {displayQuery ? (
        <p className="text-xs text-cyan-800">
          No exact account found for `"{displayQuery}"`. Create a child account below.
        </p>
      ) : (
        <p className="text-xs text-cyan-800">Create a child account below.</p>
      )}
      <Combobox
        value={parentAccountId || null}
        options={parentAccountLookupOptions}
        disabled={submitting || creating}
        placeholder="Select parent account"
        noOptionsText="No parent accounts found."
        onChange={(nextValue) => onParentAccountIdChange?.(nextValue ? String(nextValue) : "")}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={childCode}
          onChange={(event) =>
            onChildCodeChange?.(normalizeAccountCode(event.target.value))
          }
          className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs"
          placeholder="Child account code"
          maxLength={60}
        />
        <input
          value={childName}
          onChange={(event) => onChildNameChange?.(event.target.value)}
          className="rounded-md border border-cyan-300 bg-white px-3 py-2 text-xs"
          placeholder="New child account name"
          maxLength={255}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUseTypedCode}
          disabled={!canUseTypedCode}
          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100"
        >
          Use searched code
        </button>
        <button
          type="button"
          onClick={onUseNextCode}
          disabled={!suggestedNextCode || !hasSelectedParent}
          className="rounded border border-cyan-300 bg-white px-2 py-1 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
        >
          Use next child code
        </button>
        <button
          type="button"
          onClick={onCreateChild}
          disabled={creating || submitting || !canUpsertAccounts}
          className="rounded bg-cyan-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
        >
          {creating ? "Creating child..." : "Create child account"}
        </button>
      </div>
      {!canUpsertAccounts ? (
        <p className="text-[11px] text-amber-700">
          {permissionHint || "Missing permission: gl.account.upsert"}
        </p>
      ) : null}
    </div>
  );
}

function withSelectedPaymentTermFallback(options, selectedId) {
  const normalized = Array.isArray(options) ? [...options] : [];
  const selected = String(selectedId || "").trim();
  if (!selected) {
    return normalized;
  }
  const exists = normalized.some((row) => String(row?.id || "") === selected);
  if (exists) {
    return normalized;
  }
  normalized.unshift({
    id: selected,
    code: `#${selected}`,
    name: `Selected payment term #${selected}`,
    status: "ACTIVE",
  });
  return normalized;
}

function withSelectedFallbackOption(options, selectedId, expectedType = "") {
  const normalized = Array.isArray(options) ? [...options] : [];
  const selected = String(selectedId || "").trim();
  if (!selected) {
    return normalized;
  }
  const exists = normalized.some((row) => String(row?.id || "") === selected);
  if (exists) {
    return normalized;
  }
  normalized.unshift({
    id: selected,
    code: `#${selected}`,
    name: `Selected account #${selected}`,
    accountType: expectedType,
    allowPosting: true,
    isActive: true,
    breadcrumb: "",
    breadcrumbCodes: "",
    breadcrumbNames: "",
  });
  return normalized;
}

function withSelectedOperatingUnitFallbacks(options, selectedIds) {
  const normalized = Array.isArray(options) ? [...options] : [];
  const selected = Array.from(
    new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  for (const id of selected) {
    const exists = normalized.some((row) => String(row?.id || "") === id);
    if (exists) {
      continue;
    }
    normalized.unshift({
      id,
      code: `#${id}`,
      name: `Selected operating unit #${id}`,
      status: "ACTIVE",
    });
  }
  return normalized;
}

export default function CounterpartyForm({
  title,
  description,
  mode = "create",
  form,
  setForm,
  legalEntities = [],
  legalEntitiesLoading = false,
  legalEntitiesError = "",
  operatingUnits = [],
  operatingUnitsLoading = false,
  operatingUnitsError = "",
  paymentTerms = [],
  paymentTermsLoading = false,
  paymentTermsError = "",
  accountOptions = [],
  accountOptionsLoading = false,
  accountOptionsError = "",
  onAccountLookupQueryChange,
  canUpsertGlAccounts = false,
  accountUpsertFallbackMessage = "",
  canInlineCreateArAccount = false,
  inlineCreateArAccountLabel = "",
  inlineCreateArAccountSaving = false,
  onInlineCreateArAccount,
  inlineCreateArAccountError = "",
  inlineCreateArAccountMessage = "",
  showInlineCreateArAccountPanel = false,
  inlineCreateArCodeCandidate = "",
  inlineCreateArSearchText = "",
  inlineCreateArParentAccountOptions = [],
  inlineCreateArParentAccountId = "",
  onInlineCreateArParentAccountIdChange,
  inlineCreateArChildCode = "",
  onInlineCreateArChildCodeChange,
  inlineCreateArChildName = "",
  onInlineCreateArChildNameChange,
  inlineCreateArSuggestedNextCode = "",
  onInlineCreateArUseTypedCode,
  onInlineCreateArUseNextCode,
  canInlineCreateApAccount = false,
  inlineCreateApAccountLabel = "",
  inlineCreateApAccountSaving = false,
  onInlineCreateApAccount,
  inlineCreateApAccountError = "",
  inlineCreateApAccountMessage = "",
  showInlineCreateApAccountPanel = false,
  inlineCreateApCodeCandidate = "",
  inlineCreateApSearchText = "",
  inlineCreateApParentAccountOptions = [],
  inlineCreateApParentAccountId = "",
  onInlineCreateApParentAccountIdChange,
  inlineCreateApChildCode = "",
  onInlineCreateApChildCodeChange,
  inlineCreateApChildName = "",
  onInlineCreateApChildNameChange,
  inlineCreateApSuggestedNextCode = "",
  onInlineCreateApUseTypedCode,
  onInlineCreateApUseNextCode,
  onPaymentTermLookupQueryChange,
  canInlineCreatePaymentTerm = false,
  inlineCreatePaymentTermLabel = "",
  inlineCreatePaymentTermSaving = false,
  onInlineCreatePaymentTerm,
  inlineCreatePaymentTermError = "",
  inlineCreatePaymentTermMessage = "",
  canReadGlAccounts = true,
  accountReadFallbackMessage = "",
  canSubmit = true,
  submitting = false,
  onSubmit,
  onReset,
  onCancel,
  submitLabel = "Save",
  serverError = "",
  serverMessage = "",
  roleHint = "",
  enforceRoleAccountRequirement = mode === "create",
}) {
  const [showValidation, setShowValidation] = useState(false);
  const validationState = validateCounterpartyForm(form, {
    mode,
    requireRoleAccounts: enforceRoleAccountRequirement,
  });
  const fieldErrors = showValidation ? validationState.fieldErrors || {} : {};
  const globalErrors = showValidation ? validationState.globalErrors || [] : [];

  const roleLabel = normalizeRoleLabel(form.isCustomer, form.isVendor);
  const legalEntityOptions = Array.isArray(legalEntities) ? legalEntities : [];
  const showLegalEntitySelect = legalEntityOptions.length > 0;
  const selectedPrimaryOperatingUnitId = String(form.primaryOperatingUnitId || "");
  const selectedOperatingUnitIds = Array.from(
    new Set(
      (Array.isArray(form.operatingUnitIds) ? form.operatingUnitIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  const operatingUnitOptions = withSelectedOperatingUnitFallbacks(
    operatingUnits,
    selectedPrimaryOperatingUnitId
      ? [selectedPrimaryOperatingUnitId, ...selectedOperatingUnitIds]
      : selectedOperatingUnitIds
  );
  const operatingUnitLookupOptions = operatingUnitOptions.map((row) => ({
    value: String(row.id || ""),
    label: buildOperatingUnitLookupLabel(row),
    description: buildOperatingUnitLookupDescription(row),
  }));
  const selectedPaymentTermId = String(form.defaultPaymentTermId || "");
  const rawPaymentTermOptions = Array.isArray(paymentTerms) ? paymentTerms : [];
  const hasSelectedPaymentTerm = rawPaymentTermOptions.some(
    (row) => String(row.id) === selectedPaymentTermId
  );
  const paymentTermOptions = withSelectedPaymentTermFallback(
    rawPaymentTermOptions,
    selectedPaymentTermId
  );
  const paymentTermLookupOptions = paymentTermOptions.map((row) => ({
    value: String(row.id || ""),
    label: buildPaymentTermLookupLabel(row),
    description: buildPaymentTermLookupDescription(row),
  }));
  const allAccountOptions = Array.isArray(accountOptions) ? accountOptions : [];
  const selectedArAccountId = String(form.arAccountId || "");
  const selectedApAccountId = String(form.apAccountId || "");
  const arAccountOptions = withSelectedFallbackOption(
    allAccountOptions.filter(
      (row) =>
        String(row.accountType || "").toUpperCase() === "ASSET" &&
        isActivePostableAccount(row)
    ),
    selectedArAccountId,
    "ASSET"
  );
  const apAccountOptions = withSelectedFallbackOption(
    allAccountOptions.filter(
      (row) =>
        String(row.accountType || "").toUpperCase() === "LIABILITY" &&
        isActivePostableAccount(row)
    ),
    selectedApAccountId,
    "LIABILITY"
  );
  const arAccountLookupOptions = arAccountOptions.map((row) => ({
    value: String(row.id || ""),
    label: buildAccountLookupLabel(row),
    description: buildAccountLookupDescription(row),
  }));
  const apAccountLookupOptions = apAccountOptions.map((row) => ({
    value: String(row.id || ""),
    label: buildAccountLookupLabel(row),
    description: buildAccountLookupDescription(row),
  }));
  const inlineArParentAccountLookupOptions = (
    Array.isArray(inlineCreateArParentAccountOptions)
      ? inlineCreateArParentAccountOptions
      : []
  ).map((row) => ({
    value: String(row.id || ""),
    label: buildAccountLookupLabel(row),
    description: buildAccountLookupDescription(row),
  }));
  const inlineApParentAccountLookupOptions = (
    Array.isArray(inlineCreateApParentAccountOptions)
      ? inlineCreateApParentAccountOptions
      : []
  ).map((row) => ({
    value: String(row.id || ""),
    label: buildAccountLookupLabel(row),
    description: buildAccountLookupDescription(row),
  }));

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updatePrimaryOperatingUnit(nextValue) {
    const normalizedValue = nextValue ? String(nextValue) : "";
    setForm((prev) => {
      const existingIds = Array.isArray(prev.operatingUnitIds)
        ? prev.operatingUnitIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const nextOperatingUnitIds = normalizedValue
        ? Array.from(new Set([normalizedValue, ...existingIds]))
        : existingIds;
      return {
        ...prev,
        primaryOperatingUnitId: normalizedValue,
        operatingUnitIds: nextOperatingUnitIds,
      };
    });
  }

  function toggleAllowedOperatingUnit(operatingUnitId, checked) {
    const normalizedOperatingUnitId = String(operatingUnitId || "").trim();
    if (!normalizedOperatingUnitId) {
      return;
    }
    setForm((prev) => {
      const existingIds = Array.isArray(prev.operatingUnitIds)
        ? prev.operatingUnitIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const nextOperatingUnitIds = checked
        ? Array.from(new Set([...existingIds, normalizedOperatingUnitId]))
        : existingIds.filter((id) => id !== normalizedOperatingUnitId);
      const nextPrimaryOperatingUnitId =
        String(prev.primaryOperatingUnitId || "").trim() === normalizedOperatingUnitId && !checked
          ? ""
          : String(prev.primaryOperatingUnitId || "").trim();
      return {
        ...prev,
        primaryOperatingUnitId: nextPrimaryOperatingUnitId,
        operatingUnitIds: nextOperatingUnitIds,
      };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    if (validationState.hasErrors || !canSubmit || submitting) {
      return;
    }
    const payload = buildCounterpartyPayload(form, { mode });
    onSubmit?.(payload);
  }

  function addContact() {
    setForm((prev) => ({
      ...prev,
      contacts: [...(Array.isArray(prev.contacts) ? prev.contacts : []), createEmptyContact()],
    }));
  }

  function updateContact(index, field, value) {
    setForm((prev) => {
      const nextContacts = [...(Array.isArray(prev.contacts) ? prev.contacts : [])];
      if (!nextContacts[index]) {
        return prev;
      }
      nextContacts[index] = {
        ...nextContacts[index],
        [field]: value,
      };
      return {
        ...prev,
        contacts: nextContacts,
      };
    });
  }

  function setPrimaryContact(index, isPrimary) {
    setForm((prev) => {
      const nextContacts = [...(Array.isArray(prev.contacts) ? prev.contacts : [])];
      if (!nextContacts[index]) {
        return prev;
      }
      const normalized = nextContacts.map((row, rowIndex) => ({
        ...row,
        isPrimary: isPrimary && rowIndex === index,
      }));
      return {
        ...prev,
        contacts: normalized,
      };
    });
  }

  function removeContact(index) {
    setForm((prev) => {
      const nextContacts = [...(Array.isArray(prev.contacts) ? prev.contacts : [])];
      nextContacts.splice(index, 1);
      return {
        ...prev,
        contacts: nextContacts,
      };
    });
  }

  function addAddress() {
    setForm((prev) => ({
      ...prev,
      addresses: [...(Array.isArray(prev.addresses) ? prev.addresses : []), createEmptyAddress()],
    }));
  }

  function updateAddress(index, field, value) {
    setForm((prev) => {
      const nextRows = [...(Array.isArray(prev.addresses) ? prev.addresses : [])];
      if (!nextRows[index]) {
        return prev;
      }
      nextRows[index] = {
        ...nextRows[index],
        [field]: value,
      };
      return {
        ...prev,
        addresses: nextRows,
      };
    });
  }

  function setPrimaryAddress(index, isPrimary) {
    setForm((prev) => {
      const nextRows = [...(Array.isArray(prev.addresses) ? prev.addresses : [])];
      if (!nextRows[index]) {
        return prev;
      }
      const normalized = nextRows.map((row, rowIndex) => ({
        ...row,
        isPrimary: isPrimary && rowIndex === index,
      }));
      return {
        ...prev,
        addresses: normalized,
      };
    });
  }

  function removeAddress(index) {
    setForm((prev) => {
      const nextRows = [...(Array.isArray(prev.addresses) ? prev.addresses : [])];
      nextRows.splice(index, 1);
      return {
        ...prev,
        addresses: nextRows,
      };
    });
  }

  return (
    <form
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          {roleHint ? <p className="mt-1 text-xs text-slate-500">{roleHint}</p> : null}
        </div>
        <span className="inline-flex rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
          Role: {roleLabel}
        </span>
      </div>

      {serverError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </div>
      ) : null}

      {serverMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {serverMessage}
        </div>
      ) : null}

      {globalErrors.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {globalErrors.map((row, index) => (
            <p key={`global-error-${index}`}>{row}</p>
          ))}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Legal Entity
          </label>
          {showLegalEntitySelect ? (
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.legalEntityId}
              onChange={(event) => updateField("legalEntityId", event.target.value)}
              disabled={submitting}
            >
              <option value="">Select legal entity</option>
              {legalEntityOptions.map((row) => (
                <option key={`legal-entity-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              type="number"
              min="1"
              placeholder="Legal entity id"
              value={form.legalEntityId}
              onChange={(event) => updateField("legalEntityId", event.target.value)}
              disabled={submitting}
            />
          )}
          {legalEntitiesLoading ? (
            <p className="mt-1 text-xs text-slate-500">Loading legal entities...</p>
          ) : null}
          {legalEntitiesError ? (
            <p className="mt-1 text-xs text-amber-700">{legalEntitiesError}</p>
          ) : null}
          <FieldError message={findFieldError(fieldErrors, "legalEntityId")} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
          </label>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.status}
            onChange={(event) => updateField("status", event.target.value)}
            disabled={submitting}
          >
            {COUNTERPARTY_STATUSES.map((status) => (
              <option key={`counterparty-status-${status}`} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Primary Operating Unit (default owner branch)
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Select the branch that should be used by default as the owner context for this
            customer/vendor card's documents and open items.
          </p>
          <Combobox
            className="mt-2"
            value={selectedPrimaryOperatingUnitId}
            options={operatingUnitLookupOptions}
            loading={operatingUnitsLoading}
            disabled={submitting || !form.legalEntityId}
            placeholder={
              form.legalEntityId
                ? "Search operating unit code/name"
                : "Select legal entity first"
            }
            noOptionsText={
              form.legalEntityId
                ? "No operating units found."
                : "Set legalEntityId to load operating units."
            }
            onChange={(nextValue) => updatePrimaryOperatingUnit(nextValue ? String(nextValue) : "")}
          />
          {!form.legalEntityId ? (
            <p className="mt-1 text-xs text-slate-500">Select legal entity first.</p>
          ) : null}
          {operatingUnitsError ? (
            <p className="mt-1 text-xs text-amber-700">{operatingUnitsError}</p>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Allowed Operating Units (branches allowed to own this card's activity)
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Select the branches that are allowed to own this counterparty's invoices, bills, and
            open items. This does not by itself choose which cash register or bank branch will
            collect or pay.
          </p>
          {!form.legalEntityId ? (
            <p className="mt-1 text-xs text-slate-500">Select legal entity first.</p>
          ) : operatingUnitOptions.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No operating units loaded. Leave empty to keep the counterparty shared across the legal entity.
            </p>
          ) : (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {operatingUnitOptions.map((row) => {
                const operatingUnitId = String(row?.id || "").trim();
                const checked = selectedOperatingUnitIds.includes(operatingUnitId);
                return (
                  <label
                    key={`counterparty-operating-unit-${operatingUnitId}`}
                    className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        toggleAllowedOperatingUnit(operatingUnitId, event.target.checked)
                      }
                      disabled={submitting}
                    />
                    <span>
                      <span className="block font-medium">
                        {buildOperatingUnitLookupLabel(row)}
                      </span>
                      {buildOperatingUnitLookupDescription(row) ? (
                        <span className="block text-xs text-slate-500">
                          {buildOperatingUnitLookupDescription(row)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Code
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="text"
            maxLength={60}
            value={form.code}
            onChange={(event) => updateField("code", event.target.value.toUpperCase())}
            disabled={submitting}
          />
          <FieldError message={findFieldError(fieldErrors, "code")} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Name
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="text"
            maxLength={255}
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            disabled={submitting}
          />
          <FieldError message={findFieldError(fieldErrors, "name")} />
        </div>

        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Card Role Flags
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form.isCustomer)}
                onChange={(event) => updateField("isCustomer", event.target.checked)}
                disabled={submitting}
              />
              Customer
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form.isVendor)}
                onChange={(event) => updateField("isVendor", event.target.checked)}
                disabled={submitting}
              />
              Vendor
            </label>
          </div>
          <FieldError message={findFieldError(fieldErrors, "role")} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Tax Id
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="text"
            maxLength={80}
            value={form.taxId}
            onChange={(event) => updateField("taxId", event.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Default Currency
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
            type="text"
            maxLength={3}
            value={form.defaultCurrencyCode}
            onChange={(event) =>
              updateField("defaultCurrencyCode", event.target.value.toUpperCase())
            }
            disabled={submitting}
            placeholder="USD"
          />
          <FieldError message={findFieldError(fieldErrors, "defaultCurrencyCode")} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Email
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="email"
            maxLength={255}
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Phone
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            type="text"
            maxLength={80}
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Default Payment Term
          </label>
          <Combobox
            className="mt-1"
            value={selectedPaymentTermId}
            options={paymentTermLookupOptions}
            loading={paymentTermsLoading}
            disabled={submitting || !form.legalEntityId}
            placeholder={
              form.legalEntityId
                ? "Search payment term code/name"
                : "Select legal entity first"
            }
            noOptionsText={
              form.legalEntityId
                ? "No payment terms found."
                : "Set legalEntityId to load payment terms."
            }
            onInputChange={(nextValue, meta) => {
              if (typeof onPaymentTermLookupQueryChange === "function") {
                onPaymentTermLookupQueryChange(nextValue, meta);
              }
            }}
            onChange={(nextValue) =>
              updateField("defaultPaymentTermId", nextValue ? String(nextValue) : "")
            }
          />
          {canInlineCreatePaymentTerm ? (
            <button
              type="button"
              className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
              onClick={onInlineCreatePaymentTerm}
              disabled={
                inlineCreatePaymentTermSaving ||
                submitting ||
                typeof onInlineCreatePaymentTerm !== "function"
              }
            >
              {inlineCreatePaymentTermSaving
                ? "Creating payment term..."
                : `Create "${inlineCreatePaymentTermLabel || "new payment term"}"`}
            </button>
          ) : null}
          {!form.legalEntityId ? (
            <p className="mt-1 text-xs text-slate-500">
              Select legal entity first.
            </p>
          ) : null}
          {paymentTermsError ? (
            <p className="mt-1 text-xs text-amber-700">{paymentTermsError}</p>
          ) : null}
          {inlineCreatePaymentTermError ? (
            <p className="mt-1 text-xs text-rose-700">{inlineCreatePaymentTermError}</p>
          ) : null}
          {inlineCreatePaymentTermMessage ? (
            <p className="mt-1 text-xs text-emerald-700">{inlineCreatePaymentTermMessage}</p>
          ) : null}
          {selectedPaymentTermId && !hasSelectedPaymentTerm ? (
            <p className="mt-1 text-xs text-amber-700">
              Selected payment term is not in current lookup scope.
            </p>
          ) : null}
          <FieldError message={findFieldError(fieldErrors, "defaultPaymentTermId")} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            AR Control Account Override
          </label>
          {canReadGlAccounts ? (
            <>
              <Combobox
                className="mt-1"
                value={selectedArAccountId}
                options={arAccountLookupOptions}
                loading={accountOptionsLoading}
                placeholder={
                  form.legalEntityId
                    ? "Search AR account code/name"
                    : "Select legal entity first"
                }
                noOptionsText={
                  form.legalEntityId
                    ? "No AR accounts found. Type to refine search."
                    : "Set legalEntityId to load AR accounts."
                }
                onInputChange={(nextValue, meta) => {
                  if (typeof onAccountLookupQueryChange === "function") {
                    onAccountLookupQueryChange(nextValue, meta, "AR");
                  }
                }}
                onChange={(nextValue) =>
                  updateField("arAccountId", nextValue ? String(nextValue) : "")
                }
                disabled={submitting || !form.legalEntityId || !form.isCustomer}
              />
              {showInlineCreateArAccountPanel
                ? renderInlineChildCreatePanel({
                    codeCandidate: inlineCreateArCodeCandidate,
                    searchText: inlineCreateArSearchText,
                    parentAccountLookupOptions: inlineArParentAccountLookupOptions,
                    parentAccountId: inlineCreateArParentAccountId,
                    onParentAccountIdChange: onInlineCreateArParentAccountIdChange,
                    childCode: inlineCreateArChildCode,
                    onChildCodeChange: onInlineCreateArChildCodeChange,
                    childName: inlineCreateArChildName,
                    onChildNameChange: onInlineCreateArChildNameChange,
                    onUseTypedCode: onInlineCreateArUseTypedCode,
                    onUseNextCode: onInlineCreateArUseNextCode,
                    suggestedNextCode: inlineCreateArSuggestedNextCode,
                    hasSelectedParent: Boolean(toPositiveInt(inlineCreateArParentAccountId)),
                    onCreateChild: onInlineCreateArAccount,
                    creating: inlineCreateArAccountSaving,
                    canUpsertAccounts: canUpsertGlAccounts,
                    submitting,
                    permissionHint: accountUpsertFallbackMessage,
                  })
                : null}
              {!showInlineCreateArAccountPanel && canInlineCreateArAccount ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                  onClick={onInlineCreateArAccount}
                  disabled={
                    inlineCreateArAccountSaving ||
                    submitting ||
                    typeof onInlineCreateArAccount !== "function"
                  }
                >
                  {inlineCreateArAccountSaving
                    ? "Creating AR sub-account..."
                    : `Create "${inlineCreateArAccountLabel || "new AR sub-account"}"`}
                </button>
              ) : null}
              {!form.isCustomer ? (
                <p className="mt-1 text-xs text-slate-500">
                  Enable Customer role to set AR mapping.
                </p>
              ) : null}
              {accountOptionsLoading ? (
                <p className="mt-1 text-xs text-slate-500">Loading account options...</p>
              ) : null}
              {accountOptionsError ? (
                <p className="mt-1 text-xs text-amber-700">{accountOptionsError}</p>
              ) : null}
              {inlineCreateArAccountError ? (
                <p className="mt-1 text-xs text-rose-700">{inlineCreateArAccountError}</p>
              ) : null}
              {inlineCreateArAccountMessage ? (
                <p className="mt-1 text-xs text-emerald-700">{inlineCreateArAccountMessage}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {accountReadFallbackMessage || "Missing permission: gl.account.read"}
            </p>
          )}
          <FieldError message={findFieldError(fieldErrors, "arAccountId")} />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            AP Control Account Override
          </label>
          {canReadGlAccounts ? (
            <>
              <Combobox
                className="mt-1"
                value={selectedApAccountId}
                options={apAccountLookupOptions}
                loading={accountOptionsLoading}
                placeholder={
                  form.legalEntityId
                    ? "Search AP account code/name"
                    : "Select legal entity first"
                }
                noOptionsText={
                  form.legalEntityId
                    ? "No AP accounts found. Type to refine search."
                    : "Set legalEntityId to load AP accounts."
                }
                onInputChange={(nextValue, meta) => {
                  if (typeof onAccountLookupQueryChange === "function") {
                    onAccountLookupQueryChange(nextValue, meta, "AP");
                  }
                }}
                onChange={(nextValue) =>
                  updateField("apAccountId", nextValue ? String(nextValue) : "")
                }
                disabled={submitting || !form.legalEntityId || !form.isVendor}
              />
              {showInlineCreateApAccountPanel
                ? renderInlineChildCreatePanel({
                    codeCandidate: inlineCreateApCodeCandidate,
                    searchText: inlineCreateApSearchText,
                    parentAccountLookupOptions: inlineApParentAccountLookupOptions,
                    parentAccountId: inlineCreateApParentAccountId,
                    onParentAccountIdChange: onInlineCreateApParentAccountIdChange,
                    childCode: inlineCreateApChildCode,
                    onChildCodeChange: onInlineCreateApChildCodeChange,
                    childName: inlineCreateApChildName,
                    onChildNameChange: onInlineCreateApChildNameChange,
                    onUseTypedCode: onInlineCreateApUseTypedCode,
                    onUseNextCode: onInlineCreateApUseNextCode,
                    suggestedNextCode: inlineCreateApSuggestedNextCode,
                    hasSelectedParent: Boolean(toPositiveInt(inlineCreateApParentAccountId)),
                    onCreateChild: onInlineCreateApAccount,
                    creating: inlineCreateApAccountSaving,
                    canUpsertAccounts: canUpsertGlAccounts,
                    submitting,
                    permissionHint: accountUpsertFallbackMessage,
                  })
                : null}
              {!showInlineCreateApAccountPanel && canInlineCreateApAccount ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                  onClick={onInlineCreateApAccount}
                  disabled={
                    inlineCreateApAccountSaving ||
                    submitting ||
                    typeof onInlineCreateApAccount !== "function"
                  }
                >
                  {inlineCreateApAccountSaving
                    ? "Creating AP sub-account..."
                    : `Create "${inlineCreateApAccountLabel || "new AP sub-account"}"`}
                </button>
              ) : null}
              {!form.isVendor ? (
                <p className="mt-1 text-xs text-slate-500">
                  Enable Vendor role to set AP mapping.
                </p>
              ) : null}
              {accountOptionsLoading ? (
                <p className="mt-1 text-xs text-slate-500">Loading account options...</p>
              ) : null}
              {accountOptionsError ? (
                <p className="mt-1 text-xs text-amber-700">{accountOptionsError}</p>
              ) : null}
              {inlineCreateApAccountError ? (
                <p className="mt-1 text-xs text-rose-700">{inlineCreateApAccountError}</p>
              ) : null}
              {inlineCreateApAccountMessage ? (
                <p className="mt-1 text-xs text-emerald-700">{inlineCreateApAccountMessage}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {accountReadFallbackMessage || "Missing permission: gl.account.read"}
            </p>
          )}
          <FieldError message={findFieldError(fieldErrors, "apAccountId")} />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Notes
          </label>
          <textarea
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            maxLength={500}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            disabled={submitting}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Contacts</h3>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={addContact}
            disabled={submitting}
          >
            Add Contact
          </button>
        </div>

        {(Array.isArray(form.contacts) ? form.contacts : []).length === 0 ? (
          <p className="text-xs text-slate-500">No contacts added yet.</p>
        ) : null}

        {(Array.isArray(form.contacts) ? form.contacts : []).map((row, index) => {
          const persisted = Boolean(toPositiveInt(row.id));
          return (
            <div
              key={`contact-${row.id || index}`}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    Contact Name
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.contactName}
                    onChange={(event) =>
                      updateContact(index, "contactName", event.target.value)
                    }
                    disabled={submitting}
                  />
                  <FieldError
                    message={findFieldError(fieldErrors, `contacts.${index}.contactName`)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">Title</label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.title}
                    onChange={(event) => updateContact(index, "title", event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">Email</label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="email"
                    value={row.email}
                    onChange={(event) => updateContact(index, "email", event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">Phone</label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.phone}
                    onChange={(event) => updateContact(index, "phone", event.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(row.isPrimary)}
                    onChange={(event) => setPrimaryContact(index, event.target.checked)}
                    disabled={submitting}
                  />
                  Primary
                </label>

                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  Status
                  <select
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={row.status}
                    onChange={(event) => updateContact(index, "status", event.target.value)}
                    disabled={submitting}
                  >
                    {CONTACT_STATUSES.map((status) => (
                      <option key={`contact-status-${status}`} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => removeContact(index)}
                  disabled={submitting || persisted}
                  title={persisted ? "Persisted contacts cannot be deleted in v1." : ""}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Addresses</h3>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={addAddress}
            disabled={submitting}
          >
            Add Address
          </button>
        </div>

        {(Array.isArray(form.addresses) ? form.addresses : []).length === 0 ? (
          <p className="text-xs text-slate-500">No addresses added yet.</p>
        ) : null}

        {(Array.isArray(form.addresses) ? form.addresses : []).map((row, index) => {
          const persisted = Boolean(toPositiveInt(row.id));
          return (
            <div
              key={`address-${row.id || index}`}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    Address Type
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={row.addressType}
                    onChange={(event) =>
                      updateAddress(index, "addressType", event.target.value)
                    }
                    disabled={submitting}
                  >
                    {ADDRESS_TYPES.map((addressType) => (
                      <option key={`address-type-${addressType}`} value={addressType}>
                        {addressType}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">Status</label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={row.status}
                    onChange={(event) => updateAddress(index, "status", event.target.value)}
                    disabled={submitting}
                  >
                    {ADDRESS_STATUSES.map((status) => (
                      <option key={`address-status-${status}`} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600">
                    Address Line 1
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.addressLine1}
                    onChange={(event) =>
                      updateAddress(index, "addressLine1", event.target.value)
                    }
                    disabled={submitting}
                  />
                  <FieldError
                    message={findFieldError(fieldErrors, `addresses.${index}.addressLine1`)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600">
                    Address Line 2
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.addressLine2}
                    onChange={(event) =>
                      updateAddress(index, "addressLine2", event.target.value)
                    }
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">City</label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.city}
                    onChange={(event) => updateAddress(index, "city", event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    State / Region
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.stateRegion}
                    onChange={(event) =>
                      updateAddress(index, "stateRegion", event.target.value)
                    }
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    Postal Code
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="text"
                    value={row.postalCode}
                    onChange={(event) =>
                      updateAddress(index, "postalCode", event.target.value)
                    }
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600">
                    Country Id
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min="1"
                    value={row.countryId}
                    onChange={(event) => updateAddress(index, "countryId", event.target.value)}
                    disabled={submitting}
                  />
                  <FieldError
                    message={findFieldError(fieldErrors, `addresses.${index}.countryId`)}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(row.isPrimary)}
                    onChange={(event) => setPrimaryAddress(index, event.target.checked)}
                    disabled={submitting}
                  />
                  Primary
                </label>

                <button
                  type="button"
                  className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => removeAddress(index)}
                  disabled={submitting || persisted}
                  title={persisted ? "Persisted addresses cannot be deleted in v1." : ""}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={submitting || !canSubmit}
        >
          {submitting ? "Saving..." : submitLabel}
        </button>

        {onReset ? (
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onReset}
            disabled={submitting}
          >
            Reset
          </button>
        ) : null}

        {onCancel ? (
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
