const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { SpeechService, audioPath, validateBase } = require('../speech.cjs');
const { Conversations } = require('../conversations.cjs');
const { backends } = require('../../plugins/openai/index.cjs');
function wav() { const b = Buffer.alloc(44 + 320); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(320, 40); return b; }
async function setup(t, options = {}) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-speech-')); const service = new SpeechService(directory, options); await service.ready; t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); }); return { service, directory }; }
test('API plugin keeps credentials out of model nodes and exported settings', async t => {
  const requests = [], { service, directory } = await setup(t);
  await service.configure({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'private-test-key' });
  const api = backends.openai.create({ speech: service, backend: { config: { llm: {} } }, fetcher: async (url, init) => {
    requests.push({ url, init }); assert.equal(init.headers.Authorization, 'Bearer private-test-key');
    return url.endsWith('transcriptions') ? Response.json({ text: '识别文字' }) : new Response(wav());
  } });
  const input = await service.saveInput(wav());
  assert.equal(await api.transcribe({ model: 'asr', language: 'zh' }, input.id), '识别文字');
  const output = await api.synthesize({ model: 'tts', voice: 'voice', speed: 1 }, '你好');
  assert.deepEqual(await fs.readFile(audioPath(service.directory, output)), wav());
  assert.equal(requests[0].init.body.get('language'), 'zh');
  assert.ok(!(await fs.readFile(path.join(directory, 'speech-settings.json'), 'utf8')).includes('private-test-key'));
  api.stop();
});
test('audio storage accepts WAV and prevents invalid IDs and service URLs', async t => {
  const { service } = await setup(t);
  for (const url of ['http://remote.example/v1', 'file:///secret', 'https://user:pass@host/v1', 'https://host/v1?secret=1']) assert.throws(() => validateBase(url));
  assert.throws(() => audioPath(service.directory, '../file'));
  await assert.rejects(service.saveInput(Buffer.alloc(10)), /WAV/);
});
test('conversations save/reload, recover interrupted work and delete only records', async t => {
  const { directory, service } = await setup(t); const audio = await service.saveInput(wav());
  const conversations = new Conversations(directory); const id = randomUUID(); const now = new Date().toISOString();
  const value = { id, title: '会话', mode: 'asr', createdAt: now, updatedAt: now, messages: [{ id: randomUUID(), role: 'user', content: '录音', audioId: audio.id, status: 'complete', createdAt: now }, { id: randomUUID(), role: 'assistant', content: '', status: 'pending', createdAt: now }] };
  await conversations.save(value);
  const reopened = new Conversations(directory); assert.equal((await reopened.list())[0].count, 2); assert.equal((await reopened.get(id)).messages[1].status, 'interrupted');
  await assert.rejects(reopened.save({ ...value, messages: [{ ...value.messages[0], role: 'system' }] }), /消息/);
  await reopened.delete(id); assert.equal((await reopened.list()).length, 0); assert.deepEqual(await fs.readFile(audioPath(service.directory, audio.id)), wav());
});
module.exports = { wav };
