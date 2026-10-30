# MultiStudio

MultiStudio 是 Windows / macOS 桌面模型工作室。输入、模型处理和输出通过节点连接；推理后端与节点一起由插件提供。应用不提供独立网页端或移动端。

## 架构

| 部分 | 实现与职责 |
| --- | --- |
| 桌面 | Electron、React、TypeScript、React Flow；窗口、画布、模型下载与插件管理 |
| 应用服务 | Electron 主进程；配置、模型目录、工作流调度、文件与连接 |
| 原生助手 | C# / .NET 10；音频设备、麦克风与系统声音采集 |
| 推理插件 | 后端实例、模型匹配、执行与取消、流式连接、节点与模板 |

项目不依赖 Rust 或 Tauri。原生助手通过继承的标准输入输出与桌面通信，没有公共控制端口。推理插件可独立管理原生程序、Node 工作进程或远程服务，不需要把新引擎加入一个固定的模型类型分支。

## 启动与构建

开发需要 Node.js 22.12 或更新版本（推荐 24）和 .NET 10 SDK。发布包自带原生助手所需的 .NET 运行时，用户不需要另装 SDK。

```powershell
npm install
npm run dev
```

| 命令 | 行为 |
| --- | --- |
| `npm run dev` | 准备语音运行库，发布 C# 助手，监听界面构建并启动 Electron |
| `npm start` | 构建并启动桌面应用 |
| `npm run build` | 检查 TypeScript 并构建界面 |
| `npm run backend:build` | 发布当前平台的 C# 原生助手 |
| `npm run desktop:pack` | 构建当前平台的解包桌面程序 |
| `npm run desktop:dist` | 准备固定版本运行库和许可，生成 Windows NSIS / macOS DMG |
| `npm run runtime:stage` | 准备发布所需的完整推理运行库和依赖许可 |
| `npm run release:verify -- --installer` | 检查 Windows 发布包内容、版本、运行库和安装程序 |

开发与发布均从本地 `prism://app` 加载页面，不需要打开 localhost。该协议名称保留已有本地存储。修改界面会自动构建并刷新；修改桌面或 C# 代码需重启。节点插件在空闲时可重新加载。

C# 输出位于 `.cache/native-host/`，临时编译文件位于 `native/bin/` 和 `native/obj/`。清理这些目录后，下次构建会重新生成。

## 推理后端与节点

| 插件 | 节点 | 当前支持 |
| --- | --- | --- |
| audio.cpp | R2T2、Qwen3 ASR、NeMo、FunASR、SenseVoice；IndexTTS、Qwen3 TTS、CosyVoice、Fish Audio、Breeze TTS | 匹配模型家族的 audio.cpp GGUF；各系列使用独立节点 |
| Sherpa ONNX | ONNX 识别、ONNX 合成 | SenseVoice、Paraformer；Kokoro、VITS |
| llama.cpp | 本地文本、本地翻译 | 通过官方 llama-server 运行文本 GGUF |
| OpenAI 兼容服务 | API 文本、API 翻译、API 识别、API 合成 | Chat Completions、音频转写与合成接口 |
| 文本处理 | 流式分句 | 对确认文字进行句尾、长度与等待时间控制 |
| 输入与输出 | 文本、音频文件、实时音频、字幕、桌面窗口、通知、音频输出 | 可自由连接和分支 |

节点直接选择当前后端支持的模型，运行时自动加载，不需要先在模型库手动加载。语音节点可明确选择 CPU、Vulkan、NVIDIA CUDA，macOS 使用 Metal；自动模式按平台与设备选择。Vulkan 可用于 AMD、Intel 及 NVIDIA，具体模型仍需受该后端支持。插件停用后，其后端、节点和模板从可用列表移除，保存的图保留原数据。重新启用后可继续使用。

“设置 → 插件”支持导入目录、启停用、重新加载和打开插件目录。运行、采集或模型操作期间不能重新加载。用户插件在应用数据目录的 `custom_nodes/`，不修改安装包。

插件是受信任的本机代码，具有文件与网络访问能力。项目使用自己的插件格式，不直接加载 ComfyUI Python 节点。接口见 [节点与推理插件](docs/node-plugins.md)。

### 本地文本

