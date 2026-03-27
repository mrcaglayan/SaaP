import {
  formatDateTime,
  formatFileSize,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";
import useCariDocumentEvidenceController from "../hooks/useCariDocumentEvidenceController.js";

/**
 * Renders evidence attachment upload and file actions for the selected document.
 */
export default function CariDocumentEvidencePanel({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const {
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
  } = useCariDocumentEvidenceController({
    selectedSnapshot,
    canRead,
    l,
  });

  return (
    <div>
      <p className="font-semibold text-slate-700">
        {l("Evidence attachments", "Kanit ekleri")}
      </p>
      {evidenceError ? <p className="mt-1 text-rose-700">{evidenceError}</p> : null}
      {evidenceMessage ? (
        <p className="mt-1 text-emerald-700">{evidenceMessage}</p>
      ) : null}
      {evidenceLoading ? (
        <p className="mt-1 text-slate-600">
          {l("Loading evidence...", "Kanitlar yukleniyor...")}
        </p>
      ) : null}

      {canAttachEvidence ? (
        <form
          onSubmit={handleAttachEvidence}
          className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
        >
          <input
            key={evidenceUploadInputKey}
            type="file"
            className="block w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
            onChange={(event) => {
              setEvidenceError("");
              setEvidenceMessage("");
              setEvidenceUploadFile(event.target.files?.[0] || null);
            }}
            disabled={evidenceUploading}
          />
          <input
            type="text"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder={l("Optional note", "Opsiyonel not")}
            value={evidenceNote}
            onChange={(event) => setEvidenceNote(event.target.value)}
            disabled={evidenceUploading}
          />
          <button
            type="submit"
            className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
            disabled={!evidenceUploadFile || evidenceUploading}
          >
            {evidenceUploading
              ? l("Uploading...", "Yukleniyor...")
              : l("Attach Evidence", "Kanit Ekle")}
          </button>
        </form>
      ) : (
        <p className="mt-1 text-slate-500">
          {l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}
        </p>
      )}

      {!evidenceLoading && evidenceRows.length === 0 ? (
        <p className="mt-1 text-slate-600">
          {l(
            "No evidence attached to this document.",
            "Bu belgeye ekli kanit yok."
          )}
        </p>
      ) : null}
      {!evidenceLoading && evidenceRows.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {evidenceRows.map((row) => {
            const rowId = toPositiveInt(row?.id);
            const isDownloading =
              rowId && Number(evidenceDownloadingId) === Number(rowId);
            const isDeleting = rowId && Number(evidenceDeletingId) === Number(rowId);
            return (
              <li
                key={`related-evidence-${row.id}`}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              >
                <div className="text-slate-700">
                  #{row.id} | {row.fileName || "-"} | {formatFileSize(row.fileSizeBytes)} |{" "}
                  {row.contentType || "-"}
                </div>
                <div className="text-slate-600">
                  status={row.status || "-"} | uploaded={formatDateTime(row.uploadedAt)}
                </div>
                {row.note ? (
                  <div className="text-slate-500">note={row.note}</div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    onClick={() => handleDownloadEvidence(row)}
                    disabled={!rowId || Boolean(isDownloading)}
                  >
                    {isDownloading
                      ? l("Downloading...", "Indiriliyor...")
                      : l("Download", "Indir")}
                  </button>
                  {canAttachEvidence ? (
                    <button
                      type="button"
                      className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                      onClick={() => handleDeleteEvidence(rowId)}
                      disabled={!rowId || Boolean(isDeleting)}
                    >
                      {isDeleting ? l("Deleting...", "Siliniyor...") : l("Delete", "Sil")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
