import { memo, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { invoke } from '@/lib/desktop';
import { errorMessage } from '@/lib/models';
import { capturing, useWorkflowStore } from '@/stores/workflows';
import type { AudioWidgetProps } from './WorkflowAudioInput';

type AudioDevice = { id: string; name: string; kind: 'input' | 'output' };
export const WorkflowLiveAudioInput = memo(function WorkflowLiveAudioInput({ nodeId, config, disabled, onChange }: AudioWidgetProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]), [error, setError] = useState<string | null>(null);
  const capture = useWorkflowStore(state => state.capture?.nodeId === nodeId ? state.capture : null), own = !!capture;
  const source = String(config.source), recording = own && capturing(capture);
  const filtered = devices.filter(device => device.kind === (source === 'system' ? 'output' : 'input'));
  async function refresh() { try { setDevices(await invoke<AudioDevice[]>('list_audio_devices')); setError(null); } catch (error) { setError(errorMessage(error)); } }
  useEffect(() => { void refresh(); }, []);
  return <div className="workflow-audio-widget nodrag nopan nowheel" onClick={event => event.stopPropagation()}>
    <label className="audio-source-field"><span>来源</span><select className="studio-select" aria-label="实时音频来源" value={source} disabled={disabled} onChange={event => onChange({ ...config, source: event.target.value, deviceId: '' })}><option value="microphone">麦克风</option><option value="system" disabled={window.multistudioDesktop?.platform !== 'win32'}>系统音频</option></select></label>
    <div className="audio-device-field"><select className="studio-select" aria-label="音频设备" value={String(config.deviceId)} disabled={disabled} onChange={event => onChange({ ...config, deviceId: event.target.value })}><option value="">系统默认设备</option>{filtered.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select><button aria-label="刷新音频设备" disabled={disabled} onClick={() => void refresh()}><RefreshCw size={13} /></button></div>
    <div className="audio-level" role="meter" aria-label="输入音量" aria-valuenow={Math.round((own ? capture?.rms || 0 : 0) * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, (own ? capture?.rms || 0 : 0) * 500)}%` }} /></div>
    <div className="workflow-audio-state" role="status">{recording ? '采集中' : '未采集'}</div>
    {(error || own && capture?.error) && <p role="alert" className="inline-feedback is-error">{error || capture?.error}</p>}
  </div>;
});
