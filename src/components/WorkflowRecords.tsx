import { useEffect, useState } from "react";
import { invoke } from "@/lib/desktop";
import { resultLabels, type RunSummary, type WorkflowRun } from "@/lib/workflows";
import { audioUrl, type Conversation, type ConversationSummary } from "@/lib/conversations";
import type { SessionEntry } from "@/lib/types";
import { errorMessage } from "@/lib/models";
import { StudioDialog } from "./StudioDialog";
export function WorkflowRecords({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]), [selected, setSelected] = useState<WorkflowRun | null>(null);
  const [tab, setTab] = useState<"runs" | "archive">("runs"), [sessions, setSessions] = useState<ConversationSummary[]>([]), [history, setHistory] = useState<SessionEntry[]>([]), [conversation, setConversation] = useState<Conversation | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!open) return; let disposed = false; setError(null); setSelected(null); setConversation(null);
    void Promise.all([invoke<RunSummary[]>("workflow_runs"), invoke<ConversationSummary[]>("conversation_list"), invoke<SessionEntry[]>("get_history")]).then(([runs, sessions, history]) => { if (!disposed) { setRuns(runs); setSessions(sessions); setHistory(history); } }).catch(e => { if (!disposed) setError(errorMessage(e)); });
    return () => { disposed = true; };
  }, [open]);
  return <StudioDialog open={open} onOpenChange={value => !value && onClose()} title="工作流记录">
    <div className="workspace-tabs"><button aria-pressed={tab === "runs"} onClick={() => setTab("runs")}>最近运行</button><button aria-pressed={tab === "archive"} onClick={() => setTab("archive")}>旧数据归档</button></div>
    {error && <p role="alert" className="inline-feedback is-error">{error}</p>}
    {tab === "runs" ? <div className="workflow-records"><div className="workflow-record-list">{runs.map(run => <button key={run.id} aria-pressed={selected?.id === run.id} onClick={async () => { try { setSelected(await invoke<WorkflowRun | null>("workflow_run_get", { id: run.id })); } catch (e) { setError(errorMessage(e)); } }}><strong>{run.workflowName}</strong><span>{resultLabels[run.status]} · {new Date(run.startedAt).toLocaleString()} · {run.count} 节点</span></button>)}{!runs.length && <p className="field-hint">暂无记录</p>}</div>{selected && <div className="workflow-record-results"><h3>{selected.workflowName}</h3>{selected.error && <p className="inline-feedback is-error">{selected.error}</p>}{Object.entries(selected.nodes).filter(([, state]) => state.output).map(([id, state]) => <section key={id}><h4>{selected.workflow?.nodes.find(n => n.id === id)?.data.label || `节点 ${id.slice(0, 8)}`}</h4>{state.output?.type === "text" ? <pre>{state.output.text}</pre> : state.output && <audio controls src={audioUrl(state.output.audioId)} />}</section>)}</div>}</div> : <div className="workflow-records"><div className="workflow-record-list">{sessions.map(session => <button key={session.id} onClick={async () => { try { setConversation(await invoke<Conversation | null>("conversation_get", { id: session.id })); } catch (e) { setError(errorMessage(e)); } }}><strong>{session.title}</strong><span>{session.count} 条旧消息</span></button>)}</div>{conversation?.messages.map(message => <section key={message.id}><h4>{message.role === "user" ? "你" : "模型"}</h4><pre>{message.content}</pre>{message.audioId && <audio controls src={audioUrl(message.audioId)} />}</section>)}{history.map((item, i) => <section key={i}><h4>旧翻译记录</h4><pre>{item.transcript}\n{item.translation}</pre></section>)}{!sessions.length && !history.length && <p className="field-hint">暂无归档</p>}</div>}
  </StudioDialog>;
}
