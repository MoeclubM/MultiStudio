const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { NativeBackend } = require('../backend.cjs');
const { ApplicationBackend } = require('../application-backend.cjs');
const { backendCommands, shellCommands } = require('../contract.cjs');
const executable = path.resolve('.cache/native-host', process.platform === 'win32' ? 'multistudio-native.exe' : 'multistudio-native');

test('C# helper and model catalogue have separate responsibilities and exit cleanly', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-worker-test-'));
  const native = new NativeBackend(executable, directory), backend = new ApplicationBackend(native, directory, fetch);
  t.after(async () => { await backend.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  await backend.ready;
  assert.equal((await backend.invoke('backend_info')).language, 'csharp');
  const config = await backend.invoke('get_config'); config.llm.llmModel = 'saved-model';
  await backend.invoke('set_config', { config });
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'live-translator.json'), 'utf8')).llm.llmModel, 'saved-model');
  const filename = path.join(directory, 'vision.gguf'), header = Buffer.alloc(24);
  header.write('GGUF'); header.writeUInt32LE(3, 4); await fs.writeFile(filename, header);
  const id = await backend.invoke('import_model', { path: filename, name: 'Vision', kind: 'vision' });
  assert.equal((await backend.invoke('get_model_library')).models.find(model => model.id === id).loadable, false);
  await backend.invoke('forget_model', { modelId: id }); assert.equal((await fs.stat(filename)).size, 24);
  await assert.rejects(native.invoke('get_config'), /未知原生/);
  await backend.stop(); assert.equal(native.child.exitCode, 0);
});
test('renderer cannot call native internals or execute arbitrary commands', () => {
  for (const command of ['__shutdown', 'initialize', 'text_load', 'text_generate']) assert.equal(backendCommands.has(command), false);
  assert.equal(shellCommands.has('exec'), false); assert.equal(shellCommands.has('node_plugin_reload'), true);
});
