import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { StudioDialog } from "./StudioDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { hasDesktop, invoke } from "@/lib/desktop";
import { useHubStore } from "@/stores/hub";
import { errorMessage } from "@/lib/models";
import type { HubSettings } from "@/lib/hub";
export function HubSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useHubStore(s => s.settings);
  const [directory, setDirectory] = useState(settings.directory), [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { void useHubStore.getState().load(); setToken(""); setError(null); } }, [open]);
  useEffect(() => setDirectory(settings.directory), [settings.directory]);
  async function save(clear = false) {
    setBusy(true); setError(null);
    try { const settings = await invoke<HubSettings>("hub_configure", { directory, ...(clear ? { token: "" } : token.trim() ? { token: token.trim() } : {}) }); useHubStore.setState({ settings }); setToken(""); if (!clear) onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <StudioDialog open={open} onOpenChange={value => !value && onClose()} title="Hugging Face 下载设置">
    <form className="studio-dialog-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="form-field"><label htmlFor="hf-directory">下载目录</label><Input id="hf-directory" value={directory} onChange={e => setDirectory(e.target.value)} placeholder="默认存入应用数据目录 / models" required /></div>
      <Button type="button" variant="outline" disabled={!hasDesktop() || busy} onClick={async () => { try { const dir = await invoke<string | null>("pick_model_directory"); if (dir) setDirectory(dir); } catch (e) { setError(errorMessage(e)); } }}><FolderOpen size={15} />选择目录</Button>
      <div className="form-field"><label htmlFor="hf-token">HF Token（可选）</label><Input id="hf-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder={settings.hasToken ? "已设置；留空保留" : ""} /></div>
      {!settings.tokenPersistent && <p className="field-hint">令牌仅在本次运行有效</p>}
      {error && <p role="alert" className="inline-feedback is-error">{error}</p>}
      <div className="studio-dialog-actions">{settings.hasToken && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(true)}>清除 Token</Button>}<Button type="submit" disabled={!hasDesktop() || busy}>{busy ? "保存中…" : "保存"}</Button></div>
    </form>
  </StudioDialog>;
}
