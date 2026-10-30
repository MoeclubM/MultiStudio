import { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { hasDesktop, invoke } from '@/lib/desktop';
import { errorMessage } from '@/lib/models';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

type ApiSettings = { enabled: boolean; running: boolean; port: number; url: string; token: string; tokenPersistent: boolean; error: string | null };
export function LocalApiSettings() {
  const [settings, setSettings] = useState<ApiSettings | null>(null), [port, setPort] = useState('18765');
  const [pending, setPending] = useState(false), [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null), [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    void invoke<ApiSettings>('api_settings').then(value => { setSettings(value); setPort(String(value.port)); }).catch(error => setError(errorMessage(error)));
  }, []);
  async function configure(patch: Record<string, unknown>) {
    setPending(true); setError(null); setCopied(null);
    try { const value = await invoke<ApiSettings>('api_configure', patch); setSettings(value); setPort(String(value.port)); }
    catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  async function copy(value: string, key: string) {
    try { await navigator.clipboard.writeText(value); setCopied(key); }
    catch { setError('复制失败'); }
  }
  return <section>
    <div className="settings-group-heading"><h2>本机 API</h2><span className="field-hint">{settings?.running ? '运行中' : settings?.enabled ? '启动失败' : '已关闭'}</span></div>
    <div className="surface settings-panel">
      <label className="model-switch-row" htmlFor="local-api-enabled">启用服务<Switch id="local-api-enabled" checked={settings?.enabled || false} disabled={!hasDesktop() || !settings || pending} onCheckedChange={enabled => void configure({ enabled, port: Number(port) })} /></label>
      <form className="form-field" onSubmit={event => { event.preventDefault(); void configure({ port: Number(port) }); }}>
        <label htmlFor="local-api-port">端口</label><div className="api-test-row"><Input id="local-api-port" className="max-w-40" type="number" min={1024} max={65535} value={port} disabled={!settings || pending} onChange={event => setPort(event.target.value)} /><Button variant="outline" className="compact-button" disabled={!settings || pending || port === String(settings.port)}>{pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}应用</Button></div>
      </form>
      <div className="form-field"><label htmlFor="local-api-address">服务地址</label><div className="password-field"><Input id="local-api-address" readOnly value={settings?.url || ''} /><button type="button" aria-label="复制服务地址" disabled={!settings} onClick={() => settings && void copy(settings.url, 'url')}>{copied === 'url' ? <Check size={15} /> : <Copy size={15} />}</button></div></div>
      <div className="form-field"><label htmlFor="local-api-token">访问密钥</label><div className="password-field"><Input id="local-api-token" readOnly autoComplete="off" type={visible ? 'text' : 'password'} value={settings?.token || ''} /><button type="button" aria-label={visible ? '隐藏访问密钥' : '显示访问密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
      <div className="api-test-row"><Button variant="outline" className="compact-button" disabled={!settings} onClick={() => settings && void copy(settings.token, 'token')}>{copied === 'token' ? <Check size={14} /> : <Copy size={14} />}复制密钥</Button><Button variant="ghost" className="compact-button" disabled={!settings || pending} onClick={() => void configure({ regenerateToken: true })}><RefreshCw size={14} />重置密钥</Button></div>
      {settings && !settings.tokenPersistent && <p className="field-hint">系统密钥存储不可用，重启后访问密钥会更新。</p>}
      {(error || settings?.error) && <p className="inline-feedback is-error" role="alert">{error || settings?.error}</p>}
    </div>
  </section>;
}
