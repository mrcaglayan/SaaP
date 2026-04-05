import { useEffect, useState } from "react";
import {
  assignLocalUserRole,
  deleteLocalUserRoleAssignment,
  getLocalUserAdminData,
} from "../../api/rbacAdmin.js";
import PermissionAccessNotice from "../../auth/PermissionAccessNotice.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";

const LOCAL_USER_ADMIN_PERMISSION_CODES = Object.freeze([
  "security.user_admin.local",
  "security.user_admin.entity",
]);

function formatLegalEntityLabel(entity) {
  const legalEntityCode = String(entity?.code || "").trim();
  const legalEntityName = String(entity?.name || "").trim();
  const codeLabel = legalEntityCode || `#${entity?.id || ""}`;
  return `${codeLabel}${legalEntityName ? ` - ${legalEntityName}` : ""}`;
}

function formatOperatingUnitLabel(unit) {
  const legalEntityCode = String(unit?.legal_entity_code || "").trim();
  const operatingUnitCode = String(unit?.code || "").trim();
  const operatingUnitName = String(unit?.name || "").trim();
  const prefix = legalEntityCode ? `${legalEntityCode} / ` : "";
  const codeLabel = operatingUnitCode || `#${unit?.id || ""}`;
  return `${prefix}${codeLabel}${operatingUnitName ? ` - ${operatingUnitName}` : ""}`;
}

function formatRoleLabel(role) {
  const roleCode = String(role?.code || role?.role_code || "").trim();
  const roleName = String(role?.name || role?.role_name || "").trim();
  if (roleName && roleCode && roleName !== roleCode) {
    return `${roleName} (${roleCode})`;
  }
  return roleName || roleCode || "-";
}

function toStatusLabel(value) {
  const status = String(value || "").trim().toUpperCase();
  return status || "-";
}

function getAllowedScopeTypes(role) {
  const scopeTypes = Array.isArray(role?.allowedScopeTypes) ? role.allowedScopeTypes : [];
  return scopeTypes
    .map((scopeType) => String(scopeType || "").trim().toUpperCase())
    .filter(Boolean);
}

function getOperatingUnitsForLegalEntity(operatingUnits, legalEntityId) {
  const normalizedLegalEntityId = Number(legalEntityId || 0);
  const rows = Array.isArray(operatingUnits) ? operatingUnits : [];
  if (!normalizedLegalEntityId) {
    return rows;
  }
  return rows.filter(
    (unit) => Number(unit?.legal_entity_id || 0) === normalizedLegalEntityId
  );
}

function pickSelectedId(currentValue, rows) {
  const normalizedCurrentValue = Number(currentValue || 0);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (
    normalizedCurrentValue > 0 &&
    normalizedRows.some((row) => Number(row?.id || 0) === normalizedCurrentValue)
  ) {
    return String(normalizedCurrentValue);
  }
  return normalizedRows[0] ? String(normalizedRows[0].id) : "";
}

function getSyncedFormState(prevForm, roles, legalEntities, operatingUnits) {
  const nextRoleCode = roles.some((role) => role.code === prevForm.roleCode)
    ? prevForm.roleCode
    : String(roles[0]?.code || "");
  const selectedRole = roles.find((role) => role.code === nextRoleCode) || null;
  const allowedScopeTypes = getAllowedScopeTypes(selectedRole);
  const nextScopeType = allowedScopeTypes.includes(
    String(prevForm.scopeType || "").trim().toUpperCase()
  )
    ? String(prevForm.scopeType || "").trim().toUpperCase()
    : allowedScopeTypes[0] || "LEGAL_ENTITY";
  const nextLegalEntityId = pickSelectedId(prevForm.legalEntityId, legalEntities);
  const nextOperatingUnitId = pickSelectedId(
    prevForm.operatingUnitId,
    getOperatingUnitsForLegalEntity(operatingUnits, nextLegalEntityId)
  );

  if (
    prevForm.roleCode === nextRoleCode &&
    prevForm.scopeType === nextScopeType &&
    prevForm.legalEntityId === nextLegalEntityId &&
    prevForm.operatingUnitId === nextOperatingUnitId
  ) {
    return prevForm;
  }

  return {
    ...prevForm,
    roleCode: nextRoleCode,
    scopeType: nextScopeType,
    legalEntityId: nextLegalEntityId,
    operatingUnitId: nextOperatingUnitId,
  };
}

function getLocalUserAdminAccess(getPermissionAccess, scopeType, scopeId) {
  const normalizedScopeType = String(scopeType || "").trim().toUpperCase();
  const normalizedScopeId = Number(scopeId || 0);
  const accessOptions =
    normalizedScopeType && normalizedScopeId > 0
      ? {
          scope: {
            scopeType: normalizedScopeType,
            scopeId: normalizedScopeId,
          },
        }
      : undefined;
  const accesses = LOCAL_USER_ADMIN_PERMISSION_CODES.map((permissionCode) =>
    getPermissionAccess(permissionCode, accessOptions)
  );
  return (
    accesses.find((access) => access?.allowed) ||
    accesses.find((access) => access?.wrongScope) ||
    accesses[0] ||
    null
  );
}

