import { useEffect } from "react";
import { Check, Download, Loader2, Pause, Play, X } from "lucide-react";
import { useHubStore } from "@/stores/hub";
import { downloadLabels } from "@/lib/hub";
import { formatBytes } from "@/lib/models";
import { ModelNavigation } from "@/components/ModelNavigation";
import { Button } from "@/components/ui/button";
export default function Downloads() {
  const { jobs, error, load, action } = useHubStore();
  useEffect(() => { void load(); }, [load]);
  return <div className="downloads-page"><ModelNavigation /><div className="page-heading"><div><h1>下载任务</h1></div></div>
    {error && <p className="inline-feedback is-error" role="alert">{error}</p>}
    <section className="surface download-list">{jobs.length ? [...jobs].reverse().map(job => <article key={job.id} className="download-job"><div className="download-symbol">{job.status === "completed" ? <Check size={22} /> : ["downloading", "verifying"].includes(job.status) ? <Loader2 size={22} className="animate-spin" /> : <Download size={22} />}</div><div className="download-copy"><strong>{job.file}</strong><p>{job.repo} · {job.revision.slice(0, 8)}</p><progress aria-label={`${job.file} 下载进度`} value={job.bytes} max={job.size} /><div className="download-meta"><span>{downloadLabels[job.status]}</span><span>{formatBytes(job.bytes)} / {formatBytes(job.size)}</span>{job.speed > 0 && <span>{formatBytes(job.speed)}/s</span>}</div>{job.error && <p role="alert" className="download-error">{job.error}</p>}<details><summary>文件位置</summary><p>{job.path}</p></details></div><div className="download-actions">{["queued", "downloading", "verifying"].includes(job.status) && <Button variant="ghost" size="icon" aria-label={`暂停 ${job.file}`} onClick={() => void action(job.id, "pause")}><Pause size={16} /></Button>}{["paused", "failed"].includes(job.status) && <Button variant="ghost" size="icon" aria-label={`继续 ${job.file}`} onClick={() => void action(job.id, "resume")}><Play size={16} /></Button>}{!["completed", "cancelled", "deleted"].includes(job.status) && <Button variant="ghost" size="icon" aria-label={`取消 ${job.file}`} onClick={() => void action(job.id, "cancel")}><X size={16} /></Button>}</div></article>) : <div className="empty-state"><Download size={32} /><h2>暂无下载</h2></div>}</section>
  </div>;
}
