import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfigStore } from "@/stores/config";
import type { AudioDeviceInfo } from "@/lib/types";
import { LANGUAGES } from "@/lib/languages";

export default function Settings() {
  const { config, save } = useConfigStore();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [asrTest, setAsrTest] = useState<string | null>(null);
  const [llmTest, setLlmTest] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    invoke<AudioDeviceInfo[]>("list_audio_devices").then(setDevices).catch(() => {});
  }, []);

  async function testAsr() {
    setBusy("asr");
    setAsrTest(null);
    try {
      const r = await invoke<string>("test_asr");
      setAsrTest(r);
    } catch (e) {
      setAsrTest(String(e));
    } finally {
      setBusy(null);
    }
  }
  async function testLlm() {
    setBusy("llm");
    setLlmTest(null);
    try {
      const r = await invoke<string>("test_llm");
      setLlmTest(r);
    } catch (e) {
      setLlmTest(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <h1 className="text-lg font-semibold">设置</h1>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">音频输入</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">音源</span>
            <select value={config.audio.sourceKind} onChange={(e) => save({ audio: { ...config.audio, sourceKind: e.target.value as never } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
              <option value="microphone">麦克风</option>
              <option value="loopback">系统音频（需分享弹窗勾选音频）</option>
              <option value="microphone+loopback">麦克风 + 系统音频</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">输入设备</span>
            <select value={config.audio.inputDeviceId ?? ""} onChange={(e) => save({ audio: { ...config.audio, inputDeviceId: e.target.value || null } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
              <option value="">默认</option>
              {devices.filter((d) => d.kind === "input").map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.isDefault ? " · 默认" : ""}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">VAD 阈值 {config.audio.vadThreshold.toFixed(2)}</span>
            <input type="range" min={0.1} max={0.9} step={0.05} value={config.audio.vadThreshold} onChange={(e) => save({ audio: { ...config.audio, vadThreshold: parseFloat(e.target.value) } })} className="w-full" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">静音判定 (ms)</span>
            <input type="number" value={config.audio.silenceMs} onChange={(e) => save({ audio: { ...config.audio, silenceMs: parseInt(e.target.value || "0", 10) } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.audio.vadEnabled} onChange={(e) => save({ audio: { ...config.audio, vadEnabled: e.target.checked } })} />
            启用 VAD 分段
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">最短段 (ms)</span>
            <input type="number" value={config.audio.minSegmentMs} onChange={(e) => save({ audio: { ...config.audio, minSegmentMs: parseInt(e.target.value || "0", 10) } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">最长段 (ms)</span>
            <input type="number" value={config.audio.maxSegmentMs} onChange={(e) => save({ audio: { ...config.audio, maxSegmentMs: parseInt(e.target.value || "0", 10) } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-zinc-500">监听：cpal 原生 + 浏览器 getDisplayMedia 双通路；跨平台要点——Windows WASAPI loopback 直通，macOS 需录屏权限或 BlackHole 虚拟设备，Linux 用 Pulse monitor。</span>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">ASR · 语音转写（OpenAI 兼容 /v1/audio/transcriptions）</h2>
        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">Base URL</span>
            <input value={config.asr.baseUrl} onChange={(e) => save({ asr: { ...config.asr, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1 或本地兼容端点" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">API Key（本地可留空）</span>
            <input type="password" value={config.asr.apiKey ?? ""} onChange={(e) => save({ asr: { ...config.asr, apiKey: e.target.value } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">ASR 模型</span>
            <input value={config.asr.asrModel} onChange={(e) => save({ asr: { ...config.asr, asrModel: e.target.value } })} placeholder="whisper-1 / whisper-large-v3" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={testAsr} disabled={busy === "asr"} className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50">{busy === "asr" ? "检测中…" : "连通性测试"}</button>
          {asrTest && <span className="text-xs text-zinc-400">{asrTest}</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">LLM · 翻译（OpenAI 兼容 /v1/chat/completions, 流式）</h2>
        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">Base URL</span>
            <input value={config.llm.baseUrl} onChange={(e) => save({ llm: { ...config.llm, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1 或任意兼容端点" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">API Key（本地可留空）</span>
            <input type="password" value={config.llm.apiKey ?? ""} onChange={(e) => save({ llm: { ...config.llm, apiKey: e.target.value } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">LLM 模型</span>
            <input value={config.llm.llmModel} onChange={(e) => save({ llm: { ...config.llm, llmModel: e.target.value } })} placeholder="gpt-4o-mini / qwen / 本地模型名" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">Temperature</span>
            <input type="number" step={0.1} min={0} max={2} value={config.translation.llmTemperature} onChange={(e) => save({ translation: { ...config.translation, llmTemperature: parseFloat(e.target.value || "0") } })} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.translation.streamTranslation} onChange={(e) => save({ translation: { ...config.translation, streamTranslation: e.target.checked } })} />
            流式翻译（逐 token 推送）
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={testLlm} disabled={busy === "llm"} className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50">{busy === "llm" ? "检测中…" : "连通性测试"}</button>
          {llmTest && <span className="text-xs text-zinc-400">{llmTest}</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">语言</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">源语言（传给 ASR language）</span>
            <select value={config.translation.sourceLang} onChange={(e) => { const opt = LANGUAGES.find((l) => l.code === e.target.value); save({ translation: { ...config.translation, sourceLang: e.target.value, sourceLangLabel: opt?.label ?? e.target.value } }); }} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">目标语言（LLM 翻译目标）</span>
            <select value={config.translation.targetLang} onChange={(e) => { const opt = LANGUAGES.find((l) => l.code === e.target.value); save({ translation: { ...config.translation, targetLang: e.target.value, targetLangLabel: opt?.label ?? e.target.value } }); }} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
              {LANGUAGES.filter((l) => l.code !== "auto").map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block space-y-1 text-sm">
          <span className="text-zinc-400">额外提示词（术语、口吻等，注入到翻译 system prompt）</span>
          <textarea value={config.translation.extraPrompt} onChange={(e) => save({ translation: { ...config.translation, extraPrompt: e.target.value } })} rows={3} placeholder="例如：保持专业术语原文不译，对日本客户使用敬体…" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" />
        </label>
      </section>
    </div>
  );
}
