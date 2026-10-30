import { create } from 'zustand';
import { invoke, type DesktopCommand } from '@/lib/desktop';
import { installCatalog } from '@/lib/workflows';
import type { NodeCatalog } from '@/lib/node-plugins';

type State = NodeCatalog & { loaded: boolean; pending: boolean; load: () => Promise<void>; change: (command: DesktopCommand, args?: Record<string, unknown>) => Promise<void> };
let loading: Promise<void> | null = null;
export const useNodePluginStore = create<State>((set, get) => ({
  nodes: {}, backends: {}, templates: [], plugins: [], loaded: false, pending: false,
  async load() {
    if (get().loaded) return;
    if (!loading) loading = get().change('node_catalog').finally(() => { loading = null; });
    await loading;
  },
  async change(command, args) {
    set({ pending: true });
    try { const catalog = await invoke<NodeCatalog>(command, args); installCatalog(catalog); set({ ...catalog, loaded: true }); }
    finally { set({ pending: false }); }
  },
}));
