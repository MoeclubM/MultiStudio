import { useState } from "react";
import { FileBox, Trash2 } from "lucide-react";
import { useHubStore } from "@/stores/hub";
import { useModelsStore } from "@/stores/models";
import { useWorkflowStore, running as workflowRunning } from "@/stores/workflows";
import { formatBytes } from "@/lib/models";
import type { DownloadJob } from "@/lib/hub";
import { Button } from "./ui/button";
import { StudioDialog } from "./StudioDialog";
export function ManagedAssets() {
  const jobs = useHubStore(s => s.jobs), load = useHubStore(s => s.load);
  const { pending, snapshot, perform } = useModelsStore();
  const speechBusy = useWorkflowStore(s => workflowRunning(s.run) || s.submitting || s.inputTasks > 0);
  const [selected, setSelected] = useState<DownloadJob | null>(null);
  const assets = jobs.filter(j => j.status === "completed");
  if (!assets.length) return null;
  const loaded = snapshot.models.find(m => m.id === snapshot.engine.activeModelId)?.path;
  return <section className="surface managed-assets"><div className="hub-panel-title"><span>HF 下载资产</span><span>{assets.length} 个文件</span></div>{assets.map(job => <div className="managed-asset" key={job.id}><FileBox size={17} /><div><strong>{job.file}</strong><span>{job.repo} · {formatBytes(job.size)}</span></div><Button variant="ghost" size="icon" aria-label={`移到回收站 ${job.file}`} disabled={!!pending || speechBusy || snapshot.engine.phase === "loading" || loaded === job.path} onClick={() => setSelected(job)}><Trash2 size={15} /></Button></div>)}<StudioDialog open={!!selected} onOpenChange={open => !open && setSelected(null)} title="将下载文件移到回收站？"><p className="field-hint managed-asset-path">{selected?.path}</p><div className="studio-dialog-actions"><Button variant="outline" onClick={() => setSelected(null)}>取消</Button><Button disabled={!!pending || speechBusy} onClick={async () => { await perform("hub_delete_model", { id: selected!.id }, "下载文件已移到系统回收站，可从回收站恢复"); if (!useModelsStore.getState().error) setSelected(null); await load(); }}>移到回收站</Button></div></StudioDialog></section>;
}
