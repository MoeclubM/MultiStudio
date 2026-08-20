import { useSessionStore } from "@/stores/session";

export function LevelMeter() {
  const { rms, peak } = useSessionStore();
  const rmsW = Math.min(100, Math.max(0, rms * 320));
  const peakW = Math.min(100, Math.max(0, peak * 160));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${rmsW}%` }} />
      </div>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${peakW}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">RMS/Peak</span>
    </div>
  );
}
