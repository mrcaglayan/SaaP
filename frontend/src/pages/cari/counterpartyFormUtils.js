export const COUNTERPARTY_STATUSES = ["ACTIVE", "INACTIVE"];
export const CONTACT_STATUSES = ["ACTIVE", "INACTIVE"];
export const ADDRESS_STATUSES = ["ACTIVE", "INACTIVE"];
export const ADDRESS_TYPES = ["BILLING", "SHIPPING", "REGISTERED", "OTHER"];
export const ROLE_FILTERS = ["CUSTOMER", "VENDOR", "BOTH"];

export function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toTrimmed(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const normalized = toTrimmed(value);
  return normalized || null;
}

function normalizeOptionalCode(value) {
  const normalized = toTrimmed(value).toUpperCase();
  return normalized || null;
}

export function createEmptyContact() {
  return {
    id: "",
    contactName: "",
    email: "",
    phone: "",
    title: "",
    isPrimary: false,
    status: "ACTIVE",
  };
}

export function createEmptyAddress() {
  return {
    id: "",
    addressType: "BILLING",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    countryId: "",
    isPrimary: false,
    status: "ACTIVE",
  };
}

export function buildInitialCounterpartyForm(defaultRole = "CUSTOMER") {
  return {
    legalEntityId: "",
    code: "",
    name: "",
    isCustomer: defaultRole === "CUSTOMER",
    isVendor: defaultRole === "VENDOR",
    status: "ACTIVE",
    taxId: "",
    email: "",
    phone: "",
    notes: "",
    defaultCurrencyCode: "",
    defaultPaymentTermId: "",
    contacts: [],
    addresses: [],
  };
}

