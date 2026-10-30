import { useWorkflowStore } from "@/stores/workflows";
import { useHubStore } from "@/stores/hub";
import { cn } from "@/lib/utils";
import { useModelsStore } from "@/stores/models";
import { useLocation } from "react-router-dom";
import { useRuntimeStore } from "@/stores/runtimes";
import { resultLabels } from "@/lib/workflows";
export function StatusBar() {
  const { pathname } = useLocation();
  const runtime = useRuntimeStore(s => s.snapshot?.items.find(item => ["downloading", "installing"].includes(item.status)));
  const preparing = pathname === "/workflow" && runtime;
  const status = useWorkflowStore(s => s.run?.status), name = useWorkflowStore(s => s.run?.workflowName), active = status === "running" || status === "cancelling";
  const live = useWorkflowStore(s => s.live), model = useModelsStore(s => s.snapshot.engine.activeModelId);
  const downloads = useHubStore(s => s.jobs.filter(j => ["queued", "downloading", "verifying"].includes(j.status)).length);
  return <footer className="app-statusbar"><div><span className={cn("status-dot", (active || live) && "is-running", status === "failed" && "is-error")} />{preparing ? `${runtime.status === "installing" ? "安装" : "下载"} ${runtime.name} ${Math.round(runtime.bytes * 100 / runtime.total)}%` : live ? "连续运行中" : active ? resultLabels[status!] : "就绪"}{active && <span className="status-separator">·</span>}{active && name}</div><span className="status-model-label">{downloads > 0 && `${downloads} 项后台下载 · `}{model ? "本地模型已加载" : ""}</span></footer>;
}
