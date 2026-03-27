import { useCallback, useEffect, useRef, useState } from "react";
import { LINE_TEXT_INPUT_COMMIT_DELAY_MS } from "../cariDocumentsPageHelpers.js";

export default function BufferedDraftLineTextInput({
  value,
  onCommit,
  disabled = false,
  className = "",
  maxLength,
}) {
  const normalizedValue = String(value ?? "");
  const [draftValue, setDraftValue] = useState(normalizedValue);
  const commitTimeoutRef = useRef(null);
  const latestCommitRef = useRef(onCommit);

  useEffect(() => {
    latestCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    setDraftValue(normalizedValue);
  }, [normalizedValue]);

  useEffect(
    () => () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }
    },
    []
  );

  const flushDraftValue = useCallback((nextValue) => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    latestCommitRef.current?.(nextValue);
  }, []);

  const scheduleCommit = useCallback((nextValue) => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
    }
    commitTimeoutRef.current = setTimeout(() => {
      commitTimeoutRef.current = null;
      latestCommitRef.current?.(nextValue);
    }, LINE_TEXT_INPUT_COMMIT_DELAY_MS);
  }, []);

  return (
    <input
      type="text"
      className={className}
      value={draftValue}
      maxLength={maxLength}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        scheduleCommit(nextValue);
      }}
      onBlur={() => flushDraftValue(draftValue)}
      disabled={disabled}
    />
  );
}
