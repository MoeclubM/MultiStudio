export type ConfigValue = string | number | boolean;
export type NodeConfig = Record<string, ConfigValue>;
export type NodeField = {
  key: string; label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'model' | 'color';
  options?: { value: string; label: string }[];
  platformOptions?: Record<string, { value: string; label: string }[]>;
  resource?: 'text' | 'asr' | 'tts' | 'speech' | 'vision' | 'projector'; byPath?: boolean;
  min?: number; max?: number; step?: number; rows?: number; maxLength?: number; placeholder?: string;
  advanced?: boolean;
  backend?: string;
  family?: string;
  when?: Record<string, ConfigValue | ConfigValue[]>;
};
export type NodeDefinition = {
  label: string; group: string; input: string | null; output: string | null; icon?: string;
  defaults: NodeConfig; fields: NodeField[]; widget?: string; context?: boolean; session?: boolean; apiInput?: boolean;
  pluginId: string; pluginName: string;
  backend?: string;
};
export type NodeTemplate = { id: string; label: string; pluginId: string; nodes: { kind: string; config?: NodeConfig }[]; links?: [number, number][] };
export type BackendDefinition = { name: string; pluginId: string; capabilities: string[]; modelImports?: { engine: string; name: string; task: 'asr' | 'tts'; format: 'gguf' | 'directory' }[] };
export type NodePlugin = { id: string; name: string; version: string; bundled: boolean; enabled: boolean; nodes: string[]; backends: string[]; path: string; error: string | null };
export type NodeCatalog = { nodes: Record<string, NodeDefinition>; backends: Record<string, BackendDefinition>; templates: NodeTemplate[]; plugins: NodePlugin[] };
export function fieldVisible(field: NodeField, config: NodeConfig) {
  return Object.entries(field.when || {}).every(([key, value]) => Array.isArray(value) ? value.includes(config[key]) : value === config[key]);
}
