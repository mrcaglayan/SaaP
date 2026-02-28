import { useCallback, useMemo } from "react";
import { useLocalStorageState } from "./useLocalStorageState.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildStorageKey(scopeKey) {
  const normalized = String(scopeKey || "").trim() || "default";
  return `table-prefs.${normalized}.v1`;
}

function buildDefaultPrefs(defaultValue, columnIds) {
  const defaults = defaultValue && typeof defaultValue === "object" ? defaultValue : {};
  const fallbackColumnIds = uniqueStrings(columnIds);
  const defaultVisibleColumns = uniqueStrings(defaults.visibleColumnIds);
  return {
    rowsPerPage: toPositiveInt(defaults.rowsPerPage) || 50,
    stickyHeader: Boolean(defaults.stickyHeader),
    visibleColumnIds:
      defaultVisibleColumns.length > 0 ? defaultVisibleColumns : fallbackColumnIds,
  };
}

function sanitizePrefs(rawValue, defaultPrefs, validColumnIds) {
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const validIds = uniqueStrings(validColumnIds);
  const preferredVisibleIds = uniqueStrings(raw.visibleColumnIds).filter((id) =>
    validIds.includes(id)
  );
  const defaultVisibleIds = uniqueStrings(defaultPrefs.visibleColumnIds).filter((id) =>
    validIds.includes(id)
  );
  const visibleColumnIds =
    preferredVisibleIds.length > 0
      ? preferredVisibleIds
      : defaultVisibleIds.length > 0
      ? defaultVisibleIds
      : validIds;

  return {
    rowsPerPage: toPositiveInt(raw.rowsPerPage) || defaultPrefs.rowsPerPage,
    stickyHeader:
      raw.stickyHeader === undefined
        ? defaultPrefs.stickyHeader
        : Boolean(raw.stickyHeader),
    visibleColumnIds,
  };
}

export function usePersistedTablePrefs(scopeKey, defaultValue, columnIds = []) {
  const safeColumnIds = useMemo(() => uniqueStrings(columnIds), [columnIds]);
  const defaultPrefs = useMemo(
    () => buildDefaultPrefs(defaultValue, safeColumnIds),
    [defaultValue, safeColumnIds]
  );
  const storageKey = useMemo(() => buildStorageKey(scopeKey), [scopeKey]);
  const [storedPrefs, setStoredPrefs, clearStoredPrefs] = useLocalStorageState(
    storageKey,
    defaultPrefs
  );

  const prefs = useMemo(
    () => sanitizePrefs(storedPrefs, defaultPrefs, safeColumnIds),
    [defaultPrefs, safeColumnIds, storedPrefs]
  );

  const setPrefs = useCallback(
    (nextValue) => {
      setStoredPrefs((previousValue) => {
        const previousSanitized = sanitizePrefs(
          previousValue,
          defaultPrefs,
          safeColumnIds
        );
        const candidateValue =
          typeof nextValue === "function"
            ? nextValue(previousSanitized)
            : nextValue;
        return sanitizePrefs(candidateValue, defaultPrefs, safeColumnIds);
      });
    },
    [defaultPrefs, safeColumnIds, setStoredPrefs]
  );

  const resetPrefs = useCallback(
    (nextValue) => {
      const candidateValue = nextValue === undefined ? defaultPrefs : nextValue;
      const sanitized = sanitizePrefs(candidateValue, defaultPrefs, safeColumnIds);
      return clearStoredPrefs(sanitized);
    },
    [clearStoredPrefs, defaultPrefs, safeColumnIds]
  );

  return [prefs, setPrefs, resetPrefs];
}
