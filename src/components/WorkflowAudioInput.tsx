import { useRef, useState } from "react";
import { FileAudio, Loader2, Upload, X } from "lucide-react";
import { prepareAudio } from "@/lib/audio";
import { audioUrl } from "@/lib/conversations";
import { invoke } from "@/lib/desktop";
import { errorMessage } from "@/lib/models";
import { beginInputTask, useWorkflowStore } from "@/stores/workflows";
import type { NodeConfig } from "@/lib/workflows";
import { Button } from "./ui/button";

export type AudioWidgetProps = { nodeId: string; config: NodeConfig; disabled: boolean; onChange: (config: NodeConfig) => void };
export function WorkflowAudioInput({ config, disabled, onChange }: AudioWidgetProps) {
  const [preparing, setPreparing] = useState(false), [error, setError] = useState<string | null>(null);
  const inputTasks = useWorkflowStore(state => state.inputTasks);
  const fileInput = useRef<HTMLInputElement>(null), locked = disabled || preparing || inputTasks > 0;
  async function upload(file: File) {
    if (locked) return;
    const finish = beginInputTask(); setPreparing(true); setError(null);
    let audio;
    try {
      audio = await prepareAudio(file, file.name);
      const result = await invoke<{ id: string }>("save_audio_input", { bytes: audio.bytes });
      onChange({ ...config, audioId: result.id, filename: file.name, duration: audio.duration });
    } catch (error) { setError(errorMessage(error)); }
    finally { if (audio) URL.revokeObjectURL(audio.url); finish(); setPreparing(false); }
  }
  return <div className="workflow-audio-widget nodrag nopan nowheel" onClick={event => event.stopPropagation()}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer.files[0]) void upload(event.dataTransfer.files[0]); }}>
    <input ref={fileInput} aria-label="上传节点音频" className="sr-only" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.webm" disabled={locked} onChange={event => { if (event.target.files?.[0]) void upload(event.target.files[0]); event.target.value = ""; }} />
    {config.audioId ? <><div className="workflow-audio-file"><FileAudio size={15} /><strong title={String(config.filename)}>{String(config.filename || "输入音频")}</strong><button aria-label="移除音频" disabled={locked} onClick={() => onChange({ ...config, audioId: "", filename: "", duration: 0 })}><X size={13} /></button></div>
      <audio controls preload="metadata" className="nodrag nopan nowheel" src={audioUrl(String(config.audioId))} aria-label="输入音频" />
      <div className="workflow-audio-actions"><Button variant="outline" className="compact-button" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={13} />替换音频</Button></div>
    </> : <button className="workflow-audio-drop" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={20} /><strong>选择或拖入音频</strong></button>}
    <div className="workflow-audio-state" role="status">{preparing ? <><Loader2 size={12} className="animate-spin" />处理音频…</> : config.duration ? `${Number(config.duration).toFixed(1)} 秒` : "≤ 120 秒 · ≤ 25 MB"}</div>
    {error && <p role="alert" className="inline-feedback is-error">{error}</p>}
  </div>;
}
