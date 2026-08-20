import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfigStore } from "@/stores/config";
import type { AudioDeviceInfo } from "@/lib/types";
import { LANGUAGES } from "@/lib/languages";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      <div>
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">配置音源、ASR/LLM 端点与语言，实时生效并持久化到本地。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">音频输入</CardTitle>
          <CardDescription>麦克风 / 系统音频，可配 VAD 分段参数</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>音源</Label>
              <Select value={config.audio.sourceKind} onValueChange={(v) => save({ audio: { ...config.audio, sourceKind: v as never } })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="microphone">麦克风</SelectItem>
                  <SelectItem value="loopback">系统音频（需分享弹窗勾选音频）</SelectItem>
                  <SelectItem value="microphone+loopback">麦克风 + 系统音频</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>输入设备</Label>
              <Select value={config.audio.inputDeviceId ?? "__default"} onValueChange={(v) => save({ audio: { ...config.audio, inputDeviceId: v === "__default" ? null : v } })}>
                <SelectTrigger>
                  <SelectValue placeholder="默认" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">默认</SelectItem>
                  {devices
                    .filter((d) => d.kind === "input")
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                        {d.isDefault ? " · 默认" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>VAD 阈值 {config.audio.vadThreshold.toFixed(2)}</Label>
              <Slider value={[config.audio.vadThreshold]} min={0.1} max={0.9} step={0.05} onValueChange={([v]) => save({ audio: { ...config.audio, vadThreshold: v } })} />
            </div>
            <div className="space-y-2">
              <Label>静音判定 (ms)</Label>
              <Input type="number" value={config.audio.silenceMs} onChange={(e) => save({ audio: { ...config.audio, silenceMs: parseInt(e.target.value || "0", 10) } })} />
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch checked={config.audio.vadEnabled} onCheckedChange={(v) => save({ audio: { ...config.audio, vadEnabled: v } })} />
              <Label className="m-0">启用 VAD 分段</Label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>最短段 (ms)</Label>
              <Input type="number" value={config.audio.minSegmentMs} onChange={(e) => save({ audio: { ...config.audio, minSegmentMs: parseInt(e.target.value || "0", 10) } })} />
            </div>
            <div className="space-y-2">
              <Label>最长段 (ms)</Label>
              <Input type="number" value={config.audio.maxSegmentMs} onChange={(e) => save({ audio: { ...config.audio, maxSegmentMs: parseInt(e.target.value || "0", 10) } })} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">监听：cpal 原生 + 浏览器 getDisplayMedia 双通路；跨平台要点——Windows WASAPI loopback 直通，macOS 需录屏权限或 BlackHole 虚拟设备，Linux 用 Pulse monitor。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ASR · 语音转写</CardTitle>
          <CardDescription>OpenAI 兼容 /v1/audio/transcriptions（multipart，verbose_json）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input value={config.asr.baseUrl} onChange={(e) => save({ asr: { ...config.asr, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1 或本地兼容端点" />
          </div>
          <div className="space-y-2">
            <Label>API Key（本地可留空）</Label>
            <Input type="password" value={config.asr.apiKey ?? ""} onChange={(e) => save({ asr: { ...config.asr, apiKey: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <Label>ASR 模型</Label>
            <Input value={config.asr.asrModel} onChange={(e) => save({ asr: { ...config.asr, asrModel: e.target.value } })} placeholder="whisper-1 / whisper-large-v3" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={testAsr} disabled={busy === "asr"}>
              {busy === "asr" ? "检测中…" : "连通性测试"}
            </Button>
            {asrTest ? <Badge variant="outline" className="max-w-[60%] truncate text-xs font-normal">{asrTest}</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM · 翻译</CardTitle>
          <CardDescription>OpenAI 兼容 /v1/chat/completions，流式 SSE 逐 token 推送</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input value={config.llm.baseUrl} onChange={(e) => save({ llm: { ...config.llm, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1 或任意兼容端点" />
          </div>
          <div className="space-y-2">
            <Label>API Key（本地可留空）</Label>
            <Input type="password" value={config.llm.apiKey ?? ""} onChange={(e) => save({ llm: { ...config.llm, apiKey: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <Label>LLM 模型</Label>
            <Input value={config.llm.llmModel} onChange={(e) => save({ llm: { ...config.llm, llmModel: e.target.value } })} placeholder="gpt-4o-mini / qwen / 本地模型名" />
          </div>
          <div className="space-y-2">
            <Label>Temperature</Label>
            <Input type="number" step={0.1} min={0} max={2} value={config.translation.llmTemperature} onChange={(e) => save({ translation: { ...config.translation, llmTemperature: parseFloat(e.target.value || "0") } })} />
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Switch checked={config.translation.streamTranslation} onCheckedChange={(v) => save({ translation: { ...config.translation, streamTranslation: v } })} />
            <Label className="m-0">流式翻译（逐 token 推送）</Label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={testLlm} disabled={busy === "llm"}>
              {busy === "llm" ? "检测中…" : "连通性测试"}
            </Button>
            {llmTest ? <Badge variant="outline" className="max-w-[60%] truncate text-xs font-normal">{llmTest}</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">语言</CardTitle>
          <CardDescription>源语言直通 ASR language，目标语言决定 LLM 翻译方向</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>源语言</Label>
              <Select
                value={config.translation.sourceLang}
                onValueChange={(v) => {
                  const opt = LANGUAGES.find((l) => l.code === v);
                  save({ translation: { ...config.translation, sourceLang: v, sourceLangLabel: opt?.label ?? v } });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>目标语言</Label>
              <Select
                value={config.translation.targetLang}
                onValueChange={(v) => {
                  const opt = LANGUAGES.find((l) => l.code === v);
                  save({ translation: { ...config.translation, targetLang: v, targetLangLabel: opt?.label ?? v } });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.filter((l) => l.code !== "auto").map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>额外提示词（术语、口吻等，注入到翻译 system prompt）</Label>
            <Textarea value={config.translation.extraPrompt} onChange={(e) => save({ translation: { ...config.translation, extraPrompt: e.target.value } })} rows={3} placeholder="例如：保持专业术语原文不译，对日本客户使用敬体…" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
