import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Box, Check, FileBox, FolderOpen, Image, Info, Loader2, Mic, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useModelsStore } from "@/stores/models";
import { formatBytes, kindLabels, type ModelKind } from "@/lib/models";
import { hasDesktop, invoke } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StudioDialog } from "@/components/StudioDialog";
import { ModelNavigation } from "@/components/ModelNavigation";
import { ManagedAssets } from "@/components/ManagedAssets";
import { useWorkflowStore, running as workflowRunning } from "@/stores/workflows";

const icons = { text: Box, speech: Mic, vision: Image, projector: FileBox };
type Filter = "all" | ModelKind;

export default function Models() {
  const { snapshot, loaded, refreshing, pending, error, notice, refresh, perform } = useModelsStore();
  const workflowBusy = useWorkflowStore(s => workflowRunning(s.run) || s.submitting || s.inputTasks > 0);
  const native = hasDesktop();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"import" | "directories" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ModelKind>("text");
  const [options, setOptions] = useState(snapshot.settings.loadOptions);
  const [autoLoad, setAutoLoad] = useState(snapshot.settings.autoLoad);
  const { models, engine, settings } = snapshot;
  const busy = !!pending || engine.phase === "loading" || workflowBusy;
  const filtered = useMemo(() => models.filter((m) => (filter === "all" || m.kind === filter) && (m.name + " " + m.fileName).toLowerCase().includes(query.trim().toLowerCase())), [models, filter, query]);
  const selected = filtered.find((m) => m.id === selectedId) ?? filtered.find((m) => m.id === engine.activeModelId) ?? filtered[0];

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setOptions(settings.loadOptions); setAutoLoad(settings.autoLoad); }, [settings.loadOptions, settings.autoLoad]);

  function openDialog(next: "import" | "directories") { setPath(""); setName(""); setDialog(next); }
  async function browse(directory = false) {
    try {
      const selected = await invoke<string | null>(directory ? "pick_model_directory" : "pick_model_file");
      if (selected) setPath(selected);
    } catch (error) { useModelsStore.setState({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async function submitImport(event: FormEvent) {
    event.preventDefault();
    const id = await perform<string>("import_model", { path, name, kind }, "模型已登记，原文件保持不变");
    if (id) { setSelectedId(id); setFilter("all"); setQuery(""); setDialog(null); }
  }
  async function submitDirectory(event: FormEvent) {
    event.preventDefault();
    await perform("add_model_directory", { path }, "目录已添加");
    if (!useModelsStore.getState().error) setPath("");
  }

  return <div className="models-page">
    <ModelNavigation />
    <div className="page-heading studio-heading">
      <div><h1>模型库</h1></div>
      <div className="studio-actions">

        <Button variant="outline" className="compact-button" onClick={() => openDialog("directories")}><FolderOpen size={15} />模型目录</Button>
        <Button className="compact-button" onClick={() => openDialog("import")}><Plus size={15} />导入模型</Button>
      </div>
    </div>


    {(error || notice) && <p role={error ? "alert" : "status"} className={cn("inline-feedback studio-feedback", error && "is-error")}>{error || notice}</p>}
    {workflowBusy && <p className="inline-feedback studio-feedback">模型正在使用中</p>}

    <div className="model-explorer">
      <section className="surface model-list-panel" aria-label="本地模型列表">
        <div className="model-list-heading"><h2>本地文件 <span>{models.length}</span></h2><Button variant="ghost" size="icon" className="header-icon-button" aria-label="刷新模型库" disabled={refreshing || busy} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /></Button></div>
        <div className="model-list-tools"><div className="model-search"><Search size={15} /><Input type="search" aria-label="搜索模型" placeholder="搜索模型或文件名…" value={query} onChange={(e) => setQuery(e.target.value)} /></div><SegmentedControl<Filter> label="模型类型筛选" value={filter} onChange={setFilter} options={[{ value: "all", label: "全部" }, { value: "text", label: "文本" }, { value: "speech", label: "语音" }, { value: "vision", label: "视觉" }, { value: "projector", label: "组件" }]} /></div>
        <div className="model-results">
          {!loaded ? <div className="empty-state"><Loader2 size={26} className="animate-spin" /><h2>正在扫描模型目录</h2></div>
            : filtered.length ? filtered.map((model) => {
              const Icon = icons[model.kind];
              return <button key={model.id} className={cn("model-file-row", selected?.id === model.id && "is-selected")} aria-pressed={selected?.id === model.id} onClick={() => setSelectedId(model.id)}>
                <span className={"model-file-icon kind-" + model.kind}><Icon size={21} strokeWidth={1.5} /></span>
                <span className="model-file-copy"><strong title={model.fileName}>{model.name}</strong><span>{kindLabels[model.kind]}<i>·</i>{model.quantization ?? "GGUF"}<i>·</i>{formatBytes(model.sizeBytes)}</span></span>
                <span className={cn("model-row-status", model.id === engine.activeModelId && "is-loaded")}>{model.id === engine.activeModelId ? <><Check size={12} />已加载</> : !model.installed ? "文件缺失" : !model.loadable ? model.backendId ? "可用" : "仅登记" : "可用"}</span>
              </button>;
            }) : <div className="empty-state model-library-empty"><div className="empty-model-symbol"><Box size={30} strokeWidth={1.25} /></div><h2>{models.length ? "无匹配结果" : "暂无模型"}</h2></div>}
        </div>

      </section>

      <aside className="surface model-inspector" aria-label="模型详情">
        <div className="inspector-heading"><SlidersHorizontal size={16} /><h2>{selected ? "模型详情" : "运行环境"}</h2></div>
        {selected ? <div className="inspector-model"><span className="model-format-tag">GGUF</span><h3>{selected.name}</h3><dl><div><dt>类型</dt><dd>{kindLabels[selected.kind]}</dd></div><div><dt>文件大小</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div><div><dt>量化</dt><dd>{selected.quantization ?? "未识别"}</dd></div><div><dt>来源</dt><dd>{selected.imported ? "手动登记" : "目录扫描"}</dd></div></dl><details className="model-path"><summary>文件位置</summary><p>{selected.path}</p></details><p className="model-compatibility"><Info size={14} />{selected.compatibility}</p>
          {selected.imported && <button className="forget-model-button" disabled={busy || !native} onClick={() => void perform("forget_model", { modelId: selected.id }, "已取消手动登记；原文件未删除，目录扫描仍可能显示该文件")}>取消登记</button>}
        </div> : <div className="inspector-placeholder"><Box size={25} strokeWidth={1.2} /></div>}
        <details className="model-load-settings"><summary>文本默认设置</summary><form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); await perform("set_model_load_options", { options, autoLoad }, "默认参数已保存"); }}>

          <div className="form-grid"><div className="form-field"><label htmlFor="model-context">上下文长度</label><Input id="model-context" className="field-control" type="number" min={512} max={32768} step={512} required value={options.contextLength} onChange={(e) => setOptions({ ...options, contextLength: Number(e.target.value) })} /></div><div className="form-field"><label htmlFor="model-threads">CPU 线程</label><Input id="model-threads" className="field-control" type="number" min={1} max={64} required value={options.threads} onChange={(e) => setOptions({ ...options, threads: Number(e.target.value) })} /></div></div>
          <div className="form-field"><label htmlFor="text-default-device">默认设备</label><select id="text-default-device" className="studio-select" value={options.useGpu ? "auto" : "cpu"} onChange={event => setOptions({ ...options, useGpu: event.target.value !== "cpu" })}><option value="auto">自动</option><option value="cpu">CPU</option></select></div>
          <label className="model-switch-row">启动时预加载<Switch aria-label="启动时预加载" checked={autoLoad} onCheckedChange={setAutoLoad} /></label>
          <Button type="submit" variant="outline" className="compact-button" disabled={!native || busy}>保存默认参数</Button>

        </form></details>
      </aside>
    </div>
    {snapshot.warnings.length > 0 && <details className="catalogue-warnings"><summary>目录扫描提示（{snapshot.warnings.length}）</summary>{snapshot.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
    <ManagedAssets />

    <StudioDialog open={dialog === "import"} onOpenChange={(open) => !open && setDialog(null)} title="导入本地模型">
      <form className="studio-dialog-form" onSubmit={submitImport}>
        <div className="form-field"><label htmlFor="import-path">GGUF 文件绝对路径</label><Input id="import-path" className="field-control" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\Models\model-Q4_K_M.gguf" spellCheck={false} /></div>
        <Button type="button" variant="outline" className="compact-button" disabled={!native || busy} onClick={() => void browse()}><FolderOpen size={14} />浏览模型文件</Button>
        <div className="form-field"><label htmlFor="import-name">显示名称（可选）</label><Input id="import-name" className="field-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="留空使用文件名" /></div>
        <div className="form-field"><label>模型类型</label><SegmentedControl<ModelKind> label="导入模型类型" value={kind} onChange={setKind} options={[{ value: "text", label: "文本" }, { value: "speech", label: "语音" }, { value: "vision", label: "视觉" }, { value: "projector", label: "投影组件" }]} /></div>

        {error && <p role="alert" className="inline-feedback is-error">{error}</p>}
        <div className="studio-dialog-actions"><Button type="button" variant="outline" className="compact-button" onClick={() => setDialog(null)}>取消</Button><Button type="submit" className="compact-button" disabled={!native || busy}>{pending === "import_model" && <Loader2 size={14} className="animate-spin" />}登记模型</Button></div>
      </form>
    </StudioDialog>
    <StudioDialog open={dialog === "directories"} onOpenChange={(open) => !open && setDialog(null)} title="模型目录">
      <div className="directory-list">{settings.directories.length ? settings.directories.map((dir) => <div key={dir}><FolderOpen size={17} /><span>{dir}</span><button type="button" disabled={busy} aria-label={"停止扫描目录 " + dir} onClick={() => void perform("remove_model_directory", { path: dir }, "已停止扫描此目录；文件未删除")}><Trash2 size={15} /></button></div>) : <p className="field-hint">暂无目录</p>}</div>
      <form className="studio-dialog-form" onSubmit={submitDirectory}><div className="form-field"><label htmlFor="directory-path">添加目录</label><Input id="directory-path" className="field-control" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="模型目录的绝对路径" spellCheck={false} /></div>{error && <p role="alert" className="inline-feedback is-error">{error}</p>}<div className="studio-dialog-actions"><Button type="button" variant="outline" className="compact-button" disabled={!native || busy} onClick={() => void browse(true)}><FolderOpen size={14} />浏览目录</Button><Button type="submit" className="compact-button" disabled={!native || busy}><Plus size={14} />添加并扫描</Button></div></form>
    </StudioDialog>
  </div>;
}
