import { formatDateTime } from "../cariDocumentsPageHelpers.js";
import useCariDocumentOpsStatusController from "../hooks/useCariDocumentOpsStatusController.js";

/**
 * Renders the ops-status note form and current snapshot for the selected document.
 */
export default function CariDocumentOpsStatusPanel({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const {
    canWriteOpsStatus,
    opsStatusRow,
    opsStatusLoading,
    opsStatusError,
    opsStatusMessage,
    opsStatusSaving,
    opsStatusForm,
    setOpsStatusForm,
    handleSaveOpsStatus,
  } = useCariDocumentOpsStatusController({
    selectedSnapshot,
    canRead,
    l,
  });

  return (
    <div>
      <p className="font-semibold text-slate-700">
        {l(
          "Ops status note / blocked reason",
          "Operasyon durum notu / engel nedeni"
        )}
      </p>
      {opsStatusError ? <p className="mt-1 text-rose-700">{opsStatusError}</p> : null}
      {opsStatusMessage ? (
        <p className="mt-1 text-emerald-700">{opsStatusMessage}</p>
      ) : null}
      {opsStatusLoading ? (
        <p className="mt-1 text-slate-600">
          {l("Loading ops status...", "Operasyon durumu yukleniyor...")}
        </p>
      ) : null}
      {!opsStatusLoading ? (
        <p className="mt-1 text-slate-600">
          {l("Current:", "Guncel:")} {opsStatusRow?.opsStatus || "OK"}{" "}
          {opsStatusRow?.updatedAt
            ? `(${l("updated", "guncellendi")} ${formatDateTime(opsStatusRow.updatedAt)})`
            : ""}
        </p>
      ) : null}

      {canWriteOpsStatus ? (
        <form
          onSubmit={handleSaveOpsStatus}
          className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
        >
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            {l("Ops Status", "Operasyon Durumu")}
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs font-normal"
              value={opsStatusForm.opsStatus}
              onChange={(event) =>
                setOpsStatusForm((prev) => ({
                  ...prev,
                  opsStatus: String(event.target.value || "").trim().toUpperCase(),
                }))
              }
              disabled={opsStatusSaving}
            >
              <option value="OK">OK</option>
              <option value="AT_RISK">AT_RISK</option>
              <option value="BLOCKED">BLOCKED</option>
            </select>
          </label>
          <input
            type="text"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder={l(
              "Blocked reason (required when status=BLOCKED)",
              "Engel nedeni (status=BLOCKED iken zorunlu)"
            )}
            value={opsStatusForm.blockedReason}
            onChange={(event) =>
              setOpsStatusForm((prev) => ({
                ...prev,
                blockedReason: event.target.value,
              }))
            }
            disabled={opsStatusSaving}
          />
          <textarea
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder={l("Ops note (optional)", "Operasyon notu (opsiyonel)")}
            rows={3}
            value={opsStatusForm.note}
            onChange={(event) =>
              setOpsStatusForm((prev) => ({
                ...prev,
                note: event.target.value,
              }))
            }
            disabled={opsStatusSaving}
          />
          <button
            type="submit"
            className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
            disabled={opsStatusSaving}
          >
            {opsStatusSaving
              ? l("Saving...", "Kaydediliyor...")
              : l("Save Ops Status", "Operasyon Durumunu Kaydet")}
          </button>
        </form>
      ) : (
        <p className="mt-1 text-slate-500">
          {l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}
        </p>
      )}
    </div>
  );
}
