import { create } from "zustand";
import { hasDesktop, invoke } from "@/lib/desktop";
import { errorMessage } from "@/lib/models";
import type { DownloadJob, HubDetail, HubModel, HubSettings } from "@/lib/hub";
type HubState = {
  models: HubModel[]; detail: HubDetail | null; jobs: DownloadJob[]; settings: HubSettings;
  searching: boolean; loadingDetail: boolean; error: string | null;
  load: () => Promise<void>; search: (query: string, task: string, ggufOnly: boolean, sort: string) => Promise<void>;
  select: (repo: string) => Promise<void>; download: (file: string) => Promise<boolean>;
  action: (id: string, action: "pause" | "resume" | "cancel") => Promise<void>;
};
let searchRevision = 0, detailRevision = 0;
export const useHubStore = create<HubState>((set, get) => ({
  models: [], detail: null, jobs: [], settings: { directory: "", hasToken: false, tokenPersistent: false }, searching: false, loadingDetail: false, error: null,
  async load() {
    if (!hasDesktop()) return;
    try { const [settings, jobs] = await Promise.all([invoke<HubSettings>("hub_settings"), invoke<DownloadJob[]>("hub_downloads")]); set({ settings, jobs }); }
    catch (error) { set({ error: errorMessage(error) }); }
  },
  async search(query, task, ggufOnly, sort) {
    if (!hasDesktop()) return;
    const revision = ++searchRevision; set({ searching: true, error: null });
    try { const models = await invoke<HubModel[]>("hub_search", { query, task, ggufOnly, sort }); if (revision === searchRevision) set({ models, searching: false }); }
    catch (error) { if (revision === searchRevision) set({ searching: false, error: errorMessage(error) }); }
  },
  async select(repo) {
    const revision = ++detailRevision; set({ detail: null, loadingDetail: true, error: null });
    try { const detail = await invoke<HubDetail>("hub_detail", { repo }); if (revision === detailRevision) set({ detail, loadingDetail: false }); }
    catch (error) { if (revision === detailRevision) set({ loadingDetail: false, error: errorMessage(error) }); }
  },
  async download(file) {
    const detail = get().detail; if (!detail) return false;
    set({ error: null });
    try { await invoke("hub_download", { repo: detail.id, revision: detail.revision, file }); await get().load(); return true; }
    catch (error) { set({ error: errorMessage(error) }); return false; }
  },
  async action(id, action) {
    set({ error: null });
    try { const jobs = await invoke<DownloadJob[]>("hub_download_action", { id, action }); set({ jobs }); }
    catch (error) { set({ error: errorMessage(error) }); }
  },
}));
