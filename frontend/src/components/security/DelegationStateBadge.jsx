import { getDelegationStateMeta } from "../../utils/delegationUi.js";

/**
 * Render one shared lifecycle badge for approval delegations.
 */
export default function DelegationStateBadge({ state }) {
  const meta = getDelegationStateMeta(state);
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
