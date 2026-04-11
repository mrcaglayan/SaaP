import { useDeferredValue, useState } from "react";
import {
  findOrgScopeTreeNodeByScopeSelection,
  filterOrgScopeTreeByAllowedScopeTypes,
  isOrgScopeTreeNode,
  mapOrgScopeTreeNodeToScopeSelection,
  normalizeOrgScopeType,
  walkOrgScopeTree,
} from "../../shared/orgScopeTree.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeSearchTerm(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKeyList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function buildExpandedKeysSeed(keys = []) {
  return JSON.stringify(normalizeKeyList(keys));
}

function resolveExpandedKeys(expandedState, initialExpandedKeys, initialExpandedKeysSeed) {
  if (expandedState?.seed === initialExpandedKeysSeed) {
    return expandedState.keys;
  }
  return new Set(initialExpandedKeys);
}

function areSameScopeSelection(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    normalizeOrgScopeType(left.scopeType) === normalizeOrgScopeType(right.scopeType) &&
    Number(left.scopeId || 0) === Number(right.scopeId || 0)
  );
}

function buildNodeSearchHaystack(node) {
  const parts = [
    node?.label,
    node?.code,
    node?.scopeType,
    ...(Array.isArray(node?.pathLabels) ? node.pathLabels : []),
    node?.meta?.iso2,
    node?.meta?.iso3,
    node?.meta?.unitType,
  ];
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function countTreeNodes(root) {
  if (!isOrgScopeTreeNode(root)) {
    return 0;
  }

  let count = 0;
  walkOrgScopeTree(root, () => {
    count += 1;
  });
  return count;
}

/**
 * Return whether one org-tree node matches the current search term using the
 * node label, code, path labels, and stable metadata such as ISO codes.
 */
export function doesOrgScopeTreeNodeMatchSearch(node, searchTerm) {
  if (!isOrgScopeTreeNode(node)) {
    return false;
  }

  const normalizedSearchTerm = normalizeSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return true;
  }

  return buildNodeSearchHaystack(node).includes(normalizedSearchTerm);
}

/**
 * Filter the org tree by search text while keeping ancestor nodes so the UI
 * can still render a navigable path to matching descendants.
 */
export function filterOrgScopeTreeBySearchTerm(root, searchTerm) {
  if (!isOrgScopeTreeNode(root)) {
    return null;
  }

  const normalizedSearchTerm = normalizeSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return root;
  }

  function filterNode(node, depth) {
    const filteredChildren = node.children
      .map((child) => filterNode(child, depth + 1))
      .filter(Boolean);
    const isRoot = depth === 0 && normalizeOrgScopeType(node.scopeType) === "TENANT";
    const matches = doesOrgScopeTreeNodeMatchSearch(node, normalizedSearchTerm);

    if (!matches && filteredChildren.length === 0 && !isRoot) {
      return null;
    }

    return {
      ...node,
      children: filteredChildren,
    };
  }

  return filterNode(root, 0);
}

/**
 * Collect every expandable node key in the org tree.
 */
export function collectOrgScopeTreeExpandableKeys(root) {
  if (!isOrgScopeTreeNode(root)) {
    return [];
  }

  const keys = [];
  walkOrgScopeTree(root, (node) => {
    if (Array.isArray(node.children) && node.children.length > 0) {
      keys.push(node.key);
    }
  });
  return keys;
}

/**
 * Build the default expanded-key set. When no explicit keys are supplied, the
 * tenant root stays open by default so the first visible branch is reachable.
 */
export function buildOrgScopeTreeInitialExpandedKeys(root, defaultExpandedKeys = []) {
  const normalizedDefaultKeys = normalizeKeyList(defaultExpandedKeys);
  if (normalizedDefaultKeys.length > 0) {
    return normalizedDefaultKeys;
  }

  if (!isOrgScopeTreeNode(root)) {
    return [];
  }

  return [root.key];
}

/**
 * Toggle one node key in an expanded-key set without mutating the original
 * collection.
 */
export function toggleOrgScopeTreeExpandedKey(expandedKeys, key) {
  const normalizedKey = normalizeText(key);
  const nextKeys = new Set(normalizeKeyList(Array.from(expandedKeys || [])));
  if (!normalizedKey) {
    return nextKeys;
  }

  if (nextKeys.has(normalizedKey)) {
    nextKeys.delete(normalizedKey);
  } else {
    nextKeys.add(normalizedKey);
  }
  return nextKeys;
}

/**
 * Resolve one node's selection and disabled state by combining the backend
 * contract with page-provided selectability rules.
 */
