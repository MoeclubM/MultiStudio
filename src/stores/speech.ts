import { create } from "zustand";
import { DEFAULT_SPEECH, type SpeechSettings } from "@/lib/conversations";
import { invoke } from "@/lib/desktop";
export type SpeechModel = { id: string; name: string; backendId: string; downloadable?: boolean; task: "asr" | "tts"; engine: string; directory: string; status: "ready" | "missing" | "downloading" | "error"; languages: string; size: number; bytes?: number; total?: number; error?: string; speakers?: number };
export const useSpeechStore = create<{ speech: SpeechSettings; models: SpeechModel[]; load: () => Promise<void> }>((set) => ({
  speech: DEFAULT_SPEECH, models: [],
  async load() { const [speech, models] = await Promise.all([invoke<SpeechSettings>("speech_settings"), invoke<SpeechModel[]>("speech_models")]); set({ speech, models }); },
}));
