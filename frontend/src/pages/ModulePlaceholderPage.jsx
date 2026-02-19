export default function ModulePlaceholderPage({ title, path }) {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">
        This module route is active, but the full screen and workflow are not
        implemented yet.
      </p>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Route: <span className="font-mono text-slate-800">{path}</span>
      </div>
    </div>
  );
}
