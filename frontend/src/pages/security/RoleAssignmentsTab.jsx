import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const USER_ASSIGNMENTS_PATH = "/app/ayarlar/security-admin/users?tab=assignments";
const WORKFLOW_PRESETS_PATH =
  "/app/ayarlar/security-admin/catalog?tab=access-model&modelTab=workflow_presets";

function normalizeText(value) {
  return String(value || "").trim();
}

function formatScopeSummary(assignment) {
  const scopeType = normalizeText(assignment?.scope_type).toUpperCase();
  const scopeId = Number(assignment?.scope_id || 0);
  if (!scopeType) {
    return "-";
  }
  return scopeId > 0 ? `${scopeType} #${scopeId}` : scopeType;
}

function formatStatus(assignment) {
  const now = Date.now();
  const effectiveFrom = assignment?.effective_from
    ? new Date(assignment.effective_from).getTime()
    : null;
  const effectiveTo = assignment?.effective_to
    ? new Date(assignment.effective_to).getTime()
    : null;
  const afterStart =
    effectiveFrom === null || Number.isNaN(effectiveFrom) || effectiveFrom <= now;
  const beforeEnd =
    effectiveTo === null || Number.isNaN(effectiveTo) || effectiveTo >= now;

  if (afterStart && beforeEnd) {
    return "active";
  }
  if (effectiveFrom !== null && !Number.isNaN(effectiveFrom) && effectiveFrom > now) {
    return "upcoming";
  }
  if (effectiveTo !== null && !Number.isNaN(effectiveTo) && effectiveTo < now) {
    return "expired";
  }
  return "custom";
}

function getAssignmentUserKey(assignment) {
  const userId = Number(assignment?.user_id || 0);
  if (userId > 0) {
    return `user:${userId}`;
  }
  const userEmail = normalizeText(assignment?.user_email);
  if (userEmail) {
    return `email:${userEmail}`;
  }
  return `fallback:${normalizeText(assignment?.user_name)}:${assignment?.id || ""}`;
}

function getStatusMeta(status, l) {
  if (status === "active") {
    return {
      label: l("Active", "Aktif"),
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }
  if (status === "upcoming") {
    return {
      label: l("Upcoming", "Yaklasan"),
      className: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }
  if (status === "expired") {
    return {
      label: l("Expired", "Suresi dolmus"),
      className: "border-slate-200 bg-slate-100 text-slate-700",
    };
  }
  return {
    label: l("Custom", "Ozel"),
    className: "border-amber-200 bg-amber-50 text-amber-900",
  };
}

function SummaryMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-950">{value}</div>
    </div>
  );
}

/**
 * Renders the role detail assignments tab by surfacing direct runtime-role
 * usage plus the existing routes where admins manage users and managed authority
 * authority around the selected role. It also exposes scroll targets so the
 * detail-page quick actions can jump straight to assignments or preset context.
 */
