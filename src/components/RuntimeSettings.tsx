import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, Square } from 'lucide-react';
import { invoke } from '@/lib/desktop';
import { errorMessage, formatBytes } from '@/lib/models';
import { Button } from './ui/button';
import { Input } from './ui/input';

import { useRuntimeStore, type RuntimeState } from '@/stores/runtimes';
const labels = { bundled: '随安装包提供', ready: '已安装', missing: '未安装', downloading: '下载中', installing: '安装中', error: '安装失败' };
export function RuntimeSettings({ locked, onBusyChange }: { locked: boolean; onBusyChange: (busy: boolean) => void }) {
  const state = useRuntimeStore(s => s.snapshot), runtimeError = useRuntimeStore(s => s.error);
  const setState = (snapshot: RuntimeState) => useRuntimeStore.setState({ snapshot, error: null });
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const message = error || runtimeError;
  const busy = pending || !!state?.items.some(item => ['downloading', 'installing'].includes(item.status));
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  async function install(id: string) {
    setPending(true); setError(null);
    try { setState(await invoke<RuntimeState>('runtime_install', { id })); }
    catch (error) { const message = errorMessage(error); if (!/取消|abort/i.test(message)) setError(message); }
    finally { setPending(false); }
  }
  if (!state?.items.length && !message) return null;
  return <section className="runtime-settings">
    <div className="settings-group-heading"><h2>运行库</h2></div>
    <div className="form-field"><label htmlFor="runtime-directory">下载目录</label><div className="password-field"><Input id="runtime-directory" value={state?.directory || ''} readOnly /><button type="button" aria-label="更改运行库目录" disabled={locked || busy} onClick={() => void invoke<RuntimeState>('runtime_pick_directory').then(setState).catch(error => setError(errorMessage(error)))}><FolderOpen size={15} /></button></div></div>
    {state?.items.map(item => <div className="plugin-entry" key={item.id}>
      <div className="plugin-heading"><div><h3>{item.name}<span>{item.version}</span></h3><span>{labels[item.status]}{item.status === 'missing' ? ` · ${formatBytes(item.total)}` : ''}</span></div>
        {['downloading', 'installing'].includes(item.status)
          ? <Button variant="ghost" className="compact-button" onClick={() => void invoke('runtime_cancel', { id: item.id }).catch(error => setError(errorMessage(error)))}><Square size={13} />取消</Button>
          : ['missing', 'error'].includes(item.status) && <Button variant="outline" className="compact-button" disabled={locked || busy} onClick={() => void install(item.id)}>{pending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{item.status === 'error' ? '重试' : '安装'}</Button>}
      </div>
      {['downloading', 'installing'].includes(item.status) && <div className="runtime-progress"><progress aria-label={`${item.name} 下载进度`} value={item.bytes} max={item.total} /><span>{formatBytes(item.bytes)} / {formatBytes(item.total)}</span></div>}
      {item.error && item.error !== message && <p className="inline-feedback is-error" role="alert">{item.error}</p>}
    </div>)}
    {message && <p className="inline-feedback is-error" role="alert">{message}</p>}
  </section>;
}
