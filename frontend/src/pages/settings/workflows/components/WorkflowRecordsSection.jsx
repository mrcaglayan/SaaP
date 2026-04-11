import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Displays saved workflow definitions and assignments below the guided editor.
 */
export default function WorkflowRecordsSection({
  l,
  definitions,
  assignments,
  loading,
  selectedDefinitionId,
  onSelectDefinition,
  onToggleAssignmentStatus,
  getWorkflowTypeLabel,
  defaultTab = "workflows",
}) {
  return (
    <Card className="rounded-3xl">
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>{l("Existing workflow records", "Mevcut workflow kayitlari")}</CardTitle>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {l(
              "Existing workflow definitions and assignments live here so they do not compete with the guided setup flow.",
              "Mevcut workflow tanimlari ve atamalari, yonlendirmeli kurulum akisiyla rekabet etmemesi icin burada ayrica gosterilir."
            )}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue={defaultTab} className="gap-4">
          <TabsList>
            <TabsTrigger value="workflows">{l("Workflows", "Workflow'lar")}</TabsTrigger>
            <TabsTrigger value="assignments">{l("Assignments", "Atamalar")}</TabsTrigger>
          </TabsList>

          <TabsContent value="workflows" className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">{l("Code", "Kod")}</th>
                    <th className="px-4 py-3">{l("Name", "Ad")}</th>
                    <th className="px-4 py-3">{l("Type", "Tur")}</th>
                    <th className="px-4 py-3">{l("Steps", "Adimlar")}</th>
                    <th className="px-4 py-3">{l("Action", "Islem")}</th>
                  </tr>
                </thead>
                <tbody>
                  {definitions.map((row) => {
                    const selected = String(row.id) === String(selectedDefinitionId);

                    return (
                      <tr
                        key={row.id}
                        className={selected ? "border-t border-border bg-primary/5" : "border-t border-border/70"}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{row.code}</td>
                        <td className="px-4 py-3 text-foreground">{row.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">
                            {getWorkflowTypeLabel(row.processType)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{Number(row.stepCount || 0)}</td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant={selected ? "default" : "outline"}
                            size="sm"
                            onClick={() => onSelectDefinition(row.id)}
                          >
                            {selected ? l("Selected", "Secili") : l("Select", "Sec")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}

                  {!loading && definitions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                        {l("No workflows found.", "Workflow bulunamadi.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="assignments" className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">{l("Type", "Tur")}</th>
                    <th className="px-4 py-3">{l("Workflow", "Workflow")}</th>
                    <th className="px-4 py-3">{l("Scope", "Kapsam")}</th>
                    <th className="px-4 py-3">{l("Status", "Durum")}</th>
                    <th className="px-4 py-3">{l("Action", "Islem")}</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((row) => (
                    <tr key={row.id} className="border-t border-border/70">
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{getWorkflowTypeLabel(row.processType)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {row.workflowDefinitionCode} - {row.workflowDefinitionName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.scopeLabel}</td>
                      <td className="px-4 py-3">
                        <Badge variant={row.status === "ACTIVE" ? "default" : "outline"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onToggleAssignmentStatus(row)}
                          disabled={!row.canToggleStatus || row.isSaving}
                        >
                          {row.isSaving
                            ? l("Saving...", "Kaydediliyor...")
                            : row.status === "ACTIVE"
                              ? l("Set inactive", "Pasif yap")
                              : l("Set active", "Aktif yap")}
                        </Button>
                      </td>
                    </tr>
                  ))}

                  {!loading && assignments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                        {l("No assignments found.", "Atama bulunamadi.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
