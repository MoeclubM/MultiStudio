const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { ApiServer } = require('../api-server.cjs');
const { SpeechService } = require('../speech.cjs');
const { Workflows } = require('../workflows.cjs');
const { nodeRegistry } = require('../node-registry.cjs');

function graph(inputKind, outputKind) {
  const nodes = [inputKind, outputKind].map(kind => ({ id: randomUUID(), type: 'studio', position: { x: 0, y: 0 }, data: { kind, label: nodeRegistry.definitions[kind].label, config: { ...nodeRegistry.definitions[kind].defaults } } }));
  const type = nodeRegistry.definitions[inputKind].output;
  return { version: 1, id: randomUUID(), name: 'API', nodes, edges: [{ id: randomUUID(), source: nodes[0].id, target: nodes[1].id, sourceHandle: type, targetHandle: type }] };
}
function wav() {
  const buffer = Buffer.alloc(364);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(320, 40);
  return buffer;
}
test('local API binds workflow inputs, returns text/audio, streams results and protects access', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-api-'));
  const speech = new SpeechService(directory);
  let api;
  const workflows = new Workflows(directory, { speech, emit: (event, value) => api?.publish(event, value) });
  await workflows.ready;
  api = new ApiServer(directory, { speech, workflows,
    start: async workflow => {
      if (workflows.active || workflows.live) throw Object.assign(new Error('busy'), { status: 409 });
      return { run: workflows.start(workflow) };
    }, cancel: async id => workflows.live ? workflows.live.end() : workflows.cancel(id),
  });
  t.after(async () => { await api.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  await api.ready;
  assert.equal(api.snapshot().running, false);
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  await api.configure({ enabled: true, port }); assert.equal(api.snapshot().running, true);
  const base = api.snapshot().url;
  const request = (route, init = {}) => fetch(base + route, { ...init, headers: { Authorization: 'Bearer ' + api.token, ...init.headers } });
  const post = (route, value) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await fetch(base + '/workflows')).status, 401);
  const saved = graph('text-input', 'text-output'); await workflows.save(saved);
  const catalog = await (await request('/workflows')).json();
  assert.equal(catalog.workflows[0].inputs[0].acceptsInput, true);
  const started = await post('/runs', { workflowId: saved.id, inputs: { [saved.nodes[0].id]: { text: '你好，外部程序。' } } });
  assert.equal(started.status, 202); const run = await started.json(); await workflows.execution;
  const result = await (await request('/runs/' + run.id)).json();
  assert.equal(result.status, 'completed'); assert.equal(result.outputs[0].text, '你好，外部程序。');
  assert.equal(workflows.get(saved.id).nodes[0].data.config.text, '');
  const text = await request(result.outputs[0].url.replace('/v1', ''));
  assert.match(text.headers.get('content-type'), /text\/plain/); assert.equal(await text.text(), '你好，外部程序。');
  const completedEvents = await (await request('/runs/' + run.id + '/events')).text();
  assert.match(completedEvents, /event: run/); assert.match(completedEvents, /你好，外部程序/);
  assert.equal((await post('/runs', { workflowId: saved.id, inputs: { [saved.nodes[1].id]: { text: '拒绝修改输出' } } })).status, 400);
  const audio = wav();
  const uploaded = await request('/audio', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio });
  assert.equal(uploaded.status, 201); const asset = await uploaded.json();
  const audioGraph = graph('audio-input', 'audio-output'); await workflows.save(audioGraph);
  const audioRun = await (await post('/runs', { workflowId: audioGraph.id, inputs: { [audioGraph.nodes[0].id]: { audioId: asset.audioId } } })).json();
  await workflows.execution;
  const audioResult = await (await request('/runs/' + audioRun.id)).json();
  assert.equal(audioResult.outputs[0].type, 'audio');
  const downloaded = await request(audioResult.outputs[0].url.replace('/v1', ''));
  assert.equal(downloaded.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), audio);
  assert.deepEqual(Buffer.from(await (await request('/audio/' + asset.audioId)).arrayBuffer()), audio);
  assert.equal((await request('/audio/not-an-id')).status, 400);
  const live = workflows.beginLive(saved);
  const events = await request('/runs/' + live.run.id + '/events'); const reader = events.body.getReader();
  await reader.read();
  await live.preview(saved.nodes[0], { type: 'text', text: '实时字幕', partial: true }, { id: randomUUID(), startedAt: new Date().toISOString() });
  assert.equal((await post('/runs', { workflowId: saved.id })).status, 409);
  await new Promise(resolve => setTimeout(resolve, 70));
  const update = new TextDecoder().decode((await reader.read()).value); assert.match(update, /实时字幕/);
  const cancelled = await (await post('/runs/' + live.run.id + '/cancel', {})).json();
  assert.equal(cancelled.status, 'cancelled'); await reader.cancel();
  const previousToken = api.token; await api.configure({ regenerateToken: true });
  assert.notEqual(api.token, previousToken);
  assert.equal((await fetch(base + '/health', { headers: { Authorization: 'Bearer ' + previousToken } })).status, 401);
  assert.equal((await request('/health')).status, 200);
  await api.configure({ enabled: false }); assert.equal(api.snapshot().running, false);
});
