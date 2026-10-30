import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Eye, EyeOff, Loader2, Plug, Puzzle, Settings2 } from "lucide-react";
import { useConfigStore } from "@/stores/config";
import { useSpeechStore } from "@/stores/speech";
import { capturing, running, useWorkflowStore } from "@/stores/workflows";
import { PluginSettings } from "@/components/PluginSettings";
import { LocalApiSettings } from "@/components/LocalApiSettings";
import { errorMessage } from "@/lib/models";
import { hasDesktop, invoke } from "@/lib/desktop";
import { SpeechSettingsDialog } from "@/components/SpeechSettingsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export default function Settings() {
  const { config, save, saving, error: configError } = useConfigStore();
  const speech = useSpeechStore(s => s.speech);
  const locked = useWorkflowStore(s => running(s.run) || s.submitting || s.inputTasks > 0 || s.live || capturing(s.capture));
  const [params] = useSearchParams(), section = params.get("section") || "connections";
  const [draft, setDraft] = useState(config.llm), [showKey, setShowKey] = useState(false), [voiceOpen, setVoiceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [testing, setTesting] = useState(false);
  useEffect(() => { setDraft(config.llm); }, [config.llm]);
  useEffect(() => { void useSpeechStore.getState().load().catch(e => setError(errorMessage(e))); }, []);
  async function saveText() {
    setError(null); setNotice(null);
    try {
      { const url = new URL(draft.baseUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !draft.llmModel.trim()) throw new Error("请输入有效的文本 API 地址和模型名"); }
      await save({ llm: draft });
      if (!useConfigStore.getState().error) setNotice("文本连接已保存");
    } catch (e) { setError(errorMessage(e)); }
  }
  return <div className="settings-page">
    <div className="page-heading"><div><h1>设置</h1></div></div>
    <div className="settings-layout"><nav className="settings-navigation" aria-label="设置分类"><Link to="/settings" aria-current={section === "connections" ? "page" : undefined}><Settings2 size={16} />模型连接</Link><Link to="/settings?section=api" aria-current={section === "api" ? "page" : undefined}><Plug size={16} />本机 API</Link><Link to="/settings?section=plugins" aria-current={section === "plugins" ? "page" : undefined}><Puzzle size={16} />插件</Link></nav>
      <div className="settings-content">{section === "plugins" ? <PluginSettings /> : section === "api" ? <LocalApiSettings /> : <>
        <section><div className="settings-group-heading"><div><h2>文本 API</h2></div></div><form className="surface settings-panel" onSubmit={e => { e.preventDefault(); void saveText(); }}><fieldset disabled={!hasDesktop() || locked || saving || testing} className="grid gap-5">
<div className="form-field"><label htmlFor="api-base-url">服务地址</label><Input id="api-base-url" value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></div><div className="form-field"><label htmlFor="api-key">密钥</label><div className="password-field"><Input id="api-key" type={showKey ? "text" : "password"} autoComplete="off" value={draft.apiKey || ""} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /><button type="button" aria-label={showKey ? "隐藏 API 密钥" : "显示 API 密钥"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div><div className="form-field"><label htmlFor="api-model">默认 API 模型</label><Input id="api-model" value={draft.llmModel} onChange={e => setDraft({ ...draft, llmModel: e.target.value })} /></div>
          <div className="api-test-row"><Button type="submit" className="compact-button">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}保存</Button><Button type="button" variant="outline" className="compact-button" onClick={async () => { setTesting(true); setError(null); try { setNotice(await invoke<string>("test_llm")); } catch (e) { setError(errorMessage(e)); } finally { setTesting(false); } }}>测试连接</Button></div>
        </fieldset></form></section>
        <section><div className="settings-group-heading"><div><h2>语音 API</h2></div></div><div className="surface settings-panel"><span>{speech.baseUrl || "未配置"}</span><Button variant="outline" className="compact-button" disabled={!hasDesktop() || locked} onClick={() => setVoiceOpen(true)}>编辑连接</Button></div></section>

      </>}

        {(error || configError || notice) && <p role={error || configError ? "alert" : "status"} className={`inline-feedback${error || configError ? " is-error" : ""}`}>{error || configError || notice}</p>}
        {locked && <p className="field-hint">任务运行中</p>}
      </div>
    </div><SpeechSettingsDialog open={voiceOpen} onClose={() => setVoiceOpen(false)} />
  </div>;
}
