const { randomUUID } = require('node:crypto');

// Audio is delivered immediately. Silence closes an utterance; it never delays deltas.
class Utterances {
  constructor({ open, onFinal, onError }) {
    Object.assign(this, { open, onFinal, onError });
    this.tail = Promise.resolve(); this.preRoll = []; this.accepting = true;
  }
  push(samples) {
    if (!this.accepting) return;
    this.tail = this.tail.then(() => this.consume(samples)).catch(error => { this.accepting = false; this.onError(error); });
  }
  async consume(samples) {
    if (this.cancelled) return;
    const voiced = Math.sqrt(samples.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / samples.length) >= .006;
    if (voiced) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.tail = this.tail.then(() => this.flush()).catch(error => this.onError(error)); }, 900);
    }
    if (!this.stream) {
      this.preRoll.push(samples); if (this.preRoll.length > 3) this.preRoll.shift();
      if (!voiced) return;
      this.utterance = { id: randomUUID(), startedAt: new Date().toISOString() };
      this.stream = await this.open(this.utterance); this.silence = 0; this.length = 0;
      this.stream.done.catch(error => { this.accepting = false; this.onError(error); });
      for (const frame of this.preRoll) this.stream.write(frame);
      this.preRoll = []; return;
    }
    this.stream.write(samples); this.length += samples.length;
    this.silence = voiced ? 0 : this.silence + samples.length;
    if (this.silence >= 14400 || this.length >= 80 * 16000) await this.flush();
  }
  async flush() {
    if (!this.stream) return;
    clearTimeout(this.timer);
    const stream = this.stream, utterance = this.utterance; this.stream = null;
    const result = await stream.finish(); await this.onFinal(result, utterance);
  }
  async finish() { clearTimeout(this.timer); this.accepting = false; await this.tail; await this.flush(); }
  cancel() { clearTimeout(this.timer); this.cancelled = true; this.accepting = false; this.stream?.cancel(); this.stream = null; }
}
function wave(samples) {
  const size = samples.reduce((sum, frame) => sum + frame.length, 0) * 2, bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(size + 36, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  let position = 44; for (const frame of samples) for (const sample of frame) { bytes.writeInt16LE(sample, position); position += 2; }
  return bytes;
}
module.exports = { Utterances, wave };
