# 节点与推理插件

插件目录提供 `manifest.json` 和 CommonJS 入口。内置与用户插件使用同一加载器。TypeScript 插件先构建为 CJS，再导入整个目录。

## 安装与生命周期

在“设置 → 插件”导入目录，或关闭应用后复制到数据目录的 `custom_nodes/<插件标识>/`。运行、采集或模型操作期间不能重新加载。

清单提供节点、推理后端和模板；入口提供实现。停用或重新加载前，宿主停止实时会话、释放已创建后端，再更新注册表。停用不删除图或模型。用户插件不能覆盖已有插件标识、节点或后端。

插件是受信任的本机程序，可携带自己的辅助文件、依赖和原生程序。加载器不自动执行 npm、pip 或安装脚本。依赖需匹配 Electron 和目标平台。修改 C# 助手需要重新构建并重启应用。

## 清单

```json
{
  "apiVersion": 1,
  "id": "example.engine",
  "name": "示例引擎",
  "version": "1.0.0",
  "entry": "index.cjs",
  "backends": {
    "example.engine": {
      "name": "示例引擎",
      "capabilities": ["text"]
    }
  },
  "nodes": {
    "example.generate": {
      "label": "示例生成",
      "group": "model",
      "input": "text",
      "output": "text",
      "backend": "example.engine",
      "defaults": { "modelId": "", "temperature": 0.2 },
      "fields": [
        { "key": "modelId", "label": "模型", "type": "model", "resource": "text", "backend": "example.engine" },
        { "key": "temperature", "label": "温度", "type": "number", "min": 0, "max": 1, "step": 0.1 }
      ]
    }
  }
}
```

节点与后端可独立声明。后端声明需要相应 `runtime.backends[id].create(host)`，节点需要 `runtime.nodes[kind].execute(context)`。模板引用未加载节点时不显示。

## 推理后端

```javascript
module.exports.backends = {
  'example.engine': {
    accepts(model) {
      return model.kind === 'text' && model.architecture === 'example';
    },
    create(host) {
      let worker;
      return {
        async preflight(config) {
          await host.library.resolve(config.modelId, 'example.engine');
        },
        async generate(config) {
          // 初始化或复用自己的推理进程，并把 config.signal 传给耗时操作。
          return '生成结果';
        },
        async stop() {
          // 关闭流、任务和自己的工作进程。
        }
      };
    }
  }
};
module.exports.nodes = {
  'example.generate': {
    preflight: ({ host, config }) =>
      host.inference.get('example.engine').preflight(config),
    async execute({ host, config, input, signal }) {
      const text = await host.inference.get('example.engine')
        .generate({ ...config, messages: [{ role: 'user', content: input.text }], signal });
      return { type: 'text', text };
    }
  }
};
```

`accepts` 是可选模型匹配函数，接收 `path`、`kind`、`architecture`、`family` 和选取的 GGUF `metadata`。模型目录会列出匹配的后端；没有匹配后端的文件只登记。匹配并不等于完整架构验证，实际加载仍由后端负责。

`create` 按需创建，一个后端标识对应当前应用的一份实例。方法由节点实现调用；宿主不按模型名称维护执行分支。后端可用独立程序、Node 工作进程或远程接口。提供文本文件匹配且支持模型页加载的后端，应实现 `load(entry, options)`、`unload()` 和 `status()`。

宿主上下文：

| 属性 | 内容 |
| --- | --- |
| `dataDir` | 应用数据目录 |
| `runtimeDirectory` | 当前平台推理运行库目录 |
| `resourcesPath` / `packaged` | Electron 发布资源与是否发布版 |
| `library` | `catalogue()`、`resolve(id, backendId)` 和模型设置 |
| `backend` | 应用配置与已声明的应用命令 |
| `native` | 私有 C# 助手通信，仅供可信后台代码 |
| `runtimes` | 可选运行库准备；`ensure(packageId, signal)` 返回可用目录 |
| `speech` | WAV 保存、音频引用检查、语音 API 设置 |
| `fetcher` | 使用桌面网络设置的请求函数 |
| `emit` | 发布已声明桌面事件 |
| `createWorker(file)` | 创建 Electron 工作进程 |

`stop()` 必须清理后端持有的模型、连接与进程。后端应自行协调并行调用和模型切换。密钥从应用连接读取，不放进节点或模板；取消网络请求应传 `signal`。

内置例子：

- `plugins/audiocpp/`：按家族提供识别与合成节点，管理 C++ 服务、串行执行、参考音频及流式识别。
- `plugins/sherpa/`：目录模型定义、下载、导入与独立语音工作进程。
- `plugins/llmcore/`：本地文本生命周期、临时模型切换及官方 llama.cpp 私有服务。
- `plugins/openai/`：文本 SSE、音频转写和合成服务。

## 可选运行库

后端可实现 `runtimePackages(runtimeDirectory)` 返回下载组件定义，宿主统一提供安装目录、进度、取消、续传和缓存复用。组件定义包括 `id`、`name`、`version`、`installedBytes`、`required` 文件、`executables`、额外 `directories`，以及 `archives` 中的固定下载 URL 与文件大小。当前安装器支持 ZIP。压缩包包含顶层目录时，可用 `archive.executable` 指定用于定位程序根目录的文件名。

在节点预检查中调用 `await host.runtimes.ensure(id, signal)`，使实时采集等后续操作等待资源准备完成。离线包中已有匹配版本时直接返回内置目录，不再下载。`plugins/audiocpp/packages.cjs` 提供完整示例。

## 语音目录模型

后端清单可声明 `modelImports`：

```json
{
  "modelImports": [
    { "engine": "my-asr", "name": "示例识别", "task": "asr", "format": "directory" }
  ]
}
```

