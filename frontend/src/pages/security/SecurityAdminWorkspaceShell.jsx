import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import {
  SECURITY_ADMIN_COMPANION_LINKS,
  SECURITY_ADMIN_PRIMARY_SURFACES,
  SECURITY_ADMIN_WORKSPACE_SECTIONS,
} from "../../layouts/sidebarConfig.js";
import SecurityWorkbenchGuidancePanel from "./components/SecurityWorkbenchGuidancePanel.jsx";
import { resolveSecurityWorkbenchAccess } from "./components/workbenchNavigation.js";

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

const DEFAULT_WORKSPACE_GUIDANCE = Object.freeze({
  users: Object.freeze({
    eyebrow: Object.freeze({
      en: "Operating pattern",
      tr: "Calisma sekli",
    }),
    title: Object.freeze({
      en: "Keep one authority story in focus",
      tr: "Tek bir yetki hikayesini odakta tutun",
    }),
    description: Object.freeze({
      en: "Choose the person first, then move across sibling tabs to change the specific source behind that same effective authority.",
      tr: "Once kisiyi secin, sonra ayni etkili yetkinin arkasindaki belirli kaynagi degistirmek icin kardes sekmeler arasinda gecin.",
    }),
    items: Object.freeze([
      Object.freeze({
        title: Object.freeze({
          en: "Select the assignee first",
          tr: "Once atanani secin",
        }),
        description: Object.freeze({
          en: "People selection should stay stable while you compare assignments, scopes, delegations, and effective authority.",
          tr: "Atamalar, kapsamlar, delegasyonlar ve etkili yetkiyi karsilastirirken kisi secimi sabit kalmalidir.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Change the source, not only the symptom",
          tr: "Yalnizca semptomu degil, kaynagi degistirin",
        }),
        description: Object.freeze({
          en: "Use sibling tabs to reach the exact source of access instead of reopening separate products.",
          tr: "Ayrica urunler acmak yerine erisimin tam kaynagina ulasmak icin kardes sekmeleri kullanin.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Keep local user admin separate",
          tr: "Yerel kullanici yonetimini ayri tutun",
        }),
        description: Object.freeze({
          en: "Branch-operator administration remains a companion route in phase 1 and should not be confused with the workbench tabs.",
          tr: "Sube operatoru yonetimi faz 1'de companion rota olarak kalir ve workbench sekmeleriyle karistirilmamalidir.",
        }),
      }),
    ]),
    tone: "sky",
    footer: Object.freeze({
      en: "Use the companion links for adjacent tools that still stay outside the users workbench in this phase.",
      tr: "Bu fazda users workbench disinda kalan bitisik araclar icin companion baglantilarini kullanin.",
    }),
  }),
  catalog: Object.freeze({
    eyebrow: Object.freeze({
      en: "Catalog reading guide",
      tr: "Katalog okuma rehberi",
    }),
    title: Object.freeze({
      en: "Browse objects before editing them",
      tr: "Nesneleri duzenlemeden once inceleyin",
    }),
    description: Object.freeze({
      en: "Stay in business-language catalog views first, then use details or compare mode only when you need finer policy inspection.",
      tr: "Once is diliyle katalog gorunumlerinde kalin; daha ince politika incelemesi gerektiginde ayrinti veya karsilastirma moduna gecin.",
    }),
    items: Object.freeze([
      Object.freeze({
        title: Object.freeze({
          en: "Start with object hierarchy",
          tr: "Nesne hiyerarsisi ile baslayin",
        }),
        description: Object.freeze({
          en: "Business roles, workflow packages, and presets should remain readable as distinct catalog objects.",
          tr: "Is rolleri, workflow paketleri ve presetler ayri katalog nesneleri olarak okunabilir kalmalidir.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Use compare mode sparingly",
          tr: "Karsilastirma modunu olculu kullanin",
        }),
        description: Object.freeze({
          en: "The matrix is for side-by-side inspection, not the default reading flow.",
          tr: "Matris yan yana inceleme icindir; varsayilan okuma akisi degildir.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Follow the usage path",
          tr: "Kullanim yolunu takip edin",
        }),
        description: Object.freeze({
          en: "When you need to answer where something is used, jump from catalog definition into workflow or user workbenches.",
          tr: "Bir seyin nerede kullanildigini cevaplamak gerektiginde katalog tanimindan workflow veya kullanici workbench'lerine atlayin.",
        }),
      }),
    ]),
    tone: "violet",
    footer: Object.freeze({
      en: "Companion routes stay available for adjacent policies and extensions while the long-term workbench split settles.",
      tr: "Uzun vadeli workbench ayirimi netlesirken bitisik politikalar ve uzantilar icin companion rotalar kullanilmaya devam eder.",
    }),
  }),
  workflows: Object.freeze({
    eyebrow: Object.freeze({
      en: "Governance pattern",
      tr: "Yonetisim deseni",
    }),
    title: Object.freeze({
      en: "Inspect before you edit",
      tr: "Duzenlemeden once inceleyin",
    }),
    description: Object.freeze({
      en: "Definitions, assignments, coverage, and records should be inspectable first, with the setup wizard kept as a deliberate edit path.",
      tr: "Tanimlar, atamalar, coverage ve kayitlar once incelenebilir olmali; setup sihirbazi ise bilincli bir duzenleme yolu olarak kalmalidir.",
    }),
    items: Object.freeze([
      Object.freeze({
        title: Object.freeze({
          en: "Land on steady-state surfaces",
          tr: "Kalici yuzeylerde acilis yapin",
        }),
        description: Object.freeze({
          en: "Use definitions, assignments, and records as the default operating tabs for admins.",
          tr: "Yoneticiler icin varsayilan isletim sekmeleri olarak tanimlar, atamalar ve kayitlari kullanin.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Treat coverage as evidence",
          tr: "Coverage'i kanit gibi ele alin",
        }),
        description: Object.freeze({
          en: "Coverage diagnostics explain who is still missing authority and which scope gaps remain.",
          tr: "Coverage tanilari kimin halen yetkisiz oldugunu ve hangi kapsam bosluklarinin kaldigini aciklar.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Use setup for intentional change",
          tr: "Setup'i bilincli degisim icin kullanin",
        }),
        description: Object.freeze({
          en: "Drop into the wizard only when you are creating or editing a specific workflow package.",
          tr: "Sihirbaza yalnizca belirli bir workflow paketini olustururken veya duzenlerken girin.",
        }),
      }),
    ]),
    tone: "emerald",
    footer: Object.freeze({
      en: "Use the companion routes to jump into users or catalog context when governance changes require those adjacent domains.",
      tr: "Yonetisim degisiklikleri bitisik alanlari gerektirdiginde companion rotalari kullanarak kullanici veya katalog baglamina atlayin.",
    }),
  }),
  diagnostics: Object.freeze({
    eyebrow: Object.freeze({
      en: "Investigation pattern",
      tr: "Inceleme deseni",
    }),
    title: Object.freeze({
      en: "Explain first, prove second",
      tr: "Once aciklayin, sonra kanitlayin",
    }),
    description: Object.freeze({
      en: "Start from access explainability, then move into audit evidence only as deep as the question requires.",
      tr: "Once erisim aciklanabilirliginden baslayin; sonra soru gerektirdigi kadar derine inerek denetim kanitlarina gecin.",
    }),
    items: Object.freeze([
      Object.freeze({
        title: Object.freeze({
          en: "Narrow the actor and scope",
          tr: "Aktoru ve kapsami daraltin",
        }),
        description: Object.freeze({
          en: "Keep the same user and scope story in mind as you move from explainability into audit tabs.",
          tr: "Aciklanabilirlikten denetim sekmelerine gecerken ayni kullanici ve kapsam hikayesini akilda tutun.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Use RBAC audit for structured evidence",
          tr: "Yapilandirilmis kanit icin RBAC denetimini kullanin",
        }),
        description: Object.freeze({
          en: "RBAC audit logs answer who changed what with actor, target, and scope context already shaped for review.",
          tr: "RBAC denetim loglari inceleme icin hazir aktor, hedef ve kapsam baglamiyla kimin neyi degistirdigini aciklar.",
        }),
      }),
      Object.freeze({
        title: Object.freeze({
          en: "Use raw and sensitive-data tabs for proof",
          tr: "Kanit icin ham ve hassas-veri sekmelerini kullanin",
        }),
        description: Object.freeze({
          en: "Drop into raw payloads or sensitive-data traces only when you need technical evidence beyond the summarized explanation.",
          tr: "Ozetlenmis aciklamanin otesinde teknik kanita ihtiyac oldugunda ham payload veya hassas-veri izlerine inin.",
        }),
      }),
    ]),
    tone: "amber",
    footer: Object.freeze({
      en: "Companion links keep adjacent evidence surfaces reachable while filters and deep-link state stabilize across the investigation family.",
      tr: "Filtreler ve derin-baglanti durumu inceleme ailesi genelinde otururken companion baglantilari bitisik kanit yuzeylerini ulasilabilir tutar.",
    }),
  }),
});

