import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges, MarkerType, useReactFlow, type Connection, type NodeChange, type EdgeChange, type Edge, type FinalConnectionState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AudioLines, Clock3, Download, FileText, GitBranch, Languages, Maximize, Mic, Monitor, PanelLeft, PanelRight, Play, Plus, Save, Settings2, Sparkles, Square, Trash2, Upload, Volume2 } from "lucide-react";
import { spec, makeNode, makeTemplate, parseWorkflow, connectionEdges, serializeWorkflow, resultLabels, templateLabels, type NodeKind, type Template, type StudioNode, type NodeConfig } from "@/lib/workflows";
import { capturing, running, useWorkflowStore } from "@/stores/workflows";
import { useRuntimeStore } from "@/stores/runtimes";
import { useNodePluginStore } from "@/stores/node-plugins";
import { usePluginStore, pluginActive } from "@/stores/plugins";
import { nodeIcon } from "@/components/NodeFields";
import { useSpeechStore } from "@/stores/speech";
import { hasDesktop, invoke } from "@/lib/desktop";
import { errorMessage } from "@/lib/models";
import { WorkflowNode } from "@/components/WorkflowNode";
import { WorkflowInspector } from "@/components/WorkflowInspector";
import { WorkflowRecords } from "@/components/WorkflowRecords";
import { StudioDialog } from "@/components/StudioDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const nodeTypes = { studio: WorkflowNode };
function WorkflowEditor() {
  const state = useWorkflowStore(useShallow(({ run, capture, ...state }) => state)), { graph } = state;
  const run = useWorkflowStore(useShallow(s => s.run ? {
    id: s.run.id, workflowId: s.run.workflowId, status: s.run.status, error: s.run.error,
    completed: Object.values(s.run.nodes).filter(node => node.status === "completed").length,
    total: Object.keys(s.run.nodes).length,
    activeNodes: Object.entries(s.run.nodes).filter(([, node]) => node.status === "running").map(([id]) => id).join(","),
  } : null));
  const catalog = useNodePluginStore(), sessions = usePluginStore(s => s.items);
  const session = sessions.find(item => item.workflowId === graph.id);
  const [search, setSearch] = useState("");
  const { fitView, screenToFlowPosition } = useReactFlow<StudioNode>();
  const [selectedId, setSelectedId] = useState<string | null>(null), [recordsOpen, setRecordsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(() => window.innerWidth >= 1100), [inspectorOpen, setInspectorOpen] = useState(false), [libraryTab, setLibraryTab] = useState<"nodes" | "templates">("nodes");
  const [exporting, setExporting] = useState(false), [confirmation, setConfirmation] = useState<(() => void) | null>(null), [confirmText, setConfirmText] = useState("");
  const canvas = useRef<HTMLDivElement>(null), importInput = useRef<HTMLInputElement>(null);
  const reconnecting = useRef<{ id: string; done: boolean } | null>(null);
  const runtimeBusy = useRuntimeStore(s => !!s.snapshot?.items.some(item => ["downloading", "installing"].includes(item.status)));
  const busy = useWorkflowStore(s => running(s.run) || s.submitting || s.live), inputBusy = useWorkflowStore(s => s.inputTasks > 0 || capturing(s.capture)), locked = busy || inputBusy || runtimeBusy, native = hasDesktop();
  const selected = graph.nodes.find(n => n.id === selectedId), visibleRun = !state.submitting && run?.workflowId === graph.id ? run : null;
  useEffect(() => { void state.init().catch(e => useWorkflowStore.setState({ error: errorMessage(e) })); void useSpeechStore.getState().load().catch(e => useWorkflowStore.setState({ error: errorMessage(e) })); }, []);
  useEffect(() => { setSelectedId(null); const frame = requestAnimationFrame(() => void fitView({ padding: .12, maxZoom: 1 })); return () => cancelAnimationFrame(frame); }, [graph.id, fitView]);
  function confirm(action: () => void, force = false, message = "替换当前未保存的画布？") {
    if ((state.dirty && graph.nodes.length) || force) { setConfirmText(message); setConfirmation(() => action); } else action();
  }
  function add(kind: NodeKind) {
    const current = useWorkflowStore.getState();
    if (locked || current.graph.nodes.length >= 64) return;
    const box = canvas.current?.getBoundingClientRect();
    const node = makeNode(kind, box ? screenToFlowPosition({ x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 60 }) : undefined);
    current.update({ ...current.graph, nodes: [...current.graph.nodes, node] }); setSelectedId(node.id); setInspectorOpen(true);
  }
  const onNodesChange = useCallback((changes: NodeChange<StudioNode>[]) => {
    const meaningful = changes.filter(change => change.type !== "select"); if (!meaningful.length || locked) return;
    const current = useWorkflowStore.getState(), next = applyNodeChanges(meaningful, current.graph.nodes);
    current.update({ ...current.graph, nodes: next, edges: current.graph.edges.filter(e => next.some(n => n.id === e.source) && next.some(n => n.id === e.target)) }, meaningful.some(c => c.type !== "dimensions"));
  }, [locked]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => { if (!locked) { const current = useWorkflowStore.getState(); current.update({ ...current.graph, edges: applyEdgeChanges(changes, current.graph.edges) }, changes.some(c => c.type !== "select")); } }, [locked]);
  function connect(connection: Connection) {
    const current = useWorkflowStore.getState();
    if (locked) return;
    const edges = connectionEdges(connection, current.graph.nodes, current.graph.edges);
    if (edges) current.update({ ...current.graph, edges });
  }
  function reconnect(edge: Edge, connection: Connection) {
    const current = useWorkflowStore.getState(); if (locked) return;
    const edges = connectionEdges(connection, current.graph.nodes, current.graph.edges, edge.id);
    if (edges) { reconnecting.current = { id: edge.id, done: true }; current.update({ ...current.graph, edges }); }
  }
  function reconnectEnd(event: MouseEvent | TouchEvent, edge: Edge, state: FinalConnectionState) {
    const pending = reconnecting.current; reconnecting.current = null;
    if (locked || !pending || pending.done || state.toHandle) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event, box = canvas.current?.getBoundingClientRect();
    const target = event.target instanceof Element ? event.target : null;
    const blank = target && !target.closest(".react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .workflow-canvas-caption");
    if (point && box && blank && point.clientX > box.left && point.clientX < box.right && point.clientY > box.top && point.clientY < box.bottom) {
      const current = useWorkflowStore.getState(); current.update({ ...current.graph, edges: current.graph.edges.filter(e => e.id !== edge.id) });
    }
  }
  async function importFile(file: File) {
    try { if (file.size > 512000) throw new Error("工作流文件不能超过 500 KB"); const imported = parseWorkflow(JSON.parse(await file.text())); confirm(() => state.replace(imported)); } catch (e) { useWorkflowStore.setState({ error: errorMessage(e) }); }
  }
  async function exportGraph() {
    if (exporting) return; setExporting(true);
    try {
      if (native) { const saved = await invoke<string | null>("workflow_export", { workflow: serializeWorkflow(graph) }); if (saved) useWorkflowStore.setState({ error: null, notice: "工作流 JSON 已导出" }); }
      else { const url = URL.createObjectURL(new Blob([JSON.stringify(serializeWorkflow(graph))], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `MultiStudio-workflow-${graph.id.slice(0, 8)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (e) { useWorkflowStore.setState({ error: errorMessage(e) }); } finally { setExporting(false); }
  }
  const nodes = useMemo(() => graph.nodes.map(n => ({ ...n, dragHandle: ".workflow-node-title", selected: n.id === selectedId })), [graph.nodes, selectedId]);
  const edges = useMemo(() => {
    const active = new Set(visibleRun?.activeNodes.split(","));
    return graph.edges.map(e => {
      const kind = graph.nodes.find(n => n.id === e.source)!.data.kind, color = spec[kind]?.output === "audio" ? "#c28b49" : "#9277dc";
      return { ...e, animated: false, style: { stroke: color, strokeWidth: active.has(e.target) ? 3 : 2 }, markerEnd: { type: MarkerType.ArrowClosed, color } };
    });
  }, [graph.nodes, graph.edges, visibleRun?.activeNodes]);
  return <div className="workflow-page unified-workspace">
    <div className="workspace-heading"><div><h1>工作流</h1></div><div className="workspace-utilities"><Button variant="ghost" className="compact-button" disabled={!native} onClick={() => setRecordsOpen(true)}><Clock3 size={14} />运行记录</Button><Link to="/settings" className="studio-text-link"><Settings2 size={14} />连接设置</Link></div></div>
    <div className="surface workflow-toolbar"><div className="workflow-name"><GitBranch size={17} /><Input aria-label="工作流名称" value={graph.name} maxLength={120} disabled={locked} onChange={e => state.update({ ...graph, name: e.target.value })} /><span>{state.dirty ? "未保存" : "已保存"}</span></div>
      <select className="studio-select" aria-label="打开已保存工作流" value={state.saved.some(w => w.id === graph.id) ? graph.id : ""} disabled={locked || !native} onChange={e => { const id = e.target.value; confirm(() => void state.select(id)); }}><option value="" disabled>本机工作流</option>{state.saved.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <Button variant="ghost" size="icon" aria-label="切换节点库" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}><PanelLeft size={16} /></Button><Button variant="ghost" size="icon" aria-label="切换节点结果" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><PanelRight size={16} /></Button>
      <Button variant="outline" className="compact-button" disabled={!native || locked || state.saving || !graph.name.trim()} onClick={() => void state.save()}><Save size={14} />保存</Button>
      {busy ? <Button variant="outline" className="compact-button" disabled={run?.status === "cancelling" || state.submitting && !state.live} onClick={() => void state.cancel()}><Square size={13} />{run?.status === "cancelling" ? "停止中…" : "停止"}</Button> : <Button className="compact-button" disabled={!native || !state.loaded || !graph.nodes.length || state.saving || inputBusy} onClick={() => void state.start()}><Play size={14} />{inputBusy ? "输入处理中…" : "运行"}</Button>}

    </div>
    {(state.error || session?.error) && <p role="alert" className="inline-feedback is-error workflow-feedback">{state.error || session?.error}</p>}
    <div className={`workflow-layout ${libraryOpen ? "has-library" : ""} ${inspectorOpen ? "has-inspector" : ""}`}>
      {libraryOpen && <aside className="surface workflow-library"><div className="workspace-tabs" role="tablist" aria-label="工作流资源"><button role="tab" aria-selected={libraryTab === "nodes"} onClick={() => setLibraryTab("nodes")}>节点</button><button role="tab" aria-selected={libraryTab === "templates"} onClick={() => setLibraryTab("templates")}>模板</button></div>
        {libraryTab === "nodes" && <div className="node-library-search"><Input aria-label="搜索节点" placeholder="搜索节点" value={search} onChange={event => setSearch(event.target.value)} /></div>}
        <div className="workflow-library-scroll">{libraryTab === "nodes" ? <div className="workflow-node-library">{catalog.plugins.filter(plugin => plugin.enabled && !plugin.error).map(plugin => {
          const kinds = Object.keys(spec).filter(kind => spec[kind].pluginId === plugin.id && (spec[kind].label + plugin.name).toLowerCase().includes(search.toLowerCase()));
          return kinds.length > 0 && <section key={plugin.id}><h2>{plugin.name}</h2>{kinds.map(kind => { const Icon = nodeIcon(spec[kind].icon); return <button key={kind} draggable={!locked} onDragStart={event => { event.dataTransfer.setData("application/multistudio-node", kind); event.dataTransfer.effectAllowed = "copy"; }} disabled={locked} onClick={() => add(kind)} aria-label={`添加 ${spec[kind].label}`}><Icon size={15} /><span>{spec[kind].label}</span><Plus size={12} /></button>; })}</section>;
        })}</div> : <div className="workflow-template-list">{Object.keys(templateLabels).filter(template => template !== "empty").map(template => <button key={template} disabled={locked} onClick={() => confirm(() => state.replace(makeTemplate(template)))}><strong>{templateLabels[template]}</strong></button>)}</div>}</div>

        <div className="workflow-file-actions"><Button variant="ghost" className="compact-button" disabled={locked} onClick={() => confirm(() => state.replace(makeTemplate("empty")))}><Plus size={13} />新建</Button><Button variant="ghost" className="compact-button" disabled={locked} onClick={() => importInput.current?.click()}><Upload size={13} />导入</Button><Button variant="ghost" className="compact-button" disabled={exporting} onClick={() => void exportGraph()}><Download size={13} />导出</Button>{state.saved.some(w => w.id === graph.id) && <Button variant="ghost" className="compact-button" disabled={locked} onClick={() => confirm(() => void state.remove(), true, "删除此工作流？")}><Trash2 size={13} />删除</Button>}</div>
      </aside>}
      <input ref={importInput} type="file" accept=".json,application/json" aria-label="导入工作流 JSON" className="sr-only" onChange={e => { if (e.target.files?.[0]) void importFile(e.target.files[0]); e.target.value = ""; }} />
      <section ref={canvas} className="surface workflow-canvas" aria-label="工作流画布" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={event => {
        event.preventDefault(); const kind = event.dataTransfer.getData("application/multistudio-node");
        if (locked || !spec[kind] || graph.nodes.length >= 64) return;
        const node = makeNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        state.update({ ...graph, nodes: [...graph.nodes, node] }); setSelectedId(node.id);
      }}><div className="workflow-canvas-caption"><span><i className="text-port-legend" />文本<i className="audio-port-legend" />音频</span><button aria-label="适应工作流画布" onClick={() => void fitView({ padding: .12, maxZoom: 1 })}><Maximize size={13} />适应画布</button></div>
        <ReactFlow<StudioNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} edgesReconnectable={!locked} onReconnectStart={(_, edge) => { reconnecting.current = { id: edge.id, done: false }; }} onReconnect={reconnect} onReconnectEnd={(event, edge, _, state) => reconnectEnd(event, edge, state)} isValidConnection={c => !!connectionEdges(c as Connection, graph.nodes, graph.edges, reconnecting.current?.id)} onNodeClick={(_, node) => { if (!state.inputTasks) { setSelectedId(node.id); setInspectorOpen(true); } }} onPaneClick={() => { if (!state.inputTasks) setSelectedId(null); }} nodesDraggable={!locked} nodesConnectable={!locked} deleteKeyCode={locked ? null : ["Backspace", "Delete"]} minZoom={.2} maxZoom={1.7} fitView fitViewOptions={{ padding: .12, maxZoom: 1 }}><Background gap={22} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => spec[node.data.kind as NodeKind]?.output === "audio" ? "#c28b49" : "#9277dc"} /></ReactFlow>

      </section>
      {inspectorOpen && <WorkflowInspector key={selectedId} node={selected} disabled={locked} onDelete={() => { if (!selected || locked) return; state.update({ ...graph, nodes: graph.nodes.filter(n => n.id !== selected.id), edges: graph.edges.filter(e => e.source !== selected.id && e.target !== selected.id) }); setSelectedId(null); }} onDuplicate={() => { if (!selected || locked || graph.nodes.length >= 64) return; const copy = { ...makeNode(selected.data.kind, { x: selected.position.x + 40, y: selected.position.y + 190 }), data: { ...selected.data, config: { ...selected.data.config } } }; state.update({ ...graph, nodes: [...graph.nodes, copy] }); setSelectedId(copy.id); }} />}
    </div>
    <div className="workflow-footer"><span>{visibleRun ? <><span className={`workflow-run-status status-${visibleRun.status}`}>{resultLabels[visibleRun.status]}</span>{visibleRun.completed} / {visibleRun.total} 节点</> : `${graph.nodes.length} 个节点 · ${graph.edges.length} 条连线`}{state.notice && <span role="status">{state.notice}</span>}</span>{session && (pluginActive(session) || session.processed > 0) && <span>已处理 {session.processed} · 等待 {session.queued} · 跳过 {session.skipped}</span>}</div>
    {visibleRun?.error && <p className="inline-feedback is-error" role="alert">{visibleRun.error}</p>}
    <WorkflowRecords open={recordsOpen} onClose={() => setRecordsOpen(false)} />
    <StudioDialog open={!!confirmation} onOpenChange={open => !open && setConfirmation(null)} title="确认画布操作" description={confirmText}><div className="studio-dialog-actions workflow-confirm-actions"><Button variant="outline" onClick={() => setConfirmation(null)}>取消</Button><Button onClick={() => { confirmation?.(); setConfirmation(null); }}>继续</Button></div></StudioDialog>
  </div>;
}
export default function WorkflowPage() { return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>; }
