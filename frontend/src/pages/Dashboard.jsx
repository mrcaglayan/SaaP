import { useI18n } from "../i18n/useI18n.js";

export default function Dashboard() {
  const { t } = useI18n();

  return (
    <section className="h-full bg-slate-50 space-y-2">
      <h1 className="text-3xl font-semibold text-slate-900">{t("dashboard.title")}</h1>
      <p className="text-slate-600">{t("dashboard.subtitle")}</p>
    </section>
  );
}
