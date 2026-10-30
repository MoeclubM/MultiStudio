export type ModelKind = "text" | "speech" | "vision" | "projector";
export type LoadOptions = { contextLength: number; threads: number; useGpu: boolean };
export type ModelEntry = {
  id: string; name: string; path: string; fileName: string; sizeBytes: number;
  kind: ModelKind; quantization: string | null; imported: boolean;
  installed: boolean; loadable: boolean; compatibility: string; runtime?: string | null;
  backendId?: string | null; backends?: string[]; family?: string | null;
};
export type EngineStatus = {
  phase: "unloaded" | "loading" | "ready" | "error";
  activeModelId: string | null; lastError: string | null; loadOptions: LoadOptions | null;
};
export type LibrarySnapshot = {
  models: ModelEntry[];
  settings: { directories: string[]; imports: { path: string; name: string; kind: ModelKind }[]; loadOptions: LoadOptions; autoLoad: boolean };
  warnings: string[];
  engine: EngineStatus;
};
export const kindLabels: Record<ModelKind, string> = { text: "文本", speech: "语音", vision: "视觉 / 多模态", projector: "投影组件" };
export const EMPTY_LIBRARY: LibrarySnapshot = {
  models: [], settings: { directories: [], imports: [], loadOptions: { contextLength: 4096, threads: 4, useGpu: true }, autoLoad: true },
  warnings: [], engine: { phase: "unloaded", activeModelId: null, lastError: null, loadOptions: null },
};
export function formatBytes(value: number) {
  if (!value) return "—";
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + " GB";
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + " MB";
  if (value >= 1024) return (value / 1024).toFixed(1) + " KB";
  return value + " B";
}
export function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
