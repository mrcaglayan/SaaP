
import { useEffect, useMemo, useState } from "react";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";
import {
    createPayrollOwnershipAssignment,
    deactivatePayrollOwnershipAssignment,
    listPayrollOwnershipAssignments,
    updatePayrollOwnershipAssignment,
} from "../../api/payrollOwnership.js";
import { useAuth } from "../../auth/useAuth.js";

const EMPTY_FORM = {
    id: "",
    legalEntityId: "",
    employeeCode: "",
    employeeNameSnapshot: "",
    ownershipScope: "CENTRAL",
    operatingUnitId: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "ACTIVE",
    expectedCostCenterCode: "",
    sourceType: "MANUAL",
    notes: "",
};

function toPositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(value) {
    if (!value) {
        return "-";
    }
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
        return String(value).slice(0, 10);
    }
    return parsed.toISOString().slice(0, 10);
}

function mapRowToForm(row) {
    if (!row) {
        return { ...EMPTY_FORM };
    }
    return {
        id: String(row.id || ""),
        legalEntityId: String(row.legal_entity_id || ""),
        employeeCode: String(row.employee_code || ""),
        employeeNameSnapshot: String(row.employee_name_snapshot || ""),
        ownershipScope: String(row.ownership_scope || "CENTRAL"),
        operatingUnitId: String(row.operating_unit_id || ""),
        effectiveFrom: String(row.effective_from || ""),
        effectiveTo: String(row.effective_to || ""),
        status: String(row.status || "ACTIVE"),
        expectedCostCenterCode: String(row.expected_cost_center_code || ""),
        sourceType: String(row.source_type || "MANUAL"),
        notes: String(row.notes || ""),
    };
}

function buildPayload(form) {
    return {
        legalEntityId: toPositiveInt(form.legalEntityId),
        employeeCode: String(form.employeeCode || "").trim().toUpperCase(),
        employeeNameSnapshot: String(form.employeeNameSnapshot || "").trim() || null,
        ownershipScope: String(form.ownershipScope || "CENTRAL").trim().toUpperCase(),
        operatingUnitId:
            String(form.ownershipScope || "").trim().toUpperCase() === "OPERATING_UNIT"
                ? toPositiveInt(form.operatingUnitId)
                : null,
        effectiveFrom: String(form.effectiveFrom || "").trim(),
        effectiveTo: String(form.effectiveTo || "").trim() || null,
        status: String(form.status || "ACTIVE").trim().toUpperCase(),
        expectedCostCenterCode: String(form.expectedCostCenterCode || "").trim().toUpperCase() || null,
        sourceType: String(form.sourceType || "MANUAL").trim().toUpperCase() || "MANUAL",
        notes: String(form.notes || "").trim() || null,
    };
}

function statusBadgeClass(status) {
    return String(status || "").toUpperCase() === "ACTIVE"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-200 text-slate-700";
}

function ownershipBadgeClass(scope) {
    return String(scope || "").toUpperCase() === "OPERATING_UNIT"
        ? "bg-sky-100 text-sky-800"
        : "bg-amber-100 text-amber-800";
}

