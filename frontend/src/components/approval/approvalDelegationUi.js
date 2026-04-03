function formatUserAuthorityLabel(row) {
  if (!row) {
    return "another reviewer";
  }
  return (
    row.delegatorUserName ||
    row.delegatorUserEmail ||
    (row.delegatorUserId ? `User #${row.delegatorUserId}` : "another reviewer")
  );
}

/**
 * Build the shared authority notice shown in approval action dialogs.
 */
export function buildApprovalDelegationActionNotice(preview, actionLabel = "approve") {
  if (!preview) {
    return null;
  }
  if (preview.authorityMode === "DELEGATED" && preview.delegation) {
    return {
      tone: "delegated",
      title: `${actionLabel} on behalf of ${formatUserAuthorityLabel(preview.delegation)}`,
      description:
        "This decision will be recorded under delegated approval authority at the request scope.",
    };
  }
  if (preview.authorityMode === "DIRECT") {
    return {
      tone: "neutral",
      title: "Direct approval authority",
      description: "This decision will use your own scoped approval authority.",
    };
  }
  return {
    tone: "warning",
    title: "No approval authority resolved",
    description:
      "The system does not currently resolve direct or delegated review authority for this request.",
  };
}

/**
 * Build the shared in-drawer status notice for delegated review context.
 */
export function buildApprovalDelegationDrawerNotice(preview) {
  if (!preview || preview.authorityMode !== "DELEGATED" || !preview.delegation) {
    return null;
  }
  return {
    title: "Delegated review authority",
    description: `Decisions on this request will be recorded on behalf of ${formatUserAuthorityLabel(
      preview.delegation
    )}.`,
  };
}
