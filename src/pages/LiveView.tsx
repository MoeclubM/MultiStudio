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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <Button onClick={handleToggle} disabled={busy} variant={running ? "destructive" : "default"} size="lg" className="rounded-full px-6">
              {busy ? "…" : running ? "停止" : "开始翻译"}
            </Button>
            <Badge variant={running ? "default" : "secondary"} className="gap-1.5 rounded-full px-3 py-1">
              <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`} />
              {running ? (capturing ? "收音中" : "运行中") : "空闲"}
            </Badge>
            <LevelMeter />
          </div>
          <div className="text-xs text-muted-foreground">
            {config.audio.sourceKind === "loopback" ? "系统音频" : config.audio.sourceKind === "microphone+loopback" ? "麦克风+系统音频" : "麦克风"} ·{" "}
            {LANGUAGES.find((l) => l.code === config.translation.sourceLang)?.label} → {LANGUAGES.find((l) => l.code === config.translation.targetLang)?.label}
          </div>
        </CardContent>
      </Card>

      {captureError && (
        <Card className="border-amber-800 bg-amber-950/50">
          <CardContent className="p-4 text-sm text-amber-200">{captureError} — 已回退到前端采集，系统音频需在弹窗中勾选“分享音频”。</CardContent>
        </Card>
      )}

      <SubtitleBar />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">会话记录</CardTitle>
          <Button variant="outline" size="sm" onClick={clear} className="rounded-full">
            清空
          </Button>
        </CardHeader>
        <CardContent>
          {transcripts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无记录，开始后这里会显示原文与译文对照</div>
          ) : (
            <div className="space-y-3">
              {[...transcripts].reverse().slice(0, 50).map((t) => {
                const tr = translations.get(t.id);
                return (
                  <div key={t.id} className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">原文 · {t.lang ?? "—"}</div>
                      <div className="text-sm leading-relaxed">{t.text}</div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        译文 {tr?.isStreaming ? <span className="text-emerald-500">…</span> : null}
                      </div>
                      <div className="text-sm leading-relaxed">{tr?.translatedText || "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">快捷文本翻译（走 LLM，不经 ASR）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={quickText} onChange={(e) => setQuickText(e.target.value)} placeholder="输入任意文本测试 LLM 翻译链路…" className="flex-1" />
            <Button variant="secondary" onClick={handleQuickTranslate}>
              翻译
            </Button>
          </div>
          {quickOut && <div className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{quickOut}</div>}
          <Separator />
          <div className="text-xs text-muted-foreground">设备：{devices.length ? devices.map((d) => d.name).join(" · ") : "加载中…"} · 提示：系统音频捕获依赖浏览器 getDisplayMedia，需在分享弹窗勾选音频。</div>
        </CardContent>
      </Card>
    </div>
  );
}
