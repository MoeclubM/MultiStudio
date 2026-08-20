import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar";
import LiveView from "./pages/LiveView";
import Settings from "./pages/Settings";
import HistoryPage from "./pages/History";
import { useConfigStore } from "./stores/config";

export default function App() {
  const load = useConfigStore((s) => s.load);
  const loaded = useConfigStore((s) => s.loaded);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        加载中…
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="flex min-h-full flex-col">
        <TopBar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<LiveView />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/history" element={<HistoryPage />} />
          </Routes>
        </main>
        <footer className="border-t border-zinc-800 px-4 py-3 text-center text-xs text-zinc-600">
          LiveTranslator · 麦克风 / 系统音频 → VAD → ASR (OpenAI 兼容) → LLM 流式翻译 · 跨平台
        </footer>
      </div>
    </HashRouter>
  );
}
