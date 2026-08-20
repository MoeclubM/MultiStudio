import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
          <Button variant="outline" size="sm" onClick={handleExport}>导出 JSON</Button>
          <Button variant="secondary" size="sm" onClick={handleClear}>清空</Button>
        </div>
      </div>
      {!loaded ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
      ) : history.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="p-12 text-center text-sm text-muted-foreground">暂无历史，实时翻译的会话会被记录在这里</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.map((h) => (
            <Card key={h.id}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(h.startedAt).toLocaleString()} · {h.sourceLang} → {h.targetLang}</span>
                  <Badge variant="outline">{h.durationMs}ms</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{h.transcript || "—"}</div>
                  <div className="rounded-lg bg-primary/10 p-3 text-sm leading-relaxed">{h.translation || "—"}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
