export const ORG_SCOPE_TYPES = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Normalize one candidate scope type to the canonical backend/frontend org
 * scope values.
 */
export function normalizeOrgScopeType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ORG_SCOPE_TYPES.includes(normalized) ? normalized : "";
}

/**
 * Check whether a value matches the canonical nested org-tree node contract.
 */
export function isOrgScopeTreeNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }

  return Boolean(
    String(node.key || "").trim() &&
      normalizeOrgScopeType(node.scopeType) &&
      toPositiveInt(node.scopeId) &&
      typeof node.label === "string" &&
      Array.isArray(node.pathLabels) &&
      Array.isArray(node.children)
  );
}

/**
 * Return the nested-tree root when the backend response matches the canonical
 * org-tree contract. Invalid or flat responses return null.
 */
export function getOrgScopeTreeRoot(response) {
  if (String(response?.shape || "").trim().toLowerCase() !== "nested") {
    return null;
  }
  if (!isOrgScopeTreeNode(response?.root)) {
    return null;
  }
  return normalizeOrgScopeType(response.root.scopeType) === "TENANT"
    ? response.root
    : null;
}

/**
 * Walk the org tree depth-first and call `visitor` for each node.
 */
export function walkOrgScopeTree(root, visitor, parent = null, depth = 0) {
  if (!isOrgScopeTreeNode(root) || typeof visitor !== "function") {
    return;
  }

  visitor(root, { depth, parent });
  for (const child of root.children) {
    walkOrgScopeTree(child, visitor, root, depth + 1);
  }
}

function isSameScopeSelection(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    normalizeOrgScopeType(left.scopeType) === normalizeOrgScopeType(right.scopeType) &&
    toPositiveInt(left.scopeId) === toPositiveInt(right.scopeId)
  );
}

function normalizeNodeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function cloneOrgScopeTreeNode(node, children, selectable = node.selectable) {
  return {
    ...node,
    selectable: Boolean(selectable),
    children,
  };
}

/**
 * Filter the canonical org tree by allowed scope types while preserving the
 * ancestor path needed to render matching descendants.
 */
export function filterOrgScopeTreeByAllowedScopeTypes(root, allowedScopeTypes = []) {
  if (!isOrgScopeTreeNode(root)) {
    return null;
  }

  const requestedTypes = Array.isArray(allowedScopeTypes) ? allowedScopeTypes : [];
  if (requestedTypes.length === 0) {
    return root;
  }

  const allowedTypeSet = new Set(
    requestedTypes.map((scopeType) => normalizeOrgScopeType(scopeType)).filter(Boolean)
  );

  function filterNode(node, depth) {
    const scopeType = normalizeOrgScopeType(node.scopeType);
    const filteredChildren = node.children
      .map((child) => filterNode(child, depth + 1))
      .filter(Boolean);
    const typeAllowed = allowedTypeSet.has(scopeType);
    const keepForNavigation = filteredChildren.length > 0;
    const isRoot = depth === 0 && scopeType === "TENANT";

    if (!typeAllowed && !keepForNavigation && !isRoot) {
      return null;
    }

    return cloneOrgScopeTreeNode(
      node,
      filteredChildren,
      Boolean(node.selectable && typeAllowed)
    );
  }

  return filterNode(root, 0);
}

/**
 * Map one canonical org-tree node to the current `{ scopeType, scopeId }`
 * selection semantics used by backend write payloads.
 */
export function mapOrgScopeTreeNodeToScopeSelection(node) {
  if (!isOrgScopeTreeNode(node)) {
    return null;
  }

  const scopeType = normalizeOrgScopeType(node.scopeType);
  const scopeId = toPositiveInt(node.scopeId);
  if (!scopeType || !scopeId) {
    return null;
  }

  return {
    scopeType,
    scopeId,
  };
}

/**
 * Map one canonical org-tree node to the current form-field shape used by
 * existing scope-selection screens during the incremental migration.
 */
export function mapOrgScopeTreeNodeToCurrentScopeFields(node) {
  const selection = mapOrgScopeTreeNodeToScopeSelection(node);
  if (!selection) {
    return null;
  }

  const scopeId = String(selection.scopeId);

  return {
    scopeType: selection.scopeType,
    scopeId,
    groupCompanyId: selection.scopeType === "GROUP" ? scopeId : "",
    countryId: selection.scopeType === "COUNTRY" ? scopeId : "",
    legalEntityId: selection.scopeType === "LEGAL_ENTITY" ? scopeId : "",
    operatingUnitId: selection.scopeType === "OPERATING_UNIT" ? scopeId : "",
  };
}

/**
 * Find one canonical org-tree node from the current `{ scopeType, scopeId }`
 * selection. When multiple navigation branches represent the same scope, an
 * optional preferred node key keeps breadcrumb rendering stable after the user
 * picked a specific branch.
 */
export function findOrgScopeTreeNodeByScopeSelection(
  root,
  selection,
  preferredNodeKey = ""
) {
  if (!isOrgScopeTreeNode(root)) {
    return null;
  }

  const normalizedPreferredNodeKey = normalizeNodeText(preferredNodeKey);
  let firstMatch = null;
  let preferredMatch = null;

  walkOrgScopeTree(root, (node) => {
    if (preferredMatch) {
      return;
    }

    const nodeSelection = mapOrgScopeTreeNodeToScopeSelection(node);
    if (!isSameScopeSelection(nodeSelection, selection)) {
      return;
    }

    if (!firstMatch) {
      firstMatch = node;
    }
    if (normalizedPreferredNodeKey && node.key === normalizedPreferredNodeKey) {
      preferredMatch = node;
    }
  });

  return preferredMatch || firstMatch;
}

/**
 * Build a stable breadcrumb/path string from canonical node path labels.
 */
export function buildOrgScopeTreePathLabelText(pathLabels = []) {
  return (Array.isArray(pathLabels) ? pathLabels : [])
    .map((label) => normalizeNodeText(label))
    .filter(Boolean)
    .join(" / ");
}

/**
 * Return the compact node value used in scope summaries. Country nodes prefer
 * ISO-style metadata when available so summary text stays short without
 * depending on legacy flat lookup rows.
 */
export function getOrgScopeTreeNodeSummaryValue(node) {
  if (!isOrgScopeTreeNode(node)) {
    return "";
  }

  if (normalizeOrgScopeType(node.scopeType) === "COUNTRY") {
    return normalizeNodeText(node?.meta?.iso2 || node?.code || node?.label);
  }

  return normalizeNodeText(node?.code || node?.label);
}
