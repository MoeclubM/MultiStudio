const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { buildSync } = require('esbuild');
// Test the renderer's actual pure TS graph helpers with the existing Vite bundler.
const bundled = buildSync({ entryPoints: [path.resolve('src/lib/workflows.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const moduleContext = { exports: {} };
vm.runInNewContext(bundled, { module: moduleContext, exports: moduleContext.exports, crypto: { randomUUID }, TextEncoder });
const { makeNode, makeTemplate, connectionEdges, parseWorkflow, serializeWorkflow, installCatalog } = moduleContext.exports;
installCatalog(require('../node-registry.cjs').nodeRegistry.catalog());
const edge = (source, target) => ({ id: randomUUID(), source: source.id, target: target.id, sourceHandle: 'audio', targetHandle: 'audio' });
const connect = (source, target) => ({ source: source.id, target: target.id, sourceHandle: 'audio', targetHandle: 'audio' });
test('plugging into an occupied input replaces only its wire and preserves both audio references', () => {
  const a = makeNode('audio-input'), b = makeNode('audio-input'), asr = makeNode('openai.asr'); a.data.config.audioId = randomUUID(); b.data.config.audioId = randomUUID();
  const original = [edge(a, asr)], next = connectionEdges(connect(b, asr), [a, b, asr], original);
  assert.equal(next.length, 1); assert.equal(next[0].source, b.id); assert.equal(original[0].source, a.id); assert.ok(a.data.config.audioId); assert.ok(b.data.config.audioId);
});
test('reconnecting preserves edge identity and other output branches', () => {
  const a = makeNode('audio-input'), b = makeNode('audio-input'), asr = makeNode('openai.asr'), out = makeNode('audio-output'); const wire = edge(a, asr), branch = edge(a, out);
  const next = connectionEdges(connect(b, asr), [a, b, asr, out], [wire, branch], wire.id);
  assert.equal(next.length, 2); assert.equal(next.find(e => e.id === wire.id).source, b.id); assert.equal(next.find(e => e.id === branch.id).source, a.id);
});
test('invalid type and cycle connections do not destroy the existing wire', () => {
  const a = makeNode('audio-input'), text = makeNode('text-input'), asr = makeNode('openai.asr'), wire = edge(a, asr);
  assert.equal(connectionEdges({ ...connect(text, asr), sourceHandle: 'text' }, [a, text, asr], [wire], wire.id), null); assert.equal(wire.source, a.id);
  const x = makeNode('openai.text'), y = makeNode('openai.text'), input = makeNode('text-input');
  const original = [{ id: randomUUID(), source: input.id, target: x.id, sourceHandle: 'text', targetHandle: 'text' }, { id: randomUUID(), source: x.id, target: y.id, sourceHandle: 'text', targetHandle: 'text' }];
  assert.equal(connectionEdges({ source: y.id, target: x.id, sourceHandle: 'text', targetHandle: 'text' }, [input, x, y], original), null); assert.equal(original.length, 2);
});
test('audio metadata round-trips and plugin defaults are restored for omitted fields', () => {
  const graph = makeTemplate('sherpa.transcribe'), input = graph.nodes[0]; input.data.config.audioId = randomUUID(); input.data.config.filename = 'fixture.wav'; input.data.config.duration = 1.25;
  const imported = parseWorkflow(JSON.parse(JSON.stringify(serializeWorkflow(graph)))); assert.equal(imported.nodes[0].data.config.duration, 1.25); assert.equal(imported.nodes[0].data.config.audioId, input.data.config.audioId);
  delete input.data.config.duration; assert.equal(parseWorkflow(graph).nodes[0].data.config.duration, 0);
  input.data.config.apiKey = 'private'; assert.throws(() => parseWorkflow(graph), /未知配置/);
});
