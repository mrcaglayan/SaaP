function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function TablePreferencesPanel({
  title = "Table Preferences",
  rowsPerPage = 50,
  rowsPerPageOptions = [25, 50, 100, 200],
  onRowsPerPageChange,
  stickyHeader = false,
  onStickyHeaderChange,
  columns = [],
  visibleColumnIds = [],
  onToggleColumn,
  onSelectAllColumns,
  onReset,
  className = "",
}) {
  const options = Array.isArray(rowsPerPageOptions)
    ? rowsPerPageOptions
        .map((value) => toPositiveInt(value))
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .sort((a, b) => a - b)
    : [25, 50, 100, 200];
  const visibleSet = new Set(Array.isArray(visibleColumnIds) ? visibleColumnIds : []);
  const visibleCount = columns.reduce(
    (count, column) => (visibleSet.has(column.id) ? count + 1 : count),
    0
  );

  return (
    <details
      className={`rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 ${className}`.trim()}
    >
      <summary className="cursor-pointer select-none font-semibold text-slate-800">
        {title}
      </summary>
      <div className="mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1"
              value={rowsPerPage}
              onChange={(event) => onRowsPerPageChange?.(event.target.value)}
            >
              {options.map((optionValue) => (
                <option key={`rows-per-page-${optionValue}`} value={optionValue}>
                  {optionValue}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(stickyHeader)}
              onChange={(event) => onStickyHeaderChange?.(event.target.checked)}
            />
            Sticky header
          </label>

          <span className="text-slate-500">
            Columns: {visibleCount}/{columns.length}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => onSelectAllColumns?.()}
          >
            Select all columns
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => onReset?.()}
          >
            Reset table prefs
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {columns.map((column) => (
            <label
              key={`table-pref-column-${column.id}`}
              className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1"
            >
              <input
                type="checkbox"
                checked={visibleSet.has(column.id)}
                onChange={() => onToggleColumn?.(column.id)}
              />
              <span>{column.label || column.id}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