export function mapDetailToCounterpartyForm(row, fallbackRole = "CUSTOMER") {
  if (!row || typeof row !== "object") {
    return buildInitialCounterpartyForm(fallbackRole);
  }

  const contacts = Array.isArray(row.contacts)
    ? row.contacts.map((contact) => ({
        id: String(contact?.id || ""),
        contactName: String(contact?.contactName || ""),
        email: String(contact?.email || ""),
        phone: String(contact?.phone || ""),
        title: String(contact?.title || ""),
        isPrimary: Boolean(contact?.isPrimary),
        status: String(contact?.status || "ACTIVE").toUpperCase(),
      }))
    : [];

  const addresses = Array.isArray(row.addresses)
    ? row.addresses.map((address) => ({
        id: String(address?.id || ""),
        addressType: String(address?.addressType || "BILLING").toUpperCase(),
        addressLine1: String(address?.addressLine1 || ""),
        addressLine2: String(address?.addressLine2 || ""),
        city: String(address?.city || ""),
        stateRegion: String(address?.stateRegion || ""),
        postalCode: String(address?.postalCode || ""),
        countryId: String(address?.countryId || ""),
        isPrimary: Boolean(address?.isPrimary),
        status: String(address?.status || "ACTIVE").toUpperCase(),
      }))
    : [];

  return {
    legalEntityId: String(row.legalEntityId || ""),
    code: String(row.code || ""),
    name: String(row.name || ""),
    isCustomer: Boolean(row.isCustomer),
    isVendor: Boolean(row.isVendor),
    status: String(row.status || "ACTIVE").toUpperCase(),
    taxId: String(row.taxId || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    notes: String(row.notes || ""),
    defaultCurrencyCode: String(row.defaultCurrencyCode || ""),
    defaultPaymentTermId: String(row.defaultPaymentTermId || ""),
    contacts,
    addresses,
  };
}

export function validateCounterpartyForm(form, { mode = "create" } = {}) {
  const fieldErrors = {};
  const globalErrors = [];

  if (!toPositiveInt(form.legalEntityId)) {
    fieldErrors.legalEntityId = "Legal entity is required.";
  }

  if (!toTrimmed(form.code)) {
    fieldErrors.code = "Code is required.";
  }

  if (!toTrimmed(form.name)) {
    fieldErrors.name = "Name is required.";
  }

  if (!form.isCustomer && !form.isVendor) {
    fieldErrors.role = "At least one of Customer or Vendor must be selected.";
  }

  const paymentTermId = toTrimmed(form.defaultPaymentTermId);
  if (paymentTermId && !toPositiveInt(paymentTermId)) {
    fieldErrors.defaultPaymentTermId = "Payment term must be a positive number.";
  }

  const currency = toTrimmed(form.defaultCurrencyCode).toUpperCase();
  if (currency && currency.length !== 3) {
    fieldErrors.defaultCurrencyCode = "Currency code must be 3 letters.";
  }

  let primaryContactCount = 0;
  (Array.isArray(form.contacts) ? form.contacts : []).forEach((row, index) => {
    if (!toTrimmed(row.contactName)) {
      fieldErrors[`contacts.${index}.contactName`] = "Contact name is required.";
    }
    if (row.isPrimary) {
      primaryContactCount += 1;
    }
  });

  if (primaryContactCount > 1) {
    globalErrors.push("Only one contact can be marked as primary.");
  }

  let primaryAddressCount = 0;
  (Array.isArray(form.addresses) ? form.addresses : []).forEach((row, index) => {
    if (!toTrimmed(row.addressLine1)) {
      fieldErrors[`addresses.${index}.addressLine1`] = "Address line 1 is required.";
    }
    const countryId = toTrimmed(row.countryId);
    if (countryId && !toPositiveInt(countryId)) {
      fieldErrors[`addresses.${index}.countryId`] =
        "Country id must be a positive number.";
    }
    if (row.isPrimary) {
      primaryAddressCount += 1;
    }
  });

  if (primaryAddressCount > 1) {
    globalErrors.push("Only one address can be marked as primary.");
  }

  const hasErrors = Object.keys(fieldErrors).length > 0 || globalErrors.length > 0;
  if (mode !== "create" && mode !== "edit") {
    globalErrors.push("Invalid form mode.");
  }

  return {
    hasErrors,
    fieldErrors,
    globalErrors,
  };
}

export function buildCounterpartyPayload(form, { mode = "create" } = {}) {
  const contacts = (Array.isArray(form.contacts) ? form.contacts : []).map((row) => {
    const normalized = {
      contactName: toTrimmed(row.contactName),
      email: normalizeOptionalText(row.email),
      phone: normalizeOptionalText(row.phone),
      title: normalizeOptionalText(row.title),
      isPrimary: Boolean(row.isPrimary),
      status: String(row.status || "ACTIVE").toUpperCase(),
    };
    const id = toPositiveInt(row.id);
    if (mode === "edit" && id) {
      normalized.id = id;
    }
    return normalized;
  });

  const addresses = (Array.isArray(form.addresses) ? form.addresses : []).map((row) => {
    const normalized = {
      addressType: String(row.addressType || "BILLING").toUpperCase(),
      addressLine1: toTrimmed(row.addressLine1),
      addressLine2: normalizeOptionalText(row.addressLine2),
      city: normalizeOptionalText(row.city),
      stateRegion: normalizeOptionalText(row.stateRegion),
      postalCode: normalizeOptionalText(row.postalCode),
      countryId: toPositiveInt(row.countryId),
      isPrimary: Boolean(row.isPrimary),
      status: String(row.status || "ACTIVE").toUpperCase(),
    };
    const id = toPositiveInt(row.id);
    if (mode === "edit" && id) {
      normalized.id = id;
    }
    return normalized;
  });

  const payload = {
    legalEntityId: toPositiveInt(form.legalEntityId),
    code: toTrimmed(form.code).toUpperCase(),
    name: toTrimmed(form.name),
    isCustomer: Boolean(form.isCustomer),
    isVendor: Boolean(form.isVendor),
    status: String(form.status || "ACTIVE").toUpperCase(),
    taxId: normalizeOptionalText(form.taxId),
    email: normalizeOptionalText(form.email),
    phone: normalizeOptionalText(form.phone),
    notes: normalizeOptionalText(form.notes),
    defaultCurrencyCode: normalizeOptionalCode(form.defaultCurrencyCode),
    defaultPaymentTermId: toPositiveInt(form.defaultPaymentTermId),
    contacts,
    addresses,
  };

  if (mode === "create") {
    return payload;
  }

  return payload;
}

export function mapCounterpartyApiError(err, fallback = "Operation failed.") {
  const message = String(err?.response?.data?.message || "").trim();
  const requestId = String(err?.response?.data?.requestId || "").trim();
  const lower = message.toLowerCase();

  if (!message) {
    return fallback;
  }
  if (lower.includes("unique within tenant")) {
    return "Duplicate code detected in the same legal entity.";
  }
  if (lower.includes("at least one of iscustomer or isvendor")) {
    return "Select Customer or Vendor (or both).";
  }
  if (lower.includes("defaultpaymenttermid")) {
    return "Payment term must belong to the selected legal entity.";
  }
  if (lower.includes("legalentityid is required")) {
    return "Legal entity is required.";
  }
  if (requestId) {
    return `${message} (requestId: ${requestId})`;
  }
  return message;
}