llama.cpp 插件运行固定版本的官方 llama-server，使用模型自带的聊天模板，支持完整角色消息和增量文本。服务只监听本机随机端口，关闭网页界面并使用每次启动生成的访问密钥。模型选择、加载状态、生成与取消由插件管理。节点临时使用另一模型后，恢复原有驻留模型；没有驻留模型时，结束后释放临时加载。

模型需受所附 llama.cpp 版本支持。模型登记、文件名和量化标签不构成运行兼容性认证。

本地驻留模型与远程 API 连接分开保存。加载本地模型不会改写远程服务地址、密钥或 API 模型名。

## 模型管理与下载

模型库支持 GGUF 文件、目录扫描和手动登记；加载由运行节点管理。登记只保存引用，不复制或上传权重。若模型内部名称是不可读的标识，显示文件名；用户填写的名称优先。文件的运行后端由已启用插件匹配。

语音模型页按插件提供导入选项。Sherpa ONNX 模型通过目录导入，并检查相应文件：

- SenseVoice / Paraformer：ONNX 主模型和 tokens。
- Kokoro：主模型、voices.bin、tokens 和发音词典。
- VITS：主模型、tokens 和发音词典，不是任意 Piper 目录都能直接使用。
- audio.cpp：导入对应模型家族的自包含 GGUF；模型选择器按节点家族筛选。SenseVoice 还需要 FireRed / Silero / Pulse VAD 模型，默认从模型目录查找。

本地合成节点使用节点内的参考音频与参考文字。参考音频在本机保存，参数由模型插件处理；不同模型不共用不支持的语言选项。audio.cpp 的识别流与合成请求串行调度，切换模型前等待当前请求结束，避免识别过程中杀掉正在使用的引擎。

CosyVoice 使用较小的权重工作区并释放请求图；Fish Drama3 默认使用磁盘专家缓存和 CPU 音频编解码器，以降低显存占用。这些默认值可通过节点的引擎参数调整。

默认模型存储目录记录在 `model-library.json` 的 `storageDirectory`，audio.cpp 缓存目录记录在 `cacheDirectory`；路径可以位于其他磁盘。HF 下载目录单独在下载设置中选择。

内置可下载项为 SenseVoice Small INT8 和 Kokoro 中英文；不会在启动时自动下载。它们的下载定义和导入逻辑属于 Sherpa 插件。单独下载任意 ONNX 或 Safetensors 文件不代表已有匹配的执行后端。

HF 搜索与文件浏览使用真实接口，下载固定到仓库版本。支持进度、暂停、续传、取消、网络失败重试及文件大小与 GGUF 头检查；不对本地文件进行哈希校验，不执行仓库脚本。下载令牌不转发到其他文件分发域名。

R2T2 的 Q8_0 与 F16 来自 `davidxifeng/Confucius4-R2T2-gguf`；社区 Q4_K_M 来自 `Nairod785/Confucius4-R2T2-Q4_K_M-GGUF`。精度、速度和语言稳定性需要按实际音频与运行后端评估，不能用一个短样例推断所有场景。

## 音频输入与实时识别

**音频文件**负责上传、拖入与试听；**实时音频**负责设备采集。两者使用相同音频端口。文件在本机转换为单声道 16 kHz WAV，最多 120 秒、25 MB。

Windows 原生采集使用 NAudio / WASAPI，可以选择麦克风或播放设备的系统音频。macOS 麦克风通过 SoundFlow / MiniAudio / CoreAudio 采集；系统声音仍需在麦克风列表选择虚拟音频设备。当前未进行 macOS 真机验证。

实时输入点击画布运行后才开始采集，停止结束采集；重启应用不会自动录音。C# 助手按约 50 毫秒输出 PCM 小包，音量状态约每 200 毫秒更新，原始 PCM 只在后台传递。

R2T2 经 audio.cpp 的双向音频连接持续接收声音并返回增量文字，模型处理粒度为 320 毫秒。运行库不逐句重载；只监听本机随机端口并关闭自带网页界面。

当前 R2T2 适配沿用运行库的稳定前缀策略，末尾若干文字会等待确认。应用在约 900 毫秒停顿后结束当前语句，补入约 300 毫秒静音音频并收尾；补入静音不是额外等待同样时长。持续背景音乐可能干扰目前基于音量的停顿判断。极长无停顿输入在接近模型窗口上限前收尾继续。

