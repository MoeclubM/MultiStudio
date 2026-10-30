const path = require('node:path');
const { fork } = require('node:child_process');

class LocalSpeech {
  constructor({ modulePath = require.resolve('sherpa-onnx-node'), workerPath = path.join(__dirname, 'speech-worker.cjs'), createWorker = file => fork(file, [], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }) } = {}) {
    this.createWorker = createWorker; this.modulePath = modulePath; this.workerPath = workerPath; this.nextId = 0; this.pending = new Map();
  }
  async run(task, args, signal) {
    signal?.throwIfAborted();
    if (this.pending.size) throw new Error('本地语音引擎正在处理另一项任务');
    if (!this.worker) {
      const worker = this.worker = this.createWorker(this.workerPath);
      worker.stdout?.resume(); worker.stderr?.resume();
      this.post = message => worker.postMessage ? worker.postMessage(message) : worker.send(message);
      this.post({ type: 'initialize', modulePath: this.modulePath });
      worker.on('message', ({ id, result, error }) => { const pending = this.pending.get(id); if (pending) { this.pending.delete(id); pending.cleanup(); error ? pending.reject(new Error(error)) : pending.resolve(result); } });
      worker.on('error', error => this.fail(error));
      worker.on('exit', code => { if (this.worker === worker) { this.worker = null; this.fail(new Error(`本地语音进程已结束（${code}）`)); } });
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => { this.fail(new Error('已停止本地语音任务')); void this.stop(); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.pending.set(id, { resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
      this.post({ id, task, ...args });
    });
  }
  fail(error) { for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); } this.pending.clear(); }
  async stop() { const worker = this.worker; this.worker = null; this.fail(new Error('本地语音任务已停止')); worker?.kill(); }
}
module.exports = { LocalSpeech };
