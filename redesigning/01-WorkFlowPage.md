
WorkflowSetup.jsx
import { useState } from "react";
import TopBar from "../components/layout/TopBar";
import WorkflowTypeStep from "../components/workflow/WorkflowTypeStep";
import WorkflowDefinitionStep from "../components/workflow/WorkflowDefinitionStep";
import WorkflowStepsStep from "../components/workflow/WorkflowStepsStep";
import WorkflowAssignmentStep from "../components/workflow/WorkflowAssignmentStep";
import WorkflowReviewStep from "../components/workflow/WorkflowReviewStep";
import WorkflowSummaryPanel from "../components/workflow/WorkflowSummaryPanel";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

const STEPS = [
  { id: 1, label: "Workflow Type",    desc: "Choose the process" },
  { id: 2, label: "Definition",       desc: "Name & code" },
  { id: 3, label: "Approval Steps",   desc: "Who approves" },
  { id: 4, label: "Assignment",       desc: "Where it applies" },
  { id: 5, label: "Review & Activate",desc: "Confirm & save" },
];

export default function WorkflowSetup() {
  const [currentStep, setCurrentStep] = useState(1);
  const [setup, setSetup] = useState({
    processType: null,
    definition: null,
    steps: [],
    assignment: null,
  });

  const patch = (key, value) => setSetup(prev => ({ ...prev, [key]: value }));
  const next = () => setCurrentStep(s => Math.min(s + 1, STEPS.length));
  const back = () => setCurrentStep(s => Math.max(s - 1, 1));
  const goTo = (n) => { if (n <= currentStep || isStepReachable(n)) setCurrentStep(n); };

  function isStepReachable(n) {
    if (n === 1) return true;
    if (n === 2) return !!setup.processType;
    if (n === 3) return !!setup.definition;
    if (n === 4) return setup.steps.length > 0;
    if (n === 5) return !!setup.assignment;
    return false;
  }

  return (
    <div>
      <TopBar title="Workflow Setup" />
      <div className="p-6 max-w-7xl space-y-6">

        {/* Page intro */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Set up an approval workflow</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Define who must approve AP postings, period closes, consolidations, and local close packs — and where those rules apply.
              </p>
            </div>
            <div className="bg-muted/50 rounded-xl px-4 py-2 text-sm text-center shrink-0">
              <span className="font-bold text-primary">{currentStep}</span>
              <span className="text-muted-foreground"> of {STEPS.length}</span>
              <p className="text-xs text-muted-foreground">steps complete</p>
            </div>
          </div>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {STEPS.map((step, i) => {
            const done = currentStep > step.id;
            const active = currentStep === step.id;
            const reachable = step.id <= currentStep || isStepReachable(step.id);
            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => goTo(step.id)}
                  disabled={!reachable}
                  className={cn(
                    "flex flex-col items-center px-3 py-2 rounded-xl transition-all min-w-[100px] text-center",
                    active ? "bg-primary/10 text-primary" :
                    done ? "text-emerald-600 cursor-pointer hover:bg-muted/50" :
                    reachable ? "text-muted-foreground cursor-pointer hover:bg-muted/50" :
                    "text-muted-foreground/40 cursor-not-allowed"
                  )}>
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold mb-1 transition-all",
                    active ? "bg-primary text-white" :
                    done ? "bg-emerald-100 text-emerald-700" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                  </div>
                  <span className="text-xs font-semibold leading-tight">{step.label}</span>
                  <span className="text-[10px] text-muted-foreground">{step.desc}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn("h-0.5 w-8 shrink-0 mx-1 rounded", done ? "bg-emerald-300" : "bg-border")} />
                )}
              </div>
            );
          })}
        </div>

        {/* Main content + summary panel */}
        <div className="flex flex-col xl:flex-row gap-5">
          <div className="flex-1 min-w-0">
            {currentStep === 1 && (
              <WorkflowTypeStep
                value={setup.processType}
                onChange={v => patch("processType", v)}
                onNext={next}
              />
            )}
            {currentStep === 2 && (
              <WorkflowDefinitionStep
                processType={setup.processType}
                value={setup.definition}
                onChange={v => patch("definition", v)}
                onNext={next}
                onBack={back}
              />
            )}
            {currentStep === 3 && (
              <WorkflowStepsStep
                processType={setup.processType}
                value={setup.steps}
                onChange={v => patch("steps", v)}
                onNext={next}
                onBack={back}
              />
            )}
            {currentStep === 4 && (
              <WorkflowAssignmentStep
                processType={setup.processType}
                value={setup.assignment}
                onChange={v => patch("assignment", v)}
                onNext={next}
                onBack={back}
              />
            )}
            {currentStep === 5 && (
              <WorkflowReviewStep
                setup={setup}
                onBack={back}
                onActivate={() => alert("Workflow activated! (mock)")}
              />
            )}
          </div>

          {/* Summary panel */}
          <div className="xl:w-72 shrink-0">
            <WorkflowSummaryPanel setup={setup} currentStep={currentStep} />
          </div>
        </div>
      </div>
    </div>
  );
}