export default function PayrollEmployeeOwnershipPage() {
    const { hasPermission } = useAuth();
    const canRead = hasPermission("payroll.ownership.read");
    const canWrite = hasPermission("payroll.ownership.write");
    const canReadOrgTree = hasPermission("org.tree.read");

    const [filters, setFilters] = useState({
        legalEntityId: "",
        employeeCode: "",
        operatingUnitId: "",
        status: "ACTIVE",
    });
    const [rows, setRows] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [form, setForm] = useState({ ...EMPTY_FORM });
    const [legalEntities, setLegalEntities] = useState([]);
    const [operatingUnits, setOperatingUnits] = useState([]);
    const [loadingLookups, setLoadingLookups] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deactivatingId, setDeactivatingId] = useState(null);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [lookupWarning, setLookupWarning] = useState("");

    const selectedRow = useMemo(
        () => rows.find((row) => Number(row.id) === Number(selectedId)) || null,
        [rows, selectedId]
    );

    const legalEntityOptions = useMemo(
        () =>
            [...(legalEntities || [])].sort((left, right) =>
                String(left?.code || "").localeCompare(String(right?.code || ""))
            ),
        [legalEntities]
    );

    const filterOperatingUnitOptions = useMemo(() => {
        const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
        return [...(operatingUnits || [])]
            .filter((row) => {
                if (String(row?.status || "").toUpperCase() !== "ACTIVE") {
                    return false;
                }
                if (!selectedLegalEntityId) {
                    return true;
                }
                return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
            })
            .sort((left, right) =>
                String(left?.code || "").localeCompare(String(right?.code || ""))
            );
    }, [filters.legalEntityId, operatingUnits]);

    const formOperatingUnitOptions = useMemo(() => {
        const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
        return [...(operatingUnits || [])]
            .filter((row) => {
                if (String(row?.status || "").toUpperCase() !== "ACTIVE") {
                    return false;
                }
                if (!selectedLegalEntityId) {
                    return true;
                }
                return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
            })
            .sort((left, right) =>
                String(left?.code || "").localeCompare(String(right?.code || ""))
            );
    }, [form.legalEntityId, operatingUnits]);

    useEffect(() => {
        let cancelled = false;
        if (!canReadOrgTree) {
            setLegalEntities([]);
            setOperatingUnits([]);
            setLookupWarning("org.tree.read missing. Enter legal entity and operating unit IDs manually.");
            return undefined;
        }

        (async () => {
            setLoadingLookups(true);
            try {
                const [legalEntityRes, operatingUnitRes] = await Promise.all([
                    listLegalEntities({ limit: 500, offset: 0 }),
                    listOperatingUnits(),
                ]);
                if (!cancelled) {
                    setLegalEntities(legalEntityRes?.rows || []);
                    setOperatingUnits(operatingUnitRes?.rows || []);
                    setLookupWarning("");
                }
            } catch (err) {
                if (!cancelled) {
                    setLegalEntities([]);
                    setOperatingUnits([]);
                    setLookupWarning(
                        err?.response?.data?.message || "Legal entity / operating unit lookups could not be loaded."
                    );
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
    }, [canReadOrgTree]);

    useEffect(() => {
        if (filters.legalEntityId || legalEntityOptions.length === 0) {
            return;
        }
        setFilters((prev) => ({ ...prev, legalEntityId: String(legalEntityOptions[0]?.id || "") }));
    }, [filters.legalEntityId, legalEntityOptions]);

    useEffect(() => {
        if (form.id || form.legalEntityId || legalEntityOptions.length === 0) {
            return;
        }
        setForm((prev) => ({ ...prev, legalEntityId: String(legalEntityOptions[0]?.id || "") }));
    }, [form.id, form.legalEntityId, legalEntityOptions]);

    useEffect(() => {
        if (String(form.ownershipScope || "").toUpperCase() !== "OPERATING_UNIT" && form.operatingUnitId) {
            setForm((prev) => ({ ...prev, operatingUnitId: "" }));
        }
    }, [form.ownershipScope, form.operatingUnitId]);

    async function loadRows(nextFilters = filters) {
        if (!canRead) {
            setRows([]);
            return;
        }
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const response = await listPayrollOwnershipAssignments({
                legalEntityId: nextFilters.legalEntityId || undefined,
                employeeCode: nextFilters.employeeCode || undefined,
                operatingUnitId: nextFilters.operatingUnitId || undefined,
                status: nextFilters.status || undefined,
                limit: 200,
                offset: 0,
            });
            const items = response?.rows || [];
            setRows(items);
            if (items.length > 0) {
                const nextSelectedId =
                    items.find((row) => Number(row.id) === Number(selectedId))?.id || items[0].id;
                const nextSelectedRow =
                    items.find((row) => Number(row.id) === Number(nextSelectedId)) || items[0];
                setSelectedId(nextSelectedId);
                setForm(mapRowToForm(nextSelectedRow));
            } else {
                setSelectedId(null);
                setForm((prev) => ({
                    ...EMPTY_FORM,
                    legalEntityId: prev.legalEntityId || nextFilters.legalEntityId || "",
                    status: "ACTIVE",
                    sourceType: "MANUAL",
                }));
            }
        } catch (err) {
            setRows([]);
            setSelectedId(null);
            setError(err?.response?.data?.message || "Payroll ownership assignments could not be loaded.");
        } finally {
            setLoading(false);
        }
    }

    function handleSelectRow(row) {
        setSelectedId(row.id);
        setForm(mapRowToForm(row));
        setError("");
        setMessage("");
    }

    function resetForm() {
        setSelectedId(null);
        setForm({
            ...EMPTY_FORM,
            legalEntityId: filters.legalEntityId || form.legalEntityId || "",
            status: "ACTIVE",
            sourceType: "MANUAL",
        });
        setError("");
        setMessage("");
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!canWrite) {
            return;
        }

        setSaving(true);
        setError("");
        setMessage("");
        try {
            const payload = buildPayload(form);
            if (selectedId) {
                await updatePayrollOwnershipAssignment(selectedId, payload);
                setMessage(`Assignment #${selectedId} updated.`);
            } else {
                await createPayrollOwnershipAssignment(payload);
                setMessage("Payroll ownership assignment created.");
            }
            await loadRows({
                ...filters,
                legalEntityId: filters.legalEntityId || form.legalEntityId,
            });
        } catch (err) {
            setError(err?.response?.data?.message || "Payroll ownership assignment could not be saved.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDeactivate(row) {
        if (!canWrite || !row?.id) {
            return;
        }
        setDeactivatingId(Number(row.id));
        setError("");
        setMessage("");
        try {
            await deactivatePayrollOwnershipAssignment(row.id);
            setMessage(`Assignment #${row.id} deactivated.`);
            await loadRows();
        } catch (err) {
            setError(err?.response?.data?.message || "Payroll ownership assignment could not be deactivated.");
        } finally {
            setDeactivatingId(null);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-slate-900">Payroll Ownership</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Maintain effective-dated employee owner context by legal entity and operating unit.
                </p>
            </div>

            {!canRead ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Missing permission: <code>payroll.ownership.read</code>
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
            {lookupWarning ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {lookupWarning}
                </div>
            ) : null}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
                        <p className="mt-1 text-xs text-slate-500">
                            Filter by legal entity, employee code, operating unit, and assignment status.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => loadRows(filters)}
                            disabled={!canRead || loading}
                            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
                        >
                            {loading ? "Loading..." : "Load"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const nextFilters = {
                                    legalEntityId: "",
                                    employeeCode: "",
                                    operatingUnitId: "",
                                    status: "ACTIVE",
                                };
                                setFilters(nextFilters);
                                void loadRows(nextFilters);
                            }}
                            disabled={!canRead || loading}
                            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                    <label className="text-xs">
                        <span className="mb-1 block font-medium text-slate-700">Legal Entity</span>
                        {canReadOrgTree ? (
                            <select
                                value={filters.legalEntityId}
                                onChange={(event) =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        legalEntityId: event.target.value,
                                        operatingUnitId: "",
                                    }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                disabled={loadingLookups}
                            >
                                <option value="">{loadingLookups ? "Loading..." : "All"}</option>
                                {legalEntityOptions.map((row) => (
                                    <option key={row.id} value={row.id}>
                                        {row.code} - {row.name}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                value={filters.legalEntityId}
                                onChange={(event) =>
                                    setFilters((prev) => ({ ...prev, legalEntityId: event.target.value, operatingUnitId: "" }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                placeholder="legalEntityId"
                            />
                        )}
                    </label>

                    <label className="text-xs">
                        <span className="mb-1 block font-medium text-slate-700">Employee Code</span>
                        <input
                            value={filters.employeeCode}
                            onChange={(event) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    employeeCode: event.target.value.toUpperCase(),
                                }))
                            }
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            placeholder="EMP001"
                        />
                    </label>

                    <label className="text-xs">
                        <span className="mb-1 block font-medium text-slate-700">Operating Unit</span>
                        {canReadOrgTree ? (
                            <select
                                value={filters.operatingUnitId}
                                onChange={(event) =>
                                    setFilters((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                disabled={loadingLookups}
                            >
                                <option value="">{filters.legalEntityId ? "All" : "All legal entities"}</option>
                                {filterOperatingUnitOptions.map((row) => (
                                    <option key={row.id} value={row.id}>
                                        {row.code} - {row.name}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                value={filters.operatingUnitId}
                                onChange={(event) =>
                                    setFilters((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                placeholder="operatingUnitId"
                            />
                        )}
                    </label>

                    <label className="text-xs">
                        <span className="mb-1 block font-medium text-slate-700">Status</span>
                        <select
                            value={filters.status}
                            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        >
                            <option value="">ALL</option>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="INACTIVE">INACTIVE</option>
                        </select>
                    </label>
                </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">Assignments</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Central rows keep <code>operating_unit_id</code> empty. OU rows keep scope explicit.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={resetForm}
                            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                        >
                            New Assignment
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-2 py-2">Employee</th>
                                    <th className="px-2 py-2">Owner Context</th>
                                    <th className="px-2 py-2">Effective Dates</th>
                                    <th className="px-2 py-2">Status</th>
                                    <th className="px-2 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr
                                        key={row.id}
                                        className={`border-t border-slate-100 align-top ${Number(row.id) === Number(selectedId) ? "bg-slate-50" : ""
                                            }`}
                                    >
                                        <td className="px-2 py-2 text-slate-700">
                                            <button
                                                type="button"
                                                onClick={() => handleSelectRow(row)}
                                                className="text-left font-medium text-slate-900 underline"
                                            >
                                                {row.employee_code}
                                            </button>
                                            <div className="text-xs text-slate-500">{row.employee_name_snapshot || "-"}</div>
                                            <div className="text-xs text-slate-500">
                                                {row.legal_entity_code || "-"}
                                                {row.legal_entity_name ? ` - ${row.legal_entity_name}` : ""}
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 text-slate-700">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ownershipBadgeClass(
                                                    row.ownership_scope
                                                )}`}
                                            >
                                                {row.ownership_scope}
                                            </span>
                                            <div className="mt-1 text-xs text-slate-500">
                                                {row.ownership_scope === "OPERATING_UNIT"
                                                    ? `${row.operating_unit_code || row.operating_unit_id}${row.operating_unit_name ? ` - ${row.operating_unit_name}` : ""
                                                    }`
                                                    : "Central"}
                                            </div>
                                            {row.expected_cost_center_code ? (
                                                <div className="text-xs text-slate-500">
                                                    Expected CC: {row.expected_cost_center_code}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-2 py-2 text-slate-700">
                                            <div>{formatDate(row.effective_from)}</div>
                                            <div className="text-xs text-slate-500">
                                                to {row.effective_to ? formatDate(row.effective_to) : "open-ended"}
                                            </div>
                                        </td>
                                        <td className="px-2 py-2">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                                    row.status
                                                )}`}
                                            >
                                                {row.status}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectRow(row)}
                                                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeactivate(row)}
                                                    disabled={!canWrite || deactivatingId === Number(row.id) || row.status === "INACTIVE"}
                                                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                                                >
                                                    {deactivatingId === Number(row.id) ? "..." : "Deactivate"}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-2 py-6 text-center text-sm text-slate-500">
                                            {loading ? "Loading..." : "No payroll ownership assignments found."}
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                {selectedId ? `Edit #${selectedId}` : "Create Assignment"}
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Effective dates are inclusive. Leave <code>effectiveTo</code> empty for open-ended ownership.
                            </p>
                        </div>
                        {selectedId ? (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Legal Entity *</span>
                                {canReadOrgTree ? (
                                    <select
                                        value={form.legalEntityId}
                                        onChange={(event) =>
                                            setForm((prev) => ({
                                                ...prev,
                                                legalEntityId: event.target.value,
                                                operatingUnitId: "",
                                            }))
                                        }
                                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                        disabled={loadingLookups || saving}
                                        required
                                    >
                                        <option value="">{loadingLookups ? "Loading..." : "Select"}</option>
                                        {legalEntityOptions.map((row) => (
                                            <option key={row.id} value={row.id}>
                                                {row.code} - {row.name}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        value={form.legalEntityId}
                                        onChange={(event) =>
                                            setForm((prev) => ({ ...prev, legalEntityId: event.target.value, operatingUnitId: "" }))
                                        }
                                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                        placeholder="legalEntityId"
                                        required
                                    />
                                )}
                            </label>

                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Employee Code *</span>
                                <input
                                    value={form.employeeCode}
                                    onChange={(event) =>
                                        setForm((prev) => ({
                                            ...prev,
                                            employeeCode: event.target.value.toUpperCase(),
                                        }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    placeholder="EMP001"
                                    required
                                />
                            </label>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Employee Name</span>
                                <input
                                    value={form.employeeNameSnapshot}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, employeeNameSnapshot: event.target.value }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    placeholder="Employee name snapshot"
                                />
                            </label>

                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Ownership Scope *</span>
                                <select
                                    value={form.ownershipScope}
                                    onChange={(event) =>
                                        setForm((prev) => ({
                                            ...prev,
                                            ownershipScope: event.target.value,
                                            operatingUnitId: event.target.value === "OPERATING_UNIT" ? prev.operatingUnitId : "",
                                        }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    required
                                >
                                    <option value="CENTRAL">CENTRAL</option>
                                    <option value="OPERATING_UNIT">OPERATING_UNIT</option>
                                </select>
                            </label>
                        </div>

                        <label className="text-xs">
                            <span className="mb-1 block font-medium text-slate-700">Operating Unit</span>
                            {canReadOrgTree ? (
                                <select
                                    value={form.operatingUnitId}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    disabled={
                                        loadingLookups ||
                                        saving ||
                                        String(form.ownershipScope || "").toUpperCase() !== "OPERATING_UNIT"
                                    }
                                    required={String(form.ownershipScope || "").toUpperCase() === "OPERATING_UNIT"}
                                >
                                    <option value="">
                                        {form.ownershipScope === "OPERATING_UNIT"
                                            ? form.legalEntityId
                                                ? "Select OU"
                                                : "Select legal entity first"
                                            : "Not used for central"}
                                    </option>
                                    {formOperatingUnitOptions.map((row) => (
                                        <option key={row.id} value={row.id}>
                                            {row.code} - {row.name}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    value={form.operatingUnitId}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    placeholder="operatingUnitId"
                                    disabled={String(form.ownershipScope || "").toUpperCase() !== "OPERATING_UNIT"}
                                    required={String(form.ownershipScope || "").toUpperCase() === "OPERATING_UNIT"}
                                />
                            )}
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Effective From *</span>
                                <input
                                    type="date"
                                    value={form.effectiveFrom}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    required
                                />
                            </label>

                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Effective To</span>
                                <input
                                    type="date"
                                    value={form.effectiveTo}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, effectiveTo: event.target.value }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                />
                            </label>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Status *</span>
                                <select
                                    value={form.status}
                                    onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    required
                                >
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="INACTIVE">INACTIVE</option>
                                </select>
                            </label>

                            <label className="text-xs">
                                <span className="mb-1 block font-medium text-slate-700">Source Type</span>
                                <input
                                    value={form.sourceType}
                                    onChange={(event) =>
                                        setForm((prev) => ({ ...prev, sourceType: event.target.value.toUpperCase() }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    placeholder="MANUAL"
                                />
                            </label>
                        </div>

                        <label className="text-xs">
                            <span className="mb-1 block font-medium text-slate-700">Expected Cost Center</span>
                            <input
                                value={form.expectedCostCenterCode}
                                onChange={(event) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        expectedCostCenterCode: event.target.value.toUpperCase(),
                                    }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                placeholder="CC-001"
                            />
                        </label>

                        <label className="text-xs">
                            <span className="mb-1 block font-medium text-slate-700">Notes</span>
                            <textarea
                                value={form.notes}
                                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                                className="min-h-24 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                placeholder="Optional note"
                            />
                        </label>

                        <button
                            type="submit"
                            disabled={!canWrite || saving}
                            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving
                                ? "Saving..."
                                : selectedId
                                    ? "Update Assignment"
                                    : "Create Assignment"}
                        </button>
                    </form>
                </section>
            </div>
        </div>
    );
}