function formatScopeTypeLabel(scopeType, t) {
  const normalizedScopeType = String(scopeType || "").trim().toUpperCase();
  if (normalizedScopeType === "OPERATING_UNIT") {
    return t("branchOperators.form.scopeTypeOperatingUnit");
  }
  return t("branchOperators.form.scopeTypeLegalEntity");
}

function getAssignmentScopeStatus(assignment) {
  const scopeType = String(assignment?.scope_type || "").trim().toUpperCase();
  if (scopeType === "OPERATING_UNIT") {
    return assignment?.operating_unit_status;
  }
  return assignment?.legal_entity_status;
}

/**
 * Lets legal-entity-scoped delegated admins invite and assign allow-listed
 * local operational roles without opening tenant-wide security administration.
 */
export default function BranchOperatorManagementPage() {
  const { getPermissionAccess } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [roles, setRoles] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    roleCode: "",
    scopeType: "",
    legalEntityId: "",
    operatingUnitId: "",
  });

  const selectedRole = roles.find((role) => role.code === form.roleCode) || null;
  const selectedScopeType = String(form.scopeType || "").trim().toUpperCase();
  const filteredOperatingUnits = getOperatingUnitsForLegalEntity(
    operatingUnits,
    form.legalEntityId
  );
  const selectedScopeId =
    selectedScopeType === "OPERATING_UNIT"
      ? Number(form.operatingUnitId || 0)
      : Number(form.legalEntityId || 0);
  const manageAccess = getLocalUserAdminAccess(
    getPermissionAccess,
    selectedScopeType,
    selectedScopeId
  );
  const canManage = Boolean(manageAccess?.allowed);
  const hasManageableScopes = legalEntities.length > 0 || operatingUnits.length > 0;
  const allowedScopeTypes = getAllowedScopeTypes(selectedRole);
  const showScopeTypeSelect = allowedScopeTypes.length > 1;
  const showOperatingUnitSelect = selectedScopeType === "OPERATING_UNIT";

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const response = await getLocalUserAdminData();
      const nextRoles = Array.isArray(response?.roles) ? response.roles : [];
      const nextLegalEntities = Array.isArray(response?.legalEntities)
        ? response.legalEntities
        : [];
      const nextOperatingUnits = Array.isArray(response?.operatingUnits)
        ? response.operatingUnits
        : [];
      const nextAssignments = Array.isArray(response?.assignments)
        ? response.assignments
        : [];

      setRoles(nextRoles);
      setLegalEntities(nextLegalEntities);
      setOperatingUnits(nextOperatingUnits);
      setAssignments(nextAssignments);
      setForm((prev) =>
        getSyncedFormState(prev, nextRoles, nextLegalEntities, nextOperatingUnits)
      );
    } catch (err) {
      setError(err?.response?.data?.message || t("branchOperators.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => getSyncedFormState(prev, roles, legalEntities, operatingUnits));
  }, [roles, legalEntities, operatingUnits]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedRole) {
      setError(t("branchOperators.form.roleRequired"));
      return;
    }
    if (!canManage) {
      setError(t("branchOperators.missingPermission"));
      return;
    }
    if (selectedScopeType === "LEGAL_ENTITY" && selectedScopeId <= 0) {
      setError(t("branchOperators.form.legalEntityRequired"));
      return;
    }
    if (selectedScopeType === "OPERATING_UNIT" && selectedScopeId <= 0) {
      setError(t("branchOperators.form.operatingUnitRequired"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setInviteLink("");
    try {
      const response = await assignLocalUserRole({
        name: form.name.trim(),
        email: form.email.trim(),
        roleCode: selectedRole.code,
        scopeType: selectedScopeType,
        scopeId: selectedScopeId,
      });

      const nextInviteLink = String(response?.invite?.inviteUrl || "");
      setInviteLink(nextInviteLink);
      setMessage(
        nextInviteLink
          ? t("branchOperators.messages.inviteCreated")
          : response?.assignmentCreated
            ? t("branchOperators.messages.assignmentCreated")
            : t("branchOperators.messages.assignmentExists")
      );
      setForm((prev) => ({
        ...prev,
        name: "",
        email: "",
      }));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("branchOperators.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignment) {
    const assignmentAccess = getLocalUserAdminAccess(
      getPermissionAccess,
      assignment?.scope_type,
      assignment?.scope_id
    );
    if (!assignmentAccess?.allowed) {
      setError(t("branchOperators.missingPermission"));
      return;
    }

    const confirmed = window.confirm(t("branchOperators.deleteConfirm"));
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setInviteLink("");
    try {
      await deleteLocalUserRoleAssignment(assignment.id);
      setMessage(t("branchOperators.messages.assignmentRemoved"));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("branchOperators.deleteFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setMessage(t("branchOperators.messages.inviteCopied"));
    } catch {
      setError(t("branchOperators.messages.inviteCopyFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("branchOperators.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("branchOperators.subtitle")}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("branchOperators.form.title")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t("branchOperators.form.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {t("branchOperators.form.roleCount", {
                count: roles.length,
              })}
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {t("branchOperators.form.entityCount", {
                count: legalEntities.length,
              })}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">{t("branchOperators.list.loading")}</p>
        ) : !roles.length ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("branchOperators.noRoles")}
          </p>
        ) : !hasManageableScopes ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("branchOperators.noOperatingUnits")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-6">
              <PermissionAccessNotice
                access={manageAccess}
                permissionCode={manageAccess?.code || "security.user_admin.local"}
              />
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={t("branchOperators.form.name")}
              required
            />
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={t("branchOperators.form.email")}
              required
            />
            <select
              value={form.roleCode}
              onChange={(event) =>
                setForm((prev) =>
                  getSyncedFormState(
                    {
                      ...prev,
                      roleCode: event.target.value,
                      scopeType: "",
                    },
                    roles,
                    legalEntities,
                    operatingUnits
                  )
                )
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{t("branchOperators.form.selectRole")}</option>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {formatRoleLabel(role)}
                </option>
              ))}
            </select>
            {showScopeTypeSelect ? (
              <select
                value={form.scopeType}
                onChange={(event) =>
                  setForm((prev) =>
                    getSyncedFormState(
                      {
                        ...prev,
                        scopeType: event.target.value,
                      },
                      roles,
                      legalEntities,
                      operatingUnits
                    )
                  )
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                required
              >
                <option value="">{t("branchOperators.form.selectScopeType")}</option>
                {allowedScopeTypes.map((scopeType) => (
                  <option key={scopeType} value={scopeType}>
                    {formatScopeTypeLabel(scopeType, t)}
                  </option>
                ))}
              </select>
            ) : null}
            {legalEntities.length > 0 ? (
              <select
                value={form.legalEntityId}
                onChange={(event) =>
                  setForm((prev) =>
                    getSyncedFormState(
                      {
                        ...prev,
                        legalEntityId: event.target.value,
                        operatingUnitId: "",
                      },
                      roles,
                      legalEntities,
                      operatingUnits
                    )
                  )
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                required={selectedScopeType === "LEGAL_ENTITY"}
              >
                <option value="">{t("branchOperators.form.selectLegalEntity")}</option>
                {legalEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {formatLegalEntityLabel(entity)}
                  </option>
                ))}
              </select>
            ) : null}
            {showOperatingUnitSelect ? (
              <select
                value={form.operatingUnitId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    operatingUnitId: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                required
              >
                <option value="">{t("branchOperators.form.selectOperatingUnit")}</option>
                {filteredOperatingUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {formatOperatingUnitLabel(unit)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="submit"
              disabled={saving || !canManage}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
            >
              {saving
                ? t("branchOperators.form.submitting")
                : t("branchOperators.form.submit")}
            </button>
          </form>
        )}

        {inviteLink ? (
          <div className="mt-3 grid gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs font-semibold text-sky-800">
              {t("branchOperators.messages.inviteLinkReady")}
            </div>
            <div className="break-all rounded-md border border-sky-200 bg-white px-2 py-1 text-xs text-slate-700">
              {inviteLink}
            </div>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="w-fit rounded-md border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            >
              {t("branchOperators.messages.copyInviteLink")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          {t("branchOperators.list.title")}
        </div>
        {loading ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            {t("branchOperators.list.loading")}
          </p>
        ) : assignments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            {t("branchOperators.list.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">{t("branchOperators.list.user")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.role")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.scope")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.status")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.action")}</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => {
                  const deleteAccess = getLocalUserAdminAccess(
                    getPermissionAccess,
                    assignment.scope_type,
                    assignment.scope_id
                  );
                  const scopeType = String(assignment.scope_type || "").trim().toUpperCase();
                  return (
                    <tr key={assignment.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">
                          {assignment.user_name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {assignment.user_email}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {formatRoleLabel(assignment)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">
                          {formatScopeTypeLabel(scopeType, t)}
                        </div>
                        {scopeType === "OPERATING_UNIT" ? (
                          <>
                            <div className="text-slate-700">
                              {assignment.operating_unit_code || "-"}
                              {assignment.operating_unit_name
                                ? ` - ${assignment.operating_unit_name}`
                                : ""}
                            </div>
                            <div className="text-xs text-slate-500">
                              {assignment.legal_entity_code || "-"}
                              {assignment.legal_entity_name
                                ? ` - ${assignment.legal_entity_name}`
                                : ""}
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-700">
                            {assignment.legal_entity_code || "-"}
                            {assignment.legal_entity_name
                              ? ` - ${assignment.legal_entity_name}`
                              : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-slate-700">
                          {t("branchOperators.list.userStatus")}{" "}
                          {toStatusLabel(assignment.user_status)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {t("branchOperators.list.scopeStatus")}{" "}
                          {toStatusLabel(getAssignmentScopeStatus(assignment))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          disabled={saving || !deleteAccess?.allowed}
                          onClick={() => handleDelete(assignment)}
                          className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          {t("branchOperators.actions.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
