import { query, withTransaction } from "../db.js";
import {
  assertCountryExists,
  assertCurrencyExists,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function isDuplicateConstraintError(err) {
  return Number(err?.errno) === 1062;
}

function toNullableString(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function resolveClientIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((segment) => segment.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp.slice(0, 64);
    }
  }
  return String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 64);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      serializationError: "payload_json could not be serialized",
    });
  }
}

function buildCounterpartyType({ isCustomer, isVendor }) {
  if (isCustomer && isVendor) {
    return "BOTH";
  }
  if (isCustomer) {
    return "CUSTOMER";
  }
  if (isVendor) {
    return "VENDOR";
  }
  return "OTHER";
}

function parseCounterpartyTypeFlags(counterpartyType) {
  const normalized = String(counterpartyType || "")
    .trim()
    .toUpperCase();
  if (normalized === "BOTH") {
    return { isCustomer: true, isVendor: true };
  }
  if (normalized === "CUSTOMER") {
    return { isCustomer: true, isVendor: false };
  }
  if (normalized === "VENDOR") {
    return { isCustomer: false, isVendor: true };
  }
  return { isCustomer: false, isVendor: false };
}

function mapCounterpartyRow(row) {
  const flags = parseCounterpartyTypeFlags(row.counterparty_type);
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    code: row.code,
    name: row.name,
    counterpartyType: row.counterparty_type,
    isCustomer: flags.isCustomer,
    isVendor: flags.isVendor,
    taxId: row.tax_id || null,
    email: row.email || null,
    phone: row.phone || null,
    defaultCurrencyCode: row.default_currency_code || null,
    defaultPaymentTermId: parsePositiveInt(row.default_payment_term_id),
    defaultPaymentTermCode: row.default_payment_term_code || null,
    defaultPaymentTermName: row.default_payment_term_name || null,
    defaultContactId: parsePositiveInt(row.default_contact_id),
    defaultAddressId: parsePositiveInt(row.default_address_id),
    status: row.status,
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapContactRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    contactName: row.contact_name,
    email: row.email || null,
    phone: row.phone || null,
    title: row.title || null,
    isPrimary: parseDbBoolean(row.is_primary),
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapAddressRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    addressType: row.address_type,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 || null,
    city: row.city || null,
    stateRegion: row.state_region || null,
    postalCode: row.postal_code || null,
    countryId: parsePositiveInt(row.country_id),
    isPrimary: parseDbBoolean(row.is_primary),
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getCounterpartyBaseRow({
  tenantId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        c.*,
        pt.code AS default_payment_term_code,
        pt.name AS default_payment_term_name,
        (
          SELECT cc.id
          FROM counterparty_contacts cc
          WHERE cc.tenant_id = c.tenant_id
            AND cc.legal_entity_id = c.legal_entity_id
            AND cc.counterparty_id = c.id
            AND cc.is_primary = TRUE
          ORDER BY cc.id ASC
          LIMIT 1
        ) AS default_contact_id,
        (
          SELECT ca.id
          FROM counterparty_addresses ca
          WHERE ca.tenant_id = c.tenant_id
            AND ca.legal_entity_id = c.legal_entity_id
            AND ca.counterparty_id = c.id
            AND ca.is_primary = TRUE
          ORDER BY ca.id ASC
          LIMIT 1
        ) AS default_address_id
     FROM counterparties c
     LEFT JOIN payment_terms pt
       ON pt.tenant_id = c.tenant_id
      AND pt.legal_entity_id = c.legal_entity_id
      AND pt.id = c.default_payment_term_id
     WHERE c.tenant_id = ?
       AND c.id = ?
     LIMIT 1`,
    [tenantId, counterpartyId]
  );

  return result.rows?.[0] || null;
}

async function listContactRows({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        counterparty_id,
        contact_name,
        email,
        phone,
        title,
        is_primary,
        status,
        created_at,
        updated_at
     FROM counterparty_contacts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
     ORDER BY is_primary DESC, id ASC`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows || [];
}

async function listAddressRows({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        counterparty_id,
        address_type,
        address_line1,
        address_line2,
        city,
        state_region,
        postal_code,
        country_id,
        is_primary,
        status,
        created_at,
        updated_at
     FROM counterparty_addresses
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
     ORDER BY is_primary DESC, id ASC`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows || [];
}

async function assertPaymentTermBelongsToCounterpartyScope({
  tenantId,
  legalEntityId,
  defaultPaymentTermId,
  runQuery = query,
}) {
  if (!defaultPaymentTermId) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, code, name
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, defaultPaymentTermId]
  );
  if (!result.rows?.[0]) {
    throw badRequest("defaultPaymentTermId must belong to legalEntityId");
  }
  return result.rows[0];
}

async function assertCountryIdsExist(countryIds = []) {
  const uniqueIds = Array.from(
    new Set((Array.isArray(countryIds) ? countryIds : []).filter(Boolean))
  );
  for (const countryId of uniqueIds) {
    await assertCountryExists(countryId, "addresses[].countryId");
  }
}

async function insertAuditLog({
  req,
  runQuery = query,
  tenantId,
  userId,
  action,
  legalEntityId,
  counterpartyId,
  payload,
}) {
  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      userId || null,
      action,
      "counterparty",
      counterpartyId ? String(counterpartyId) : null,
      legalEntityId ? "LEGAL_ENTITY" : null,
      legalEntityId || null,
      toNullableString(req?.requestId || req?.headers?.["x-request-id"], 80),
      resolveClientIp(req),
      toNullableString(req?.headers?.["user-agent"], 255),
      safeStringify(payload || null),
    ]
  );
}

async function assertProvidedContactIdsBelong({
  tenantId,
  legalEntityId,
  counterpartyId,
  contactIds = [],
  runQuery,
}) {
  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (ids.length === 0) {
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id
     FROM counterparty_contacts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
       AND id IN (${placeholders})`,
    [tenantId, legalEntityId, counterpartyId, ...ids]
  );
  if ((result.rows || []).length !== ids.length) {
    throw badRequest("contacts[].id must belong to the selected counterparty");
  }
}

async function assertProvidedAddressIdsBelong({
  tenantId,
  legalEntityId,
  counterpartyId,
  addressIds = [],
  runQuery,
}) {
  const ids = Array.from(new Set((addressIds || []).filter(Boolean)));
  if (ids.length === 0) {
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id
     FROM counterparty_addresses
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
       AND id IN (${placeholders})`,
    [tenantId, legalEntityId, counterpartyId, ...ids]
  );
  if ((result.rows || []).length !== ids.length) {
    throw badRequest("addresses[].id must belong to the selected counterparty");
  }
}

async function insertContactRows({
  tenantId,
  legalEntityId,
  counterpartyId,
  contacts = [],
  runQuery,
}) {
  const insertedIds = [];
  for (const row of contacts) {
    const result = await runQuery(
      `INSERT INTO counterparty_contacts (
          tenant_id,
          legal_entity_id,
          counterparty_id,
          contact_name,
          email,
          phone,
          title,
          is_primary,
          status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        row.contactName,
        row.email,
        row.phone,
        row.title,
        row.isPrimary ? 1 : 0,
        row.status,
      ]
    );
    insertedIds.push(parsePositiveInt(result.rows?.insertId));
  }
  return insertedIds.filter(Boolean);
}

async function insertAddressRows({
  tenantId,
  legalEntityId,
  counterpartyId,
  addresses = [],
  runQuery,
}) {
  const insertedIds = [];
  for (const row of addresses) {
    const result = await runQuery(
      `INSERT INTO counterparty_addresses (
          tenant_id,
          legal_entity_id,
          counterparty_id,
          address_type,
          address_line1,
          address_line2,
          city,
          state_region,
          postal_code,
          country_id,
          is_primary,
          status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        row.addressType,
        row.addressLine1,
        row.addressLine2,
        row.city,
        row.stateRegion,
        row.postalCode,
        row.countryId,
        row.isPrimary ? 1 : 0,
        row.status,
      ]
    );
    insertedIds.push(parsePositiveInt(result.rows?.insertId));
  }
  return insertedIds.filter(Boolean);
}

async function applyContactMutations({
  tenantId,
  legalEntityId,
  counterpartyId,
  contacts,
  defaultContactId,
  runQuery,
}) {
  if (contacts === undefined && defaultContactId === undefined) {
    return;
  }

  const providedIds = (Array.isArray(contacts) ? contacts : [])
    .map((row) => row.id)
    .filter(Boolean);
  if (providedIds.length > 0) {
    await assertProvidedContactIdsBelong({
      tenantId,
      legalEntityId,
      counterpartyId,
      contactIds: providedIds,
      runQuery,
    });
  }

  const hasPrimaryInPayload = Array.isArray(contacts)
    ? contacts.some((row) => row.isPrimary)
    : false;

  if (hasPrimaryInPayload || defaultContactId !== undefined) {
    await runQuery(
      `UPDATE counterparty_contacts
       SET is_primary = FALSE
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND counterparty_id = ?`,
      [tenantId, legalEntityId, counterpartyId]
    );
  }

  if (Array.isArray(contacts)) {
    for (const row of contacts) {
      if (row.id) {
        await runQuery(
          `UPDATE counterparty_contacts
           SET contact_name = ?,
               email = ?,
               phone = ?,
               title = ?,
               is_primary = ?,
               status = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND counterparty_id = ?
             AND id = ?`,
          [
            row.contactName,
            row.email,
            row.phone,
            row.title,
            row.isPrimary ? 1 : 0,
            row.status,
            tenantId,
            legalEntityId,
            counterpartyId,
            row.id,
          ]
        );
      } else {
        await runQuery(
          `INSERT INTO counterparty_contacts (
              tenant_id,
              legal_entity_id,
              counterparty_id,
              contact_name,
              email,
              phone,
              title,
              is_primary,
              status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            counterpartyId,
            row.contactName,
            row.email,
            row.phone,
            row.title,
            row.isPrimary ? 1 : 0,
            row.status,
          ]
        );
      }
    }
  }

  if (defaultContactId !== undefined) {
    if (!defaultContactId) {
      await runQuery(
        `UPDATE counterparty_contacts
         SET is_primary = FALSE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?`,
        [tenantId, legalEntityId, counterpartyId]
      );
    } else {
      const existsResult = await runQuery(
        `SELECT id
         FROM counterparty_contacts
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?
           AND id = ?
         LIMIT 1`,
        [tenantId, legalEntityId, counterpartyId, defaultContactId]
      );
      if (!existsResult.rows?.[0]) {
        throw badRequest(
          "defaultContactId must reference a contact in the same counterparty"
        );
      }

      await runQuery(
        `UPDATE counterparty_contacts
         SET is_primary = FALSE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?`,
        [tenantId, legalEntityId, counterpartyId]
      );
      await runQuery(
        `UPDATE counterparty_contacts
         SET is_primary = TRUE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?
           AND id = ?`,
        [tenantId, legalEntityId, counterpartyId, defaultContactId]
      );
    }
  }

  const primaryResult = await runQuery(
    `SELECT COUNT(*) AS row_count
     FROM counterparty_contacts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
       AND is_primary = TRUE`,
    [tenantId, legalEntityId, counterpartyId]
  );
  const primaryCount = Number(primaryResult.rows?.[0]?.row_count || 0);
  if (primaryCount > 1) {
    throw badRequest("Counterparty can have only one primary contact");
  }
}

