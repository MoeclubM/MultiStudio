import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, X } from "lucide-react";
import { invoke, listen } from "@/lib/desktop";

type DesktopOutput = { key: string; text: string; title: string; runId: string; mode: string; partial?: boolean; appearance?: { fontSize: number; color: string; background: string; opacity: number; fontFamily: string; lines: number; align: "left" | "center" | "right" } };
export default function DesktopOutputPage() {
  const { key = "" } = useParams();
  const [items, setItems] = useState<DesktopOutput[]>([]), [opacity, setOpacity] = useState(.85), [font, setFont] = useState(18);
  const latest = items.at(-1), overlay = latest?.mode !== "window", appearance = latest?.appearance;
  const content = useRef<HTMLElement>(null);
  useEffect(() => { if (content.current) content.current.scrollTop = content.current.scrollHeight; }, [items]);
  const color = appearance?.background || "#0f1117", alpha = Math.round((appearance?.opacity ?? opacity) * 255).toString(16).padStart(2, "0");
  useEffect(() => {
    const read = (key: string, fallback: number) => Number(localStorage.getItem(key) ?? fallback);
    const sync = () => { setOpacity(read("lt_overlay_bg_opacity", .85)); setFont(read("lt_overlay_font", 18)); };
    sync(); window.addEventListener("storage", sync);
    let disposed = false, unlisten: (() => void) | undefined;
    const receive = (item: DesktopOutput | null) => {
      if (!item || item.key !== key || disposed) return;
      setItems(old => old.at(-1)?.runId === item.runId ? [...old.slice(0, -1), item] : [...old, item].slice(-5));
    };
    void listen<DesktopOutput>("desktop-output", ({ payload }) => receive(payload)).then(async fn => {
      if (disposed) { fn(); return; } unlisten = fn;
      receive(await invoke<DesktopOutput | null>("desktop_output_get", { key }));
    });
    return () => { disposed = true; unlisten?.(); window.removeEventListener("storage", sync); };
  }, [key]);
  useEffect(() => {
    document.documentElement.style.background = overlay ? "transparent" : "";
    document.body.style.background = overlay ? "transparent" : "";
  }, [overlay]);
  return <div className={`desktop-result ${overlay ? "is-overlay" : "is-window"}`} style={{ background: overlay ? `${color}${alpha}` : undefined, fontSize: appearance?.fontSize || font, color: appearance?.color, fontFamily: appearance?.fontFamily || undefined }}>
    <header data-window-drag><span>{overlay ? "" : latest?.title}</span><div><button aria-label="复制输出" onClick={() => void invoke("desktop_output_copy", { key })}><Copy size={14} /></button><button aria-label="关闭输出窗口" onClick={() => void invoke("window_close")}><X size={16} /></button></div></header>
    <main ref={content} style={{ textAlign: appearance?.align || "center", scrollbarWidth: "none" }}>{(overlay ? items.slice(appearance ? -1 : -2) : items.slice(-1)).map(item => <p key={item.runId}>{item.text}</p>)}</main>
  </div>;
}
