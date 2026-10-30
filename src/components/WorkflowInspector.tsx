import { useState } from "react";
import { Check, Copy, Download, Settings2, Trash2 } from "lucide-react";
import { spec, resultLabels, type StudioNode } from "@/lib/workflows";
import { useWorkflowStore } from "@/stores/workflows";
import { WorkflowContext } from "./WorkflowContext";
import { invoke } from "@/lib/desktop";
import { audioUrl } from "@/lib/conversations";
import { errorMessage } from "@/lib/models";
import { Button } from "./ui/button";

export function WorkflowInspector({ node, disabled, onDelete, onDuplicate }: { node: StudioNode | undefined; disabled: boolean; onDelete: () => void; onDuplicate: () => void }) {
  const result = useWorkflowStore(s => !s.submitting && node && s.run?.workflowId === s.graph.id ? s.run.nodes[node.id] : undefined);
  const workflowId = useWorkflowStore(s => s.graph.id), runId = useWorkflowStore(s => s.run?.id);
  const [error, setError] = useState<string | null>(null), [copied, setCopied] = useState(false);
  if (!node) return <aside className="surface workflow-inspector"><div className="workflow-panel-heading"><Settings2 size={15} />节点结果</div></aside>;
  const definition = spec[node.data.kind];
  return <aside className="surface workflow-inspector" aria-label="节点结果"><div className="workflow-panel-heading"><Settings2 size={15} />节点结果<span>{result ? resultLabels[result.status] : "未运行"}</span></div><div className="workflow-inspector-content"><h2>{node.data.label}</h2><span className="field-hint">{definition?.pluginName || "插件未加载"}</span>
    {(error || result?.error) && <p className="inline-feedback is-error" role="alert">{error || result?.error}</p>}
    {result?.output && !(definition?.session && result.output.type === "audio") && <section className="workflow-node-result">{result.output.type === "text" ? <><pre>{result.output.text}</pre><div className="api-test-row"><Button variant="outline" className="compact-button" onClick={async () => { try { await navigator.clipboard.writeText(result.output!.type === "text" ? result.output!.text : ""); setCopied(true); } catch { setError("复制失败"); } }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制"}</Button><Button variant="outline" className="compact-button" onClick={() => void invoke("text_export", { text: result.output!.type === "text" ? result.output!.text : "" }).catch(e => setError(errorMessage(e)))}><Download size={13} />保存文本</Button></div></> : <><audio controls src={audioUrl(result.output.audioId)} aria-label="输出音频" /><Button variant="outline" className="compact-button" onClick={() => void invoke("audio_export", { audioId: result.output!.type === "audio" ? result.output!.audioId : "" }).catch(e => setError(errorMessage(e)))}><Download size={13} />保存音频</Button></>}</section>}
    {definition?.context && (node.data.config.rememberHistory || Number(node.data.config.contextSentences) > 0) && <WorkflowContext workflowId={workflowId} nodeId={node.id} disabled={disabled} runId={runId} />}
    <div className="workflow-inspector-actions"><Button variant="outline" className="compact-button" disabled={disabled || !definition} onClick={onDuplicate}><Copy size={13} />复制节点</Button><Button variant="ghost" size="icon" disabled={disabled} aria-label="删除节点" onClick={onDelete}><Trash2 size={14} /></Button></div>
  </div></aside>;
}