`format` 为 `gguf` 时使用文件登记；为 `directory` 时，调用后端实例的 `models.import(directory, task, engine)`。语音页读取清单生成入口，不维护引擎名称列表。

后端的 `models.list()` 返回 `id`、`name`、`task`、`engine`、`directory`、`status`、`languages` 和 `size`，可添加 `repo`、`bytes`、`total`、`error`。声明下载项时提供 `models.download(id)`。模型状态变化时调用 `host.emit('speech-models', null)`，界面会重新读取各后端模型清单，不接收单一后端覆盖全局清单。不要把“文件存在”当作所有模型格式都可运行。

## 节点定义与字段

| 字段 | 说明 |
| --- | --- |
| `label` / `group` | 名称；分组为 input、model、output |
| `input` / `output` | 当前内置值为 text、audio 或 null；连线两端类型必须一致 |
| `backend` | 对应后端标识 |
| `icon` | text、audio、languages、mic、monitor、sparkles、volume |
| `defaults` | 参数默认值，字符串、数字或布尔值 |
| `fields` | 节点内参数表单 |
| `widget` | audio-input 文件控件、audio-capture 采集控件 |
| `platformOptions` | 字段可按 `win32` / `darwin` 提供选项；注册时解析为当前平台的 `options` |
| `apiInput` | 允许本机 API 为该输入节点注入单次运行数据；入口需实现 `bindInput(config, input)` |

`bindInput` 返回该次运行的完整节点配置，随后执行统一的配置检查与资源检查，不写回已保存工作流。例如文本输入返回 `{ ...config, text: input.text }`，音频输入返回 `{ ...config, audioId: input.audioId }`。密钥仍从宿主连接读取。新增输入插件可使用同一接口，API 服务不维护模型或节点种类列表。

API 自动收集 `group: "output"` 节点的文本或音频结果，并提供 JSON、纯文本和 WAV 下载；实时运行使用既有工作流事件发布增量结果。完整协议见 [本机 API](local-api.md)。
| `context` | 启用文字节点上下文结果面板 |
| `session` | 持续输入，需要入口导出 createSession |

字段 `key` 必须存在于 `defaults`：

| 类型 | 属性 |
| --- | --- |
| text | placeholder、maxLength |
| textarea | rows、placeholder、maxLength |
| number | min、max、step |
| boolean | 开关 |
| select | options: [{ value, label }] |
| color | 十六进制颜色 |
| model | resource: text/asr/tts/speech/vision/projector；backend 筛选后端；family 筛选模型家族；byPath 保存路径 |

`advanced: true` 放入“更多”。`when: { provider: "api" }` 等条件控制显示，多个键取“且”，数组内取“或”。隐藏字段仍保留值。文件输入控件用 `audioId`、`filename`、`duration`，采集控件用 `source`、`deviceId`。

模板的 `nodes` 默认按顺序连接。可用 `links: [[0,1],[1,2],[1,3]]` 声明分支，下标从 0 开始；各节点项的 `config` 覆盖默认值。

## 普通执行

```javascript
{
  execute({ node, config, input, signal, host, run, transient, onUpdate }) {},
  preflight({ node, config, signal, host, live }) {},
  validate(config, { executable, live }) {},
  migrate(data) { return data; }
}
```

文字返回 `{ type: 'text', text }`，音频返回 `{ type: 'audio', audioId }`。输出节点返回输入并执行显示或播放动作。抛错停止本轮后续分支。

`preflight` 在任何有效节点执行前检查依赖；实时开始前 `live=true`，此时还没有具体音频文件。`transient=true` 不逐句保存历史。`onUpdate(text)` 接收当前累计文字，实时生成时可用于下游字幕。

节点宿主另提供 `outputs.publish(node, value, run)`、`getContext`、`writeContext`、`emit` 与 `inference.get(id)`。

## 流式识别与实时输入

流式节点可提供：

```javascript
{
  canStream(config) { return true; },
  async openStream({ host, config, signal, onUpdate }) {
    // 返回 { write(samples), finish(), cancel(), done }
    // onUpdate({ text, final, committed })：累计文字。
  },
  async preview({ node, config, input, host, run }) {},
  createTextStream({ config, emit, preview }) {
    // 返回 { push(value, utterance), cancel() }
  }
}
```

`done` 是最终结果 Promise，`finish()` 结束输入并等待结果，`cancel()` 立即终止。暂定文字使用 `committed:false`；分句只消费已确认文字。不能流式的识别器由实时输入插件按停顿收集整句再调用普通执行。

实时入口 `createSession(host)` 返回 `start({workflow})` 与 `stop()`。宿主提供 `capture`、`workflows`、`audioDirectory`、`isSessionNode`、`nodeRuntime` 和 `update(state)`。

采集的私有 `pcm` 事件提供单声道 16 kHz PCM16 数组，不广播给界面；`capture` 事件提供设备状态。先通过 `workflows.plan(workflow,true,{live:true})` 和 `preflight` 检查，再开始设备采集。

`workflow-event` 发送状态和节点结果，不重复附带运行中不变的图定义；完整快照可用 `workflow_status` 读取。界面通知每约 50 毫秒合并一次，结束状态立即发送，音频和节点执行不经过这一合并。

`beginLive(workflow)` 创建稳定运行状态。`live.preview(node,value,utterance)` 更新当前节点和支持预览的直接下游；`utterance` 含 id、startedAt。文字流通过 `live.onChunk` 排队提交确认片段，串行调用 `executeFrom(node,output,utterance,branchId)` 只执行后续分支。

停止要结束采集、取消在途任务、关闭流与定时器、移除监听、清理插件自己的临时文件，再调用 `live.end(error)`。不得删除用户上传音频。会话状态通过 update 发布 starting/running/stopping/stopped/error 及处理数量。每张图使用一个有效实时输入。
