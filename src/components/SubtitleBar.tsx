import { useSessionStore } from "@/stores/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SubtitleBar() {
  const { transcripts, translations } = useSessionStore();
  const last = transcripts[transcripts.length - 1];
  const trans = last ? translations.get(last.id) : undefined;

  if (!last) {
    return (
      <Card className="border-dashed bg-muted/30">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          开始录制后，原文与译文将实时显示在这里
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground">原文 · {last.lang ?? "auto"}</div>
          <div className="text-lg leading-relaxed">{last.text}</div>
        </CardContent>
      </Card>
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-card shadow-sm">
        <CardContent className="p-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
            译文{" "}
            {trans?.isStreaming ? (
              <Badge variant="secondary" className="gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                翻译中
              </Badge>
            ) : null}
            {trans?.latencyMs ? <span className="text-muted-foreground/60">{trans.latencyMs}ms</span> : null}
          </div>
          <div className="text-xl font-medium leading-relaxed">
            {trans?.translatedText || <span className="text-muted-foreground">等待翻译…</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
