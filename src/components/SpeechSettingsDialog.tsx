import { useEffect, useState } from "react";
import { StudioDialog } from "./StudioDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useSpeechStore } from "@/stores/speech";
import { useWorkflowStore, running, capturing } from "@/stores/workflows";
import { DEFAULT_SPEECH, type SpeechSettings } from "@/lib/conversations";
import { errorMessage } from "@/lib/models";
import { invoke } from "@/lib/desktop";

export function SpeechSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { speech: saved } = useSpeechStore();
  const locked = useWorkflowStore(state => running(state.run) || state.submitting || state.live || capturing(state.capture));
  const [values, setValues] = useState<SpeechSettings>(DEFAULT_SPEECH), [key, setKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setValues(saved); setKey(""); setError(null); } }, [open, saved]);
  async function save(clearKey = false) {
    setBusy(true); setError(null);
    try {
      const speech = await invoke<SpeechSettings>("speech_configure", { ...values, ...(clearKey ? { apiKey: "" } : key.trim() ? { apiKey: key.trim() } : {}) });
      useSpeechStore.setState({ speech }); if (!clearKey) onClose();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const field = (name: "baseUrl" | "asrModel" | "ttsModel" | "voice", label: string) => <div className="form-field"><label htmlFor={`speech-${name}`}>{label}</label><Input id={`speech-${name}`} value={values[name]} onChange={event => setValues({ ...values, [name]: event.target.value })} /></div>;
  return <StudioDialog open={open} onOpenChange={value => !value && onClose()} title="语音 API">
    <form className="studio-dialog-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || locked} className="grid gap-4">
      {field("baseUrl", "服务地址")}
      <div className="form-field"><label htmlFor="speech-key">密钥</label><Input id="speech-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={saved.hasApiKey ? "已保存，留空保留" : ""} /></div>
      <div className="form-grid">{field("asrModel", "识别模型")}{field("ttsModel", "合成模型")}</div>
      {field("voice", "默认音色")}
      {error && <p className="inline-feedback is-error" role="alert">{error}</p>}
      <div className="studio-dialog-actions">{saved.hasApiKey && <Button type="button" variant="ghost" onClick={() => void save(true)}>清除密钥</Button>}<Button type="submit">{busy ? "保存中…" : "保存"}</Button></div>
    </fieldset></form>
  </StudioDialog>;
}
