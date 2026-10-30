const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { access } = require('node:fs/promises');
const { sseEvents } = require('../../electron/sse.cjs');

class LlamaServer {
  constructor(directory) { this.directory = directory; this.token = randomBytes(24).toString('hex'); }
  get running() { return !!this.child && this.child.exitCode === null && !this.failure; }
  async load(model, options) {
    await this.stop();
    const executable = path.join(this.directory, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    await access(executable).catch(() => { throw new Error('缺少 llama.cpp 运行库，请重新安装桌面应用'); });
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    this.url = `http://127.0.0.1:${port}`; this.diagnostic = ''; this.failure = null;
    const child = this.child = spawn(executable, ['--model', model, '--alias', 'local', '--host', '127.0.0.1', '--port', String(port), '--ctx-size', String(options.contextLength || 4096), '--threads', String(options.threads || 4), '--n-gpu-layers', options.useGpu === false ? '0' : 'auto', '--parallel', '1', '--no-webui', '--api-key', this.token], { cwd: this.directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = bytes => { this.diagnostic = (this.diagnostic + bytes).slice(-12000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { this.failure = error.message; });
    this.closed = new Promise(resolve => child.once('close', resolve));
    try {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        if (!this.running) throw new Error('文本引擎启动失败：' + (this.failure || this.diagnostic.slice(-2500)));
        try {
          const response = await fetch(this.url + '/health', { headers: this.headers(), signal: AbortSignal.timeout(1000) });
          await response.body?.cancel(); if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('文本模型加载超时');
    } catch (error) { await this.stop(); throw error; }
  }
  headers() { return { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }; }
  async generate(config) {
    if (!this.running) throw new Error('文本引擎已退出，请重新加载模型');
    const controller = this.controller = new AbortController();
    try {
      const response = await fetch(this.url + '/v1/chat/completions', { method: 'POST', headers: this.headers(),
        body: JSON.stringify({ model: 'local', messages: config.messages || [{ role: 'user', content: config.prompt }], temperature: config.temperature, max_tokens: config.maxTokens, stream: !!config.onUpdate }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000), ...(config.signal ? [config.signal] : [])]),
      });
      if (!response.ok) throw new Error(`文本引擎 HTTP ${response.status}：${(await response.text()).slice(0, 1500)}`);
      if (!config.onUpdate) return (await response.json()).choices?.[0]?.message?.content || '';
      let text = '';
      for await (const event of sseEvents(response.body)) {
        if (event.error) throw new Error(event.error.message);
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') { text += delta; await config.onUpdate(text); }
      }
      return text;
    } finally { if (this.controller === controller) this.controller = null; }
  }
  async stop() {
    this.controller?.abort();
    const child = this.child; this.child = null;
    if (child && child.exitCode === null) { child.kill(); await this.closed; }
  }
}
module.exports = { LlamaServer };
