# 打包与发布

## Windows 安装格式

首版采用 NSIS `.exe` 安装程序，支持开始菜单和桌面快捷方式、安装目录选择、重装升级与卸载。默认按当前用户安装，选择所有用户或受保护目录时可请求管理员权限。模型和配置放在用户数据目录或用户选择的磁盘，不写入安装目录。

| 形式 | 适用范围 | 当前选择 |
| --- | --- | --- |
| NSIS 安装程序 | 官网或 GitHub 直接分发，安装目录和原生运行库管理灵活 | 默认产物 |
| MSIX | Microsoft Store、企业分发，系统管理安装和更新，需相应签名和打包适配 | 暂不生成 |
| 单纯自解压压缩包 | 临时解压运行，无标准安装与卸载流程 | 不作为正式安装方式 |

MSIX 可以运行完整桌面程序，并非不能支持模型插件。选择 NSIS 是为了先完成当前直接下载、安装和运行的交付方式；改用 MSIX 也不会消除推理运行库体积或驱动要求。

## 构建环境

- Node.js 24 和 .NET 10 SDK。
- Windows x64 构建 Windows NSIS；macOS 在目标架构机器构建 DMG。
- 首次构建需联网获取固定版本的运行库和依赖许可，后续复用已准备的文件。
- 不需要 Rust、CUDA Toolkit 或额外安装 C++ 编译器。用户运行安装版也不需要 Node.js 或 .NET SDK。

```powershell
npm ci
npm run desktop:dist
```

默认生成基础包 `release/MultiStudio-<版本>-win-x64-Setup.exe`。它包含 CPU / Vulkan、llama.cpp 和 ONNX 运行环境；NVIDIA CUDA 首次使用时下载到用户选择的目录。

需要不依赖运行库下载的离线包时：

```powershell
$env:MULTISTUDIO_PACKAGE_PROFILE = "offline"
npm run desktop:dist
```

离线包文件名为 `MultiStudio-<版本>-win-x64-Offline-Setup.exe`。恢复默认构建可将 `MULTISTUDIO_PACKAGE_PROFILE` 设为 `base`。两种包均不包含模型权重。`npm run desktop:pack` 仅生成解包程序。需要其他输出磁盘时：

```powershell
$env:MULTISTUDIO_RELEASE_DIR = "F:/MultiStudio/releases/0.1.0"
npm run desktop:dist
npm run release:verify -- --installer
```

大型安装包编译还会使用系统临时目录。系统盘空间不足时，可在当前终端把临时目录也放到构建盘：

```powershell
New-Item -ItemType Directory -Path "F:/MultiStudio/build-temp" -Force | Out-Null
$env:TEMP = "F:/MultiStudio/build-temp"
$env:TMP = $env:TEMP
```

Windows 运行库暂存优先使用同一磁盘上的硬链接，避免在 `.runtime/` 和 `.cache/package-runtime/` 重复占用空间；安装包中的文件仍是独立副本。

构建命令本身不上传或发布任何文件。NSIS 使用低压缩级别的 7z，兼顾下载体积与构建耗时；它仍是带安装与卸载流程的 `.exe` 安装程序。

## 运行库

`scripts/runtime-versions.json` 固定 audio.cpp 与 llama.cpp 版本，获取脚本只从对应官方发布下载。运行库记录包含版本、平台、架构和下载来源；使用文件存在、版本记录与启动检查验证，不对本地文件进行哈希校验。

- audio.cpp：基础包包含 Windows Vulkan / CPU；离线包额外包含 NVIDIA CUDA 13.3；macOS 使用 Metal。
- llama.cpp：官方 llama-server；Windows 使用 Vulkan / CPU，macOS 使用 Metal。
- C# 助手：当前平台的 .NET 自包含发布。
- Sherpa ONNX：npm 锁文件中的平台原生模块。

离线包固定包含 Windows CUDA 运行依赖，不根据构建机是否有 NVIDIA 显卡决定。开发环境 `npm run audio:runtime` 默认只准备基础组件，可用 `MULTISTUDIO_AUDIO_CUDA=1` 额外获取 CUDA。NVIDIA 运行仍需受支持的显卡及驱动；完整打包不等于任意型号和驱动都能使用 CUDA。

`.runtime/` 保存下载结果，`.cache/package-runtime/` 只暂存选定的组件。历史根目录 DLL、Whisper、工具脚本、模型权重和用户数据不加入发布包。Windows llama.cpp 同时携带所需的 C++ 运行库文件。

