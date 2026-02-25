# PR-P01: Payroll Import Foundation (Provider CSV → Payroll Subledger Runs)

    ## Goal

    Add a **Payroll subledger import foundation** (no payroll calculation engine yet).

    This PR gives you:

    * ✅ Payroll run header + employee-level payroll lines
    * ✅ CSV import (provider/export file)
    * ✅ Idempotency by file checksum
    * ✅ Basic validation (gross/net consistency)
    * ✅ Payroll run list + detail UI
    * ❌ No GL accrual posting yet (that’s **PR-P02**)
    * ❌ No payment batch generation yet (that’s later payroll-payment PR using **B04**)

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m025_payroll_import_foundation.js`
    * `backend/src/routes/payroll.runs.js`
    * `backend/src/routes/payroll.runs.validators.js`
    * `backend/src/services/payroll.runs.service.js`
    * `backend/src/services/payroll.parsers.csv.js`
    * `backend/scripts/test-payroll-prp01-import.js`

    ### Frontend

    * `frontend/src/api/payrollRuns.js`
    * `frontend/src/pages/payroll/PayrollRunImportPage.jsx`
    * `frontend/src/pages/payroll/PayrollRunsPage.jsx`
    * `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`

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

    ## 1) Migration — `backend/src/migrations/m025_payroll_import_foundation.js`

    ```js
    // backend/src/migrations/m025_payroll_import_foundation.js

    module.exports = {
    id: "m025_payroll_import_foundation",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_runs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_no VARCHAR(50) NOT NULL,
            provider_code VARCHAR(50) NOT NULL,            -- e.g. OUTSOURCED_PAYROLL_X
            entity_code VARCHAR(50) NOT NULL,              -- legal entity code (string for v1)
            payroll_period DATE NOT NULL,                  -- use period start date (YYYY-MM-01)
            pay_date DATE NOT NULL,
            currency_code CHAR(3) NOT NULL,
            source_batch_ref VARCHAR(100) NULL,
            original_filename VARCHAR(255) NOT NULL,
            file_checksum CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'IMPORTED', -- IMPORTED, REVIEWED, FINALIZED (later PRs)
            line_count_total INT UNSIGNED NOT NULL DEFAULT 0,
            line_count_inserted INT UNSIGNED NOT NULL DEFAULT 0,
            line_count_duplicates INT UNSIGNED NOT NULL DEFAULT 0,
            employee_count INT UNSIGNED NOT NULL DEFAULT 0,

            total_base_salary DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_overtime_pay DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_bonus_pay DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_allowances DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_gross_pay DECIMAL(18,2) NOT NULL DEFAULT 0,

            total_employee_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_employee_social_security DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_other_deductions DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_net_pay DECIMAL(18,2) NOT NULL DEFAULT 0,

            total_employer_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
            total_employer_social_security DECIMAL(18,2) NOT NULL DEFAULT 0,

            raw_meta_json JSON NULL,
            imported_by BIGINT UNSIGNED NULL,
            imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            UNIQUE KEY uq_payroll_runs_run_no (run_no),
            UNIQUE KEY uq_payroll_runs_checksum (entity_code, payroll_period, provider_code, file_checksum),
            KEY idx_payroll_runs_period (payroll_period),
            KEY idx_payroll_runs_entity (entity_code),
            KEY idx_payroll_runs_status (status),
            KEY idx_payroll_runs_imported_at (imported_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_run_lines (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            line_no INT UNSIGNED NOT NULL,

            employee_code VARCHAR(100) NOT NULL,
            employee_name VARCHAR(255) NOT NULL,
            cost_center_code VARCHAR(100) NULL,

            base_salary DECIMAL(18,2) NOT NULL DEFAULT 0,
            overtime_pay DECIMAL(18,2) NOT NULL DEFAULT 0,
            bonus_pay DECIMAL(18,2) NOT NULL DEFAULT 0,
            allowances_total DECIMAL(18,2) NOT NULL DEFAULT 0,
            gross_pay DECIMAL(18,2) NOT NULL DEFAULT 0,

            employee_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
            employee_social_security DECIMAL(18,2) NOT NULL DEFAULT 0,
            other_deductions DECIMAL(18,2) NOT NULL DEFAULT 0,
            net_pay DECIMAL(18,2) NOT NULL DEFAULT 0,

            employer_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
            employer_social_security DECIMAL(18,2) NOT NULL DEFAULT 0,

            line_hash CHAR(64) NOT NULL,
            raw_row_json JSON NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            UNIQUE KEY uq_payroll_run_lines_run_lineno (run_id, line_no),
            UNIQUE KEY uq_payroll_run_lines_run_hash (run_id, line_hash),
            KEY idx_payroll_run_lines_run (run_id),
            KEY idx_payroll_run_lines_employee (employee_code),
            KEY idx_payroll_run_lines_cost_center (cost_center_code),

            CONSTRAINT fk_payroll_run_lines_run
            FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_run_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            action VARCHAR(30) NOT NULL,  -- IMPORTED, STATUS, VALIDATION
            payload_json JSON NULL,
            acted_by BIGINT UNSIGNED NULL,
            acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            KEY idx_payroll_run_audit_run (run_id),
            KEY idx_payroll_run_audit_action (action),

            CONSTRAINT fk_payroll_run_audit_run
            FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS payroll_run_audit;`);
        await db.query(`DROP TABLE IF EXISTS payroll_run_lines;`);
        await db.query(`DROP TABLE IF EXISTS payroll_runs;`);
    },
    };
    ```

    ---

    ## 2) CSV parser — `backend/src/services/payroll.parsers.csv.js`

    > v1 CSV format is fixed (provider export normalized to this schema):

    **Header (required):**
    `employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay`

    ```js
    // backend/src/services/payroll.parsers.csv.js

    function parseCsvLine(line) {
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

    function parseMoney(value, fieldName) {
    const n = Number(String(value ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new Error(`${fieldName} is invalid number`);
    return Number(n.toFixed(2));
    }

    function parsePayrollCsv(csvText) {
    const text = String(csvText || "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("CSV is empty");

    const lines = text.split("\n").filter(Boolean);
    if (lines.length < 2) throw new Error("CSV must include header and at least one row");

    const header = parseCsvLine(lines[0]).map((x) => x.toLowerCase());
    const required = [
        "employee_code",
        "employee_name",
        "cost_center_code",
        "base_salary",
        "overtime_pay",
        "bonus_pay",
        "allowances_total",
        "gross_pay",
        "employee_tax",
        "employee_social_security",
        "other_deductions",
        "employer_tax",
        "employer_social_security",
        "net_pay",
    ];

    for (const c of required) {
        if (!header.includes(c)) throw new Error(`Missing CSV column: ${c}`);
    }

    const idx = Object.fromEntries(required.map((c) => [c, header.indexOf(c)]));
    const rows = [];

    for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        if (cols.every((c) => c === "")) continue;

        const raw = {};
        for (const c of required) raw[c] = cols[idx[c]] ?? "";

        const employee_code = String(raw.employee_code || "").trim();
        const employee_name = String(raw.employee_name || "").trim();
        const cost_center_code = String(raw.cost_center_code || "").trim() || null;

        if (!employee_code) throw new Error(`Row ${i + 1}: employee_code is required`);
        if (!employee_name) throw new Error(`Row ${i + 1}: employee_name is required`);

        const row = {
        line_no: i,
        employee_code,
        employee_name,
        cost_center_code,

        base_salary: parseMoney(raw.base_salary, `Row ${i + 1} base_salary`),
        overtime_pay: parseMoney(raw.overtime_pay, `Row ${i + 1} overtime_pay`),
        bonus_pay: parseMoney(raw.bonus_pay, `Row ${i + 1} bonus_pay`),
        allowances_total: parseMoney(raw.allowances_total, `Row ${i + 1} allowances_total`),
        gross_pay: parseMoney(raw.gross_pay, `Row ${i + 1} gross_pay`),

        employee_tax: parseMoney(raw.employee_tax, `Row ${i + 1} employee_tax`),
        employee_social_security: parseMoney(raw.employee_social_security, `Row ${i + 1} employee_social_security`),
        other_deductions: parseMoney(raw.other_deductions, `Row ${i + 1} other_deductions`),
        net_pay: parseMoney(raw.net_pay, `Row ${i + 1} net_pay`),

        employer_tax: parseMoney(raw.employer_tax, `Row ${i + 1} employer_tax`),
        employer_social_security: parseMoney(raw.employer_social_security, `Row ${i + 1} employer_social_security`),

        raw_row_json: raw,
        };

        // Basic consistency checks (tolerant for rounding)
        const grossExpected = Number(
        (row.base_salary + row.overtime_pay + row.bonus_pay + row.allowances_total).toFixed(2)
        );
        const netExpected = Number(
        (row.gross_pay - row.employee_tax - row.employee_social_security - row.other_deductions).toFixed(2)
        );

        if (Math.abs(grossExpected - row.gross_pay) > 0.05) {
        throw new Error(`Row ${i + 1}: gross_pay mismatch (expected ${grossExpected}, got ${row.gross_pay})`);
        }
        if (Math.abs(netExpected - row.net_pay) > 0.05) {
        throw new Error(`Row ${i + 1}: net_pay mismatch (expected ${netExpected}, got ${row.net_pay})`);
        }

        rows.push(row);
    }

    if (!rows.length) throw new Error("CSV has no valid rows");
    return rows;
    }

    module.exports = {
    parsePayrollCsv,
    };
    ```

    ---

    ## 3) Validators — `backend/src/routes/payroll.runs.validators.js`

    ```js
    // backend/src/routes/payroll.runs.validators.js

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

    function requireDate(value, fieldName) {
    const s = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${fieldName} must be YYYY-MM-DD`);
    return s;
    }

    function requireCurrency(value) {
    const s = String(value || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(s)) throw new Error("currency_code must be 3 letters");
    return s;
    }

    function validateImportRequest(req) {
    const entity_code = String(req.body?.entity_code || "").trim();
    const provider_code = String(req.body?.provider_code || "").trim().toUpperCase();
    const payroll_period = requireDate(req.body?.payroll_period, "payroll_period");
    const pay_date = requireDate(req.body?.pay_date, "pay_date");
    const currency_code = requireCurrency(req.body?.currency_code);

    if (!entity_code) throw new Error("entity_code is required");
    if (!provider_code) throw new Error("provider_code is required");

    const original_filename =
        req.file?.originalname || normalizeString(req.body?.original_filename) || "payroll.csv";

    const csvText =
        req.file?.buffer?.toString("utf8") ||
        (typeof req.body?.csv_text === "string" ? req.body.csv_text : null);

    if (!csvText) throw new Error("CSV file or csv_text is required");

    return {
        entity_code,
        provider_code,
        payroll_period,
        pay_date,
        currency_code,
        source_batch_ref: normalizeString(req.body?.source_batch_ref),
        original_filename,
        csv_text: csvText,
    };
    }

    function validateIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateListRunsQuery(query = {}) {
    return {
        entity_code: normalizeString(query.entity_code),
        provider_code: normalizeString(query.provider_code)?.toUpperCase() || null,
        payroll_period: query.payroll_period ? requireDate(query.payroll_period, "payroll_period") : null,
        status: normalizeString(query.status)?.toUpperCase() || null,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 200) : 50,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateListRunLinesQuery(query = {}) {
    return {
        q: normalizeString(query.q),
        cost_center_code: normalizeString(query.cost_center_code),
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 200,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    module.exports = {
    validateImportRequest,
    validateIdParam,
    validateListRunsQuery,
    validateListRunLinesQuery,
    };
    ```

    ---

    ## 4) Service — `backend/src/services/payroll.runs.service.js`

    ```js
    // backend/src/services/payroll.runs.service.js

    const crypto = require("crypto");
    const { parsePayrollCsv } = require("./payroll.parsers.csv");

    function sha256(v) {
    return crypto.createHash("sha256").update(String(v)).digest("hex");
    }

    function normalizeHashPart(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim().toUpperCase();
    }

    function buildLineHash(runHeader, row) {
    const key = [
        runHeader.entity_code,
        runHeader.provider_code,
        runHeader.payroll_period,
        row.employee_code,
        row.employee_name,
        row.cost_center_code || "",
        row.gross_pay.toFixed(2),
        row.net_pay.toFixed(2),
        row.employee_tax.toFixed(2),
        row.employee_social_security.toFixed(2),
        row.employer_tax.toFixed(2),
        row.employer_social_security.toFixed(2),
    ].join("|");

    return sha256(key);
    }

    async function writeAudit(db, runId, action, payload, userId = null) {
    await db.query(
        `INSERT INTO payroll_run_audit (run_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?)`,
        [runId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function nextRunNo(db, payrollPeriod) {
    const yyyymm = String(payrollPeriod).slice(0, 7).replace("-", "");
    const [rows] = await db.query(`SELECT COALESCE(MAX(id),0)+1 AS next_id FROM payroll_runs`);
    const n = Number(rows[0]?.next_id || 1);
    return `PR-${yyyymm}-${String(n).padStart(6, "0")}`;
    }

    function zeroTotals() {
    return {
        total_base_salary: 0,
        total_overtime_pay: 0,
        total_bonus_pay: 0,
        total_allowances: 0,
        total_gross_pay: 0,
        total_employee_tax: 0,
        total_employee_social_security: 0,
        total_other_deductions: 0,
        total_net_pay: 0,
        total_employer_tax: 0,
        total_employer_social_security: 0,
    };
    }

    function accumulateTotals(t, row) {
    t.total_base_salary += Number(row.base_salary);
    t.total_overtime_pay += Number(row.overtime_pay);
    t.total_bonus_pay += Number(row.bonus_pay);
    t.total_allowances += Number(row.allowances_total);
    t.total_gross_pay += Number(row.gross_pay);

    t.total_employee_tax += Number(row.employee_tax);
    t.total_employee_social_security += Number(row.employee_social_security);
    t.total_other_deductions += Number(row.other_deductions);
    t.total_net_pay += Number(row.net_pay);

    t.total_employer_tax += Number(row.employer_tax);
    t.total_employer_social_security += Number(row.employer_social_security);
    }

    function roundTotals(t) {
    const out = {};
    for (const [k, v] of Object.entries(t)) out[k] = Number(v.toFixed(2));
    return out;
    }

    async function getRunById(db, id) {
    const [rows] = await db.query(
        `
        SELECT *
        FROM payroll_runs
        WHERE id = ?
        LIMIT 1
        `,
        [id]
    );
    return rows[0] || null;
    }

    async function listRuns(db, query) {
    const where = [];
    const params = [];

    if (query.entity_code) {
        where.push(`entity_code = ?`);
        params.push(query.entity_code);
    }
    if (query.provider_code) {
        where.push(`provider_code = ?`);
        params.push(query.provider_code);
    }
    if (query.payroll_period) {
        where.push(`payroll_period = ?`);
        params.push(query.payroll_period);
    }
    if (query.status) {
        where.push(`status = ?`);
        params.push(query.status);
    }

    let sql = `
        SELECT
        id, run_no, provider_code, entity_code, payroll_period, pay_date, currency_code,
        status, line_count_total, line_count_inserted, line_count_duplicates, employee_count,
        total_gross_pay, total_net_pay, total_employee_tax, total_employee_social_security,
        total_employer_tax, total_employer_social_security,
        imported_at
        FROM payroll_runs
    `;

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY payroll_period DESC, id DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function listRunLines(db, runId, query) {
    const where = [`run_id = ?`];
    const params = [runId];

    if (query.q) {
        where.push(`(employee_code LIKE ? OR employee_name LIKE ?)`);
        params.push(`%${query.q}%`, `%${query.q}%`);
    }
    if (query.cost_center_code) {
        where.push(`cost_center_code = ?`);
        params.push(query.cost_center_code);
    }

    let sql = `
        SELECT
        id, run_id, line_no, employee_code, employee_name, cost_center_code,
        base_salary, overtime_pay, bonus_pay, allowances_total, gross_pay,
        employee_tax, employee_social_security, other_deductions, net_pay,
        employer_tax, employer_social_security
        FROM payroll_run_lines
        WHERE ${where.join(" AND ")}
        ORDER BY line_no ASC
        LIMIT ? OFFSET ?
    `;
    params.push(query.limit, query.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function listRunAudit(db, runId) {
    const [rows] = await db.query(
        `
        SELECT id, action, payload_json, acted_by, acted_at
        FROM payroll_run_audit
        WHERE run_id = ?
        ORDER BY id DESC
        `,
        [runId]
    );
    return rows;
    }

    async function importPayrollRunCsv(db, payload, userId = null) {
    const fileChecksum = sha256(payload.csv_text);

    const [dupRows] = await db.query(
        `
        SELECT id
        FROM payroll_runs
        WHERE entity_code = ?
        AND payroll_period = ?
        AND provider_code = ?
        AND file_checksum = ?
        LIMIT 1
        `,
        [payload.entity_code, payload.payroll_period, payload.provider_code, fileChecksum]
    );

    if (dupRows[0]) {
        const err = new Error("This payroll file was already imported for the same entity/period/provider");
        err.statusCode = 409;
        throw err;
    }

    const parsedRows = parsePayrollCsv(payload.csv_text);
    const runNo = await nextRunNo(db, payload.payroll_period);

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const [insRun] = await q.query(
        `
        INSERT INTO payroll_runs
        (run_no, provider_code, entity_code, payroll_period, pay_date, currency_code,
        source_batch_ref, original_filename, file_checksum, status, raw_meta_json, imported_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?)
        `,
        [
            runNo,
            payload.provider_code,
            payload.entity_code,
            payload.payroll_period,
            payload.pay_date,
            payload.currency_code,
            payload.source_batch_ref || null,
            payload.original_filename,
            fileChecksum,
            JSON.stringify({ parser: "payroll-csv-v1" }),
            userId,
        ]
        );

        const runId = insRun.insertId;

        let inserted = 0;
        let duplicates = 0;
        const totals = zeroTotals();
        const employeeCodes = new Set();

        for (const row of parsedRows) {
        const lineHash = buildLineHash(payload, row);

        try {
            await q.query(
            `
            INSERT INTO payroll_run_lines
            (run_id, line_no, employee_code, employee_name, cost_center_code,
            base_salary, overtime_pay, bonus_pay, allowances_total, gross_pay,
            employee_tax, employee_social_security, other_deductions, net_pay,
            employer_tax, employer_social_security, line_hash, raw_row_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                runId,
                row.line_no,
                row.employee_code,
                row.employee_name,
                row.cost_center_code,
                row.base_salary,
                row.overtime_pay,
                row.bonus_pay,
                row.allowances_total,
                row.gross_pay,
                row.employee_tax,
                row.employee_social_security,
                row.other_deductions,
                row.net_pay,
                row.employer_tax,
                row.employer_social_security,
                lineHash,
                JSON.stringify(row.raw_row_json || null),
            ]
            );

            inserted += 1;
            employeeCodes.add(row.employee_code);
            accumulateTotals(totals, row);
        } catch (e) {
            if (e && e.code === "ER_DUP_ENTRY") {
            duplicates += 1;
            continue;
            }
            throw e;
        }
        }

        const rt = roundTotals(totals);

        await q.query(
        `
        UPDATE payroll_runs
        SET line_count_total = ?,
            line_count_inserted = ?,
            line_count_duplicates = ?,
            employee_count = ?,
            total_base_salary = ?,
            total_overtime_pay = ?,
            total_bonus_pay = ?,
            total_allowances = ?,
            total_gross_pay = ?,
            total_employee_tax = ?,
            total_employee_social_security = ?,
            total_other_deductions = ?,
            total_net_pay = ?,
            total_employer_tax = ?,
            total_employer_social_security = ?,
            raw_meta_json = JSON_SET(
                COALESCE(raw_meta_json, JSON_OBJECT()),
                '$.inserted', ?,
                '$.duplicates', ?,
                '$.employee_count', ?
            )
        WHERE id = ?
        `,
        [
            parsedRows.length,
            inserted,
            duplicates,
            employeeCodes.size,
            rt.total_base_salary,
            rt.total_overtime_pay,
            rt.total_bonus_pay,
            rt.total_allowances,
            rt.total_gross_pay,
            rt.total_employee_tax,
            rt.total_employee_social_security,
            rt.total_other_deductions,
            rt.total_net_pay,
            rt.total_employer_tax,
            rt.total_employer_social_security,
            inserted,
            duplicates,
            employeeCodes.size,
            runId,
        ]
        );

        await writeAudit(q, runId, "IMPORTED", {
        line_count_total: parsedRows.length,
        line_count_inserted: inserted,
        line_count_duplicates: duplicates,
        employee_count: employeeCodes.size,
        }, userId);

        if (conn) await conn.commit();

        return getRunById(db, runId);
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    module.exports = {
    importPayrollRunCsv,
    listRuns,
    getRunById,
    listRunLines,
    listRunAudit,
    };
    ```

    ---

    ## 5) Routes — `backend/src/routes/payroll.runs.js`

    ```js
    // backend/src/routes/payroll.runs.js

    const express = require("express");
    const multer = require("multer");
    const {
    validateImportRequest,
    validateIdParam,
    validateListRunsQuery,
    validateListRunLinesQuery,
    } = require("./payroll.runs.validators");
    const service = require("../services/payroll.runs.service");

    // Replace with your project helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage() });

    // POST /api/v1/payroll/runs/import
    router.post(
    "/runs/import",
    requireAuth,
    requirePermission("payroll.runs.import"),
    upload.single("file"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const payload = validateImportRequest(req);
        const userId = req.user?.id ?? null;
        const row = await service.importPayrollRunCsv(db, payload, userId);
        res.status(201).json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payroll/runs
    router.get(
    "/runs",
    requireAuth,
    requirePermission("payroll.runs.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListRunsQuery(req.query);
        const items = await service.listRuns(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payroll/runs/:id
    router.get(
    "/runs/:id",
    requireAuth,
    requirePermission("payroll.runs.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);

        const run = await service.getRunById(db, id);
        if (!run) return res.status(404).json({ error: "Not found" });

        const [lines, audit] = await Promise.all([
            service.listRunLines(db, id, { q: null, cost_center_code: null, limit: 500, offset: 0 }),
            service.listRunAudit(db, id),
        ]);

        res.json({ ...run, lines, audit });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payroll/runs/:id/lines
    router.get(
    "/runs/:id/lines",
    requireAuth,
    requirePermission("payroll.runs.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateIdParam(req.params);
        const q = validateListRunLinesQuery(req.query);

        const run = await service.getRunById(db, id);
        if (!run) return res.status(404).json({ error: "Not found" });

        const items = await service.listRunLines(db, id, q);
        res.json({ items });
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
    const payrollRunsRoutes = require("./routes/payroll.runs");

    // ...
    app.use("/api/v1/payroll", payrollRunsRoutes);
    ```

    ---

    ## 7) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m025_payroll_import_foundation = require("./m025_payroll_import_foundation");

    module.exports = [
    // ...
    m025_payroll_import_foundation,
    ];
    ```

    ---

    ## 8) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const PAYROLL_PERMISSIONS = [
    "payroll.runs.read",
    "payroll.runs.import",
    ];

    // merge into your permissions seed list
    ```

    ---

    ## 9) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `POST /api/v1/payroll/runs/import`
    * `GET /api/v1/payroll/runs`
    * `GET /api/v1/payroll/runs/{id}`
    * `GET /api/v1/payroll/runs/{id}/lines`

    ---

    ## 10) Backend smoke test — `backend/scripts/test-payroll-prp01-import.js`

    > Make this a real `supertest` script in your project style.
    > Here’s the exact behavior to test.

    ```js
    // backend/scripts/test-payroll-prp01-import.js

    async function main() {
    // Flow:
    // 1) Build a valid payroll CSV (2-3 rows)
    // 2) POST /api/v1/payroll/runs/import with:
    //    entity_code, provider_code, payroll_period, pay_date, currency_code, csv_text
    //    -> expect 201, status=IMPORTED
    // 3) GET /api/v1/payroll/runs -> imported run appears
    // 4) GET /api/v1/payroll/runs/:id -> returns header + lines + audit
    // 5) Re-import same file same entity/period/provider -> 409 checksum idempotency
    // 6) Import invalid CSV (gross/net mismatch) -> 400 validation error
    // 7) Permission checks -> payroll.runs.read / payroll.runs.import enforced (403)
    console.log("PR-P01 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    ---

    ## 11) `backend/package.json` updates

    ```json
    {
    "scripts": {
        "test:payroll:prp01": "node backend/scripts/test-payroll-prp01-import.js"
    }
    }
    ```

    ---

    # Frontend skeletons

    ## 12) API client — `frontend/src/api/payrollRuns.js`

    ```js
    // frontend/src/api/payrollRuns.js

    import { apiFetch } from "./client"; // adapt to your helper

    export function importPayrollRun({ file, csv_text, ...meta }) {
    if (file) {
        const form = new FormData();
        Object.entries(meta).forEach(([k, v]) => {
        if (v !== undefined && v !== null) form.append(k, String(v));
        });
        form.append("file", file);

        return apiFetch(`/api/v1/payroll/runs/import`, {
        method: "POST",
        body: form,
        });
    }

    return apiFetch(`/api/v1/payroll/runs/import`, {
        method: "POST",
        body: JSON.stringify({ ...meta, csv_text }),
    });
    }

    export function listPayrollRuns(params = {}) {
    const q = new URLSearchParams();
    if (params.entity_code) q.set("entity_code", params.entity_code);
    if (params.provider_code) q.set("provider_code", params.provider_code);
    if (params.payroll_period) q.set("payroll_period", params.payroll_period);
    if (params.status) q.set("status", params.status);
    const qs = q.toString();
    return apiFetch(`/api/v1/payroll/runs${qs ? `?${qs}` : ""}`);
    }

    export function getPayrollRun(id) {
    return apiFetch(`/api/v1/payroll/runs/${id}`);
    }

    export function listPayrollRunLines(id, params = {}) {
    const q = new URLSearchParams();
    if (params.q) q.set("q", params.q);
    if (params.cost_center_code) q.set("cost_center_code", params.cost_center_code);
    const qs = q.toString();
    return apiFetch(`/api/v1/payroll/runs/${id}/lines${qs ? `?${qs}` : ""}`);
    }
    ```

    ---

    ## 13) Import page — `frontend/src/pages/payroll/PayrollRunImportPage.jsx`

    ```jsx
    // frontend/src/pages/payroll/PayrollRunImportPage.jsx

    import { useState } from "react";
    import { importPayrollRun } from "../../api/payrollRuns";

    export default function PayrollRunImportPage() {
    const [form, setForm] = useState({
        entity_code: "",
        provider_code: "PROVIDER_X",
        payroll_period: "",
        pay_date: "",
        currency_code: "USD",
        source_batch_ref: "",
    });
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setErr("");
        setResult(null);

        try {
        if (!form.entity_code) throw new Error("Entity code is required");
        if (!form.payroll_period) throw new Error("Payroll period is required");
        if (!form.pay_date) throw new Error("Pay date is required");
        if (!file) throw new Error("CSV file is required");

        setSubmitting(true);
        const res = await importPayrollRun({ ...form, file });
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
            <h1 className="text-lg font-semibold mb-3">Payroll Import</h1>

            {err ? <div className="text-sm text-red-600 mb-2">{err}</div> : null}

            <form className="grid grid-cols-1 md:grid-cols-3 gap-2" onSubmit={onSubmit}>
            <input
                className="border rounded px-2 py-1"
                placeholder="Entity Code"
                value={form.entity_code}
                onChange={(e) => setForm((s) => ({ ...s, entity_code: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Provider Code"
                value={form.provider_code}
                onChange={(e) => setForm((s) => ({ ...s, provider_code: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Currency"
                value={form.currency_code}
                onChange={(e) => setForm((s) => ({ ...s, currency_code: e.target.value }))}
            />

            <input
                className="border rounded px-2 py-1"
                type="date"
                value={form.payroll_period}
                onChange={(e) => setForm((s) => ({ ...s, payroll_period: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                type="date"
                value={form.pay_date}
                onChange={(e) => setForm((s) => ({ ...s, pay_date: e.target.value }))}
            />
            <input
                className="border rounded px-2 py-1"
                placeholder="Source Batch Ref (optional)"
                value={form.source_batch_ref}
                onChange={(e) => setForm((s) => ({ ...s, source_batch_ref: e.target.value }))}
            />

            <div className="md:col-span-3">
                <input
                className="block"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
            </div>

            <div className="md:col-span-3">
                <button
                type="submit"
                className="px-3 py-1 rounded bg-black text-white disabled:opacity-50"
                disabled={submitting}
                >
                {submitting ? "Importing..." : "Import Payroll CSV"}
                </button>
            </div>
            </form>
        </div>

        {result ? (
            <div className="rounded border bg-white p-4 text-sm">
            <div className="font-medium mb-2">Import Result</div>
            <div>Run No: {result.run_no}</div>
            <div>Status: {result.status}</div>
            <div>Employees: {result.employee_count}</div>
            <div>Gross: {result.total_gross_pay}</div>
            <div>Net: {result.total_net_pay}</div>
            </div>
        ) : null}
        </div>
    );
    }
    ```

    ---

    ## 14) Runs list page — `frontend/src/pages/payroll/PayrollRunsPage.jsx`

    ```jsx
    // frontend/src/pages/payroll/PayrollRunsPage.jsx

    import { useEffect, useState } from "react";
    import { Link } from "react-router-dom";
    import { listPayrollRuns } from "../../api/payrollRuns";

    export default function PayrollRunsPage() {
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);

    async function load() {
        setLoading(true);
        setErr("");
        try {
        const res = await listPayrollRuns({});
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load payroll runs");
        } finally {
        setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="p-4">
        <div className="rounded border bg-white p-4">
            <div className="flex items-center mb-3">
            <h1 className="text-lg font-semibold">Payroll Runs</h1>
            <Link className="ml-auto underline" to="/payroll/runs/import">
                Import Run
            </Link>
            </div>

            {err ? <div className="text-sm text-red-600 mb-2">{err}</div> : null}

            {loading ? (
            <div>Loading...</div>
            ) : (
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Run No</th>
                    <th className="text-left p-2">Entity</th>
                    <th className="text-left p-2">Period</th>
                    <th className="text-left p-2">Pay Date</th>
                    <th className="text-left p-2">Employees</th>
                    <th className="text-left p-2">Gross</th>
                    <th className="text-left p-2">Net</th>
                    <th className="text-left p-2">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((r) => (
                    <tr key={r.id} className="border-b">
                        <td className="p-2">
                        <Link className="underline" to={`/payroll/runs/${r.id}`}>
                            {r.run_no}
                        </Link>
                        </td>
                        <td className="p-2">{r.entity_code}</td>
                        <td className="p-2">{r.payroll_period}</td>
                        <td className="p-2">{r.pay_date}</td>
                        <td className="p-2">{r.employee_count}</td>
                        <td className="p-2">{r.total_gross_pay}</td>
                        <td className="p-2">{r.total_net_pay}</td>
                        <td className="p-2">{r.status}</td>
                    </tr>
                    ))}
                    {items.length === 0 && (
                    <tr>
                        <td className="p-2" colSpan={8}>
                        No payroll runs yet.
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

    ## 15) Run detail page — `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`

    ```jsx
    // frontend/src/pages/payroll/PayrollRunDetailPage.jsx

    import { useEffect, useState } from "react";
    import { useParams } from "react-router-dom";
    import { getPayrollRun } from "../../api/payrollRuns";

    export default function PayrollRunDetailPage() {
    const { id } = useParams();
    const [run, setRun] = useState(null);
    const [err, setErr] = useState("");

    async function load() {
        setErr("");
        try {
        const res = await getPayrollRun(id);
        setRun(res);
        } catch (e) {
        setErr(e.message || "Failed to load payroll run");
        }
    }

    useEffect(() => {
        load();
    }, [id]);

    if (err) return <div className="p-4 text-red-600">{err}</div>;
    if (!run) return <div className="p-4">Loading...</div>;

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{run.run_no}</h1>
            <span className="text-sm border rounded px-2 py-0.5">{run.status}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm">
            <div><b>Entity:</b> {run.entity_code}</div>
            <div><b>Provider:</b> {run.provider_code}</div>
            <div><b>Period:</b> {run.payroll_period}</div>
            <div><b>Pay Date:</b> {run.pay_date}</div>
            <div><b>Currency:</b> {run.currency_code}</div>
            <div><b>Employees:</b> {run.employee_count}</div>
            <div><b>Gross:</b> {run.total_gross_pay}</div>
            <div><b>Net:</b> {run.total_net_pay}</div>
            </div>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Employees</h2>
            <div className="overflow-auto">
            <table className="min-w-full text-sm border-collapse">
                <thead>
                <tr className="border-b">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Employee</th>
                    <th className="text-left p-2">Cost Center</th>
                    <th className="text-left p-2">Gross</th>
                    <th className="text-left p-2">Net</th>
                    <th className="text-left p-2">Emp Tax</th>
                    <th className="text-left p-2">Emp SS</th>
                    <th className="text-left p-2">Employer Tax</th>
                    <th className="text-left p-2">Employer SS</th>
                </tr>
                </thead>
                <tbody>
                {(run.lines || []).map((l) => (
                    <tr key={l.id} className="border-b">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2">{l.employee_code} - {l.employee_name}</td>
                    <td className="p-2">{l.cost_center_code || "-"}</td>
                    <td className="p-2">{l.gross_pay}</td>
                    <td className="p-2">{l.net_pay}</td>
                    <td className="p-2">{l.employee_tax}</td>
                    <td className="p-2">{l.employee_social_security}</td>
                    <td className="p-2">{l.employer_tax}</td>
                    <td className="p-2">{l.employer_social_security}</td>
                    </tr>
                ))}
                {(run.lines || []).length === 0 && (
                    <tr><td className="p-2" colSpan={9}>No lines.</td></tr>
                )}
                </tbody>
            </table>
            </div>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Audit</h2>
            <div className="space-y-1 text-sm">
            {(run.audit || []).map((a) => (
                <div key={a.id} className="border rounded p-2">
                <b>{a.action}</b> — {a.acted_at}
                </div>
            ))}
            {(run.audit || []).length === 0 && <div>No audit rows yet.</div>}
            </div>
        </div>
        </div>
    );
    }
    ```

    ---

    ## 16) App routes — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import PayrollRunImportPage from "./pages/payroll/PayrollRunImportPage";
    import PayrollRunsPage from "./pages/payroll/PayrollRunsPage";
    import PayrollRunDetailPage from "./pages/payroll/PayrollRunDetailPage";

    // ...
    <Route
    path="/payroll/runs"
    element={
        <RequirePermission permission="payroll.runs.read">
        <PayrollRunsPage />
        </RequirePermission>
    }
    />

    <Route
    path="/payroll/runs/import"
    element={
        <RequirePermission permission="payroll.runs.import">
        <PayrollRunImportPage />
        </RequirePermission>
    }
    />

    <Route
    path="/payroll/runs/:id"
    element={
        <RequirePermission permission="payroll.runs.read">
        <PayrollRunDetailPage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 17) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    ```js
    // frontend/src/layouts/sidebarConfig.js
    {
    key: "payroll",
    label: "Payroll",
    children: [
        {
        key: "payroll-runs",
        label: "Payroll Runs",
        to: "/payroll/runs",
        permission: "payroll.runs.read",
        },
        {
        key: "payroll-import",
        label: "Payroll Import",
        to: "/payroll/runs/import",
        permission: "payroll.runs.import",
        },
    ],
    }
    ```

    ---

    ## 18) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.payroll": "Payroll",
    "sidebar.payrollRuns": "Payroll Runs",
    "sidebar.payrollImport": "Payroll Import",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Payroll CSV import creates `payroll_runs` header + `payroll_run_lines`
    * ✅ Duplicate import is blocked by checksum (same entity/period/provider/file)
    * ✅ Employee-level payroll details are stored in payroll subledger
    * ✅ Gross/net consistency validation runs on import
    * ✅ Payroll run totals are aggregated on header
    * ✅ Runs list + detail endpoints work
    * ✅ Route + UI permission checks use `payroll.runs.read/import`
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:payroll:prp01`

    Should verify at least:

    1. **Import success**

    * POST valid payroll CSV → `201`
    * response includes `run_no`, `status=IMPORTED`
    * totals and employee counts are populated

    2. **List runs**

    * GET `/api/v1/payroll/runs` includes imported run

    3. **Run detail**

    * GET `/api/v1/payroll/runs/:id` returns header + lines + audit
    * line count matches CSV rows

    4. **Checksum idempotency**

    * Re-import same file with same entity/period/provider → `409`

    5. **Validation**

    * Import CSV with wrong `net_pay` or `gross_pay` math → `400`

    6. **Permissions**

    * Missing `payroll.runs.import` or `payroll.runs.read` → `403`

    ---

    # CSV format for manual testing (v1)

    Use this exact header:

    ```csv
    employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay
    E001,Alice Doe,ADM,1000.00,100.00,50.00,25.00,1175.00,100.00,50.00,25.00,80.00,40.00,1000.00
    E002,Bob Doe,SCH,1200.00,0.00,0.00,0.00,1200.00,120.00,60.00,20.00,90.00,45.00,1000.00
    E003,Carol Doe,SCH,900.00,50.00,0.00,0.00,950.00,90.00,40.00,20.00,70.00,35.00,800.00
    ```

    ---

    # Tiny implementation notes (important)

    * **P01 is subledger import only** (no payroll engine yet).
    * This already supports your real-world flow: provider calculates payroll → your system imports and stores auditable payroll detail.
    * In **PR-P02**, you’ll add:

    * payroll accrual posting (`Dr Salary Expense`, `Dr Employer Tax/SS Expense`, `Cr Payroll Payable`, `Cr Tax/SS Payable`)
    * component-to-GL mapping (effective-dated)
    * In later payroll payment PR, payroll run liabilities will feed **PR-B04 Payment Batches** (`source_type="PAYROLL"`).

Perfect — here’s **PR-P02** in the same concrete format.

# PR-P02: Payroll Accrual Posting + Effective-Dated Component Mapping

    ## Goal

    Turn imported payroll runs (**PR-P01**) into **auditable GL accruals** using effective-dated payroll component mappings.

    This PR gives you:

    * ✅ Effective-dated payroll component → GL account mappings
    * ✅ Payroll accrual preview (mapping validation + balanced posting preview)
    * ✅ Payroll run review step
    * ✅ Finalize payroll run = post accrual journal (idempotent) + lock run
    * ✅ Audit trail for mapping changes and payroll accrual posting
    * ❌ No payment batch generation yet (that comes later via **PR-B04** integration)

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m026_payroll_accrual_posting.js`
    * `backend/src/routes/payroll.mappings.js`
    * `backend/src/routes/payroll.mappings.validators.js`
    * `backend/src/routes/payroll.accruals.js`
    * `backend/src/routes/payroll.accruals.validators.js`
    * `backend/src/services/payroll.mappings.service.js`
    * `backend/src/services/payroll.accruals.service.js`
    * `backend/scripts/test-payroll-prp02-accrual-posting.js`

    ### Frontend

    * `frontend/src/api/payrollMappings.js`
    * `frontend/src/pages/payroll/PayrollComponentMappingsPage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js`
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/api/payrollRuns.js`
    * `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`
    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m026_payroll_accrual_posting.js`

    ```js
    // backend/src/migrations/m026_payroll_accrual_posting.js

    module.exports = {
    id: "m026_payroll_accrual_posting",

    async up(db) {
        // Effective-dated mapping table
        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_component_gl_mappings (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            entity_code VARCHAR(50) NOT NULL,
            provider_code VARCHAR(50) NULL,              -- NULL = fallback for any provider
            currency_code CHAR(3) NOT NULL,
            component_code VARCHAR(50) NOT NULL,         -- see service constants
            entry_side VARCHAR(6) NOT NULL,              -- DEBIT / CREDIT
            gl_account_id BIGINT UNSIGNED NOT NULL,
            effective_from DATE NOT NULL,
            effective_to DATE NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            notes VARCHAR(500) NULL,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_pcm_lookup (entity_code, currency_code, component_code, effective_from, effective_to),
            KEY idx_pcm_provider (provider_code),
            KEY idx_pcm_gl (gl_account_id),
            KEY idx_pcm_active (is_active),
            CONSTRAINT fk_pcm_gl_account
            FOREIGN KEY (gl_account_id) REFERENCES accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_component_gl_mapping_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            mapping_id BIGINT UNSIGNED NULL,
            action VARCHAR(30) NOT NULL, -- CREATED, CLOSED_PREVIOUS, DEACTIVATED
            payload_json JSON NULL,
            acted_by BIGINT UNSIGNED NULL,
            acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_pcm_audit_mapping (mapping_id),
            KEY idx_pcm_audit_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // Extend payroll_runs with accrual posting metadata
        await db.query(`
        ALTER TABLE payroll_runs
            ADD COLUMN reviewed_by BIGINT UNSIGNED NULL AFTER imported_by,
            ADD COLUMN reviewed_at DATETIME NULL AFTER imported_at,
            ADD COLUMN finalized_by BIGINT UNSIGNED NULL AFTER reviewed_at,
            ADD COLUMN finalized_at DATETIME NULL AFTER finalized_by,
            ADD COLUMN accrual_journal_entry_id BIGINT UNSIGNED NULL AFTER finalized_at,
            ADD COLUMN accrual_posted_by BIGINT UNSIGNED NULL AFTER accrual_journal_entry_id,
            ADD COLUMN accrual_posted_at DATETIME NULL AFTER accrual_posted_by;
        `).catch(() => {}); // safe re-run during dev

        await db.query(`
        ALTER TABLE payroll_runs
            ADD KEY idx_payroll_runs_accrual_je (accrual_journal_entry_id)
        `).catch(() => {});
    },

    async down(db) {
        // Keep ALTER TABLE down simple/safe for dev environments
        await db.query(`DROP TABLE IF EXISTS payroll_component_gl_mapping_audit;`);
        await db.query(`DROP TABLE IF EXISTS payroll_component_gl_mappings;`);
        // (Optional) drop added payroll_runs columns if you maintain strict down migrations
    },
    };
    ```

    ---

    ## 2) Mapping validators — `backend/src/routes/payroll.mappings.validators.js`

    ```js
    // backend/src/routes/payroll.mappings.validators.js

    const ALLOWED_COMPONENTS = [
    "BASE_SALARY_EXPENSE",
    "OVERTIME_EXPENSE",
    "BONUS_EXPENSE",
    "ALLOWANCES_EXPENSE",
    "EMPLOYER_TAX_EXPENSE",
    "EMPLOYER_SOCIAL_SECURITY_EXPENSE",
    "PAYROLL_NET_PAYABLE",
    "EMPLOYEE_TAX_PAYABLE",
    "EMPLOYEE_SOCIAL_SECURITY_PAYABLE",
    "EMPLOYER_TAX_PAYABLE",
    "EMPLOYER_SOCIAL_SECURITY_PAYABLE",
    "OTHER_DEDUCTIONS_PAYABLE",
    ];

    function requirePositiveInt(v, field) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be positive integer`);
    return n;
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function requireDate(v, field) {
    const s = String(v || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${field} must be YYYY-MM-DD`);
    return s;
    }

    function requireCurrency(v) {
    const s = String(v || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(s)) throw new Error("currency_code must be 3 letters");
    return s;
    }

    function validateListMappingsQuery(query = {}) {
    return {
        entity_code: normalizeString(query.entity_code),
        provider_code: normalizeString(query.provider_code)?.toUpperCase() || null,
        currency_code: normalizeString(query.currency_code)?.toUpperCase() || null,
        component_code: normalizeString(query.component_code)?.toUpperCase() || null,
        as_of_date: query.as_of_date ? requireDate(query.as_of_date, "as_of_date") : null,
        active_only: String(query.active_only || "true").toLowerCase() !== "false",
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 200,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validateUpsertMapping(body = {}) {
    const component_code = String(body.component_code || "").trim().toUpperCase();
    if (!ALLOWED_COMPONENTS.includes(component_code)) {
        throw new Error(`component_code must be one of ${ALLOWED_COMPONENTS.join(", ")}`);
    }

    const entry_side = String(body.entry_side || "").trim().toUpperCase();
    if (!["DEBIT", "CREDIT"].includes(entry_side)) {
        throw new Error("entry_side must be DEBIT or CREDIT");
    }

    return {
        entity_code: String(body.entity_code || "").trim() || (() => { throw new Error("entity_code is required"); })(),
        provider_code: normalizeString(body.provider_code)?.toUpperCase() || null,
        currency_code: requireCurrency(body.currency_code),
        component_code,
        entry_side,
        gl_account_id: requirePositiveInt(body.gl_account_id, "gl_account_id"),
        effective_from: requireDate(body.effective_from, "effective_from"),
        effective_to: body.effective_to ? requireDate(body.effective_to, "effective_to") : null,
        close_previous_open_mapping: String(body.close_previous_open_mapping || "true").toLowerCase() !== "false",
        notes: normalizeString(body.notes),
    };
    }

    module.exports = {
    ALLOWED_COMPONENTS,
    validateListMappingsQuery,
    validateUpsertMapping,
    };
    ```

    ---

    ## 3) Accrual validators — `backend/src/routes/payroll.accruals.validators.js`

    ```js
    // backend/src/routes/payroll.accruals.validators.js

    function requirePositiveInt(v, field) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be positive integer`);
    return n;
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function validateRunIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateReviewBody(body = {}) {
    return { note: normalizeString(body.note) };
    }

    function validateFinalizeBody(body = {}) {
    return {
        note: normalizeString(body.note),
        force_from_imported: String(body.force_from_imported || "false").toLowerCase() === "true",
    };
    }

    module.exports = {
    validateRunIdParam,
    validateReviewBody,
    validateFinalizeBody,
    };
    ```

    ---

    ## 4) Mapping service — `backend/src/services/payroll.mappings.service.js`

    ```js
    // backend/src/services/payroll.mappings.service.js

    const EXPECTED_SIDE_BY_COMPONENT = {
    BASE_SALARY_EXPENSE: "DEBIT",
    OVERTIME_EXPENSE: "DEBIT",
    BONUS_EXPENSE: "DEBIT",
    ALLOWANCES_EXPENSE: "DEBIT",
    EMPLOYER_TAX_EXPENSE: "DEBIT",
    EMPLOYER_SOCIAL_SECURITY_EXPENSE: "DEBIT",

    PAYROLL_NET_PAYABLE: "CREDIT",
    EMPLOYEE_TAX_PAYABLE: "CREDIT",
    EMPLOYEE_SOCIAL_SECURITY_PAYABLE: "CREDIT",
    EMPLOYER_TAX_PAYABLE: "CREDIT",
    EMPLOYER_SOCIAL_SECURITY_PAYABLE: "CREDIT",
    OTHER_DEDUCTIONS_PAYABLE: "CREDIT",
    };

    async function writeMappingAudit(db, { mappingId = null, action, payload = null, userId = null }) {
    await db.query(
        `INSERT INTO payroll_component_gl_mapping_audit (mapping_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?)`,
        [mappingId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function listMappings(db, q) {
    const where = [];
    const params = [];

    if (q.entity_code) {
        where.push(`m.entity_code = ?`);
        params.push(q.entity_code);
    }
    if (q.provider_code) {
        where.push(`(m.provider_code = ? OR m.provider_code IS NULL)`);
        params.push(q.provider_code);
    }
    if (q.currency_code) {
        where.push(`m.currency_code = ?`);
        params.push(q.currency_code);
    }
    if (q.component_code) {
        where.push(`m.component_code = ?`);
        params.push(q.component_code);
    }
    if (q.active_only) {
        where.push(`m.is_active = 1`);
    }
    if (q.as_of_date) {
        where.push(`m.effective_from <= ? AND (m.effective_to IS NULL OR m.effective_to >= ?)`);
        params.push(q.as_of_date, q.as_of_date);
    }

    let sql = `
        SELECT
        m.id, m.entity_code, m.provider_code, m.currency_code, m.component_code, m.entry_side,
        m.gl_account_id, a.code AS gl_account_code, a.name AS gl_account_name,
        m.effective_from, m.effective_to, m.is_active, m.notes, m.created_at, m.updated_at
        FROM payroll_component_gl_mappings m
        JOIN accounts a ON a.id = m.gl_account_id
    `;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY m.component_code ASC, m.provider_code DESC, m.effective_from DESC, m.id DESC LIMIT ? OFFSET ?`;
    params.push(q.limit, q.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    async function upsertMapping(db, payload, userId = null) {
    const expectedSide = EXPECTED_SIDE_BY_COMPONENT[payload.component_code];
    if (expectedSide && expectedSide !== payload.entry_side) {
        const err = new Error(`entry_side must be ${expectedSide} for ${payload.component_code}`);
        err.statusCode = 400;
        throw err;
    }

    if (payload.effective_to && payload.effective_to < payload.effective_from) {
        const err = new Error("effective_to cannot be before effective_from");
        err.statusCode = 400;
        throw err;
    }

    // Optional: close previous open mapping for same key
    if (payload.close_previous_open_mapping) {
        const [prev] = await db.query(
        `
        SELECT id, effective_from
        FROM payroll_component_gl_mappings
        WHERE entity_code = ?
            AND ((provider_code IS NULL AND ? IS NULL) OR provider_code = ?)
            AND currency_code = ?
            AND component_code = ?
            AND is_active = 1
            AND effective_to IS NULL
            AND effective_from < ?
        ORDER BY effective_from DESC, id DESC
        LIMIT 1
        `,
        [
            payload.entity_code,
            payload.provider_code,
            payload.provider_code,
            payload.currency_code,
            payload.component_code,
            payload.effective_from,
        ]
        );

        if (prev[0]) {
        await db.query(
            `
            UPDATE payroll_component_gl_mappings
            SET effective_to = DATE_SUB(?, INTERVAL 1 DAY), updated_at = NOW()
            WHERE id = ?
            `,
            [payload.effective_from, prev[0].id]
        );

        await writeMappingAudit(db, {
            mappingId: prev[0].id,
            action: "CLOSED_PREVIOUS",
            payload: { closed_due_to_new_mapping_effective_from: payload.effective_from },
            userId,
        });
        }
    }

    // Reject overlap (active rows) for same key
    const [overlaps] = await db.query(
        `
        SELECT id
        FROM payroll_component_gl_mappings
        WHERE entity_code = ?
        AND ((provider_code IS NULL AND ? IS NULL) OR provider_code = ?)
        AND currency_code = ?
        AND component_code = ?
        AND is_active = 1
        AND (
            (effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?))
            OR
            (? <= effective_from AND (? IS NULL OR ? >= effective_from))
        )
        LIMIT 1
        `,
        [
        payload.entity_code,
        payload.provider_code,
        payload.provider_code,
        payload.currency_code,
        payload.component_code,
        payload.effective_from,
        payload.effective_from,
        payload.effective_from,
        payload.effective_to,
        payload.effective_to,
        ]
    );

    if (overlaps[0]) {
        const err = new Error("Overlapping effective-dated mapping exists for this component");
        err.statusCode = 409;
        throw err;
    }

    const [ins] = await db.query(
        `
        INSERT INTO payroll_component_gl_mappings
        (entity_code, provider_code, currency_code, component_code, entry_side, gl_account_id, effective_from, effective_to, is_active, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `,
        [
        payload.entity_code,
        payload.provider_code,
        payload.currency_code,
        payload.component_code,
        payload.entry_side,
        payload.gl_account_id,
        payload.effective_from,
        payload.effective_to,
        payload.notes || null,
        userId,
        ]
    );

    await writeMappingAudit(db, {
        mappingId: ins.insertId,
        action: "CREATED",
        payload: payload,
        userId,
    });

    const [rows] = await db.query(
        `
        SELECT m.*, a.code AS gl_account_code, a.name AS gl_account_name
        FROM payroll_component_gl_mappings m
        JOIN accounts a ON a.id = m.gl_account_id
        WHERE m.id = ?
        LIMIT 1
        `,
        [ins.insertId]
    );

    return rows[0];
    }

    module.exports = {
    EXPECTED_SIDE_BY_COMPONENT,
    listMappings,
    upsertMapping,
    };
    ```

    ---

    ## 5) Accrual service — `backend/src/services/payroll.accruals.service.js`

    > **Important:** this assumes your GL tables are named `journal_entries` / `journal_entry_lines` and support posted inserts like your earlier payment PR skeleton. Adapt if needed.

    ```js
    // backend/src/services/payroll.accruals.service.js

    const { EXPECTED_SIDE_BY_COMPONENT } = require("./payroll.mappings.service");

    const COMPONENT_BUILDERS = [
    { code: "BASE_SALARY_EXPENSE", field: "base_salary", side: "DEBIT", label: "Base Salary Expense" },
    { code: "OVERTIME_EXPENSE", field: "overtime_pay", side: "DEBIT", label: "Overtime Expense" },
    { code: "BONUS_EXPENSE", field: "bonus_pay", side: "DEBIT", label: "Bonus Expense" },
    { code: "ALLOWANCES_EXPENSE", field: "allowances_total", side: "DEBIT", label: "Allowances Expense" },
    { code: "EMPLOYER_TAX_EXPENSE", field: "employer_tax", side: "DEBIT", label: "Employer Tax Expense" },
    { code: "EMPLOYER_SOCIAL_SECURITY_EXPENSE", field: "employer_social_security", side: "DEBIT", label: "Employer SS Expense" },

    { code: "PAYROLL_NET_PAYABLE", field: "net_pay", side: "CREDIT", label: "Payroll Net Payable" },
    { code: "EMPLOYEE_TAX_PAYABLE", field: "employee_tax", side: "CREDIT", label: "Employee Tax Payable" },
    { code: "EMPLOYEE_SOCIAL_SECURITY_PAYABLE", field: "employee_social_security", side: "CREDIT", label: "Employee SS Payable" },
    { code: "EMPLOYER_TAX_PAYABLE", field: "employer_tax", side: "CREDIT", label: "Employer Tax Payable" },
    { code: "EMPLOYER_SOCIAL_SECURITY_PAYABLE", field: "employer_social_security", side: "CREDIT", label: "Employer SS Payable" },
    { code: "OTHER_DEDUCTIONS_PAYABLE", field: "other_deductions", side: "CREDIT", label: "Other Deductions Payable" },
    ];

    async function writeRunAudit(db, runId, action, payload, userId = null) {
    await db.query(
        `INSERT INTO payroll_run_audit (run_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?)`,
        [runId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function getRunHeader(db, runId) {
    const [rows] = await db.query(`SELECT * FROM payroll_runs WHERE id = ? LIMIT 1`, [runId]);
    return rows[0] || null;
    }

    async function getRunTotals(db, runId) {
    const [rows] = await db.query(
        `
        SELECT
        COALESCE(SUM(base_salary),0) AS base_salary,
        COALESCE(SUM(overtime_pay),0) AS overtime_pay,
        COALESCE(SUM(bonus_pay),0) AS bonus_pay,
        COALESCE(SUM(allowances_total),0) AS allowances_total,
        COALESCE(SUM(gross_pay),0) AS gross_pay,
        COALESCE(SUM(employee_tax),0) AS employee_tax,
        COALESCE(SUM(employee_social_security),0) AS employee_social_security,
        COALESCE(SUM(other_deductions),0) AS other_deductions,
        COALESCE(SUM(net_pay),0) AS net_pay,
        COALESCE(SUM(employer_tax),0) AS employer_tax,
        COALESCE(SUM(employer_social_security),0) AS employer_social_security
        FROM payroll_run_lines
        WHERE run_id = ?
        `,
        [runId]
    );
    const r = rows[0] || {};
    const out = {};
    Object.keys(r).forEach((k) => (out[k] = Number(Number(r[k] || 0).toFixed(2))));
    return out;
    }

    async function resolveMappingForComponent(db, { entity_code, provider_code, currency_code, pay_date, component_code }) {
    const [rows] = await db.query(
        `
        SELECT
        m.id, m.entity_code, m.provider_code, m.currency_code, m.component_code, m.entry_side,
        m.gl_account_id, m.effective_from, m.effective_to,
        a.code AS gl_account_code, a.name AS gl_account_name
        FROM payroll_component_gl_mappings m
        JOIN accounts a ON a.id = m.gl_account_id
        WHERE m.entity_code = ?
        AND m.currency_code = ?
        AND m.component_code = ?
        AND m.is_active = 1
        AND (m.provider_code = ? OR m.provider_code IS NULL)
        AND m.effective_from <= ?
        AND (m.effective_to IS NULL OR m.effective_to >= ?)
        ORDER BY
        CASE WHEN m.provider_code = ? THEN 0 ELSE 1 END,
        m.effective_from DESC,
        m.id DESC
        LIMIT 1
        `,
        [entity_code, currency_code, component_code, provider_code, pay_date, pay_date, provider_code]
    );

    return rows[0] || null;
    }

    function buildComponentAmounts(totals) {
    return COMPONENT_BUILDERS
        .map((c) => ({
        component_code: c.code,
        label: c.label,
        entry_side: c.side,
        amount: Number(Number(totals[c.field] || 0).toFixed(2)),
        }))
        .filter((x) => x.amount > 0.004);
    }

    async function buildAccrualPreview(db, runId) {
    const run = await getRunHeader(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    const totals = await getRunTotals(db, runId);
    const components = buildComponentAmounts(totals);

    const posting_lines = [];
    const missing_mappings = [];

    for (const c of components) {
        const mapping = await resolveMappingForComponent(db, {
        entity_code: run.entity_code,
        provider_code: run.provider_code,
        currency_code: run.currency_code,
        pay_date: run.pay_date,
        component_code: c.component_code,
        });

        if (!mapping) {
        missing_mappings.push({
            component_code: c.component_code,
            entry_side: c.entry_side,
            amount: c.amount,
        });
        continue;
        }

        if (mapping.entry_side !== c.entry_side) {
        missing_mappings.push({
            component_code: c.component_code,
            entry_side: c.entry_side,
            amount: c.amount,
            issue: `Mapping side mismatch (${mapping.entry_side})`,
        });
        continue;
        }

        posting_lines.push({
        component_code: c.component_code,
        entry_side: c.entry_side,
        amount: c.amount,
        gl_account_id: Number(mapping.gl_account_id),
        gl_account_code: mapping.gl_account_code,
        gl_account_name: mapping.gl_account_name,
        mapping_id: Number(mapping.id),
        memo: `${run.run_no} ${c.label}`,
        });
    }

    const debit_total = Number(
        posting_lines.filter((x) => x.entry_side === "DEBIT").reduce((s, x) => s + x.amount, 0).toFixed(2)
    );
    const credit_total = Number(
        posting_lines.filter((x) => x.entry_side === "CREDIT").reduce((s, x) => s + x.amount, 0).toFixed(2)
    );

    return {
        run: {
        id: run.id,
        run_no: run.run_no,
        status: run.status,
        entity_code: run.entity_code,
        provider_code: run.provider_code,
        payroll_period: run.payroll_period,
        pay_date: run.pay_date,
        currency_code: run.currency_code,
        accrual_journal_entry_id: run.accrual_journal_entry_id || null,
        },
        totals,
        components,
        posting_lines,
        missing_mappings,
        debit_total,
        credit_total,
        is_balanced: Math.abs(debit_total - credit_total) < 0.01,
        can_finalize:
        !run.accrual_journal_entry_id &&
        missing_mappings.length === 0 &&
        Math.abs(debit_total - credit_total) < 0.01 &&
        ["IMPORTED", "REVIEWED", "FINALIZED"].includes(run.status),
    };
    }

    async function markRunReviewed(db, runId, body, userId = null) {
    const run = await getRunHeader(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }
    if (run.status === "FINALIZED" && run.accrual_journal_entry_id) {
        return run; // harmless idempotent review after finalize
    }

    const preview = await buildAccrualPreview(db, runId);

    await db.query(
        `
        UPDATE payroll_runs
        SET status = 'REVIEWED',
            reviewed_by = COALESCE(reviewed_by, ?),
            reviewed_at = COALESCE(reviewed_at, NOW())
        WHERE id = ?
        `,
        [userId, runId]
    );

    await writeRunAudit(db, runId, "VALIDATION", {
        missing_mapping_count: preview.missing_mappings.length,
        debit_total: preview.debit_total,
        credit_total: preview.credit_total,
        is_balanced: preview.is_balanced,
        note: body.note || null,
    }, userId);

    await writeRunAudit(db, runId, "STATUS", { to: "REVIEWED" }, userId);

    return getRunHeader(db, runId);
    }

    async function createAccrualJournal(db, preview, userId = null) {
    const run = preview.run;

    const [jeIns] = await db.query(
        `
        INSERT INTO journal_entries
        (journal_no, status, memo, posted_at, created_by)
        VALUES (?, 'POSTED', ?, NOW(), ?)
        `,
        [`PAYACC-${run.run_no}`, `Payroll accrual ${run.run_no}`, userId]
    );

    const journalId = jeIns.insertId;
    let lineNo = 1;

    for (const l of preview.posting_lines) {
        const dr = l.entry_side === "DEBIT" ? l.amount : 0;
        const cr = l.entry_side === "CREDIT" ? l.amount : 0;
        const signedAmount = l.entry_side === "DEBIT" ? l.amount : -l.amount;

        await db.query(
        `
        INSERT INTO journal_entry_lines
        (journal_entry_id, line_no, account_id, dr_amount, cr_amount, amount, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [journalId, lineNo++, l.gl_account_id, dr, cr, signedAmount, l.memo]
        );
    }

    return journalId;
    }

    async function finalizeRunAccrual(db, runId, body, userId = null) {
    const run = await getRunHeader(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    if (run.accrual_journal_entry_id) {
        // idempotent finalize/post
        return getRunHeader(db, runId);
    }

    if (!["IMPORTED", "REVIEWED"].includes(run.status) && !body.force_from_imported) {
        const err = new Error(`Cannot finalize payroll run in status ${run.status}`);
        err.statusCode = 400;
        throw err;
    }

    // Optional maker-checker rule (recommended)
    if (run.imported_by && userId && Number(run.imported_by) === Number(userId)) {
        const err = new Error("Importer cannot finalize the same payroll run");
        err.statusCode = 403;
        throw err;
    }

    const preview = await buildAccrualPreview(db, runId);

    if (preview.missing_mappings.length) {
        const err = new Error("Cannot finalize: missing component GL mappings");
        err.statusCode = 400;
        err.details = preview.missing_mappings;
        throw err;
    }
    if (!preview.is_balanced) {
        const err = new Error("Cannot finalize: accrual journal preview is not balanced");
        err.statusCode = 400;
        throw err;
    }

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const currentPreview = await buildAccrualPreview(q, runId);
        if (currentPreview.run.accrual_journal_entry_id) {
        if (conn) await conn.commit();
        return getRunHeader(db, runId);
        }

        const journalId = await createAccrualJournal(q, currentPreview, userId);

        await q.query(
        `
        UPDATE payroll_runs
        SET status = 'FINALIZED',
            finalized_by = ?,
            finalized_at = NOW(),
            accrual_journal_entry_id = ?,
            accrual_posted_by = ?,
            accrual_posted_at = NOW()
        WHERE id = ?
        `,
        [userId, journalId, userId, runId]
        );

        await writeRunAudit(q, runId, "ACCRUAL_POSTED", {
        journal_entry_id: journalId,
        debit_total: currentPreview.debit_total,
        credit_total: currentPreview.credit_total,
        line_count: currentPreview.posting_lines.length,
        note: body.note || null,
        }, userId);

        await writeRunAudit(q, runId, "STATUS", { to: "FINALIZED" }, userId);

        if (conn) await conn.commit();
        return getRunHeader(db, runId);
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    module.exports = {
    buildAccrualPreview,
    markRunReviewed,
    finalizeRunAccrual,
    };
    ```

    ---

    ## 6) Mapping routes — `backend/src/routes/payroll.mappings.js`

    ```js
    // backend/src/routes/payroll.mappings.js

    const express = require("express");
    const { validateListMappingsQuery, validateUpsertMapping } = require("./payroll.mappings.validators");
    const service = require("../services/payroll.mappings.service");

    // replace with your actual helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/payroll/mappings
    router.get(
    "/mappings",
    requireAuth,
    requirePermission("payroll.mappings.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListMappingsQuery(req.query);
        const items = await service.listMappings(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/mappings/upsert
    router.post(
    "/mappings/upsert",
    requireAuth,
    requirePermission("payroll.mappings.write"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const body = validateUpsertMapping(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.upsertMapping(db, body, userId);
        res.status(201).json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 7) Accrual routes — `backend/src/routes/payroll.accruals.js`

    ```js
    // backend/src/routes/payroll.accruals.js

    const express = require("express");
    const {
    validateRunIdParam,
    validateReviewBody,
    validateFinalizeBody,
    } = require("./payroll.accruals.validators");
    const service = require("../services/payroll.accruals.service");

    // replace with your actual helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/payroll/runs/:id/accrual-preview
    router.get(
    "/runs/:id/accrual-preview",
    requireAuth,
    requirePermission("payroll.runs.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const result = await service.buildAccrualPreview(db, id);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/runs/:id/review
    router.post(
    "/runs/:id/review",
    requireAuth,
    requirePermission("payroll.runs.review"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const body = validateReviewBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.markRunReviewed(db, id, body, userId);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/runs/:id/finalize
    router.post(
    "/runs/:id/finalize",
    requireAuth,
    requirePermission("payroll.runs.finalize"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const body = validateFinalizeBody(req.body);
        const userId = req.user?.id ?? null;
        const row = await service.finalizeRunAccrual(db, id, body, userId);
        res.json(row);
        } catch (err) {
        next(err);
        }
    }
    );

    module.exports = router;
    ```

    ---

    ## 8) Mount routes — `backend/src/index.js`

    ```js
    // backend/src/index.js
    const payrollMappingsRoutes = require("./routes/payroll.mappings");
    const payrollAccrualsRoutes = require("./routes/payroll.accruals");

    // ...
    app.use("/api/v1/payroll", payrollMappingsRoutes);
    app.use("/api/v1/payroll", payrollAccrualsRoutes);
    ```

    ---

    ## 9) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m026_payroll_accrual_posting = require("./m026_payroll_accrual_posting");

    module.exports = [
    // ...
    m026_payroll_accrual_posting,
    ];
    ```

    ---

    ## 10) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const PAYROLL_P02_PERMISSIONS = [
    "payroll.mappings.read",
    "payroll.mappings.write",
    "payroll.runs.review",
    "payroll.runs.finalize",
    ];

    // merge into permission seed list
    ```

    ---

    ## 11) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `GET /api/v1/payroll/mappings`
    * `POST /api/v1/payroll/mappings/upsert`
    * `GET /api/v1/payroll/runs/{id}/accrual-preview`
    * `POST /api/v1/payroll/runs/{id}/review`
    * `POST /api/v1/payroll/runs/{id}/finalize`

    ---

    ## 12) Backend smoke test — `backend/scripts/test-payroll-prp02-accrual-posting.js`

    ```js
    // backend/scripts/test-payroll-prp02-accrual-posting.js

    async function main() {
    // Preconditions:
    // - PR-P01 is implemented (import endpoint + payroll_runs exists)
    // - GL accounts exist for expense/payable mapping targets
    //
    // Flow:
    // 1) Import a payroll CSV run (or reuse existing fresh run)
    // 2) Create effective-dated mappings for all non-zero payroll components
    // 3) GET /api/v1/payroll/runs/:id/accrual-preview
    //    -> missing_mappings = []
    //    -> is_balanced = true
    //    -> posting_lines returned
    // 4) POST /api/v1/payroll/runs/:id/review
    //    -> status becomes REVIEWED
    // 5) POST /api/v1/payroll/runs/:id/finalize
    //    -> status FINALIZED
    //    -> accrual_journal_entry_id present
    // 6) POST /finalize again
    //    -> idempotent (same accrual_journal_entry_id)
    // 7) Create another run without one required mapping
    //    -> finalize fails 400 (missing mappings)
    // 8) Effective-date check:
    //    - Create new mapping version effective later date
    //    - Preview picks old mapping for old pay_date, new mapping for later pay_date
    // 9) Permissions:
    //    - payroll.mappings.read/write, payroll.runs.review/finalize enforced (403)
    console.log("PR-P02 smoke test placeholder");
    }

    main().catch((err) => {
    console.error(err);
    process.exit(1);
    });
    ```

    ---

    ## 13) `backend/package.json` updates

    ```json
    {
    "scripts": {
        "test:payroll:prp02": "node backend/scripts/test-payroll-prp02-accrual-posting.js"
    }
    }
    ```

    ---

    # Frontend skeletons

    ## 14) Mapping API client — `frontend/src/api/payrollMappings.js`

    ```js
    // frontend/src/api/payrollMappings.js

    import { apiFetch } from "./client"; // adapt to your helper

    export function listPayrollMappings(params = {}) {
    const q = new URLSearchParams();
    if (params.entity_code) q.set("entity_code", params.entity_code);
    if (params.provider_code) q.set("provider_code", params.provider_code);
    if (params.currency_code) q.set("currency_code", params.currency_code);
    if (params.component_code) q.set("component_code", params.component_code);
    if (params.as_of_date) q.set("as_of_date", params.as_of_date);
    const qs = q.toString();
    return apiFetch(`/api/v1/payroll/mappings${qs ? `?${qs}` : ""}`);
    }

    export function upsertPayrollMapping(payload) {
    return apiFetch(`/api/v1/payroll/mappings/upsert`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }
    ```

    ---

    ## 15) Payroll mappings page — `frontend/src/pages/payroll/PayrollComponentMappingsPage.jsx`

    ```jsx
    // frontend/src/pages/payroll/PayrollComponentMappingsPage.jsx

    import { useEffect, useState } from "react";
    import { listPayrollMappings, upsertPayrollMapping } from "../../api/payrollMappings";

    const COMPONENTS = [
    "BASE_SALARY_EXPENSE",
    "OVERTIME_EXPENSE",
    "BONUS_EXPENSE",
    "ALLOWANCES_EXPENSE",
    "EMPLOYER_TAX_EXPENSE",
    "EMPLOYER_SOCIAL_SECURITY_EXPENSE",
    "PAYROLL_NET_PAYABLE",
    "EMPLOYEE_TAX_PAYABLE",
    "EMPLOYEE_SOCIAL_SECURITY_PAYABLE",
    "EMPLOYER_TAX_PAYABLE",
    "EMPLOYER_SOCIAL_SECURITY_PAYABLE",
    "OTHER_DEDUCTIONS_PAYABLE",
    ];

    export default function PayrollComponentMappingsPage() {
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [form, setForm] = useState({
        entity_code: "",
        provider_code: "",
        currency_code: "USD",
        component_code: COMPONENTS[0],
        entry_side: "DEBIT",
        gl_account_id: "",
        effective_from: "",
        notes: "",
    });

    async function load() {
        setErr("");
        try {
        const res = await listPayrollMappings({
            entity_code: form.entity_code || undefined,
            provider_code: form.provider_code || undefined,
            currency_code: form.currency_code || undefined,
        });
        setItems(res.items || []);
        } catch (e) {
        setErr(e.message || "Failed to load mappings");
        }
    }

    useEffect(() => {
        // optional initial load without filters
        load();
    }, []);

    async function onSubmit(e) {
        e.preventDefault();
        setErr("");
        try {
        await upsertPayrollMapping({
            ...form,
            gl_account_id: Number(form.gl_account_id),
        });
        await load();
        } catch (e) {
        setErr(e.message || "Failed to save mapping");
        }
    }

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <h1 className="text-lg font-semibold mb-3">Payroll Component Mappings</h1>
            {err ? <div className="text-sm text-red-600 mb-2">{err}</div> : null}

            <form className="grid grid-cols-1 md:grid-cols-3 gap-2" onSubmit={onSubmit}>
            <input className="border rounded px-2 py-1" placeholder="Entity Code"
                value={form.entity_code}
                onChange={(e) => setForm((s) => ({ ...s, entity_code: e.target.value }))} />

            <input className="border rounded px-2 py-1" placeholder="Provider Code (optional)"
                value={form.provider_code}
                onChange={(e) => setForm((s) => ({ ...s, provider_code: e.target.value }))} />

            <input className="border rounded px-2 py-1" placeholder="Currency"
                value={form.currency_code}
                onChange={(e) => setForm((s) => ({ ...s, currency_code: e.target.value }))} />

            <select className="border rounded px-2 py-1"
                value={form.component_code}
                onChange={(e) => setForm((s) => ({ ...s, component_code: e.target.value }))}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <select className="border rounded px-2 py-1"
                value={form.entry_side}
                onChange={(e) => setForm((s) => ({ ...s, entry_side: e.target.value }))}>
                <option value="DEBIT">DEBIT</option>
                <option value="CREDIT">CREDIT</option>
            </select>

            <input className="border rounded px-2 py-1" placeholder="GL Account ID"
                value={form.gl_account_id}
                onChange={(e) => setForm((s) => ({ ...s, gl_account_id: e.target.value }))} />

            <input className="border rounded px-2 py-1" type="date"
                value={form.effective_from}
                onChange={(e) => setForm((s) => ({ ...s, effective_from: e.target.value }))} />

            <input className="border rounded px-2 py-1 md:col-span-2" placeholder="Notes"
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />

            <div className="md:col-span-3 flex gap-2">
                <button className="px-3 py-1 rounded border" type="submit">Save Mapping</button>
                <button className="px-3 py-1 rounded border" type="button" onClick={load}>Refresh</button>
            </div>
            </form>
        </div>

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Mappings</h2>
            <div className="overflow-auto">
            <table className="min-w-full text-sm border-collapse">
                <thead>
                <tr className="border-b">
                    <th className="text-left p-2">Component</th>
                    <th className="text-left p-2">Side</th>
                    <th className="text-left p-2">GL</th>
                    <th className="text-left p-2">Entity</th>
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Effective</th>
                </tr>
                </thead>
                <tbody>
                {items.map((m) => (
                    <tr key={m.id} className="border-b">
                    <td className="p-2">{m.component_code}</td>
                    <td className="p-2">{m.entry_side}</td>
                    <td className="p-2">{m.gl_account_code || m.gl_account_id}</td>
                    <td className="p-2">{m.entity_code}</td>
                    <td className="p-2">{m.provider_code || "*"}</td>
                    <td className="p-2">{m.effective_from} → {m.effective_to || "open"}</td>
                    </tr>
                ))}
                {items.length === 0 && <tr><td className="p-2" colSpan={6}>No mappings found.</td></tr>}
                </tbody>
            </table>
            </div>
        </div>
        </div>
    );
    }
    ```

    ---

    ## 16) Update payroll run API — `frontend/src/api/payrollRuns.js`

    Add these functions:

    ```js
    // frontend/src/api/payrollRuns.js

    export function getPayrollRunAccrualPreview(id) {
    return apiFetch(`/api/v1/payroll/runs/${id}/accrual-preview`);
    }

    export function reviewPayrollRun(id, payload = {}) {
    return apiFetch(`/api/v1/payroll/runs/${id}/review`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function finalizePayrollRun(id, payload = {}) {
    return apiFetch(`/api/v1/payroll/runs/${id}/finalize`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }
    ```

    ---

    ## 17) Update payroll run detail page — `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`

    > Add a preview/finalize panel (keep your existing header + lines + audit).

    ```jsx
    // add imports
    import {
    getPayrollRun,
    getPayrollRunAccrualPreview,
    reviewPayrollRun,
    finalizePayrollRun,
    } from "../../api/payrollRuns";

    // inside component state
    const [preview, setPreview] = useState(null);

    // load preview alongside run
    async function load() {
    setErr("");
    try {
        const [runRes, previewRes] = await Promise.all([
        getPayrollRun(id),
        getPayrollRunAccrualPreview(id).catch(() => null),
        ]);
        setRun(runRes);
        setPreview(previewRes);
    } catch (e) {
        setErr(e.message || "Failed to load payroll run");
    }
    }

    async function onReview() {
    try {
        await reviewPayrollRun(id, {});
        await load();
    } catch (e) {
        setErr(e.message || "Review failed");
    }
    }

    async function onFinalize() {
    try {
        await finalizePayrollRun(id, {});
        await load();
    } catch (e) {
        setErr(e.message || "Finalize failed");
    }
    }
    ```

    Add a new panel in the JSX (below the header block is a good spot):

    ```jsx
    <div className="rounded border bg-white p-4">
    <div className="flex items-center gap-2 mb-2">
        <h2 className="font-medium">Accrual Preview</h2>
        {preview?.is_balanced ? (
        <span className="text-xs border rounded px-2 py-0.5">Balanced</span>
        ) : (
        <span className="text-xs border rounded px-2 py-0.5">Not Balanced</span>
        )}
    </div>

    {!preview ? (
        <div className="text-sm text-gray-600">Preview unavailable.</div>
    ) : (
        <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div><b>Debit Total:</b> {preview.debit_total}</div>
            <div><b>Credit Total:</b> {preview.credit_total}</div>
            <div><b>Missing Mappings:</b> {preview.missing_mappings?.length || 0}</div>
            <div><b>JE:</b> {preview.run?.accrual_journal_entry_id || "-"}</div>
        </div>

        {preview.missing_mappings?.length > 0 && (
            <div className="border rounded p-2">
            <div className="font-medium mb-1">Missing Mappings</div>
            <ul className="list-disc pl-5">
                {preview.missing_mappings.map((m, idx) => (
                <li key={idx}>
                    {m.component_code} ({m.entry_side}) amount={m.amount}
                    {m.issue ? ` - ${m.issue}` : ""}
                </li>
                ))}
            </ul>
            </div>
        )}

        <div className="overflow-auto">
            <table className="min-w-full text-sm border-collapse">
            <thead>
                <tr className="border-b">
                <th className="text-left p-2">Component</th>
                <th className="text-left p-2">Side</th>
                <th className="text-left p-2">GL</th>
                <th className="text-left p-2">Amount</th>
                </tr>
            </thead>
            <tbody>
                {(preview.posting_lines || []).map((l, idx) => (
                <tr key={`${l.component_code}-${idx}`} className="border-b">
                    <td className="p-2">{l.component_code}</td>
                    <td className="p-2">{l.entry_side}</td>
                    <td className="p-2">{l.gl_account_code || l.gl_account_id}</td>
                    <td className="p-2">{l.amount}</td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>

        <div className="flex gap-2">
            {run?.status !== "FINALIZED" && (
            <>
                <button className="border rounded px-2 py-1" type="button" onClick={onReview}>
                Mark Reviewed
                </button>
                <button
                className="border rounded px-2 py-1"
                type="button"
                onClick={onFinalize}
                disabled={!preview.can_finalize}
                >
                Finalize + Post Accrual
                </button>
            </>
            )}
        </div>
        </div>
    )}
    </div>
    ```

    ---

    ## 18) App routes — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import PayrollComponentMappingsPage from "./pages/payroll/PayrollComponentMappingsPage";

    // ...
    <Route
    path="/payroll/mappings"
    element={
        <RequirePermission permission="payroll.mappings.read">
        <PayrollComponentMappingsPage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 19) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    Add under Payroll:

    ```js
    {
    key: "payroll-mappings",
    label: "Payroll Mappings",
    to: "/payroll/mappings",
    permission: "payroll.mappings.read",
    }
    ```

    ---

    ## 20) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.payrollMappings": "Payroll Mappings",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Effective-dated payroll component → GL mappings can be created and listed
    * ✅ Mapping side is validated (debit components can’t be mapped as credit, etc.)
    * ✅ Payroll accrual preview returns posting lines, missing mappings, and balance check
    * ✅ Payroll run can be marked `REVIEWED`
    * ✅ Finalize posts accrual JE and marks payroll run `FINALIZED`
    * ✅ Finalize is idempotent (no duplicate accrual journal)
    * ✅ Mapping changes and payroll posting actions write audit rows
    * ✅ Permissions enforced for mappings/review/finalize
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:payroll:prp02`

    Should verify at least:

    1. **Create mappings**

    * POST `/api/v1/payroll/mappings/upsert` for all non-zero components
    * rows created with correct effective dates

    2. **Accrual preview**

    * GET `/api/v1/payroll/runs/:id/accrual-preview`
    * `missing_mappings=[]`
    * `is_balanced=true`
    * posting lines returned

    3. **Review**

    * POST `/api/v1/payroll/runs/:id/review`
    * run status becomes `REVIEWED`

    4. **Finalize accrual**

    * POST `/api/v1/payroll/runs/:id/finalize`
    * run status becomes `FINALIZED`
    * `accrual_journal_entry_id` is set

    5. **Idempotent finalize**

    * POST `/finalize` again
    * same `accrual_journal_entry_id`, no duplicate JE

    6. **Missing mapping failure**

    * Another payroll run with one mapping intentionally missing
    * finalize returns `400` with missing component info

    7. **Effective-dated selection**

    * Two versions of a mapping with different `effective_from`
    * preview picks correct one based on `pay_date`

    8. **Permissions**

    * `payroll.mappings.read/write`, `payroll.runs.review`, `payroll.runs.finalize` all enforced (`403`)

    ---

    # Example mapping payloads (manual test)

    ## Base salary expense mapping

    ```json
    {
    "entity_code": "AFG-ENTITY-01",
    "provider_code": "PROVIDER_X",
    "currency_code": "USD",
    "component_code": "BASE_SALARY_EXPENSE",
    "entry_side": "DEBIT",
    "gl_account_id": 610100,
    "effective_from": "2026-01-01",
    "notes": "Payroll base salaries"
    }
    ```

    ## Payroll net payable mapping

    ```json
    {
    "entity_code": "AFG-ENTITY-01",
    "provider_code": "PROVIDER_X",
    "currency_code": "USD",
    "component_code": "PAYROLL_NET_PAYABLE",
    "entry_side": "CREDIT",
    "gl_account_id": 320100,
    "effective_from": "2026-01-01",
    "notes": "Net salaries payable"
    }
    ```

    ---

    # Payroll components to map in P02

    Map these (at minimum when amounts are non-zero):

    ### Debit (Expense)

    * `BASE_SALARY_EXPENSE`
    * `OVERTIME_EXPENSE`
    * `BONUS_EXPENSE`
    * `ALLOWANCES_EXPENSE`
    * `EMPLOYER_TAX_EXPENSE`
    * `EMPLOYER_SOCIAL_SECURITY_EXPENSE`

    ### Credit (Payables)

    * `PAYROLL_NET_PAYABLE`
    * `EMPLOYEE_TAX_PAYABLE`
    * `EMPLOYEE_SOCIAL_SECURITY_PAYABLE`
    * `EMPLOYER_TAX_PAYABLE`
    * `EMPLOYER_SOCIAL_SECURITY_PAYABLE`
    * `OTHER_DEDUCTIONS_PAYABLE`

    ---

    # Tiny implementation notes (important)

    * **P02 posts accrual only** — no bank/cash movement yet.
    * This matches the real-world contract:

    * Payroll run imported and validated
    * Accrual posted to GL
    * Liabilities later settled through **Payment Batches (PR-B04)**
    * In the next payroll payment PR, you’ll generate `source_type="PAYROLL"` payment batches from finalized payroll runs and settle `PAYROLL_NET_PAYABLE` through the bank module.

    ---

    If you want, next I can do **PR-P03 (Payroll Liability Breakdown + Payment Batch Preparation)** so payroll runs can feed **PR-B04** cleanly without losing employee-level traceability.

Perfect — here’s **PR-P03** in the same concrete format.

# PR-P03: Payroll Liability Breakdown + Payment Batch Preparation (Feeds PR-B04)

    ## Goal

    Convert a **FINALIZED payroll run (PR-P02)** into a payroll liability subledger, then prepare **generic Payment Batches (PR-B04)** from those liabilities.

    This PR gives you:

    * ✅ Payroll liability records (employee net + statutory liabilities)
    * ✅ Employee-level traceability preserved after accrual posting
    * ✅ Idempotent liability build from finalized payroll run
    * ✅ Payment batch preview (B04-compatible payload)
    * ✅ Create payroll payment batch (`source_type="PAYROLL"`) from liabilities
    * ✅ Liability ↔ payment batch link table
    * ✅ Audit trail
    * ❌ No auto-mark-paid from bank reconciliation yet (next payroll payment sync PR)

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m027_payroll_liabilities_payment_prep.js`
    * `backend/src/routes/payroll.liabilities.js`
    * `backend/src/routes/payroll.liabilities.validators.js`
    * `backend/src/services/payroll.liabilities.service.js`
    * `backend/scripts/test-payroll-prp03-liabilities-payment-prep.js`

    ### Frontend

    * `frontend/src/api/payrollLiabilities.js`
    * `frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js`
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`
    * `frontend/src/App.jsx`
    * `frontend/src/layouts/sidebarConfig.js`
    * `frontend/src/i18n/messages.js`

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m027_payroll_liabilities_payment_prep.js`

    ```js
    // backend/src/migrations/m027_payroll_liabilities_payment_prep.js

    module.exports = {
    id: "m027_payroll_liabilities_payment_prep",

    async up(db) {
        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_run_liabilities (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            liability_key VARCHAR(120) NOT NULL, -- deterministic idempotency key per liability row
            liability_type VARCHAR(50) NOT NULL, -- NET_PAY, EMPLOYEE_TAX, EMPLOYEE_SOCIAL_SECURITY, EMPLOYER_TAX, EMPLOYER_SOCIAL_SECURITY, OTHER_DEDUCTIONS
            liability_group VARCHAR(30) NOT NULL, -- EMPLOYEE_NET, STATUTORY
            source_run_line_id BIGINT UNSIGNED NULL,

            employee_code VARCHAR(100) NULL,
            employee_name VARCHAR(255) NULL,
            cost_center_code VARCHAR(100) NULL,

            beneficiary_type VARCHAR(30) NOT NULL, -- EMPLOYEE, TAX_AUTHORITY, SOCIAL_SECURITY_AUTHORITY, OTHER
            beneficiary_id BIGINT UNSIGNED NULL,
            beneficiary_name VARCHAR(255) NOT NULL,
            beneficiary_bank_ref VARCHAR(255) NULL,

            payable_component_code VARCHAR(50) NOT NULL, -- maps to payroll component payable code in P02
            payable_gl_account_id BIGINT UNSIGNED NOT NULL,
            payable_ref VARCHAR(100) NULL,

            amount DECIMAL(18,2) NOT NULL,
            currency_code CHAR(3) NOT NULL,

            status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, IN_BATCH, PAID, CANCELLED
            reserved_payment_batch_id BIGINT UNSIGNED NULL,
            paid_at DATETIME NULL,

            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            UNIQUE KEY uq_payroll_liability_key (liability_key),
            KEY idx_payroll_liabilities_run (run_id),
            KEY idx_payroll_liabilities_status (status),
            KEY idx_payroll_liabilities_type (liability_type),
            KEY idx_payroll_liabilities_batch (reserved_payment_batch_id),

            CONSTRAINT fk_payroll_liabilities_run
            FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_payroll_liabilities_run_line
            FOREIGN KEY (source_run_line_id) REFERENCES payroll_run_lines(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_payroll_liabilities_gl
            FOREIGN KEY (payable_gl_account_id) REFERENCES accounts(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_payroll_liabilities_reserved_batch
            FOREIGN KEY (reserved_payment_batch_id) REFERENCES payment_batches(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_liability_payment_links (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            payroll_liability_id BIGINT UNSIGNED NOT NULL,
            payment_batch_id BIGINT UNSIGNED NOT NULL,
            payment_batch_line_id BIGINT UNSIGNED NULL,
            allocated_amount DECIMAL(18,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'LINKED', -- LINKED, PAID, RELEASED
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            UNIQUE KEY uq_payroll_liability_batch (payroll_liability_id, payment_batch_id),
            KEY idx_plinks_liability (payroll_liability_id),
            KEY idx_plinks_batch (payment_batch_id),
            KEY idx_plinks_batch_line (payment_batch_line_id),

            CONSTRAINT fk_plinks_liability
            FOREIGN KEY (payroll_liability_id) REFERENCES payroll_run_liabilities(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_plinks_batch
            FOREIGN KEY (payment_batch_id) REFERENCES payment_batches(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_plinks_batch_line
            FOREIGN KEY (payment_batch_line_id) REFERENCES payment_batch_lines(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_liability_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            payroll_liability_id BIGINT UNSIGNED NULL,
            action VARCHAR(30) NOT NULL, -- BUILT, STATUS, LINKED_BATCH, RELEASED
            payload_json JSON NULL,
            acted_by BIGINT UNSIGNED NULL,
            acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            KEY idx_pla_run (run_id),
            KEY idx_pla_liability (payroll_liability_id),
            KEY idx_pla_action (action),

            CONSTRAINT fk_pla_run
            FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_pla_liability
            FOREIGN KEY (payroll_liability_id) REFERENCES payroll_run_liabilities(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
        ALTER TABLE payroll_runs
            ADD COLUMN liabilities_built_by BIGINT UNSIGNED NULL AFTER accrual_posted_at,
            ADD COLUMN liabilities_built_at DATETIME NULL AFTER liabilities_built_by
        `).catch(() => {});

        await db.query(`
        ALTER TABLE payroll_runs
            ADD KEY idx_payroll_runs_liabilities_built_at (liabilities_built_at)
        `).catch(() => {});
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS payroll_liability_audit;`);
        await db.query(`DROP TABLE IF EXISTS payroll_liability_payment_links;`);
        await db.query(`DROP TABLE IF EXISTS payroll_run_liabilities;`);
    },
    };
    ```

    ---

    ## 2) Validators — `backend/src/routes/payroll.liabilities.validators.js`

    ```js
    // backend/src/routes/payroll.liabilities.validators.js

    function requirePositiveInt(v, field) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be positive integer`);
    return n;
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function validateRunIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateBuildLiabilitiesBody(body = {}) {
    return {
        note: normalizeString(body.note),
    };
    }

    function validateListPayrollLiabilitiesQuery(query = {}) {
    const scope = normalizeString(query.scope)?.toUpperCase() || null;
    if (scope && !["NET_PAY", "STATUTORY", "ALL"].includes(scope)) {
        throw new Error("scope must be NET_PAY, STATUTORY, or ALL");
    }

    return {
        run_id: query.run_id ? requirePositiveInt(query.run_id, "run_id") : null,
        status: normalizeString(query.status)?.toUpperCase() || null,
        liability_type: normalizeString(query.liability_type)?.toUpperCase() || null,
        scope,
        limit: query.limit ? Math.min(requirePositiveInt(query.limit, "limit"), 500) : 200,
        offset: query.offset ? Math.max(Number(query.offset) || 0, 0) : 0,
    };
    }

    function validatePaymentBatchPreviewQuery(query = {}) {
    const scope = normalizeString(query.scope)?.toUpperCase() || "NET_PAY";
    if (!["NET_PAY", "STATUTORY", "ALL"].includes(scope)) {
        throw new Error("scope must be NET_PAY, STATUTORY, or ALL");
    }
    return { scope };
    }

    function validateCreatePaymentBatchBody(body = {}) {
    const scope = normalizeString(body.scope)?.toUpperCase() || "NET_PAY";
    if (!["NET_PAY", "STATUTORY", "ALL"].includes(scope)) {
        throw new Error("scope must be NET_PAY, STATUTORY, or ALL");
    }

    return {
        scope,
        bank_account_id: requirePositiveInt(body.bank_account_id, "bank_account_id"),
        idempotency_key: normalizeString(body.idempotency_key),
        notes: normalizeString(body.notes),
    };
    }

    module.exports = {
    validateRunIdParam,
    validateBuildLiabilitiesBody,
    validateListPayrollLiabilitiesQuery,
    validatePaymentBatchPreviewQuery,
    validateCreatePaymentBatchBody,
    };
    ```

    ---

    ## 3) Service — `backend/src/services/payroll.liabilities.service.js`

    > Depends on **PR-B04** (`payments.service.js`) and **PR-P02** mappings/finalized runs.

    ```js
    // backend/src/services/payroll.liabilities.service.js

    const paymentsService = require("./payments.service");

    const LIABILITY_COMPONENT_MAP = {
    NET_PAY: { payable_component_code: "PAYROLL_NET_PAYABLE", beneficiary_type: "EMPLOYEE" },
    EMPLOYEE_TAX: { payable_component_code: "EMPLOYEE_TAX_PAYABLE", beneficiary_type: "TAX_AUTHORITY" },
    EMPLOYEE_SOCIAL_SECURITY: { payable_component_code: "EMPLOYEE_SOCIAL_SECURITY_PAYABLE", beneficiary_type: "SOCIAL_SECURITY_AUTHORITY" },
    EMPLOYER_TAX: { payable_component_code: "EMPLOYER_TAX_PAYABLE", beneficiary_type: "TAX_AUTHORITY" },
    EMPLOYER_SOCIAL_SECURITY: { payable_component_code: "EMPLOYER_SOCIAL_SECURITY_PAYABLE", beneficiary_type: "SOCIAL_SECURITY_AUTHORITY" },
    OTHER_DEDUCTIONS: { payable_component_code: "OTHER_DEDUCTIONS_PAYABLE", beneficiary_type: "OTHER" },
    };

    async function writeLiabilityAudit(db, { runId, liabilityId = null, action, payload = null, userId = null }) {
    await db.query(
        `INSERT INTO payroll_liability_audit (run_id, payroll_liability_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?, ?)`,
        [runId, liabilityId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function getRun(db, runId) {
    const [rows] = await db.query(`SELECT * FROM payroll_runs WHERE id=? LIMIT 1`, [runId]);
    return rows[0] || null;
    }

    async function resolvePayableMapping(db, { entity_code, provider_code, currency_code, pay_date, payable_component_code }) {
    const [rows] = await db.query(
        `
        SELECT m.id, m.gl_account_id, m.entry_side, a.code AS gl_account_code, a.name AS gl_account_name
        FROM payroll_component_gl_mappings m
        JOIN accounts a ON a.id = m.gl_account_id
        WHERE m.entity_code = ?
        AND m.currency_code = ?
        AND m.component_code = ?
        AND m.is_active = 1
        AND (m.provider_code = ? OR m.provider_code IS NULL)
        AND m.effective_from <= ?
        AND (m.effective_to IS NULL OR m.effective_to >= ?)
        ORDER BY
        CASE WHEN m.provider_code = ? THEN 0 ELSE 1 END,
        m.effective_from DESC,
        m.id DESC
        LIMIT 1
        `,
        [entity_code, currency_code, payable_component_code, provider_code, pay_date, pay_date, provider_code]
    );
    return rows[0] || null;
    }

    async function getRunLines(db, runId) {
    const [rows] = await db.query(
        `
        SELECT id, line_no, employee_code, employee_name, cost_center_code, net_pay,
            employee_tax, employee_social_security, employer_tax, employer_social_security, other_deductions
        FROM payroll_run_lines
        WHERE run_id = ?
        ORDER BY line_no ASC
        `,
        [runId]
    );
    return rows;
    }

    async function listRunLiabilities(db, runId) {
    const [rows] = await db.query(
        `
        SELECT
        l.*,
        a.code AS payable_gl_account_code,
        a.name AS payable_gl_account_name
        FROM payroll_run_liabilities l
        JOIN accounts a ON a.id = l.payable_gl_account_id
        WHERE l.run_id = ?
        ORDER BY
        CASE WHEN l.liability_group='EMPLOYEE_NET' THEN 0 ELSE 1 END,
        l.id ASC
        `,
        [runId]
    );
    return rows;
    }

    async function listPayrollLiabilities(db, q) {
    const where = [];
    const params = [];

    if (q.run_id) {
        where.push(`l.run_id = ?`);
        params.push(q.run_id);
    }
    if (q.status) {
        where.push(`l.status = ?`);
        params.push(q.status);
    }
    if (q.liability_type) {
        where.push(`l.liability_type = ?`);
        params.push(q.liability_type);
    }
    if (q.scope === "NET_PAY") where.push(`l.liability_group = 'EMPLOYEE_NET'`);
    if (q.scope === "STATUTORY") where.push(`l.liability_group = 'STATUTORY'`);

    let sql = `
        SELECT
        l.id, l.run_id, l.liability_type, l.liability_group, l.employee_code, l.employee_name,
        l.beneficiary_name, l.amount, l.currency_code, l.status, l.reserved_payment_batch_id,
        l.payable_component_code, l.payable_gl_account_id, a.code AS payable_gl_account_code
        FROM payroll_run_liabilities l
        JOIN accounts a ON a.id = l.payable_gl_account_id
    `;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY l.id DESC LIMIT ? OFFSET ?`;
    params.push(q.limit, q.offset);

    const [rows] = await db.query(sql, params);
    return rows;
    }

    function amount2(n) {
    return Number(Number(n || 0).toFixed(2));
    }

    async function buildRunLiabilities(db, runId, body = {}, userId = null) {
    const run = await getRun(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    if (run.status !== "FINALIZED" || !run.accrual_journal_entry_id) {
        const err = new Error("Payroll run must be FINALIZED with accrual journal before building liabilities");
        err.statusCode = 400;
        throw err;
    }

    const [existingRows] = await db.query(
        `SELECT COUNT(*) AS c FROM payroll_run_liabilities WHERE run_id = ?`,
        [runId]
    );
    if (Number(existingRows[0]?.c || 0) > 0) {
        // idempotent
        return {
        run,
        items: await listRunLiabilities(db, runId),
        summary: await summarizeRunLiabilities(db, runId),
        already_built: true,
        };
    }

    const runLines = await getRunLines(db, runId);

    const payableMappings = {};
    const requiredComponents = [
        "PAYROLL_NET_PAYABLE",
        "EMPLOYEE_TAX_PAYABLE",
        "EMPLOYEE_SOCIAL_SECURITY_PAYABLE",
        "EMPLOYER_TAX_PAYABLE",
        "EMPLOYER_SOCIAL_SECURITY_PAYABLE",
        "OTHER_DEDUCTIONS_PAYABLE",
    ];

    for (const c of requiredComponents) {
        const m = await resolvePayableMapping(db, {
        entity_code: run.entity_code,
        provider_code: run.provider_code,
        currency_code: run.currency_code,
        pay_date: run.pay_date,
        payable_component_code: c,
        });

        // allow missing only if total amount for that component will be zero
        payableMappings[c] = m || null;
    }

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const insertedLiabilityIds = [];

        // 1) Employee net liabilities (one row per employee)
        for (const line of runLines) {
        const amount = amount2(line.net_pay);
        if (amount <= 0) continue;

        const comp = LIABILITY_COMPONENT_MAP.NET_PAY.payable_component_code;
        const mapping = payableMappings[comp];
        if (!mapping) {
            const err = new Error(`Missing payable mapping for ${comp}`);
            err.statusCode = 400;
            throw err;
        }

        const liabilityKey = `PRL|RUN:${runId}|NET|RL:${line.id}`;

        const [ins] = await q.query(
            `
            INSERT INTO payroll_run_liabilities
            (run_id, liability_key, liability_type, liability_group, source_run_line_id,
            employee_code, employee_name, cost_center_code,
            beneficiary_type, beneficiary_name, beneficiary_bank_ref,
            payable_component_code, payable_gl_account_id, payable_ref,
            amount, currency_code, status)
            VALUES (?, ?, 'NET_PAY', 'EMPLOYEE_NET', ?, ?, ?, ?, 'EMPLOYEE', ?, NULL, ?, ?, ?, ?, ?, 'OPEN')
            `,
            [
            runId,
            liabilityKey,
            line.id,
            line.employee_code,
            line.employee_name,
            line.cost_center_code || null,
            line.employee_name,
            comp,
            Number(mapping.gl_account_id),
            `${run.run_no}-EMP-${line.employee_code}`,
            amount,
            run.currency_code,
            ]
        );

        insertedLiabilityIds.push(ins.insertId);
        await writeLiabilityAudit(q, {
            runId,
            liabilityId: ins.insertId,
            action: "BUILT",
            payload: { liability_type: "NET_PAY", amount, source_run_line_id: line.id },
            userId,
        });
        }

        // 2) Statutory / deductions liabilities (aggregated by run)
        const statutoryDefs = [
        { liability_type: "EMPLOYEE_TAX", field: "employee_tax", label: "Payroll Tax Authority" },
        { liability_type: "EMPLOYEE_SOCIAL_SECURITY", field: "employee_social_security", label: "Payroll Social Security" },
        { liability_type: "EMPLOYER_TAX", field: "employer_tax", label: "Payroll Employer Tax Authority" },
        { liability_type: "EMPLOYER_SOCIAL_SECURITY", field: "employer_social_security", label: "Payroll Employer Social Security" },
        { liability_type: "OTHER_DEDUCTIONS", field: "other_deductions", label: "Payroll Deductions Clearing" },
        ];

        for (const def of statutoryDefs) {
        const total = amount2(run[`total_${def.field}`]);
        if (total <= 0) continue;

        const comp = LIABILITY_COMPONENT_MAP[def.liability_type].payable_component_code;
        const mapping = payableMappings[comp];
        if (!mapping) {
            const err = new Error(`Missing payable mapping for ${comp}`);
            err.statusCode = 400;
            throw err;
        }

        const liabilityKey = `PRL|RUN:${runId}|STAT|${def.liability_type}`;

        const [ins] = await q.query(
            `
            INSERT INTO payroll_run_liabilities
            (run_id, liability_key, liability_type, liability_group, source_run_line_id,
            beneficiary_type, beneficiary_name,
            payable_component_code, payable_gl_account_id, payable_ref,
            amount, currency_code, status)
            VALUES (?, ?, ?, 'STATUTORY', NULL, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
            `,
            [
            runId,
            liabilityKey,
            def.liability_type,
            LIABILITY_COMPONENT_MAP[def.liability_type].beneficiary_type,
            def.label,
            comp,
            Number(mapping.gl_account_id),
            `${run.run_no}-${def.liability_type}`,
            total,
            run.currency_code,
            ]
        );

        insertedLiabilityIds.push(ins.insertId);
        await writeLiabilityAudit(q, {
            runId,
            liabilityId: ins.insertId,
            action: "BUILT",
            payload: { liability_type: def.liability_type, amount: total },
            userId,
        });
        }

        await q.query(
        `
        UPDATE payroll_runs
        SET liabilities_built_by = COALESCE(liabilities_built_by, ?),
            liabilities_built_at = COALESCE(liabilities_built_at, NOW())
        WHERE id = ?
        `,
        [userId, runId]
        );

        await q.query(
        `INSERT INTO payroll_run_audit (run_id, action, payload_json, acted_by) VALUES (?, 'LIABILITIES_BUILT', ?, ?)`,
        [runId, JSON.stringify({ count: insertedLiabilityIds.length, note: body.note || null }), userId]
        );

        if (conn) await conn.commit();

        return {
        run: await getRun(db, runId),
        items: await listRunLiabilities(db, runId),
        summary: await summarizeRunLiabilities(db, runId),
        already_built: false,
        };
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    async function summarizeRunLiabilities(db, runId) {
    const [rows] = await db.query(
        `
        SELECT
        COUNT(*) AS liability_count,
        COALESCE(SUM(amount),0) AS total_amount,
        COALESCE(SUM(CASE WHEN liability_group='EMPLOYEE_NET' THEN amount ELSE 0 END),0) AS total_employee_net,
        COALESCE(SUM(CASE WHEN liability_group='STATUTORY' THEN amount ELSE 0 END),0) AS total_statutory,
        COALESCE(SUM(CASE WHEN status='OPEN' THEN amount ELSE 0 END),0) AS total_open,
        COALESCE(SUM(CASE WHEN status='IN_BATCH' THEN amount ELSE 0 END),0) AS total_in_batch,
        COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END),0) AS total_paid
        FROM payroll_run_liabilities
        WHERE run_id = ?
        `,
        [runId]
    );
    const r = rows[0] || {};
    Object.keys(r).forEach((k) => {
        if (k.endsWith("_amount") || k.startsWith("total_")) r[k] = amount2(r[k]);
    });
    return r;
    }

    function scopePredicate(scope) {
    if (scope === "NET_PAY") return `liability_group='EMPLOYEE_NET'`;
    if (scope === "STATUTORY") return `liability_group='STATUTORY'`;
    return `1=1`;
    }

    async function buildPaymentBatchPreview(db, runId, scope = "NET_PAY") {
    const run = await getRun(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    const [rows] = await db.query(
        `
        SELECT *
        FROM payroll_run_liabilities
        WHERE run_id = ?
        AND status = 'OPEN'
        AND ${scopePredicate(scope)}
        ORDER BY id ASC
        `,
        [runId]
    );

    const lines = rows.map((l) => ({
        payroll_liability_id: l.id,
        beneficiary_type: l.beneficiary_type,
        beneficiary_id: l.beneficiary_id,
        beneficiary_name: l.beneficiary_name,
        beneficiary_bank_ref: l.beneficiary_bank_ref,
        payable_entity_type: "PAYROLL_LIABILITY",
        payable_entity_id: l.id,
        payable_gl_account_id: l.payable_gl_account_id,
        payable_ref: l.payable_ref || l.liability_key,
        amount: amount2(l.amount),
    }));

    const total_amount = amount2(lines.reduce((s, l) => s + Number(l.amount), 0));

    return {
        run: {
        id: run.id,
        run_no: run.run_no,
        status: run.status,
        currency_code: run.currency_code,
        entity_code: run.entity_code,
        pay_date: run.pay_date,
        },
        scope,
        eligible_liability_count: rows.length,
        total_amount,
        can_prepare_payment_batch: rows.length > 0,
        batch_payload_template: {
        source_type: "PAYROLL",
        source_id: run.id,
        currency_code: run.currency_code,
        lines,
        },
    };
    }

    async function createPayrollPaymentBatch(db, runId, body, userId = null) {
    const run = await getRun(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }
    if (run.status !== "FINALIZED") {
        const err = new Error("Payroll run must be FINALIZED");
        err.statusCode = 400;
        throw err;
    }

    // Idempotent retry shortcut
    if (body.idempotency_key) {
        const [existing] = await db.query(
        `
        SELECT id
        FROM payment_batches
        WHERE source_type='PAYROLL' AND source_id=? AND idempotency_key=?
        LIMIT 1
        `,
        [runId, body.idempotency_key]
        );
        if (existing[0]) {
        const batch = await paymentsService.getBatchById(db, existing[0].id);
        return { batch, idempotent: true };
        }
    }

    const preview = await buildPaymentBatchPreview(db, runId, body.scope);
    if (!preview.can_prepare_payment_batch) {
        const err = new Error("No OPEN payroll liabilities eligible for payment batch");
        err.statusCode = 400;
        throw err;
    }

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const batch = await paymentsService.createBatch(
        q,
        {
            source_type: "PAYROLL",
            source_id: runId,
            bank_account_id: body.bank_account_id,
            currency_code: run.currency_code,
            idempotency_key: body.idempotency_key || null,
            notes: body.notes || `Payroll ${body.scope} payment batch for ${run.run_no}`,
            lines: preview.batch_payload_template.lines,
        },
        userId
        );

        const batchLines = Array.isArray(batch.lines) ? batch.lines : [];

        for (const l of preview.batch_payload_template.lines) {
        const liabilityId = Number(l.payable_entity_id);
        const batchLine = batchLines.find((b) => Number(b.payable_entity_id) === liabilityId);

        if (!batchLine) {
            const err = new Error(`Batch line not found for payroll liability ${liabilityId}`);
            err.statusCode = 500;
            throw err;
        }

        await q.query(
            `
            INSERT INTO payroll_liability_payment_links
            (payroll_liability_id, payment_batch_id, payment_batch_line_id, allocated_amount, status)
            VALUES (?, ?, ?, ?, 'LINKED')
            ON DUPLICATE KEY UPDATE
            payment_batch_line_id = VALUES(payment_batch_line_id),
            allocated_amount = VALUES(allocated_amount),
            status = 'LINKED'
            `,
            [liabilityId, batch.id, batchLine.id, amount2(l.amount)]
        );

        await q.query(
            `
            UPDATE payroll_run_liabilities
            SET status='IN_BATCH', reserved_payment_batch_id=?, updated_at=NOW()
            WHERE id=? AND status='OPEN'
            `,
            [batch.id, liabilityId]
        );

        await writeLiabilityAudit(q, {
            runId,
            liabilityId,
            action: "LINKED_BATCH",
            payload: { payment_batch_id: batch.id, payment_batch_line_id: batchLine.id, amount: l.amount },
            userId,
        });
        }

        await q.query(
        `INSERT INTO payroll_run_audit (run_id, action, payload_json, acted_by) VALUES (?, 'PAYMENT_BATCH_PREPARED', ?, ?)`,
        [runId, JSON.stringify({ payment_batch_id: batch.id, scope: body.scope, count: preview.eligible_liability_count }), userId]
        );

        if (conn) await conn.commit();

        return {
        batch: await paymentsService.getBatchById(db, batch.id),
        preview,
        idempotent: false,
        };
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    async function listLiabilityAuditForRun(db, runId) {
    const [rows] = await db.query(
        `
        SELECT id, payroll_liability_id, action, payload_json, acted_by, acted_at
        FROM payroll_liability_audit
        WHERE run_id = ?
        ORDER BY id DESC
        `,
        [runId]
    );
    return rows;
    }

    module.exports = {
    buildRunLiabilities,
    listRunLiabilities,
    listPayrollLiabilities,
    summarizeRunLiabilities,
    buildPaymentBatchPreview,
    createPayrollPaymentBatch,
    listLiabilityAuditForRun,
    };
    ```

    ---

    ## 4) Routes — `backend/src/routes/payroll.liabilities.js`

    ```js
    // backend/src/routes/payroll.liabilities.js

    const express = require("express");
    const {
    validateRunIdParam,
    validateBuildLiabilitiesBody,
    validateListPayrollLiabilitiesQuery,
    validatePaymentBatchPreviewQuery,
    validateCreatePaymentBatchBody,
    } = require("./payroll.liabilities.validators");
    const service = require("../services/payroll.liabilities.service");

    // replace with your actual helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/payroll/liabilities
    router.get(
    "/liabilities",
    requireAuth,
    requirePermission("payroll.liabilities.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const q = validateListPayrollLiabilitiesQuery(req.query);
        const items = await service.listPayrollLiabilities(db, q);
        res.json({ items });
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/runs/:id/liabilities/build
    router.post(
    "/runs/:id/liabilities/build",
    requireAuth,
    requirePermission("payroll.liabilities.build"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const body = validateBuildLiabilitiesBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.buildRunLiabilities(db, id, body, userId);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payroll/runs/:id/liabilities
    router.get(
    "/runs/:id/liabilities",
    requireAuth,
    requirePermission("payroll.liabilities.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const [items, summary, audit] = await Promise.all([
            service.listRunLiabilities(db, id),
            service.summarizeRunLiabilities(db, id),
            service.listLiabilityAuditForRun(db, id),
        ]);
        res.json({ items, summary, audit });
        } catch (err) {
        next(err);
        }
    }
    );

    // GET /api/v1/payroll/runs/:id/payment-batch-preview?scope=NET_PAY
    router.get(
    "/runs/:id/payment-batch-preview",
    requireAuth,
    requirePermission("payroll.liabilities.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const q = validatePaymentBatchPreviewQuery(req.query);
        const result = await service.buildPaymentBatchPreview(db, id, q.scope);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/runs/:id/payment-batches
    router.post(
    "/runs/:id/payment-batches",
    requireAuth,
    requirePermission("payroll.payment.prepare"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const body = validateCreatePaymentBatchBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.createPayrollPaymentBatch(db, id, body, userId);
        res.status(201).json(result);
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
    const payrollLiabilitiesRoutes = require("./routes/payroll.liabilities");

    // ...
    app.use("/api/v1/payroll", payrollLiabilitiesRoutes);
    ```

    ---

    ## 6) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m027_payroll_liabilities_payment_prep = require("./m027_payroll_liabilities_payment_prep");

    module.exports = [
    // ...
    m027_payroll_liabilities_payment_prep,
    ];
    ```

    ---

    ## 7) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const PAYROLL_P03_PERMISSIONS = [
    "payroll.liabilities.read",
    "payroll.liabilities.build",
    "payroll.payment.prepare",
    ];

    // merge into permission seed list
    ```

    ---

    ## 8) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `GET /api/v1/payroll/liabilities`
    * `POST /api/v1/payroll/runs/{id}/liabilities/build`
    * `GET /api/v1/payroll/runs/{id}/liabilities`
    * `GET /api/v1/payroll/runs/{id}/payment-batch-preview`
    * `POST /api/v1/payroll/runs/{id}/payment-batches`

    ---

    ## 9) Backend smoke test — `backend/scripts/test-payroll-prp03-liabilities-payment-prep.js`

    ```js
    // backend/scripts/test-payroll-prp03-liabilities-payment-prep.js

    async function main() {
    // Preconditions:
    // - PR-B04 implemented (generic payment batch engine)
    // - PR-P01/P02 implemented (import + accrual finalize)
    // - A bank account exists for payment batch creation
    //
    // Flow:
    // 1) Import + finalize a payroll run (or use a fresh FINALIZED run)
    // 2) POST /api/v1/payroll/runs/:id/liabilities/build
    //    -> creates employee net liabilities + statutory liabilities
    // 3) POST build again
    //    -> idempotent (already_built=true, no duplicate liabilities)
    // 4) GET /api/v1/payroll/runs/:id/liabilities
    //    -> summary totals present, audit present
    // 5) GET /api/v1/payroll/runs/:id/payment-batch-preview?scope=NET_PAY
    //    -> returns B04-compatible lines for employee net liabilities
    // 6) POST /api/v1/payroll/runs/:id/payment-batches (scope=NET_PAY)
    //    -> creates payment_batches row (source_type=PAYROLL, source_id=runId)
    //    -> liability links created
    //    -> liabilities move OPEN -> IN_BATCH
    // 7) POST same with same idempotency_key
    //    -> idempotent, same batch id
    // 8) GET /api/v1/payroll/liabilities?run_id=:id&status=IN_BATCH
    //    -> linked liabilities visible
    // 9) Permissions:
    //    - payroll.liabilities.read/build, payroll.payment.prepare enforced (403)
    console.log("PR-P03 smoke test placeholder");
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
        "test:payroll:prp03": "node backend/scripts/test-payroll-prp03-liabilities-payment-prep.js"
    }
    }
    ```

    ---

    # Frontend skeletons

    ## 11) API client — `frontend/src/api/payrollLiabilities.js`

    ```js
    // frontend/src/api/payrollLiabilities.js

    import { apiFetch } from "./client"; // adapt

    export function listPayrollLiabilities(params = {}) {
    const q = new URLSearchParams();
    if (params.run_id) q.set("run_id", String(params.run_id));
    if (params.status) q.set("status", params.status);
    if (params.liability_type) q.set("liability_type", params.liability_type);
    if (params.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiFetch(`/api/v1/payroll/liabilities${qs ? `?${qs}` : ""}`);
    }

    export function buildPayrollRunLiabilities(runId, payload = {}) {
    return apiFetch(`/api/v1/payroll/runs/${runId}/liabilities/build`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }

    export function getPayrollRunLiabilities(runId) {
    return apiFetch(`/api/v1/payroll/runs/${runId}/liabilities`);
    }

    export function getPayrollRunPaymentBatchPreview(runId, scope = "NET_PAY") {
    return apiFetch(`/api/v1/payroll/runs/${runId}/payment-batch-preview?scope=${encodeURIComponent(scope)}`);
    }

    export function createPayrollRunPaymentBatch(runId, payload) {
    return apiFetch(`/api/v1/payroll/runs/${runId}/payment-batches`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }
    ```

    ---

    ## 12) Page — `frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx`

    > Same page can serve both:
    >
    > * `/payroll/liabilities` (global list)
    > * `/payroll/runs/:id/liabilities` (run-specific actions)

    ```jsx
    // frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx

    import { useEffect, useMemo, useState } from "react";
    import { Link, useParams } from "react-router-dom";
    import {
    listPayrollLiabilities,
    buildPayrollRunLiabilities,
    getPayrollRunLiabilities,
    getPayrollRunPaymentBatchPreview,
    createPayrollRunPaymentBatch,
    } from "../../api/payrollLiabilities";

    export default function PayrollLiabilitiesPage() {
    const { id: runIdParam } = useParams();
    const runId = runIdParam ? Number(runIdParam) : null;

    const [items, setItems] = useState([]);
    const [summary, setSummary] = useState(null);
    const [audit, setAudit] = useState([]);
    const [preview, setPreview] = useState(null);
    const [err, setErr] = useState("");
    const [scope, setScope] = useState("NET_PAY");

    const [batchForm, setBatchForm] = useState({
        bank_account_id: "",
        idempotency_key: "",
        notes: "",
    });

    async function loadGlobal() {
        const res = await listPayrollLiabilities({});
        setItems(res.items || []);
        setSummary(null);
        setAudit([]);
        setPreview(null);
    }

    async function loadRun() {
        const [liab, prev] = await Promise.all([
        getPayrollRunLiabilities(runId),
        getPayrollRunPaymentBatchPreview(runId, scope).catch(() => null),
        ]);
        setItems(liab.items || []);
        setSummary(liab.summary || null);
        setAudit(liab.audit || []);
        setPreview(prev);
    }

    async function load() {
        setErr("");
        try {
        if (runId) await loadRun();
        else await loadGlobal();
        } catch (e) {
        setErr(e.message || "Failed to load payroll liabilities");
        }
    }

    useEffect(() => {
        load();
    }, [runId, scope]);

    const totalAmount = useMemo(
        () => (items || []).reduce((s, i) => s + Number(i.amount || 0), 0).toFixed(2),
        [items]
    );

    async function onBuild() {
        try {
        setErr("");
        await buildPayrollRunLiabilities(runId, {});
        await load();
        } catch (e) {
        setErr(e.message || "Build failed");
        }
    }

    async function onPrepareBatch() {
        try {
        setErr("");
        const payload = {
            scope,
            bank_account_id: Number(batchForm.bank_account_id),
            idempotency_key: batchForm.idempotency_key || undefined,
            notes: batchForm.notes || undefined,
        };
        const res = await createPayrollRunPaymentBatch(runId, payload);
        const batchId = res?.batch?.id;
        if (batchId) {
            setBatchForm((s) => ({
            ...s,
            idempotency_key: s.idempotency_key || `payroll-${runId}-${scope.toLowerCase()}`,
            }));
        }
        await load();
        } catch (e) {
        setErr(e.message || "Prepare payment batch failed");
        }
    }

    return (
        <div className="p-4 space-y-4">
        <div className="rounded border bg-white p-4">
            <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">
                {runId ? `Payroll Liabilities (Run #${runId})` : "Payroll Liabilities"}
            </h1>
            {runId ? (
                <Link className="ml-auto underline" to={`/payroll/runs/${runId}`}>
                Back to Payroll Run
                </Link>
            ) : null}
            </div>

            {err ? <div className="text-sm text-red-600 mt-2">{err}</div> : null}

            <div className="mt-3 text-sm">
            <b>Total:</b> {totalAmount}
            {summary ? (
                <>
                {" · "} <b>Open:</b> {summary.total_open}
                {" · "} <b>In Batch:</b> {summary.total_in_batch}
                {" · "} <b>Paid:</b> {summary.total_paid}
                </>
            ) : null}
            </div>

            {runId ? (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <button className="border rounded px-2 py-1" type="button" onClick={onBuild}>
                Build Liabilities
                </button>

                <select
                className="border rounded px-2 py-1"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                >
                <option value="NET_PAY">NET_PAY</option>
                <option value="STATUTORY">STATUTORY</option>
                <option value="ALL">ALL</option>
                </select>

                <input
                className="border rounded px-2 py-1"
                placeholder="Bank Account ID"
                value={batchForm.bank_account_id}
                onChange={(e) => setBatchForm((s) => ({ ...s, bank_account_id: e.target.value }))}
                />

                <input
                className="border rounded px-2 py-1 md:col-span-2"
                placeholder="Idempotency Key (optional)"
                value={batchForm.idempotency_key}
                onChange={(e) => setBatchForm((s) => ({ ...s, idempotency_key: e.target.value }))}
                />

                <input
                className="border rounded px-2 py-1"
                placeholder="Notes (optional)"
                value={batchForm.notes}
                onChange={(e) => setBatchForm((s) => ({ ...s, notes: e.target.value }))}
                />

                <button
                className="border rounded px-2 py-1"
                type="button"
                onClick={onPrepareBatch}
                disabled={!preview?.can_prepare_payment_batch}
                >
                Prepare Payment Batch
                </button>
            </div>
            ) : null}
        </div>

        {runId && preview ? (
            <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Payment Batch Preview ({scope})</h2>
            <div className="text-sm mb-2">
                Eligible liabilities: {preview.eligible_liability_count} · Total: {preview.total_amount}
            </div>
            <div className="overflow-auto">
                <table className="min-w-full text-sm border-collapse">
                <thead>
                    <tr className="border-b">
                    <th className="text-left p-2">Liability ID</th>
                    <th className="text-left p-2">Beneficiary</th>
                    <th className="text-left p-2">GL</th>
                    <th className="text-left p-2">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {(preview.batch_payload_template?.lines || []).map((l) => (
                    <tr key={l.payable_entity_id} className="border-b">
                        <td className="p-2">{l.payable_entity_id}</td>
                        <td className="p-2">{l.beneficiary_name}</td>
                        <td className="p-2">{l.payable_gl_account_id}</td>
                        <td className="p-2">{l.amount}</td>
                    </tr>
                    ))}
                    {(preview.batch_payload_template?.lines || []).length === 0 ? (
                    <tr><td className="p-2" colSpan={4}>No eligible liabilities.</td></tr>
                    ) : null}
                </tbody>
                </table>
            </div>
            </div>
        ) : null}

        <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Liabilities</h2>
            <div className="overflow-auto">
            <table className="min-w-full text-sm border-collapse">
                <thead>
                <tr className="border-b">
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Run</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Employee</th>
                    <th className="text-left p-2">Beneficiary</th>
                    <th className="text-left p-2">Amount</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Batch</th>
                </tr>
                </thead>
                <tbody>
                {items.map((l) => (
                    <tr key={l.id} className="border-b">
                    <td className="p-2">{l.id}</td>
                    <td className="p-2">{l.run_id}</td>
                    <td className="p-2">{l.liability_type}</td>
                    <td className="p-2">{l.employee_code ? `${l.employee_code} - ${l.employee_name}` : "-"}</td>
                    <td className="p-2">{l.beneficiary_name}</td>
                    <td className="p-2">{l.amount}</td>
                    <td className="p-2">{l.status}</td>
                    <td className="p-2">
                        {l.reserved_payment_batch_id ? (
                        <Link className="underline" to={`/payments/batches/${l.reserved_payment_batch_id}`}>
                            {l.reserved_payment_batch_id}
                        </Link>
                        ) : "-"}
                    </td>
                    </tr>
                ))}
                {items.length === 0 && (
                    <tr><td className="p-2" colSpan={8}>No payroll liabilities found.</td></tr>
                )}
                </tbody>
            </table>
            </div>
        </div>

        {runId ? (
            <div className="rounded border bg-white p-4">
            <h2 className="font-medium mb-2">Liability Audit</h2>
            <div className="space-y-1 text-sm">
                {audit.map((a) => (
                <div key={a.id} className="border rounded p-2">
                    <b>{a.action}</b> — {a.acted_at}
                </div>
                ))}
                {audit.length === 0 ? <div>No audit rows.</div> : null}
            </div>
            </div>
        ) : null}
        </div>
    );
    }
    ```

    ---

    ## 13) Update payroll run detail page — `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`

    Add a link button in the header/actions area:

    ```jsx
    // frontend/src/pages/payroll/PayrollRunDetailPage.jsx
    import { Link } from "react-router-dom";

    // inside JSX (header card is fine)
    <Link className="border rounded px-2 py-1 inline-block" to={`/payroll/runs/${run.id}/liabilities`}>
    Liabilities & Payment Prep
    </Link>
    ```

    ---

    ## 14) App routes — `frontend/src/App.jsx`

    ```jsx
    // frontend/src/App.jsx
    import PayrollLiabilitiesPage from "./pages/payroll/PayrollLiabilitiesPage";

    // ...
    <Route
    path="/payroll/liabilities"
    element={
        <RequirePermission permission="payroll.liabilities.read">
        <PayrollLiabilitiesPage />
        </RequirePermission>
    }
    />

    <Route
    path="/payroll/runs/:id/liabilities"
    element={
        <RequirePermission permission="payroll.liabilities.read">
        <PayrollLiabilitiesPage />
        </RequirePermission>
    }
    />
    ```

    ---

    ## 15) Sidebar — `frontend/src/layouts/sidebarConfig.js`

    Add under Payroll:

    ```js
    {
    key: "payroll-liabilities",
    label: "Payroll Liabilities",
    to: "/payroll/liabilities",
    permission: "payroll.liabilities.read",
    }
    ```

    ---

    ## 16) i18n — `frontend/src/i18n/messages.js`

    ```js
    // frontend/src/i18n/messages.js
    export default {
    // ...
    "sidebar.payrollLiabilities": "Payroll Liabilities",
    };
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ FINALIZED payroll run can generate payroll liabilities (employee net + statutory)
    * ✅ Liability build is idempotent (no duplicate rows on re-run)
    * ✅ Payroll liabilities store employee-level traceability for net pay
    * ✅ Liability rows carry payable GL account (resolved from effective-dated mappings)
    * ✅ Payment batch preview returns B04-compatible payload
    * ✅ Can create generic payment batch from payroll liabilities (`source_type="PAYROLL"`)
    * ✅ Liability ↔ payment batch links are stored
    * ✅ Liabilities move `OPEN -> IN_BATCH` when batch is prepared
    * ✅ Audit rows exist for liability build and batch linking
    * ✅ Permissions enforced (`payroll.liabilities.*`, `payroll.payment.prepare`)
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:payroll:prp03`

    Should verify at least:

    1. **Build liabilities**

    * POST `/api/v1/payroll/runs/:id/liabilities/build`
    * creates:

        * employee net liabilities (one per payroll employee with net pay > 0)
        * statutory liabilities (aggregated by component)
    * totals reconcile to payroll run payable totals

    2. **Idempotent build**

    * Re-run build → no duplicates, returns `already_built=true`

    3. **Run liabilities read**

    * GET `/api/v1/payroll/runs/:id/liabilities`
    * returns `items + summary + audit`

    4. **Payment batch preview**

    * GET `/api/v1/payroll/runs/:id/payment-batch-preview?scope=NET_PAY`
    * returns B04-compatible `batch_payload_template`
    * includes employee beneficiaries and payable GL accounts

    5. **Create payroll payment batch**

    * POST `/api/v1/payroll/runs/:id/payment-batches`
    * creates `payment_batches` row with:

        * `source_type="PAYROLL"`
        * `source_id=<runId>`
    * creates `payroll_liability_payment_links`
    * liabilities move to `IN_BATCH`

    6. **Idempotent prepare**

    * Same request with same `idempotency_key` returns same batch (no duplicates)

    7. **Global list**

    * GET `/api/v1/payroll/liabilities?run_id=:id&status=IN_BATCH`
    * returns linked liabilities

    8. **Permissions**

    * `payroll.liabilities.read`, `payroll.liabilities.build`, `payroll.payment.prepare` enforced (`403`)

    ---

    # Example manual payloads

    ## Build liabilities

    ```json
    {
    "note": "Build payroll liabilities after accrual finalization"
    }
    ```

    ## Payment batch preview

    `GET /api/v1/payroll/runs/12/payment-batch-preview?scope=NET_PAY`

    ## Create payroll payment batch (employee net pay)

    ```json
    {
    "scope": "NET_PAY",
    "bank_account_id": 1,
    "idempotency_key": "payroll-run-12-netpay-v1",
    "notes": "Payroll net salary payment batch"
    }
    ```

    ## Create payroll payment batch (statutory)

    ```json
    {
    "scope": "STATUTORY",
    "bank_account_id": 1,
    "idempotency_key": "payroll-run-12-statutory-v1",
    "notes": "Payroll statutory remittance batch"
    }
    ```

    ---

    # Tiny implementation notes (important)

    * **P03 prepares payment batches** but does **not** mark payroll liabilities as paid yet.
    * Actual payment completion should be driven by:

    * **B04 batch posting**
    * then **bank reconciliation (B03)**
    * then payroll settlement sync (next payroll PR)
    * This keeps the contract clean:

    * Payroll owns liability subledger
    * Payments/Bank own execution + reconciliation
    * Sync layer updates payroll liability status when payment is truly settled

Perfect — here’s **PR-P04** in the same format, and I’ll keep the **frontend part shorter** (only key integration snippets + comments, no full page tables).

# PR-P04: Payroll Payment Settlement Sync (Payment Batches + Bank Reconciliation Feedback)

    ## Goal

    Close the loop after **PR-P03** by syncing payroll liabilities from:

    * **PR-B04 Payment Batch execution status**
    * **PR-B03 Bank reconciliation evidence**

    This PR gives you:

    * ✅ Sync preview: what will move `IN_BATCH -> PAID` (or be released back to `OPEN`)
    * ✅ Sync apply (idempotent): updates payroll liabilities safely
    * ✅ Payroll settlement records (audit-grade evidence trail)
    * ✅ Link-level settlement/release state
    * ✅ Payroll run audit entries for sync activity
    * ❌ No payroll reversals/off-cycle correction engine yet (later PR)

    ---

    ## Integration contract assumptions (important)

    This PR assumes your B04/B03 stack exposes **some** evidence that a payment batch line is truly settled/reconciled.

    ### Expected (adapt names to your actual schema)

    On `payment_batch_lines` (or equivalent), payroll sync should be able to read **at least one** of these patterns:

    * `status` (e.g. `PAID`, `SETTLED`, `CANCELLED`, `FAILED`)
    * `reconciliation_status` (e.g. `RECONCILED`)
    * `bank_statement_line_id` (nullable FK when matched by bank reconciliation)
    * `executed_at`, `reconciled_at`

    If your actual B03/B04 schema uses different names, **only the evidence query needs adaptation**; payroll sync behavior stays the same.

    ---

    ## Files to create

    ### Backend

    * `backend/src/migrations/m028_payroll_payment_settlement_sync.js`
    * `backend/src/routes/payroll.paymentSync.js`
    * `backend/src/routes/payroll.paymentSync.validators.js`
    * `backend/src/services/payroll.paymentSync.service.js`
    * `backend/scripts/test-payroll-prp04-payment-settlement-sync.js`

    ### Frontend (shorter snippets only)

    * `frontend/src/api/payrollPaymentSync.js`

    ---

    ## Files to update

    ### Backend

    * `backend/src/migrations/index.js`
    * `backend/src/index.js`
    * `backend/src/seedCore.js`
    * `backend/scripts/generate-openapi.js`
    * `backend/package.json`

    ### Frontend

    * `frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx` (add preview/apply sync actions)
    * `frontend/src/pages/payroll/PayrollRunDetailPage.jsx` (optional quick sync link/button)
    * `frontend/src/App.jsx` (if you want a dedicated sync route later; not required now)
    * `frontend/src/i18n/messages.js` (optional labels)

    ---

    # Concrete skeletons

    ## 1) Migration — `backend/src/migrations/m028_payroll_payment_settlement_sync.js`

    ```js
    // backend/src/migrations/m028_payroll_payment_settlement_sync.js

    module.exports = {
    id: "m028_payroll_payment_settlement_sync",

    async up(db) {
        // Settlement evidence table (audit-grade, idempotent)
        await db.query(`
        CREATE TABLE IF NOT EXISTS payroll_liability_settlements (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            settlement_key VARCHAR(190) NOT NULL, -- deterministic for idempotent sync apply

            run_id BIGINT UNSIGNED NOT NULL,
            payroll_liability_id BIGINT UNSIGNED NOT NULL,
            payroll_liability_payment_link_id BIGINT UNSIGNED NOT NULL,

            payment_batch_id BIGINT UNSIGNED NOT NULL,
            payment_batch_line_id BIGINT UNSIGNED NULL,

            bank_statement_line_id BIGINT UNSIGNED NULL, -- nullable if your B03 stores evidence elsewhere
            settlement_source VARCHAR(30) NOT NULL,      -- B04_ONLY, B03_RECON, MANUAL_OVERRIDE (future)
            settled_amount DECIMAL(18,2) NOT NULL,
            currency_code CHAR(3) NOT NULL,
            settled_at DATETIME NOT NULL,

            payload_json JSON NULL,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY (id),
            UNIQUE KEY uq_payroll_liability_settlements_key (settlement_key),
            KEY idx_pls_run (run_id),
            KEY idx_pls_liability (payroll_liability_id),
            KEY idx_pls_batch (payment_batch_id),
            KEY idx_pls_batch_line (payment_batch_line_id),

            CONSTRAINT fk_pls_run
            FOREIGN KEY (run_id) REFERENCES payroll_runs(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_pls_liability
            FOREIGN KEY (payroll_liability_id) REFERENCES payroll_run_liabilities(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_pls_link
            FOREIGN KEY (payroll_liability_payment_link_id) REFERENCES payroll_liability_payment_links(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,

            CONSTRAINT fk_pls_batch
            FOREIGN KEY (payment_batch_id) REFERENCES payment_batches(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // Extend links with sync status
        await db.query(`
        ALTER TABLE payroll_liability_payment_links
            ADD COLUMN settled_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER allocated_amount,
            ADD COLUMN settled_at DATETIME NULL AFTER settled_amount,
            ADD COLUMN released_at DATETIME NULL AFTER settled_at,
            ADD COLUMN last_sync_at DATETIME NULL AFTER released_at,
            ADD COLUMN sync_note VARCHAR(255) NULL AFTER last_sync_at
        `).catch(() => {});

        await db.query(`
        ALTER TABLE payroll_liability_payment_links
            ADD KEY idx_plinks_settled_at (settled_at),
            ADD KEY idx_plinks_last_sync_at (last_sync_at)
        `).catch(() => {});

        // Optional convenience columns on liabilities
        await db.query(`
        ALTER TABLE payroll_run_liabilities
            ADD COLUMN paid_payment_batch_id BIGINT UNSIGNED NULL AFTER paid_at,
            ADD COLUMN paid_payment_batch_line_id BIGINT UNSIGNED NULL AFTER paid_payment_batch_id,
            ADD COLUMN paid_bank_statement_line_id BIGINT UNSIGNED NULL AFTER paid_payment_batch_line_id
        `).catch(() => {});

        // Payroll run sync timestamps
        await db.query(`
        ALTER TABLE payroll_runs
            ADD COLUMN payment_sync_last_preview_at DATETIME NULL AFTER liabilities_built_at,
            ADD COLUMN payment_sync_last_applied_at DATETIME NULL AFTER payment_sync_last_preview_at
        `).catch(() => {});
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS payroll_liability_settlements;`);
        // (Optional strict down for ALTER columns omitted for dev simplicity)
    },
    };
    ```

    ---

    ## 2) Validators — `backend/src/routes/payroll.paymentSync.validators.js`

    ```js
    // backend/src/routes/payroll.paymentSync.validators.js

    function requirePositiveInt(v, field) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be positive integer`);
    return n;
    }

    function normalizeString(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
    }

    function validateRunIdParam(params = {}) {
    return { id: requirePositiveInt(params.id, "id") };
    }

    function validateSyncPreviewQuery(query = {}) {
    const scope = String(query.scope || "ALL").trim().toUpperCase();
    if (!["ALL", "NET_PAY", "STATUTORY"].includes(scope)) {
        throw new Error("scope must be ALL, NET_PAY, or STATUTORY");
    }
    return { scope };
    }

    function validateSyncApplyBody(body = {}) {
    const scope = String(body.scope || "ALL").trim().toUpperCase();
    if (!["ALL", "NET_PAY", "STATUTORY"].includes(scope)) {
        throw new Error("scope must be ALL, NET_PAY, or STATUTORY");
    }

    return {
        scope,
        note: normalizeString(body.note),
        allow_b04_only_settlement: String(body.allow_b04_only_settlement || "false").toLowerCase() === "true",
    };
    }

    module.exports = {
    validateRunIdParam,
    validateSyncPreviewQuery,
    validateSyncApplyBody,
    };
    ```

    ---

    ## 3) Service — `backend/src/services/payroll.paymentSync.service.js`

    ```js
    // backend/src/services/payroll.paymentSync.service.js

    function amount2(n) {
    return Number(Number(n || 0).toFixed(2));
    }

    async function getRun(db, runId) {
    const [rows] = await db.query(`SELECT * FROM payroll_runs WHERE id=? LIMIT 1`, [runId]);
    return rows[0] || null;
    }

    function scopeSql(scope) {
    if (scope === "NET_PAY") return `AND l.liability_group = 'EMPLOYEE_NET'`;
    if (scope === "STATUTORY") return `AND l.liability_group = 'STATUTORY'`;
    return ``;
    }

    /**
     * IMPORTANT:
     * Adapt this query's payment/reconciliation evidence columns to your actual PR-B03/B04 schema.
     * Current skeleton assumes payment_batch_lines has:
     *   - status
     *   - reconciliation_status
     *   - bank_statement_line_id
     *   - executed_at / reconciled_at
     */
    async function listSyncCandidates(db, runId, scope = "ALL") {
    const [rows] = await db.query(
        `
        SELECT
        l.id AS payroll_liability_id,
        l.run_id,
        l.liability_type,
        l.liability_group,
        l.beneficiary_name,
        l.amount,
        l.currency_code,
        l.status AS liability_status,
        l.reserved_payment_batch_id,

        pl.id AS link_id,
        pl.payment_batch_id,
        pl.payment_batch_line_id,
        pl.allocated_amount,
        pl.settled_amount AS link_settled_amount,
        pl.status AS link_status,

        pb.status AS payment_batch_status,

        pbl.status AS payment_batch_line_status,
        pbl.reconciliation_status AS payment_batch_line_reconciliation_status,
        pbl.bank_statement_line_id,
        pbl.executed_at,
        pbl.reconciled_at

        FROM payroll_run_liabilities l
        JOIN payroll_liability_payment_links pl
        ON pl.payroll_liability_id = l.id
        JOIN payment_batches pb
        ON pb.id = pl.payment_batch_id
        LEFT JOIN payment_batch_lines pbl
        ON pbl.id = pl.payment_batch_line_id
        WHERE l.run_id = ?
        AND l.status IN ('IN_BATCH', 'PAID')
        ${scopeSql(scope)}
        ORDER BY l.id ASC
        `,
        [runId]
    );

    return rows;
    }

    function classifyCandidate(row, { allow_b04_only_settlement = false } = {}) {
    const amount = amount2(row.allocated_amount || row.amount);

    const batchCancelled = ["CANCELLED", "FAILED", "REJECTED"].includes(String(row.payment_batch_status || "").toUpperCase());
    const lineCancelled = ["CANCELLED", "FAILED", "REJECTED"].includes(String(row.payment_batch_line_status || "").toUpperCase());

    const linePaid = ["PAID", "SETTLED", "EXECUTED"].includes(String(row.payment_batch_line_status || "").toUpperCase());
    const reconciled = String(row.payment_batch_line_reconciliation_status || "").toUpperCase() === "RECONCILED";
    const hasBankEvidence = !!row.bank_statement_line_id;

    const hasSettlementEvidence = hasBankEvidence || reconciled || (allow_b04_only_settlement && linePaid);

    if (row.liability_status === "IN_BATCH" && hasSettlementEvidence) {
        return {
        action: "MARK_PAID",
        amount,
        settled_at: row.reconciled_at || row.executed_at || new Date().toISOString().slice(0, 19).replace("T", " "),
        settlement_source: hasBankEvidence || reconciled ? "B03_RECON" : "B04_ONLY",
        bank_statement_line_id: row.bank_statement_line_id || null,
        reason: hasBankEvidence ? "bank_matched" : (reconciled ? "reconciled_flag" : "b04_paid_status"),
        };
    }

    if (row.liability_status === "IN_BATCH" && (batchCancelled || lineCancelled)) {
        return {
        action: "RELEASE_TO_OPEN",
        amount,
        reason: batchCancelled ? "payment_batch_cancelled" : "payment_batch_line_cancelled",
        };
    }

    return {
        action: "NOOP",
        amount,
        reason: "no_new_evidence",
    };
    }

    function buildSettlementKey(row, verdict) {
    return [
        "PRPAYSETTLE",
        `RUN:${row.run_id}`,
        `L:${row.payroll_liability_id}`,
        `LINK:${row.link_id}`,
        `B:${row.payment_batch_id}`,
        `BL:${row.payment_batch_line_id || 0}`,
        `SRC:${verdict.settlement_source || "NA"}`,
    ].join("|");
    }

    async function buildRunPaymentSyncPreview(db, runId, opts = {}) {
    const run = await getRun(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    const rows = await listSyncCandidates(db, runId, opts.scope || "ALL");
    const items = rows.map((r) => {
        const verdict = classifyCandidate(r, opts);
        return { ...r, verdict };
    });

    const summary = {
        total_candidates: items.length,
        mark_paid_count: 0,
        mark_paid_amount: 0,
        release_count: 0,
        release_amount: 0,
        noop_count: 0,
        noop_amount: 0,
    };

    for (const i of items) {
        if (i.verdict.action === "MARK_PAID") {
        summary.mark_paid_count += 1;
        summary.mark_paid_amount += Number(i.verdict.amount);
        } else if (i.verdict.action === "RELEASE_TO_OPEN") {
        summary.release_count += 1;
        summary.release_amount += Number(i.verdict.amount);
        } else {
        summary.noop_count += 1;
        summary.noop_amount += Number(i.verdict.amount);
        }
    }

    Object.keys(summary).forEach((k) => {
        if (k.endsWith("_amount")) summary[k] = amount2(summary[k]);
    });

    // optional preview timestamp
    await db.query(
        `UPDATE payroll_runs SET payment_sync_last_preview_at = NOW() WHERE id = ?`,
        [runId]
    ).catch(() => {});

    return {
        run: {
        id: run.id,
        run_no: run.run_no,
        status: run.status,
        pay_date: run.pay_date,
        currency_code: run.currency_code,
        },
        scope: opts.scope || "ALL",
        allow_b04_only_settlement: !!opts.allow_b04_only_settlement,
        summary,
        items,
    };
    }

    async function writeLiabilityAudit(db, { runId, liabilityId = null, action, payload = null, userId = null }) {
    await db.query(
        `INSERT INTO payroll_liability_audit (run_id, payroll_liability_id, action, payload_json, acted_by) VALUES (?, ?, ?, ?, ?)`,
        [runId, liabilityId, action, payload ? JSON.stringify(payload) : null, userId]
    );
    }

    async function applyRunPaymentSync(db, runId, opts = {}, userId = null) {
    const run = await getRun(db, runId);
    if (!run) {
        const err = new Error("Payroll run not found");
        err.statusCode = 404;
        throw err;
    }

    const conn = db.getConnection ? await db.getConnection() : null;
    const q = conn || db;

    try {
        if (conn) await conn.beginTransaction();

        const preview = await buildRunPaymentSyncPreview(q, runId, opts);

        let markPaidApplied = 0;
        let releasedApplied = 0;

        for (const item of preview.items) {
        const v = item.verdict;
        if (v.action === "NOOP") continue;

        if (v.action === "MARK_PAID") {
            const settlementKey = buildSettlementKey(item, v);

            // settlement evidence row (idempotent by unique settlement_key)
            await q.query(
            `
            INSERT INTO payroll_liability_settlements
            (settlement_key, run_id, payroll_liability_id, payroll_liability_payment_link_id,
            payment_batch_id, payment_batch_line_id, bank_statement_line_id,
            settlement_source, settled_amount, currency_code, settled_at, payload_json, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                settled_at = VALUES(settled_at)
            `,
            [
                settlementKey,
                item.run_id,
                item.payroll_liability_id,
                item.link_id,
                item.payment_batch_id,
                item.payment_batch_line_id || null,
                v.bank_statement_line_id || null,
                v.settlement_source,
                amount2(v.amount),
                item.currency_code,
                v.settled_at,
                JSON.stringify({ reason: v.reason }),
                userId,
            ]
            );

            await q.query(
            `
            UPDATE payroll_liability_payment_links
            SET status = 'PAID',
                settled_amount = ?,
                settled_at = ?,
                last_sync_at = NOW(),
                sync_note = ?
            WHERE id = ?
            `,
            [amount2(v.amount), v.settled_at, `synced:${v.reason}`, item.link_id]
            );

            await q.query(
            `
            UPDATE payroll_run_liabilities
            SET status = 'PAID',
                paid_at = ?,
                paid_payment_batch_id = ?,
                paid_payment_batch_line_id = ?,
                paid_bank_statement_line_id = ?,
                updated_at = NOW()
            WHERE id = ?
                AND status IN ('IN_BATCH', 'PAID')
            `,
            [
                v.settled_at,
                item.payment_batch_id,
                item.payment_batch_line_id || null,
                v.bank_statement_line_id || null,
                item.payroll_liability_id,
            ]
            );

            await writeLiabilityAudit(q, {
            runId,
            liabilityId: item.payroll_liability_id,
            action: "SETTLED",
            payload: {
                payment_batch_id: item.payment_batch_id,
                payment_batch_line_id: item.payment_batch_line_id,
                bank_statement_line_id: v.bank_statement_line_id || null,
                amount: amount2(v.amount),
                settlement_source: v.settlement_source,
                reason: v.reason,
            },
            userId,
            });

            markPaidApplied += 1;
            continue;
        }

        if (v.action === "RELEASE_TO_OPEN") {
            await q.query(
            `
            UPDATE payroll_liability_payment_links
            SET status = 'RELEASED',
                released_at = NOW(),
                last_sync_at = NOW(),
                sync_note = ?
            WHERE id = ?
            `,
            [`released:${v.reason}`, item.link_id]
            );

            await q.query(
            `
            UPDATE payroll_run_liabilities
            SET status = 'OPEN',
                reserved_payment_batch_id = NULL,
                updated_at = NOW()
            WHERE id = ?
                AND status = 'IN_BATCH'
            `,
            [item.payroll_liability_id]
            );

            await writeLiabilityAudit(q, {
            runId,
            liabilityId: item.payroll_liability_id,
            action: "RELEASED",
            payload: {
                payment_batch_id: item.payment_batch_id,
                payment_batch_line_id: item.payment_batch_line_id,
                amount: amount2(v.amount),
                reason: v.reason,
            },
            userId,
            });

            releasedApplied += 1;
        }
        }

        await q.query(
        `UPDATE payroll_runs SET payment_sync_last_applied_at = NOW() WHERE id = ?`,
        [runId]
        );

        await q.query(
        `INSERT INTO payroll_run_audit (run_id, action, payload_json, acted_by) VALUES (?, 'PAYMENT_SYNC_APPLIED', ?, ?)`,
        [
            runId,
            JSON.stringify({
            scope: opts.scope || "ALL",
            mark_paid_count: markPaidApplied,
            released_count: releasedApplied,
            note: opts.note || null,
            allow_b04_only_settlement: !!opts.allow_b04_only_settlement,
            }),
            userId,
        ]
        );

        if (conn) await conn.commit();

        return {
        ok: true,
        run_id: runId,
        applied: {
            mark_paid_count: markPaidApplied,
            released_count: releasedApplied,
        },
        preview_summary: preview.summary,
        };
    } catch (err) {
        if (conn) {
        try { await conn.rollback(); } catch (_) {}
        }
        throw err;
    } finally {
        if (conn) conn.release();
    }
    }

    module.exports = {
    buildRunPaymentSyncPreview,
    applyRunPaymentSync,
    };
    ```

    ---

    ## 4) Routes — `backend/src/routes/payroll.paymentSync.js`

    ```js
    // backend/src/routes/payroll.paymentSync.js

    const express = require("express");
    const {
    validateRunIdParam,
    validateSyncPreviewQuery,
    validateSyncApplyBody,
    } = require("./payroll.paymentSync.validators");
    const service = require("../services/payroll.paymentSync.service");

    // replace with your actual helpers
    const { requireAuth, requirePermission } = require("../auth/guards");
    const { getDb } = require("../db");

    const router = express.Router();

    // GET /api/v1/payroll/runs/:id/payment-sync-preview
    router.get(
    "/runs/:id/payment-sync-preview",
    requireAuth,
    requirePermission("payroll.payment.sync.read"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const q = validateSyncPreviewQuery(req.query);
        const result = await service.buildRunPaymentSyncPreview(db, id, q);
        res.json(result);
        } catch (err) {
        next(err);
        }
    }
    );

    // POST /api/v1/payroll/runs/:id/payment-sync-apply
    router.post(
    "/runs/:id/payment-sync-apply",
    requireAuth,
    requirePermission("payroll.payment.sync.apply"),
    async (req, res, next) => {
        try {
        const db = getDb(req);
        const { id } = validateRunIdParam(req.params);
        const body = validateSyncApplyBody(req.body);
        const userId = req.user?.id ?? null;
        const result = await service.applyRunPaymentSync(db, id, body, userId);
        res.json(result);
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
    const payrollPaymentSyncRoutes = require("./routes/payroll.paymentSync");

    // ...
    app.use("/api/v1/payroll", payrollPaymentSyncRoutes);
    ```

    ---

    ## 6) Migration registry — `backend/src/migrations/index.js`

    ```js
    // backend/src/migrations/index.js
    const m028_payroll_payment_settlement_sync = require("./m028_payroll_payment_settlement_sync");

    module.exports = [
    // ...
    m028_payroll_payment_settlement_sync,
    ];
    ```

    ---

    ## 7) Seed permissions — `backend/src/seedCore.js`

    ```js
    // backend/src/seedCore.js
    const PAYROLL_P04_PERMISSIONS = [
    "payroll.payment.sync.read",
    "payroll.payment.sync.apply",
    ];

    // merge into permission seed list
    ```

    ---

    ## 8) OpenAPI generation — `backend/scripts/generate-openapi.js`

    Register these paths:

    * `GET /api/v1/payroll/runs/{id}/payment-sync-preview`
    * `POST /api/v1/payroll/runs/{id}/payment-sync-apply`

    ---

    ## 9) Backend smoke test — `backend/scripts/test-payroll-prp04-payment-settlement-sync.js`

    ```js
    // backend/scripts/test-payroll-prp04-payment-settlement-sync.js

    async function main() {
    // Preconditions:
    // - PR-P03 implemented (liabilities + payment batch prep)
    // - PR-B04 implemented (payment batches/lines)
    // - PR-B03 implemented or B04 line statuses available
    //
    // Flow:
    // 1) Create payroll payment batch from a finalized payroll run (P03)
    // 2) Simulate/perform payment execution on payment_batch_lines
    // 3) Simulate/perform bank reconciliation match (B03) for those lines
    // 4) GET /api/v1/payroll/runs/:id/payment-sync-preview
    //    -> shows MARK_PAID candidates with amounts
    // 5) POST /api/v1/payroll/runs/:id/payment-sync-apply
    //    -> liabilities IN_BATCH -> PAID
    //    -> payroll_liability_settlements rows created
    //    -> links status LINKED -> PAID
    // 6) POST sync apply again
    //    -> idempotent (no duplicate settlements)
    // 7) Simulate batch cancellation for another run/line
    //    -> preview shows RELEASE_TO_OPEN
    //    -> apply returns liability IN_BATCH -> OPEN and link -> RELEASED
    // 8) Permissions:
    //    - payroll.payment.sync.read/apply enforced (403)
    console.log("PR-P04 smoke test placeholder");
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
        "test:payroll:prp04": "node backend/scripts/test-payroll-prp04-payment-settlement-sync.js"
    }
    }
    ```

    ---

    # Frontend (short version — key matching parts only)

    ## 11) API client — `frontend/src/api/payrollPaymentSync.js`

    ```js
    // frontend/src/api/payrollPaymentSync.js

    import { apiFetch } from "./client"; // adapt

    export function getPayrollPaymentSyncPreview(runId, params = {}) {
    const q = new URLSearchParams();
    if (params.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiFetch(`/api/v1/payroll/runs/${runId}/payment-sync-preview${qs ? `?${qs}` : ""}`);
    }

    export function applyPayrollPaymentSync(runId, payload = {}) {
    return apiFetch(`/api/v1/payroll/runs/${runId}/payment-sync-apply`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    }
    ```

    ---

    ## 12) `PayrollLiabilitiesPage.jsx` — important parts only

    ### Add imports

    ```jsx
    import { getPayrollPaymentSyncPreview, applyPayrollPaymentSync } from "../../api/payrollPaymentSync";
    ```

    ### Add state

    ```jsx
    const [syncPreview, setSyncPreview] = useState(null);
    const [syncScope, setSyncScope] = useState("ALL");
    ```

    ### Load preview (when run page is open)

    ```jsx
    async function loadSyncPreview() {
    if (!runId) return;
    const res = await getPayrollPaymentSyncPreview(runId, { scope: syncScope });
    setSyncPreview(res);
    }

    // call inside your existing load() for run-specific page
    // await Promise.all([ ..., loadSyncPreview() ])
    ```

    ### Add apply action

    ```jsx
    async function onApplyPaymentSync() {
    try {
        setErr("");
        await applyPayrollPaymentSync(runId, {
        scope: syncScope,
        // keep false by default; only enable if you intentionally accept B04-only settlement
        allow_b04_only_settlement: false,
        });
        await load(); // reload liabilities + previews
    } catch (e) {
        setErr(e.message || "Payment sync failed");
    }
    }
    ```

    ### Add a compact sync panel (no tables needed)

    ```jsx
    {/* Payroll Payment Sync Panel (compact) */}
    <div className="rounded border bg-white p-4">
    <h2 className="font-medium mb-2">Payment Settlement Sync</h2>

    {/* Scope selector + actions */}
    {/* select value={syncScope} onChange=... options: ALL / NET_PAY / STATUTORY */}
    {/* button: Refresh Sync Preview -> calls loadSyncPreview */}
    {/* button: Apply Sync -> calls onApplyPaymentSync */}

    {syncPreview ? (
        <div className="text-sm space-y-1">
        <div>Mark PAID: {syncPreview.summary?.mark_paid_count} / {syncPreview.summary?.mark_paid_amount}</div>
        <div>Release to OPEN: {syncPreview.summary?.release_count} / {syncPreview.summary?.release_amount}</div>
        <div>No-op: {syncPreview.summary?.noop_count}</div>

        {/* Optional: show a short list of first 10 candidate rows with verdicts */}
        {/* Example fields to display: liability id, beneficiary, amount, verdict.action, verdict.reason */}
        </div>
    ) : (
        <div className="text-sm text-gray-600">No sync preview yet.</div>
    )}
    </div>
    ```

    ---

    ## 13) Optional quick link/button in `PayrollRunDetailPage.jsx`

    ```jsx
    // add near other payroll run actions
    <Link className="border rounded px-2 py-1 inline-block" to={`/payroll/runs/${run.id}/liabilities`}>
    Liabilities / Payment Sync
    </Link>
    ```

    ---

    # Acceptance criteria (repeat in PR)

    * ✅ Payroll payment sync preview classifies liabilities as:

    * `MARK_PAID` (has payment/reconciliation evidence)
    * `RELEASE_TO_OPEN` (batch/line cancelled/failed)
    * `NOOP`
    * ✅ Sync apply is idempotent (no duplicate settlement rows)
    * ✅ `MARK_PAID` updates:

    * `payroll_run_liabilities` → `PAID`
    * `payroll_liability_payment_links` → `PAID`
    * inserts `payroll_liability_settlements`
    * ✅ `RELEASE_TO_OPEN` updates:

    * `payroll_run_liabilities` → `OPEN`
    * `payroll_liability_payment_links` → `RELEASED`
    * ✅ Payroll audit rows written for sync actions
    * ✅ Permissions enforced (`payroll.payment.sync.read/apply`)
    * ✅ OpenAPI updated
    * ✅ Smoke test script exists and runs

    ---

    # Smoke test expectations (explicit)

    ## `npm run test:payroll:prp04`

    Should verify at least:

    1. **Sync preview after reconciliation**

    * Create payroll payment batch (P03)
    * Mark payment line executed/paid (B04)
    * Reconcile to bank statement (B03)
    * GET preview returns `MARK_PAID` candidates

    2. **Sync apply**

    * POST apply
    * liabilities `IN_BATCH -> PAID`
    * links `LINKED -> PAID`
    * settlement rows inserted

    3. **Idempotent apply**

    * Re-run apply
    * no duplicate `payroll_liability_settlements` rows
    * statuses remain stable

    4. **Release flow**

    * For another run, cancel/fail payment batch or line
    * GET preview returns `RELEASE_TO_OPEN`
    * POST apply releases liabilities back to `OPEN`

    5. **Scope filtering**

    * `scope=NET_PAY` only syncs employee net liabilities
    * `scope=STATUTORY` only syncs statutory liabilities

    6. **Permissions**

    * `payroll.payment.sync.read` and `payroll.payment.sync.apply` both enforced (`403`)

    ---

    # Tiny implementation notes (important)

    * **P04 makes payroll liability status truthy and auditable** without mixing payroll logic into bank/payment modules.
    * Payroll remains the **subledger owner**; B04/B03 remain the **execution/reconciliation owners**.
    * Later (optional), you can add:

    * scheduled auto-sync job
    * partial settlement support
    * manual override workflow (maker-checker + reason code)

    ---
