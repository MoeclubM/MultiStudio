import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-desktop-'));
const server = http.createServer((request, response) => {
  request.resume(); request.once('end', () => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '插件连接正常' } }] })); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, MULTISTUDIO_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ ...(env.MULTISTUDIO_TEST_EXECUTABLE ? { executablePath: env.MULTISTUDIO_TEST_EXECUTABLE, args: [] } : { args: [path.resolve('.')] }), env });
try {
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.getByRole('heading', { name: '工作流', exact: true }).waitFor();
  const invoke = (command: string, args = {}) => page.evaluate(({ command, args }: { command: string; args: object }) => window.multistudioDesktop!.invoke(command, args), { command, args });
  assert.equal((await invoke('backend_info')).language, 'csharp');
  const catalog = await invoke('node_catalog');
  assert.deepEqual(Object.keys(catalog.backends).sort(), ['audiocpp', 'llmcore', 'openai', 'sherpa']);
  const config = await invoke('get_config');
  config.llm.baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`; config.llm.llmModel = 'local-check';
  await invoke('set_config', { config });
  const nodes = ['text-input', 'openai.text', 'text-output'].map((kind, index) => ({ id: randomUUID(), type: 'studio', position: { x: index * 370, y: 60 }, data: { kind, label: catalog.nodes[kind].label, config: { ...catalog.nodes[kind].defaults, ...(index === 0 ? { text: '你好' } : {}) } } }));
  const edges = nodes.slice(1).map((node, index) => ({ id: randomUUID(), source: nodes[index].id, target: node.id, sourceHandle: 'text', targetHandle: 'text' }));
  await invoke('workflow_save', { workflow: { version: 1, id: randomUUID(), name: '插件连接', nodes, edges } });
  await page.reload(); await page.locator('.workflow-toolbar').getByRole('button', { name: '运行', exact: true }).click();
  const deadline = Date.now() + 15000;
  let run = await invoke('workflow_status');
  while (!['completed', 'failed'].includes(run?.status) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 100)); run = await invoke('workflow_status'); }
  assert.equal(run?.status, 'completed', run?.error);
  assert.equal((await invoke('workflow_status')).nodes[nodes[2].id].output.text, '插件连接正常');
  const disabled = await invoke('node_plugin_toggle', { id: 'multistudio.openai', enabled: false });
  assert.equal(disabled.backends.openai, undefined); assert.equal(disabled.nodes['openai.text'], undefined);
  const enabled = await invoke('node_plugin_toggle', { id: 'multistudio.openai', enabled: true });
  assert.ok(enabled.backends.openai); assert.ok(enabled.nodes['openai.text']);
  assert.deepEqual(errors, []);
  console.log('桌面启动、C# 连接、API 插件节点执行与插件启停通过。');
} finally { await app.close(); server.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
