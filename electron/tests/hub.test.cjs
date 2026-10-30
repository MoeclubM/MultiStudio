const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ModelHub, repoId, fileName, hfFetch, safeTarget } = require('../hub.cjs');
const revision = 'a'.repeat(40);
const fixture = Buffer.alloc(1024, 1); fixture.write('GGUF'); fixture.writeUInt32LE(3, 4);
const sha = 'a'.repeat(64);
const metadata = (hash = sha) => ({ sha: revision, pipeline_tag: 'text-generation', cardData: { license: 'apache-2.0' }, siblings: [{ rfilename: 'tiny.gguf', size: fixture.length, lfs: { sha256: hash } }, { rfilename: 'run.py', size: 100 }] });
async function setup(t, fetcher, register = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-hub-'));
  const hub = new ModelHub(directory, { fetcher, register }); await hub.ready;
  t.after(async () => { await hub.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, hub };
}
async function until(predicate) { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error('Download test timeout'); await new Promise(r => setTimeout(r, 10)); } }
test('search filters, immutable metadata, no executable downloads', async t => {
  const { hub } = await setup(t, async url => {
    if (url.includes('?blobs')) return Response.json(metadata());
    const query = new URL(url).searchParams;
    assert.equal(query.get('filter'), 'gguf'); assert.equal(query.get('pipeline_tag'), 'text-generation');
    return Response.json([{ id: 'owner/model', downloads: 30, likes: 2, tags: ['gguf'] }]);
  });
  assert.equal((await hub.search({ query: 'tiny', task: 'text-generation' }))[0].id, 'owner/model');
  const detail = await hub.detail('owner/model'); assert.equal(detail.revision, revision); assert.equal(detail.license, 'apache-2.0');
  assert.equal(detail.files[1].downloadable, false);
  await assert.rejects(hub.download({ repo: 'owner/model', revision, file: 'run.py' }), /格式/);
  await assert.rejects(hub.download({ repo: 'owner/model', revision: 'b'.repeat(40), file: 'tiny.gguf' }), /版本/);
});
test('download checks size and header, pins commit, registers directory and never overwrites', async t => {
  const registered = []; let requests = 0;
  const { hub } = await setup(t, async url => {
    if (url.includes('/api/')) return Response.json(metadata());
    requests++; assert.ok(url.includes(`/resolve/${revision}/tiny.gguf`)); return new Response(fixture);
  }, async directory => registered.push(directory));
  const args = { repo: 'owner/model', revision, file: 'tiny.gguf' };
  const ids = await Promise.all([hub.download(args), hub.download(args)]); assert.equal(ids[0], ids[1]);
  await until(() => hub.jobs[0].status === 'completed'); await hub.active;
  assert.equal(requests, 1); assert.equal(registered.length, 1);
  assert.deepEqual(await fs.readFile(hub.jobs[0].path), fixture);
  await assert.rejects(fs.stat(hub.jobs[0].part), /ENOENT/);
  hub.jobs[0].status = 'deleted';
  await assert.rejects(hub.download(args), /覆盖/);
});
test('pause, Range resume, restart to paused and cancel only partial file', async t => {
  let calls = 0, streamed = false;
  const { hub, directory } = await setup(t, async (url, init) => {
    if (url.includes('/api/')) return Response.json(metadata());
    if (++calls === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(fixture.subarray(0, 128)); streamed = true;
      init.signal.addEventListener('abort', () => controller.error(new DOMException('Abort', 'AbortError')), { once: true });
    } }));
    assert.equal(init.headers.Range, 'bytes=128-');
    return new Response(fixture.subarray(128), { status: 206, headers: { 'Content-Range': `bytes 128-1023/1024` } });
  });
  const id = await hub.download({ repo: 'owner/model', revision, file: 'tiny.gguf' });
  await until(() => streamed && hub.jobs[0].bytes === 128);
  await hub.action({ id, action: 'pause' }); await hub.active;
  assert.equal(hub.jobs[0].status, 'paused');
  const restored = new ModelHub(directory); await restored.ready; assert.equal(restored.jobs[0].status, 'paused'); await restored.stop();
  await hub.action({ id, action: 'resume' }); await until(() => hub.jobs[0].status === 'completed'); await hub.active;
  assert.equal(calls, 2);
  // A queued cancellation must not wait for another active download.
  const other = { ...hub.snapshot()[0], id: require('node:crypto').randomUUID(), status: 'queued', part: hub.jobs[0].path + '.cancel.part' };
  hub.jobs.push(other); await fs.writeFile(other.part, 'partial');
  await hub.action({ id: other.id, action: 'cancel' });
  await assert.rejects(fs.stat(other.part), /ENOENT/); assert.deepEqual(await fs.readFile(hub.jobs[0].path), fixture);
});
test('truncated download is not published or registered', async t => {
  let registered = false;
  const { hub } = await setup(t, async url => url.includes('/api/') ? Response.json(metadata()) : new Response(fixture.subarray(0, 100)), async () => { registered = true; });
  await hub.download({ repo: 'owner/model', revision, file: 'tiny.gguf' }); await until(() => hub.jobs[0].status === 'failed'); await hub.active;
  assert.match(hub.jobs[0].error, /下载不完整/); assert.equal(registered, false); await assert.rejects(fs.stat(hub.jobs[0].path), /ENOENT/);
});
test('paths reject traversal, reserved names and junctions; token is not forwarded to CDN', async t => {
  for (const value of ['../bad', 'owner/../model', 'https://host/repo']) assert.throws(() => repoId(value));
  for (const value of ['../tiny.gguf', 'a\\tiny.gguf', 'C:/tiny.gguf', 'NUL.gguf', 'test./x']) assert.throws(() => fileName(value));
  const { directory } = await setup(t, async () => Response.json(metadata()));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-junction-')); t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safeTarget(directory, 'link/tiny.gguf'), /符号链接/);
  const seen = [];
  await hfFetch('https://huggingface.co/owner/model/resolve/main/tiny.gguf', { token: 'secret', fetcher: async (url, init) => { seen.push(init.headers.Authorization); return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.hf.co/file' } }) : new Response('ok'); } });
  assert.deepEqual(seen, ['Bearer secret', undefined]);
  await assert.rejects(hfFetch('https://huggingface.co/file', { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/file' } }) }), /官方 HTTPS/);
});
