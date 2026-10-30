import { useEffect, useState } from 'react';
import { Download, FolderOpen, RefreshCw } from 'lucide-react';
import { ModelNavigation } from '@/components/ModelNavigation';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/desktop';
import { formatBytes, errorMessage } from '@/lib/models';
import { useSpeechStore, type SpeechModel } from '@/stores/speech';
import { useNodePluginStore } from '@/stores/node-plugins';

const labels = { ready: '可用', missing: '未下载', downloading: '下载中', error: '下载失败' };
export default function SpeechModels() {
  const { models, load } = useSpeechStore(), backends = useNodePluginStore(state => state.backends);
  const importers = Object.entries(backends).flatMap(([backendId, backend]) => (backend.modelImports || []).map(item => ({ ...item, backendId, id: backendId + ':' + item.engine })));
  const [selected, setSelected] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const choice = importers.find(item => item.id === selected) || importers[0];
  useEffect(() => { void load().catch(error => setError(errorMessage(error))); }, [load]);
  async function perform(command: 'speech_model_import' | 'speech_model_download', args: Record<string, unknown>) {
    setPending(true); setError(null);
    try { useSpeechStore.setState({ models: await invoke<SpeechModel[]>(command, args) }); }
    catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <div className="models-page"><ModelNavigation /><div className="page-heading"><h1>语音模型</h1><div className="speech-model-actions">
    <select className="studio-select" aria-label="导入语音模型引擎" value={choice?.id || ''} onChange={event => setSelected(event.target.value)}>{Object.entries(backends).filter(([, backend]) => backend.modelImports?.length).map(([id, backend]) => <optgroup key={id} label={backend.name}>{importers.filter(item => item.backendId === id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select>
    <Button variant="outline" className="compact-button" disabled={pending || !choice} onClick={() => choice && void perform('speech_model_import', { backendId: choice.backendId, engine: choice.engine, task: choice.task })}><FolderOpen size={14} />导入模型</Button>
    <Button variant="ghost" size="icon" aria-label="刷新语音模型" onClick={() => void load().catch(error => setError(errorMessage(error)))}><RefreshCw size={15} /></Button>
  </div></div><div className="speech-model-list">{models.map(model => <section className="speech-model-row" key={model.backendId + ':' + model.id}><div><h2>{model.name}<span>{backends[model.backendId]?.name}</span></h2><p>{model.task === 'asr' ? '语音识别' : '语音合成'}{model.languages ? ' · ' + model.languages : ''}{model.size ? ' · ' + formatBytes(model.size) : ''}</p><small title={model.directory}>{model.directory}</small>{model.error && <p role="alert" className="text-destructive">{model.error}</p>}</div><div className="speech-model-state"><span className={model.status === 'ready' ? 'is-ready' : ''}>{labels[model.status]}</span>{model.status === 'downloading' ? <progress aria-label={model.name + ' 下载进度'} value={model.bytes || 0} max={model.total || model.size} /> : model.status !== 'ready' && model.downloadable && <Button variant="outline" className="compact-button" disabled={pending} onClick={() => void perform('speech_model_download', { id: model.id })}><Download size={14} />{model.status === 'error' ? '重试' : '下载'}</Button>}</div></section>)}</div>
  {error && <p className="inline-feedback is-error" role="alert">{error}</p>}</div>;
}