async function applyAddressMutations({
  tenantId,
  legalEntityId,
  counterpartyId,
  addresses,
  defaultAddressId,
  runQuery,
}) {
  if (addresses === undefined && defaultAddressId === undefined) {
    return;
  }

  const providedIds = (Array.isArray(addresses) ? addresses : [])
    .map((row) => row.id)
    .filter(Boolean);
  if (providedIds.length > 0) {
    await assertProvidedAddressIdsBelong({
      tenantId,
      legalEntityId,
      counterpartyId,
      addressIds: providedIds,
      runQuery,
    });
  }

  const hasPrimaryInPayload = Array.isArray(addresses)
    ? addresses.some((row) => row.isPrimary)
    : false;

  if (hasPrimaryInPayload || defaultAddressId !== undefined) {
    await runQuery(
      `UPDATE counterparty_addresses
       SET is_primary = FALSE
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND counterparty_id = ?`,
      [tenantId, legalEntityId, counterpartyId]
    );
  }

  if (Array.isArray(addresses)) {
    for (const row of addresses) {
      if (row.id) {
        await runQuery(
          `UPDATE counterparty_addresses
           SET address_type = ?,
               address_line1 = ?,
               address_line2 = ?,
               city = ?,
               state_region = ?,
               postal_code = ?,
               country_id = ?,
               is_primary = ?,
               status = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND counterparty_id = ?
             AND id = ?`,
          [
            row.addressType,
            row.addressLine1,
            row.addressLine2,
            row.city,
            row.stateRegion,
            row.postalCode,
            row.countryId,
            row.isPrimary ? 1 : 0,
            row.status,
            tenantId,
            legalEntityId,
            counterpartyId,
            row.id,
          ]
        );
      } else {
        await runQuery(
          `INSERT INTO counterparty_addresses (
              tenant_id,
              legal_entity_id,
              counterparty_id,
              address_type,
              address_line1,
              address_line2,
              city,
              state_region,
              postal_code,
              country_id,
              is_primary,
              status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            counterpartyId,
            row.addressType,
            row.addressLine1,
            row.addressLine2,
            row.city,
            row.stateRegion,
            row.postalCode,
            row.countryId,
            row.isPrimary ? 1 : 0,
            row.status,
          ]
        );
      }
    }
  }

  if (defaultAddressId !== undefined) {
    if (!defaultAddressId) {
      await runQuery(
        `UPDATE counterparty_addresses
         SET is_primary = FALSE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?`,
        [tenantId, legalEntityId, counterpartyId]
      );
    } else {
      const existsResult = await runQuery(
        `SELECT id
         FROM counterparty_addresses
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?
           AND id = ?
         LIMIT 1`,
        [tenantId, legalEntityId, counterpartyId, defaultAddressId]
      );
      if (!existsResult.rows?.[0]) {
        throw badRequest(
          "defaultAddressId must reference an address in the same counterparty"
        );
      }

      await runQuery(
        `UPDATE counterparty_addresses
         SET is_primary = FALSE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?`,
        [tenantId, legalEntityId, counterpartyId]
      );
      await runQuery(
        `UPDATE counterparty_addresses
         SET is_primary = TRUE
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND counterparty_id = ?
           AND id = ?`,
        [tenantId, legalEntityId, counterpartyId, defaultAddressId]
      );
    }
  }

  const primaryResult = await runQuery(
    `SELECT COUNT(*) AS row_count
     FROM counterparty_addresses
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
       AND is_primary = TRUE`,
    [tenantId, legalEntityId, counterpartyId]
  );
  const primaryCount = Number(primaryResult.rows?.[0]?.row_count || 0);
  if (primaryCount > 1) {
    throw badRequest("Counterparty can have only one primary address");
  }
}

async function fetchCounterpartyDetail({
  tenantId,
  counterpartyId,
  runQuery = query,
}) {
  const baseRow = await getCounterpartyBaseRow({
    tenantId,
    counterpartyId,
    runQuery,
  });
  if (!baseRow) {
    return null;
  }

  const [contactRows, addressRows] = await Promise.all([
    listContactRows({
      tenantId,
      legalEntityId: baseRow.legal_entity_id,
      counterpartyId,
      runQuery,
    }),
    listAddressRows({
      tenantId,
      legalEntityId: baseRow.legal_entity_id,
      counterpartyId,
      runQuery,
    }),
  ]);

  const row = mapCounterpartyRow(baseRow);
  const contacts = contactRows.map(mapContactRow);
  const addresses = addressRows.map(mapAddressRow);

  return {
    ...row,
    contacts,
    addresses,
    defaults: {
      paymentTermId: row.defaultPaymentTermId,
      contactId: row.defaultContactId,
      addressId: row.defaultAddressId,
    },
  };
}

export async function resolveCounterpartyScope(counterpartyId, tenantId) {
  const parsedCounterpartyId = parsePositiveInt(counterpartyId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedCounterpartyId || !parsedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM counterparties
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsedTenantId, parsedCounterpartyId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listCounterpartyRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["c.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "c.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("c.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }

  if (filters.status) {
    conditions.push("c.status = ?");
    params.push(filters.status);
  }

  if (filters.role === "CUSTOMER") {
    conditions.push("c.counterparty_type IN ('CUSTOMER', 'BOTH')");
  } else if (filters.role === "VENDOR") {
    conditions.push("c.counterparty_type IN ('VENDOR', 'BOTH')");
  } else if (filters.role === "BOTH") {
    conditions.push("c.counterparty_type = 'BOTH'");
  }

  if (filters.q) {
    conditions.push("(c.code LIKE ? OR c.name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const whereSql = conditions.join(" AND ");
  const totalResult = await query(
    `SELECT COUNT(*) AS row_count
     FROM counterparties c
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.row_count || 0);

  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 50;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const result = await query(
    `SELECT
        c.*,
        pt.code AS default_payment_term_code,
        pt.name AS default_payment_term_name,
        (
          SELECT cc.id
          FROM counterparty_contacts cc
          WHERE cc.tenant_id = c.tenant_id
            AND cc.legal_entity_id = c.legal_entity_id
            AND cc.counterparty_id = c.id
            AND cc.is_primary = TRUE
          ORDER BY cc.id ASC
          LIMIT 1
        ) AS default_contact_id,
        (
          SELECT ca.id
          FROM counterparty_addresses ca
          WHERE ca.tenant_id = c.tenant_id
            AND ca.legal_entity_id = c.legal_entity_id
            AND ca.counterparty_id = c.id
            AND ca.is_primary = TRUE
          ORDER BY ca.id ASC
          LIMIT 1
        ) AS default_address_id
     FROM counterparties c
     LEFT JOIN payment_terms pt
       ON pt.tenant_id = c.tenant_id
      AND pt.legal_entity_id = c.legal_entity_id
      AND pt.id = c.default_payment_term_id
     WHERE ${whereSql}
     ORDER BY c.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCounterpartyRow),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getCounterpartyByIdForTenant({
  req,
  tenantId,
  counterpartyId,
  assertScopeAccess,
}) {
  const row = await fetchCounterpartyDetail({
    tenantId,
    counterpartyId,
  });
  if (!row) {
    throw badRequest("Counterparty not found");
  }

  assertScopeAccess(req, "legal_entity", row.legalEntityId, "id");
  return row;
}

export async function createCounterparty({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const legalEntityId = payload.legalEntityId;
  const counterpartyType = buildCounterpartyType({
    isCustomer: payload.isCustomer,
    isVendor: payload.isVendor,
  });
  if (counterpartyType === "OTHER") {
    throw badRequest("At least one of isCustomer or isVendor must be true");
  }

  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

  if (payload.defaultCurrencyCode) {
    await assertCurrencyExists(payload.defaultCurrencyCode, "defaultCurrencyCode");
  }
  await assertPaymentTermBelongsToCounterpartyScope({
    tenantId,
    legalEntityId,
    defaultPaymentTermId: payload.defaultPaymentTermId,
  });

  await assertCountryIdsExist((payload.addresses || []).map((row) => row.countryId));

  try {
    const created = await withTransaction(async (tx) => {
      const insertResult = await tx.query(
        `INSERT INTO counterparties (
            tenant_id,
            legal_entity_id,
            code,
            name,
            counterparty_type,
            tax_id,
            email,
            phone,
            default_currency_code,
            default_payment_term_id,
            status,
            notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          payload.code,
          payload.name,
          counterpartyType,
          payload.taxId,
          payload.email,
          payload.phone,
          payload.defaultCurrencyCode,
          payload.defaultPaymentTermId,
          payload.status,
          payload.notes,
        ]
      );
      const counterpartyId = parsePositiveInt(insertResult.rows?.insertId);
      if (!counterpartyId) {
        throw new Error("Counterparty create failed");
      }

      if (Array.isArray(payload.contacts) && payload.contacts.length > 0) {
        await insertContactRows({
          tenantId,
          legalEntityId,
          counterpartyId,
          contacts: payload.contacts,
          runQuery: tx.query,
        });
      }

      if (Array.isArray(payload.addresses) && payload.addresses.length > 0) {
        await insertAddressRows({
          tenantId,
          legalEntityId,
          counterpartyId,
          addresses: payload.addresses,
          runQuery: tx.query,
        });
      }

      const row = await fetchCounterpartyDetail({
        tenantId,
        counterpartyId,
        runQuery: tx.query,
      });
      if (!row) {
        throw new Error("Counterparty create readback failed");
      }

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.counterparty.create",
        legalEntityId,
        counterpartyId,
        payload: {
          code: row.code,
          status: row.status,
          counterpartyType: row.counterpartyType,
        },
      });

      return row;
    });

    return created;
  } catch (err) {
    if (isDuplicateConstraintError(err)) {
      throw badRequest(
        "Counterparty code must be unique within tenant and legalEntityId"
      );
    }
    throw err;
  }
}

