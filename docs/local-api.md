# 本机 API

在“设置 → 本机 API”启用服务并复制访问密钥。默认地址为 `http://127.0.0.1:18765/v1`，可修改端口。应用退出后服务关闭；重新启动时按保存设置启用。服务只监听本机地址，所有请求都需要 `Authorization: Bearer <访问密钥>`。

访问密钥独立于模型服务密钥，通过系统密钥存储加密保存。重置会使旧密钥立即失效并断开已有订阅。系统密钥存储不可用时，仅在当前应用会话保留密钥，重启后生成新密钥。

## 接口

| 方法 | 路径（相对于 `/v1`） | 内容 |
| --- | --- | --- |
| GET | `/health` | 服务名称及接口版本 |
| GET | `/workflows` | 已保存工作流、输入和输出节点 |
| GET | `/workflows/{workflowId}` | 指定工作流的输入输出定义 |
| POST | `/audio` | 上传 WAV 二进制，返回 `audioId` |
| GET | `/audio/{audioId}` | 获取输入或生成的 WAV |
| POST | `/runs` | 运行已保存工作流，可传入本次输入 |
| GET | `/runs/{runId}` | 状态及已生成的输出 |
| GET | `/runs/{runId}/events` | SSE 事件流，推送当前状态和实时输出 |
| POST | `/runs/{runId}/cancel` | 停止指定运行，包括实时采集 |
| GET | `/runs/{runId}/outputs/{nodeId}` | 获取纯文本或 WAV 输出 |

JSON 请求使用 `Content-Type: application/json`。音频上传使用 `audio/wav`、`audio/x-wav` 或 `application/octet-stream`，请求体为 WAV 文件本身，最多 25 MB。推荐单声道 16 kHz PCM WAV；是否支持其他采样率由所选推理插件决定。上传不会执行识别，需要把返回的 `audioId` 传给工作流。

## 工作流与输入

先在画布配置模型或 API，连接文本或音频输入到模型与输出节点，再保存。使用 `GET /workflows` 获取 ID：

```json
{
  "workflows": [{
    "id": "工作流 UUID",
    "name": "语音合成",
    "inputs": [{"nodeId": "输入节点 UUID", "label": "文本输入", "kind": "text-input", "type": "text", "acceptsInput": true}],
    "outputs": [{"nodeId": "输出节点 UUID", "label": "音频输出", "kind": "audio-output", "type": "audio"}]
  }]
}
```

运行请求：

```json
{
  "workflowId": "工作流 UUID",
  "inputs": {
    "文本输入节点 UUID": {"text": "你好，这是外部程序提交的文本。"},
    "音频输入节点 UUID": {"audioId": "上传返回的音频 UUID"}
  }
}
```

仅填写实际使用的节点。未覆盖的输入使用工作流中保存的值，覆盖不会改变画布或保存配置。只允许注入声明了 API 输入能力的节点，不能通过请求改写模型参数、读取任意文件路径或提交执行代码。第三方插件可声明自己的 API 输入，见 [插件接口](node-plugins.md)。

实时音频输入没有 `acceptsInput` 能力，使用已配置的系统音频或麦克风设备；API 可启动和停止该工作流并订阅结果。外部程序连续发送 PCM 音频暂不提供接口。

运行成功受理返回 HTTP 202，模型加载或推理在后台继续。桌面和 API 共用执行资源，一次运行一个工作流；繁忙时返回 HTTP 409，不排队。请求断开后任务继续，停止需调用 cancel。

## 结果

```json
{
  "id": "运行 UUID",
  "workflowId": "工作流 UUID",
  "status": "completed",
  "streaming": false,
  "startedAt": "2026-10-30T00:00:00.000Z",
  "endedAt": "2026-10-30T00:00:01.000Z",
  "outputs": [{
    "nodeId": "音频输出节点 UUID",
    "label": "音频输出",
    "type": "audio",
    "audioId": "音频 UUID",
    "url": "/v1/runs/运行 UUID/outputs/音频输出节点 UUID",
    "audioUrl": "/v1/audio/音频 UUID"
  }]
}
```

文本输出包含 `type: "text"`、`text` 和 `url`；音频输出包含 `type: "audio"`、`audioId`、`audioUrl` 和 `url`。返回路径相对于服务根地址，下载时同样需要访问密钥。输出接口分别返回 `text/plain; charset=utf-8` 或 `audio/wav`。所有输出节点都会收集，因此一个工作流可同时返回原文、翻译和合成音频。

运行状态：`running`、`cancelling`、`completed`、`failed`、`cancelled`、`interrupted`。失败时读取 `error`。普通运行保留最近十次记录；实时运行不逐句保存历史，只保留当前或最近一次会话状态。音频文件按音频 ID 独立保存，不随运行记录淘汰而删除。

## Python 示例

以下示例只使用 Python 标准库。先在界面保存一个文字合成工作流，并替换三个配置值：

```python
import json
import time
import urllib.request

BASE = "http://127.0.0.1:18765"
TOKEN = "从设置复制的访问密钥"
WORKFLOW_ID = "工作流 UUID"
INPUT_NODE_ID = "文本输入节点 UUID"

def request(route, payload=None, content_type="application/json"):
    data = json.dumps(payload).encode("utf-8") if isinstance(payload, dict) else payload
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + route, data=data, headers=headers)
    return urllib.request.urlopen(req, timeout=300)

print(json.load(request("/v1/workflows")))
run = json.load(request("/v1/runs", {
    "workflowId": WORKFLOW_ID,
    "inputs": {INPUT_NODE_ID: {"text": "你好，这是本机接口的语音合成。"}}
}))
while run["status"] in ("running", "cancelling"):
    time.sleep(0.2)
    run = json.load(request("/v1/runs/" + run["id"]))
if run["status"] != "completed":
    raise RuntimeError(run.get("error", run["status"]))
for output in run["outputs"]:
    suffix = ".wav" if output["type"] == "audio" else ".txt"
    with open(output["nodeId"] + suffix, "wb") as file:
        file.write(request(output["url"]).read())
```

识别或音频翻译工作流：先上传，再以 `audioId` 替换音频文件输入：

```python
with open("input.wav", "rb") as file:
    audio = json.load(request("/v1/audio", file.read(), "audio/wav"))
run = json.load(request("/v1/runs", {
    "workflowId": "识别工作流 UUID",
    "inputs": {"音频输入节点 UUID": {"audioId": audio["audioId"]}}
}))
```

## 实时订阅

```sh
curl -N -H "Authorization: Bearer 访问密钥" http://127.0.0.1:18765/v1/runs/运行UUID/events
```

连接建立后立即返回当前快照，后续 `event: run` 的 `data` 是相同格式的运行结果。实时字幕的暂定文字带 `partial: true`，确认后的结果为最终输出。只有具备增量输出能力的模型和节点才会返回句中文字；接口不会把整句识别变成流式识别。任务结束后发送最终结果并关闭订阅。

## 错误

错误响应为 `{"error":{"message":"原因"}}`。常见状态码：401 密钥无效；400 输入或工作流无效；404 资源不存在或尚无输出；409 已有任务运行或指定任务已结束；413 请求过大；415 内容类型错误。
