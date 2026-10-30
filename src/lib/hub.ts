export type HubModel = { id: string; downloads: number; likes: number; task: string; updatedAt: string; gated: boolean; tags: string[] };
export type HubFile = { name: string; size: number; sha256: string | null; downloadable: boolean };
export type HubDetail = Omit<HubModel, "updatedAt"> & { revision: string; license: string; files: HubFile[] };
export type HubSettings = { directory: string; hasToken: boolean; tokenPersistent: boolean };
export type DownloadJob = {
  id: string; repo: string; revision: string; file: string; root: string; path: string;
  size: number; bytes: number; speed: number; sha256: string | null;
  status: "queued" | "downloading" | "paused" | "verifying" | "completed" | "failed" | "cancelled" | "deleted";
  error: string | null; createdAt: string;
};
export const downloadLabels: Record<DownloadJob["status"], string> = { queued: "等待下载", downloading: "下载中", paused: "已暂停", verifying: "校验中", completed: "已完成", failed: "下载失败", cancelled: "已取消", deleted: "已移至回收站" };
export const taskLabels: Record<string, string> = { "text-generation": "文本生成", "automatic-speech-recognition": "语音识别", "text-to-speech": "语音合成", "image-text-to-text": "视觉 / 文本" };
export function formatCount(value: number) { return Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
