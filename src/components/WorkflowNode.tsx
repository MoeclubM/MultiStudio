import { memo, useCallback } from "react";
import { useNodePluginStore } from "@/stores/node-plugins";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AudioLines, Loader2, Check, CircleAlert, Unplug } from "lucide-react";
import { resultLabels, type StudioNode } from "@/lib/workflows";
import { capturing, running, useWorkflowStore } from "@/stores/workflows";
import { WorkflowAudioInput } from "./WorkflowAudioInput";
import { WorkflowLiveAudioInput } from "./WorkflowLiveAudioInput";
import { WorkflowAudioReference } from "./WorkflowAudioReference";
const widgets = { "audio-input": WorkflowAudioInput, "audio-capture": WorkflowLiveAudioInput, "audio-reference": WorkflowAudioReference };
import { NodeFields, nodeIcon } from "./NodeFields";
import { cn } from "@/lib/utils";

export const WorkflowNode = memo(function WorkflowNode({ id, data, selected }: NodeProps<StudioNode>) {
  const state = useWorkflowStore(s => s.run?.workflowId === s.graph.id ? s.run.nodes[id] : undefined);
  const busy = useWorkflowStore(s => running(s.run) || s.submitting || s.live), inputBusy = useWorkflowStore(s => s.inputTasks > 0 || capturing(s.capture));
  const incoming = useWorkflowStore(s => s.graph.edges.find(e => e.target === id)), outputs = useWorkflowStore(s => s.graph.edges.filter(e => e.source === id).length);
  const definition = useNodePluginStore(s => s.nodes[data.kind]), Icon = nodeIcon(definition?.icon), locked = busy || inputBusy;
  const Widget = widgets[definition?.widget as keyof typeof widgets];
  function unplug(direction: "input" | "output") {
    const current = useWorkflowStore.getState(); if (locked) return;
    current.update({ ...current.graph, edges: current.graph.edges.filter(edge => direction === "input" ? edge.target !== id : edge.source !== id) });
  }
  const change = useCallback((config: typeof data.config) => {
    const current = useWorkflowStore.getState();
    current.update({ ...current.graph, nodes: current.graph.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, config } } : node) });
  }, [id]);
  const portLabel = (type: string) => ({ audio: "音频", text: "文本" }[type] || type);
  return <div className={cn("workflow-node", definition?.widget && "has-widget", selected && "is-selected", state && `state-${state.status}`)} data-kind={data.kind} data-node-id={id}>
    <div className="workflow-node-title"><span><Icon size={15} /></span><strong>{data.label}</strong>{state?.status === "running" ? <Loader2 size={13} className="animate-spin" /> : state?.status === "completed" ? <Check size={13} /> : state?.status === "error" ? <CircleAlert size={13} /> : null}</div>
    {!definition ? <p className="inline-feedback is-error">插件未加载：{data.kind}</p> : <>
      <div className="workflow-node-ports">
        <span>{definition.input && <><Handle type="target" position={Position.Left} id={definition.input} className={`port-${definition.input}`} aria-label={`${data.label} 输入`} /><span>{portLabel(definition.input)}</span>{incoming && <button className="node-unplug nodrag nopan" aria-label="断开输入" title="断开输入" disabled={locked} onClick={event => { event.stopPropagation(); unplug("input"); }}><Unplug size={12} /></button>}</>}</span>
        <span>{definition.output && <>{outputs > 0 && <button className="node-unplug nodrag nopan" aria-label="断开输出" title="断开输出" disabled={locked} onClick={event => { event.stopPropagation(); unplug("output"); }}><Unplug size={12} /></button>}<span>{portLabel(definition.output)}{outputs > 1 ? ` · ${outputs}` : ""}</span><Handle type="source" position={Position.Right} id={definition.output} className={`port-${definition.output}`} aria-label={`${data.label} 输出`} /></>}</span>
      </div>
      {Widget && <Widget nodeId={id} config={data.config} disabled={busy} onChange={change} />}
      {!!definition.fields.length && <NodeFields nodeId={id} definition={definition} config={data.config} disabled={locked} onChange={change} />}
      {state?.output?.type === "text" && <p className="workflow-node-summary">{state.output.text.slice(0, 150)}</p>}
    </>}
    <div className="workflow-node-status"><span className={cn("status-dot", state?.status === "completed" && "is-running", state?.status === "error" && "is-error")} />{state ? resultLabels[state.status] : "未运行"}{state?.output?.type === "audio" && <AudioLines size={12} />}</div>
  </div>;
});