组件许可由 `scripts/stage-licenses.ts` 收集到 `.cache/package-licenses/`，安装后位于 `resources/licenses/`；推理运行库的许可同时保留在各自目录。模型不随安装包分发，其许可由下载模型决定。

## 可选运行库安装

应用在执行节点前准备所需运行库，实时输入会等待准备完成后再开始采集。CPU、Vulkan、Metal 不会触发 CUDA 下载；NVIDIA CUDA 从与所附 audio.cpp 相同版本的官方发布下载，基础包和离线包使用相同模型实现。

运行库安装目录可在“设置 → 插件”修改。默认使用模型库缓存目录下的 `engines/`，也可选择 F 盘。安装器支持进度、网络失败续传、取消和重试；压缩包在成功安装后删除，完整运行库保留供后续复用。已随离线包附带的组件优先使用，不重复下载。

安装过程中需要容纳下载文件与临时解压目录的空间；不足时会提示更换目录。运行库安装设置保存于 `runtime-settings.json`，不在安装包中保存用户配置。

下载由后台处理，ZIP 解压使用 C# 助手的标准库，不占用界面线程。第三方推理插件也可声明可选运行库，接口见 [节点插件](node-plugins.md)。

## 持续集成

`.github/workflows/desktop.yml` 对分支 push、PR 和手动运行执行：

- 在 Windows / macOS 安装锁定的 npm 依赖。
- 检查并构建界面，发布当前平台 C# 助手。
- 运行后台检查，以及桌面启动、C# 通信、API 节点和插件启停检查。

常规检查不下载模型，也不使用付费服务或真实麦克风。macOS 构建检查不能替代麦克风权限、系统音频和签名公证的真机验证。

## Windows Release

`.github/workflows/release.yml` 在推送 `v*` 标签时执行，也可在 Actions 选择已有标签手动运行。自动发布包含 Windows x64 基础包和离线包，两种类型均完成后才公开 Release。

标签必须与 `package.json` 和 `package-lock.json` 的版本一致。发布新版本时，先更新代码和版本并提交，然后推送标签，例如：

```powershell
npm version 0.1.1 --no-git-tag-version
git add .
git commit -m "Release MultiStudio 0.1.1"
git tag v0.1.1
git push origin HEAD
git push origin v0.1.1
```

`git add .` 会包含所有当前变更，提交前应先检查 `git status` 和差异。仓库需要配置 GitHub remote 并启用 Actions；本地配置工作流不会自动推送代码、创建标签或发布 Release。

发布任务会完成构建与后台检查，准备固定运行库，生成 NSIS，再检查包内版本、原生助手、自带运行环境、许可和运行库程序。随后启动解包版，在临时目录静默安装并启动安装版，重装检查用户数据保留，最后卸载并再次检查数据保留。

全部通过后，两种安装包分别保存为 Actions artifact，再由独立任务上传 GitHub Release。只有上传任务具有仓库写权限。先创建草稿，附件上传成功后公开；含 `-beta.1` 等后缀的版本自动标为 prerelease。已经公开的同版本 Release 不覆盖，需使用新版本标签；失败时保留的草稿可在修复后重跑。

发布检查不下载模型，不代表每次 Release 都重新验证所有模型和硬件。模型能力需结合具体模型和设备验证。

## Windows 签名

在仓库 Actions secrets 配置：

| 名称 | 内容 |
| --- | --- |
| `WINDOWS_CSC_LINK` | electron-builder 支持的签名证书，例如 PFX 的 Base64 内容 |
| `WINDOWS_CSC_KEY_PASSWORD` | 证书密码 |

配置仓库变量 `WINDOWS_REQUIRE_SIGNING=1` 后，缺少有效签名条件时构建失败。证书不写入源码或安装包；GitHub 自带令牌只用于上传 Release。

未配置证书时可以生成未签名预览包。Windows 可能显示未知发布者提示；切换安装格式不能替代可信签名。

## 更新与数据

当前通过下载新安装包并重装升级，没有接入应用内自动更新。应用 ID 保持 `app.livetranslator.desktop`，升级继续使用已有配置。卸载保留应用数据，外置模型也不会被安装程序删除。

安装目录属于程序文件，用户插件在应用数据目录的 `custom_nodes/`。调试或保存用户插件时不要改安装包内置插件。
