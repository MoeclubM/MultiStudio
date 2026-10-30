import { create } from "zustand";
import { invoke, hasDesktop } from "@/lib/desktop";
import type { AppConfig } from "@/lib/types";
import { errorMessage } from "@/lib/models";

const DEFAULT_CONFIG: AppConfig = { llm: { baseUrl: "", apiKey: "", llmModel: "" } };

type ConfigStore = {
  config: AppConfig;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (patch: Partial<AppConfig> | ((c: AppConfig) => AppConfig)) => Promise<void>;
  setLocal: (patch: Partial<AppConfig>) => void;
};

let saveQueue: Promise<unknown> = Promise.resolve();
let saveRevision = 0;
export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,
  saving: false,
  error: null,
  async load() {
    if (!hasDesktop()) { set({ loaded: true }); return; }
    try {
      const raw = await invoke<any>("get_config");
      const cfg: any = raw ?? {};
      const norm: AppConfig = { llm: { ...DEFAULT_CONFIG.llm, ...cfg.llm } };
      set({ config: norm, loaded: true, error: null });
    } catch (error) {
      set({ loaded: true, error: errorMessage(error) });
    }
  },
  async save(patch) {
    const prev = get().config;
    const next = typeof patch === "function" ? (patch as (c: AppConfig) => AppConfig)(prev) : { ...prev, ...patch } as AppConfig;
    const revision = ++saveRevision;
    set({ config: next, saving: hasDesktop(), error: null });
    if (!hasDesktop()) return;
    try {
      const task = saveQueue.then(() => invoke<AppConfig>("set_config", { config: next }));
      saveQueue = task.catch(() => {});
      const saved = await task;
      if (revision === saveRevision) set({ config: saved, saving: false, error: null });
    } catch (error) {
      if (revision === saveRevision) set({ config: prev, saving: false, error: errorMessage(error) });
    }
  },
  setLocal(patch) {
    set((s) => ({ config: { ...s.config, ...patch } as AppConfig }));
  },
}));
