import { create } from 'zustand';
import { invoke } from '@/lib/desktop';
import { useWorkflowStore } from './workflows';

export type PluginInfo = { id: string; name: string; version: string; description: string; enabled: boolean; workflowId: string; status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'; processed: number; skipped: number; queued: number; error: string | null };
export const pluginActive = (plugin: PluginInfo) => ['starting', 'running', 'stopping'].includes(plugin.status);
export const usePluginStore = create<{ items: PluginInfo[]; receive: (items: PluginInfo[]) => void; load: () => Promise<void> }>((set, get) => ({
  items: [],
  receive(items) { set({ items }); useWorkflowStore.setState({ live: items.some(pluginActive) }); },
  async load() { get().receive(await invoke<PluginInfo[]>('plugin_list')); },
}));
