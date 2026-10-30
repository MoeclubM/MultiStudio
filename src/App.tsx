import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Sidebar, CompactNavigation } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Settings from "./pages/Settings";
import DesktopOutputPage from "./pages/DesktopOutput";
import Models from "./pages/Models";
import Discover from "./pages/Discover";
import Downloads from "./pages/Downloads";
import SpeechModels from "./pages/SpeechModels";
import { useWorkflowStore, type CaptureState } from "./stores/workflows";
import { usePluginStore, pluginActive, type PluginInfo } from "./stores/plugins";
import { useSpeechStore } from "./stores/speech";
import { audioUrl } from "./lib/conversations";
import type { WorkflowRun } from "./lib/workflows";
import { useNodePluginStore } from "./stores/node-plugins";
import { useHubStore } from "./stores/hub";
import type { DownloadJob } from "./lib/hub";
import { useRuntimeStore } from "./stores/runtimes";
import { useModelsStore } from "./stores/models";
import { useConfigStore } from "./stores/config";
import { hasDesktop, invoke, listen } from "./lib/desktop";
const WorkflowPage = lazy(() => import("./pages/Workflow"));

function AppInner() {
  const { pathname } = useLocation();
  const load = useConfigStore(s => s.load), loaded = useConfigStore(s => s.loaded);
  const [backendError, setBackendError] = useState<string | null>(null);
  const overlay = pathname.startsWith("/output/");
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (overlay) return;
    const refresh = useModelsStore.getState().refresh;
    void refresh(); void useHubStore.getState().load(); void useRuntimeStore.getState().load();
    void useNodePluginStore.getState().load().catch(e => setBackendError(String(e)));
    void usePluginStore.getState().load().catch(e => setBackendError(String(e)));
    let disposed = false; const cleanups: (() => void)[] = []; let player: HTMLAudioElement | null = null;
    async function subscribe() {
      const retain = (fn: () => void) => { if (disposed) fn(); else cleanups.push(fn); };
      if (!hasDesktop()) return;
      retain(await listen<string>("backend-error", ({ payload }) => setBackendError(payload)));
      retain(await listen("model-library-changed", () => void refresh()));
      retain(await listen("runtime-state", () => void useRuntimeStore.getState().load()));
      retain(await listen<DownloadJob[]>("download-progress", ({ payload }) => useHubStore.setState({ jobs: payload })));
      retain(await listen<WorkflowRun>("workflow-event", ({ payload }) => useWorkflowStore.getState().receive(payload)));
      retain(await listen("speech-models", () => void useSpeechStore.getState().load().catch(e => setBackendError(String(e)))));
      retain(await listen<CaptureState>("audio-capture", ({ payload }) => useWorkflowStore.getState().receiveCapture(payload)));
      retain(await listen<PluginInfo[]>("plugin-state", ({ payload }) => { usePluginStore.getState().receive(payload); if (!payload.some(pluginActive)) player?.pause(); }));
      retain(await listen<{ audioId: string }>("workflow-playback", ({ payload }) => { player?.pause(); player = new Audio(audioUrl(payload.audioId)); void player.play().catch(() => setBackendError("自动播放失败，可在输出节点试听")); }));
      const run = await invoke<WorkflowRun | null>("workflow_status");
      if (!disposed && run) useWorkflowStore.getState().receive(run);
    }
    void subscribe().catch(() => {});
    window.addEventListener("focus", refresh);
    return () => { disposed = true; player?.pause(); cleanups.forEach(fn => fn()); window.removeEventListener("focus", refresh); };
  }, [overlay]);
  useEffect(() => { document.getElementById("main-content")?.scrollTo({ top: 0 }); }, [pathname]);
  if (overlay) return <Routes><Route path="/output/:key" element={<DesktopOutputPage />} /></Routes>;
  if (!loaded) return <div className="flex h-full items-center justify-center text-sm text-zinc-500">加载中…</div>;
  return <div className="app-shell flex overflow-hidden bg-background">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopBar />
      <main id="main-content" className="min-h-0 flex-1 overflow-auto bg-background">
        <div className={`page-container${pathname === "/workflow" ? " workflow-container" : ""}`}>
          {backendError && <p role="alert" className="inline-feedback is-error">{backendError}</p>}
          <Routes>
            <Route path="/" element={<Navigate to="/workflow" replace />} />
            <Route path="/workflow" element={<Suspense fallback={<p className="field-hint">加载工作流编辑器…</p>}><WorkflowPage /></Suspense>} />
            <Route path="/models" element={<Models />} />
            <Route path="/models/speech" element={<SpeechModels />} />
            <Route path="/models/discover" element={<Discover />} />
            <Route path="/models/downloads" element={<Downloads />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/workflow" replace />} />
          </Routes>
        </div>
      </main>
      <StatusBar /><CompactNavigation />
    </div>
  </div>;
}
export default function App() { return <ErrorBoundary><HashRouter><AppInner /></HashRouter></ErrorBoundary>; }
