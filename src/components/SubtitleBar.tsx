import { useSessionStore } from "@/stores/session";

export function SubtitleBar() {
  const { transcripts, translations } = useSessionStore();
  const last = transcripts[transcripts.length - 1];
  const trans = last ? translations.get(last.id) : undefined;

  if (!last) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
        开始录制后，原文与译文将实时显示在这里
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg">
        <div className="mb-1 text-xs font-medium tracking-wide text-zinc-500">原文 · {last.lang ?? "auto"}</div>
        <div className="text-lg leading-relaxed text-zinc-100">{last.text}</div>
      </div>
      <div className="rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 to-zinc-900 p-5 shadow-lg">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-400">
          译文 {trans?.isStreaming ? <span className="inline-flex items-center gap-1"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />翻译中</span> : null}
          {trans?.latencyMs ? <span className="text-zinc-600">{trans.latencyMs}ms</span> : null}
        </div>
        <div className="text-xl font-medium leading-relaxed text-white">
          {trans?.translatedText || <span className="text-zinc-600">等待翻译…</span>}
        </div>
      </div>
    </div>
  );
}
