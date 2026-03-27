import { useCallback, useEffect, useState } from "react";
import {
  createCariDocumentEvidence,
  deleteCariDocumentEvidence,
  downloadCariDocumentEvidence,
  listCariDocumentEvidence,
  uploadCariDocumentEvidenceContent,
} from "../../../api/cariDocuments.js";
import { useAuth } from "../../../auth/useAuth.js";
import { normalizeApiError, toPositiveInt } from "../cariDocumentsPageHelpers.js";

/**
 * Owns evidence attachment loading and upload/download/delete state for a selected document snapshot.
 */
export default function useCariDocumentEvidenceController({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const { hasPermission } = useAuth();
  const selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id);
  const canAttachEvidence = Boolean(
    selectedSnapshot && hasPermission("cari.doc.update")
  );
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceUploadFile, setEvidenceUploadFile] = useState(null);
  const [evidenceUploadInputKey, setEvidenceUploadInputKey] = useState(0);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceDeletingId, setEvidenceDeletingId] = useState(null);
  const [evidenceDownloadingId, setEvidenceDownloadingId] = useState(null);

  const refreshEvidenceRows = useCallback(async (documentId) => {
    const response = await listCariDocumentEvidence(documentId);
    setEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
  }, []);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setEvidenceMessage("");
    setEvidenceError("");
    setEvidenceNote("");
    setEvidenceUploadFile(null);
    setEvidenceUploadInputKey((prev) => prev + 1);
    setEvidenceDeletingId(null);
    setEvidenceDownloadingId(null);

    if (!canRead || !documentId) {
      setEvidenceRows([]);
      setEvidenceLoading(false);
      return;
    }

    let active = true;
    async function loadEvidenceRows() {
      setEvidenceLoading(true);
      try {
        const response = await listCariDocumentEvidence(documentId);
        if (!active) {
          return;
        }
        setEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEvidenceRows([]);
        setEvidenceError(
          normalizeApiError(
            error,
            l("Failed to load evidence attachments.", "Kanit ekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setEvidenceLoading(false);
        }
      }
    }

    loadEvidenceRows();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDocumentNumericId]);

  const handleAttachEvidence = useCallback(
    async (event) => {
      event.preventDefault();
      const documentId = selectedDocumentNumericId;
      if (!documentId || !canAttachEvidence) {
        setEvidenceError(
          l(
            "Evidence attach requires selected document and permission: cari.doc.update.",
            "Kanit eklemek icin secili belge ve `cari.doc.update` yetkisi gerekir."
          )
        );
        return;
      }
      if (!evidenceUploadFile) {
        setEvidenceError(
          l("Select a file before attaching evidence.", "Kanit eklemeden once dosya secin.")
        );
        return;
      }

      setEvidenceUploading(true);
      setEvidenceError("");
      setEvidenceMessage("");
      try {
        const draftResponse = await createCariDocumentEvidence(documentId, {
          fileName: evidenceUploadFile.name || "evidence.bin",
          contentType: evidenceUploadFile.type || undefined,
          displayName: evidenceUploadFile.name || undefined,
          note: String(evidenceNote || "").trim() || undefined,
        });
        const evidenceId = toPositiveInt(draftResponse?.row?.id);
        if (!evidenceId) {
          throw new Error(
            l(
              "Evidence create response is missing id.",
              "Kanit olusturma yanitinda id yok."
            )
          );
        }

        await uploadCariDocumentEvidenceContent(documentId, evidenceId, evidenceUploadFile, {
          contentType: evidenceUploadFile.type || "application/octet-stream",
        });

        await refreshEvidenceRows(documentId);
        setEvidenceMessage(
          l(`Evidence attached. id=${evidenceId}`, `Kanit eklendi. id=${evidenceId}`)
        );
        setEvidenceNote("");
        setEvidenceUploadFile(null);
        setEvidenceUploadInputKey((prev) => prev + 1);
      } catch (error) {
        setEvidenceError(
          normalizeApiError(error, l("Failed to attach evidence.", "Kanit eklenemedi."))
        );
      } finally {
        setEvidenceUploading(false);
      }
    },
    [
      canAttachEvidence,
      evidenceNote,
      evidenceUploadFile,
      l,
      refreshEvidenceRows,
      selectedDocumentNumericId,
    ]
  );

  const handleDownloadEvidence = useCallback(
    async (row) => {
      const documentId = selectedDocumentNumericId;
      const evidenceId = toPositiveInt(row?.id);
      if (!documentId || !evidenceId) {
        setEvidenceError(l("Evidence id is invalid.", "Kanit id gecersiz."));
        return;
      }

      setEvidenceDownloadingId(evidenceId);
      setEvidenceError("");
      try {
        const response = await downloadCariDocumentEvidence(documentId, evidenceId);
        const blob = response?.blob;
        if (!(blob instanceof Blob)) {
          throw new Error(
            l("Evidence download payload is invalid.", "Kanit indirme yuklemi gecersiz.")
          );
        }
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download =
          String(response?.fileName || row?.fileName || "").trim() ||
          `evidence-${evidenceId}.bin`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);
      } catch (error) {
        setEvidenceError(
          normalizeApiError(error, l("Failed to download evidence.", "Kanit indirilemedi."))
        );
      } finally {
        setEvidenceDownloadingId(null);
      }
    },
    [l, selectedDocumentNumericId]
  );

  const handleDeleteEvidence = useCallback(
    async (evidenceIdRaw) => {
      const documentId = selectedDocumentNumericId;
      const evidenceId = toPositiveInt(evidenceIdRaw);
      if (!documentId || !evidenceId || !canAttachEvidence) {
        setEvidenceError(
          l(
            "Evidence delete requires selected document, valid evidence id, and cari.doc.update permission.",
            "Kanit silmek icin secili belge, gecerli kanit id ve `cari.doc.update` yetkisi gerekir."
          )
        );
        return;
      }

      setEvidenceDeletingId(evidenceId);
      setEvidenceError("");
      setEvidenceMessage("");
      try {
        await deleteCariDocumentEvidence(documentId, evidenceId);
        await refreshEvidenceRows(documentId);
        setEvidenceMessage(
          l(`Evidence deleted. id=${evidenceId}`, `Kanit silindi. id=${evidenceId}`)
        );
      } catch (error) {
        setEvidenceError(
          normalizeApiError(error, l("Failed to delete evidence.", "Kanit silinemedi."))
        );
      } finally {
        setEvidenceDeletingId(null);
      }
    },
    [canAttachEvidence, l, refreshEvidenceRows, selectedDocumentNumericId]
  );

  return {
    canAttachEvidence,
    evidenceRows,
    evidenceLoading,
    evidenceError,
    evidenceMessage,
    evidenceNote,
    setEvidenceNote,
    evidenceUploadFile,
    setEvidenceUploadFile,
    evidenceUploadInputKey,
    evidenceUploading,
    evidenceDeletingId,
    evidenceDownloadingId,
    handleAttachEvidence,
    handleDownloadEvidence,
    handleDeleteEvidence,
    setEvidenceError,
    setEvidenceMessage,
  };
}
