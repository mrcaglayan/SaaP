import SecurityWarningList from "./SecurityWarningList.jsx";

/**
 * Renders validation warnings as a dedicated tab so replace-permissions
 * feedback is isolated from overview and editing concerns.
 */
export default function RoleWarningsTab({ l, warnings = [] }) {
  const normalizedWarnings = (Array.isArray(warnings) ? warnings : []).filter(Boolean);

  if (normalizedWarnings.length === 0) {
    return (
      <section className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-5 text-sm text-emerald-900 shadow-sm">
        <div className="font-semibold">
          {l("No active warnings", "Aktif uyari yok")}
        </div>
        <div className="mt-2 leading-6">
          {l(
            "Replace-permissions validation did not return any warnings for the current role state.",
            "Yetki degistirme dogrulamasi mevcut rol durumu icin herhangi bir uyari dondurmedi."
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <SecurityWarningList
        title={l("Permission rule warnings", "Yetki kural uyarilari")}
        warnings={normalizedWarnings}
        className="rounded-[28px] px-5 py-5 shadow-sm"
      />

      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {l("Review order", "Inceleme sirasi")}
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-600">
          {l(
            "Confirm the warning impact, then inspect scope posture, then return to permissions if the change is still appropriate.",
            "Uyarinin etkisini teyit edin, sonra kapsam durusunu inceleyin, degisiklik hala uygunsa yetkilere geri donun."
          )}
        </div>
      </section>
    </div>
  );
}
