import { useEffect, useState } from "react";
import { Copy, Minus, Moon, Square, Sun, X } from "lucide-react";
import { MultiStudioMark } from "./MultiStudioMark";
import { Button } from "@/components/ui/button";
import { invoke, listen } from "@/lib/desktop";
export function TopBar() {
  const [theme, setTheme] = useState(() => localStorage.getItem("lt_theme") === "dark" ? "dark" : "light");
  const [maximized, setMaximized] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined;
    void invoke<{ maximized: boolean }>("window_state").then(state => { if (!disposed) setMaximized(state.maximized); });
    void listen<{ maximized: boolean }>("window-state", ({ payload }) => setMaximized(payload.maximized)).then(fn => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  function toggleTheme() { const next = theme === "light" ? "dark" : "light"; localStorage.setItem("lt_theme", next); setTheme(next); }
  return <header className="app-header" data-window-drag onDoubleClick={() => void invoke("window_toggle_maximize")}>
    <div className="app-wordmark"><span className="mobile-brand-icon"><MultiStudioMark size={23} /></span><span>MultiStudio</span></div>
    <div className="app-header-actions" onDoubleClick={event => event.stopPropagation()}>
      <Button variant="ghost" size="icon" className="header-icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</Button>
      <div className="window-controls"><button aria-label="最小化" onClick={() => void invoke("window_minimize")}><Minus size={15} /></button><button aria-label={maximized ? "还原窗口" : "最大化"} onClick={() => void invoke("window_toggle_maximize")}>{maximized ? <Copy size={13} /> : <Square size={13} />}</button><button aria-label="关闭窗口" className="window-close" onClick={() => void invoke("window_close")}><X size={17} /></button></div>
    </div>
  </header>;
}
