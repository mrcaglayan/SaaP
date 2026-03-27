import { formatDateTime, normalizeText } from "../cariDocumentsPageHelpers.js";
import useCariDocumentCommentsController from "../hooks/useCariDocumentCommentsController.js";

/**
 * Renders internal comments and teammate mention UX for the selected document.
 */
export default function CariDocumentCommentsPanel({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const {
    canWriteInternalComments,
    internalCommentTextareaRef,
    internalCommentRows,
    internalCommentsLoading,
    internalCommentsError,
    internalCommentsMessage,
    internalCommentBody,
    internalCommentSaving,
    internalCommentMentionDraft,
    internalCommentMentionRows,
    internalCommentMentionLoading,
    internalCommentMentionError,
    internalCommentMentionHighlightIndex,
    setInternalCommentMentionHighlightIndex,
    handleInternalCommentBodyChange,
    handleInternalCommentBodyCursorChange,
    handleInternalCommentBodyBlur,
    handleInternalCommentBodyKeyDown,
    applyInternalCommentMention,
    handleCreateInternalComment,
  } = useCariDocumentCommentsController({
    selectedSnapshot,
    canRead,
    l,
  });

  return (
    <div>
      <p className="font-semibold text-slate-700">
        {l("Internal comments", "Dahili yorumlar")}
      </p>
      {internalCommentsError ? (
        <p className="mt-1 text-rose-700">{internalCommentsError}</p>
      ) : null}
      {internalCommentsMessage ? (
        <p className="mt-1 text-emerald-700">{internalCommentsMessage}</p>
      ) : null}
      {internalCommentsLoading ? (
        <p className="mt-1 text-slate-600">
          {l("Loading comments...", "Yorumlar yukleniyor...")}
        </p>
      ) : null}

      {canWriteInternalComments ? (
        <form
          onSubmit={handleCreateInternalComment}
          className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
        >
          <div className="space-y-1">
            <textarea
              ref={internalCommentTextareaRef}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder={l(
                "Add internal comment... Type @ to mention teammates.",
                "Dahili yorum ekleyin... Ekip arkadaslarini etiketlemek icin @ yazin."
              )}
              rows={3}
              value={internalCommentBody}
              onChange={handleInternalCommentBodyChange}
              onClick={handleInternalCommentBodyCursorChange}
              onKeyUp={handleInternalCommentBodyCursorChange}
              onKeyDown={handleInternalCommentBodyKeyDown}
              onBlur={handleInternalCommentBodyBlur}
              disabled={internalCommentSaving}
            />
            {internalCommentMentionDraft ? (
              <div className="rounded border border-cyan-200 bg-cyan-50">
                <div className="border-b border-cyan-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                  {l("Mention teammates", "Ekip arkadaslarini etiketle")}
                </div>
                {internalCommentMentionLoading ? (
                  <p className="px-2 py-2 text-xs text-cyan-800">
                    {l("Loading suggestions...", "Oneriler yukleniyor...")}
                  </p>
                ) : null}
                {!internalCommentMentionLoading && internalCommentMentionError ? (
                  <p className="px-2 py-2 text-xs text-amber-800">
                    {internalCommentMentionError}
                  </p>
                ) : null}
                {!internalCommentMentionLoading &&
                !internalCommentMentionError &&
                internalCommentMentionRows.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-cyan-800">
                    {l(
                      "No matching teammates found.",
                      "Eslesen ekip arkadasi bulunamadi."
                    )}
                  </p>
                ) : null}
                {!internalCommentMentionLoading &&
                !internalCommentMentionError &&
                internalCommentMentionRows.length > 0 ? (
                  <ul className="max-h-40 overflow-auto p-1">
                    {internalCommentMentionRows.map((row, index) => {
                      const displayName = normalizeText(row?.name);
                      const displayEmail = normalizeText(row?.email);
                      const isHighlighted =
                        index === internalCommentMentionHighlightIndex;
                      return (
                        <li
                          key={`internal-comment-mention-${row?.id || displayEmail || index}`}
                        >
                          <button
                            type="button"
                            className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                              isHighlighted
                                ? "bg-cyan-100 text-cyan-950"
                                : "text-slate-700 hover:bg-cyan-100/70"
                            }`}
                            onMouseEnter={() =>
                              setInternalCommentMentionHighlightIndex(index)
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyInternalCommentMention(row)}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">
                                {displayName || displayEmail || "-"}
                              </span>
                              {displayName && displayEmail ? (
                                <span className="block truncate font-mono text-[11px] text-slate-500">
                                  @{displayEmail}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
            disabled={!String(internalCommentBody || "").trim() || internalCommentSaving}
          >
            {internalCommentSaving
              ? l("Adding...", "Ekleniyor...")
              : l("Add Comment", "Yorum Ekle")}
          </button>
          <p className="text-[11px] text-slate-500">
            {l("Type", "Yazin")} <span className="font-mono">@</span>{" "}
            {l(
              "to open the teammate list. Picking a suggestion inserts @email and sends an in-app notification.",
              "ekip listesini acmak icin. Bir oneriyi secmek @email ekler ve uygulama ici bildirim gonderir."
            )}
          </p>
        </form>
      ) : (
        <p className="mt-1 text-slate-500">
          {l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}
        </p>
      )}

      {!internalCommentsLoading && internalCommentRows.length === 0 ? (
        <p className="mt-1 text-slate-600">
          {l("No internal comments yet.", "Henuz dahili yorum yok.")}
        </p>
      ) : null}
      {!internalCommentsLoading && internalCommentRows.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {internalCommentRows.map((row) => (
            <li
              key={`related-comment-${row.id}`}
              className="rounded border border-slate-200 bg-white px-2 py-1"
            >
              <div className="whitespace-pre-wrap text-slate-700">
                {row.body || "-"}
              </div>
              <div className="mt-1 text-slate-500">
                {formatDateTime(row.createdAt)} | by=
                {row.createdByUserName ||
                  row.createdByUserEmail ||
                  row.createdByUserId ||
                  "-"}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
