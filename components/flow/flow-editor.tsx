"use client";

import "@xyflow/react/dist/style.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import {
  connectStep,
  disconnectTarget,
  stepOutputs,
  validateFlow,
  type Flow,
  type FlowStep,
  type FlowStepType,
} from "@/lib/flows/types";
import { ADDABLE_STEPS, STEP_TITLES, createStep } from "./flow-meta";
import { FlowStatsContext, nodeTypes, stepLabel, TriggerSummaryContext, type StepNode, type TriggerSummary } from "./flow-nodes";
import type { FlowStepStats } from "@/lib/flows/stats";
import type { MessageDefaults } from "@/lib/message-defaults";
import FlowInspector from "./flow-inspector";
import FlowPreview from "./flow-preview";

type CampaignInfo = {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
  username: string | null;
  keywords: string[];
  matchAnyWord: boolean;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
  publicReplyEnabled: boolean;
};

type Loaded = {
  messageDefaults?: MessageDefaults;
  flow: Flow;
  formFlow: Flow;
  derived: boolean;
  flowEnabled: boolean;
  flowSavedAt: string | null;
  campaign: CampaignInfo;
};

type Dims = Record<string, { width: number; height: number }>;
type AddMenu = { x: number; y: number; flowPos: { x: number; y: number }; from?: { source: string; handle: string } };

const EDGE_STYLE = { stroke: "#94a3b8", strokeWidth: 2 };

