# PR-B01: Bank Foundation (Master Data + GL Link)

    ## Goal

    Introduce **Bank Accounts** as a first-class module with strict GL linkage (no statement import/reconciliation yet).

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m021_bank_foundation.js`
    * `backend/src/routes/bank.accounts.js`
    * `backend/src/routes/bank.accounts.validators.js`
    * `backend/src/services/bank.accounts.service.js`
    * `backend/scripts/test-bank-prb01-foundation.js`

    ### Frontend

    * `frontend/src/api/bankAccounts.js`
    * `frontend/src/pages/bank/BankAccountsPage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js` (permissions seed)
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m021_bank_foundation.js`

    > Assumes MySQL 8 + your migration style (`up/down` with `db.query` or similar). Adjust helper names to your project’s migration runner.

    ```js
    // backend/src/migrations/m021_bank_foundation.js

    module.exports = {
    id: "m021_bank_foundation",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            code VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            currency_code CHAR(3) NOT NULL,
            gl_account_id BIGINT UNSIGNED NOT NULL,
            bank_name VARCHAR(255) NULL,
            branch_name VARCHAR(255) NULL,
            iban VARCHAR(64) NULL,
            account_no VARCHAR(64) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_bank_accounts_code (code),
            UNIQUE KEY uq_bank_accounts_gl_account_id (gl_account_id),
            KEY idx_bank_accounts_active (is_active),
            KEY idx_bank_accounts_currency (currency_code),
            CONSTRAINT fk_bank_accounts_gl_account
            FOREIGN KEY (gl_account_id) REFERENCES accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS bank_accounts;`);
    },
    };
    ```

    ### Notes

    * `UNIQUE(gl_account_id)` enforces **1 bank account ↔ 1 GL bank account** in v1.
    * `is_active` allows soft lifecycle (don’t delete historical bank accounts).

    ---

    ## 2) Validators — `backend/src/routes/bank.accounts.validators.js`

    > Keep it aligned with your existing validator pattern (`zod`, `joi`, or custom). Here’s a neutral shape.

    ```js
    // backend/src/routes/bank.accounts.validators.js

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function requireCode(code) {
    const v = normalizeString(code);
    if (!v) throw new Error("code is required");
    return v.toUpperCase();
    }

    function requireName(name) {
    const v = normalizeString(name);
    if (!v) throw new Error("name is required");
    return v;
    }

    function requireCurrency(currency) {
    const v = normalizeString(currency);
    if (!v || v.length !== 3) throw new Error("currency_code must be 3 chars");
    return v.toUpperCase();
    }

    function requirePositiveInt(value, fieldName) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${fieldName} must be positive integer`);
    return n;
    }

    function validateCreateBankAccount(body = {}) {
    return {
        code: requireCode(body.code),
        name: requireName(body.name),
        currency_code: requireCurrency(body.currency_code),
        gl_account_id: requirePositiveInt(body.gl_account_id, "gl_account_id"),
        bank_name: normalizeString(body.bank_name),
        branch_name: normalizeString(body.branch_name),
        iban: normalizeString(body.iban),
        account_no: normalizeString(body.account_no),
    };
    }

    function validateUpdateBankAccount(body = {}) {
    return {
        name: body.name !== undefined ? requireName(body.name) : undefined,
        currency_code: body.currency_code !== undefined ? requireCurrency(body.currency_code) : undefined,
        gl_account_id: body.gl_account_id !== undefined ? requirePositiveInt(body.gl_account_id, "gl_account_id") : undefined,
        bank_name: body.bank_name !== undefined ? normalizeString(body.bank_name) : undefined,
        branch_name: body.branch_name !== undefined ? normalizeString(body.branch_name) : undefined,
        iban: body.iban !== undefined ? normalizeString(body.iban) : undefined,
        account_no: body.account_no !== undefined ? normalizeString(body.account_no) : undefined,
    };
    }

    function validateIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    module.exports = {
    validateCreateBankAccount,
    validateUpdateBankAccount,
    validateIdParam,
    };
    ```

    ---

    ## 3) Service — `backend/src/services/bank.accounts.service.js`

    > Keep business rules here (GL linkage, uniqueness, active/inactive).

    ```js
    // backend/src/services/bank.accounts.service.js

    async function listBankAccounts(db, { includeInactive = true } = {}) {
    const params = [];
    let sql = `
        SELECT
        b.id, b.code, b.name, b.currency_code, b.gl_account_id,
        b.bank_name, b.branch_name, b.iban, b.account_no,
        b.is_active, b.created_at, b.updated_at,
        a.code AS gl_account_code,
        a.name AS gl_account_name
        FROM bank_accounts b
        LEFT JOIN accounts a ON a.id = b.gl_account_id
    `;
    if (!includeInactive) {
        sql += ` WHERE b.is_active = 1`;
    }
    sql += ` ORDER BY b.code ASC`;

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function getBankAccountById(db, id) {
    const [rows] = await db.query(
        `
        SELECT
        b.id, b.code, b.name, b.currency_code, b.gl_account_id,
        b.bank_name, b.branch_name, b.iban, b.account_no,
        b.is_active, b.created_at, b.updated_at,
        a.code AS gl_account_code,
        a.name AS gl_account_name
        FROM bank_accounts b
        LEFT JOIN accounts a ON a.id = b.gl_account_id
        WHERE b.id = ?
        LIMIT 1
        `,
        [id]
    );
    return rows[0] || null;
    }

    async function assertGlAccountExists(db, glAccountId) {
    const [rows] = await db.query(
        `SELECT id, code, name FROM accounts WHERE id = ? LIMIT 1`,
        [glAccountId]
    );
    if (!rows[0]) {
        const err = new Error("GL account not found");
        err.statusCode = 400;
        throw err;
    }
    }

    async function createBankAccount(db, payload, userId = null) {
    await assertGlAccountExists(db, payload.gl_account_id);

    try {
        const [result] = await db.query(
        `
        INSERT INTO bank_accounts
        (code, name, currency_code, gl_account_id, bank_name, branch_name, iban, account_no, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `,
        [
            payload.code,
            payload.name,
            payload.currency_code,
            payload.gl_account_id,
            payload.bank_name,
            payload.branch_name,
            payload.iban,
            payload.account_no,
            userId,
        ]
        );
        return getBankAccountById(db, result.insertId);
    } catch (e) {
        if (e && e.code === "ER_DUP_ENTRY") {
        const err = new Error("Duplicate bank code or GL account link");
        err.statusCode = 409;
        throw err;
        }
        throw e;
    }
    }

    async function updateBankAccount(db, id, patch) {
    const existing = await getBankAccountById(db, id);
    if (!existing) {
        const err = new Error("Bank account not found");
        err.statusCode = 404;
        throw err;
    }

    if (patch.gl_account_id !== undefined) {
        await assertGlAccountExists(db, patch.gl_account_id);
    }

    const next = {
        name: patch.name ?? existing.name,
        currency_code: patch.currency_code ?? existing.currency_code,
        gl_account_id: patch.gl_account_id ?? existing.gl_account_id,
        bank_name: patch.bank_name ?? existing.bank_name,
        branch_name: patch.branch_name ?? existing.branch_name,
        iban: patch.iban ?? existing.iban,
        account_no: patch.account_no ?? existing.account_no,
    };

    try {
        await db.query(
        `
        UPDATE bank_accounts
        SET name = ?, currency_code = ?, gl_account_id = ?,
            bank_name = ?, branch_name = ?, iban = ?, account_no = ?
        WHERE id = ?
        `,
        [
            next.name,
            next.currency_code,
            next.gl_account_id,
            next.bank_name,
            next.branch_name,
            next.iban,
            next.account_no,
            id,
        ]
        );
        return getBankAccountById(db, id);
    } catch (e) {
        if (e && e.code === "ER_DUP_ENTRY") {
        const err = new Error("Duplicate GL account link");
        err.statusCode = 409;
        throw err;
        }
        throw e;
    }
    }

    async function setBankAccountActive(db, id, isActive) {
    const existing = await getBankAccountById(db, id);
    if (!existing) {
        const err = new Error("Bank account not found");
        err.statusCode = 404;
        throw err;
    }

    await db.query(`UPDATE bank_accounts SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
    return getBankAccountById(db, id);
    }

    module.exports = {
    listBankAccounts,
    getBankAccountById,
    createBankAccount,
    updateBankAccount,
    setBankAccountActive,
    };
    ```

    ---

    ## 4) Routes — `backend/src/routes/bank.accounts.js`

    > Keep route-level permission checks here (same pattern you use in other modules).

    ```js
    // backend/src/routes/bank.accounts.js

    const express = require("express");
    const {
    validateCreateBankAccount,
    validateUpdateBankAccount,
    validateIdParam,
    } = require("./bank.accounts.validators");
    const service = require("../services/bank.accounts.service");

    // Replace these with your project helpers:
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/bank/accounts
    router.get(
    "/accounts",
    requireAuth,
    requirePermission("bank.accounts.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const includeInactive = req.query.include_inactive !== "0";
        const rows = await service.listBankAccounts(db, { includeInactive });
        res.json({ items: rows });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/accounts/:id
    router.get(
    "/accounts/:id",
    requireAuth,
    requirePermission("bank.accounts.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.getBankAccountById(db, id);
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/accounts
    router.post(
    "/accounts",
    requireAuth,
    requirePermission("bank.accounts.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const payload = validateCreateBankAccount(req.body);
        const userId = req.user?.id ?? null;
        const created = await service.createBankAccount(db, payload, userId);
        res.status(201).json(created);
        } catch (err) {
        next(err);
        }
    }
    );

    // PUT /api/v1/bank/accounts/:id
    router.put(
    "/accounts/:id",
    requireAuth,
    requirePermission("bank.accounts.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const patch = validateUpdateBankAccount(req.body);
        const updated = await service.updateBankAccount(db, id, patch);
        res.json(updated);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/accounts/:id/activate
    router.post(
    "/accounts/:id/activate",
    requireAuth,
    requirePermission("bank.accounts.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.setBankAccountActive(db, id, true);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/accounts/:id/deactivate
    router.post(
    "/accounts/:id/deactivate",
    requireAuth,
    requirePermission("bank.accounts.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.setBankAccountActive(db, id, false);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 5) Mount route — `backend/src/index.js`

    Add the bank router mount (same pattern as your other modules):

    ```js
    // backend/src/index.js
    const bankAccountsRoutes = require("./routes/bank.accounts");

    // ...
    app.use("/api/v1/bank", bankAccountsRoutes);
    ```

    ---

    ## 6) Migration registry — `backend/src/migrations/index.js`

    Add the migration in order:

    ```js
    // backend/src/migrations/index.js
    const m021_bank_foundation = require("./m021_bank_foundation");

    module.exports = [
    // ...
    m021_bank_foundation,
    ];
    ```

    ---

    ## 7) Seed permissions — `backend/src/seedCore.js`

    Add permissions so UI/backend can enforce them:

    ```js
    // backend/src/seedCore.js (where you seed permissions)
    const BANK_PERMISSIONS = [
    "bank.accounts.read",
    "bank.accounts.write",
    ];

    // merge with your existing permissions seed list
    ```

    ---

    ## 8) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Add bank endpoints to your spec generation map (shape depends on your script).
    Minimum paths to register:

    * `GET /api/v1/bank/accounts`
    * `GET /api/v1/bank/accounts/{id}`
    * `POST /api/v1/bank/accounts`
    * `PUT /api/v1/bank/accounts/{id}`
    * `POST /api/v1/bank/accounts/{id}/activate`
    * `POST /api/v1/bank/accounts/{id}/deactivate`

    If your script is route-driven, just make sure this router is included.

    ---

    ## 9) Backend smoke test — `backend/scripts/test-bank-prb01-foundation.js`

    > Keep it small and deterministic: create + duplicate check + activate/deactivate + list.

    ```js
    // backend/scripts/test-bank-prb01-foundation.js

    async function main() {
    // Pseudocode: adapt to your test helpers / supertest setup
    // 1) Ensure migration is applied
    // 2) Create/find a GL account to link (use seeded bank-type account if available)
    // 3) POST /api/v1/bank/accounts
    // 4) GET list and assert created row exists
    // 5) POST duplicate code -> expect 409
    // 6) POST same gl_account_id on another code -> expect 409
    // 7) POST deactivate, then activate -> status flips
    console.log("PR-B01 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    If you already use `supertest`, make this a real endpoint test script immediately.

    ---

    ## 10) `backend/package.json` scripts

    Add a smoke test command:

    ```json
    {
    "scripts": {
        "test:bank:prb01": "node backend/scripts/test-bank-prb01-foundation.js"
    }
    }
    ```

    (Adjust path if your `package.json` is inside `/backend` already)

    ---

    # Frontend skeletons

    ## 11) API client — `frontend/src/api/bankAccounts.js`

    Follow your existing API modules style (`fetch`, `request`, axios, etc.). Here’s a generic fetch-based shape:

    ```js
    // frontend/src/api/bankAccounts.js

    import { apiFetch } from "./client"; // adapt to your actual client helper

    export function listBankAccounts(params = {}) {
    const q = new URLSearchParams();
    if (params.include_inactive !== undefined) {
        q.set("include_inactive", params.include_inactive ? "1" : "0");
    }
    const qs = q.toString();
    return apiFetch(`/api/v1/bank/accounts${qs ? `?${qs}` : ""}`);
    }

    export function getBankAccount(id) {
    return apiFetch(`/api/v1/bank/accounts/${id}`);
    }

    export function createBankAccount(payload) {
    return apiFetch(`/api/v1/bank/accounts`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function updateBankAccount(id, payload) {
    return apiFetch(`/api/v1/bank/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
    }

    export function activateBankAccount(id) {
    return apiFetch(`/api/v1/bank/accounts/${id}/activate`, {
        method: "POST",
    });
    }

    export function deactivateBankAccount(id) {
    return apiFetch(`/api/v1/bank/accounts/${id}/deactivate`, {
        method: "POST",
    });
    }
    ```

    ---

    ## 12) Page — `frontend/src/pages/bank/BankAccountsPage.jsx`

    > Start simple: table + create form. Edit can be phase 2 on same page or modal later.

    ```jsx
    // frontend/src/pages/bank/BankAccountsPage.jsx

    import { useEffect, useState } from "react";
    import {
    listBankAccounts,
    createBankAccount,
    activateBankAccount,
    deactivateBankAccount,
    } from "../../api/bankAccounts";

    const emptyForm = {
    code: "",
    name: "",
    currency_code: "USD",
    gl_account_id: "",
    bank_name: "",
    branch_name: "",
    iban: "",
    account_no: "",
    };

    export default function BankAccountsPage() {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    async function load() {
        setLoading(true);
        setErr("");
        try {
        const res = await listBankAccounts({ include_inactive: true });
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load bank accounts");
        } finally {
        setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function onSubmit(e) {
        e.preventDefault();
        setErr("");
        try {
        await createBankAccount({
            ...form,
            gl_account_id: Number(form.gl_account_id),
        });
        setForm(emptyForm);
        await load();
        } catch (e) {
        setErr(e.message || "Create failed");
        }
    }

    async function onToggleActive(row) {
        try {
        if (row.is_active) await deactivateBankAccount(row.id);
        else await activateBankAccount(row.id);
        await load();
        } catch (e) {
        setErr(e.message || "Status update failed");
        }
    }

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <h1 className="text-lg font-semibold mb-3">Bank Accounts</h1>

            {err ? <div className="mb-3 text-sm text-red-600">{err}</div> : null}

            <form className="grid grid-cols-1 md:grid-cols-4 gap-2" onSubmit={onSubmit}>
            <input
                className="border rounded px-2 py-1"
                placeholder="Code"
                value={form.code}
                onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Currency (USD)"
                value={form.currency_code}
                onChange={(e) => setForm((s) => ({ ...s, currency_code: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="GL Account ID"
                value={form.gl_account_id}
                onChange={(e) => setForm((s) => ({ ...s, gl_account_id: e.target.value }))}
            />

            <input
                className="border rounded px-2 py-1"
                placeholder="Bank Name"
                value={form.bank_name}
                onChange={(e) => setForm((s) => ({ ...s, bank_name: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Branch"
                value={form.branch_name}
                onChange={(e) => setForm((s) => ({ ...s, branch_name: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="IBAN"
                value={form.iban}
                onChange={(e) => setForm((s) => ({ ...s, iban: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Account No"
                value={form.account_no}
                onChange={(e) => setForm((s) => ({ ...s, account_no: e.target.value }))}
            />

            <div className="md:col-span-4">
                <button className="px-3 py-1 rounded bg-black text-white" type="submit">
                Create Bank Account
                </button>
            </div>
            </form>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">List</h2>

            {loading ? (
            <div>Loading...</div>
            ) : (
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Code</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Currency</th>
                    <th className="text-left p-2">GL Link</th>
                    <th className="text-left p-2">Bank</th>
                    <th className="text-left p-2">Active</th>
                    <th className="text-left p-2">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((row) => (
                    <tr key={row.id} className="border-b">
                        <td className="p-2">{row.code}</td>
                        <td className="p-2">{row.name}</td>
                        <td className="p-2">{row.currency_code}</td>
                        <td className="p-2">
                        {row.gl_account_code} - {row.gl_account_name}
                        </td>
                        <td className="p-2">{row.bank_name || "-"}</td>
                        <td className="p-2">{row.is_active ? "Yes" : "No"}</td>
                        <td className="p-2">
                        <button
                            className="underline"
                            onClick={() => onToggleActive(row)}
                            type="button"
                        >
                            {row.is_active ? "Deactivate" : "Activate"}
                        </button>
                        </td>
                    </tr>
                    ))}
                    {items.length === 0 && (
                    <tr>
                        <td className="p-2" colSpan={7}>
                        No bank accounts yet.
                        </td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
            )}
        </div>
        </div>
    );
    }
    ```

    ---

    ## 13) App route — `frontend/src/App.jsx`

    Add the route (and permission guard if you use `RequirePermission`):

    ```jsx
    // frontend/src/App.jsx
    import BankAccountsPage from "./pages/bank/BankAccountsPage";

    // ...
    <Route
    path="/bank/accounts"
    element={
        <RequirePermission permission="bank.accounts.read">
        <BankAccountsPage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 14) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    Add a Bank section + page item using your canonical permission semantic:

    ```js
    // frontend/src/layouts/sidebarConfig.js
    {
    key: "bank",
    label: "Bank",
    children: [
        {
        key: "bank-accounts",
        label: "Bank Accounts",
        to: "/bank/accounts",
        permission: "bank.accounts.read",
        },
    ],
    }
    ```

    ---

    ## 15) i18n — `frontend/src/i18n/messages.js`

    Add minimal labels (or Turkish equivalents if you’re using tr-first):

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.bank": "Bank",
    "sidebar.bankAccounts": "Bank Accounts",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Can create bank account only with a valid `gl_account_id`.
    * ✅ Duplicate `code` is blocked.
    * ✅ Duplicate `gl_account_id` link is blocked (v1 one-to-one rule).
    * ✅ Bank account can be activated/deactivated.
    * ✅ Inactive accounts are still listable.
    * ✅ Route + UI permission checks use `bank.accounts.read/write`.
    * ✅ OpenAPI is updated for all new endpoints.
    * ✅ Smoke test script exists and runs.

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:bank:prb01`

    Should verify at least:

    1. **Create success**

    * POST valid payload → `201`
    * response includes `id`, `code`, `gl_account_id`, `is_active=1`

    2. **List success**

    * GET `/api/v1/bank/accounts` includes created record

    3. **Duplicate code blocked**

    * POST same `code` → `409`

    4. **Duplicate GL link blocked**

    * POST different `code` but same `gl_account_id` → `409`

    5. **Deactivate/activate flow**

    * POST `/deactivate` → `is_active=0`
    * POST `/activate` → `is_active=1`

    6. **Permissions enforced**

    * missing/insufficient permission returns `403` (depending on your auth helper)

    ---

    # Recommended payload examples (for API manual test)

    ## Create

    ```json
    {
    "code": "BNK-KBL-USD-001",
    "name": "Kabul Main USD",
    "currency_code": "USD",
    "gl_account_id": 110201,
    "bank_name": "Azizi Bank",
    "branch_name": "Kabul HQ",
    "iban": "",
    "account_no": "001-23456789"
    }
    ```

    ## Update

    ```json
    {
    "name": "Kabul Main USD Updated",
    "branch_name": "Kabul Branch 1"
    }
    ```

    ---

    # Tiny implementation notes (to avoid future pain)

    * Keep `gl_account_id` unique **for now** (v1 simplicity).
    * Do **not** hard-delete bank accounts.
    * In next PRs, `bank_account_id` will be the anchor for:

    * statement imports
    * payment batches
    * reconciliation queue

    ---

Perfect — here’s **PR-B02 in the same concrete format**.

# PR-B02: Bank Statement Import Foundation (Imports + Lines Queue)

    ## Goal

    Add a **bank statement import pipeline** (CSV v1) and normalized **statement lines queue**.

    * ✅ Import file → create import header
    * ✅ Parse rows → create normalized statement lines
    * ✅ Idempotency by file checksum
    * ✅ Line-level dedupe by deterministic hash
    * ❌ No reconciliation matching yet (that’s PR-B03)

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m022_bank_statement_imports.js`
    * `backend/src/routes/bank.statements.js`
    * `backend/src/routes/bank.statements.validators.js`
    * `backend/src/services/bank.statements.service.js`
    * `backend/src/services/bank.parsers.csv.js`
    * `backend/scripts/test-bank-prb02-statement-import.js`

    ### Frontend

    * `frontend/src/api/bankStatements.js`
    * `frontend/src/pages/bank/BankStatementImportPage.jsx`
    * `frontend/src/pages/bank/BankStatementQueuePage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js` (permissions)
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m022_bank_statement_imports.js`

    ```js
    // backend/src/migrations/m022_bank_statement_imports.js

    module.exports = {
    id: "m022_bank_statement_imports",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS bank_statement_imports (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            bank_account_id BIGINT UNSIGNED NOT NULL,
            import_source VARCHAR(20) NOT NULL DEFAULT 'CSV',
            original_filename VARCHAR(255) NOT NULL,
            file_checksum CHAR(64) NOT NULL,
            period_start DATE NULL,
            period_end DATE NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'IMPORTED',
            line_count_total INT UNSIGNED NOT NULL DEFAULT 0,
            line_count_inserted INT UNSIGNED NOT NULL DEFAULT 0,
            line_count_duplicates INT UNSIGNED NOT NULL DEFAULT 0,
            raw_meta_json JSON NULL,
            imported_by BIGINT UNSIGNED NULL,
            imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_bank_statement_import_checksum (bank_account_id, file_checksum),
            KEY idx_bank_statement_imports_bank_account (bank_account_id),
            KEY idx_bank_statement_imports_status (status),
            KEY idx_bank_statement_imports_imported_at (imported_at),
            CONSTRAINT fk_bank_statement_imports_bank_account
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS bank_statement_lines (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            import_id BIGINT UNSIGNED NOT NULL,
            bank_account_id BIGINT UNSIGNED NOT NULL,
            line_no INT UNSIGNED NOT NULL,
            txn_date DATE NOT NULL,
            value_date DATE NULL,
            description VARCHAR(500) NOT NULL,
            reference_no VARCHAR(255) NULL,
            amount DECIMAL(18,2) NOT NULL,
            currency_code CHAR(3) NOT NULL,
            balance_after DECIMAL(18,2) NULL,
            line_hash CHAR(64) NOT NULL,
            recon_status VARCHAR(20) NOT NULL DEFAULT 'UNMATCHED',
            raw_row_json JSON NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_bank_statement_line_hash (bank_account_id, line_hash),
            UNIQUE KEY uq_bank_statement_line_import_lineno (import_id, line_no),
            KEY idx_bank_statement_lines_import (import_id),
            KEY idx_bank_statement_lines_bank_account (bank_account_id),
            KEY idx_bank_statement_lines_recon_status (recon_status),
            KEY idx_bank_statement_lines_txn_date (txn_date),
            CONSTRAINT fk_bank_statement_lines_import
            FOREIGN KEY (import_id) REFERENCES bank_statement_imports(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,
            CONSTRAINT fk_bank_statement_lines_bank_account
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS bank_statement_lines;`);
        await db.query(`DROP TABLE IF EXISTS bank_statement_imports;`);
    },
    };
    ```

    ---

    ## 2) CSV parser — `backend/src/services/bank.parsers.csv.js`

    > v1 assumes a fixed CSV header shape (easy to support/export from banks):
    >
    > `txn_date,value_date,description,reference_no,amount,currency_code,balance_after`

    ```js
    // backend/src/services/bank.parsers.csv.js

    function parseCsvLine(line) {
    // Minimal CSV parser with quote support (good enough for v1)
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i += 1;
        } else {
            inQuotes = !inQuotes;
        }
        continue;
        }

        if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
        }

        cur += ch;
    }

    out.push(cur);
    return out.map((s) => s.trim());
    }

    function parseDate(value, fieldName) {
    if (!value) return null;
    const s = String(value).trim();
    // Expect YYYY-MM-DD in v1
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new Error(`${fieldName} must be YYYY-MM-DD`);
    }
    return s;
    }

    function parseDecimal(value, fieldName) {
    const n = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new Error(`${fieldName} is invalid number`);
    return Number(n.toFixed(2));
    }

    function parseStatementCsv(csvText) {
    const text = String(csvText || "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("CSV is empty");

    const lines = text.split("\n").filter(Boolean);
    if (lines.length < 2) throw new Error("CSV must include header and at least one row");

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const required = [
        "txn_date",
        "value_date",
        "description",
        "reference_no",
        "amount",
        "currency_code",
        "balance_after",
    ];

    for (const key of required) {
        if (!header.includes(key)) {
        throw new Error(`Missing CSV column: ${key}`);
        }
    }

    const idx = Object.fromEntries(required.map((k) => [k, header.indexOf(k)]));

    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        if (cols.every((c) => c === "")) continue;

        const raw = {
        txn_date: cols[idx.txn_date] ?? "",
        value_date: cols[idx.value_date] ?? "",
        description: cols[idx.description] ?? "",
        reference_no: cols[idx.reference_no] ?? "",
        amount: cols[idx.amount] ?? "",
        currency_code: cols[idx.currency_code] ?? "",
        balance_after: cols[idx.balance_after] ?? "",
        };

        const description = String(raw.description || "").trim();
        if (!description) throw new Error(`Row ${i + 1}: description is required`);

        const currency = String(raw.currency_code || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error(`Row ${i + 1}: currency_code must be 3-letter code`);
        }

        rows.push({
        line_no: i, // data row no (1-based excluding header)
        txn_date: parseDate(raw.txn_date, `Row ${i + 1} txn_date`),
        value_date: parseDate(raw.value_date, `Row ${i + 1} value_date`),
        description,
        reference_no: String(raw.reference_no || "").trim() || null,
        amount: parseDecimal(raw.amount, `Row ${i + 1} amount`),
        currency_code: currency,
        balance_after:
            String(raw.balance_after || "").trim() === ""
            ? null
            : parseDecimal(raw.balance_after, `Row ${i + 1} balance_after`),
        raw_row_json: raw,
        });
    }

    if (rows.length === 0) throw new Error("CSV has no valid data rows");
    return rows;
    }

    module.exports = {
    parseStatementCsv,
    };
    ```

    ---

    ## 3) Validators — `backend/src/routes/bank.statements.validators.js`

    ```js
    // backend/src/routes/bank.statements.validators.js

    function requirePositiveInt(value, fieldName) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${fieldName} must be positive integer`);
    return n;
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    // v1 route accepts multipart file OR raw csv_text fallback
    function validateImportRequest(req) {
    const bank_account_id = requirePositiveInt(req.body?.bank_account_id, "bank_account_id");
    const import_source = "CSV";
    const original_filename =
        req.file?.originalname || normalizeString(req.body?.original_filename) || "statement.csv";

    const csvText =
        req.file?.buffer?.toString("utf8") ||
        (typeof req.body?.csv_text === "string" ? req.body.csv_text : null);

    if (!csvText) {
        throw new Error("CSV file or csv_text is required");
    }

    return {
        bank_account_id,
        import_source,
        original_filename,
        csv_text: csvText,
    };
    }

    function validateIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateListLinesQuery(query = {}) {
    return {
        import_id: query.import_id ? requirePositiveInt(query.import_id, "import_id") : null,
        bank_account_id: query.bank_account_id ? requirePositiveInt(query.bank_account_id, "bank_account_id") : null,
        recon_status: query.recon_status ? String(query.recon_status).trim().toUpperCase() : null,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 100,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateListImportsQuery(query = {}) {
    return {
        bank_account_id: query.bank_account_id ? requirePositiveInt(query.bank_account_id, "bank_account_id") : null,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 200) : 50,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    module.exports = {
    validateImportRequest,
    validateIdParam,
    validateListLinesQuery,
    validateListImportsQuery,
    };
    ```

    ---

    ## 4) Service — `backend/src/services/bank.statements.service.js`

    ```js
    // backend/src/services/bank.statements.service.js

    const crypto = require("crypto");
    const { parseStatementCsv } = require("./bank.parsers.csv");

    function sha256(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
    }

    function normalizeHashPart(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim().toUpperCase();
    }

    function buildStatementLineHash(bankAccountId, row) {
    // Intentionally excludes import_id / line_no for cross-import dedupe
    const key = [
        bankAccountId,
        normalizeHashPart(row.txn_date),
        normalizeHashPart(row.value_date),
        normalizeHashPart(row.currency_code),
        normalizeHashPart(Number(row.amount).toFixed(2)),
        normalizeHashPart(row.balance_after == null ? "" : Number(row.balance_after).toFixed(2)),
        normalizeHashPart(row.reference_no),
        normalizeHashPart(row.description),
    ].join("|");
    return sha256(key);
    }

    async function assertBankAccountExists(db, bankAccountId) {
    const [rows] = await db.query(
        `SELECT id, code, name, currency_code, is_active FROM bank_accounts WHERE id = ? LIMIT 1`,
        [bankAccountId]
    );
    if (!rows[0]) {
        const err = new Error("Bank account not found");
        err.statusCode = 400;
        throw err;
    }
    return rows[0];
    }

    async function getImportById(db, id) {
    const [rows] = await db.query(
        `
        SELECT
        i.*,
        b.code AS bank_account_code,
        b.name AS bank_account_name
        FROM bank_statement_imports i
        JOIN bank_accounts b ON b.id = i.bank_account_id
        WHERE i.id = ?
        LIMIT 1
        `,
        [id]
    );
    return rows[0] || null;
    }

    async function listImports(db, { bank_account_id = null, limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];

    if (bank_account_id) {
        where.push("i.bank_account_id = ?");
        params.push(bank_account_id);
    }

    let sql = `
        SELECT
        i.id, i.bank_account_id, i.import_source, i.original_filename, i.file_checksum,
        i.period_start, i.period_end, i.status,
        i.line_count_total, i.line_count_inserted, i.line_count_duplicates,
        i.imported_at, i.imported_by,
        b.code AS bank_account_code, b.name AS bank_account_name
        FROM bank_statement_imports i
        JOIN bank_accounts b ON b.id = i.bank_account_id
    `;

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY i.id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function listStatementLines(db, query) {
    const where = [];
    const params = [];

    if (query.import_id) {
        where.push("l.import_id = ?");
        params.push(query.import_id);
    }
    if (query.bank_account_id) {
        where.push("l.bank_account_id = ?");
        params.push(query.bank_account_id);
    }
    if (query.recon_status) {
        where.push("l.recon_status = ?");
        params.push(query.recon_status);
    }

    let sql = `
        SELECT
        l.id, l.import_id, l.bank_account_id, l.line_no, l.txn_date, l.value_date,
        l.description, l.reference_no, l.amount, l.currency_code, l.balance_after,
        l.recon_status, l.created_at,
        i.original_filename,
        b.code AS bank_account_code, b.name AS bank_account_name
        FROM bank_statement_lines l
        JOIN bank_statement_imports i ON i.id = l.import_id
        JOIN bank_accounts b ON b.id = l.bank_account_id
    `;

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY l.txn_date DESC, l.id DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function getStatementLineById(db, id) {
    const [rows] = await db.query(
        `
        SELECT
        l.*,
        i.original_filename,
        b.code AS bank_account_code, b.name AS bank_account_name
        FROM bank_statement_lines l
        JOIN bank_statement_imports i ON i.id = l.import_id
        JOIN bank_accounts b ON b.id = l.bank_account_id
        WHERE l.id = ?
        LIMIT 1
        `,
        [id]
    );
    return rows[0] || null;
    }

    async function importStatementCsv(db, payload, userId = null) {
    const bank = await assertBankAccountExists(db, payload.bank_account_id);

    const fileChecksum = sha256(payload.csv_text);
    const [dupImportRows] = await db.query(
        `SELECT id FROM bank_statement_imports WHERE bank_account_id = ? AND file_checksum = ? LIMIT 1`,
        [payload.bank_account_id, fileChecksum]
    );
    if (dupImportRows[0]) {
        const err = new Error("This statement file was already imported for the selected bank account");
        err.statusCode = 409;
        throw err;
    }

    const parsedRows = parseStatementCsv(payload.csv_text);

    // Optional safeguard: require row currency to match bank account currency in v1
    const badCurrency = parsedRows.find((r) => r.currency_code !== bank.currency_code);
    if (badCurrency) {
        const err = new Error(
        `Statement currency mismatch. Bank account currency=${bank.currency_code}, row currency=${badCurrency.currency_code}`
        );
        err.statusCode = 400;
        throw err;
    }

    const txn = await db.getConnection ? await db.getConnection() : null;
    const q = txn || db;

    try {
        if (txn) await txn.beginTransaction();

        const dates = parsedRows.map((r) => r.txn_date).sort();
        const period_start = dates[0] || null;
        const period_end = dates[dates.length - 1] || null;

        const [insImport] = await q.query(
        `
        INSERT INTO bank_statement_imports
        (bank_account_id, import_source, original_filename, file_checksum, period_start, period_end, status, raw_meta_json, imported_by)
        VALUES (?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?)
        `,
        [
            payload.bank_account_id,
            "CSV",
            payload.original_filename,
            fileChecksum,
            period_start,
            period_end,
            JSON.stringify({ parser: "csv-v1" }),
            userId,
        ]
        );

        const importId = insImport.insertId;
        let inserted = 0;
        let duplicates = 0;

        for (const row of parsedRows) {
        const lineHash = buildStatementLineHash(payload.bank_account_id, row);

        try {
            await q.query(
            `
            INSERT INTO bank_statement_lines
            (import_id, bank_account_id, line_no, txn_date, value_date, description, reference_no,
            amount, currency_code, balance_after, line_hash, recon_status, raw_row_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNMATCHED', ?)
            `,
            [
                importId,
                payload.bank_account_id,
                row.line_no,
                row.txn_date,
                row.value_date,
                row.description,
                row.reference_no,
                row.amount,
                row.currency_code,
                row.balance_after,
                lineHash,
                JSON.stringify(row.raw_row_json || null),
            ]
            );
            inserted += 1;
        } catch (e) {
            if (e && e.code === "ER_DUP_ENTRY") {
            duplicates += 1;
            continue;
            }
            throw e;
        }
        }

        await q.query(
        `
        UPDATE bank_statement_imports
        SET line_count_total = ?, line_count_inserted = ?, line_count_duplicates = ?,
            raw_meta_json = JSON_SET(COALESCE(raw_meta_json, JSON_OBJECT()),
                '$.inserted', ?, '$.duplicates', ?, '$.bank_account_code', ?)
        WHERE id = ?
        `,
        [parsedRows.length, inserted, duplicates, inserted, duplicates, bank.code, importId]
        );

        if (txn) await txn.commit();

        return getImportById(db, importId);
    } catch (err) {
        if (txn) {
        try {
            await txn.rollback();
        } catch (_) {}
        }
        throw err;
    } finally {
        if (txn) txn.release();
    }
    }

    module.exports = {
    importStatementCsv,
    listImports,
    getImportById,
    listStatementLines,
    getStatementLineById,
    };
    ```

    ---

    ## 5) Routes — `backend/src/routes/bank.statements.js`

    > Uses `multer` for multipart upload. If you already have an upload helper, swap it in.

    ```js
    // backend/src/routes/bank.statements.js

    const express = require("express");
    const multer = require("multer");
    const {
    validateImportRequest,
    validateIdParam,
    validateListLinesQuery,
    validateListImportsQuery,
    } = require("./bank.statements.validators");
    const service = require("../services/bank.statements.service");

    // Replace with your project helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage() });

    // POST /api/v1/bank/statements/import
    router.post(
    "/statements/import",
    requireAuth,
    requirePermission("bank.statements.import"),
    upload.single("file"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const payload = validateImportRequest(req);
        const userId = req.user?.id ?? null;
        const result = await service.importStatementCsv(db, payload, userId);
        res.status(201).json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/statements/imports
    router.get(
    "/statements/imports",
    requireAuth,
    requirePermission("bank.statements.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListImportsQuery(req.query);
        const items = await service.listImports(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/statements/imports/:id
    router.get(
    "/statements/imports/:id",
    requireAuth,
    requirePermission("bank.statements.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.getImportById(db, id);
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/statements/lines
    router.get(
    "/statements/lines",
    requireAuth,
    requirePermission("bank.statements.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListLinesQuery(req.query);
        const items = await service.listStatementLines(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/statements/lines/:id
    router.get(
    "/statements/lines/:id",
    requireAuth,
    requirePermission("bank.statements.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.getStatementLineById(db, id);
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 6) Mount route — `backend/src/index.js`

    ```js
    // backend/src/index.js
    const bankStatementsRoutes = require("./routes/bank.statements");

    // ...
    app.use("/api/v1/bank", bankStatementsRoutes);
    ```

    ---

    ## 7) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m022_bank_statement_imports = require("./m022_bank_statement_imports");

    module.exports = [
    // ...
    m022_bank_statement_imports,
    ];
    ```

    ---

    ## 8) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const BANK_STATEMENT_PERMISSIONS = [
    "bank.statements.import",
    "bank.statements.read",
    ];

    // merge into your permissions seed list
    ```

    ---

    ## 9) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `POST /api/v1/bank/statements/import`
    * `GET /api/v1/bank/statements/imports`
    * `GET /api/v1/bank/statements/imports/{id}`
    * `GET /api/v1/bank/statements/lines`
    * `GET /api/v1/bank/statements/lines/{id}`

    If your generator is route-driven, just ensure `bank.statements.js` is loaded.

    ---

    ## 10) Backend smoke test — `backend/scripts/test-bank-prb02-statement-import.js`

    > You can make this a real `supertest` script. Here’s the exact behavior to test.

    ```js
    // backend/scripts/test-bank-prb02-statement-import.js

    async function main() {
    // Pseudocode:
    // 1) Ensure a bank account exists (from PR-B01)
    // 2) Build a CSV string with 3 rows (same currency as bank account)
    // 3) POST /api/v1/bank/statements/import with bank_account_id + csv_text (or multipart file)
    // 4) Assert 201 and counts (total=3, inserted=3, duplicates=0)
    // 5) GET /api/v1/bank/statements/imports and assert import row exists
    // 6) GET /api/v1/bank/statements/lines?import_id=:id and assert 3 lines, recon_status=UNMATCHED
    // 7) Re-import same CSV for same bank account -> expect 409 (checksum idempotency)
    // 8) Import different CSV containing one duplicate line + one new line -> inserted/new counts reflect dedupe
    console.log("PR-B02 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    ---

    ## 11) `backend/package.json` updates

    Add smoke test + dependencies (if you don’t already have them):

    ```json
    {
    "scripts": {
        "test:bank:prb02": "node backend/scripts/test-bank-prb02-statement-import.js"
    },
    "dependencies": {
        "multer": "^1.4.5-lts.1"
    }
    }
    ```

    (If your `package.json` is already in `/backend`, use `node scripts/test-bank-prb02-statement-import.js`)

    ---

    # Frontend skeletons

    ## 12) API client — `frontend/src/api/bankStatements.js`

    ```js
    // frontend/src/api/bankStatements.js

    import { apiFetch } from "./client"; // adapt to your actual helper

    export function importBankStatementCsv({ bank_account_id, file, csv_text }) {
    // Supports multipart file upload or raw csv_text fallback
    if (file) {
        const form = new FormData();
        form.append("bank_account_id", String(bank_account_id));
        form.append("file", file);

        return apiFetch(`/api/v1/bank/statements/import`, {
        method: "POST",
        body: form,
        // important: do NOT set Content-Type manually for FormData
        });
    }

    return apiFetch(`/api/v1/bank/statements/import`, {
        method: "POST",
        body: JSON.stringify({ bank_account_id, csv_text, original_filename: "manual.csv" }),
    });
    }

    export function listBankStatementImports(params = {}) {
    const q = new URLSearchParams();
    if (params.bank_account_id) q.set("bank_account_id", String(params.bank_account_id));
    const qs = q.toString();
    return apiFetch(`/api/v1/bank/statements/imports${qs ? `?${qs}` : ""}`);
    }

    export function getBankStatementImport(id) {
    return apiFetch(`/api/v1/bank/statements/imports/${id}`);
    }

    export function listBankStatementLines(params = {}) {
    const q = new URLSearchParams();
    if (params.import_id) q.set("import_id", String(params.import_id));
    if (params.bank_account_id) q.set("bank_account_id", String(params.bank_account_id));
    if (params.recon_status) q.set("recon_status", String(params.recon_status));
    const qs = q.toString();
    return apiFetch(`/api/v1/bank/statements/lines${qs ? `?${qs}` : ""}`);
    }

    export function getBankStatementLine(id) {
    return apiFetch(`/api/v1/bank/statements/lines/${id}`);
    }
    ```

    ---

    ## 13) Import page — `frontend/src/pages/bank/BankStatementImportPage.jsx`

    > Simple v1 UI: choose bank account ID + file upload.

    ```jsx
    // frontend/src/pages/bank/BankStatementImportPage.jsx

    import { useState } from "react";
    import { importBankStatementCsv } from "../../api/bankStatements";

    export default function BankStatementImportPage() {
    const [bankAccountId, setBankAccountId] = useState("");
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setErr("");
        setResult(null);

        try {
        if (!bankAccountId) throw new Error("Bank account ID is required");
        if (!file) throw new Error("CSV file is required");

        setSubmitting(true);
        const res = await importBankStatementCsv({
            bank_account_id: Number(bankAccountId),
            file,
        });
        setResult(res);
        } catch (e) {
        setErr(e.message || "Import failed");
        } finally {
        setSubmitting(false);
        }
    }

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <h1 className="text-lg font-semibold mb-3">Bank Statement Import</h1>

            {err ? <div className="mb-3 text-sm text-red-600">{err}</div> : null}

            <form className="space-y-3" onSubmit={onSubmit}>
            <input
                className="border rounded px-2 py-1 w-full md:w-64"
                placeholder="Bank Account ID"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
            />

            <input
                className="block"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
            />

            <button
                className="px-3 py-1 rounded bg-black text-white disabled:opacity-50"
                type="submit"
                disabled={submitting}
            >
                {submitting ? "Importing..." : "Import CSV"}
            </button>
            </form>
        </div>

        {result ? (
            <div className="rounded border bg-white p-4 text-sm">
            <div className="font-medium mb-2">Import Result</div>
            <div>ID: {result.id}</div>
            <div>File: {result.original_filename}</div>
            <div>Status: {result.status}</div>
            <div>Total Rows: {result.line_count_total}</div>
            <div>Inserted: {result.line_count_inserted}</div>
            <div>Duplicates: {result.line_count_duplicates}</div>
            </div>
        ) : null}
        </div>
    );
    }
    ```

    ---

    ## 14) Queue page — `frontend/src/pages/bank/BankStatementQueuePage.jsx`

    ```jsx
    // frontend/src/pages/bank/BankStatementQueuePage.jsx

    import { useEffect, useState } from "react";
    import { listBankStatementLines } from "../../api/bankStatements";

    export default function BankStatementQueuePage() {
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);
    const [bankAccountId, setBankAccountId] = useState("");

    async function load() {
        setLoading(true);
        setErr("");
        try {
        const res = await listBankStatementLines({
            bank_account_id: bankAccountId ? Number(bankAccountId) : undefined,
            recon_status: "UNMATCHED",
        });
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load queue");
        } finally {
        setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <h1 className="text-lg font-semibold mb-3">Statement Queue</h1>

            <div className="flex items-center gap-2 mb-3">
            <input
                className="border rounded px-2 py-1 w-56"
                placeholder="Filter Bank Account ID"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
            />
            <button className="px-3 py-1 rounded border" onClick={load} type="button">
                Refresh
            </button>
            </div>

            {err ? <div className="mb-3 text-sm text-red-600">{err}</div> : null}

            {loading ? (
            <div>Loading...</div>
            ) : (
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Bank</th>
                    <th className="text-left p-2">Description</th>
                    <th className="text-left p-2">Ref</th>
                    <th className="text-left p-2">Amount</th>
                    <th className="text-left p-2">Currency</th>
                    <th className="text-left p-2">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((row) => (
                    <tr key={row.id} className="border-b">
                        <td className="p-2">{row.txn_date}</td>
                        <td className="p-2">{row.bank_account_code}</td>
                        <td className="p-2">{row.description}</td>
                        <td className="p-2">{row.reference_no || "-"}</td>
                        <td className="p-2">{row.amount}</td>
                        <td className="p-2">{row.currency_code}</td>
                        <td className="p-2">{row.recon_status}</td>
                    </tr>
                    ))}
                    {items.length === 0 && (
                    <tr>
                        <td className="p-2" colSpan={7}>
                        No statement lines in queue.
                        </td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
            )}
        </div>
        </div>
    );
    }
    ```

    ---

    ## 15) App routes — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import BankStatementImportPage from "./pages/bank/BankStatementImportPage";
    import BankStatementQueuePage from "./pages/bank/BankStatementQueuePage";

    // ...
    <Route
    path="/bank/statements/import"
    element={
        <RequirePermission permission="bank.statements.import">
        <BankStatementImportPage />
        </RequirePermission>
    }
    />

    <Route
    path="/bank/statements/queue"
    element={
        <RequirePermission permission="bank.statements.read">
        <BankStatementQueuePage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 16) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    Add to your existing Bank section:

    ```js
    // frontend/src/layouts/sidebarConfig.js
    {
    key: "bank",
    label: "Bank",
    children: [
        // existing: Bank Accounts
        {
        key: "bank-statements-import",
        label: "Statement Import",
        to: "/bank/statements/import",
        permission: "bank.statements.import",
        },
        {
        key: "bank-statements-queue",
        label: "Statement Queue",
        to: "/bank/statements/queue",
        permission: "bank.statements.read",
        },
    ],
    }
    ```

    ---

    ## 17) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.bankStatementImport": "Statement Import",
    "sidebar.bankStatementQueue": "Statement Queue",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ CSV import creates `bank_statement_imports` header + `bank_statement_lines`
    * ✅ Re-importing same file for same bank account is blocked by checksum (idempotent)
    * ✅ Duplicate statement rows are safely deduped by `line_hash` and counted
    * ✅ Imported rows default to `recon_status = UNMATCHED`
    * ✅ List endpoints return imports + lines for queue UI
    * ✅ Route + UI permission checks use `bank.statements.import/read`
    * ✅ OpenAPI is updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:bank:prb02`

    Should verify at least:

    1. **Import success**

    * POST valid CSV → `201`
    * response includes `id`, `status=IMPORTED`
    * `line_count_total`, `line_count_inserted`, `line_count_duplicates`

    2. **Imports list**

    * GET `/api/v1/bank/statements/imports` includes created import row

    3. **Lines list**

    * GET `/api/v1/bank/statements/lines?import_id=:id` returns rows
    * all rows have `recon_status=UNMATCHED`

    4. **Checksum idempotency**

    * Re-import same file for same bank account → `409`

    5. **Line-level dedupe**

    * Import new file with one repeated row + one new row
    * import succeeds
    * duplicate count increments
    * only new line inserted

    6. **Permission enforcement**

    * import/read routes require proper permissions (`403` if missing)

    ---

    # CSV format for manual testing (v1)

    Use this exact header:

    ```csv
    txn_date,value_date,description,reference_no,amount,currency_code,balance_after
    2026-02-01,2026-02-01,Payroll Batch Jan,PAY-2026-01,-12500.00,USD,87500.00
    2026-02-02,2026-02-02,Customer Receipt,RCPT-1001,4200.00,USD,91700.00
    2026-02-03,2026-02-03,Bank Fee,FEE-02,-15.50,USD,91684.50
    ```

    ---

    # Tiny implementation notes (important)

    * **Keep `amount` signed** in v1 (simpler than separate debit/credit columns).
    * **Line hash excludes import_id/line_no** on purpose, so duplicates across files are caught.
    * **Don’t do reconciliation logic yet** in this PR — only queue population.
    * In PR-B03, your matcher will operate on `bank_statement_lines` where `recon_status='UNMATCHED'`.

Perfect — here’s **PR-B03 in the same concrete format**.

# PR-B03: Bank Reconciliation Core (Manual + Suggested Match)

    ## Goal

    Turn imported statement lines into a **real reconciliation queue**:

    * ✅ Queue of `UNMATCHED / PARTIAL / IGNORED`
    * ✅ Suggestions (v1: journal-based; payment batch support ready for PR-B04)
    * ✅ Manual match / unmatch
    * ✅ Ignore line (exception handling)
    * ✅ Full audit trail for reconciliation actions

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m023_bank_reconciliation.js`
    * `backend/src/routes/bank.reconciliation.js`
    * `backend/src/routes/bank.reconciliation.validators.js`
    * `backend/src/services/bank.reconciliation.service.js`
    * `backend/scripts/test-bank-prb03-reconciliation.js`

    ### Frontend

    * `frontend/src/api/bankReconciliation.js`
    * `frontend/src/pages/bank/BankReconciliationPage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js` (permissions)
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m023_bank_reconciliation.js`

    ```js
    // backend/src/migrations/m023_bank_reconciliation.js

    module.exports = {
    id: "m023_bank_reconciliation",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            statement_line_id BIGINT UNSIGNED NOT NULL,
            match_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
            matched_entity_type VARCHAR(30) NOT NULL, -- JOURNAL, PAYMENT_BATCH, CASH_TXN, MANUAL_ADJUSTMENT
            matched_entity_id BIGINT UNSIGNED NOT NULL,
            matched_amount DECIMAL(18,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVERSED
            notes VARCHAR(500) NULL,
            matched_by BIGINT UNSIGNED NULL,
            matched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reversed_by BIGINT UNSIGNED NULL,
            reversed_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_bank_recon_matches_line (statement_line_id),
            KEY idx_bank_recon_matches_entity (matched_entity_type, matched_entity_id),
            KEY idx_bank_recon_matches_status (status),
            CONSTRAINT fk_bank_recon_matches_line
            FOREIGN KEY (statement_line_id) REFERENCES bank_statement_lines(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS bank_reconciliation_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            statement_line_id BIGINT UNSIGNED NOT NULL,
            action VARCHAR(30) NOT NULL, -- SUGGESTED, MATCHED, UNMATCHED, IGNORE, UNIGNORE, AUTO_STATUS
            payload_json JSON NULL,
            acted_by BIGINT UNSIGNED NULL,
            acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_bank_recon_audit_line (statement_line_id),
            KEY idx_bank_recon_audit_action (action),
            KEY idx_bank_recon_audit_acted_at (acted_at),
            CONSTRAINT fk_bank_recon_audit_line
            FOREIGN KEY (statement_line_id) REFERENCES bank_statement_lines(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS bank_reconciliation_audit;`);
        await db.query(`DROP TABLE IF EXISTS bank_reconciliation_matches;`);
    },
    };
    ```

    ---

    ## 2) Validators — `backend/src/routes/bank.reconciliation.validators.js`

    ```js
    // backend/src/routes/bank.reconciliation.validators.js

    function requirePositiveInt(value, fieldName) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${fieldName} must be positive integer`);
    return n;
    }

    function requireAmount(value, fieldName) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${fieldName} must be positive number`);
    return Number(n.toFixed(2));
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function validateLineIdParam(params = {}) {
    return { lineId: requirePositiveInt(params.lineId, "lineId") };
    }

    function validateQueueQuery(query = {}) {
    return {
        bank_account_id: query.bank_account_id ? requirePositiveInt(query.bank_account_id, "bank_account_id") : null,
        recon_status: query.recon_status ? String(query.recon_status).trim().toUpperCase() : null,
        q: normalizeString(query.q),
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 100,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateAuditQuery(query = {}) {
    return {
        statement_line_id: query.statement_line_id ? requirePositiveInt(query.statement_line_id, "statement_line_id") : null,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 100,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateMatchBody(body = {}) {
    const matched_entity_type = String(body.matched_entity_type || "").trim().toUpperCase();
    const allowedEntityTypes = ["JOURNAL", "PAYMENT_BATCH", "CASH_TXN", "MANUAL_ADJUSTMENT"];
    if (!allowedEntityTypes.includes(matched_entity_type)) {
        throw new Error(`matched_entity_type must be one of ${allowedEntityTypes.join(", ")}`);
    }

    return {
        match_type: String(body.match_type || "MANUAL").trim().toUpperCase(),
        matched_entity_type,
        matched_entity_id: requirePositiveInt(body.matched_entity_id, "matched_entity_id"),
        matched_amount: requireAmount(body.matched_amount, "matched_amount"),
        notes: normalizeString(body.notes),
    };
    }

    function validateUnmatchBody(body = {}) {
    return {
        match_id: body.match_id ? requirePositiveInt(body.match_id, "match_id") : null,
        notes: normalizeString(body.notes),
    };
    }

    function validateIgnoreBody(body = {}) {
    return {
        reason: normalizeString(body.reason),
    };
    }

    module.exports = {
    validateLineIdParam,
    validateQueueQuery,
    validateAuditQuery,
    validateMatchBody,
    validateUnmatchBody,
    validateIgnoreBody,
    };
    ```

    ---

    ## 3) Service — `backend/src/services/bank.reconciliation.service.js`

    > **Important:** suggestions use a **journal query skeleton**.
    > Replace table names/columns with your actual GL schema if different (e.g. `journal_entries`, `journal_lines`, `posted_at`, `status`).

    ```js
    // backend/src/services/bank.reconciliation.service.js

    async function getStatementLineCore(db, lineId) {
    const [rows] = await db.query(
        `
        SELECT
        l.id, l.import_id, l.bank_account_id, l.txn_date, l.value_date, l.description, l.reference_no,
        l.amount, l.currency_code, l.balance_after, l.recon_status,
        b.gl_account_id, b.code AS bank_account_code, b.name AS bank_account_name
        FROM bank_statement_lines l
        JOIN bank_accounts b ON b.id = l.bank_account_id
        WHERE l.id = ?
        LIMIT 1
        `,
        [lineId]
    );
    return rows[0] || null;
    }

    async function getActiveMatchesForLine(db, lineId) {
    const [rows] = await db.query(
        `
        SELECT id, matched_entity_type, matched_entity_id, matched_amount, status, notes, matched_at
        FROM bank_reconciliation_matches
        WHERE statement_line_id = ? AND status = 'ACTIVE'
        ORDER BY id ASC
        `,
        [lineId]
    );
    return rows;
    }

    async function writeAudit(db, { statementLineId, action, payload = null, userId = null }) {
    await db.query(
        `
        INSERT INTO bank_reconciliation_audit
        (statement_line_id, action, payload_json, acted_by)
        VALUES (?, ?, ?, ?)
        `,
        [statementLineId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function recomputeLineReconStatus(db, lineId, userId = null) {
    const line = await getStatementLineCore(db, lineId);
    if (!line) {
        const err = new Error("Statement line not found");
        err.statusCode = 404;
        throw err;
    }

    if (line.recon_status === "IGNORED") {
        return line; // keep ignored until explicitly unignored (not in v1)
    }

    const [aggRows] = await db.query(
        `
        SELECT COALESCE(SUM(matched_amount), 0) AS matched_total
        FROM bank_reconciliation_matches
        WHERE statement_line_id = ? AND status = 'ACTIVE'
        `,
        [lineId]
    );

    const matchedTotal = Number(aggRows[0]?.matched_total || 0);
    const target = Math.abs(Number(line.amount));

    let nextStatus = "UNMATCHED";
    if (matchedTotal > 0 && Math.abs(matchedTotal - target) < 0.005) nextStatus = "MATCHED";
    else if (matchedTotal > 0) nextStatus = "PARTIAL";

    if (nextStatus !== line.recon_status) {
        await db.query(`UPDATE bank_statement_lines SET recon_status = ? WHERE id = ?`, [nextStatus, lineId]);
        await writeAudit(db, {
        statementLineId: lineId,
        action: "AUTO_STATUS",
        payload: { from: line.recon_status, to: nextStatus, matched_total: matchedTotal, target_amount: target },
        userId,
        });
    }

    return getStatementLineCore(db, lineId);
    }

    async function listReconciliationQueue(db, query) {
    const where = [];
    const params = [];

    if (query.bank_account_id) {
        where.push("l.bank_account_id = ?");
        params.push(query.bank_account_id);
    }
    if (query.recon_status) {
        where.push("l.recon_status = ?");
        params.push(query.recon_status);
    } else {
        // queue default: show actionable + exceptions
        where.push(`l.recon_status IN ('UNMATCHED', 'PARTIAL', 'IGNORED')`);
    }
    if (query.q) {
        where.push(`(l.description LIKE ? OR l.reference_no LIKE ?)`);
        params.push(`%${query.q}%`, `%${query.q}%`);
    }

    let sql = `
        SELECT
        l.id, l.bank_account_id, l.import_id, l.txn_date, l.value_date,
        l.description, l.reference_no, l.amount, l.currency_code, l.balance_after,
        l.recon_status, l.created_at,
        b.code AS bank_account_code, b.name AS bank_account_name,
        i.original_filename,
        COALESCE(m.active_match_count, 0) AS active_match_count,
        COALESCE(m.active_matched_total, 0) AS active_matched_total
        FROM bank_statement_lines l
        JOIN bank_accounts b ON b.id = l.bank_account_id
        JOIN bank_statement_imports i ON i.id = l.import_id
        LEFT JOIN (
        SELECT
            statement_line_id,
            COUNT(*) AS active_match_count,
            COALESCE(SUM(matched_amount), 0) AS active_matched_total
        FROM bank_reconciliation_matches
        WHERE status = 'ACTIVE'
        GROUP BY statement_line_id
        ) m ON m.statement_line_id = l.id
    `;

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY l.txn_date DESC, l.id DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function getSuggestionsForLine(db, lineId, userId = null) {
    const line = await getStatementLineCore(db, lineId);
    if (!line) {
        const err = new Error("Statement line not found");
        err.statusCode = 404;
        throw err;
    }

    // v1 journal suggestion skeleton:
    // - same amount on bank GL line
    // - date window +/- 7 days
    // - posted status
    // - optional ref/description text scoring
    //
    // Replace `journal_entries` / `journal_entry_lines` names if your schema differs.
    const [rows] = await db.query(
        `
        SELECT
        je.id AS journal_id,
        je.journal_no,
        je.posted_at,
        je.memo,
        ABS(jl.amount) AS bank_line_amount,
        CASE
            WHEN ABS(ABS(jl.amount) - ABS(?)) < 0.005 THEN 100
            ELSE 60
        END
        + CASE WHEN DATE(je.posted_at) = ? THEN 20 ELSE 0 END
        + CASE
            WHEN ? IS NOT NULL AND ? <> '' AND (
                je.memo LIKE CONCAT('%', ?, '%')
                OR je.journal_no LIKE CONCAT('%', ?, '%')
            ) THEN 10
            ELSE 0
            END AS score
        FROM journal_entries je
        JOIN journal_entry_lines jl ON jl.journal_entry_id = je.id
        WHERE je.status = 'POSTED'
        AND jl.account_id = ?
        AND ABS(ABS(jl.amount) - ABS(?)) <= 0.01
        AND DATE(je.posted_at) BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND DATE_ADD(?, INTERVAL 7 DAY)
        ORDER BY score DESC, je.posted_at DESC
        LIMIT 20
        `,
        [
        line.amount,
        line.txn_date,
        line.reference_no,
        line.reference_no,
        line.reference_no,
        line.reference_no,
        line.gl_account_id,
        line.amount,
        line.txn_date,
        line.txn_date,
        ]
    );

    const suggestions = rows.map((r) => ({
        suggestion_type: "JOURNAL",
        matched_entity_type: "JOURNAL",
        matched_entity_id: r.journal_id,
        display_ref: r.journal_no,
        display_text: r.memo || r.journal_no,
        suggested_amount: Math.abs(Number(line.amount)),
        score: Number(r.score || 0),
        posted_at: r.posted_at,
    }));

    await writeAudit(db, {
        statementLineId: lineId,
        action: "SUGGESTED",
        payload: { suggestion_count: suggestions.length, engine: "journal-v1" },
        userId,
    });

    return {
        line,
        suggestions,
    };
    }

    async function assertMatchTargetExists(db, matchBody) {
    // v1: JOURNAL supported concretely, others are reserved for next PRs.
    if (matchBody.matched_entity_type === "JOURNAL") {
        const [rows] = await db.query(
        `SELECT id, status FROM journal_entries WHERE id = ? LIMIT 1`,
        [matchBody.matched_entity_id]
        );
        if (!rows[0]) {
        const err = new Error("Journal not found");
        err.statusCode = 400;
        throw err;
        }
        if (rows[0].status !== "POSTED") {
        const err = new Error("Only POSTED journals can be reconciled");
        err.statusCode = 400;
        throw err;
        }
        return;
    }

    // Keep explicit for now so users don't think it silently works before PR-B04.
    if (matchBody.matched_entity_type === "PAYMENT_BATCH") {
        const err = new Error("PAYMENT_BATCH reconciliation is enabled in PR-B04");
        err.statusCode = 400;
        throw err;
    }

    // CASH_TXN / MANUAL_ADJUSTMENT can be enabled later similarly
    const err = new Error(`${matchBody.matched_entity_type} matching is not enabled yet`);
    err.statusCode = 400;
    throw err;
    }

    async function matchStatementLine(db, lineId, matchBody, userId = null) {
    const line = await getStatementLineCore(db, lineId);
    if (!line) {
        const err = new Error("Statement line not found");
        err.statusCode = 404;
        throw err;
    }
    if (line.recon_status === "IGNORED") {
        const err = new Error("Ignored line cannot be matched (unignore flow not implemented yet)");
        err.statusCode = 400;
        throw err;
    }

    const target = Math.abs(Number(line.amount));
    const [aggRows] = await db.query(
        `
        SELECT COALESCE(SUM(matched_amount), 0) AS matched_total
        FROM bank_reconciliation_matches
        WHERE statement_line_id = ? AND status = 'ACTIVE'
        `,
        [lineId]
    );
    const existingMatched = Number(aggRows[0]?.matched_total || 0);
    if (existingMatched + Number(matchBody.matched_amount) - target > 0.005) {
        const err = new Error("Matched amount exceeds statement line amount");
        err.statusCode = 400;
        throw err;
    }

    await assertMatchTargetExists(db, matchBody);

    const [ins] = await db.query(
        `
        INSERT INTO bank_reconciliation_matches
        (statement_line_id, match_type, matched_entity_type, matched_entity_id, matched_amount, status, notes, matched_by)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
        `,
        [
        lineId,
        matchBody.match_type || "MANUAL",
        matchBody.matched_entity_type,
        matchBody.matched_entity_id,
        matchBody.matched_amount,
        matchBody.notes || null,
        userId,
        ]
    );

    await writeAudit(db, {
        statementLineId: lineId,
        action: "MATCHED",
        payload: {
        match_id: ins.insertId,
        matched_entity_type: matchBody.matched_entity_type,
        matched_entity_id: matchBody.matched_entity_id,
        matched_amount: matchBody.matched_amount,
        },
        userId,
    });

    const updatedLine = await recomputeLineReconStatus(db, lineId, userId);
    const activeMatches = await getActiveMatchesForLine(db, lineId);

    return { line: updatedLine, matches: activeMatches };
    }

    async function unmatchStatementLine(db, lineId, body, userId = null) {
    const line = await getStatementLineCore(db, lineId);
    if (!line) {
        const err = new Error("Statement line not found");
        err.statusCode = 404;
        throw err;
    }

    let sql = `
        UPDATE bank_reconciliation_matches
        SET status = 'REVERSED', reversed_by = ?, reversed_at = NOW()
        WHERE statement_line_id = ? AND status = 'ACTIVE'
    `;
    const params = [userId, lineId];

    if (body.match_id) {
        sql += ` AND id = ?`;
        params.push(body.match_id);
    }

    const [result] = await db.query(sql, params);
    if (!result.affectedRows) {
        const err = new Error("No active match found to unmatch");
        err.statusCode = 400;
        throw err;
    }

    await writeAudit(db, {
        statementLineId: lineId,
        action: "UNMATCHED",
        payload: { match_id: body.match_id || null, reversed_count: result.affectedRows, notes: body.notes || null },
        userId,
    });

    // If line was ignored before, keep ignored; otherwise recompute
    if (line.recon_status !== "IGNORED") {
        await recomputeLineReconStatus(db, lineId, userId);
    }

    return {
        line: await getStatementLineCore(db, lineId),
        matches: await getActiveMatchesForLine(db, lineId),
    };
    }

    async function ignoreStatementLine(db, lineId, body, userId = null) {
    const line = await getStatementLineCore(db, lineId);
    if (!line) {
        const err = new Error("Statement line not found");
        err.statusCode = 404;
        throw err;
    }

    const [activeRows] = await db.query(
        `SELECT COUNT(*) AS c FROM bank_reconciliation_matches WHERE statement_line_id = ? AND status = 'ACTIVE'`,
        [lineId]
    );
    if (Number(activeRows[0]?.c || 0) > 0) {
        const err = new Error("Cannot ignore a line with active matches. Unmatch first.");
        err.statusCode = 400;
        throw err;
    }

    if (line.recon_status !== "IGNORED") {
        await db.query(`UPDATE bank_statement_lines SET recon_status = 'IGNORED' WHERE id = ?`, [lineId]);
    }

    await writeAudit(db, {
        statementLineId: lineId,
        action: "IGNORE",
        payload: { reason: body.reason || null },
        userId,
    });

    return getStatementLineCore(db, lineId);
    }

    async function listReconciliationAudit(db, query) {
    const where = [];
    const params = [];

    if (query.statement_line_id) {
        where.push(`a.statement_line_id = ?`);
        params.push(query.statement_line_id);
    }

    let sql = `
        SELECT
        a.id, a.statement_line_id, a.action, a.payload_json, a.acted_by, a.acted_at,
        l.txn_date, l.description, l.amount, l.currency_code,
        b.code AS bank_account_code
        FROM bank_reconciliation_audit a
        JOIN bank_statement_lines l ON l.id = a.statement_line_id
        JOIN bank_accounts b ON b.id = l.bank_account_id
    `;

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY a.id DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    module.exports = {
    listReconciliationQueue,
    getSuggestionsForLine,
    matchStatementLine,
    unmatchStatementLine,
    ignoreStatementLine,
    listReconciliationAudit,
    };
    ```

    ---

    ## 4) Routes — `backend/src/routes/bank.reconciliation.js`

    ```js
    // backend/src/routes/bank.reconciliation.js

    const express = require("express");
    const {
    validateLineIdParam,
    validateQueueQuery,
    validateAuditQuery,
    validateMatchBody,
    validateUnmatchBody,
    validateIgnoreBody,
    } = require("./bank.reconciliation.validators");
    const service = require("../services/bank.reconciliation.service");

    // Replace with your actual helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/bank/reconciliation/queue
    router.get(
    "/reconciliation/queue",
    requireAuth,
    requirePermission("bank.reconcile.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateQueueQuery(req.query);
        const items = await service.listReconciliationQueue(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/reconciliation/queue/:lineId/suggestions
    router.get(
    "/reconciliation/queue/:lineId/suggestions",
    requireAuth,
    requirePermission("bank.reconcile.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { lineId } = validateLineIdParam(req.params);
        const userId = req.user?.id ?? null;
        const result = await service.getSuggestionsForLine(db, lineId, userId);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/reconciliation/queue/:lineId/match
    router.post(
    "/reconciliation/queue/:lineId/match",
    requireAuth,
    requirePermission("bank.reconcile.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { lineId } = validateLineIdParam(req.params);
        const body = validateMatchBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.matchStatementLine(db, lineId, body, userId);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/reconciliation/queue/:lineId/unmatch
    router.post(
    "/reconciliation/queue/:lineId/unmatch",
    requireAuth,
    requirePermission("bank.reconcile.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { lineId } = validateLineIdParam(req.params);
        const body = validateUnmatchBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.unmatchStatementLine(db, lineId, body, userId);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/bank/reconciliation/queue/:lineId/ignore
    router.post(
    "/reconciliation/queue/:lineId/ignore",
    requireAuth,
    requirePermission("bank.reconcile.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { lineId } = validateLineIdParam(req.params);
        const body = validateIgnoreBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.ignoreStatementLine(db, lineId, body, userId);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/bank/reconciliation/audit
    router.get(
    "/reconciliation/audit",
    requireAuth,
    requirePermission("bank.reconcile.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateAuditQuery(req.query);
        const items = await service.listReconciliationAudit(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 5) Mount route — `backend/src/index.js`

    ```js
    // backend/src/index.js
    const bankReconciliationRoutes = require("./routes/bank.reconciliation");

    // ...
    app.use("/api/v1/bank", bankReconciliationRoutes);
    ```

    ---

    ## 6) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m023_bank_reconciliation = require("./m023_bank_reconciliation");

    module.exports = [
    // ...
    m023_bank_reconciliation,
    ];
    ```

    ---

    ## 7) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const BANK_RECON_PERMISSIONS = [
    "bank.reconcile.read",
    "bank.reconcile.write",
    ];

    // merge into your permission seed list
    ```

    ---

    ## 8) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `GET /api/v1/bank/reconciliation/queue`
    * `GET /api/v1/bank/reconciliation/queue/{lineId}/suggestions`
    * `POST /api/v1/bank/reconciliation/queue/{lineId}/match`
    * `POST /api/v1/bank/reconciliation/queue/{lineId}/unmatch`
    * `POST /api/v1/bank/reconciliation/queue/{lineId}/ignore`
    * `GET /api/v1/bank/reconciliation/audit`

    ---

    ## 9) Backend smoke test — `backend/scripts/test-bank-prb03-reconciliation.js`

    > This should be a real script with your existing test helpers (supertest / app bootstrap).
    > The key is **behavior**, not exact framework.

    ```js
    // backend/scripts/test-bank-prb03-reconciliation.js

    async function main() {
    // Pseudocode:
    //
    // Preconditions:
    // - PR-B01 bank account exists (linked to a bank GL account)
    // - PR-B02 statement import exists (at least 1 UNMATCHED line)
    // - Create a POSTED journal in GL hitting the same bank GL account and same amount/date
    //
    // Test flow:
    // 1) GET /api/v1/bank/reconciliation/queue -> line appears as UNMATCHED
    // 2) GET /api/v1/bank/reconciliation/queue/:lineId/suggestions -> journal suggestion returned
    // 3) POST /match with JOURNAL + exact amount -> line becomes MATCHED
    // 4) GET /audit -> MATCHED and AUTO_STATUS rows exist
    // 5) POST /unmatch -> line returns UNMATCHED
    // 6) POST /ignore -> line becomes IGNORED
    // 7) POST /match on IGNORED line -> should fail (400)
    // 8) Permission checks -> 403 without bank.reconcile.read/write
    //
    console.log("PR-B03 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    ---

    ## 10) `backend/package.json` updates

    ```json
    {
    "scripts": {
        "test:bank:prb03": "node backend/scripts/test-bank-prb03-reconciliation.js"
    }
    }
    ```

    (Adjust path if your `package.json` is inside `/backend`)

    ---

    # Frontend skeletons

    ## 11) API client — `frontend/src/api/bankReconciliation.js`

    ```js
    // frontend/src/api/bankReconciliation.js

    import { apiFetch } from "./client"; // adapt to your helper

    export function listReconciliationQueue(params = {}) {
    const q = new URLSearchParams();
    if (params.bank_account_id) q.set("bank_account_id", String(params.bank_account_id));
    if (params.recon_status) q.set("recon_status", String(params.recon_status));
    if (params.q) q.set("q", String(params.q));
    const qs = q.toString();
    return apiFetch(`/api/v1/bank/reconciliation/queue${qs ? `?${qs}` : ""}`);
    }

    export function getReconciliationSuggestions(lineId) {
    return apiFetch(`/api/v1/bank/reconciliation/queue/${lineId}/suggestions`);
    }

    export function matchReconciliationLine(lineId, payload) {
    return apiFetch(`/api/v1/bank/reconciliation/queue/${lineId}/match`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function unmatchReconciliationLine(lineId, payload = {}) {
    return apiFetch(`/api/v1/bank/reconciliation/queue/${lineId}/unmatch`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function ignoreReconciliationLine(lineId, payload = {}) {
    return apiFetch(`/api/v1/bank/reconciliation/queue/${lineId}/ignore`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function listReconciliationAudit(params = {}) {
    const q = new URLSearchParams();
    if (params.statement_line_id) q.set("statement_line_id", String(params.statement_line_id));
    const qs = q.toString();
    return apiFetch(`/api/v1/bank/reconciliation/audit${qs ? `?${qs}` : ""}`);
    }
    ```

    ---

    ## 12) Page — `frontend/src/pages/bank/BankReconciliationPage.jsx`

    > Simple but useful v1:
    >
    > * queue table
    > * “Suggestions” per line
    > * one-click exact match from suggestion
    > * unmatch / ignore
    > * audit drawer-ish panel (basic)

    ```jsx
    // frontend/src/pages/bank/BankReconciliationPage.jsx

    import { useEffect, useState } from "react";
    import {
    listReconciliationQueue,
    getReconciliationSuggestions,
    matchReconciliationLine,
    unmatchReconciliationLine,
    ignoreReconciliationLine,
    listReconciliationAudit,
    } from "../../api/bankReconciliation";

    export default function BankReconciliationPage() {
    const [items, setItems] = useState([]);
    const [bankAccountId, setBankAccountId] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    const [selectedLine, setSelectedLine] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [auditItems, setAuditItems] = useState([]);

    async function loadQueue() {
        setLoading(true);
        setErr("");
        try {
        const res = await listReconciliationQueue({
            bank_account_id: bankAccountId ? Number(bankAccountId) : undefined,
        });
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load reconciliation queue");
        } finally {
        setLoading(false);
        }
    }

    async function openLineActions(line) {
        setSelectedLine(line);
        setErr("");
        try {
        const [sRes, aRes] = await Promise.all([
            getReconciliationSuggestions(line.id),
            listReconciliationAudit({ statement_line_id: line.id }),
        ]);
        setSuggestions(sRes.suggestions || []);
        setAuditItems(aRes.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load line details");
        }
    }

    async function matchSuggestion(line, s) {
        setErr("");
        try {
        await matchReconciliationLine(line.id, {
            matched_entity_type: s.matched_entity_type,
            matched_entity_id: s.matched_entity_id,
            matched_amount: Math.abs(Number(line.amount)),
            match_type: "MANUAL",
        });
        await loadQueue();
        await openLineActions({ ...line });
        } catch (e) {
        setErr(e.message || "Match failed");
        }
    }

    async function unmatchLine(line) {
        setErr("");
        try {
        await unmatchReconciliationLine(line.id, {});
        await loadQueue();
        await openLineActions({ ...line });
        } catch (e) {
        setErr(e.message || "Unmatch failed");
        }
    }

    async function ignoreLine(line) {
        const reason = window.prompt("Ignore reason (optional):", "") || "";
        setErr("");
        try {
        await ignoreReconciliationLine(line.id, { reason });
        await loadQueue();
        await openLineActions({ ...line });
        } catch (e) {
        setErr(e.message || "Ignore failed");
        }
    }

    useEffect(() => {
        loadQueue();
    }, []);

    return (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded border bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
            <h1 className="text-lg font-semibold">Bank Reconciliation</h1>
            <input
                className="border rounded px-2 py-1 ml-auto w-48"
                placeholder="Bank Account ID"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
            />
            <button className="px-3 py-1 rounded border" onClick={loadQueue} type="button">
                Refresh
            </button>
            </div>

            {err ? <div className="text-sm text-red-600 mb-2">{err}</div> : null}

            {loading ? (
            <div>Loading...</div>
            ) : (
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Desc</th>
                    <th className="text-left p-2">Ref</th>
                    <th className="text-left p-2">Amount</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Matched</th>
                    <th className="text-left p-2">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((row) => (
                    <tr key={row.id} className="border-b">
                        <td className="p-2">{row.txn_date}</td>
                        <td className="p-2">{row.description}</td>
                        <td className="p-2">{row.reference_no || "-"}</td>
                        <td className="p-2">{row.amount}</td>
                        <td className="p-2">{row.recon_status}</td>
                        <td className="p-2">{row.active_matched_total || 0}</td>
                        <td className="p-2 space-x-2">
                        <button className="underline" type="button" onClick={() => openLineActions(row)}>
                            Details
                        </button>
                        {row.recon_status !== "IGNORED" && (
                            <button className="underline" type="button" onClick={() => ignoreLine(row)}>
                            Ignore
                            </button>
                        )}
                        </td>
                    </tr>
                    ))}
                    {items.length === 0 && (
                    <tr>
                        <td colSpan={7} className="p-2">
                        No reconciliation items.
                        </td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
            )}
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Line Details</h2>

            {!selectedLine ? (
            <div className="text-sm text-gray-600">Select a line from the queue.</div>
            ) : (
            <div className="space-y-4 text-sm">
                <div>
                <div><b>Date:</b> {selectedLine.txn_date}</div>
                <div><b>Description:</b> {selectedLine.description}</div>
                <div><b>Amount:</b> {selectedLine.amount} {selectedLine.currency_code}</div>
                <div><b>Status:</b> {selectedLine.recon_status}</div>
                </div>

                <div>
                <div className="font-medium mb-1">Suggestions</div>
                {suggestions.length === 0 ? (
                    <div className="text-gray-600">No suggestions.</div>
                ) : (
                    <div className="space-y-2">
                    {suggestions.map((s) => (
                        <div key={`${s.matched_entity_type}-${s.matched_entity_id}`} className="border rounded p-2">
                        <div>{s.display_ref}</div>
                        <div className="text-gray-600">{s.display_text}</div>
                        <div className="text-gray-600">Score: {s.score}</div>
                        <button
                            className="underline mt-1"
                            type="button"
                            onClick={() => matchSuggestion(selectedLine, s)}
                        >
                            Match exact amount
                        </button>
                        </div>
                    ))}
                    </div>
                )}
                </div>

                <div className="space-x-2">
                <button className="px-2 py-1 border rounded" type="button" onClick={() => unmatchLine(selectedLine)}>
                    Unmatch all
                </button>
                </div>

                <div>
                <div className="font-medium mb-1">Audit</div>
                <div className="space-y-1 max-h-64 overflow-auto">
                    {auditItems.map((a) => (
                    <div key={a.id} className="border rounded p-2">
                        <div><b>{a.action}</b> — {a.acted_at}</div>
                        <div className="text-gray-600">{a.bank_account_code}</div>
                    </div>
                    ))}
                    {auditItems.length === 0 && <div className="text-gray-600">No audit rows yet.</div>}
                </div>
                </div>
            </div>
            )}
        </div>
        </div>
    );
    }
    ```

    ---

    ## 13) App route — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import BankReconciliationPage from "./pages/bank/BankReconciliationPage";

    // ...
    <Route
    path="/bank/reconciliation"
    element={
        <RequirePermission permission="bank.reconcile.read">
        <BankReconciliationPage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 14) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    Add under Bank:

    ```js
    // frontend/src/layouts/sidebarConfig.js
    {
    key: "bank-reconciliation",
    label: "Reconciliation",
    to: "/bank/reconciliation",
    permission: "bank.reconcile.read",
    }
    ```

    ---

    ## 15) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.bankReconciliation": "Reconciliation",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Reconciliation queue lists statement lines with `UNMATCHED / PARTIAL / IGNORED`
    * ✅ Suggestions endpoint returns candidate matches (v1 journal-based)
    * ✅ Manual match creates `bank_reconciliation_matches` row and updates line status
    * ✅ Unmatch reverses active match(es) and recalculates line status
    * ✅ Ignore marks line as `IGNORED` and logs audit action
    * ✅ Every reconciliation action writes audit rows
    * ✅ Permissions enforced (`bank.reconcile.read/write`)
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:bank:prb03`

    Should verify at least:

    1. **Queue load**

    * GET `/api/v1/bank/reconciliation/queue`
    * imported statement line appears with `recon_status=UNMATCHED`

    2. **Suggestions**

    * create a matching posted journal (same bank GL + amount/date)
    * GET `/queue/:lineId/suggestions`
    * receives at least one `JOURNAL` suggestion

    3. **Manual match exact**

    * POST `/queue/:lineId/match` with `JOURNAL`
    * line status becomes `MATCHED`
    * active match total equals statement line absolute amount

    4. **Partial match behavior**

    * on a different line, match less than full amount
    * line status becomes `PARTIAL`

    5. **Unmatch**

    * POST `/queue/:lineId/unmatch`
    * active matches reversed
    * line status recalculates to `UNMATCHED`

    6. **Ignore**

    * POST `/queue/:lineId/ignore`
    * line status becomes `IGNORED`

    7. **Ignore safety**

    * trying to ignore line with active matches returns `400`

    8. **Audit**

    * GET `/api/v1/bank/reconciliation/audit`
    * contains `SUGGESTED`, `MATCHED`, `UNMATCHED`, `IGNORE`, `AUTO_STATUS` events as applicable

    9. **Permissions**

    * read/write endpoints reject users without `bank.reconcile.read/write` (`403`)

    ---

    # Example manual API payloads

    ## Manual match (journal)

    ```json
    {
    "matched_entity_type": "JOURNAL",
    "matched_entity_id": 12345,
    "matched_amount": 12500.00,
    "match_type": "MANUAL",
    "notes": "Matched to payroll settlement JE"
    }
    ```

    ## Unmatch specific match

    ```json
    {
    "match_id": 987,
    "notes": "Wrong journal selected"
    }
    ```

    ## Ignore line

    ```json
    {
    "reason": "Bank fee to be handled in month-end adjustment"
    }
    ```

    ---

    # Tiny implementation notes (important)

    * **B03 supports JOURNAL matching first** (cleanest dependency-wise).
    * `PAYMENT_BATCH` matching is intentionally blocked until **PR-B04** creates that module.
    * Keep `matched_amount` **positive** and compare against `ABS(statement_line.amount)`.
    * Don’t auto-post GL adjustments in this PR; exceptions stay visible in queue.

Perfect — here’s **PR-B04** in the same concrete format.

# PR-B04: Generic Payment Batch Engine (Reusable for Payroll / AP / Tax)

    ## Goal

    Build a **generic payment batch** module that can be reused by:

    * Payroll (later PR-P04)
    * Vendor/AP payments
    * Tax remittances
    * Manual payments

    For this PR, focus on:

    * ✅ Batch header + lines
    * ✅ Maker-checker approval
    * ✅ CSV export (v1)
    * ✅ Posting settlement journal(s): `Dr Payable / Cr Bank`
    * ✅ Idempotent posting
    * ✅ Audit trail

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m024_payment_batches.js`
    * `backend/src/routes/payments.js`
    * `backend/src/routes/payments.validators.js`
    * `backend/src/services/payments.service.js`
    * `backend/scripts/test-payments-prb04-batches.js`

    ### Frontend

    * `frontend/src/api/payments.js`
    * `frontend/src/pages/payments/PaymentBatchListPage.jsx`
    * `frontend/src/pages/payments/PaymentBatchDetailPage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js` (permissions)
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m024_payment_batches.js`

    > This is intentionally generic. `source_type/source_id` let Payroll/AP hook in later.

    ```js
    // backend/src/migrations/m024_payment_batches.js

    module.exports = {
    id: "m024_payment_batches",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS payment_batches (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_no VARCHAR(50) NOT NULL,
            source_type VARCHAR(30) NOT NULL, -- PAYROLL, AP, TAX, MANUAL
            source_id BIGINT UNSIGNED NULL,
            bank_account_id BIGINT UNSIGNED NOT NULL,
            currency_code CHAR(3) NOT NULL,
            total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, APPROVED, EXPORTED, POSTED, FAILED, CANCELLED
            idempotency_key VARCHAR(100) NULL,
            export_file_name VARCHAR(255) NULL,
            export_checksum CHAR(64) NULL,
            posted_journal_entry_id BIGINT UNSIGNED NULL,
            notes VARCHAR(500) NULL,
            created_by BIGINT UNSIGNED NULL,
            approved_by BIGINT UNSIGNED NULL,
            posted_by BIGINT UNSIGNED NULL,
            exported_by BIGINT UNSIGNED NULL,
            approved_at DATETIME NULL,
            posted_at DATETIME NULL,
            exported_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_payment_batches_batch_no (batch_no),
            UNIQUE KEY uq_payment_batches_idempotency_key (idempotency_key),
            KEY idx_payment_batches_status (status),
            KEY idx_payment_batches_source (source_type, source_id),
            KEY idx_payment_batches_bank (bank_account_id),
            CONSTRAINT fk_payment_batches_bank_account
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payment_batch_lines (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_id BIGINT UNSIGNED NOT NULL,
            line_no INT UNSIGNED NOT NULL,
            beneficiary_type VARCHAR(30) NOT NULL, -- EMPLOYEE, VENDOR, TAX_AUTHORITY, OTHER
            beneficiary_id BIGINT UNSIGNED NULL,
            beneficiary_name VARCHAR(255) NOT NULL,
            beneficiary_bank_ref VARCHAR(255) NULL,
            payable_entity_type VARCHAR(30) NOT NULL, -- PAYROLL_LIABILITY, AP_INVOICE, TAX_LIABILITY, MANUAL
            payable_entity_id BIGINT UNSIGNED NULL,
            payable_gl_account_id BIGINT UNSIGNED NOT NULL,
            payable_ref VARCHAR(100) NULL,
            amount DECIMAL(18,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, CANCELLED
            external_payment_ref VARCHAR(100) NULL,
            settlement_journal_line_ref VARCHAR(100) NULL,
            notes VARCHAR(500) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_payment_batch_lines_batch_lineno (batch_id, line_no),
            KEY idx_payment_batch_lines_batch (batch_id),
            KEY idx_payment_batch_lines_payable (payable_entity_type, payable_entity_id),
            KEY idx_payment_batch_lines_status (status),
            CONSTRAINT fk_payment_batch_lines_batch
            FOREIGN KEY (batch_id) REFERENCES payment_batches(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,
            CONSTRAINT fk_payment_batch_lines_payable_gl
            FOREIGN KEY (payable_gl_account_id) REFERENCES accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payment_batch_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_id BIGINT UNSIGNED NOT NULL,
            action VARCHAR(30) NOT NULL, -- CREATED, UPDATED, APPROVED, EXPORTED, POSTED, CANCELLED, FAILED, STATUS
            payload_json JSON NULL,
            acted_by BIGINT UNSIGNED NULL,
            acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_payment_batch_audit_batch (batch_id),
            KEY idx_payment_batch_audit_action (action),
            CONSTRAINT fk_payment_batch_audit_batch
            FOREIGN KEY (batch_id) REFERENCES payment_batches(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS payment_batch_audit;`);
        await db.query(`DROP TABLE IF EXISTS payment_batch_lines;`);
        await db.query(`DROP TABLE IF EXISTS payment_batches;`);
    },
    };
    ```

    ---

    ## 2) Validators — `backend/src/routes/payments.validators.js`

    ```js
    // backend/src/routes/payments.validators.js

    function requirePositiveInt(value, field) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be positive integer`);
    return n;
    }

    function requirePositiveAmount(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be positive number`);
    return Number(n.toFixed(2));
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function requireCurrency(v) {
    const s = String(v || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(s)) throw new Error("currency_code must be 3 letters");
    return s;
    }

    function validateIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateListBatchesQuery(query = {}) {
    return {
        status: query.status ? String(query.status).trim().toUpperCase() : null,
        source_type: query.source_type ? String(query.source_type).trim().toUpperCase() : null,
        source_id: query.source_id ? requirePositiveInt(query.source_id, "source_id") : null,
        bank_account_id: query.bank_account_id ? requirePositiveInt(query.bank_account_id, "bank_account_id") : null,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 200) : 50,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateCreateBatch(body = {}) {
    const source_type = String(body.source_type || "").trim().toUpperCase();
    const allowedSourceTypes = ["PAYROLL", "AP", "TAX", "MANUAL"];
    if (!allowedSourceTypes.includes(source_type)) {
        throw new Error(`source_type must be one of ${allowedSourceTypes.join(", ")}`);
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
        throw new Error("lines[] is required");
    }

    const lines = body.lines.map((line, i) => {
        const beneficiary_type = String(line.beneficiary_type || "").trim().toUpperCase();
        const payable_entity_type = String(line.payable_entity_type || "").trim().toUpperCase();
        if (!beneficiary_type) throw new Error(`lines[${i}].beneficiary_type is required`);
        if (!payable_entity_type) throw new Error(`lines[${i}].payable_entity_type is required`);

        return {
        beneficiary_type,
        beneficiary_id: line.beneficiary_id ? requirePositiveInt(line.beneficiary_id, `lines[${i}].beneficiary_id`) : null,
        beneficiary_name: String(line.beneficiary_name || "").trim() || (() => { throw new Error(`lines[${i}].beneficiary_name is required`); })(),
        beneficiary_bank_ref: normalizeString(line.beneficiary_bank_ref),
        payable_entity_type,
        payable_entity_id: line.payable_entity_id ? requirePositiveInt(line.payable_entity_id, `lines[${i}].payable_entity_id`) : null,
        payable_gl_account_id: requirePositiveInt(line.payable_gl_account_id, `lines[${i}].payable_gl_account_id`),
        payable_ref: normalizeString(line.payable_ref),
        amount: requirePositiveAmount(line.amount, `lines[${i}].amount`),
        notes: normalizeString(line.notes),
        };
    });

    return {
        source_type,
        source_id: body.source_id ? requirePositiveInt(body.source_id, "source_id") : null,
        bank_account_id: requirePositiveInt(body.bank_account_id, "bank_account_id"),
        currency_code: requireCurrency(body.currency_code),
        idempotency_key: normalizeString(body.idempotency_key),
        notes: normalizeString(body.notes),
        lines,
    };
    }

    function validateApproveBody(body = {}) {
    return { note: normalizeString(body.note) };
    }

    function validateExportBody(body = {}) {
    return { format: (normalizeString(body.format) || "CSV").toUpperCase() };
    }

    function validatePostBody(body = {}) {
    return {
        note: normalizeString(body.note),
        external_payment_ref_prefix: normalizeString(body.external_payment_ref_prefix),
    };
    }

    function validateCancelBody(body = {}) {
    return { reason: normalizeString(body.reason) };
    }

    module.exports = {
    validateIdParam,
    validateListBatchesQuery,
    validateCreateBatch,
    validateApproveBody,
    validateExportBody,
    validatePostBody,
    validateCancelBody,
    };
    ```

    ---

    ## 3) Service — `backend/src/services/payments.service.js`

    > Replace GL posting table names (`journal_entries`, `journal_entry_lines`) with your actual schema names if needed.

    ```js
    // backend/src/services/payments.service.js

    const crypto = require("crypto");

    function sha256(v) {
    return crypto.createHash("sha256").update(String(v)).digest("hex");
    }

    async function writeAudit(db, batchId, action, payload, userId = null) {
    await db.query(
        `INSERT INTO payment_batch_audit (batch_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?)`,
        [batchId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function getBankAccount(db, bankAccountId) {
    const [rows] = await db.query(
        `
        SELECT b.id, b.code, b.name, b.currency_code, b.gl_account_id, b.is_active
        FROM bank_accounts b
        WHERE b.id = ?
        LIMIT 1
        `,
        [bankAccountId]
    );
    if (!rows[0]) {
        const err = new Error("Bank account not found");
        err.statusCode = 400;
        throw err;
    }
    return rows[0];
    }

    async function assertAccountsExist(db, accountIds) {
    if (!accountIds.length) return;
    const placeholders = accountIds.map(() => "?").join(",");
    const [rows] = await db.query(
        `SELECT id FROM accounts WHERE id IN (${placeholders})`,
        accountIds
    );
    const found = new Set(rows.map((r) => Number(r.id)));
    for (const id of accountIds) {
        if (!found.has(Number(id))) {
        const err = new Error(`GL account not found: ${id}`);
        err.statusCode = 400;
        throw err;
        }
    }
    }

    function computeTotal(lines) {
    return Number(lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2));
    }

    async function nextBatchNo(db) {
    // Simple deterministic sequence by id count; replace with your numbering service if you have one
    const [rows] = await db.query(`SELECT COALESCE(MAX(id),0) + 1 AS next_id FROM payment_batches`);
    const n = Number(rows[0]?.next_id || 1);
    return `PAY-${String(n).padStart(6, "0")}`;
    }

    async function getBatchById(db, id) {
    const [batches] = await db.query(
        `
        SELECT
        pb.*,
        ba.code AS bank_account_code,
        ba.name AS bank_account_name,
        ba.gl_account_id AS bank_gl_account_id
        FROM payment_batches pb
        JOIN bank_accounts ba ON ba.id = pb.bank_account_id
        WHERE pb.id = ?
        LIMIT 1
        `,
        [id]
    );
    const batch = batches[0];
    if (!batch) return null;

    const [lines] = await db.query(
        `
        SELECT *
        FROM payment_batch_lines
        WHERE batch_id = ?
        ORDER BY line_no ASC
        `,
        [id]
    );

    return { ...batch, lines };
    }

    async function listBatches(db, query) {
    const where = [];
    const params = [];

    if (query.status) {
        where.push(`pb.status = ?`);
        params.push(query.status);
    }
    if (query.source_type) {
        where.push(`pb.source_type = ?`);
        params.push(query.source_type);
    }
    if (query.source_id) {
        where.push(`pb.source_id = ?`);
        params.push(query.source_id);
    }
    if (query.bank_account_id) {
        where.push(`pb.bank_account_id = ?`);
        params.push(query.bank_account_id);
    }

    let sql = `
        SELECT
        pb.id, pb.batch_no, pb.source_type, pb.source_id, pb.bank_account_id,
        pb.currency_code, pb.total_amount, pb.status, pb.created_at, pb.approved_at, pb.posted_at,
        ba.code AS bank_account_code, ba.name AS bank_account_name,
        (SELECT COUNT(*) FROM payment_batch_lines l WHERE l.batch_id = pb.id) AS line_count
        FROM payment_batches pb
        JOIN bank_accounts ba ON ba.id = pb.bank_account_id
    `;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY pb.id DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function createBatch(db, payload, userId = null) {
    const bank = await getBankAccount(db, payload.bank_account_id);
    if (!bank.is_active) {
        const err = new Error("Cannot create payment batch on inactive bank account");
        err.statusCode = 400;
        throw err;
    }
    if (bank.currency_code !== payload.currency_code) {
        const err = new Error(`Currency mismatch. Bank=${bank.currency_code} payload=${payload.currency_code}`);
        err.statusCode = 400;
        throw err;
    }

    const accountIds = [...new Set(payload.lines.map((l) => Number(l.payable_gl_account_id)))];
    await assertAccountsExist(db, accountIds);

    if (payload.idempotency_key) {
        const [dup] = await db.query(
        `SELECT id FROM payment_batches WHERE idempotency_key = ? LIMIT 1`,
        [payload.idempotency_key]
        );
        if (dup[0]) {
        const existing = await getBatchById(db, dup[0].id);
        return existing; // idempotent create returns existing
        }
    }

    // Prevent duplicate open usage of same payable target in active batches (draft/approved/exported)
    for (const line of payload.lines) {
        if (!line.payable_entity_id) continue;
        const [rows] = await db.query(
        `
        SELECT pbl.id, pb.batch_no, pb.status
        FROM payment_batch_lines pbl
        JOIN payment_batches pb ON pb.id = pbl.batch_id
        WHERE pbl.payable_entity_type = ?
            AND pbl.payable_entity_id = ?
            AND pbl.status IN ('PENDING')
            AND pb.status IN ('DRAFT', 'APPROVED', 'EXPORTED', 'POSTED')
        LIMIT 1
        `,
        [line.payable_entity_type, line.payable_entity_id]
        );
        if (rows[0]) {
        const err = new Error(
            `Payable already linked to another active batch (${rows[0].batch_no}, status=${rows[0].status})`
        );
        err.statusCode = 409;
        throw err;
        }
    }

    const total = computeTotal(payload.lines);
    const batchNo = await nextBatchNo(db);

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const [insBatch] = await q.query(
        `
        INSERT INTO payment_batches
        (batch_no, source_type, source_id, bank_account_id, currency_code, total_amount, status, idempotency_key, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
        `,
        [
            batchNo,
            payload.source_type,
            payload.source_id,
            payload.bank_account_id,
            payload.currency_code,
            total,
            payload.idempotency_key || null,
            payload.notes || null,
            userId,
        ]
        );

        const batchId = insBatch.insertId;

        let lineNo = 1;
        for (const line of payload.lines) {
        await q.query(
            `
            INSERT INTO payment_batch_lines
            (batch_id, line_no, beneficiary_type, beneficiary_id, beneficiary_name, beneficiary_bank_ref,
            payable_entity_type, payable_entity_id, payable_gl_account_id, payable_ref, amount, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
            `,
            [
            batchId,
            lineNo++,
            line.beneficiary_type,
            line.beneficiary_id,
            line.beneficiary_name,
            line.beneficiary_bank_ref,
            line.payable_entity_type,
            line.payable_entity_id,
            line.payable_gl_account_id,
            line.payable_ref,
            line.amount,
            line.notes || null,
            ]
        );
        }

        await writeAudit(q, batchId, "CREATED", { total_amount: total, line_count: payload.lines.length }, userId);

        if (conn) await conn.commit();

        return getBatchById(db, batchId);
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    async function approveBatch(db, id, userId = null, body = {}) {
    const batch = await getBatchById(db, id);
    if (!batch) {
        const err = new Error("Batch not found");
        err.statusCode = 404;
        throw err;
    }
    if (batch.status !== "DRAFT") {
        const err = new Error("Only DRAFT batches can be approved");
        err.statusCode = 400;
        throw err;
    }
    if (batch.created_by && userId && Number(batch.created_by) === Number(userId)) {
        // Optional maker-checker; keep if you want strict SoD immediately
        const err = new Error("Creator cannot approve the same batch");
        err.statusCode = 403;
        throw err;
    }

    await db.query(
        `UPDATE payment_batches SET status='APPROVED', approved_by=?, approved_at=NOW() WHERE id=?`,
        [userId, id]
    );
    await writeAudit(db, id, "APPROVED", { note: body.note || null }, userId);
    return getBatchById(db, id);
    }

    function buildCsv(batch) {
    const header = [
        "line_no",
        "beneficiary_name",
        "beneficiary_bank_ref",
        "amount",
        "currency_code",
        "payable_entity_type",
        "payable_entity_id",
        "payable_ref",
    ];
    const rows = [header.join(",")];

    for (const line of batch.lines) {
        const vals = [
        line.line_no,
        line.beneficiary_name,
        line.beneficiary_bank_ref || "",
        Number(line.amount).toFixed(2),
        batch.currency_code,
        line.payable_entity_type,
        line.payable_entity_id || "",
        line.payable_ref || "",
        ].map((v) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        });
        rows.push(vals.join(","));
    }

    return rows.join("\n");
    }

    async function exportBatch(db, id, userId = null, body = {}) {
    const batch = await getBatchById(db, id);
    if (!batch) {
        const err = new Error("Batch not found");
        err.statusCode = 404;
        throw err;
    }
    if (!["APPROVED", "EXPORTED"].includes(batch.status)) {
        const err = new Error("Only APPROVED/EXPORTED batches can be exported");
        err.statusCode = 400;
        throw err;
    }
    if ((body.format || "CSV") !== "CSV") {
        const err = new Error("Only CSV export is supported in v1");
        err.statusCode = 400;
        throw err;
    }

    const csv = buildCsv(batch);
    const checksum = sha256(csv);
    const fileName = `${batch.batch_no}.csv`;

    await db.query(
        `
        UPDATE payment_batches
        SET status='EXPORTED', export_file_name=?, export_checksum=?, exported_by=?, exported_at=NOW()
        WHERE id=?
        `,
        [fileName, checksum, userId, id]
    );
    await writeAudit(db, id, "EXPORTED", { file_name: fileName, checksum }, userId);

    const fresh = await getBatchById(db, id);
    return { batch: fresh, export: { file_name: fileName, checksum, csv } };
    }

    async function createSettlementJournal(db, batch, userId = null, body = {}) {
    // Adapt these table names/columns to your GL schema.
    // Assumes:
    // - journal_entries(id, journal_no, status, memo, posted_at, created_by)
    // - journal_entry_lines(id, journal_entry_id, line_no, account_id, dr_amount, cr_amount, amount, memo)
    const bankGl = Number(batch.bank_gl_account_id);
    const total = Number(batch.total_amount);

    // Header
    const [jeIns] = await db.query(
        `
        INSERT INTO journal_entries
        (journal_no, status, memo, posted_at, created_by)
        VALUES (?, 'POSTED', ?, NOW(), ?)
        `,
        [
        `PAYSET-${batch.batch_no}`,
        `Payment batch settlement ${batch.batch_no}`,
        userId,
        ]
    );
    const journalId = jeIns.insertId;

    let lineNo = 1;
    // Debit payables per line
    for (const l of batch.lines) {
        const amount = Number(l.amount);
        await db.query(
        `
        INSERT INTO journal_entry_lines
        (journal_entry_id, line_no, account_id, dr_amount, cr_amount, amount, memo)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        `,
        [
            journalId,
            lineNo++,
            Number(l.payable_gl_account_id),
            amount,
            amount,
            `Settlement ${batch.batch_no} line ${l.line_no}`,
        ]
        );
    }

    // Credit bank (single summarized line)
    await db.query(
        `
        INSERT INTO journal_entry_lines
        (journal_entry_id, line_no, account_id, dr_amount, cr_amount, amount, memo)
        VALUES (?, ?, ?, 0, ?, ?, ?)
        `,
        [
        journalId,
        lineNo++,
        bankGl,
        total,
        -total,
        `Settlement ${batch.batch_no} bank credit`,
        ]
    );

    return journalId;
    }

    async function postBatch(db, id, userId = null, body = {}) {
    const batch = await getBatchById(db, id);
    if (!batch) {
        const err = new Error("Batch not found");
        err.statusCode = 404;
        throw err;
    }

    if (batch.status === "POSTED" && batch.posted_journal_entry_id) {
        // idempotent
        return batch;
    }

    if (!["APPROVED", "EXPORTED"].includes(batch.status)) {
        const err = new Error("Only APPROVED/EXPORTED batches can be posted");
        err.statusCode = 400;
        throw err;
    }

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const current = await getBatchById(q, id);
        if (current.status === "POSTED" && current.posted_journal_entry_id) {
        if (conn) await conn.commit();
        return current;
        }

        const journalId = await createSettlementJournal(q, current, userId, body);

        await q.query(
        `
        UPDATE payment_batches
        SET status='POSTED', posted_journal_entry_id=?, posted_by=?, posted_at=NOW()
        WHERE id=?
        `,
        [journalId, userId, id]
        );

        await q.query(
        `
        UPDATE payment_batch_lines
        SET status='PAID',
            external_payment_ref = COALESCE(external_payment_ref, ?)
        WHERE batch_id=? AND status='PENDING'
        `,
        [body.external_payment_ref_prefix ? `${body.external_payment_ref_prefix}-${id}` : `PB-${id}`, id]
        );

        await writeAudit(q, id, "POSTED", { posted_journal_entry_id: journalId, note: body.note || null }, userId);

        if (conn) await conn.commit();
        return getBatchById(db, id);
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    async function cancelBatch(db, id, userId = null, body = {}) {
    const batch = await getBatchById(db, id);
    if (!batch) {
        const err = new Error("Batch not found");
        err.statusCode = 404;
        throw err;
    }
    if (["POSTED", "CANCELLED"].includes(batch.status)) {
        const err = new Error(`Cannot cancel batch in status ${batch.status}`);
        err.statusCode = 400;
        throw err;
    }

    await db.query(
        `UPDATE payment_batches SET status='CANCELLED' WHERE id=?`,
        [id]
    );
    await db.query(
        `UPDATE payment_batch_lines SET status='CANCELLED' WHERE batch_id=? AND status='PENDING'`,
        [id]
    );
    await writeAudit(db, id, "CANCELLED", { reason: body.reason || null }, userId);

    return getBatchById(db, id);
    }

    async function listBatchAudit(db, batchId) {
    const [rows] = await db.query(
        `
        SELECT id, batch_id, action, payload_json, acted_by, acted_at
        FROM payment_batch_audit
        WHERE batch_id=?
        ORDER BY id DESC
        `,
        [batchId]
    );
    return rows;
    }

    module.exports = {
    listBatches,
    getBatchById,
    createBatch,
    approveBatch,
    exportBatch,
    postBatch,
    cancelBatch,
    listBatchAudit,
    };
    ```

    ---

    ## 4) Routes — `backend/src/routes/payments.js`

    ```js
    // backend/src/routes/payments.js

    const express = require("express");
    const {
    validateIdParam,
    validateListBatchesQuery,
    validateCreateBatch,
    validateApproveBody,
    validateExportBody,
    validatePostBody,
    validateCancelBody,
    } = require("./payments.validators");
    const service = require("../services/payments.service");

    // Replace with your project helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/payments/batches
    router.get(
    "/batches",
    requireAuth,
    requirePermission("payments.batch.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListBatchesQuery(req.query);
        const items = await service.listBatches(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payments/batches/:id
    router.get(
    "/batches/:id",
    requireAuth,
    requirePermission("payments.batch.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const row = await service.getBatchById(db, id);
        if (!row) return res.status(404).json({ error: "Not found" });
        const audit = await service.listBatchAudit(db, id);
        res.json({ ...row, audit });
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payments/batches
    router.post(
    "/batches",
    requireAuth,
    requirePermission("payments.batch.create"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const body = validateCreateBatch(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.createBatch(db, body, userId);
        res.status(201).json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payments/batches/:id/approve
    router.post(
    "/batches/:id/approve",
    requireAuth,
    requirePermission("payments.batch.approve"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const body = validateApproveBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.approveBatch(db, id, userId, body);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payments/batches/:id/export
    router.post(
    "/batches/:id/export",
    requireAuth,
    requirePermission("payments.batch.export"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const body = validateExportBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.exportBatch(db, id, userId, body);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payments/batches/:id/post
    router.post(
    "/batches/:id/post",
    requireAuth,
    requirePermission("payments.batch.post"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const body = validatePostBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.postBatch(db, id, userId, body);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payments/batches/:id/cancel
    router.post(
    "/batches/:id/cancel",
    requireAuth,
    requirePermission("payments.batch.create"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const body = validateCancelBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.cancelBatch(db, id, userId, body);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 5) Mount route — `backend/src/index.js`

    ```js
    // backend/src/index.js
    const paymentsRoutes = require("./routes/payments");

    // ...
    app.use("/api/v1/payments", paymentsRoutes);
    ```

    ---

    ## 6) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m024_payment_batches = require("./m024_payment_batches");

    module.exports = [
    // ...
    m024_payment_batches,
    ];
    ```

    ---

    ## 7) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const PAYMENT_PERMISSIONS = [
    "payments.batch.read",
    "payments.batch.create",
    "payments.batch.approve",
    "payments.batch.export",
    "payments.batch.post",
    ];

    // merge into your permission seed list
    ```

    ---

    ## 8) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `GET /api/v1/payments/batches`
    * `GET /api/v1/payments/batches/{id}`
    * `POST /api/v1/payments/batches`
    * `POST /api/v1/payments/batches/{id}/approve`
    * `POST /api/v1/payments/batches/{id}/export`
    * `POST /api/v1/payments/batches/{id}/post`
    * `POST /api/v1/payments/batches/{id}/cancel`

    ---

    ## 9) Backend smoke test — `backend/scripts/test-payments-prb04-batches.js`

    > This should be a real script with your app bootstrap + supertest.
    > Here’s the exact behavior to validate.

    ```js
    // backend/scripts/test-payments-prb04-batches.js

    async function main() {
    // Preconditions:
    // - PR-B01 bank account exists and is active
    // - Payable GL account(s) exist in accounts
    //
    // Flow:
    // 1) POST /api/v1/payments/batches (MANUAL source) with 2 lines
    //    -> 201, status DRAFT, total_amount = sum(lines)
    // 2) POST create same payload with same idempotency_key
    //    -> returns existing batch (idempotent create)
    // 3) POST /approve
    //    -> status APPROVED
    // 4) POST /export
    //    -> status EXPORTED, CSV returned, checksum present
    // 5) POST /post
    //    -> status POSTED, posted_journal_entry_id exists
    //    -> lines status = PAID
    // 6) POST /post again
    //    -> idempotent (no duplicate JE)
    // 7) GET /batches/:id
    //    -> audit includes CREATED/APPROVED/EXPORTED/POSTED
    // 8) Try create another active batch with same payable_entity target
    //    -> 409 duplicate payable protection
    // 9) Permission checks (read/create/approve/export/post)
    console.log("PR-B04 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    ---

    ## 10) `backend/package.json` updates

    ```json
    {
    "scripts": {
        "test:payments:prb04": "node backend/scripts/test-payments-prb04-batches.js"
    }
    }
    ```

    ---

    # Frontend skeletons

    ## 11) API client — `frontend/src/api/payments.js`

    ```js
    // frontend/src/api/payments.js

    import { apiFetch } from "./client"; // adapt

    export function listPaymentBatches(params = {}) {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.source_type) q.set("source_type", params.source_type);
    if (params.source_id) q.set("source_id", String(params.source_id));
    if (params.bank_account_id) q.set("bank_account_id", String(params.bank_account_id));
    const qs = q.toString();
    return apiFetch(`/api/v1/payments/batches${qs ? `?${qs}` : ""}`);
    }

    export function getPaymentBatch(id) {
    return apiFetch(`/api/v1/payments/batches/${id}`);
    }

    export function createPaymentBatch(payload) {
    return apiFetch(`/api/v1/payments/batches`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function approvePaymentBatch(id, payload = {}) {
    return apiFetch(`/api/v1/payments/batches/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function exportPaymentBatch(id, payload = { format: "CSV" }) {
    return apiFetch(`/api/v1/payments/batches/${id}/export`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function postPaymentBatch(id, payload = {}) {
    return apiFetch(`/api/v1/payments/batches/${id}/post`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function cancelPaymentBatch(id, payload = {}) {
    return apiFetch(`/api/v1/payments/batches/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }
    ```

    ---

    ## 12) List page — `frontend/src/pages/payments/PaymentBatchListPage.jsx`

    ```jsx
    // frontend/src/pages/payments/PaymentBatchListPage.jsx

    import { useEffect, useState } from "react";
    import { Link } from "react-router-dom";
    import { listPaymentBatches } from "../../api/payments";

    export default function PaymentBatchListPage() {
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);

    async function load() {
        setLoading(true);
        setErr("");
        try {
        const res = await listPaymentBatches({});
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load payment batches");
        } finally {
        setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    return (
        <div className="p-4">
        <div className="rounded border bg-white p-4">
            <div className="flex items-center mb-3">
            <h1 className="text-lg font-semibold">Payment Batches</h1>
            <Link className="ml-auto underline" to="/payments/batches/new">New Batch</Link>
            </div>

            {err ? <div className="text-sm text-red-600 mb-2">{err}</div> : null}

            {loading ? (
            <div>Loading...</div>
            ) : (
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Batch No</th>
                    <th className="text-left p-2">Source</th>
                    <th className="text-left p-2">Bank</th>
                    <th className="text-left p-2">Currency</th>
                    <th className="text-left p-2">Total</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Lines</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((b) => (
                    <tr key={b.id} className="border-b">
                        <td className="p-2">
                        <Link className="underline" to={`/payments/batches/${b.id}`}>{b.batch_no}</Link>
                        </td>
                        <td className="p-2">{b.source_type}</td>
                        <td className="p-2">{b.bank_account_code}</td>
                        <td className="p-2">{b.currency_code}</td>
                        <td className="p-2">{b.total_amount}</td>
                        <td className="p-2">{b.status}</td>
                        <td className="p-2">{b.line_count}</td>
                    </tr>
                    ))}
                    {items.length === 0 && (
                    <tr><td className="p-2" colSpan={7}>No batches yet.</td></tr>
                    )}
                </tbody>
                </table>
            </div>
            )}
        </div>
        </div>
    );
    }
    ```

    ---

    ## 13) Detail page — `frontend/src/pages/payments/PaymentBatchDetailPage.jsx`

    ```jsx
    // frontend/src/pages/payments/PaymentBatchDetailPage.jsx

    import { useEffect, useState } from "react";
    import { useParams } from "react-router-dom";
    import {
    getPaymentBatch,
    approvePaymentBatch,
    exportPaymentBatch,
    postPaymentBatch,
    cancelPaymentBatch,
    } from "../../api/payments";

    export default function PaymentBatchDetailPage() {
    const { id } = useParams();
    const [batch, setBatch] = useState(null);
    const [err, setErr] = useState("");
    const [exportCsv, setExportCsv] = useState("");

    async function load() {
        setErr("");
        try {
        const res = await getPaymentBatch(id);
        setBatch(res);
        } catch (e) {
        setErr(e.message || "Failed to load batch");
        }
    }

    useEffect(() => { load(); }, [id]);

    async function onApprove() {
        try { await approvePaymentBatch(id, {}); await load(); } catch (e) { setErr(e.message || "Approve failed"); }
    }
    async function onExport() {
        try {
        const res = await exportPaymentBatch(id, { format: "CSV" });
        setExportCsv(res.export?.csv || "");
        await load();
        } catch (e) { setErr(e.message || "Export failed"); }
    }
    async function onPost() {
        try { await postPaymentBatch(id, {}); await load(); } catch (e) { setErr(e.message || "Post failed"); }
    }
    async function onCancel() {
        try { await cancelPaymentBatch(id, {}); await load(); } catch (e) { setErr(e.message || "Cancel failed"); }
    }

    if (!batch) return <div className="p-4">Loading...</div>;

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{batch.batch_no}</h1>
            <span className="text-sm border rounded px-2 py-0.5">{batch.status}</span>
            </div>
            {err ? <div className="text-sm text-red-600 mt-2">{err}</div> : null}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm">
            <div><b>Source:</b> {batch.source_type}</div>
            <div><b>Bank:</b> {batch.bank_account_code}</div>
            <div><b>Currency:</b> {batch.currency_code}</div>
            <div><b>Total:</b> {batch.total_amount}</div>
            </div>

            <div className="mt-3 flex gap-2">
            {batch.status === "DRAFT" && (
                <button className="border rounded px-2 py-1" onClick={onApprove} type="button">Approve</button>
            )}
            {(batch.status === "APPROVED" || batch.status === "EXPORTED") && (
                <>
                <button className="border rounded px-2 py-1" onClick={onExport} type="button">Export CSV</button>
                <button className="border rounded px-2 py-1" onClick={onPost} type="button">Post</button>
                <button className="border rounded px-2 py-1" onClick={onCancel} type="button">Cancel</button>
                </>
            )}
            </div>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Lines</h2>
            <div className="overflow-auto">
            <table className="min-w-full text-sm border-collapse">
                <thead>
                <tr className="border-b">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Beneficiary</th>
                    <th className="text-left p-2">Payable Ref</th>
                    <th className="text-left p-2">Payable GL</th>
                    <th className="text-left p-2">Amount</th>
                    <th className="text-left p-2">Status</th>
                </tr>
                </thead>
                <tbody>
                {(batch.lines || []).map((l) => (
                    <tr key={l.id} className="border-b">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2">{l.beneficiary_name}</td>
                    <td className="p-2">{l.payable_ref || "-"}</td>
                    <td className="p-2">{l.payable_gl_account_id}</td>
                    <td className="p-2">{l.amount}</td>
                    <td className="p-2">{l.status}</td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Audit</h2>
            <div className="space-y-1 text-sm">
            {(batch.audit || []).map((a) => (
                <div key={a.id} className="border rounded p-2">
                <b>{a.action}</b> — {a.acted_at}
                </div>
            ))}
            </div>
        </div>

        {exportCsv ? (
            <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">CSV Preview</h2>
            <pre className="text-xs whitespace-pre-wrap">{exportCsv}</pre>
            </div>
        ) : null}
        </div>
    );
    }
    ```

    ---

    ## 14) App routes — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import PaymentBatchListPage from "./pages/payments/PaymentBatchListPage";
    import PaymentBatchDetailPage from "./pages/payments/PaymentBatchDetailPage";

    // ...
    <Route
    path="/payments/batches"
    element={
        <RequirePermission permission="payments.batch.read">
        <PaymentBatchListPage />
        </RequirePermission>
    }
    />

    <Route
    path="/payments/batches/:id"
    element={
        <RequirePermission permission="payments.batch.read">
        <PaymentBatchDetailPage />
        </RequirePermission>
    }
    />
    ```

    > You can skip `/payments/batches/new` for now and create batches via API/manual test first, or add a simple create page later.

    ---

    ## 15) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    ```js
    // frontend/src/layouts/sidebarConfig.js
    {
    key: "payments",
    label: "Payments",
    children: [
        {
        key: "payment-batches",
        label: "Payment Batches",
        to: "/payments/batches",
        permission: "payments.batch.read",
        },
    ],
    }
    ```

    ---

    ## 16) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.payments": "Payments",
    "sidebar.paymentBatches": "Payment Batches",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Can create generic payment batch with header + lines
    * ✅ Batch total is derived from line sums
    * ✅ Idempotent create via `idempotency_key`
    * ✅ Maker-checker approval enforced (optional strict creator≠approver in v1)
    * ✅ CSV export works and stores export metadata/checksum
    * ✅ Posting is idempotent and creates settlement journal (`Dr Payable / Cr Bank`)
    * ✅ Lines move `PENDING -> PAID` on post
    * ✅ Duplicate payable target protection prevents double-paying
    * ✅ Audit rows exist for all major actions
    * ✅ Permissions enforced (`payments.batch.*`)
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:payments:prb04`

    Should verify at least:

    1. **Create success**

    * POST batch (MANUAL source, 2 lines) → `201`
    * `status=DRAFT`, `total_amount=sum(lines)`

    2. **Idempotent create**

    * same payload + same `idempotency_key` → returns same batch (not duplicate)

    3. **Approve**

    * POST `/approve` → `status=APPROVED`
    * repeat approve blocked (`400`)

    4. **Export CSV**

    * POST `/export` → `status=EXPORTED`
    * response contains `csv`, `checksum`, `file_name`

    5. **Post**

    * POST `/post` → `status=POSTED`
    * `posted_journal_entry_id` present
    * batch lines now `PAID`

    6. **Idempotent post**

    * POST `/post` again → same `posted_journal_entry_id`, no duplicate journal

    7. **Duplicate payable protection**

    * new batch using same `payable_entity_type + payable_entity_id` while active/posted should fail (`409`)

    8. **Audit**

    * GET `/batches/:id` returns audit including `CREATED/APPROVED/EXPORTED/POSTED`

    9. **Permissions**

    * missing `read/create/approve/export/post` permissions returns `403`

    ---

    # Example manual payloads

    ## Create payment batch (MANUAL)

    ```json
    {
    "source_type": "MANUAL",
    "source_id": null,
    "bank_account_id": 1,
    "currency_code": "USD",
    "idempotency_key": "manual-2026-02-25-batch-001",
    "notes": "Manual salary advance settlements",
    "lines": [
        {
        "beneficiary_type": "EMPLOYEE",
        "beneficiary_id": 101,
        "beneficiary_name": "Alice Doe",
        "beneficiary_bank_ref": "ALICE-IBAN-001",
        "payable_entity_type": "MANUAL",
        "payable_entity_id": 5001,
        "payable_gl_account_id": 210501,
        "payable_ref": "ADV-EMP-101",
        "amount": 500.00
        },
        {
        "beneficiary_type": "EMPLOYEE",
        "beneficiary_id": 102,
        "beneficiary_name": "Bob Doe",
        "beneficiary_bank_ref": "BOB-IBAN-002",
        "payable_entity_type": "MANUAL",
        "payable_entity_id": 5002,
        "payable_gl_account_id": 210501,
        "payable_ref": "ADV-EMP-102",
        "amount": 450.00
        }
    ]
    }
    ```

    ## Approve

    ```json
    {
    "note": "Approved for release"
    }
    ```

    ## Export

    ```json
    {
    "format": "CSV"
    }
    ```

    ## Post

    ```json
    {
    "note": "Posted after bank file release",
    "external_payment_ref_prefix": "AZIZI"
    }
    ```

    ---

    # Tiny implementation notes (important)

    * **Keep this generic** — payroll/AP will only *feed* batch lines later.
    * Posting in B04 is **GL settlement posting only**; actual bank statement reconciliation still happens in **B03**.
    * In **PR-P04**, payroll should call `createBatch()` with `source_type="PAYROLL"` and `payable_entity_type="PAYROLL_LIABILITY"`.
    * In **PR-P05**, reconciliation-to-payroll feedback will update payroll liability statuses when bank lines match posted payment batches.

    ---

    If you want, next I can do **PR-P01 (Payroll Import Foundation)** in the same format so it plugs into this payment engine cleanly.