WorkflowTypeStep.jsx


import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, Clock, Layers, BookOpen } from "lucide-react";

const PROCESS_TYPES = [
  {
    id: "AP_DOCUMENT_POSTING",
    label: "AP Document Posting",
    icon: <FileText className="h-5 w-5" />,
    description: "Approval rules for accounts payable invoices and vendor payments before they are posted to the ledger.",
    recommended: { level: "Country", minApprovers: 1, selfApproval: "Not allowed", permissionCode: "Leave empty" },
    color: "border-blue-200 bg-blue-50 text-blue-700",
    activeColor: "border-blue-500 bg-blue-50 ring-2 ring-blue-300",
  },
  {
    id: "PERIOD_CLOSE",
    label: "Period Close",
    icon: <Clock className="h-5 w-5" />,
    description: "Multi-stage approval chain that governs the monthly accounting close process across organizational levels.",
    recommended: { level: "OU → Legal Entity → Group", minApprovers: 1, selfApproval: "Not allowed", permissionCode: "gl.period.close" },
    color: "border-emerald-200 bg-emerald-50 text-emerald-700",
    activeColor: "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300",
  },
  {
    id: "CONSOLIDATION_RUN",
    label: "Consolidation Run",
    icon: <Layers className="h-5 w-5" />,
    description: "Controls approval of group-level financial consolidation runs before results are published.",
    recommended: { level: "Group", minApprovers: 2, selfApproval: "Not allowed", permissionCode: "gl.consolidation.approve" },
    color: "border-purple-200 bg-purple-50 text-purple-700",
    activeColor: "border-purple-500 bg-purple-50 ring-2 ring-purple-300",
  },
  {
    id: "LOCAL_CLOSE_PACK",
    label: "Local Close Pack",
    icon: <BookOpen className="h-5 w-5" />,
    description: "Approval chain for the local statutory close package before it is submitted to group.",
    recommended: { level: "Legal Entity", minApprovers: 1, selfApproval: "Allowed", permissionCode: "Leave empty" },
    color: "border-amber-200 bg-amber-50 text-amber-700",
    activeColor: "border-amber-500 bg-amber-50 ring-2 ring-amber-300",
  },
];