function matchesWorkspaceSection(section, workspaceSectionKey) {
  const normalizedWorkspaceSectionKey = String(workspaceSectionKey || "").trim();
  if (!normalizedWorkspaceSectionKey) {
    return false;
  }
  if (section?.key === normalizedWorkspaceSectionKey) {
    return true;
  }
  return Array.isArray(section?.currentSectionKeys)
    ? section.currentSectionKeys.includes(normalizedWorkspaceSectionKey)
    : false;
}

function resolveLocalizedValue(value, l) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return l(value.en, value.tr);
  }
  return "";
}

function resolveGuidanceConfig(guidance, workspaceSectionKey, l) {
  const config = guidance || DEFAULT_WORKSPACE_GUIDANCE[workspaceSectionKey] || null;
  if (!config) {
    return null;
  }

  return {
    eyebrow: resolveLocalizedValue(config.eyebrow, l),
    title: resolveLocalizedValue(config.title, l),
    description: resolveLocalizedValue(config.description, l),
    items: Array.isArray(config.items)
      ? config.items.map((item) => ({
          title: resolveLocalizedValue(item.title, l),
          description: resolveLocalizedValue(item.description, l),
        }))
      : [],
    footer: resolveLocalizedValue(config.footer, l),
    tone: config.tone || "slate",
  };
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

function WorkspaceNavItem({ active, item, locked, l, title = "" }) {
  const classes = `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
  }`;

  if (locked) {
    return (
      <span
        title={title}
        className={`${classes} cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white`}
      >
        {l(item.label.en, item.label.tr)}
      </span>
    );
  }

  return (
    <Link to={item.to} className={classes}>
      {l(item.label.en, item.label.tr)}
    </Link>
  );
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
 * Provides the shared security-admin shell so workbench pages keep the same
 * framing, summary strip, tab rail, guidance panel, and permission-aware
 * navigation grammar throughout the redesign track.
 */
export default function SecurityAdminWorkspaceShell({
  workspaceSectionKey = "",
  sectionKey = "",
  eyebrow = "",
  title = "",
  description = "",
  actions = [],
  stats = [],
  toolbar = null,
  guidance = null,
  children,
}) {
  const { l } = useI18n();
  const { hasAnyFeature, hasAnyPermission } = useAuth();

  const workspaceSections = SECURITY_ADMIN_WORKSPACE_SECTIONS.map((section) => ({
    ...section,
    access: resolveSecurityWorkbenchAccess(
      section,
      hasAnyPermission,
      hasAnyFeature
    ),
  })).filter((section) => section.access.visible);

  const primarySurfaces = SECURITY_ADMIN_PRIMARY_SURFACES.map((surface) => ({
    ...surface,
    access: resolveSecurityWorkbenchAccess(
      surface,
      hasAnyPermission,
      hasAnyFeature
    ),
  })).filter((surface) => surface.access.visible);

  const currentWorkspaceSection = workspaceSections.find((section) =>
    matchesWorkspaceSection(section, workspaceSectionKey)
  ) || null;

  const currentCompanionLinks = currentWorkspaceSection
    ? SECURITY_ADMIN_COMPANION_LINKS.filter(
        (item) => item.workspaceSectionKey === currentWorkspaceSection.key
      )
        .map((item) => ({
          ...item,
          access: resolveSecurityWorkbenchAccess(
            item,
            hasAnyPermission,
            hasAnyFeature
          ),
        }))
        .filter((item) => item.access.visible)
        .map((item) => ({
          label: l(item.label.en, item.label.tr),
          to: item.to,
          locked: item.access.locked,
          title: item.access.locked
            ? `${l("Permission required", "Izin gerekli")}: ${item.access.requiredPermissions.join(", ")}`
            : "",
        }))
    : [];

  const resolvedGuidance = resolveGuidanceConfig(guidance, workspaceSectionKey, l);
  const hasGuidancePanel =
    Boolean(resolvedGuidance) || currentCompanionLinks.length > 0;

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
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "Use the canonical workbench routes while the page bodies are still landing in stages.",
                  "Sayfa govdeleri asamali gelirken canonical workbench rotalarini kullanin."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {workspaceSections.map((section) => (
                  <WorkspaceNavItem
                    key={section.key}
                    active={matchesWorkspaceSection(section, workspaceSectionKey)}
                    item={{
                      ...section,
                      to: `${section.futurePath}${section.defaultSearch || ""}`,
                    }}
                    locked={section.access.locked}
                    l={l}
                    title={
                      section.access.locked
                        ? `${l("Permission required", "Izin gerekli")}: ${section.access.requiredPermissions.join(", ")}`
                        : ""
                    }
                  />
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Primary surfaces", "Birincil yuzeyler")}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "These quick links already use the canonical workbench routes even where the body still delegates to current pages.",
                  "Govde halen mevcut sayfalara delegasyon yapsa bile bu hizli baglantilar canonical workbench rotalarini kullanir."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {primarySurfaces.map((surface) => (
                  <WorkspaceNavItem
                    key={surface.key}
                    active={surface.key === sectionKey}
                    item={surface}
                    locked={surface.access.locked}
                    l={l}
                    title={
                      surface.access.locked
                        ? `${l("Permission required", "Izin gerekli")}: ${surface.access.requiredPermissions.join(", ")}`
                        : ""
                    }
                  />
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

      {toolbar || hasGuidancePanel ? (
        <section
          className={
            toolbar && hasGuidancePanel
              ? "grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_360px]"
              : "space-y-4"
          }
        >
          {toolbar ? <div className="space-y-4">{toolbar}</div> : null}
          {hasGuidancePanel ? (
            <SecurityWorkbenchGuidancePanel
              eyebrow={
                resolvedGuidance?.eyebrow ||
                l("Workbench guidance", "Workbench rehberi")
              }
              title={
                resolvedGuidance?.title ||
                l("Companion routes", "Companion rotalari")
              }
              description={resolvedGuidance?.description || ""}
              items={resolvedGuidance?.items || []}
              linksTitle={l("Companion routes", "Companion rotalari")}
              links={currentCompanionLinks}
              footer={resolvedGuidance?.footer || ""}
              tone={resolvedGuidance?.tone || "slate"}
            />
          ) : null}
        </section>
      ) : null}

      <div className="space-y-6">{children}</div>
    </div>
  );
}