function Editor({ data, onSaved }: { data: Loaded; onSaved: (savedAt: string) => void }) {
  const { t } = useI18n();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fitted = useRef(false);
  const [flow, setFlow] = useState<Flow>(data.flow);

  // Frame the whole flow once every card has been measured.
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return;
    fitted.current = true;
    // Long flows open on their beginning at a readable size, like reading
    // left to right; the rest is a scroll or a zoom-out away.
    const firstSteps = [...flow.steps]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      // Fewer cards on a phone, so the first ones stay readable.
      .slice(0, (document.querySelector(".react-flow")?.clientWidth ?? 1000) < 640 ? 2 : 4)
      .map((s) => ({ id: s.id }));
    requestAnimationFrame(() => fitView({ nodes: firstSteps, padding: 0.12, maxZoom: 1 }));
    // Runs once, on the steps as first loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, fitView]);
  const [derived, setDerived] = useState(data.derived);
  const [enabled, setEnabled] = useState(data.flowEnabled);
  const [switching, setSwitching] = useState(false);
  const [dims, setDims] = useState<Dims>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [menu, setMenu] = useState<AddMenu | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, FlowStepStats> | null>(null);

  const { campaign } = data;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/instagram/profile?${new URLSearchParams({ instagramAccountId: campaign.instagramAccountId })}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAvatarUrl(d.success ? d.data.profilePictureUrl ?? null : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaign.instagramAccountId]);

  // Per-card numbers. Shown once the campaign has run on its steps (or ever
  // did); a canvas that never ran would only show zeros.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/automations/flow/stats?id=${campaign.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.success) return;
        const steps = d.data.steps as Record<string, FlowStepStats>;
        setStats(Object.keys(steps).length > 0 || data.flowEnabled ? steps : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaign.id, data.flowEnabled]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = useCallback((fn: (f: Flow) => Flow) => {
    setFlow((f) => fn(f));
    setDirty(true);
    setMessage(null);
  }, []);

  const replaceStep = useCallback(
    (step: FlowStep) => update((f) => ({ ...f, steps: f.steps.map((s) => (s.id === step.id ? step : s)) })),
    [update]
  );

  const deleteSteps = useCallback(
    (ids: string[]) => {
      const removable = ids.filter((id) => flow.steps.find((s) => s.id === id)?.type !== "trigger");
      if (removable.length === 0) return;
      update((f) => ({
        ...f,
        steps: f.steps
          .filter((s) => !removable.includes(s.id))
          .map((s) => removable.reduce((acc, id) => disconnectTarget(acc, id), s)),
      }));
      if (selectedId && removable.includes(selectedId)) setSelectedId(null);
    },
    [flow.steps, selectedId, update]
  );

  // Card titles: messages are numbered in canvas order (left to right).
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    let n = 0;
    [...flow.steps]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((s) => {
        if (s.type === "message") n += 1;
        map.set(s.id, stepLabel(s, n, t));
      });
    return map;
  }, [flow.steps, t]);

  const nodes: StepNode[] = useMemo(
    () =>
      flow.steps.map((s) => ({
        id: s.id,
        type: "step" as const,
        position: s.position,
        data: { step: s, label: labels.get(s.id) ?? "" },
        selected: s.id === selectedId,
        deletable: s.type !== "trigger",
        ...(dims[s.id] ? { measured: dims[s.id] } : {}),
      })),
    [flow.steps, labels, selectedId, dims]
  );

  const edges: Edge[] = useMemo(
    () =>
      flow.steps.flatMap((s) =>
        stepOutputs(s)
          .filter((o) => o.target)
          .map((o) => {
            const id = `${s.id}::${o.handle}`;
            return {
              id,
              source: s.id,
              sourceHandle: o.handle,
              target: o.target as string,
              targetHandle: "in",
              selected: id === selectedEdge,
              style: id === selectedEdge ? { ...EDGE_STYLE, stroke: "#f97316" } : EDGE_STYLE,
              markerEnd: { type: MarkerType.ArrowClosed, color: id === selectedEdge ? "#f97316" : "#94a3b8" },
            };
          })
      ),
    [flow.steps, selectedEdge]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]) => {
      const moved = new Map<string, { x: number; y: number }>();
      const removed: string[] = [];
      const newDims: Dims = {};
      for (const c of changes) {
        if (c.type === "position" && c.position) moved.set(c.id, c.position);
        if (c.type === "remove") removed.push(c.id);
        if (c.type === "dimensions" && c.dimensions) newDims[c.id] = c.dimensions;
        if (c.type === "select") {
          if (c.selected) {
            setSelectedId(c.id);
            setSelectedEdge(null);
          } else setSelectedId((cur) => (cur === c.id ? null : cur));
        }
      }
      if (Object.keys(newDims).length) setDims((d) => ({ ...d, ...newDims }));
      if (moved.size) {
        update((f) => ({
          ...f,
          steps: f.steps.map((s) => (moved.has(s.id) ? { ...s, position: moved.get(s.id) as { x: number; y: number } } : s)),
        }));
      }
      if (removed.length) deleteSteps(removed);
    },
    [deleteSteps, update]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "select") setSelectedEdge(c.selected ? c.id : null);
        if (c.type === "remove") {
          const [source, handle] = c.id.split("::");
          update((f) => ({
            ...f,
            steps: f.steps.map((s) => (s.id === source ? connectStep(s, handle, undefined) : s)),
          }));
          setSelectedEdge(null);
        }
      }
    },
    [update]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || c.source === c.target) return;
      update((f) => ({
        ...f,
        steps: f.steps.map((s) => (s.id === c.source ? connectStep(s, c.sourceHandle as string, c.target) : s)),
      }));
    },
    [update]
  );

  // Dropping an arrow on empty canvas offers to create the next step there.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || !state.fromHandle?.id || state.fromHandle.type !== "source") return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      setMenu({
        x: point.clientX,
        y: point.clientY,
        flowPos: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        from: { source: state.fromNode.id, handle: state.fromHandle.id },
      });
    },
    [screenToFlowPosition]
  );

  function addStep(type: FlowStepType, at: AddMenu) {
    const step = createStep(type, { x: at.flowPos.x, y: at.flowPos.y - 30 }, data.messageDefaults);
    update((f) => ({
      ...f,
      steps: [
        ...f.steps.map((s) => (at.from && s.id === at.from.source ? connectStep(s, at.from.handle, step.id) : s)),
        step,
      ],
    }));
    setSelectedId(step.id);
    setMenu(null);
  }

  function openAddMenuFromToolbar(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    const center = canvas
      ? screenToFlowPosition({ x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 })
      : { x: 0, y: 0 };
    setMenu({ x: rect.left, y: rect.bottom + 6, flowPos: center });
  }

  async function save() {
    const problems = validateFlow(flow);
    if (problems.length) {
      setMessage({ tone: "error", text: t(problems[0] as StaticMessageKey) });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/automations/flow?id=${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || "Save failed");
      setDirty(false);
      setDerived(false);
      setMessage({ tone: "ok", text: t("Saved.") });
      onSaved(new Date().toISOString());
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("Save failed") });
    } finally {
      setSaving(false);
    }
  }

  async function toggleEngine() {
    const next = !enabled;
    if (next && (dirty || derived)) {
      setMessage({ tone: "error", text: t("Save the canvas before switching it on.") });
      return;
    }
    const question = next
      ? t("Switch this campaign to its steps? From now on it sends what the canvas shows.")
      : t("Switch back to the form settings? The campaign sends what it did before the canvas.");
    if (!window.confirm(question)) return;
    setSwitching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/automations/flow?id=${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowEnabled: next }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || "Error");
      setEnabled(next);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Error";
      setMessage({ tone: "error", text: t(text as StaticMessageKey) || text });
    } finally {
      setSwitching(false);
    }
  }

  function resetFromForm() {
    if (!window.confirm(t("Redraw the canvas from the campaign settings? Unsaved canvas changes are lost."))) return;
    setFlow(data.formFlow);
    setSelectedId(null);
    setDirty(true);
  }

  const selected = flow.steps.find((s) => s.id === selectedId) ?? null;
  // After a comment Instagram allows one private reply until the person taps
  // or writes back: a first message without a button stalls what follows.
  const firstStep = flow.steps.find((s) => s.id === flow.steps.find((x) => x.type === "trigger")?.next);
  const stallsAfterComment =
    firstStep?.type === "message" && !firstStep.buttons.some((b) => b.kind === "step") && Boolean(firstStep.next);
  const trigger: TriggerSummary = {
    keywords: campaign.keywords,
    matchAnyWord: campaign.matchAnyWord,
    scope: campaign.matchAnyPost ? "any" : campaign.pendingNextReel ? "next" : "specific",
    dmTriggerEnabled: campaign.dmTriggerEnabled,
    publicReplyEnabled: campaign.publicReplyEnabled,
  };
  // Restart the simulation whenever what it plays changes (not on drag).
  const previewKey = JSON.stringify(flow.steps.map((s) => ({ ...s, position: null })));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/campaigns/${campaign.id}`} className="text-xs text-muted hover:text-foreground">
            ← {t("Back to the campaign")}
          </Link>
          <h1 className="truncate text-lg font-semibold text-foreground">
            {campaign.name} <span className="font-normal text-muted">· {t("Steps")}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {message && (
            <span className={`text-sm ${message.tone === "error" ? "text-error" : "text-success"}`}>{message.text}</span>
          )}
          {!derived && (
            <button onClick={resetFromForm} className="whitespace-nowrap rounded-lg border border-border px-2.5 py-2 text-xs text-muted hover:text-foreground sm:px-3 sm:text-sm">
              {t("Redraw from settings")}
            </button>
          )}
          <button
            onClick={toggleEngine}
            disabled={switching}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-2 text-xs disabled:opacity-50 sm:px-3 sm:text-sm ${
              enabled ? "border-success/40 bg-success/10 text-success" : "border-border text-muted hover:text-foreground"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${enabled ? "bg-success" : "bg-zinc-300"}`} />
            {enabled ? t("Steps on") : t("Steps off")}
          </button>
          <button
            onClick={save}
            disabled={saving || (!dirty && !derived)}
            className="whitespace-nowrap rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:px-4 sm:text-sm"
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>

      {enabled ? (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {t("Live: this campaign sends what the canvas shows. Saved changes apply right away.")}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {derived
            ? t("Drawn from this campaign's current settings. Nothing is saved until you click Save.")
            : t("Draft: the campaign keeps sending exactly as before until the step engine is switched on.")}
        </div>
      )}
      {stallsAfterComment && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {t("After a comment, Instagram allows a single message until the person taps or replies. Add a button to the first message so the next steps can follow.")}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="relative h-[62vh] min-h-[460px] w-full lg:min-w-0 lg:flex-1 overflow-hidden rounded-xl border border-border bg-slate-50 lg:h-[calc(100vh-14rem)]">
          <FlowStatsContext.Provider value={stats}>
          <TriggerSummaryContext.Provider value={trigger}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onPaneClick={() => {
                setMenu(null);
                setSelectedId(null);
                setSelectedEdge(null);
              }}
              minZoom={0.2}
              maxZoom={1.5}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background gap={20} color="#cbd5e1" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable position="bottom-right" className="!hidden md:!block" />
            </ReactFlow>
          </TriggerSummaryContext.Provider>
          </FlowStatsContext.Provider>

          <button
            onClick={openAddMenuFromToolbar}
            className="absolute right-3 top-3 z-10 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow hover:bg-zinc-800"
          >
            + {t("Add a step")}
          </button>

          {selected && (
            <div className="absolute inset-y-0 left-0 z-10 w-[320px] max-w-[85%] border-r border-border bg-white shadow-xl">
              <FlowInspector
                step={selected}
                title={labels.get(selected.id) ?? ""}
                onChange={replaceStep}
                onDelete={() => deleteSteps([selected.id])}
                onClose={() => setSelectedId(null)}
                editTriggerHref={`/campaigns/${campaign.id}/edit`}
              />
            </div>
          )}

          {selectedEdge && (
            <button
              onClick={() => onEdgesChange([{ type: "remove", id: selectedEdge }])}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-white px-3 py-1.5 text-sm text-error shadow"
            >
              {t("Remove this arrow")}
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2 lg:w-[320px]">
          <p className="self-start text-sm text-muted">{t("Preview")}</p>
          <FlowPreview
            key={previewKey}
            flow={flow}
            username={campaign.username ?? "yourbrand"}
            avatarUrl={avatarUrl}
            keyword={campaign.matchAnyWord ? t("any word") : campaign.keywords[0] ?? "…"}
          />
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 w-56 rounded-xl border border-border bg-white p-1.5 shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 300) }}
        >
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted">{t("New step")}</p>
          {ADDABLE_STEPS.map((type) => (
            <button
              key={type}
              onClick={() => addStep(type, menu)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface"
            >
              {t(STEP_TITLES[type])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FlowEditor({ campaignId }: { campaignId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/automations/flow?id=${campaignId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d.data);
        else setError(d.error || "Error");
      })
      .catch(() => !cancelled && setError("Error"));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-muted">{t("Loading…")}</p>;

  return (
    <ReactFlowProvider>
      <Editor data={data} onSaved={(savedAt) => setData((d) => (d ? { ...d, flowSavedAt: savedAt } : d))} />
    </ReactFlowProvider>
  );
}