export default function WorkflowTypeStep({ value, onChange, onNext }) {
  const selected = PROCESS_TYPES.find(p => p.id === value);

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Step 1 — Choose workflow type</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose the business process this workflow will control. Each process type has different approval requirements and default settings.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PROCESS_TYPES.map(pt => (
            <button key={pt.id} onClick={() => onChange(pt.id)}
              className={cn(
                "text-left border rounded-xl p-4 transition-all space-y-2",
                value === pt.id ? pt.activeColor : "border-border bg-card hover:bg-muted/30"
              )}>
              <div className="flex items-center gap-2">
                <span className={cn("h-8 w-8 rounded-lg flex items-center justify-center", pt.color)}>{pt.icon}</span>
                <span className="font-semibold text-sm">{pt.label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{pt.description}</p>
            </button>
          ))}
        </div>

        {/* Recommendation card */}
        {selected && (
          <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recommended setup for {selected.label}
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {Object.entries(selected.recommended).map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <span className="text-xs text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button disabled={!value} onClick={onNext} className="gap-2">
          Continue to Definition <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}


WorkflowDefinitionStep.jsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowRight, ArrowLeft, Copy, CheckCircle2 } from "lucide-react";

const TEMPLATES = {
  AP_DOCUMENT_POSTING: [
    { code: "WF_STD_AP_COUNTRY_V1", name: "Standard AP Country Approval Gate", version: 1 },
    { code: "WF_SIMPLE_AP_LE_V1",   name: "Simple AP Legal Entity Gate", version: 1 },
  ],
  PERIOD_CLOSE: [
    { code: "WF_3STEP_PERIOD_CLOSE_V1", name: "3-Step Period Close Chain", version: 1 },
  ],
  CONSOLIDATION_RUN: [
    { code: "WF_GROUP_CONSOL_V1", name: "Group Consolidation Approval", version: 1 },
  ],
  LOCAL_CLOSE_PACK: [
    { code: "WF_LOCAL_CLOSE_LE_V1", name: "Local Close Pack — Legal Entity Gate", version: 1 },
  ],
};

const FieldBlock = ({ label, hint, example, children, error }) => (
  <div className="space-y-1.5">
    <label className="text-sm font-semibold">{label}</label>
    <p className="text-xs text-muted-foreground">{hint}</p>
    {children}
    {example && <p className="text-xs text-muted-foreground italic">Example: {example}</p>}
    {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
  </div>
);

export default function WorkflowDefinitionStep({ processType, value, onChange, onNext, onBack }) {
  const templates = TEMPLATES[processType] || [];
  const [mode, setMode] = useState("template"); // template | new
  const [form, setForm] = useState({ code: "", name: "", version: 1, active: true });
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (value) { setForm(value); setSaved(true); }
  }, []);

  const patch = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    const e = {};
    if (!form.code.trim()) e.code = "Workflow code is required.";
    if (!form.name.trim()) e.name = "Workflow name is required.";
    if (!form.version || form.version < 1) e.version = "Version must be 1 or higher.";
    setErrors(e);
    if (Object.keys(e).length) return;
    onChange(form);
    setSaved(true);
  }

  function applyTemplate(t) {
    setForm({ ...t, active: true });
    setSaved(false);
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-base">Step 2 — Create or select a workflow</h3>
          <p className="text-sm text-muted-foreground mt-1">
            A <strong>workflow</strong> is the approval recipe — it defines who must approve and in what order. Give it a stable code and a clear name.
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 bg-muted/40 border border-border rounded-xl p-1 w-fit">
          {[["template","Start from template"],["new","Create from scratch"]].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)}
              className={cn("px-4 py-1.5 text-sm rounded-lg font-medium transition-all",
                mode === k ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              )}>{l}</button>
          ))}
        </div>

        {/* Template list */}
        {mode === "template" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Templates for this process type:</p>
            {templates.map(t => (
              <div key={t.code} className={cn("flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
                form.code === t.code ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
              )}>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{t.code} · v{t.version}</p>
                </div>
                <Button size="sm" variant={form.code === t.code ? "default" : "outline"} onClick={() => applyTemplate(t)}
                  className="gap-1.5 shrink-0">
                  <Copy className="h-3.5 w-3.5" /> Use this
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-border">
          <FieldBlock label="Workflow Code" hint="A stable internal identifier. Do not change this after activation." example="WF_STD_AP_COUNTRY_V1" error={errors.code}>
            <Input value={form.code} onChange={e => { patch("code", e.target.value); setSaved(false); }} placeholder="WF_STD_AP_COUNTRY_V1" />
          </FieldBlock>

          <FieldBlock label="Workflow Name" hint="A short, human-friendly title shown to admins and reviewers." example="Standard AP Country Approval Gate" error={errors.name}>
            <Input value={form.name} onChange={e => { patch("name", e.target.value); setSaved(false); }} placeholder="Standard AP Country Approval Gate" />
          </FieldBlock>

          <FieldBlock label="Version" hint="Use 1 for a new workflow. Increment only when making a significant structural change." example="1" error={errors.version}>
            <Input type="number" min={1} value={form.version} onChange={e => { patch("version", parseInt(e.target.value)); setSaved(false); }} />
          </FieldBlock>

          <FieldBlock label="Status" hint="Only active workflows can be assigned. Keep inactive while still building.">
            <div className="flex gap-2">
              {["Active","Inactive"].map(s => (
                <button key={s} onClick={() => { patch("active", s === "Active"); setSaved(false); }}
                  className={cn("flex-1 py-2 text-sm rounded-lg border font-medium transition-all",
                    (form.active && s === "Active") || (!form.active && s === "Inactive")
                      ? s === "Active" ? "bg-emerald-500 text-white border-emerald-500" : "bg-muted border-border text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}>{s}</button>
              ))}
            </div>
          </FieldBlock>
        </div>

        {saved && (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Workflow saved. <strong>Next:</strong> define who must approve in Step 3.
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave}>Save definition</Button>
          <Button disabled={!saved} onClick={onNext} className="gap-2">Continue to Approval Steps <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

WorkflowStepsStep.jsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowRight, ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, CheckCircle2, Info } from "lucide-react";

const LEVELS = ["Operating Unit", "Legal Entity", "Country", "Group", "Tenant"];

const DEFAULT_STEPS_BY_PROCESS = {
  AP_DOCUMENT_POSTING:  [{ level: "Country", minApprovers: 1, selfApproval: false, permissionCode: "", escalateAfterHours: "" }],
  PERIOD_CLOSE:         [
    { level: "Operating Unit", minApprovers: 1, selfApproval: false, permissionCode: "gl.period.close", escalateAfterHours: "" },
    { level: "Legal Entity",   minApprovers: 1, selfApproval: false, permissionCode: "gl.period.close", escalateAfterHours: "" },
    { level: "Group",          minApprovers: 1, selfApproval: false, permissionCode: "gl.period.close", escalateAfterHours: "" },
  ],
  CONSOLIDATION_RUN: [{ level: "Group", minApprovers: 2, selfApproval: false, permissionCode: "gl.consolidation.approve", escalateAfterHours: "48" }],
  LOCAL_CLOSE_PACK:  [{ level: "Legal Entity", minApprovers: 1, selfApproval: true, permissionCode: "", escalateAfterHours: "" }],
};

function stepSentence(s, i) {
  return `Step ${i+1}: Requires ${s.minApprovers} ${s.level}-level approver${s.minApprovers > 1 ? "s" : ""}. ${s.selfApproval ? "Submitter may approve their own item." : "Submitter cannot approve their own item."}${s.permissionCode ? ` Reviewer must have permission: "${s.permissionCode}".` : ""}`;
}

function StepCard({ step, index, onChange, onRemove, canRemove }) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">{index + 1}</span>
          <span className="font-semibold text-sm">Step {index + 1}</span>
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-muted-foreground hover:text-red-500 transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Plain language preview */}
        <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-xs text-primary">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{stepSentence(step, index)}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Approval Level</label>
            <p className="text-xs text-muted-foreground">The organizational level where an approver must sit.</p>
            <select value={step.level} onChange={e => onChange({ ...step, level: e.target.value })}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:ring-1 focus:ring-ring focus:outline-none appearance-none cursor-pointer">
              {LEVELS.map(l => <option key={l}>{l}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Minimum Approvers</label>
            <p className="text-xs text-muted-foreground">How many people must approve at this stage. Usually 1.</p>
            <Input type="number" min={1} value={step.minApprovers}
              onChange={e => onChange({ ...step, minApprovers: parseInt(e.target.value) || 1 })} />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-semibold">Can the submitter approve their own item?</label>
            <p className="text-xs text-muted-foreground">Set to <em>No</em> when the approver must be a different person from the submitter.</p>
            <div className="flex gap-2">
              {[["Yes", true],["No", false]].map(([label, val]) => (
                <button key={label} onClick={() => onChange({ ...step, selfApproval: val })}
                  className={cn("flex-1 py-2 rounded-lg border text-sm font-medium transition-all",
                    step.selfApproval === val
                      ? val ? "bg-emerald-500 text-white border-emerald-500" : "bg-red-500 text-white border-red-500"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced toggle */}
        <button onClick={() => setAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
          {advanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Advanced settings
        </button>

        {advanced && (
          <div className="space-y-4 pt-2 border-t border-border">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Required Reviewer Permission</label>
              <p className="text-xs text-muted-foreground">
                The permission code an approver must hold. For AP Document Posting, leave this empty — reviewer authority comes from the workflow assignment.
              </p>
              <Input value={step.permissionCode} placeholder="e.g. gl.period.close (leave empty for AP)"
                onChange={e => onChange({ ...step, permissionCode: e.target.value })} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold">Escalate after (hours)</label>
              <p className="text-xs text-muted-foreground">If no approval is given within this many hours, escalate. Leave empty to disable.</p>
              <Input type="number" min={1} value={step.escalateAfterHours} placeholder="e.g. 24"
                onChange={e => onChange({ ...step, escalateAfterHours: e.target.value })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkflowStepsStep({ processType, value, onChange, onNext, onBack }) {
  const [steps, setSteps] = useState(value.length ? value : (DEFAULT_STEPS_BY_PROCESS[processType] || [{ level: "Country", minApprovers: 1, selfApproval: false, permissionCode: "", escalateAfterHours: "" }]));
  const [saved, setSaved] = useState(false);

  const updateStep = (i, updated) => { const s = [...steps]; s[i] = updated; setSteps(s); setSaved(false); };
  const addStep = () => { setSteps([...steps, { level: "Country", minApprovers: 1, selfApproval: false, permissionCode: "", escalateAfterHours: "" }]); setSaved(false); };
  const removeStep = (i) => { setSteps(steps.filter((_, idx) => idx !== i)); setSaved(false); };

  function handleSave() {
    onChange(steps);
    setSaved(true);
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-base">Step 3 — Define approval steps</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Each step defines <strong>who must approve</strong> at a specific organizational level and in what order. The steps run sequentially — step 1 must be complete before step 2 begins.
          </p>
        </div>

        {/* Workflow-level preview sentence */}
        {steps.length > 0 && (
          <div className="bg-muted/40 border border-border rounded-xl p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Workflow preview</p>
            <p className="text-sm text-foreground">This workflow requires:</p>
            <ol className="mt-1 space-y-0.5 ml-4 list-decimal text-sm text-muted-foreground">
              {steps.map((s, i) => <li key={i}>{s.level} approval ({s.minApprovers} approver{s.minApprovers > 1 ? "s" : ""})</li>)}
            </ol>
          </div>
        )}

        {/* Step cards */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} index={i}
              onChange={u => updateStep(i, u)}
              onRemove={() => removeStep(i)}
              canRemove={steps.length > 1}
            />
          ))}
        </div>

        <Button variant="outline" onClick={addStep} className="gap-2 w-full">
          <Plus className="h-4 w-4" /> Add another approval step
        </Button>

        {saved && (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Steps saved. <strong>Next:</strong> choose where this workflow applies.
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave}>Save steps</Button>
          <Button disabled={!saved} onClick={onNext} className="gap-2">Continue to Assignment <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
WorkflowAssignmentStep.jsx

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowRight, ArrowLeft, CheckCircle2, Globe, Building, MapPin, Layers, LayoutGrid } from "lucide-react";

const SCOPE_TYPES = [
  { id: "Tenant",         icon: <Globe className="h-4 w-4" />,       desc: "Use when the workflow should apply across the entire tenant — all countries, entities, and units." },
  { id: "Group",          icon: <Layers className="h-4 w-4" />,      desc: "Use when the workflow should apply to all entities under a specific group." },
  { id: "Country",        icon: <MapPin className="h-4 w-4" />,      desc: "Use when the workflow should apply to everything under one country, including all legal entities and operating units below it." },
  { id: "Legal Entity",   icon: <Building className="h-4 w-4" />,    desc: "Use when the workflow should apply only to one specific legal entity." },
  { id: "Operating Unit", icon: <LayoutGrid className="h-4 w-4" />,  desc: "Use when the workflow should apply only to one operating unit." },
];

const EXAMPLE_TARGETS = {
  Tenant: ["All Tenant"],
  Group: ["Europe Group", "APAC Group", "Americas Group"],
  Country: ["Afghanistan (AF)", "Turkey (TR)", "Germany (DE)", "United Kingdom (GB)", "France (FR)"],
  "Legal Entity": ["Acme Ltd.", "Delta GmbH", "Sigma SRL", "Atlas Inc."],
  "Operating Unit": ["OU-ISTANBUL-01", "OU-BERLIN-02", "OU-LONDON-03", "OU-PARIS-04"],
};

export default function WorkflowAssignmentStep({ processType, value, onChange, onNext, onBack }) {
  const [form, setForm] = useState(value || { scopeType: "Country", target: "", effectiveFrom: new Date().toISOString().slice(0,10), status: "active" });
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState({});

  const patch = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  function handleSave() {
    const e = {};
    if (!form.target) e.target = "Please select a target.";
    if (!form.effectiveFrom) e.effectiveFrom = "Effective date is required.";
    setErrors(e);
    if (Object.keys(e).length) return;
    onChange(form);
    setSaved(true);
  }

  const scopeConfig = SCOPE_TYPES.find(s => s.id === form.scopeType);
  const targets = EXAMPLE_TARGETS[form.scopeType] || [];

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
        <div>
          <h3 className="font-semibold text-base">Step 4 — Where should this workflow be active?</h3>
          <p className="text-sm text-muted-foreground mt-1">
            An <strong>assignment</strong> connects the workflow to a specific part of your organization. It controls which documents or processes are governed by this approval chain.
          </p>
        </div>

        {/* Scope type selector */}
        <div className="space-y-2">
          <label className="text-sm font-semibold">Applies to</label>
          <p className="text-xs text-muted-foreground">Select the organizational level at which this workflow takes effect.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {SCOPE_TYPES.map(s => (
              <button key={s.id} onClick={() => { patch("scopeType", s.id); patch("target", ""); }}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all",
                  form.scopeType === s.id
                    ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30"
                    : "border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:border-primary/40"
                )}>
                {s.icon}
                {s.id}
              </button>
            ))}
          </div>
          {scopeConfig && (
            <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2 mt-1 italic">
              {scopeConfig.desc}
            </p>
          )}
        </div>

        {/* Target selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold">Selected target</label>
          <p className="text-xs text-muted-foreground">Which specific {form.scopeType.toLowerCase()} should this workflow apply to?</p>
          <div className="relative">
            <select value={form.target} onChange={e => patch("target", e.target.value)}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:ring-1 focus:ring-ring focus:outline-none appearance-none cursor-pointer">
              <option value="">— Select {form.scopeType} —</option>
              {targets.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {errors.target && <p className="text-xs text-red-500 font-medium">{errors.target}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Effective from */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">Effective from</label>
            <p className="text-xs text-muted-foreground">The workflow will begin governing documents on or after this date.</p>
            <Input type="date" value={form.effectiveFrom} onChange={e => patch("effectiveFrom", e.target.value)} />
            {errors.effectiveFrom && <p className="text-xs text-red-500 font-medium">{errors.effectiveFrom}</p>}
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">Assignment status</label>
            <p className="text-xs text-muted-foreground">Only <em>Active</em> assignments govern documents. Use <em>Inactive</em> while still testing.</p>
            <div className="flex gap-2">
              {[["Active","active"],["Inactive","inactive"]].map(([label, val]) => (
                <button key={val} onClick={() => patch("status", val)}
                  className={cn("flex-1 py-2 rounded-lg border text-sm font-medium transition-all",
                    form.status === val
                      ? val === "active" ? "bg-emerald-500 text-white border-emerald-500" : "bg-muted border-border text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Effect preview */}
        {form.target && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Effect of this assignment</p>
            <p className="text-sm text-blue-800">
              This workflow will apply to all governed{" "}
              <strong>{processType?.replace(/_/g, " ").toLowerCase()}</strong> documents under{" "}
              <strong>{form.scopeType} = {form.target}</strong>
              {form.scopeType === "Country" && ", including all legal entities and operating units under this country"}.
            </p>
            <p className="text-xs text-blue-600">Effective from <strong>{form.effectiveFrom}</strong> · Status: <strong>{form.status}</strong></p>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Assignment saved. <strong>Next:</strong> review everything and activate the workflow.
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave}>Save assignment</Button>
          <Button disabled={!saved} onClick={onNext} className="gap-2">Review & Activate <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

WorkflowReviewStep.jsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, FileText, Clock, Layers, BookOpen, Zap } from "lucide-react";

const PROCESS_ICONS = {
  AP_DOCUMENT_POSTING: <FileText className="h-4 w-4" />,
  PERIOD_CLOSE:        <Clock className="h-4 w-4" />,
  CONSOLIDATION_RUN:   <Layers className="h-4 w-4" />,
  LOCAL_CLOSE_PACK:    <BookOpen className="h-4 w-4" />,
};

const PROCESS_LABELS = {
  AP_DOCUMENT_POSTING: "AP Document Posting",
  PERIOD_CLOSE:        "Period Close",
  CONSOLIDATION_RUN:   "Consolidation Run",
  LOCAL_CLOSE_PACK:    "Local Close Pack",
};

function ReviewRow({ label, value, highlight }) {
  return (
    <div className={cn("flex items-start justify-between py-3 border-b border-border last:border-0 gap-4", highlight && "bg-primary/5 -mx-4 px-4 rounded-lg")}>
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-sm font-semibold text-right", highlight && "text-primary")}>{value || "—"}</span>
    </div>
  );
}

export default function WorkflowReviewStep({ setup, onBack, onActivate }) {
  const { processType, definition, steps, assignment } = setup;

  const stepsPreview = steps.length
    ? steps.map((s, i) => `${i+1}. ${s.level} (${s.minApprovers} approver${s.minApprovers > 1 ? "s" : ""})`).join(" → ")
    : "No steps defined";

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-base">Step 5 — Review your setup</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Check everything looks correct before activating. Once active, this workflow will govern real approval decisions.
          </p>
        </div>

        {/* Summary sections */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Process */}
          <div className="border border-border rounded-xl p-4 space-y-0">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                {PROCESS_ICONS[processType] || <FileText className="h-4 w-4" />}
              </span>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Workflow type</p>
            </div>
            <p className="font-bold text-base">{PROCESS_LABELS[processType] || processType}</p>
          </div>

          {/* Definition */}
          <div className="border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Workflow definition</p>
            <p className="font-bold">{definition?.name || "—"}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{definition?.code} · v{definition?.version}</p>
            <p className={cn("text-xs font-semibold mt-1", definition?.active ? "text-emerald-600" : "text-muted-foreground")}>
              {definition?.active ? "Active" : "Inactive"}
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Approval steps ({steps.length})</p>
          {steps.length === 0 && <p className="text-sm text-red-500">⚠ No steps defined. Go back and add at least one approval step.</p>}
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
              <span className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i+1}</span>
              <div>
                <p className="text-sm font-semibold">{s.level} — {s.minApprovers} approver{s.minApprovers > 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground">
                  Self-approval: {s.selfApproval ? "Allowed" : "Not allowed"}
                  {s.permissionCode && ` · Permission: ${s.permissionCode}`}
                  {s.escalateAfterHours && ` · Escalate after ${s.escalateAfterHours}h`}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Assignment */}
        <div className="border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Assignment</p>
          {assignment ? (
            <>
              <ReviewRow label="Applies to" value={`${assignment.scopeType} = ${assignment.target}`} highlight />
              <ReviewRow label="Effective from" value={assignment.effectiveFrom} />
              <ReviewRow label="Status" value={assignment.status === "active" ? "✓ Active" : "Inactive"} />
            </>
          ) : (
            <p className="text-sm text-red-500">⚠ No assignment defined. Go back and set where this workflow applies.</p>
          )}
        </div>

        {/* Warnings */}
        {steps.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            ⚠ <strong>Warning:</strong> This workflow has no approval steps. It will not function until at least one step is added.
          </div>
        )}
        {!assignment && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            ⚠ <strong>Warning:</strong> No assignment has been saved. The workflow won't govern any documents until it's assigned.
          </div>
        )}

        {/* Activate */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-800">Ready to activate?</p>
              <p className="text-sm text-emerald-700 mt-0.5">
                Once activated, this workflow will begin governing{" "}
                <strong>{PROCESS_LABELS[processType]}</strong> documents under{" "}
                <strong>{assignment?.scopeType} = {assignment?.target}</strong> from{" "}
                <strong>{assignment?.effectiveFrom}</strong>.
              </p>
            </div>
          </div>
          <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={steps.length === 0 || !assignment}
            onClick={onActivate}>
            <Zap className="h-4 w-4" /> Save and Activate Workflow
          </Button>
        </div>
      </div>

      <div className="flex justify-start">
        <Button variant="outline" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to Assignment</Button>
      </div>
    </div>
  );
}

WorkflowSummaryPanel.jsx
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle } from "lucide-react";

const PROCESS_LABELS = {
  AP_DOCUMENT_POSTING: "AP Document Posting",
  PERIOD_CLOSE:        "Period Close",
  CONSOLIDATION_RUN:   "Consolidation Run",
  LOCAL_CLOSE_PACK:    "Local Close Pack",
};

function SummaryRow({ label, value, done }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border last:border-0">
      {done
        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
        : <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-semibold truncate", done ? "text-foreground" : "text-muted-foreground/50")}>
          {done ? value : "Not set yet"}
        </p>
      </div>
    </div>
  );
}

export default function WorkflowSummaryPanel({ setup, currentStep }) {
  const { processType, definition, steps, assignment } = setup;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 sticky top-24 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current setup</p>

      <SummaryRow
        label="Workflow type"
        value={PROCESS_LABELS[processType] || processType}
        done={!!processType}
      />
      <SummaryRow
        label="Workflow"
        value={definition?.name}
        done={!!definition}
      />
      <SummaryRow
        label="Approval steps"
        value={`${steps.length} step${steps.length !== 1 ? "s" : ""}: ${steps.map(s => s.level).join(" → ")}`}
        done={steps.length > 0}
      />
      <SummaryRow
        label="Assignment"
        value={assignment ? `${assignment.scopeType} = ${assignment.target}` : ""}
        done={!!assignment}
      />
      <SummaryRow
        label="Status"
        value={assignment?.status === "active" ? "Active" : "Inactive"}
        done={!!assignment}
      />

      {/* Progress bar */}
      <div className="pt-2">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Setup progress</span>
          <span>{Math.round(([processType, definition, steps.length > 0, assignment].filter(Boolean).length / 4) * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${([processType, definition, steps.length > 0, assignment].filter(Boolean).length / 4) * 100}%` }}
          />
        </div>
      </div>

      {/* Quick help */}
      <div className="bg-muted/40 rounded-xl p-3 space-y-1.5 text-xs text-muted-foreground mt-1">
        <p className="font-semibold text-foreground text-xs">Quick guide</p>
        <p>A <strong>workflow</strong> is the approval recipe.</p>
        <p><strong>Steps</strong> define who approves and in what order.</p>
        <p>An <strong>assignment</strong> decides where the workflow is active.</p>
      </div>
    </div>
  );
}