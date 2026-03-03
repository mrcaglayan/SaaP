import { useI18n } from "../i18n/useI18n.js";

export default function ModulePlaceholderPage({ title, path }) {
  const { t } = useI18n();
  const resolvedTitle = t(["sidebar", "byPath", path], title || t("modulePlaceholder.defaultTitle"));
  const isYearEndRoute =
    typeof path === "string" && path.startsWith("/app/donem-sonu-islemler/yillik");

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">{resolvedTitle}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {t("modulePlaceholder.description")}
      </p>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {t("modulePlaceholder.routeLabel")}{" "}
        <span className="font-mono text-slate-800">{path}</span>
      </div>
      {isYearEndRoute ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
          <h2 className="text-sm font-semibold text-amber-900">
            {t("modulePlaceholder.yearEndReminder.title")}
          </h2>
          <p className="mt-1 text-xs text-amber-900/90">
            {t("modulePlaceholder.yearEndReminder.description")}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>{t("modulePlaceholder.yearEndReminder.reclassDeferredRevenue")}</li>
            <li>{t("modulePlaceholder.yearEndReminder.reclassPrepaidExpense")}</li>
            <li>{t("modulePlaceholder.yearEndReminder.reclassAccruedRevenue")}</li>
            <li>{t("modulePlaceholder.yearEndReminder.reclassAccruedExpense")}</li>
            <li>{t("modulePlaceholder.yearEndReminder.closeAccruals")}</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
