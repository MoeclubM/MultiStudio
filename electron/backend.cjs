const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class NativeBackend extends EventEmitter {
  constructor(executable, dataDir, options = {}) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.stopping = false;
    const environment = { ...(options.env ?? process.env) };
    this.child = spawn(executable, ['--data-dir', dataDir], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: environment,
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyTimer = setTimeout(() => this.fail(new Error('本地后端启动超时')), 15000);
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) { this.fail(new Error('后端响应超过限制')); this.child.kill(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); }
        catch { this.emit('diagnostic', '原生运行库输出了非协议日志'); continue; }
        if (message.event === 'backend-ready') {
          if (message.payload?.protocolVersion !== 1) { this.fail(new Error('后端协议版本不匹配')); this.child.kill(); return; }
          clearTimeout(this.readyTimer);
          this.resolveReady();
        } else if (typeof message.event === 'string') {
          this.emit('event', message.event, message.payload);
        } else if (Number.isSafeInteger(message.id)) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message ?? '后端命令失败'));
          else pending.resolve(message.result);
        }
      }
    });
    // Native engines log to stderr; never mirror prompts/config/API keys to the UI.
    this.child.stderr.on('data', (chunk) => this.emit('diagnostic', chunk.toString()));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.once('error', (error) => this.fail(new Error(`无法启动本地后端：${error.message}`)));
    this.exited = new Promise((resolve) => this.child.once('close', (code, signal) => {
      this.fail(new Error(`本地后端已退出（${code ?? signal}），请重新启动应用`));
      resolve();
    }));
  }

  fail(error) {
    this.failure = error;
    clearTimeout(this.readyTimer);
    this.rejectReady(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!this.stopping) this.emit('failure', error.message);
  }

  async invoke(command, args = {}, timeout = 10 * 60 * 1000) {
    await this.ready;
    if (this.failure || this.stopping || this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
      throw new Error('本地后端不可用，请重新启动应用');
    }
    if (this.pending.size >= 128) throw new Error('后端任务队列已满，请稍后再试');
    const id = ++this.sequence;
    const frame = JSON.stringify({ id, command, args }) + '\n';
    if (Buffer.byteLength(frame) > 2 * 1024 * 1024) throw new Error('命令数据超过限制');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('后端任务超时')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(frame, (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  async stop() {
    if (this.stopping) return this.exited;
    this.stopping = true;
    const force = setTimeout(() => this.child.kill(), 6500);
    if (this.child.stdin.writable) this.child.stdin.end(JSON.stringify({ id: 0, command: '__shutdown' }) + '\n');
    await this.exited;
    clearTimeout(force);
  }
}
module.exports = { NativeBackend };
