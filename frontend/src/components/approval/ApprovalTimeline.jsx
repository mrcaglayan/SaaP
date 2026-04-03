import StatusTimeline from "../StatusTimeline.jsx";

function normalizeTimelineItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

/**
 * Render approval decision history and lifecycle events on top of the shared
 * timeline primitive.
 */
export default function ApprovalTimeline({
  title = "Decision History",
  items = [],
  emptyText = "No approval history available yet.",
  className = "",
}) {
  return (
    <StatusTimeline
      title={title}
      steps={normalizeTimelineItems(items)}
      emptyText={emptyText}
      className={className}
    />
  );
}
