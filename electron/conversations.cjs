const path = require('node:path');
const { readJson, writeJson } = require('./storage.cjs');
const { ID } = require('./speech.cjs');
function validateConversation(value) {
  if (!value || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.title !== 'string' || value.title.length > 120 || !['text', 'asr', 'tts'].includes(value.mode) || !Array.isArray(value.messages) || value.messages.length > 100 || JSON.stringify(value).length > 600000 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('会话数据超出范围');
  for (const m of value.messages) {
    if (!m || typeof m.id !== 'string' || !ID.test(m.id) || !['user', 'assistant'].includes(m.role) || !['complete', 'pending', 'error', 'interrupted'].includes(m.status) || typeof m.content !== 'string' || m.content.length > 131072 || (m.audioId && !ID.test(m.audioId)) || (m.error && (typeof m.error !== 'string' || m.error.length > 4096)) || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))) throw new Error('消息数据无效');
  }
  return { id: value.id, title: value.title, mode: value.mode, createdAt: value.createdAt, updatedAt: new Date().toISOString(), messages: value.messages.map(m => ({ id: m.id, role: m.role, content: m.content, audioId: m.audioId ?? null, status: m.status === 'pending' ? 'interrupted' : m.status, error: m.error ?? null, model: typeof m.model === 'string' ? m.model.slice(0, 200) : '', createdAt: m.createdAt })) };
}
class Conversations {
  constructor(dataDir) { this.file = path.join(dataDir, 'conversations.json'); this.queue = Promise.resolve(); this.ready = this.open(); }
  async open() { this.items = await readJson(this.file, []); }
  async list() { await this.ready; return this.items.map(({ messages, ...item }) => ({ ...item, count: messages.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async get(id) { await this.ready; if (!ID.test(id)) throw new Error('会话 ID 无效'); return this.items.find(c => c.id === id) ?? null; }
  async mutate(operation) {
    await this.ready;
    const job = this.queue.then(async () => { const items = operation(this.items); await writeJson(this.file, items); this.items = items; });
    this.queue = job.catch(() => {}); await job;
  }
  async save(value) {
    const entry = validateConversation(value);
    await this.mutate(items => { if (!items.some(c => c.id === entry.id) && items.length >= 100) throw new Error('会话最多保存 100 个，请先删除不需要的会话'); return [entry, ...items.filter(c => c.id !== entry.id)]; });
    return { ...entry, messages: value.messages };
  }
  async delete(id) { if (!ID.test(id)) throw new Error('会话 ID 无效'); await this.mutate(items => items.filter(c => c.id !== id)); }
}
module.exports = { Conversations, validateConversation };
