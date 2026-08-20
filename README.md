# LiveTranslator — 实时翻译器

跨平台实时语音翻译。采集 **麦克风** 或 **系统音频**，经 **VAD 分段** → **OpenAI 兼容 ASR** 转写 → **OpenAI 兼容 LLM** 流式翻译，字幕实时渲染。

## 功能
- 音源：麦克风 / 系统音频 / 麦克风+系统音频（可切换）
- ASR：`POST {base}/v1/audio/transcriptions`（multipart，`verbose_json`），任意 OpenAI 兼容端点（官方 / Groq / 通义 / 本地 faster-whisper 兼容层）
- LLM：`POST {base}/v1/chat/completions`（`stream:true` SSE 流式），逐 token 推送译文
- 语言：源语言/目标语言可选，自动检测，ASR `language` 参数直通，LLM system prompt 模板（支持术语库/口吻额外提示词）
- 音频链路：`capture(10ms) → RingBuffer → 重采样 16kHz mono → 能量 VAD → WAV chunk → ASR → LLM`
- 分段：VAD `speech>阈值 / 静音≥500ms / 段长 0.8–8s`，宁长勿短；可关闭 VAD 走固定 3s 窗；每段携带上一段尾句作 `prompt` 提升连贯性
- 配置持久化：`app_data_dir/live-translator.json`
- 跨平台：Windows WASAPI loopback 直通；macOS 需 `getDisplayMedia` 录屏权限或 BlackHole 虚拟设备；Linux PulseAudio monitor
- 历史：会话原文/译文对照，导出 JSON，清空

## 技术栈
- **Tauri 2 + Rust** 后端 + **React 18 + Vite + Tailwind + Zustand** 前端
- Rust：`reqwest 0.12 (rustls, stream, multipart)` / `tokio` / `cpal 0.15`（麦克风） / `hound` WAV / `windows 0.58` WASAPI（预留）
- 浏览器回退：`getUserMedia`（麦克风）+ `getDisplayMedia`（系统音频，弹窗勾选“分享音频”）

## 快速开始
```bash
npm install
npm run tauri -- dev      # 开发
npm run build             # 前端构建
npm run tauri -- build    # 打包
```

## 配置
设置页填入：
- **ASR**：Base URL、API Key（本地可空）、模型（如 `whisper-1`）
- **LLM**：Base URL、API Key、模型（如 `gpt-4o-mini`）、temperature、是否流式
- **音频**：音源、设备、VAD 阈值/静音/段长
- **语言**：源语言（→ ASR `language`）、目标语言（→ LLM 翻译目标）、额外提示词

均有 **连通性测试** 按钮（`GET {base}/models`）。

## 架构
```
Audio (cpal / getDisplayMedia) → PCM f32 → downmix mono → resample 16kHz
  → VAD Segmenter → WAV 16bit → AsrClient (/audio/transcriptions, multipart)
  → PipelineEvent::Transcript → LlmClient (/chat/completions, SSE stream)
  → pipeline-event (status/level/transcript/translation_delta/translation_done)
  → React (SubtitleBar + 历史)
```

Tauri commands：`get_config / set_config / list_audio_devices / pipeline_start / pipeline_stop / pipeline_status / push_audio_chunk / test_asr / test_llm / translate_text / get_history / clear_history / export_history`

## 跨平台说明
- **Windows**：系统音频本质是 WASAPI Loopback（共享模式 MixFormat），最稳；已预留 `windows` crate 原生实现，当前 MVP 走浏览器 `getDisplayMedia` 以快速跨平台
- **macOS**：浏览器 `getDisplayMedia` 需录屏权限；完整版可接入 `ScreenCaptureKit` 或 `BlackHole` 虚拟设备
- **Linux**：PulseAudio `monitor` / PipeWire

## 后续
- Rust 侧原生 `cpal` 捕获 + `WASAPI Loopback`（Windows）/ `SCK`（macOS）直连，脱离浏览器沙箱
- Silero VAD ONNX（`ort` crate）
- 本地 `whisper.cpp` / `faster-whisper` 离线 ASR
- 悬浮字幕窗、快捷键、术语库管理
