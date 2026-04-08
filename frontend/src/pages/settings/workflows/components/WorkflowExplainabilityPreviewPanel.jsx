import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TONE_STYLES = {
  blue: {
    card: "border-blue-200 bg-blue-50/80",
    title: "text-blue-900",
    summary: "text-blue-900/80",
    entry: "border-blue-200/80 bg-white/80 text-blue-950",
    helper: "text-blue-900/75",
    note: "text-blue-800/80",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50/80",
    title: "text-emerald-950",
    summary: "text-emerald-900/85",
    entry: "border-emerald-200/80 bg-white/80 text-emerald-950",
    helper: "text-emerald-900/75",
    note: "text-emerald-800/80",
  },
};

/**
 * Renders the shared design-time explainability preview for workflow setup.
 */
export default function WorkflowExplainabilityPreviewPanel({
  title,
  previewModel,
  tone = "blue",
  compact = false,
  maxEntries = null,
  showNotes = true,
}) {
  if (!previewModel) {
    return null;
  }

  const styles = TONE_STYLES[tone] || TONE_STYLES.blue;
  const entries = Array.isArray(previewModel.entries) ? previewModel.entries : [];
  const visibleEntries =
    typeof maxEntries === "number" && maxEntries > 0 ? entries.slice(0, maxEntries) : entries;
  const notes = Array.isArray(previewModel.notes) ? previewModel.notes : [];

  return (
    <Card className={`rounded-3xl ${styles.card}`}>
      <CardHeader className="pb-3">
        <CardTitle className={`text-sm ${styles.title}`}>{title}</CardTitle>
        {previewModel.summaryText ? (
          <p className={`text-sm leading-6 ${styles.summary}`}>{previewModel.summaryText}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleEntries.map((entry) => (
          <div key={entry.key} className={`rounded-2xl border px-4 py-3 ${styles.entry}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
                  {entry.actionLabel}
                </p>
                <p className="mt-1 text-sm font-semibold">{entry.lineText}</p>
                {!compact && entry.helperText ? (
                  <p className={`mt-2 text-xs leading-5 ${styles.helper}`}>{entry.helperText}</p>
                ) : null}
              </div>
              <Badge variant="secondary">
                {entry.stepNo}
              </Badge>
            </div>

            {Array.isArray(entry.detailBadges) && entry.detailBadges.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(compact ? entry.detailBadges.slice(0, 2) : entry.detailBadges).map((badge) => (
                  <span
                    key={`${entry.key}-${badge.key}`}
                    className="rounded-full border border-current/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium"
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {showNotes && notes.length > 0 ? (
          <div className="space-y-1">
            {notes.map((note, index) => (
              <p key={`preview-note-${index}`} className={`text-xs leading-5 ${styles.note}`}>
                {note}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
