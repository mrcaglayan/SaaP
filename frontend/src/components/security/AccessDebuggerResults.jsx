import { useI18n } from "../../i18n/useI18n.js";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function formatScope(scope) {
  if (!scope?.scopeType || !scope?.scopeId) {
    return "";
  }
  return `${scope.scopeType} #${scope.scopeId}`;
}

function formatNullable(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function serializeDetails(value) {
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildRecommendationLines(result, t) {
  const recommendations = [];
  const requestedPermission = String(result?.requested?.permissionCode || "").trim();
  const requestedScope = result?.requested?.scope || null;
  const layers = result?.layers || {};

  if (layers.capability?.status === "FAIL" && requestedPermission) {
    recommendations.push(
      t("accessDebugger.recommendations.missingPermission", {
        permission: requestedPermission,
      })
    );
  }

  if (layers.scopeEntitlement?.status === "FAIL" && requestedScope) {
    recommendations.push(
      t("accessDebugger.recommendations.scopeDenied", {
        scopeType: requestedScope.scopeType,
        scopeId: requestedScope.scopeId,
      })
    );
  }

  if (layers.visibilityPolicy?.status === "FAIL") {
    recommendations.push(t("accessDebugger.recommendations.visibilityDenied"));
  }

  const fieldOverridePermission =
    layers.fieldVisibility?.details?.policy?.requiredPermissionCode || "";
  if (layers.fieldVisibility?.status === "FAIL" && fieldOverridePermission) {
    recommendations.push(
      t("accessDebugger.recommendations.fieldVisibility", {
        permission: fieldOverridePermission,
      })
    );
  }

  if (layers.sod?.status === "FAIL") {
    recommendations.push(t("accessDebugger.recommendations.sod"));
  }

  if (layers.workflow?.status === "FAIL") {
    recommendations.push(t("accessDebugger.recommendations.workflow"));
  }

  if (layers.businessState?.status === "FAIL") {
    recommendations.push(
      layers.businessState?.message || t("accessDebugger.recommendations.businessState")
    );
  }

  if (result?.entitlements?.isVisibilityNarrowed) {
    recommendations.push(t("accessDebugger.recommendations.visibilityNarrowed"));
  }

  return Array.from(new Set(recommendations.filter(Boolean)));
}

function getStatusBadgeClasses(status) {
  if (status === "PASS") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "FAIL") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "SKIPPED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function LayerStatusBadge({ status }) {
  return (
    <span
      className={joinClassNames(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        getStatusBadgeClasses(status)
      )}
    >
      {status}
    </span>
  );
}

function LayerCard({ label, layer, technicalDetailsLabel }) {
  const blockers = Array.isArray(layer?.blockers) ? layer.blockers : [];
  const serializedDetails = serializeDetails(layer?.details);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <LayerStatusBadge status={layer?.status || "NOT_APPLICABLE"} />
      </div>
      <p className="mt-2 text-sm text-slate-700">
        {layer?.message || "-"}
      </p>
      {blockers.length > 0 ? (
        <ul className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          {blockers.map((blocker, index) => (
            <li key={`${label}-${blocker?.code || index}`}>
              {blocker?.message || blocker?.code || "-"}
            </li>
          ))}
        </ul>
      ) : null}
      {serializedDetails ? (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            {technicalDetailsLabel}
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-700">
            {serializedDetails}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Renders one explainable access-check result in a readable layered format for
 * both end-user self-service and admin troubleshooting.
 */
export default function AccessDebuggerResults({
  result,
  targetUserLabel = "",
}) {
  const { t } = useI18n();

  if (!result || typeof result !== "object") {
    return null;
  }

  const requested = result?.requested || {};
  const entitlements = result?.entitlements || {};
  const decision = result?.decision || {};
  const layers = result?.layers || {};
  const recommendations = buildRecommendationLines(result, t);
  const layerEntries = [
    ["capability", t("accessDebugger.layers.capability")],
    ["scopeEntitlement", t("accessDebugger.layers.scopeEntitlement")],
    ["visibilityPolicy", t("accessDebugger.layers.visibilityPolicy")],
    ["sod", t("accessDebugger.layers.sod")],
    ["workflow", t("accessDebugger.layers.workflow")],
    ["businessState", t("accessDebugger.layers.businessState")],
    ["fieldVisibility", t("accessDebugger.layers.fieldVisibility")],
  ];

  return (
    <div className="space-y-4">
      <section
        className={joinClassNames(
          "rounded-2xl border px-4 py-4",
          decision?.allowed
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {decision?.allowed
                ? t("accessDebugger.summary.allowed")
                : t("accessDebugger.summary.denied")}
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              {result?.selfCheck
                ? t("accessDebugger.summary.selfCheck")
                : t("accessDebugger.summary.adminCheck")}
            </p>
          </div>
          <LayerStatusBadge status={decision?.status || "NOT_APPLICABLE"} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("accessDebugger.summary.permission")}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {formatNullable(requested.permissionCode, t("accessDebugger.summary.notProvided"))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("accessDebugger.summary.scope")}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {formatNullable(formatScope(requested.scope), t("accessDebugger.summary.notProvided"))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("accessDebugger.summary.targetUser")}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {formatNullable(
                targetUserLabel || (result?.targetUserId ? `#${result.targetUserId}` : ""),
                t("accessDebugger.summary.notProvided")
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("accessDebugger.summary.visibilityNarrowed")}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {entitlements?.isVisibilityNarrowed ? t("accessDebugger.labels.yes") : t("accessDebugger.labels.no")}
            </div>
          </div>
        </div>

        {Array.isArray(entitlements?.maskedFields) && entitlements.maskedFields.length > 0 ? (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("accessDebugger.summary.maskedFields")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {entitlements.maskedFields.map((fieldName) => (
                <span
                  key={fieldName}
                  className="inline-flex rounded-full border border-amber-300 bg-white/70 px-2.5 py-1 text-xs font-medium text-amber-800"
                >
                  {fieldName}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {recommendations.length > 0 ? (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
          <div className="font-semibold">{t("accessDebugger.summary.recommendations")}</div>
          <ul className="mt-2 space-y-1">
            {recommendations.map((recommendation) => (
              <li key={recommendation}>- {recommendation}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="text-sm font-semibold text-slate-800">
          {t("accessDebugger.summary.layers")}
        </div>
        {layerEntries.map(([layerKey, label]) => (
          <LayerCard
            key={layerKey}
            label={label}
            layer={layers[layerKey] || null}
            technicalDetailsLabel={t("accessDebugger.summary.technicalDetails")}
          />
        ))}
      </section>
    </div>
  );
}
