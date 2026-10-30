import { create } from 'zustand';
import { invoke } from '@/lib/desktop';
import { errorMessage } from '@/lib/models';

export type RuntimeItem = { id: string; name: string; version: string; status: 'bundled' | 'ready' | 'missing' | 'downloading' | 'installing' | 'error'; bytes: number; total: number; error: string | null };
export type RuntimeState = { directory: string; items: RuntimeItem[] };
export const useRuntimeStore = create<{ snapshot: RuntimeState | null; error: string | null; load: () => Promise<void> }>((set) => ({
  snapshot: null, error: null,
  async load() {
    try { set({ snapshot: await invoke<RuntimeState>('runtime_settings'), error: null }); }
    catch (error) { set({ error: errorMessage(error) }); }
  },
}));
