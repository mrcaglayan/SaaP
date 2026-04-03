import { useEffect, useState } from "react";
import {
  assignEntityBranchOperator,
  deleteEntityBranchOperatorAssignment,
  getEntityBranchOperatorAdminData,
} from "../../api/rbacAdmin.js";
import PermissionAccessNotice from "../../auth/PermissionAccessNotice.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";

function formatOperatingUnitLabel(unit) {
  const legalEntityCode = String(unit?.legal_entity_code || "").trim();
  const operatingUnitCode = String(unit?.code || "").trim();
  const operatingUnitName = String(unit?.name || "").trim();
  const prefix = legalEntityCode ? `${legalEntityCode} / ` : "";
  const codeLabel = operatingUnitCode || `#${unit?.id || ""}`;
  return `${prefix}${codeLabel}${operatingUnitName ? ` - ${operatingUnitName}` : ""}`;
}

function toStatusLabel(value) {
  const status = String(value || "").trim().toUpperCase();
  return status || "-";
}

/**
 * Lets entity-scoped delegated admins invite and assign BranchOperator users
 * only within their manageable operating-unit subtree.
 */
export default function BranchOperatorManagementPage() {
  const { getPermissionAccess } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    operatingUnitId: "",
  });
  const selectedOperatingUnitId = Number(form.operatingUnitId || 0);
  const manageAccess = getPermissionAccess(
    "security.user_admin.entity",
    selectedOperatingUnitId
      ? {
          scope: {
            scopeType: "OPERATING_UNIT",
            scopeId: selectedOperatingUnitId,
          },
        }
      : undefined
  );
  const canManage = manageAccess.allowed;

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const response = await getEntityBranchOperatorAdminData();
      setOperatingUnits(Array.isArray(response?.operatingUnits) ? response.operatingUnits : []);
      setAssignments(Array.isArray(response?.assignments) ? response.assignments : []);
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
    if (!operatingUnits.length) {
      return;
    }
    setForm((prev) => {
      if (prev.operatingUnitId) {
        return prev;
      }
      return {
        ...prev,
        operatingUnitId: String(operatingUnits[0].id),
      };
    });
  }, [operatingUnits]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canManage) {
      setError(t("branchOperators.missingPermission"));
      return;
    }

    const operatingUnitId = Number(form.operatingUnitId);
    if (!Number.isInteger(operatingUnitId) || operatingUnitId <= 0) {
      setError(t("branchOperators.form.operatingUnitRequired"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setInviteLink("");
    try {
      const response = await assignEntityBranchOperator({
        name: form.name.trim(),
        email: form.email.trim(),
        operatingUnitId,
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

  async function handleDelete(assignmentId) {
    if (!canManage) {
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
      await deleteEntityBranchOperatorAssignment(assignmentId);
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
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {t("branchOperators.form.branchCount", {
              count: operatingUnits.length,
            })}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">{t("branchOperators.list.loading")}</p>
        ) : operatingUnits.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("branchOperators.noOperatingUnits")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-4">
              <PermissionAccessNotice
                access={manageAccess}
                permissionCode="security.user_admin.entity"
              />
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("branchOperators.form.name")}
              required
            />
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("branchOperators.form.email")}
              required
            />
            <select
              value={form.operatingUnitId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{t("branchOperators.form.selectBranch")}</option>
              {operatingUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {formatOperatingUnitLabel(unit)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={saving || !canManage}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
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
                  <th className="px-4 py-2">{t("branchOperators.list.entity")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.branch")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.status")}</th>
                  <th className="px-4 py-2">{t("branchOperators.list.action")}</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {assignment.user_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {assignment.user_email}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {assignment.legal_entity_code || "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {assignment.legal_entity_name || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {assignment.operating_unit_code || "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {assignment.operating_unit_name || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-slate-700">
                        {t("branchOperators.list.userStatus")}{" "}
                        {toStatusLabel(assignment.user_status)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {t("branchOperators.list.branchStatus")}{" "}
                        {toStatusLabel(assignment.operating_unit_status)}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={saving || !canManage}
                        onClick={() => handleDelete(assignment.id)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        {t("branchOperators.actions.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
