import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, Box, Check, Compass, Download, FileBox, Loader2, Search, Settings2, Star } from "lucide-react";
import { useHubStore } from "@/stores/hub";
import { hasDesktop, invoke } from "@/lib/desktop";
import { formatBytes } from "@/lib/models";
import { formatCount, taskLabels } from "@/lib/hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelNavigation } from "@/components/ModelNavigation";
import { HubSettingsDialog } from "@/components/HubSettingsDialog";
import { cn } from "@/lib/utils";
export default function Discover() {
  const hub = useHubStore(); const native = hasDesktop();
  const [params] = useSearchParams(); const repository = params.get("repo") || "";
  const [query, setQuery] = useState(repository), [task, setTask] = useState(""), [sort, setSort] = useState("downloads"), [gguf, setGguf] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false), [fileQuery, setFileQuery] = useState(""), [selected, setSelected] = useState<string[]>([]), [adding, setAdding] = useState(false);
  useEffect(() => { void hub.load(); void hub.search(repository, "", true, "downloads"); if (repository) void hub.select(repository); }, []);
  useEffect(() => { setSelected([]); setFileQuery(""); }, [hub.detail?.id]);
  async function addDownloads() { setAdding(true); for (const file of selected) { if (!await hub.download(file)) break; setSelected(values => values.filter(value => value !== file)); } setAdding(false); }
  const files = hub.detail?.files.filter(f => f.name.toLowerCase().includes(fileQuery.toLowerCase())) ?? [];
  return <div className="hub-page"><ModelNavigation />
    <div className="page-heading"><div><h1>发现模型</h1></div><Button variant="outline" className="compact-button" onClick={() => setSettingsOpen(true)}><Settings2 size={15} />下载设置</Button></div>
    <form className="surface hub-search-bar" onSubmit={e => { e.preventDefault(); void hub.search(query, task, gguf, sort); }}>
      <div className="hub-search-input"><Search size={17} /><Input aria-label="搜索 HF 模型" placeholder="模型名称或仓库" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select className="studio-select" aria-label="HF 模型任务" value={task} onChange={e => setTask(e.target.value)}><option value="">全部任务</option>{Object.entries(taskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className="studio-select" aria-label="HF 排序" value={sort} onChange={e => setSort(e.target.value)}><option value="downloads">下载最多</option><option value="trendingScore">热门趋势</option><option value="lastModified">最近更新</option></select>
      <Button type="submit" className="compact-button" disabled={!native || hub.searching}>{hub.searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}搜索</Button>
      <label className="hub-format-toggle"><input type="checkbox" checked={gguf} onChange={e => setGguf(e.target.checked)} />仅 GGUF</label>
    </form>
    {hub.error && <p role="alert" className="inline-feedback is-error">{hub.error}</p>}
    <div className="hub-explorer"><section className="surface hub-results" aria-label="HF 仓库列表">
      <div className="hub-panel-title"><span>模型仓库</span><span>{hub.models.length ? `${hub.models.length} 个结果` : "Hugging Face"}</span></div>
      {hub.searching ? <div className="empty-state"><Loader2 className="animate-spin" size={28} /><p>正在连接 Hugging Face…</p></div> : hub.models.length ? hub.models.map(model => <button key={model.id} className={cn("hub-repository", hub.detail?.id === model.id && "is-selected")} onClick={() => void hub.select(model.id)}><span className="hub-repo-symbol"><Box size={19} /></span><span className="hub-repo-copy"><strong>{model.id.split('/')[1]}</strong><small>{model.id.split('/')[0]}</small><span className="hub-repo-stats"><span><Download size={11} />{formatCount(model.downloads)}</span><span><Star size={11} />{formatCount(model.likes)}</span><span>{taskLabels[model.task] ?? (model.tags.includes("gguf") ? "GGUF" : "模型")}</span></span></span></button>) : <div className="empty-state"><Compass size={32} /><h2>暂无结果</h2></div>}
    </section><section className="surface hub-detail" aria-label="HF 模型详情">
      {hub.loadingDetail ? <div className="empty-state"><Loader2 size={28} className="animate-spin" /><p>读取仓库文件…</p></div> : hub.detail ? <>
        <div className="hub-detail-heading"><h2>{hub.detail.id.split('/')[1]}</h2><p>{hub.detail.id}</p><div className="hub-tags"><span>{taskLabels[hub.detail.task] ?? "开源模型"}</span><span>{hub.detail.license}</span>{hub.detail.gated && <span>需访问许可</span>}</div><button className="studio-text-link" onClick={() => void invoke("hub_open_repository", { repo: hub.detail!.id }).catch(e => useHubStore.setState({ error: String(e) }))}>查看模型卡与许可<ArrowUpRight size={13} /></button></div>
        <div className="hub-files-toolbar"><h3>可下载文件 <span>{hub.detail.files.length}</span></h3><Input type="search" aria-label="筛选 HF 文件" placeholder="筛选文件" value={fileQuery} onChange={e => setFileQuery(e.target.value)} /></div>
        <div className="hub-files">{files.map(file => { const job = hub.jobs.find(j => j.repo === hub.detail!.id && j.revision === hub.detail!.revision && j.file === file.name && !["cancelled", "deleted"].includes(j.status)); return <label className="hub-file" key={file.name}><input type="checkbox" checked={selected.includes(file.name)} disabled={!file.downloadable || !!job || adding} onChange={e => setSelected(values => e.target.checked ? [...values, file.name] : values.filter(v => v !== file.name))} /><FileBox size={18} /><span><strong>{file.name}</strong><small>{/\.gguf$/i.test(file.name) ? ["davidxifeng/Confucius4-R2T2-gguf", "Nairod785/Confucius4-R2T2-Q4_K_M-GGUF"].includes(hub.detail!.id) ? "R2T2 语音识别 · 单文件" : "GGUF" : /\.onnx$/i.test(file.name) ? "ONNX" : /\.safetensors$/i.test(file.name) ? "Safetensors" : file.downloadable ? "辅助文件" : "不可下载"}</small></span><span className="hub-file-size">{job ? job.status === "completed" ? <><Check size={12} />已下载</> : "已在任务中" : formatBytes(file.size)}</span></label>; })}{!files.length && <p className="field-hint">没有匹配的文件。</p>}</div>
        <div className="hub-download-footer"><div><span>{selected.length} 个已选 · {formatBytes(hub.detail.files.filter(f => selected.includes(f.name)).reduce((sum, f) => sum + f.size, 0))}</span><Button className="compact-button" disabled={!native || !selected.length || adding} onClick={() => void addDownloads()}><Download size={15} />{adding ? "加入队列中…" : "下载所选文件"}</Button></div></div>
      </> : <div className="empty-state hub-detail-empty"><FileBox size={36} strokeWidth={1.3} /></div>}
    </section></div><HubSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>;
}
