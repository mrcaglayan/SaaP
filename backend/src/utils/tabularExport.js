function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Build one RFC-4180-friendly CSV string from column metadata and row objects.
 */
export function buildCsv(columns, rows) {
  const normalizedColumns = Array.isArray(columns) ? columns : [];
  const normalizedRows = Array.isArray(rows) ? rows : [];

  const header = normalizedColumns
    .map((column) => escapeCsvCell(column?.header))
    .join(",");
  const body = normalizedRows.map((row) =>
    normalizedColumns
      .map((column) => escapeCsvCell(column?.value ? column.value(row) : ""))
      .join(",")
  );

  return [header, ...body].join("\n");
}

export default {
  buildCsv,
};
