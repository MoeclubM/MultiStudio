import { useEffect, useState } from "react";
import { invoke } from "@/lib/desktop";
import type { ContextMessage } from "@/lib/workflows";
import { errorMessage } from "@/lib/models";
import { Button } from "./ui/button";
export function WorkflowContext({ workflowId, nodeId, disabled, runId }: { workflowId: string; nodeId: string; disabled: boolean; runId?: string }) {
  const [messages, setMessages] = useState<ContextMessage[]>([]), [error, setError] = useState<string | null>(null);
  useEffect(() => { let disposed = false; void invoke<ContextMessage[]>("workflow_context_get", { workflowId, nodeId }).then(messages => { if (!disposed) setMessages(messages); }).catch(() => {}); return () => { disposed = true; }; }, [workflowId, nodeId, runId, disabled]);
  return <section className="workflow-context"><h3>上下文 <span>{messages.length / 2} 轮</span></h3><div role="log" aria-label="节点对话上下文">{messages.map((m, i) => <div key={i} className={`context-${m.role}`}><small>{m.role === "user" ? "你" : "模型"}</small><p>{m.content}</p></div>)}{!messages.length && <p className="field-hint">暂无对话</p>}</div><Button variant="outline" className="compact-button" disabled={disabled || !messages.length} onClick={async () => { try { await invoke("workflow_context_clear", { workflowId, nodeId }); setMessages([]); } catch (e) { setError(errorMessage(e)); } }}>清空</Button>{error && <p role="alert" className="inline-feedback is-error">{error}</p>}</section>;
}
