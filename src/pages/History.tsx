import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/session";

export default function HistoryPage() {
  const { history, setHistory } = useSessionStore();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<{ id: string; transcript: string; translation: string; sourceLang: string; targetLang: string; startedAt: string; durationMs: number }[]>("get_history")
      .then((h) => {
        setHistory(h.map((x) => ({ id: x.id, transcript: x.transcript, translation: x.translation, sourceLang: x.sourceLang, targetLang: x.targetLang, startedAt: x.startedAt, durationMs: x.durationMs })));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [setHistory]);

  async function handleExport() {
    try {
      const json = await invoke<string>("export_history");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `live-translator-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(String(e));
    }
  }

  async function handleClear() {
    if (!confirm("清空所有历史？")) return;
    await invoke("clear_history");
    setHistory([]);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">历史</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-800">导出 JSON</button>
          <button onClick={handleClear} className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm hover:bg-zinc-700">清空</button>
        </div>
      </div>
      {!loaded ? (
        <div className="py-12 text-center text-sm text-zinc-500">加载中…</div>
      ) : history.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50 p-12 text-center text-sm text-zinc-500">暂无历史，实时翻译的会话会被记录在这里</div>
      ) : (
        <div className="space-y-3">
          {history.map((h) => (
            <div key={h.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{new Date(h.startedAt).toLocaleString()} · {h.sourceLang} → {h.targetLang}</span>
                <span>{h.durationMs}ms</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-zinc-950 p-3 text-sm leading-relaxed">{h.transcript || "—"}</div>
                <div className="rounded-xl bg-brand/10 p-3 text-sm leading-relaxed text-zinc-100">{h.translation || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
