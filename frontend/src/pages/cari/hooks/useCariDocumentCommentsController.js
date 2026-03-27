import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCariDocumentComment,
  listCariDocumentComments,
  listCariDocumentMentionCandidates,
} from "../../../api/cariDocuments.js";
import { useAuth } from "../../../auth/useAuth.js";
import {
  getInternalCommentMentionDraft,
  normalizeApiError,
  normalizeText,
  shouldInsertMentionSpacer,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

/**
 * Owns internal comment loading, mention suggestions, and creation state for the selected document.
 */
export default function useCariDocumentCommentsController({
  selectedSnapshot = null,
  canRead = false,
  l,
}) {
  const { hasPermission } = useAuth();
  const selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id);
  const canWriteInternalComments = Boolean(
    selectedSnapshot && hasPermission("cari.doc.update")
  );
  const internalCommentTextareaRef = useRef(null);
  const internalCommentMentionRequestRef = useRef(0);
  const [internalCommentRows, setInternalCommentRows] = useState([]);
  const [internalCommentsLoading, setInternalCommentsLoading] = useState(false);
  const [internalCommentsError, setInternalCommentsError] = useState("");
  const [internalCommentsMessage, setInternalCommentsMessage] = useState("");
  const [internalCommentBody, setInternalCommentBody] = useState("");
  const [internalCommentSaving, setInternalCommentSaving] = useState(false);
  const [internalCommentMentionDraft, setInternalCommentMentionDraft] = useState(null);
  const [internalCommentMentionRows, setInternalCommentMentionRows] = useState([]);
  const [internalCommentMentionLoading, setInternalCommentMentionLoading] = useState(false);
  const [internalCommentMentionError, setInternalCommentMentionError] = useState("");
  const [internalCommentMentionHighlightIndex, setInternalCommentMentionHighlightIndex] =
    useState(-1);

  const closeInternalCommentMentionPicker = useCallback(() => {
    internalCommentMentionRequestRef.current += 1;
    setInternalCommentMentionDraft(null);
    setInternalCommentMentionRows([]);
    setInternalCommentMentionLoading(false);
    setInternalCommentMentionError("");
    setInternalCommentMentionHighlightIndex(-1);
  }, []);

  const syncInternalCommentMentionDraft = useCallback(
    (value, selectionStart) => {
      if (
        !selectedDocumentNumericId ||
        !canWriteInternalComments ||
        internalCommentSaving
      ) {
        closeInternalCommentMentionPicker();
        return;
      }
      const nextDraft = getInternalCommentMentionDraft(value, selectionStart);
      if (!nextDraft) {
        closeInternalCommentMentionPicker();
        return;
      }
      const isSameDraft =
        internalCommentMentionDraft &&
        internalCommentMentionDraft.query === nextDraft.query &&
        internalCommentMentionDraft.replaceFrom === nextDraft.replaceFrom &&
        internalCommentMentionDraft.replaceTo === nextDraft.replaceTo;
      setInternalCommentMentionError("");
      if (isSameDraft) {
        return;
      }
      setInternalCommentMentionDraft(nextDraft);
      setInternalCommentMentionHighlightIndex(0);
    },
    [
      canWriteInternalComments,
      closeInternalCommentMentionPicker,
      internalCommentMentionDraft,
      internalCommentSaving,
      selectedDocumentNumericId,
    ]
  );

  const handleInternalCommentBodyChange = useCallback(
    (event) => {
      const nextValue = String(event?.target?.value || "");
      const nextSelectionStart = event?.target?.selectionStart;
      setInternalCommentsError("");
      setInternalCommentsMessage("");
      setInternalCommentBody(nextValue);
      syncInternalCommentMentionDraft(nextValue, nextSelectionStart);
    },
    [syncInternalCommentMentionDraft]
  );

  const handleInternalCommentBodyCursorChange = useCallback(
    (event) => {
      syncInternalCommentMentionDraft(event?.target?.value, event?.target?.selectionStart);
    },
    [syncInternalCommentMentionDraft]
  );

  const handleInternalCommentBodyBlur = useCallback(() => {
    window.setTimeout(() => {
      if (document.activeElement === internalCommentTextareaRef.current) {
        return;
      }
      closeInternalCommentMentionPicker();
    }, 0);
  }, [closeInternalCommentMentionPicker]);

  const applyInternalCommentMention = useCallback(
    (candidate) => {
      const email = normalizeText(candidate?.email);
      if (!email) {
        return;
      }
      const textarea = internalCommentTextareaRef.current;
      const currentValue = String(internalCommentBody || "");
      const activeDraft =
        internalCommentMentionDraft ||
        getInternalCommentMentionDraft(currentValue, textarea?.selectionStart);
      if (!activeDraft) {
        return;
      }
      const nextCharacter = currentValue.slice(
        activeDraft.replaceTo,
        activeDraft.replaceTo + 1
      );
      const spacer = shouldInsertMentionSpacer(nextCharacter) ? " " : "";
      const insertedText = `@${email}${spacer}`;
      const nextValue = `${currentValue.slice(0, activeDraft.replaceFrom)}${insertedText}${currentValue.slice(
        activeDraft.replaceTo
      )}`;
      const nextCaretPosition = activeDraft.replaceFrom + insertedText.length;

      setInternalCommentsError("");
      setInternalCommentsMessage("");
      setInternalCommentBody(nextValue);
      closeInternalCommentMentionPicker();

      window.requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
      });
    },
    [
      closeInternalCommentMentionPicker,
      internalCommentBody,
      internalCommentMentionDraft,
    ]
  );

  const handleInternalCommentBodyKeyDown = useCallback(
    (event) => {
      if (!internalCommentMentionDraft) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeInternalCommentMentionPicker();
        return;
      }
      if (!internalCommentMentionRows.length) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setInternalCommentMentionHighlightIndex((previous) =>
          previous >= internalCommentMentionRows.length - 1 ? 0 : previous + 1
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setInternalCommentMentionHighlightIndex((previous) =>
          previous <= 0 ? internalCommentMentionRows.length - 1 : previous - 1
        );
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        internalCommentMentionHighlightIndex >= 0
      ) {
        const candidate =
          internalCommentMentionRows[internalCommentMentionHighlightIndex];
        if (!candidate) {
          return;
        }
        event.preventDefault();
        applyInternalCommentMention(candidate);
      }
    },
    [
      applyInternalCommentMention,
      closeInternalCommentMentionPicker,
      internalCommentMentionDraft,
      internalCommentMentionHighlightIndex,
      internalCommentMentionRows,
    ]
  );

  const refreshInternalComments = useCallback(async (documentId) => {
    const response = await listCariDocumentComments(documentId);
    setInternalCommentRows(Array.isArray(response?.rows) ? response.rows : []);
  }, []);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    setInternalCommentBody("");
    closeInternalCommentMentionPicker();

    if (!canRead || !documentId) {
      setInternalCommentRows([]);
      setInternalCommentsLoading(false);
      return;
    }

    let active = true;
    async function loadInternalComments() {
      setInternalCommentsLoading(true);
      try {
        const response = await listCariDocumentComments(documentId);
        if (!active) {
          return;
        }
        setInternalCommentRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setInternalCommentRows([]);
        setInternalCommentsError(
          normalizeApiError(
            error,
            l("Failed to load internal comments.", "Ic yorumlar yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setInternalCommentsLoading(false);
        }
      }
    }

    loadInternalComments();
    return () => {
      active = false;
    };
  }, [canRead, closeInternalCommentMentionPicker, l, selectedDocumentNumericId]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canWriteInternalComments || !internalCommentMentionDraft) {
      setInternalCommentMentionRows([]);
      setInternalCommentMentionLoading(false);
      setInternalCommentMentionError("");
      setInternalCommentMentionHighlightIndex(-1);
      return;
    }

    const requestId = internalCommentMentionRequestRef.current + 1;
    internalCommentMentionRequestRef.current = requestId;
    const timeoutId = window.setTimeout(async () => {
      setInternalCommentMentionLoading(true);
      setInternalCommentMentionError("");
      try {
        const response = await listCariDocumentMentionCandidates(documentId, {
          q: internalCommentMentionDraft.query,
          limit: 8,
        });
        if (internalCommentMentionRequestRef.current !== requestId) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setInternalCommentMentionRows(rows);
        setInternalCommentMentionHighlightIndex(rows.length > 0 ? 0 : -1);
      } catch (error) {
        if (internalCommentMentionRequestRef.current !== requestId) {
          return;
        }
        setInternalCommentMentionRows([]);
        setInternalCommentMentionHighlightIndex(-1);
        setInternalCommentMentionError(
          normalizeApiError(
            error,
            l(
              "Mention suggestions could not be loaded. You can still type the full email.",
              "Etiket onerileri yuklenemedi. E-postayi tam yazarak devam edebilirsiniz."
            )
          )
        );
      } finally {
        if (internalCommentMentionRequestRef.current === requestId) {
          setInternalCommentMentionLoading(false);
        }
      }
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    canWriteInternalComments,
    internalCommentMentionDraft,
    l,
    selectedDocumentNumericId,
  ]);

  const handleCreateInternalComment = useCallback(
    async (event) => {
      event.preventDefault();
      const documentId = selectedDocumentNumericId;
      if (!documentId || !canWriteInternalComments) {
        setInternalCommentsError(
          l(
            "Internal comment add requires selected document and permission: cari.doc.update.",
            "Ic yorum eklemek icin secili belge ve `cari.doc.update` yetkisi gerekir."
          )
        );
        return;
      }

      const body = String(internalCommentBody || "").trim();
      if (!body) {
        setInternalCommentsError(l("Comment body is required.", "Yorum metni zorunludur."));
        return;
      }

      closeInternalCommentMentionPicker();
      setInternalCommentSaving(true);
      setInternalCommentsError("");
      setInternalCommentsMessage("");
      try {
        const response = await createCariDocumentComment(documentId, { body });
        await refreshInternalComments(documentId);
        const commentId = toPositiveInt(response?.row?.id);
        setInternalCommentBody("");
        setInternalCommentsMessage(
          commentId
            ? l(`Internal comment added. id=${commentId}`, `Ic yorum eklendi. id=${commentId}`)
            : l("Internal comment added.", "Ic yorum eklendi.")
        );
      } catch (error) {
        setInternalCommentsError(
          normalizeApiError(error, l("Failed to add internal comment.", "Ic yorum eklenemedi."))
        );
      } finally {
        setInternalCommentSaving(false);
      }
    },
    [
      canWriteInternalComments,
      closeInternalCommentMentionPicker,
      internalCommentBody,
      l,
      refreshInternalComments,
      selectedDocumentNumericId,
    ]
  );

  return {
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
  };
}
