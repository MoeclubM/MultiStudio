import { memo } from 'react';
import { AudioLines, FileText, Languages, Mic, Monitor, Puzzle, Sparkles, Volume2 } from 'lucide-react';
import { useModelsStore } from '@/stores/models';
import { useSpeechStore } from '@/stores/speech';
import { fieldVisible, type NodeDefinition, type NodeConfig, type NodeField } from '@/lib/node-plugins';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';

const icons: Record<string, typeof Puzzle> = { text: FileText, audio: AudioLines, languages: Languages, mic: Mic, monitor: Monitor, sparkles: Sparkles, volume: Volume2 };
export function nodeIcon(name?: string) { return icons[name || ''] || Puzzle; }

export const NodeFields = memo(function NodeFields({ nodeId, definition, config, disabled, onChange }: { nodeId: string; definition: NodeDefinition; config: NodeConfig; disabled: boolean; onChange: (config: NodeConfig) => void }) {
  const models = useModelsStore(s => s.snapshot.models);
  const speechModels = useSpeechStore(s => s.models);
  const set = (key: string, value: string | boolean | number) => onChange({ ...config, [key]: value });
  function render(field: NodeField) {
    let key = field.key, type = field.type, resource = field.resource;
    const id = `${nodeId}-${key}`, value = config[key];
    if (type === 'boolean') return <label className="model-switch-row" key={field.key} htmlFor={id}>{field.label}<Switch id={id} checked={Boolean(value)} disabled={disabled} onCheckedChange={next => set(key, next)} /></label>;
    let control;
    if (type === 'model') {
      const entries = resource === 'asr' || resource === 'tts'
        ? speechModels.filter(model => model.task === resource && (!field.backend || model.backendId === field.backend)).map(model => ({ value: model.id, label: model.name, disabled: model.status !== 'ready' }))
        : models.filter(model => (!field.backend || model.backends?.includes(field.backend)) && (!field.family || model.family === field.family) && (resource === 'text' ? model.loadable && model.installed : model.kind === resource && model.installed)).map(model => ({ value: field.byPath ? model.path : model.id, label: model.name, disabled: false }));
      control = <select id={id} className="studio-select" value={String(value || '')} disabled={disabled} onChange={event => set(key, event.target.value)}><option value="">{entries.some(entry => !entry.disabled) ? "自动选择" : "暂无可用模型"}</option>{value && !entries.some(entry => entry.value === value) && <option value={String(value)}>模型不可用</option>}{entries.map(entry => <option key={entry.value} value={entry.value} disabled={entry.disabled}>{entry.label}{entry.disabled ? ' · 未就绪' : ''}</option>)}</select>;
    } else if (type === 'select') {
      control = <select id={id} className="studio-select" value={String(value)} disabled={disabled} onChange={event => set(key, event.target.value)}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    } else if (type === 'textarea') {
      control = <Textarea id={id} rows={field.rows || 3} maxLength={field.maxLength || 2048} value={String(value || '')} disabled={disabled} placeholder={field.placeholder} onChange={event => set(key, event.target.value)} />;
    } else {
      control = <Input id={id} type={type === 'number' ? 'number' : type === 'color' ? 'color' : 'text'} value={String(value ?? '')} min={field.min} max={field.max} step={field.step || 1} maxLength={field.maxLength || 2048} disabled={disabled} placeholder={field.placeholder || (key === 'model' ? '默认模型' : '')} onChange={event => set(key, type === 'number' ? Number(event.target.value) : event.target.value)} />;
    }
    return <div className="form-field" key={field.key}><label htmlFor={id}>{field.label}</label>{control}</div>;
  }
  const fields = definition.fields.filter(field => fieldVisible(field, config));
  return <div className="workflow-node-form nodrag nopan nowheel" onClick={event => event.stopPropagation()}>{fields.filter(field => !field.advanced).map(render)}{fields.some(field => field.advanced) && <details className="node-advanced"><summary>更多</summary><div>{fields.filter(field => field.advanced).map(render)}</div></details>}</div>;
});
