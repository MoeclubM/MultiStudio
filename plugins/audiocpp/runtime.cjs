const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { selectBackend } = require('./devices.cjs');
const { cudaModel } = require('./cuda-model.cjs');
const { transcribeStream } = require('../../electron/audio-stream.cjs');
const { execFileSync } = require('node:child_process');

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve)); return port;
}

class AudioCpp {
  constructor(directory, runtimeDirectory, cacheDirectory, runtimes) {
    this.runtimes = runtimes;
    this.directory = cacheDirectory || path.join(directory, 'runtime'); this.runtimeDirectory = runtimeDirectory;
    this.cudaDirectory = path.join(runtimeDirectory, '..', 'audiocpp-cuda');
    this.cuda = false;
    if (process.platform === 'win32') {
      try { execFileSync('nvidia-smi', ['-L'], { windowsHide: true, stdio: 'ignore', timeout: 3000 }); this.cuda = true; } catch {}
    }
  }
  async ensureBackend(device, signal) {
    if (selectBackend(device, process.platform, this.cuda) === 'cuda' && this.runtimes) this.cudaDirectory = await this.runtimes.ensure('audiocpp-cuda', signal);
  }
  async prepare(model, { threads = 4, device = 'auto', mode = 'offline', family = 'confucius4_r2t2', task = 'asr', sessionOptions = {} } = {}, signal) {
    await this.ensureBackend(device, signal);
    const backend = selectBackend(device, process.platform, this.cuda);
    const signature = JSON.stringify([model, threads, backend, mode, family, task, sessionOptions]);
    if (this.signature === signature && this.child?.exitCode === null) return;
    if (this.starting) await this.starting;
    if (this.signature === signature && this.child?.exitCode === null) return;
    this.starting = this.open(model, threads, backend, mode, family, task, sessionOptions, signal).then(() => { this.signature = signature; });
    try { await this.starting; } finally { this.starting = null; }
  }
  async open(model, threads, backend, mode, family, task, sessionOptions, signal) {
    await this.stop(); signal?.throwIfAborted();
    this.backend = backend;
    const directory = backend === 'cuda' ? this.cudaDirectory : this.runtimeDirectory;
    const executable = path.join(directory, process.platform === 'win32' ? 'audiocpp_server.exe' : 'audiocpp_server');
    await fs.access(executable).catch(() => { throw new Error('缺少 audio.cpp 运行库，请重新安装桌面应用'); });
    await fs.access(model);
    await fs.mkdir(this.directory, { recursive: true });
    const environment = { ...process.env, PATH: path.dirname(this.runtimeDirectory) + path.delimiter + (process.env.PATH || '') };
    if (backend === 'cuda' && family === 'confucius4_r2t2') model = await cudaModel(model, this.directory, directory, environment, signal);
    signal?.throwIfAborted();
    const port = await freePort(), config = path.join(this.directory, 'engine.json');
    await fs.writeFile(config, JSON.stringify({ host: '127.0.0.1', port, backend, threads, lazy_load: false, max_loaded_models: 1, models: [{ id: 'active', family, path: model, task, mode, session_options: { ...(mode === 'streaming' && family === 'confucius4_r2t2' ? { 'confucius4_r2t2.chunk_size_ms': '320' } : {}), ...sessionOptions } }] }));
    this.url = `http://127.0.0.1:${port}`; this.diagnostic = ''; this.failure = null;
    const child = this.child = spawn(executable, ['--config', config, '--no-ui'], { cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = chunk => { this.diagnostic = (this.diagnostic + chunk).slice(-12000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { this.failure = error.message; });
    this.closed = new Promise(resolve => child.once('close', resolve));
    const abort = () => { child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (this.failure || child.exitCode !== null) throw new Error(`语音引擎启动失败：${this.failure || this.diagnostic.trim().slice(-2500)}`);
        try { const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; await response.body?.cancel(); } catch {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('语音模型加载超时');
    } catch (error) { await this.stop(); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async openStream(model, options, signal, onUpdate) {
    await this.prepare(model, { ...options, mode: 'streaming' }, signal); signal?.throwIfAborted();
    const url = new URL('/v1/audio/transcriptions/live', this.url);
    for (const [key, value] of Object.entries({ model: 'active', sample_rate: '16000', channels: '1', sample_format: 's16le', ...(options.language ? { language: options.language } : {}) })) url.searchParams.set(key, value);
    return transcribeStream(url, { signal, onUpdate });
  }
  async transcribe(model, input, options, signal) {
    await this.prepare(model, options, signal); signal?.throwIfAborted();
    const form = new FormData();
    form.append('model', 'active'); form.append('file', new Blob([await fs.readFile(input)], { type: 'audio/wav' }), 'input.wav');
    if (options.language) form.append('language', options.language);
    if (options.requestOptions) form.append('options', JSON.stringify(options.requestOptions));
    const abort = () => { void this.stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${this.url}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || result.error || `语音服务 HTTP ${response.status}`);
      return result.text;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  async synthesize(model, text, reference, options, signal) {
    await this.prepare(model, options, signal); signal?.throwIfAborted();
    const abort = () => { void this.stop(); }; signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(this.url + '/v1/audio/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'active', input: text, voice_ref: reference, reference_text: options.referenceText,
          response_format: 'wav', max_tokens: options.maxTokens || 256, seed: 1234,
          options: { ...(options.language ? { language: options.language } : {}), ...options.requestOptions } }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
      });
      if (!response.ok) throw new Error('语音合成 HTTP ' + response.status + '：' + (await response.text()).slice(0, 1500));
      return Buffer.from(await response.arrayBuffer());
    } finally { signal?.removeEventListener('abort', abort); }
  }
  async stop() {
    const child = this.child; this.child = null; this.signature = null;
    if (child && child.exitCode === null) { child.kill(); await this.closed; }
  }
}
module.exports = { AudioCpp };
