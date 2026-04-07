import { useEffect, useId, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buildOrgScopeTreePathLabelText } from "../../shared/orgScopeTree.js";
import { useOrgScopeTree } from "./useOrgScopeTree.js";

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function OrgScopeTreeBranch({
  node,
  depth,
  treeId,
  controller,
  onSelect,
  showNodeBreadcrumbs,
}) {
  const nodeState = controller.getNodeState(node);
  const isExpanded = controller.expandedKeys.has(node.key);
  const hasChildren = node.children.length > 0;
  const breadcrumbText = buildOrgScopeTreePathLabelText(node.pathLabels);
  const breadcrumbSummary =
    depth > 0 && breadcrumbText ? breadcrumbText : "";

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={nodeState.isSelected}
      aria-disabled={nodeState.isDisabled}
      className="list-none"
    >
      <div
        className="rounded-xl transition-colors"
        style={{ paddingInlineStart: `${depth * 18}px` }}
      >
        <div className="flex items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => controller.toggleExpanded(node.key)}
            disabled={!hasChildren || controller.isSearchActive}
            aria-label={isExpanded ? "Collapse branch" : "Expand branch"}
            aria-controls={`${treeId}-${node.key}`}
            className="mt-1 shrink-0"
          >
            {hasChildren && isExpanded ? <ChevronDown /> : <ChevronRight />}
          </Button>

          <button
            type="button"
            onClick={() => onSelect(node)}
            disabled={nodeState.isDisabled || !nodeState.selection}
            title={breadcrumbText}
            className={cn(
              "flex-1 rounded-xl border px-3 py-2 text-left transition-colors",
              nodeState.isSelected
                ? "border-primary/50 bg-primary/5 shadow-sm"
                : "border-border bg-background hover:border-primary/30 hover:bg-muted/40",
              nodeState.isDisabled && "cursor-not-allowed opacity-70"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{node.label}</span>
              {node.code ? <Badge variant="outline">{node.code}</Badge> : null}
              <Badge variant={nodeState.isSelected ? "default" : "secondary"}>
                {node.scopeType}
              </Badge>
            </div>

            {showNodeBreadcrumbs && breadcrumbSummary ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {breadcrumbSummary}
              </div>
            ) : null}

            {nodeState.isDisabled && nodeState.disabledReason ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {nodeState.disabledReason}
              </div>
            ) : null}
          </button>
        </div>
      </div>

      {hasChildren && isExpanded ? (
        <ul
          id={`${treeId}-${node.key}`}
          role="group"
          className="mt-1 space-y-1"
        >
          {node.children.map((childNode) => (
            <OrgScopeTreeBranch
              key={childNode.key}
              node={childNode}
              depth={depth + 1}
              treeId={treeId}
              controller={controller}
              onSelect={onSelect}
              showNodeBreadcrumbs={showNodeBreadcrumbs}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Render a reusable picker for canonical backend org-tree scope selection.
 */
export default function OrgScopeTreePicker({
  root = null,
  value = null,
  valueNodeKey = "",
  onChange,
  allowedScopeTypes = [],
  defaultExpandedKeys = [],
  isNodeDisabled = null,
  getNodeDisabledReason = null,
  className = "",
  title = "Scope tree",
  description = "Browse and select a tenant scope from the canonical org tree.",
  searchPlaceholder = "Search by code, name, or ISO2",
  emptyText = "No org tree is available for this tenant.",
  noResultsText = "No matching scopes found.",
  showBreadcrumbs = true,
}) {
  const treeId = useId();
  const [internalValueNodeKey, setInternalValueNodeKey] = useState("");
  const effectiveValueNodeKey = normalizeText(valueNodeKey || internalValueNodeKey);
  const controller = useOrgScopeTree({
    root,
    value,
    valueNodeKey: effectiveValueNodeKey,
    allowedScopeTypes,
    defaultExpandedKeys,
    isNodeDisabled,
    getNodeDisabledReason,
  });
  const selectedBreadcrumbText = buildOrgScopeTreePathLabelText(controller.selectedPathLabels);

  useEffect(() => {
    if (!value) {
      setInternalValueNodeKey("");
    }
  }, [value]);

  function handleSelect(node) {
    const nodeState = controller.getNodeState(node);
    if (nodeState.isDisabled || !nodeState.selection) {
      return;
    }
    setInternalValueNodeKey(node.key);
    if (typeof onChange === "function") {
      onChange(nodeState.selection, node);
    }
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={controller.expandAll}
              disabled={controller.isSearchActive || controller.allExpandableKeys.length === 0}
            >
              <ChevronsDown />
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={controller.collapseAll}
              disabled={controller.isSearchActive || controller.allExpandableKeys.length === 0}
            >
              <ChevronsUp />
              Collapse all
            </Button>
          </div>
        </div>

        {showBreadcrumbs && controller.selectedNode ? (
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Selected path
            </div>
            <div className="mt-1 text-sm text-foreground">
              {selectedBreadcrumbText || controller.selectedNode.label}
            </div>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={controller.searchValue}
            onChange={(event) => controller.setSearchValue(event.target.value)}
            placeholder={searchPlaceholder}
            className="px-8"
          />
          {controller.searchValue ? (
            <button
              type="button"
              onClick={() => controller.setSearchValue("")}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {controller.isSearchActive ? (
          <div className="text-xs text-muted-foreground">
            Search expands matching branches automatically.
          </div>
        ) : null}

        {!controller.root ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : !controller.hasSearchResults ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            {noResultsText}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-background p-2">
            <ul role="tree" className="space-y-1">
              <OrgScopeTreeBranch
                node={controller.visibleRoot}
                depth={0}
                treeId={treeId}
                controller={controller}
                onSelect={handleSelect}
                showNodeBreadcrumbs={showBreadcrumbs}
              />
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