export function resolveOrgScopeTreeNodeState(
  node,
  {
    selectedScope = null,
    isNodeDisabled = null,
    getNodeDisabledReason = null,
  } = {}
) {
  if (!isOrgScopeTreeNode(node)) {
    return {
      selection: null,
      isSelected: false,
      isDisabled: true,
      disabledReason: "",
    };
  }

  const selection = mapOrgScopeTreeNodeToScopeSelection(node);
  const externalReason =
    typeof getNodeDisabledReason === "function"
      ? normalizeText(getNodeDisabledReason(node, selection))
      : "";
  const externallyDisabled =
    typeof isNodeDisabled === "function" ? Boolean(isNodeDisabled(node, selection)) : false;
  // Restricted trees can keep non-selectable ancestors visible so users can
  // still navigate the valid descendant path without broadening scope choices.
  const navigationOnlyReason =
    !node.selectable && node.children.length > 0
      ? "Visible for navigation only."
      : "This scope is not selectable.";

  return {
    selection,
    isSelected: areSameScopeSelection(selection, selectedScope),
    isDisabled: Boolean(!node.selectable || externallyDisabled || externalReason),
    disabledReason: externalReason || (!node.selectable ? navigationOnlyReason : ""),
  };
}

/**
 * Manage shared org-tree picker state without inventing hierarchy on the
 * frontend.
 */
export function useOrgScopeTree({
  root = null,
  value = null,
  valueNodeKey = "",
  allowedScopeTypes = [],
  defaultExpandedKeys = [],
  initialSearchValue = "",
  isNodeDisabled = null,
  getNodeDisabledReason = null,
} = {}) {
  const normalizedAllowedScopeTypes = normalizeKeyList(allowedScopeTypes);
  const normalizedDefaultExpandedKeys = normalizeKeyList(defaultExpandedKeys);
  const scopedRoot = filterOrgScopeTreeByAllowedScopeTypes(root, normalizedAllowedScopeTypes);
  const initialExpandedKeys = buildOrgScopeTreeInitialExpandedKeys(
    scopedRoot,
    normalizedDefaultExpandedKeys
  );
  const initialExpandedKeysSeed = buildExpandedKeysSeed(initialExpandedKeys);
  const [searchValue, setSearchValue] = useState(() => String(initialSearchValue || ""));
  const [expandedState, setExpandedState] = useState(() => ({
    seed: initialExpandedKeysSeed,
    keys: new Set(initialExpandedKeys),
  }));
  const deferredSearchValue = useDeferredValue(searchValue);
  const visibleRoot = filterOrgScopeTreeBySearchTerm(scopedRoot, deferredSearchValue);
  const allExpandableKeys = collectOrgScopeTreeExpandableKeys(scopedRoot);
  const searchExpandedKeys = new Set(collectOrgScopeTreeExpandableKeys(visibleRoot));
  const isSearchActive = Boolean(normalizeSearchTerm(deferredSearchValue));
  const expandedKeys = resolveExpandedKeys(
    expandedState,
    initialExpandedKeys,
    initialExpandedKeysSeed
  );
  // Search always opens matching branches so filtering never hides the path to
  // an otherwise valid scope selection.
  const effectiveExpandedKeys = isSearchActive ? searchExpandedKeys : expandedKeys;
  const visibleNodeCount = countTreeNodes(visibleRoot);
  const selectedNode = findOrgScopeTreeNodeByScopeSelection(scopedRoot, value, valueNodeKey);
  const selectedPathLabels = Array.isArray(selectedNode?.pathLabels)
    ? selectedNode.pathLabels
    : [];
  const hasSearchResults = (() => {
    if (!isOrgScopeTreeNode(visibleRoot)) {
      return false;
    }

    if (!isSearchActive) {
      return visibleNodeCount > 0;
    }

    let matched = false;
    walkOrgScopeTree(visibleRoot, (node) => {
      if (!matched && doesOrgScopeTreeNodeMatchSearch(node, deferredSearchValue)) {
        matched = true;
      }
    });
    return matched;
  })();

  function toggleExpanded(key) {
    setExpandedState((currentState) => ({
      seed: initialExpandedKeysSeed,
      keys: toggleOrgScopeTreeExpandedKey(
        resolveExpandedKeys(currentState, initialExpandedKeys, initialExpandedKeysSeed),
        key
      ),
    }));
  }

  function expandAll() {
    setExpandedState({
      seed: initialExpandedKeysSeed,
      keys: new Set(allExpandableKeys),
    });
  }

  function collapseAll() {
    setExpandedState({
      seed: initialExpandedKeysSeed,
      keys: new Set(initialExpandedKeys),
    });
  }

  function getNodeState(node) {
    return resolveOrgScopeTreeNodeState(node, {
      selectedScope: value,
      isNodeDisabled,
      getNodeDisabledReason,
    });
  }

  return {
    root: scopedRoot,
    visibleRoot,
    searchValue,
    deferredSearchValue,
    isSearchActive,
    hasSearchResults,
    visibleNodeCount,
    expandedKeys: effectiveExpandedKeys,
    allExpandableKeys,
    selectedNode,
    selectedPathLabels,
    setSearchValue,
    toggleExpanded,
    expandAll,
    collapseAll,
    getNodeState,
  };
}
