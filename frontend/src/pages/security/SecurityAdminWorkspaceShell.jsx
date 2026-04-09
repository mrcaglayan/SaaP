import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/useI18n.js";

const PRIMARY_WORKSPACE_SECTIONS = Object.freeze([
  Object.freeze({
    key: "access-model",
    to: "/app/ayarlar/rbac/access-model",
    label: Object.freeze({
      en: "Catalog",
      tr: "Katalog",
    }),
  }),
  Object.freeze({
    key: "roles-permissions",
    to: "/app/ayarlar/rbac/roles-permissions",
    label: Object.freeze({
      en: "Roles & permissions",
      tr: "Roller ve yetkiler",
    }),
  }),
  Object.freeze({
    key: "user-assignments",
    to: "/app/ayarlar/rbac/user-assignments",
    label: Object.freeze({
      en: "Assignments",
      tr: "Atamalar",
    }),
  }),
]);

const COMPANION_WORKSPACE_LINKS = Object.freeze([
  Object.freeze({
    to: "/app/ayarlar/sube-operatorleri",
    label: Object.freeze({
      en: "Local user management",
      tr: "Yerel kullanici yonetimi",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/scope-assignments",
    label: Object.freeze({
      en: "Scope assignments",
      tr: "Scope atamalari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/field-visibility-policies",
    label: Object.freeze({
      en: "Field visibility policies",
      tr: "Alan gorunurluk politikalari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/role-migrations",
    label: Object.freeze({
      en: "Role migrations",
      tr: "Rol gecisleri",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/delegations",
    label: Object.freeze({
      en: "Approval delegations",
      tr: "Onay delegasyonlari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/temporary-coverage",
    label: Object.freeze({
      en: "Temporary coverage",
      tr: "Gecici operasyonel kapsama",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/access-debugger",
    label: Object.freeze({
      en: "Access debugger",
      tr: "Erisim tanilari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/legacy-migration-visibility",
    label: Object.freeze({
      en: "Legacy migration visibility",
      tr: "Eski rol gecis gorunumu",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/group-ap-post-extension",
    label: Object.freeze({
      en: "Group AP post extension",
      tr: "Grup AP kaydi uzantisi",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/compliance-reports",
    label: Object.freeze({
      en: "Compliance reports",
      tr: "Uyum raporlari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/audit-logs",
    label: Object.freeze({
      en: "RBAC audit logs",
      tr: "RBAC denetim loglari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/raw-audit-logs",
    label: Object.freeze({
      en: "Raw audit logs",
      tr: "Ham denetim loglari",
    }),
  }),
  Object.freeze({
    to: "/app/ayarlar/rbac/sensitive-data-audit",
    label: Object.freeze({
      en: "Sensitive data audit",
      tr: "Hassas veri denetimi",
    }),
  }),
]);

function getActionClasses(tone) {
  if (tone === "primary") {
    return "border-slate-900 bg-slate-900 text-white";
  }
  return "border-slate-300 bg-white text-slate-700";
}

function getStatClasses(tone) {
  if (tone === "blue") {
    return "border-sky-200 bg-sky-50";
  }
  if (tone === "green") {
    return "border-emerald-200 bg-emerald-50";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50";
  }
  if (tone === "violet") {
    return "border-violet-200 bg-violet-50";
  }
  return "border-slate-200 bg-white";
}

function WorkspaceAction({ action }) {
  const classes = `rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${getActionClasses(
    action?.tone
  )}`;

  if (typeof action?.onClick === "function") {
    return (
      <button
        type="button"
        onClick={action.onClick}
        className={classes}
        disabled={Boolean(action?.disabled)}
      >
        {action?.label}
      </button>
    );
  }

  if (action?.to) {
    return (
      <Link to={action.to} className={classes}>
        {action?.label}
      </Link>
    );
  }

  return null;
}

function WorkspaceStatCard({ stat }) {
  return (
    <article
      className={`rounded-[24px] border px-5 py-4 shadow-sm ${getStatClasses(
        stat?.tone
      )}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {stat?.title}
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{stat?.value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{stat?.description}</div>
    </article>
  );
}

/**
 * Provides one shared shell for the primary security-admin surfaces so the
 * catalog, role editor, and assignment workspace keep consistent navigation,
 * summary framing, and companion-tool reachability during the redesign.
 */
export default function SecurityAdminWorkspaceShell({
  sectionKey = "",
  eyebrow = "",
  title = "",
  description = "",
  actions = [],
  stats = [],
  toolbar = null,
  children,
}) {
  const { l } = useI18n();

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_45%),radial-gradient(circle_at_top_right,#dcfce7,transparent_35%),linear-gradient(135deg,#f8fafc,#ffffff)] px-6 py-6">
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                {eyebrow || l("Security Admin Workspace", "Guvenlik yonetim calisma alani")}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
            </div>
            {Array.isArray(actions) && actions.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {actions.map((action) => (
                  <WorkspaceAction
                    key={`${String(action?.label || "")}:${String(action?.to || "")}`}
                    action={action}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative z-10 mt-6 grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Workspace sections", "Calisma alani bolumleri")}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIMARY_WORKSPACE_SECTIONS.map((section) => {
                  const active = section.key === sectionKey;
                  return (
                    <Link
                      key={section.key}
                      to={section.to}
                      className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {l(section.label.en, section.label.tr)}
                    </Link>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Companion tools", "Eslik eden araclar")}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "Keep migration, audit, delegation, and diagnostics surfaces reachable while the primary shell is being cleaned up.",
                  "Birincil kabuk sadeleştirilirken gecis, denetim, delegasyon ve tanilama yuzeyleri erisilebilir kalsin."
                )}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {COMPANION_WORKSPACE_LINKS.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {l(link.label.en, link.label.tr)}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>

      {Array.isArray(stats) && stats.length > 0 ? (
        <section
          className={`grid gap-4 ${
            stats.length >= 4
              ? "xl:grid-cols-4"
              : stats.length === 3
                ? "xl:grid-cols-3"
                : "xl:grid-cols-2"
          }`}
        >
          {stats.map((stat) => (
            <WorkspaceStatCard
              key={`${String(stat?.title || "")}:${String(stat?.value || "")}`}
              stat={stat}
            />
          ))}
        </section>
      ) : null}

      {toolbar ? <section className="space-y-4">{toolbar}</section> : null}

      <div className="space-y-6">{children}</div>
    </div>
  );
}
