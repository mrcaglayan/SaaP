import RoleListRow from "./RoleListRow.jsx";
import { getRoleCatalogEntry } from "./roleCatalog.js";

export default function RoleListTable({ group, l, onOpenRole }) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {group.label}
        </div>
        <div className="text-xs font-semibold text-slate-400">{group.roles.length}</div>
      </div>

      <div className="grid grid-cols-[minmax(360px,2.25fr)_minmax(240px,1.15fr)_170px_160px_110px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <div>Role</div>
        <div>Workflow family</div>
        <div>Scope</div>
        <div>Type</div>
        <div className="text-right">State</div>
      </div>

      <div>
        {group.roles.map((role) => (
          <RoleListRow
            key={role.id}
            entry={getRoleCatalogEntry(role)}
            l={l}
            onOpenRole={() => onOpenRole(role.id)}
            role={role}
          />
        ))}
      </div>
    </section>
  );
}
