const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson, secretStore } = require('./storage.cjs');
const AUDIO_LIMIT = 25 * 1024 * 1024;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DEFAULT_SPEECH = { baseUrl: '', asrModel: 'whisper-1', ttsModel: 'tts-1', voice: 'alloy' };
function audioPath(directory, id) {
  if (!ID.test(id || '')) throw new Error('音频 ID 无效');
  return path.join(directory, id + '.wav');
}
function audioUrl(id) { return `prism://app/__audio/${id}.wav`; }
function validateBase(value) {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入 HTTP(S) 服务地址');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('远程模型服务需要 HTTPS');
  return url.href.replace(/\/+$/, '');
}
function wave(buffer) {
  if (buffer.length < 44 || buffer.length > AUDIO_LIMIT || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('需要有效 WAV 音频，大小不超过 25 MB');
}
class SpeechService {
  constructor(directory, { safeStorage } = {}) {
    this.directory = path.join(directory, 'audio'); this.file = path.join(directory, 'speech-settings.json');
    this.secrets = secretStore(safeStorage); this.ready = this.open();
  }
  async open() {
    await fs.mkdir(this.directory, { recursive: true });
    const saved = await readJson(this.file, {});
    this.settings = Object.fromEntries(Object.entries(DEFAULT_SPEECH).map(([key, value]) => [key, saved[key] ?? value]));
    this.apiKey = this.secrets.decode(saved.encryptedKey);
  }
  snapshot() { return { ...this.settings, hasApiKey: !!this.apiKey, keyPersistent: this.secrets.available() }; }
  async configure(patch) {
    await this.ready;
    const next = { ...this.settings };
    for (const key of Object.keys(DEFAULT_SPEECH)) if (patch[key] !== undefined) next[key] = String(patch[key]).trim();
    next.baseUrl = validateBase(next.baseUrl);
    if (patch.apiKey !== undefined) this.apiKey = patch.apiKey.trim();
    await writeJson(this.file, { ...next, encryptedKey: this.secrets.encode(this.apiKey) });
    this.settings = next; return this.snapshot();
  }
  async saveInput(bytes) {
    await this.ready;
    const buffer = Buffer.from(bytes); wave(buffer);
    const id = randomUUID(); await fs.writeFile(audioPath(this.directory, id), buffer, { flag: 'wx' });
    return { id, url: audioUrl(id) };
  }
  async validateAudio(id) {
    await this.ready; const file = audioPath(this.directory, id);
    if (!(await fs.stat(file)).isFile()) throw new Error('音频文件已移除');
    return file;
  }
}
module.exports = { SpeechService, DEFAULT_SPEECH, audioPath, audioUrl, validateBase, wave, AUDIO_LIMIT, ID };
