import { useCallback, useEffect, useState } from "react";
import {
  getCariDocumentOpsStatus,
  upsertCariDocumentOpsStatus,
} from "../../../api/cariDocuments.js";
import { useAuth } from "../../../auth/useAuth.js";
import { normalizeApiError, toPositiveInt } from "../cariDocumentsPageHelpers.js";

/**
 * Owns ops-status loading and save state for the selected document snapshot.
 */
export default function useCariDocumentOpsStatusController({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const { hasPermission } = useAuth();
  const selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id);
  const canWriteOpsStatus = Boolean(
    selectedSnapshot && hasPermission("cari.doc.update")
  );
  const [opsStatusRow, setOpsStatusRow] = useState(null);
  const [opsStatusLoading, setOpsStatusLoading] = useState(false);
  const [opsStatusError, setOpsStatusError] = useState("");
  const [opsStatusMessage, setOpsStatusMessage] = useState("");
  const [opsStatusSaving, setOpsStatusSaving] = useState(false);
  const [opsStatusForm, setOpsStatusForm] = useState({
    opsStatus: "OK",
    blockedReason: "",
    note: "",
  });

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setOpsStatusError("");
    setOpsStatusMessage("");
    setOpsStatusRow(null);
    setOpsStatusForm({
      opsStatus: "OK",
      blockedReason: "",
      note: "",
    });

    if (!canRead || !documentId) {
      setOpsStatusLoading(false);
      return;
    }

    let active = true;
    async function loadOpsStatus() {
      setOpsStatusLoading(true);
      try {
        const response = await getCariDocumentOpsStatus(documentId);
        if (!active) {
          return;
        }
        const row = response?.row || null;
        setOpsStatusRow(row);
        setOpsStatusForm({
          opsStatus: String(row?.opsStatus || "OK").trim().toUpperCase() || "OK",
          blockedReason: String(row?.blockedReason || ""),
          note: String(row?.note || ""),
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setOpsStatusError(
          normalizeApiError(
            error,
            l("Failed to load ops status note.", "Operasyon durumu notu yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setOpsStatusLoading(false);
        }
      }
    }

    loadOpsStatus();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDocumentNumericId]);

  const handleSaveOpsStatus = useCallback(
    async (event) => {
      event.preventDefault();
      const documentId = selectedDocumentNumericId;
      if (!documentId || !canWriteOpsStatus) {
        setOpsStatusError(
          l(
            "Ops status update requires selected document and permission: cari.doc.update.",
            "Operasyon durumu guncellemesi icin secili belge ve `cari.doc.update` yetkisi gerekir."
          )
        );
        return;
      }

      const opsStatus = String(opsStatusForm?.opsStatus || "").trim().toUpperCase();
      const blockedReason = String(opsStatusForm?.blockedReason || "").trim();
      const note = String(opsStatusForm?.note || "").trim();

      if (!["OK", "AT_RISK", "BLOCKED"].includes(opsStatus)) {
        setOpsStatusError(
          l(
            "opsStatus must be OK, AT_RISK, or BLOCKED.",
            "opsStatus OK, AT_RISK veya BLOCKED olmali."
          )
        );
        return;
      }
      if (opsStatus === "BLOCKED" && !blockedReason) {
        setOpsStatusError(
          l(
            "blockedReason is required when opsStatus=BLOCKED.",
            "opsStatus=BLOCKED iken blockedReason zorunludur."
          )
        );
        return;
      }

      setOpsStatusSaving(true);
      setOpsStatusError("");
      setOpsStatusMessage("");
      try {
        const response = await upsertCariDocumentOpsStatus(documentId, {
          opsStatus,
          blockedReason: blockedReason || null,
          note: note || null,
        });
        const row = response?.row || null;
        setOpsStatusRow(row);
        setOpsStatusForm({
          opsStatus: String(row?.opsStatus || "OK").trim().toUpperCase() || "OK",
          blockedReason: String(row?.blockedReason || ""),
          note: String(row?.note || ""),
        });
        setOpsStatusMessage(
          l("Ops status note updated.", "Operasyon durumu notu guncellendi.")
        );
      } catch (error) {
        setOpsStatusError(
          normalizeApiError(
            error,
            l(
              "Failed to update ops status note.",
              "Operasyon durumu notu guncellenemedi."
            )
          )
        );
      } finally {
        setOpsStatusSaving(false);
      }
    },
    [canWriteOpsStatus, l, opsStatusForm, selectedDocumentNumericId]
  );

  return {
    canWriteOpsStatus,
    opsStatusRow,
    opsStatusLoading,
    opsStatusError,
    opsStatusMessage,
    opsStatusSaving,
    opsStatusForm,
    setOpsStatusForm,
    handleSaveOpsStatus,
  };
}
