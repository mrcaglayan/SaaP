function resolveColumnHeader(column) {
  if (!column || typeof column !== "object") {
    return "";
  }
  return String(column.header || column.key || "").trim();
}

function resolveColumnValue(row, column) {
  if (!column || typeof column !== "object") {
    return "";
  }
  if (typeof column.value === "function") {
    return column.value(row);
  }
  if (typeof column.key === "string" && column.key) {
    return row?.[column.key];
  }
  return "";
}

function encodeCsvCell(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function buildCsvLine(values) {
  return values.map((value) => encodeCsvCell(value)).join(",");
}

export function buildCsvString(rows = [], columns = [], options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = Array.isArray(columns) ? columns : [];
  const includeHeader = options.includeHeader !== false;
  const lineEnding = String(options.lineEnding || "\r\n");

  const lines = [];
  if (includeHeader) {
    lines.push(buildCsvLine(safeColumns.map((column) => resolveColumnHeader(column))));
  }
  for (const row of safeRows) {
    lines.push(
      buildCsvLine(safeColumns.map((column) => resolveColumnValue(row, column)))
    );
  }
  return lines.join(lineEnding);
}

export function sanitizeCsvFileName(fileName, fallback = "export") {
  const base = String(fileName || "").trim() || String(fallback || "").trim() || "export";
  const withoutControlChars = Array.from(base, (char) =>
    char.charCodeAt(0) <= 31 ? "-" : char
  ).join("");
  const collapsed = withoutControlChars
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safeBase = collapsed || "export";
  if (safeBase.toLowerCase().endsWith(".csv")) {
    return safeBase;
  }
  return `${safeBase}.csv`;
}

export function triggerBlobDownload(blob, fileName) {
  if (
    !(blob instanceof Blob) ||
    typeof window === "undefined" ||
    !window.URL ||
    typeof document === "undefined" ||
    !document.body
  ) {
    return false;
  }
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = sanitizeCsvFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
  return true;
}

export function exportRowsAsCsv({ rows = [], columns = [], fileName = "export.csv" } = {}) {
  const csvBody = buildCsvString(rows, columns);
  const blob = new Blob([`\uFEFF${csvBody}`], { type: "text/csv;charset=utf-8" });
  return triggerBlobDownload(blob, fileName);
}
