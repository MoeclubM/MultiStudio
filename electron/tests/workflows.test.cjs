const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spec, validateWorkflow } = require('../workflow-graph.cjs');
const { Workflows } = require('../workflows.cjs');
const { Inference } = require('../inference.cjs');
const { SpeechService } = require('../speech.cjs');
function node(kind, config = {}) { return { id: randomUUID(), type: 'studio', position: { x: 0, y: 0 }, data: { kind, label: spec[kind].label, config: { ...spec[kind].defaults, ...config } } }; }
function edge(from, to) { return { id: randomUUID(), source: from.id, target: to.id, sourceHandle: spec[from.data.kind].output, targetHandle: spec[to.data.kind].input }; }
function graph(nodes, edges = nodes.slice(1).map((n, i) => edge(nodes[i], n))) { return { version: 1, id: randomUUID(), name: '测试工作流', nodes, edges }; }
function wav() { const b = Buffer.alloc(364); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(320, 40); return b; }
async function setup(t, fetcher) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-workflow-'));
  let textCalls = 0;
  const backend = { config: { llm: { baseUrl: 'http://127.0.0.1:8000/v1', llmModel: 'global-text', apiKey: 'private-text-key' } }, invoke: async (command, args) => {
    if (command === 'pipeline_status') return 'idle';
    if (command === 'get_config') return { llm: { baseUrl: 'http://127.0.0.1:8000/v1', llmModel: 'global-text', apiKey: 'private-text-key' } };
    if (command === 'workflow_generate_local') { textCalls++; return `本地:${args.modelId}`; }
    if (command === 'get_model_library') return { engine: { activeModelId: 'current' }, models: [{ id: 'node-model', loadable: true, installed: true }] };
    throw new Error(command);
  } };
  const events = [], requests = [];
  const fetch = fetcher || (async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('transcriptions')) { assert.equal(init.body.get('model'), 'node-asr'); assert.equal(init.headers.Authorization, 'Bearer private-speech-key'); return Response.json({ text: '你好世界' }); }
    if (url.endsWith('speech')) return new Response(wav());
    textCalls++; assert.equal(JSON.parse(init.body).stream, false); return Response.json({ choices: [{ message: { content: 'Hello world' } }] });
  });
  const speech = new SpeechService(directory, { backend, fetcher: fetch }); await speech.ready;
  await speech.configure({ baseUrl: 'http://127.0.0.1:8000/v1', asrModel: 'global-asr', ttsModel: 'global-tts', voice: 'global-voice', apiKey: 'private-speech-key' });
  let flows;
  const inference = new Inference({ backend, speech, fetcher: (...args) => flows.fetcher(...args) });
  inference.instances.set('llmcore', {
    preflight: async () => {},
    generate: args => backend.invoke('workflow_generate_local', args),
  });
  inference.instances.set('audiocpp', { preflight: async () => {}, transcribe: async () => '' });
  flows = new Workflows(directory, { backend, speech, inference, fetcher: fetch, emit: (_, run) => events.push(run) }); await flows.ready;
  t.after(async () => { flows.stop(); await flows.execution; await inference.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { flows, speech, backend, directory, requests, events, textCalls: () => textCalls };
}
test('typed DAG validation rejects loops, duplicate inputs, malformed config and secret fields', () => {
  const input = node('text-input', { text: 'hello' }), a = node('openai.translate'), b = node('llmcore.text'), out = node('text-output');
  assert.throws(() => validateWorkflow(graph([a, b], [edge(a, b), edge(b, a)])), /循环/);
  assert.throws(() => validateWorkflow(graph([input, a, out], [edge(input, out), edge(a, out)])), /一条连线/);
  assert.throws(() => validateWorkflow(graph([input, node('openai.asr')])), /相同类型/);
  assert.throws(() => validateWorkflow(graph([node('openai.translate', { apiKey: 'private' })])), /密钥/);
  assert.throws(() => validateWorkflow(graph([node('openai.translate', { temperature: NaN })])), /范围/);
  assert.throws(() => validateWorkflow(graph([node('openai.tts', { speed: '1' })])), /无效/);
  const invalid = node('text-input'); invalid.data.kind = 'toString';
  assert.throws(() => validateWorkflow(graph([invalid])), /插件缺失/);
  const flow = graph([input, a, b, out]); flow.edges[1].id = flow.edges[0].id; assert.throws(() => validateWorkflow(flow), /重复/);
  assert.throws(() => validateWorkflow(graph([input, a]), true), /输出/);
  assert.throws(() => validateWorkflow(graph([out], []), true), /缺少输入/);
  assert.throws(() => validateWorkflow(graph([node('text-input'), out]), true), /输入为空/);
  assert.throws(() => validateWorkflow(graph(Array.from({ length: 6 }, () => node('text-input', { text: '汉'.repeat(32000) })), [])), /500 KB/);
});
test('only output ancestors execute, with deterministic topological order and fan-out', () => {
  const input = node('text-input', { text: 'hello' }), a = node('openai.translate'), out = node('text-output'), other = node('text-output'), unused = node('openai.tts');
  const plan = validateWorkflow(graph([out, a, input, other, unused], [edge(input, a), edge(a, out), edge(a, other)]), true);
  assert.deepEqual(plan.order.map(n => n.id), [input.id, a.id, out.id, other.id]); assert.deepEqual(plan.unused, [unused.id]);
});
test('ASR → translation → TTS runs with per-node models, preserves global settings, saves/reloads', async t => {
  const { flows, speech, directory, requests, textCalls } = await setup(t);
  const audio = await speech.saveInput(wav()); const before = speech.snapshot();
  const nodes = [node('audio-input', { audioId: audio.id }), node('openai.asr', { model: 'node-asr' }), node('openai.translate', { model: 'node-text', targetLanguage: '英语' }), node('openai.tts', { model: 'node-tts', voice: 'node-voice', speed: 1.25 }), node('audio-output')];
  const flow = graph(nodes); await flows.save(flow); flows.start(flow); assert.throws(() => flows.start(flow), /已有工作流/); await assert.rejects(flows.delete(flow.id), /正在运行/); await flows.execution;
  const run = flows.status(); assert.equal(run.status, 'completed'); assert.equal(textCalls(), 1); assert.equal(run.nodes[nodes[2].id].output.text, 'Hello world');
  const tts = JSON.parse(requests.find(r => r.url.endsWith('speech')).init.body); assert.deepEqual(tts, { model: 'node-tts', input: 'Hello world', voice: 'node-voice', speed: 1.25, response_format: 'wav' });
  const text = requests.find(r => r.url.endsWith('completions')); assert.equal(JSON.parse(text.init.body).model, 'node-text'); assert.equal(text.init.headers.Authorization, 'Bearer private-text-key'); assert.ok(JSON.parse(text.init.body).messages[0].content.includes('英语'));
  assert.deepEqual(speech.snapshot(), before); assert.equal(run.nodes[nodes[4].id].output.audioId, run.nodes[nodes[3].id].output.audioId);
  const reopened = new Workflows(directory); await reopened.ready; assert.equal(reopened.list().length, 1); assert.equal(reopened.status().status, 'completed');
  await reopened.delete(flow.id); assert.equal(reopened.list().length, 0); await fs.stat(await speech.validateAudio(run.nodes[nodes[4].id].output.audioId));
  assert.ok(!(await fs.readFile(flows.file, 'utf8')).includes('private'));
});
test('local text node uses exact model once for two outputs, skips disconnected nodes', async t => {
  const { flows, textCalls } = await setup(t); const input = node('text-input', { text: 'hello' }), model = node('llmcore.text', { modelId: 'node-model' }), a = node('text-output'), b = node('text-output'), unused = node('openai.asr');
  const flow = graph([input, model, a, b, unused], [edge(input, model), edge(model, a), edge(model, b)]); flows.start(flow); await flows.execution;
  const run = flows.status(); assert.equal(run.status, 'completed'); assert.equal(textCalls(), 1); assert.equal(run.nodes[a.id].output.text, '本地:node-model'); assert.deepEqual(run.nodes[a.id].output, run.nodes[b.id].output); assert.equal(run.nodes[unused.id].status, 'skipped');
});
test('audio backend nodes keep model parameters and share normal downstream outputs', async t => {
  const { flows, speech, requests, textCalls } = await setup(t);
  const input = await speech.saveInput(wav()); let parameters;
  flows.inference.instances.get('audiocpp').transcribe = async (config, audioId) => { parameters = { config, audioId }; return '本地转写'; };
  const nodes = [node('audio-input', { audioId: input.id }), node('audiocpp.asr', { modelPath: 'D:/model.gguf', threads: 2, device: 'cpu' }), node('openai.tts'), node('audio-output')];
  flows.start(graph(nodes)); await flows.execution;
  assert.equal(flows.status().status, 'completed'); assert.equal(parameters.config.threads, 2);
  assert.equal(parameters.audioId, input.id); assert.equal(textCalls(), 0);
  assert.equal(JSON.parse(requests[0].init.body).input, '本地转写');
});
test('native cancellation waits for the current inference then skips downstream nodes', async t => {
  const { flows, backend } = await setup(t); let release, entered;
  const ready = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; }); const original = backend.invoke;
  backend.invoke = async (command, args) => { if (command === 'workflow_generate_local') { entered(); await gate; return 'native fixture'; } return await original(command, args); };
  const nodes = [node('text-input', { text: 'hi' }), node('llmcore.text', { modelId: 'node-model', rememberHistory: true }), node('text-output')];
  const initial = flows.start(graph(nodes)); await ready; const execution = flows.execution;
  flows.cancel(initial.id); assert.equal(flows.status().status, 'cancelling'); assert.equal(flows.status().nodes[nodes[1].id].status, 'running');
  release(); await execution; assert.equal(flows.status().status, 'cancelled'); assert.equal(flows.status().nodes[nodes[2].id].status, 'skipped'); assert.deepEqual(flows.getContext(initial.workflowId, nodes[1].id), []);
});
test('preflight fails before any inference; failed nodes skip downstream outputs', async t => {
  const { flows, speech, textCalls } = await setup(t); const input = node('text-input', { text: 'hello' }), model = node('openai.translate'), tts = node('openai.tts'), out = node('audio-output');
  await speech.configure({ baseUrl: '' }); flows.start(graph([input, model, tts, out])); await flows.execution;
  assert.equal(flows.status().status, 'failed'); assert.match(flows.status().error, /API 合成.*服务/); assert.equal(textCalls(), 0);
  await speech.configure({ baseUrl: 'http://127.0.0.1:8000/v1' }); flows.fetcher = async () => new Response('secret-server-details', { status: 403 });
  flows.start(graph([input, model, tts, out])); await flows.execution;
  const run = flows.status(); assert.equal(run.nodes[model.id].status, 'error'); assert.equal(run.nodes[out.id].status, 'skipped'); assert.match(run.error, /HTTP 403/); assert.ok(!run.error.includes('secret-server'));
});
test('cancellation aborts API request and skips descendants; restart marks interrupted runs', async t => {
  let entered; const ready = new Promise(r => { entered = r; });
  const { flows, directory } = await setup(t, async (_, init) => { entered(); return await new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); }); });
  const nodes = [node('text-input', { text: 'hi' }), node('openai.translate'), node('text-output')]; const flow = graph(nodes); const initial = flows.start(flow); await ready;
  const execution = flows.execution; assert.equal(flows.cancel(initial.id).status, 'cancelling'); await execution;
  assert.equal(flows.status().status, 'cancelled'); assert.equal(flows.status().nodes[nodes[2].id].status, 'skipped');
  const interrupted = { ...initial, nodes: { [nodes[0].id]: { status: 'running' }, [nodes[1].id]: { status: 'idle' } } }; await fs.writeFile(flows.runsFile, JSON.stringify([interrupted]));
  const reopened = new Workflows(directory); await reopened.ready; assert.equal(reopened.status().status, 'interrupted'); assert.equal(reopened.status().nodes[nodes[0].id].status, 'interrupted'); assert.equal(reopened.status().nodes[nodes[1].id].status, 'skipped');
});
test('dialogue is an ordinary model node: persists turns, shares downstream TTS and resets on model change', async t => {
  const { flows, directory, requests } = await setup(t);
  const input = node('text-input', { text: '第一轮' }), model = node('openai.text', { rememberHistory: true, prompt: '{input}', systemPrompt: '你是助手', historyLimit: 2 }), out = node('text-output');
  const flow = graph([input, model, out]); flows.start(flow); await flows.execution;
  input.data.config.text = '第二轮'; flows.start(flow); await flows.execution;
  const second = JSON.parse(requests.filter(r => r.url.endsWith('completions')).at(-1).init.body);
  assert.deepEqual(second.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']); assert.equal(second.messages[1].content, '第一轮');
  const reopened = new Workflows(directory, { backend: flows.backend, speech: flows.speech, inference: flows.inference, fetcher: flows.fetcher }); await reopened.ready;
  assert.equal(reopened.getContext(flow.id, model.id).length, 4);
  model.data.config.model = 'different-model'; reopened.start(flow); await reopened.execution;
  assert.equal(JSON.parse(requests.at(-1).init.body).messages.length, 2); assert.equal(reopened.getContext(flow.id, model.id).length, 2);
  await reopened.clearContext(flow.id, model.id); assert.deepEqual(reopened.getContext(flow.id, model.id), []);
  assert.ok(!(await fs.readFile(reopened.contextFile, 'utf8')).includes('private-text-key'));
});
test('context is isolated by workflow/node and one-shot nodes never remember', async t => {
  const { flows, requests } = await setup(t);
  const input = node('text-input', { text: 'hi' }), model = node('openai.text', { rememberHistory: true }), out = node('text-output'); const flow = graph([input, model, out]);
  flows.start(flow); await flows.execution; const other = { ...flow, id: randomUUID() }; flows.start(other); await flows.execution;
  assert.equal(JSON.parse(requests.at(-1).init.body).messages.length, 1); assert.equal(flows.getContext(flow.id, model.id).length, 2); assert.equal(flows.getContext(other.id, model.id).length, 2);
  model.data.config.rememberHistory = false; flows.start(flow); await flows.execution; assert.equal(JSON.parse(requests.at(-1).init.body).messages.length, 1); assert.equal(flows.getContext(flow.id, model.id).length, 2);
  assert.throws(() => flows.getContext('../x', model.id), /ID/);
});
test('run archive stores the executed graph snapshot and subtitle output uses only its upstream branch', async t => {
  const { flows, events } = await setup(t); flows.outputs = { publish: async (node, output, run) => events.push({ text: output.text, nodeId: node.id, runId: run.id }) }; const input = node('text-input', { text: '工作流字幕' }), out = node('desktop-output'); const flow = graph([input, out]);
  flows.start(flow); await flows.execution; input.data.config.text = 'later edits';
  const summary = flows.listRuns()[0], run = flows.getRun(summary.id);
  assert.equal(summary.workflow, undefined); assert.equal(run.workflow.nodes[0].data.config.text, '工作流字幕'); assert.equal(run.nodes[out.id].output.text, '工作流字幕');
  assert.ok(events.some(e => e.text === '工作流字幕' && e.nodeId === out.id && e.runId === summary.id));
});
