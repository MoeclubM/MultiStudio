import { create } from "zustand";
import { invoke, type DesktopCommand, hasDesktop } from "@/lib/desktop";
import { EMPTY_LIBRARY, errorMessage, type LibrarySnapshot } from "@/lib/models";
import { useConfigStore } from "./config";

type ModelsStore = {
  snapshot: LibrarySnapshot; loaded: boolean; refreshing: boolean;
  pending: string | null; error: string | null; notice: string | null;
  refresh: () => Promise<void>;
  perform: <T = unknown>(command: DesktopCommand, args?: Record<string, unknown>, success?: string) => Promise<T | undefined>;
};
let refreshRevision = 0;
export const useModelsStore = create<ModelsStore>((set, get) => ({
  snapshot: EMPTY_LIBRARY, loaded: false, refreshing: false, pending: null, error: null, notice: null,
  async refresh() {
    if (!hasDesktop()) { set({ loaded: true }); return; }
    const revision = ++refreshRevision;
    set({ refreshing: true });
    try {
      const snapshot = await invoke<LibrarySnapshot>("get_model_library");
      if (revision === refreshRevision) set({ snapshot, loaded: true, refreshing: false });
    } catch (error) {
      if (revision === refreshRevision) set({ loaded: true, refreshing: false, error: errorMessage(error) });
    }
  },
  async perform<T>(command: DesktopCommand, args?: Record<string, unknown>, success?: string) {
    if (get().pending) return;
    if (!hasDesktop()) { set({ error: "模型文件与本地推理需要在桌面应用中管理。" }); return; }
    set({ pending: command, error: null, notice: null });
    try {
      const result = await invoke<T>(command, args);
      set({ notice: success ?? (typeof result === "string" ? result : "已更新") });
      return result;
    } catch (error) {
      set({ error: errorMessage(error) });
      return undefined;
    } finally {
      await get().refresh();
      if (command === "load_local_model") await useConfigStore.getState().load();
      set({ pending: null });
    }
  },
}));
