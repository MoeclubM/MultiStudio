const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { NativeBackend } = require('../backend.cjs');
const { Runtimes } = require('../runtimes.cjs');

test('optional runtime resumes a failed download, extracts with native helper and reuses installed or bundled files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-runtime-'));
  const zip = Buffer.from('UEsDBBQAAAAIAJuJXl2lDuy+QQAAAIA+AAAKAAAAZW5naW5lLmRsbO3HsQkAIAwAsFf6XAUHHUoFz/cQky11ds+VMebtUxnl7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u/eMfUEsDBBQAAAAIAJuJXl3to1n+DgAAAAwAAAAHAAAATElDRU5TRStJLS5RyMlMTs0rTgUAUEsBAhQAFAAAAAgAm4leXaUO7L5BAAAAgD4AAAoAAAAAAAAAAAAAAIABAAAAAGVuZ2luZS5kbGxQSwECFAAUAAAACACbiV5d7aNZ/g4AAAAMAAAABwAAAAAAAAAAAAAAgAFpAAAATElDRU5TRVBLBQYAAAAAAgACAG0AAACcAAAAAAA=', 'base64');
  const ranges = [], events = []; let first = true;
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') {
      response.writeHead(200, { 'Content-Length': zip.length }); response.write(zip.subarray(0, 10)); return;
    }
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0); ranges.push(offset);
    response.writeHead(offset ? 206 : 200, { 'Content-Length': zip.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${zip.length - 1}/${zip.length}` } : {}) });
    if (first) { first = false; response.write(zip.subarray(0, Math.floor(zip.length / 2))); setTimeout(() => response.destroy(), 30); }
    else response.end(zip.subarray(offset));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const native = new NativeBackend(path.resolve('.cache/native-host', process.platform === 'win32' ? 'multistudio-native.exe' : 'multistudio-native'), directory);
  const spec = { id: 'test-runtime', name: 'Test', version: 'v1', installedBytes: 16000, required: ['engine.dll', 'LICENSE'], executables: [], directories: [], archives: [{ url: `http://127.0.0.1:${server.address().port}/runtime`, size: zip.length }] };
  const cancelledSpec = { ...spec, id: 'cancel-runtime', archives: [{ ...spec.archives[0], url: `http://127.0.0.1:${server.address().port}/slow` }] };
  const bundled = path.join(directory, 'bundled');
  const runtimes = new Runtimes(directory, { directory: path.join(directory, 'engines'), runtimeDirectory: bundled, native, packages: () => [spec, cancelledSpec], emit: event => events.push(event) });
  t.after(async () => { await runtimes.stop(); await native.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  await native.ready; await runtimes.ready;
  assert.equal((await runtimes.snapshot()).items[0].status, 'missing');
  const installed = await runtimes.ensure(spec.id);
  assert.equal(await fs.readFile(path.join(installed, 'engine.dll'), 'utf8'), 'runtime fixture '.repeat(1000));
  assert.ok(ranges.some(offset => offset > 0)); assert.ok(events.includes('runtime-state'));
  assert.equal((await runtimes.snapshot()).items[0].status, 'ready');
  const count = ranges.length; assert.equal(await runtimes.ensure(spec.id), installed); assert.equal(ranges.length, count);
  assert.deepEqual((await fs.readdir(path.dirname(installed))).sort(), ['v1']);
  assert.ok(!await fs.access(path.join(directory, 'engines/.downloads/test-runtime/v1')).then(() => true).catch(() => false));
  await fs.cp(installed, path.join(bundled, spec.id), { recursive: true });
  assert.equal(await runtimes.ensure(spec.id), path.join(bundled, spec.id));
  assert.equal((await runtimes.snapshot()).items[0].status, 'bundled');
  const installing = runtimes.ensure(cancelledSpec.id);
  setTimeout(() => runtimes.cancel(cancelledSpec.id), 50);
  await assert.rejects(installing, /取消|abort/i);
  assert.equal((await runtimes.snapshot()).items[1].status, 'missing');
  assert.equal(runtimes.busy, false);
  assert.ok(!(await fs.readdir(path.join(directory, 'engines'))).some(file => file.startsWith('.install-')));
});