export async function updateCounterpartyById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const counterpartyId = payload.counterpartyId;

  const existing = await getCounterpartyBaseRow({
    tenantId,
    counterpartyId,
  });
  if (!existing) {
    throw badRequest("Counterparty not found");
  }

  const existingLegalEntityId = parsePositiveInt(existing.legal_entity_id);
  assertScopeAccess(req, "legal_entity", existingLegalEntityId, "id");

  if (payload.legalEntityId && payload.legalEntityId !== existingLegalEntityId) {
    throw badRequest("legalEntityId cannot be changed for existing counterparty");
  }
  const legalEntityId = existingLegalEntityId;

  const currentFlags = parseCounterpartyTypeFlags(existing.counterparty_type);
  const nextIsCustomer =
    payload.isCustomer === null ? currentFlags.isCustomer : payload.isCustomer;
  const nextIsVendor =
    payload.isVendor === null ? currentFlags.isVendor : payload.isVendor;
  if (!nextIsCustomer && !nextIsVendor) {
    throw badRequest("At least one of isCustomer or isVendor must be true");
  }
  const nextCounterpartyType = buildCounterpartyType({
    isCustomer: nextIsCustomer,
    isVendor: nextIsVendor,
  });

  if (payload.defaultCurrencyCode !== undefined && payload.defaultCurrencyCode) {
    await assertCurrencyExists(payload.defaultCurrencyCode, "defaultCurrencyCode");
  }

  const nextDefaultPaymentTermId =
    payload.defaultPaymentTermId === undefined
      ? parsePositiveInt(existing.default_payment_term_id)
      : payload.defaultPaymentTermId;
  await assertPaymentTermBelongsToCounterpartyScope({
    tenantId,
    legalEntityId,
    defaultPaymentTermId: nextDefaultPaymentTermId,
  });

  const addressRows = Array.isArray(payload.addresses) ? payload.addresses : [];
  await assertCountryIdsExist(addressRows.map((row) => row.countryId));

  const nextCode = payload.code === null ? existing.code : payload.code || existing.code;
  const nextName = payload.name === null ? existing.name : payload.name || existing.name;
  const nextStatus = payload.status || existing.status;
  const nextTaxId = payload.taxId !== undefined ? payload.taxId : existing.tax_id;
  const nextEmail = payload.email !== undefined ? payload.email : existing.email;
  const nextPhone = payload.phone !== undefined ? payload.phone : existing.phone;
  const nextNotes = payload.notes !== undefined ? payload.notes : existing.notes;
  const nextCurrencyCode =
    payload.defaultCurrencyCode !== undefined
      ? payload.defaultCurrencyCode
      : existing.default_currency_code;

  try {
    const updated = await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE counterparties
         SET code = ?,
             name = ?,
             counterparty_type = ?,
             tax_id = ?,
             email = ?,
             phone = ?,
             default_currency_code = ?,
             default_payment_term_id = ?,
             status = ?,
             notes = ?
         WHERE tenant_id = ?
           AND id = ?`,
        [
          nextCode,
          nextName,
          nextCounterpartyType,
          nextTaxId,
          nextEmail,
          nextPhone,
          nextCurrencyCode,
          nextDefaultPaymentTermId,
          nextStatus,
          nextNotes,
          tenantId,
          counterpartyId,
        ]
      );

      await applyContactMutations({
        tenantId,
        legalEntityId,
        counterpartyId,
        contacts: payload.contacts,
        defaultContactId: payload.defaultContactId,
        runQuery: tx.query,
      });

      await applyAddressMutations({
        tenantId,
        legalEntityId,
        counterpartyId,
        addresses: payload.addresses,
        defaultAddressId: payload.defaultAddressId,
        runQuery: tx.query,
      });

      const row = await fetchCounterpartyDetail({
        tenantId,
        counterpartyId,
        runQuery: tx.query,
      });
      if (!row) {
        throw new Error("Counterparty update readback failed");
      }

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.counterparty.update",
        legalEntityId,
        counterpartyId,
        payload: {
          before: {
            code: existing.code,
            name: existing.name,
            status: existing.status,
            counterpartyType: existing.counterparty_type,
            defaultPaymentTermId: parsePositiveInt(existing.default_payment_term_id),
          },
          after: {
            code: row.code,
            name: row.name,
            status: row.status,
            counterpartyType: row.counterpartyType,
            defaultPaymentTermId: row.defaultPaymentTermId,
            defaultContactId: row.defaultContactId,
            defaultAddressId: row.defaultAddressId,
          },
        },
      });

      return row;
    });

    return updated;
  } catch (err) {
    if (isDuplicateConstraintError(err)) {
      throw badRequest(
        "Counterparty code must be unique within tenant and legalEntityId"
      );
    }
    throw err;
  }
}