FunASR、Sherpa 与远程音频识别节点目前按停顿收集整句后识别，不能把这一模式称作逐字流式。Qwen3 ASR、NeMo 和 SenseVoice 也可接收连续 PCM；接收音频流不等于每个模型都会在一句话结束前返回文字。实时插件根据节点声明的能力选择输入方式。

部分 Q4 文件的嵌入层使用当前 CUDA 不支持的 Q2_K 存储。audio.cpp 插件仅对该层生成兼容缓存，其余量化权重保持不变，原模型不修改。缓存位于应用数据目录的 `runtime/model-cache/`，约 1.71 GB；按来源路径、文件大小与修改时间判断是否需重新生成。

## 字幕、分句与翻译

- **原文字幕**直接连接识别结果。
- **翻译字幕**连接翻译结果，文本 API 支持 SSE 时逐步更新。
- **流式分句**只提交已确认文字，暂定文字可供显示。优先句尾标点，长句按长度、逗号、空白与最长等待时间提交，结束时补发余句。
- **桌面输出**使用普通窗口或系统通知；**文本输出**在节点结果中显示和复制。
- **音频输出**试听、导出 WAV，可选择自动播放。

文本结果可保存为 UTF-8 TXT。文本、音频输入和所有输出节点均可由本机 API 对接；实时字幕可通过事件流订阅。接口使用相同的模型插件与执行器，在“设置 → 本机 API”启用，默认仅监听 `127.0.0.1:18765`，使用独立访问密钥。API 输入只用于该次运行，不改写保存的工作流。接口与示例见 [本机 API](docs/local-api.md)。

每个字幕节点独立设置字号、文字颜色、背景、透明度、字体、行数、宽度、位置、对齐与置顶，复用自己的窗口。当前窗口在没有新输出时保留最后结果，没有自动清屏计时。

模板包含实时字幕、实时翻译和双语字幕，默认使用 NeMo / Nemotron 识别节点，可替换为其他识别节点。双语字幕把识别结果同时连到原文字幕，以及分句 → API 翻译 → 翻译字幕。模板创建后仍是普通节点图，翻译服务由用户配置。

分句默认最短 16 字、最长 80 字、最长等待 1800 毫秒，翻译默认保留两句上下文。默认值可在节点修改。本地文本插件通过 llama.cpp 的事件流接收增量文字；具体模型的输出节奏仍需实际验证，不能由远程 API 的表现推断。

系统音频工作流不能连接自动播放的音频输出，避免把生成声音再次采入。R2T2 实时输入不保存分段录音；整句引擎产生的临时 WAV 在处理或停止后清理，用户文件保留。实时结果不逐句写入历史。

## 画布与执行

拖动节点标题移动；操作内部控件不会拖动画布。文字与音频端口类型必须匹配。一个输入接受一条连线，输出可连接多个分支；新连接替换已占用输入，端点可重接或拔出。

运行前检查有效分支与资源，只执行连接到输出的分支，共用上游不重复执行。图必须无循环。运行状态与文字通知每约 50 毫秒合并一次，音量变化只更新对应输入，画布只重新绘制变化的节点；这不会改变音频输入或模型处理频率。普通任务单次执行；含实时输入的图由输入插件持续调度，仍使用画布的运行和停止。失败时显示具体节点错误。

图最多 64 节点、128 连线、500 KB；文字值最多 32768 字符。右侧面板查看完整结果、导出音频、复制节点与管理上下文。普通运行保存最近十次结果和图快照。

## 连接与数据

文本 API 在设置中配置地址、密钥与默认模型；语音 API 单独配置转写模型、合成模型和音色。节点可以指定不同模型名，但不在工作流中保存密钥。API 地址应包含服务需要的前缀，例如 `/v1`。本机允许 HTTP，远程使用 HTTPS。

语音 API 与 HF 密钥使用系统加密存储，加密不可用时只在当前进程保留；文本 API 密钥沿用配置文件存储。本地推理不上传音频或文字，远程节点会发送对应输入。启动和打开插件页不调用付费推理。

默认数据目录保留为：

| 平台 | 目录 |
| --- | --- |
| Windows | `%APPDATA%/app.livetranslator.desktop` |
| macOS | `~/Library/Application Support/app.livetranslator.desktop` |

