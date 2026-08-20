import { create } from "zustand";
import type { PipelineStatus, TranscriptSegment, TranslationSegment } from "@/lib/types";

type SessionStore = {
  status: PipelineStatus;
  rms: number;
  peak: number;
  transcripts: TranscriptSegment[];
  translations: Map<string, TranslationSegment>;
  streamingId: string | null;
  history: { id: string; transcript: string; translation: string; sourceLang: string; targetLang: string; startedAt: string; durationMs: number }[];
  setStatus: (s: PipelineStatus) => void;
  setLevel: (rms: number, peak: number) => void;
  addTranscript: (seg: TranscriptSegment) => void;
  appendDelta: (id: string, delta: string) => void;
  setTranslationDone: (seg: TranslationSegment) => void;
  clear: () => void;
  setHistory: (h: SessionStore["history"]) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  status: "idle",
  rms: 0,
  peak: 0,
  transcripts: [],
  translations: new Map(),
  streamingId: null,
  history: [],
  setStatus: (status) => set({ status }),
  setLevel: (rms, peak) => set({ rms, peak }),
  addTranscript: (seg) =>
    set((s) => ({
      transcripts: [...s.transcripts.slice(-49), seg],
      streamingId: seg.id,
      translations: new Map(s.translations).set(seg.id, { id: seg.id, transcriptId: seg.id, translatedText: "", isStreaming: true }),
    })),
  appendDelta: (id, delta) =>
    set((s) => {
      const m = new Map(s.translations);
      const cur = m.get(id) ?? { id, transcriptId: id, translatedText: "", isStreaming: true };
      m.set(id, { ...cur, translatedText: cur.translatedText + delta });
      return { translations: m };
    }),
  setTranslationDone: (seg) =>
    set((s) => {
      const m = new Map(s.translations);
      m.set(seg.id, seg);
      return { translations: m, history: [{ id: seg.id, transcript: s.transcripts.find((t) => t.id === seg.id)?.text ?? "", translation: seg.translatedText, sourceLang: "", targetLang: "", startedAt: new Date().toISOString(), durationMs: seg.latencyMs ?? 0 }, ...s.history].slice(0, 200) };
    }),
  clear: () => set({ transcripts: [], translations: new Map(), streamingId: null }),
  setHistory: (history) => set({ history }),
}));
