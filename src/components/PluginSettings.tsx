import { useState } from 'react';
import { FolderOpen, RefreshCw, Upload } from 'lucide-react';
import { invoke, type DesktopCommand } from '@/lib/desktop';
import { errorMessage } from '@/lib/models';
import { capturing, running, useWorkflowStore } from '@/stores/workflows';
import { useNodePluginStore } from '@/stores/node-plugins';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { RuntimeSettings } from './RuntimeSettings';

export function PluginSettings() {
  const { plugins, pending, change } = useNodePluginStore();
  const locked = useWorkflowStore(state => running(state.run) || state.live || state.submitting || state.inputTasks > 0 || capturing(state.capture));
  const [error, setError] = useState<string | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  async function action(command: DesktopCommand, args?: Record<string, unknown>) {
    setError(null); try { await change(command, args); } catch (error) { setError(errorMessage(error)); }
  }
  return <section className="plugin-settings">
    <div className="plugin-toolbar"><h2>插件</h2><Button variant="outline" className="compact-button" disabled={pending || locked || runtimeBusy} onClick={() => void action('node_plugin_import')}><Upload size={14} />导入插件</Button><Button variant="ghost" size="icon" aria-label="重新加载插件" disabled={pending || locked || runtimeBusy} onClick={() => void action('node_plugin_reload')}><RefreshCw size={14} /></Button><Button variant="ghost" size="icon" aria-label="打开插件目录" onClick={() => void invoke('node_plugin_directory').catch(error => setError(errorMessage(error)))}><FolderOpen size={14} /></Button></div>
    {plugins.map(plugin => <div className="plugin-entry" key={plugin.id}><div className="plugin-heading"><div><h3>{plugin.name}<span>{plugin.version}</span></h3><span>{plugin.nodes.length} 个节点 · {plugin.bundled ? '内置' : '已安装'}</span></div><Switch aria-label={`启用${plugin.name}`} checked={plugin.enabled} disabled={pending || locked || runtimeBusy} onCheckedChange={enabled => void action('node_plugin_toggle', { id: plugin.id, enabled })} /></div>{plugin.error && <p className="inline-feedback is-error" role="alert">{plugin.error}</p>}</div>)}
    <RuntimeSettings locked={locked || pending} onBusyChange={setRuntimeBusy} />
    {error && <p className="inline-feedback is-error" role="alert">{error}</p>}
  </section>;
}
