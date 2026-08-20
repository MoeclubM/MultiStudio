import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SubtitleBar } from "@/components/SubtitleBar";
import { LevelMeter } from "@/components/LevelMeter";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { usePipelineEvents } from "@/hooks/usePipelineEvents";
import { useConfigStore } from "@/stores/config";
import { useSessionStore } from "@/stores/session";
import type { AudioDeviceInfo } from "@/lib/types";
import { LANGUAGES } from "@/lib/languages";

export default function LiveView() {
  usePipelineEvents();
  const { config } = useConfigStore();
  const { status, transcripts, translations, clear } = useSessionStore();
  const { active: capturing, error: captureError, start, stop } = useAudioCapture();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickOut, setQuickOut] = useState("");

  useEffect(() => {
    invoke<AudioDeviceInfo[]>("list_audio_devices").then(setDevices).catch(() => {});
  }, []);

  const running = status === "running";

  async function handleToggle() {
    if (running) {
      setBusy(true);
      try {
        await invoke("pipeline_stop");
        await stop();
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await invoke("pipeline_start");
      const kind = config.audio.sourceKind as "microphone" | "loopback" | "microphone+loopback";
      await start({ sourceKind: kind, deviceId: config.audio.inputDeviceId });
    } catch (e) {
      await invoke("pipeline_stop").catch(() => {});
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickTranslate() {
    const t = quickText.trim();
    if (!t) return;
    setQuickOut("");
    try {
      const out = await invoke<string>("translate_text", { text: t });
      setQuickOut(out);
    } catch (e) {
      setQuickOut(String(e));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            disabled={busy}
            className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${running ? "bg-red-600 text-white hover:bg-red-700" : "bg-brand text-white hover:bg-brand-dark"} disabled:opacity-50`}
          >
            {busy ? "…" : running ? "停止" : "开始翻译"}
          </button>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${running ? "border-emerald-700 bg-emerald-950 text-emerald-300" : "border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
            <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`} />
            {running ? (capturing ? "收音中" : "运行中") : "空闲"}
          </span>
          <LevelMeter />
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{config.audio.sourceKind === "loopback" ? "系统音频" : config.audio.sourceKind === "microphone+loopback" ? "麦克风+系统音频" : "麦克风"} · {LANGUAGES.find((l) => l.code === config.translation.sourceLang)?.label} → {LANGUAGES.find((l) => l.code === config.translation.targetLang)?.label}</span>
        </div>
      </div>

      {captureError && <div className="rounded-xl border border-amber-800 bg-amber-950 px-4 py-3 text-sm text-amber-200">{captureError} — 已回退到前端采集，系统音频需在弹窗中勾选“分享音频”。</div>}

      <SubtitleBar />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">会话记录</h2>
          <button onClick={clear} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800">清空</button>
        </div>
        {transcripts.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-600">暂无记录，开始后这里会显示原文与译文对照</div>
        ) : (
          <div className="space-y-3">
            {[...transcripts].reverse().slice(0, 50).map((t) => {
              const tr = translations.get(t.id);
              return (
                <div key={t.id} className="grid gap-3 rounded-xl border border-zinc-800 bg-[#0F1117] p-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-zinc-500">原文 · {t.lang ?? "—"}</div>
                    <div className="text-sm leading-relaxed">{t.text}</div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">译文 {tr?.isStreaming ? <span className="text-emerald-400">…</span> : null}</div>
                    <div className="text-sm leading-relaxed text-zinc-100">{tr?.translatedText || "—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">快捷文本翻译（走 LLM，不经 ASR）</h2>
        <div className="flex gap-2">
          <input value={quickText} onChange={(e) => setQuickText(e.target.value)} placeholder="输入任意文本测试 LLM 翻译链路…" className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-brand" />
          <button onClick={handleQuickTranslate} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700">翻译</button>
        </div>
        {quickOut && <div className="mt-3 rounded-xl bg-zinc-950 p-3 text-sm leading-relaxed">{quickOut}</div>}
        <div className="mt-2 text-xs text-zinc-600">设备：{devices.length ? devices.map((d) => d.name).join(" · ") : "加载中…"} · 提示：系统音频捕获依赖浏览器 getDisplayMedia，需在分享弹窗勾选音频。</div>
      </div>
    </div>
  );
}
