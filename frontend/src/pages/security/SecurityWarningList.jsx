/**
 * Renders structured admin warnings returned by role/assignment validation flows.
 */
export default function SecurityWarningList({
  title = "Review before saving",
  warnings = [],
  className = "",
}) {
  const normalizedWarnings = (Array.isArray(warnings) ? warnings : [])
    .map((warning) =>
      typeof warning === "string"
        ? warning
        : String(warning?.message || warning?.reason || "").trim()
    )
    .filter(Boolean);

  if (normalizedWarnings.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="font-semibold">{title}</div>
      <ul className="mt-2 space-y-1">
        {normalizedWarnings.map((warning) => (
          <li key={warning}>- {warning}</li>
        ))}
      </ul>
    </div>
  );
}