`MULTISTUDIO_DATA_DIR` 可指定其他目录。

| 文件 / 目录 | 内容 |
| --- | --- |
| `live-translator.json` | 文本 API 连接 |
| `model-library.json` | 模型目录、登记、加载选项及上次驻留模型 |
| `speech-settings.json` | 语音 API 连接 |
| `speech-models.json` | Sherpa 导入模型 |
| `api-settings.json` | 本机 API 开关、端口与加密访问密钥 |
| `runtime-settings.json` | 可选推理运行库的安装目录 |
| `workflows.json` | 保存的节点图 |
| `workflow-runs.json` | 普通执行记录 |
| `workflow-contexts.json` | 节点对话上下文 |
| `custom_nodes/` | 用户插件和停用记录 |
| `audio/` | 用户音频和合成结果 |
| `runtime/model-cache/` | 推理插件兼容缓存 |

保存图中的旧通用识别、合成、文本与翻译节点会迁移为具体后端节点。旧连接中用于标记本地模型的地址不再当作真实 API；驻留模型记录迁入模型库设置。迁移不删除模型和音频。

删除工作流或节点只移除记录与引用，不删除权重、用户音频。导出 JSON 包含节点配置、文字和本机音频 ID，不含密钥、结果或音频文件；换机需重新选择资源。

## 运行库与发布

运行库版本固定在 `scripts/runtime-versions.json`。开发使用 `.runtime/` 中的独立 audio.cpp 与 llama.cpp 目录；发布时只把所需程序、动态库、模型定义与许可复制到 `.cache/package-runtime/`，不再依赖本机预先提供的 llmcore.dll。

当前版本不提供本地 Whisper 插件，也不下载或打包其运行库。

`npm run audio:runtime` 默认只准备固定版本 audio.cpp v0.9.3 的基础运行库；Windows 包含 CPU / Vulkan，macOS 使用 Metal。CUDA 可在首次使用时下载。Sherpa ONNX 使用匹配平台的 Node 原生模块及 ONNX Runtime。

发布包包含界面、C# 助手、插件及推理运行库，不包含模型权重。Windows 使用可选安装目录的 NSIS 安装程序，默认安装到当前用户，卸载保留应用数据和外置模型。安装包为 `release/MultiStudio-0.1.0-win-x64-Setup.exe`，解包程序为 `release/win-unpacked/MultiStudio.exe`；实际文件名跟随项目版本。

Windows 提供基础包与离线包：基础包包含 CPU / Vulkan、文本与 ONNX 运行库，NVIDIA CUDA 首次使用时下载；离线包额外附带完整 CUDA 13.3 运行库。两种包使用相同节点和工作流。设置 → 插件可选择运行库目录、提前安装、查看进度、取消和重试，下载支持续传，成功安装后清理压缩包。工作流底部显示准备进度。

`MULTISTUDIO_PACKAGE_PROFILE=base` 为默认构建；设为 `offline` 构建离线包，文件名包含 `Offline`。依赖许可在 `resources/licenses/` 与 `resources/runtime/*/LICENSE`。

分支和 PR 会运行 Windows / macOS 构建、后台检查及桌面启动检查。推送与 package.json 一致的 `v*` 标签会构建 Windows 基础和离线安装包，检查安装、重装、卸载及数据保留，再上传 GitHub Release；预发布版本标为 prerelease。详细操作和签名设置见 [打包与发布](docs/packaging.md)。

macOS 可在对应架构构建 DMG，仍需真机检查权限、签名与公证；目前不加入自动对外发布。

## 目录

```text
src/                 界面、节点画布与状态
electron/            应用服务、私有通信、模型目录、插件宿主
native/              C# 音频采集
plugins/             各推理后端、节点、模型定义与处理逻辑
scripts/             构建、运行库准备、桌面启动与检查
assets/              桌面图标
.runtime/            本机推理动态库，不入库
.cache/native-host/  当前平台的原生助手发布目录，不入库
```

音频依赖参考 [NAudio](https://github.com/naudio/NAudio) 与 [SoundFlow](https://github.com/LSXPrime/SoundFlow)，推理接口参考 [audio.cpp](https://github.com/0xShug0/audio.cpp)、[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 与对应服务文档。
