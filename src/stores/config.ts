import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "@/lib/types";

const DEFAULT_CONFIG: AppConfig = {
  asr: {
    id: "asr-default",
    name: "ASR",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    asrModel: "whisper-1",
    llmModel: "whisper-1",
  },
  llm: {
    id: "llm-default",
    name: "LLM",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    asrModel: "gpt-4o-mini",
    llmModel: "gpt-4o-mini",
  },
  audio: {
    sourceKind: "microphone",
    inputDeviceId: null,
    sampleRate: 16000,
    vadEnabled: true,
    vadThreshold: 0.5,
    silenceMs: 500,
    minSegmentMs: 800,
    maxSegmentMs: 8000,
  },
  translation: {
    sourceLang: "auto",
    targetLang: "zh",
    sourceLangLabel: "自动检测",
    targetLangLabel: "中文",
    extraPrompt: "",
    llmTemperature: 0.3,
    streamTranslation: true,
  },
};

type ConfigStore = {
  config: AppConfig;
  loaded: boolean;
  saving: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<AppConfig> | ((c: AppConfig) => AppConfig)) => Promise<void>;
  setLocal: (patch: Partial<AppConfig>) => void;
};

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,
  saving: false,
  async load() {
    try {
      const cfg = await invoke<AppConfig>("get_config");
      set({ config: { ...DEFAULT_CONFIG, ...cfg, asr: { ...DEFAULT_CONFIG.asr, ...(cfg as AppConfig).asr }, llm: { ...DEFAULT_CONFIG.llm, ...(cfg as AppConfig).llm }, audio: { ...DEFAULT_CONFIG.audio, ...(cfg as AppConfig).audio }, translation: { ...DEFAULT_CONFIG.translation, ...(cfg as AppConfig).translation } }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(patch) {
    const prev = get().config;
    const next = typeof patch === "function" ? (patch as (c: AppConfig) => AppConfig)(prev) : { ...prev, ...patch } as AppConfig;
    set({ config: next, saving: true });
    try {
      const saved = await invoke<AppConfig>("set_config", { config: next });
      set({ config: saved, saving: false });
    } catch {
      set({ saving: false });
    }
  },
  setLocal(patch) {
    set((s) => ({ config: { ...s.config, ...patch } as AppConfig }));
  },
}));
