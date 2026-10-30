const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { readJson, writeJson, secretStore } = require('./storage.cjs');
const { AUDIO_LIMIT } = require('./speech.cjs');
const { nodeRegistry } = require('./node-registry.cjs');

const finished = run => !['running', 'cancelling'].includes(run.status);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(request, limit) {
  if (Number(request.headers['content-length']) > limit) fail(413, '请求内容过大');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; if (size > limit) fail(413, '请求内容过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, '需要 application/json');
  let value;
  try { value = JSON.parse((await body(request, 512000)).toString('utf8')); }
  catch (error) { if (error.status) throw error; fail(400, 'JSON 格式无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '需要 JSON 对象');
  return value;
}
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

class ApiServer {
  constructor(directory, { speech, workflows, start, cancel, safeStorage }) {
    Object.assign(this, { speech, workflows, start, cancel });
    this.file = path.join(directory, 'api-settings.json');
    this.secrets = secretStore(safeStorage); this.clients = new Set(); this.ready = this.open();
  }
  async open() {
    const saved = await readJson(this.file, {});
    this.settings = { enabled: saved.enabled === true, port: saved.port || 18765 };
    this.token = this.secrets.decode(saved.encryptedToken) || randomBytes(24).toString('hex');
    await this.persist();
    if (this.settings.enabled) await this.listen();
  }
  persist() { return writeJson(this.file, { ...this.settings, encryptedToken: this.secrets.encode(this.token) }); }
  snapshot() {
    return { ...this.settings, running: !!this.server?.listening, url: `http://127.0.0.1:${this.settings.port}/v1`,
      token: this.token, tokenPersistent: this.secrets.available(), error: this.error || null };
  }
  async configure({ enabled = this.settings.enabled, port = this.settings.port, regenerateToken = false }) {
    await this.ready;
    if (typeof enabled !== 'boolean' || !Number.isInteger(port) || port < 1024 || port > 65535) fail(400, '端口应为 1024–65535');
    if (this.configuring) fail(409, '正在更新 API 设置');
    this.configuring = true;
    try {
      await this.stop(); this.settings = { enabled, port }; this.error = null;
      if (regenerateToken) this.token = randomBytes(24).toString('hex');
      await this.persist();
      if (enabled) await this.listen();
      return this.snapshot();
    } finally { this.configuring = false; }
  }
  async listen() {
    const server = http.createServer((request, response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      void this.handle(request, response).catch(error => {
        if (!response.destroyed && !response.headersSent) json(response, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: { message: error.message } });
        else response.end();
      });
    });
    this.server = server;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.settings.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      server.on('error', error => { this.error = error.message; });
      this.error = null;
    } catch (error) { this.error = `API 启动失败：${error.message}`; this.server = null; }
  }
  async stop() {
    for (const client of this.clients) client.response.end();
    this.clients.clear();
    const server = this.server; this.server = null;
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  describe(workflow) {
    const ports = group => workflow.nodes.filter(node => nodeRegistry.definitions[node.data.kind]?.group === group).map(node => {
      const definition = nodeRegistry.definitions[node.data.kind];
      return { nodeId: node.id, label: node.data.label, kind: node.data.kind, type: group === 'input' ? definition.output : definition.input,
        ...(group === 'input' ? { acceptsInput: !!definition.apiInput } : {}) };
    });
    return { id: workflow.id, name: workflow.name, inputs: ports('input'), outputs: ports('output') };
  }
  bind(workflowId, inputs = {}) {
    const saved = this.workflows.get(workflowId);
    if (!saved) fail(404, '工作流不存在');
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) fail(400, 'inputs 应为按节点 ID 索引的对象');
    const workflow = structuredClone(saved);
    for (const [id, input] of Object.entries(inputs)) {
      const node = workflow.nodes.find(node => node.id === id);
      if (!node || !nodeRegistry.definitions[node.data.kind]?.apiInput) fail(400, `节点不接受 API 输入：${id}`);
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '节点输入格式无效');
      node.data.config = nodeRegistry.handler(node.data.kind).bindInput(node.data.config, input);
    }
    return workflow;
  }
  findRun(id) {
    const current = this.workflows.status(), run = current?.id === id ? current : this.workflows.getRun(id);
    if (!run) fail(404, '运行记录不存在');
    return run;
  }
  result(run) {
    // Live updates omit the immutable graph; resolve it from the current session.
    const workflow = run.workflow || this.workflows.live?.workflow || this.workflows.get(run.workflowId);
    const outputs = (workflow?.nodes || []).filter(node => nodeRegistry.definitions[node.data.kind]?.group === 'output' && run.nodes[node.id]?.output).map(node => {
      const output = run.nodes[node.id].output;
      return { nodeId: node.id, label: node.data.label, ...output, url: `/v1/runs/${run.id}/outputs/${node.id}`,
        ...(output.type === 'audio' ? { audioUrl: `/v1/audio/${output.audioId}` } : {}) };
    });
    return { id: run.id, workflowId: run.workflowId, status: run.status, streaming: !!run.streaming,
      startedAt: run.startedAt, endedAt: run.endedAt, error: run.error, outputs };
  }
  publish(event, run) {
    if (event !== 'workflow-event') return;
    for (const client of this.clients) if (client.id === run.id) this.send(client, run);
  }
  send(client, run) {
    const frame = `event: run\ndata: ${JSON.stringify(this.result(run))}\n\n`;
    // Disconnect slow consumers instead of retaining unbounded subtitle history.
    if (client.response.writableLength > 1024 * 1024) { client.response.destroy(); return; }
    client.response.write(frame);
    if (finished(run)) client.response.end();
  }
  async audio(response, id) {
    const file = await this.speech.validateAudio(id), stat = await fs.stat(file);
    response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    const { createReadStream } = require('node:fs');
    const stream = createReadStream(file);
    response.once('close', () => stream.destroy()); stream.on('error', () => response.destroy()); stream.pipe(response);
  }
  async handle(request, response) {
    if (request.headers.authorization !== `Bearer ${this.token}`) fail(401, '需要有效的 Bearer 密钥');
    const parts = new URL(request.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean), method = request.method;
    if (parts[0] !== 'v1') fail(404, '接口不存在');
    if (method === 'GET' && parts.length === 2 && parts[1] === 'health') return json(response, 200, { name: 'MultiStudio', apiVersion: 1 });
    if (method === 'GET' && parts[1] === 'workflows' && parts.length <= 3) {
      if (parts[2]) {
        const workflow = this.workflows.get(parts[2]); if (!workflow) fail(404, '工作流不存在');
        return json(response, 200, this.describe(workflow));
      }
      return json(response, 200, { workflows: this.workflows.items.map(workflow => this.describe(workflow)) });
    }
    if (parts[1] === 'audio') {
      if (method === 'POST' && parts.length === 2) {
        if (!['audio/wav', 'audio/x-wav', 'application/octet-stream'].includes(request.headers['content-type']?.split(';')[0])) fail(415, '请上传 WAV 二进制音频');
        const audio = await this.speech.saveInput(await body(request, AUDIO_LIMIT));
        return json(response, 201, { audioId: audio.id, url: `/v1/audio/${audio.id}` });
      }
      if (method === 'GET' && parts.length === 3) return this.audio(response, parts[2]);
    }
    if (parts[1] === 'runs') {
      if (method === 'POST' && parts.length === 2) {
        const value = await jsonBody(request), workflow = this.bind(value.workflowId, value.inputs);
        const started = await this.start(workflow);
        const run = started.run || this.workflows.status();
        return json(response, 202, this.result(run));
      }
      if (parts.length >= 3) {
        const run = this.findRun(parts[2]);
        if (method === 'GET' && parts.length === 3) return json(response, 200, this.result(run));
        if (method === 'POST' && parts.length === 4 && parts[3] === 'cancel') {
          if (finished(run) || this.workflows.status()?.id !== run.id) fail(409, '任务已经结束');
          await this.cancel(run.id); return json(response, 200, this.result(this.findRun(run.id)));
        }
        if (method === 'GET' && parts.length === 4 && parts[3] === 'events') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          response.flushHeaders();
          const client = { id: run.id, response }; this.clients.add(client);
          const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000); heartbeat.unref();
          response.once('close', () => { clearInterval(heartbeat); this.clients.delete(client); });
          this.send(client, run); return;
        }
        if (method === 'GET' && parts.length === 5 && parts[3] === 'outputs') {
          const output = this.result(run).outputs.find(output => output.nodeId === parts[4]);
          if (!output) fail(404, '输出尚未生成');
          if (output.type === 'audio') return this.audio(response, output.audioId);
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(output.text); return;
        }
      }
    }
    fail(404, '接口不存在');
  }
}
module.exports = { ApiServer };
