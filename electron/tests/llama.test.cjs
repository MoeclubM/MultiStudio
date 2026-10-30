const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LlamaServer } = require('../../plugins/llmcore/runtime.cjs');

test('official llama.cpp transport keeps message roles, supports streaming and aborts generation', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.once('end', () => {
      const value = JSON.parse(body); requests.push({ value, authorization: request.headers.authorization });
      if (value.messages[0].content === 'wait') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders(); return;
      }
      if (value.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const content of ['你好', '世界']) response.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: 'translated' } }] }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const runtime = new LlamaServer('unused');
  runtime.child = { exitCode: null }; runtime.url = `http://127.0.0.1:${server.address().port}`;
  const messages = [{ role: 'system', content: 'Translate faithfully' }, { role: 'user', content: '原文' }];
  assert.equal(await runtime.generate({ messages }), 'translated');
  assert.deepEqual(requests[0].value.messages, messages);
  assert.equal(requests[0].authorization, 'Bearer ' + runtime.token);
  const updates = [];
  assert.equal(await runtime.generate({ messages, onUpdate: text => updates.push(text) }), '你好世界');
  assert.deepEqual(updates, ['你好', '你好世界']);
  const controller = new AbortController();
  const generation = runtime.generate({ messages: [{ role: 'user', content: 'wait' }], signal: controller.signal, onUpdate: () => {} });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(generation, /abort/i);
});
