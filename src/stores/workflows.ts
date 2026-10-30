import { useNodePluginStore } from "./node-plugins";
import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { hasDesktop, invoke } from "@/lib/desktop";
import { errorMessage } from "@/lib/models";
import { makeTemplate, serializeWorkflow, type Workflow, type WorkflowRun, type WorkflowSummary } from "@/lib/workflows";
export type CaptureState = { sessionId?: string; nodeId: string; source: string; owner: string; state: 'starting' | 'recording' | 'segment' | 'stopped' | 'error'; seconds?: number; rms?: number; audioId?: string; duration?: number; error?: string };
export const capturing = (capture: CaptureState | null) => !!capture && ['starting', 'recording', 'segment'].includes(capture.state);
type State = {
  live: boolean; capture: CaptureState | null; receiveCapture: (event: CaptureState) => void;
  graph: Workflow; revision: number; saved: WorkflowSummary[]; run: WorkflowRun | null; loaded: boolean; dirty: boolean; saving: boolean; submitting: boolean; inputTasks: number; error: string | null; notice: string | null;
  init: () => Promise<void>; update: (graph: Workflow, dirty?: boolean) => void; replace: (graph: Workflow) => void; select: (id: string) => Promise<void>; save: () => Promise<void>; remove: () => Promise<void>; start: () => Promise<void>; cancel: () => Promise<void>; receive: (run: WorkflowRun) => void;
};
export const running = (run: WorkflowRun | null) => !!run && ["running", "cancelling"].includes(run.status);
export const useWorkflowStore = create<State>((set, get) => ({
  live: false, capture: null,
  receiveCapture(event) {
    set(state => {
      const capture = state.capture?.sessionId === event.sessionId ? { ...state.capture, ...event } : event;
      if (event.owner !== 'manual' || event.state !== 'segment' || !event.audioId) return { capture };
      return { capture, graph: { ...state.graph, nodes: state.graph.nodes.map(node => node.id === event.nodeId ? { ...node, data: { ...node.data, config: { ...node.data.config, audioId: event.audioId!, duration: event.duration || 0, filename: event.source === 'system' ? '系统音频录音' : '麦克风录音' } } } : node) }, dirty: true, revision: state.revision + 1 };
    });
  },
  graph: makeTemplate(), revision: 0, saved: [], run: null, loaded: false, dirty: true, saving: false, submitting: false, inputTasks: 0, error: null, notice: null,
  async init() {
    if (get().loaded) return;
    const originalRevision = get().revision;
    await useNodePluginStore.getState().load();
    if (!hasDesktop()) { set({ loaded: true }); return; }
    try {
      const [saved, run, capture] = await Promise.all([invoke<WorkflowSummary[]>("workflow_list"), invoke<WorkflowRun | null>("workflow_status"), invoke<CaptureState | null>("audio_capture_status")]);
      if (capture) set({ capture });
      set({ saved }); if (run) get().receive(run);
      if (saved.length && get().revision === originalRevision) {
        const graph = await invoke<Workflow | null>("workflow_get", { id: running(get().run) ? get().run!.workflowId : saved[0].id });
        if (graph && get().revision === originalRevision) set({ graph, dirty: false });
      }
      set({ loaded: true });
    }
    catch (e) { set({ loaded: true, error: errorMessage(e) }); }
  },
  update(graph, dirty = true) { if (running(get().run) || get().submitting || get().live) return; set(s => ({ graph, revision: s.revision + (dirty ? 1 : 0), dirty: s.dirty || dirty, notice: dirty ? null : s.notice })); },
  replace(graph) { if (running(get().run) || get().submitting) return; set(s => ({ graph, revision: s.revision + 1, dirty: true, run: null, error: null, notice: null })); },
  async select(id) { if (running(get().run) || get().submitting) return; const revision = get().revision + 1; set({ revision }); try { const graph = await invoke<Workflow | null>("workflow_get", { id }); if (graph && get().revision === revision) set({ graph, dirty: false, error: null, notice: null }); } catch (e) { set({ error: errorMessage(e) }); } },
  async save() { if (get().saving || get().submitting || running(get().run)) return; set({ saving: true, error: null }); const graph = serializeWorkflow(get().graph); try { await invoke("workflow_save", { workflow: graph }); const saved = await invoke<WorkflowSummary[]>("workflow_list"); set(s => ({ saved, dirty: JSON.stringify(serializeWorkflow(s.graph)) !== JSON.stringify(graph), notice: "已保存" })); } catch (e) { set({ error: errorMessage(e) }); } finally { set({ saving: false }); } },
  async remove() { if (running(get().run)) return; try { await invoke("workflow_delete", { id: get().graph.id }); const saved = await invoke<WorkflowSummary[]>("workflow_list"); set({ saved, graph: makeTemplate("empty"), dirty: true, run: null }); } catch (e) { set({ error: errorMessage(e) }); } },
  async start() {
    if (running(get().run) || get().submitting || get().saving || get().inputTasks || get().live || capturing(get().capture) || !hasDesktop()) return; set({ submitting: true, error: null, notice: null });
    try {
      const workflow = serializeWorkflow(get().graph);
      await invoke("workflow_save", { workflow });
      const saved = await invoke<WorkflowSummary[]>("workflow_list");
      set({ saved, dirty: false });
      const result = await invoke<{ run: WorkflowRun | null; plugins: { status: string }[] }>("workflow_start", { workflow });
      set({ live: result.plugins.some(plugin => ["starting", "running", "stopping"].includes(plugin.status)) });
      if (result.run) get().receive(result.run); else if (!get().run?.streaming || get().run?.workflowId !== workflow.id) set({ run: null });
    }
    catch (e) { set({ error: errorMessage(e) }); } finally { set({ submitting: false }); }
  },
  async cancel() { const run = get().run; if (!running(run) && !get().live) return; try { const result = await invoke<WorkflowRun | null>("workflow_cancel", { id: run?.id }); set({ live: false }); if (result) get().receive(result); } catch (e) { set({ error: errorMessage(e) }); } },
  receive(run) {
    set(s => {
      const previous = s.run;
      if (previous && (previous.id === run.id && previous.endedAt && !run.endedAt || previous.id !== run.id && previous.startedAt > run.startedAt)) return s;
      if (previous?.id !== run.id) return { run };
      const nodes = Object.fromEntries(Object.entries(run.nodes).map(([id, result]) => {
        const old = previous.nodes[id], output = shallow(old?.output, result.output) ? old?.output : result.output;
        const next = output ? { ...result, output } : result;
        return [id, shallow(old, next) ? old : next];
      }));
      return { run: { ...run, workflow: previous.workflow || run.workflow, nodes } };
    });
  },
}));
export function beginInputTask() {
  useWorkflowStore.setState(s => ({ inputTasks: s.inputTasks + 1 })); let ended = false;
  return () => { if (ended) return; ended = true; useWorkflowStore.setState(s => ({ inputTasks: Math.max(0, s.inputTasks - 1) })); };
}