export default function RoleAssignmentsTab({
  assignments = [],
  canReadRoleAssignments = false,
  focusRequest = null,
  l,
  relatedWorkflowPackages = [],
}) {
  const assignmentsSectionRef = useRef(null);
  const packageMapSectionRef = useRef(null);
  const normalizedAssignments = Array.isArray(assignments) ? assignments : [];
  const normalizedPackages = Array.isArray(relatedWorkflowPackages)
    ? relatedWorkflowPackages
    : [];
  const uniqueUserCount = new Set(
    normalizedAssignments.map((assignment) => getAssignmentUserKey(assignment))
  ).size;
  const uniqueScopeCount = new Set(
    normalizedAssignments.map(
      (assignment) =>
        `${normalizeText(assignment?.scope_type).toUpperCase()}:${Number(
          assignment?.scope_id || 0
        )}`
    )
  ).size;
  const activeAssignmentCount = normalizedAssignments.filter(
    (assignment) => formatStatus(assignment) === "active"
  ).length;

  useEffect(() => {
    if (!focusRequest?.section) {
      return;
    }
    const targetRef =
      focusRequest.section === "packages" ? packageMapSectionRef : assignmentsSectionRef;
    targetRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [focusRequest]);

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {l("Assignments", "Atamalar")}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950">
              {l("Role usage and preset context", "Rol kullanimi ve paket baglami")}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {l(
                "Inspect direct runtime-role assignments here, then jump to the existing users-assignment and workflow-package pages when you need to change sources or scope.",
                "Dogrudan runtime rol atamalarini burada inceleyin; sonra kaynak veya kapsam degistirmeniz gerektiginde mevcut kullanici-atama ve workflow-paket sayfalarina gecin."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={USER_ASSIGNMENTS_PATH}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {l("Open user assignments", "Kullanici atamalarini ac")}
            </Link>
            <Link
              to={WORKFLOW_PRESETS_PATH}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {l("Open workflow presets", "Workflow presetlerini ac")}
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryMetric
            label={l("Direct grants", "Dogrudan atamalar")}
            value={normalizedAssignments.length}
          />
          <SummaryMetric
            label={l("Assignees", "Atanan kullanicilar")}
            value={uniqueUserCount}
          />
          <SummaryMetric
            label={l("Related packages", "Ilgili paketler")}
            value={normalizedPackages.length}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <section
          ref={assignmentsSectionRef}
          className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Direct role assignments", "Dogrudan rol atamalari")}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "Direct user-to-role grants that currently point at this runtime role code.",
                  "Su anda bu runtime rol koduna isaret eden dogrudan kullanici-rol atamalari."
                )}
              </div>
            </div>
            {canReadRoleAssignments ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {l(
                  "{{active}} active / {{scopes}} scopes",
                  "{{active}} aktif / {{scopes}} kapsam",
                  { active: activeAssignmentCount, scopes: uniqueScopeCount }
                )}
              </span>
            ) : null}
          </div>

          {!canReadRoleAssignments ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
              {l(
                "Assignment visibility requires the role-assignment read permission. Use the Users & Assignments page if your access includes that surface.",
                "Atama gorunurlugu rol-atama okuma izni gerektirir. Erisiminiz bu yuzeyi kapsiyorsa Kullanicilar ve Atamalar sayfasini kullanin."
              )}
            </div>
          ) : null}

          {canReadRoleAssignments && normalizedAssignments.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {l(
                "No direct assignments were found for this role.",
                "Bu rol icin dogrudan atama bulunamadi."
              )}
            </div>
          ) : null}

          {canReadRoleAssignments && normalizedAssignments.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("User", "Kullanici")}</th>
                    <th className="px-4 py-3">{l("Scope", "Kapsam")}</th>
                    <th className="px-4 py-3">{l("Effect", "Etki")}</th>
                    <th className="px-4 py-3">{l("Status", "Durum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {normalizedAssignments.map((assignment) => {
                    const statusMeta = getStatusMeta(formatStatus(assignment), l);
                    return (
                      <tr
                        key={assignment?.id || `${assignment?.user_id}-${assignment?.scope_type}-${assignment?.scope_id}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-slate-900">
                            {normalizeText(assignment?.user_name) ||
                              l("Unknown user", "Bilinmeyen kullanici")}
                          </div>
                          {normalizeText(assignment?.user_email) ? (
                            <div className="mt-1 text-xs text-slate-500">
                              {assignment.user_email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700">
                          {formatScopeSummary(assignment)}
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700">
                          {normalizeText(assignment?.effect).toUpperCase() || "ALLOW"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section
          ref={packageMapSectionRef}
          className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {l("Package map", "Paket haritasi")}
          </div>
          <div className="mt-2 text-sm leading-6 text-slate-600">
            {l(
              "Workflow-preset context inferred from the selected runtime role. Use the package catalog when this role should stay aligned to a managed package.",
              "Secili runtime rolden cikarilan workflow-paket baglami. Bu rolun yonetilen bir paketle uyumlu kalmasi gerektiginde paket katalogunu kullanin."
            )}
          </div>

          {normalizedPackages.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              {l(
                "No workflow-package mapping was found for this role.",
                "Bu rol icin workflow-paket eslemesi bulunamadi."
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {normalizedPackages.map((pkg) => (
                <div
                  key={pkg.code}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="font-medium text-slate-900">{pkg.displayName}</div>
                  <div className="mt-1 text-xs text-slate-500">{pkg.code}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    {pkg.workflowFamilyLabel} / {normalizeText(pkg.defaultScope) || "-"} /{" "}
                    {l("{{count}} permissions", "{{count}} yetki", {
                      count: Number(pkg.permissionCount || 0),
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
            {l(
              "Direct runtime roles can still be granted without a package, but related package mappings are shown here when the catalog can explain them.",
              "Dogrudan runtime roller paket olmadan da atanabilir; ancak katalog bunlari aciklayabildiginde ilgili paket eslemeleri burada gosterilir."
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
