import { useCallback, useEffect, useMemo, useState } from "react";
import { getLegalEntityActivationReadiness } from "../api/legalEntityActivation.js";
import { useAuth } from "../auth/useAuth.js";
import { LegalEntityActivationContext } from "./legalEntityActivationContext.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeByLegalEntityRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      const legalEntityId = parsePositiveInt(row?.legalEntityId);
      if (!legalEntityId) {
        return null;
      }
      return {
        ...row,
        legalEntityId,
      };
    })
    .filter(Boolean);
}

function mergeByLegalEntityRows(currentRows, nextRows) {
  const merged = new Map();
  for (const row of normalizeByLegalEntityRows(currentRows)) {
    merged.set(row.legalEntityId, row);
  }
  for (const row of normalizeByLegalEntityRows(nextRows)) {
    merged.set(row.legalEntityId, row);
  }
  return Array.from(merged.values()).sort(
    (left, right) => left.legalEntityId - right.legalEntityId
  );
}

function mergeScopedActivationSnapshot(previous, next) {
  if (!next) {
    return previous || null;
  }
  if (!previous) {
    return next;
  }
  return {
    ...previous,
    ...next,
    byLegalEntity: mergeByLegalEntityRows(previous.byLegalEntity, next.byLegalEntity),
  };
}

/**
 * Loads the legal-entity activation readiness snapshot for the caller's
 * current visible scope and supports focused per-entity refreshes.
 */
export default function LegalEntityActivationProvider({ children }) {
  const { hasPermission, isAuthed } = useAuth();
  const canReadOrgTree = hasPermission("org.tree.read");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState(null);

  const refresh = useCallback(
    async (options = {}) => {
      if (!isAuthed || !canReadOrgTree) {
        setLoading(false);
        setError("");
        setReadiness(null);
        return null;
      }

      const legalEntityId = parsePositiveInt(options?.legalEntityId);
      const params = legalEntityId ? { legalEntityId } : {};

      setLoading(true);
      setError("");
      try {
        const data = (await getLegalEntityActivationReadiness(params)) || null;
        setReadiness((previous) =>
          legalEntityId
            ? mergeScopedActivationSnapshot(previous, data)
            : data
        );
        return data;
      } catch (err) {
        setError(
          err?.response?.data?.message ||
            err?.message ||
            "Failed to load legal-entity activation readiness."
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [canReadOrgTree, isAuthed]
  );

  const refreshLegalEntity = useCallback(
    async (legalEntityId) => refresh({ legalEntityId }),
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activationRowMap = useMemo(() => {
    const rowMap = new Map();
    for (const row of normalizeByLegalEntityRows(readiness?.byLegalEntity)) {
      rowMap.set(row.legalEntityId, row);
    }
    return rowMap;
  }, [readiness]);

  const getActivationRows = useCallback(
    () => normalizeByLegalEntityRows(readiness?.byLegalEntity),
    [readiness]
  );

  const getActivationRow = useCallback(
    (legalEntityId) => {
      const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
      if (!normalizedLegalEntityId) {
        return null;
      }
      return activationRowMap.get(normalizedLegalEntityId) || null;
    },
    [activationRowMap]
  );

  const value = useMemo(
    () => ({
      loading,
      error,
      readiness,
      readyEntityCount: getActivationRows().filter((row) => row.ready).length,
      incompleteEntityCount: getActivationRows().filter((row) => !row.ready).length,
      refresh,
      refreshLegalEntity,
      getActivationRows,
      getActivationRow,
    }),
    [
      error,
      getActivationRow,
      getActivationRows,
      loading,
      readiness,
      refresh,
      refreshLegalEntity,
    ]
  );

  return (
    <LegalEntityActivationContext.Provider value={value}>
      {children}
    </LegalEntityActivationContext.Provider>
  );
}
