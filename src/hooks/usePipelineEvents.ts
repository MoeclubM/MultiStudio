import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "@/stores/session";

type RawEvent =
  | { type: "status"; status: string; message?: string }
  | { type: "level"; rms: number; peak: number }
  | { type: "transcript"; id: string; text: string; is_final: boolean; lang?: string }
  | { type: "translation_delta"; id: string; delta: string }
  | { type: "translation_done"; id: string; text: string; latency_ms: number }
  | { type: "error"; message: string };

export function usePipelineEvents() {
  const { setStatus, setLevel, addTranscript, appendDelta, setTranslationDone } = useSessionStore();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<RawEvent>("pipeline-event", (ev) => {
      const p = ev.payload as RawEvent;
      switch (p.type) {
        case "status":
          setStatus((p.status as "idle" | "running" | "error") ?? "idle");
          break;
        case "level":
          setLevel(p.rms, p.peak);
          break;
        case "transcript":
          addTranscript({ id: p.id, text: p.text, startMs: Date.now(), endMs: Date.now(), isFinal: p.is_final, lang: p.lang });
          break;
        case "translation_delta":
          appendDelta(p.id, p.delta);
          break;
        case "translation_done":
          setTranslationDone({ id: p.id, transcriptId: p.id, translatedText: p.text, isStreaming: false, latencyMs: p.latency_ms });
          break;
        case "error":
          console.error("[pipeline]", p.message);
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setStatus, setLevel, addTranscript, appendDelta, setTranslationDone]);
}
