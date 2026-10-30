// Hugging Face metadata + immutable, resumable file downloads. No executable code is fetched or run.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson, boundedBody, secretStore } = require('./storage.cjs');
const ORIGIN = 'https://huggingface.co';
const tasks = new Set(['', 'text-generation', 'automatic-speech-recognition', 'text-to-speech', 'image-text-to-text']);
function repoId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][\w.-]{0,95}\/[a-zA-Z0-9][\w.-]{0,95}$/.test(value) || value.includes('..')) throw new Error('HF 仓库应为作者/模型名');
  return value;
}
function fileName(value) {
  if (typeof value !== 'string' || value.length > 240 || value.split('/').some(s => !s || s === '.' || s === '..' || /[\\<>:"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw new Error('模型文件名不安全');
  return value;
}
function allowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['huggingface.co', 'hf.co'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('HF 请求只能访问官方 HTTPS 域名');
  return url;
}
async function hfFetch(value, { token, signal, headers = {}, fetcher = fetch } = {}) {
  let url = allowedUrl(value);
  for (let redirects = 0; redirects < 8; redirects++) {
    const response = await fetcher(url.href, { headers: { ...headers, ...(token && url.origin === ORIGIN ? { Authorization: `Bearer ${token}` } : {}) }, redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = allowedUrl(new URL(response.headers.get('location'), url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HF HTTP ${response.status}${[401, 403].includes(response.status) ? '：检查 Token，并在 HF 网站确认仓库访问许可' : response.status === 429 ? '：请求过快，请稍后重试' : ''}`); }
    return response;
  }
  throw new Error('HF 重定向次数过多');
}
async function safeTarget(root, relative) {
  const parts = fileName(relative).split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info?.isSymbolicLink()) throw new Error('下载路径不能包含符号链接或目录联接');
  }
  if (!path.resolve(current).startsWith(path.resolve(root) + path.sep)) throw new Error('下载路径越界');
  return current;
}
class ModelHub {
  constructor(dataDir, { emit = () => {}, register = async () => {}, safeStorage, fetcher = fetch } = {}) {
    this.dataDir = dataDir; this.emit = emit; this.register = register; this.fetcher = fetcher;
    this.secrets = secretStore(safeStorage); this.jobs = []; this.stopping = false; this.saveQueue = Promise.resolve();
    this.ready = this.open();
  }
  async open() {
    this.settings = await readJson(path.join(this.dataDir, 'hub-settings.json'), { directory: path.join(this.dataDir, 'models'), encryptedToken: null });
    await fs.mkdir(this.settings.directory, { recursive: true });
    this.settings.directory = await fs.realpath(this.settings.directory);
    this.token = this.secrets.decode(this.settings.encryptedToken);
    this.jobs = await readJson(path.join(this.dataDir, 'downloads.json'), []);
    for (const job of this.jobs) if (['queued', 'downloading', 'verifying'].includes(job.status)) job.status = 'paused';
  }
  publicSettings() { return { directory: this.settings.directory, hasToken: !!this.token, tokenPersistent: this.secrets.available() }; }
  async setSettings({ directory, token } = {}) {
    await this.ready;
    if (directory !== undefined) {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('下载目录必须为绝对路径');
      const stat = await fs.stat(directory); if (!stat.isDirectory()) throw new Error('请选择已有目录');
      this.settings.directory = await fs.realpath(directory);
    }
    if (token !== undefined) { if (typeof token !== 'string' || token.length > 2048 || /[\r\n]/.test(token)) throw new Error('Token 无效'); this.token = token.trim(); }
    await writeJson(path.join(this.dataDir, 'hub-settings.json'), { ...this.settings, encryptedToken: this.secrets.encode(this.token) });
    return this.publicSettings();
  }
  async json(url) {
    const response = await hfFetch(url, { token: this.token, signal: AbortSignal.timeout(30000), fetcher: this.fetcher });
    return JSON.parse((await boundedBody(response, 8 * 1024 * 1024)).toString('utf8'));
  }
  async search({ query = '', task = '', ggufOnly = true, sort = 'downloads' } = {}) {
    await this.ready;
    if (typeof query !== 'string' || query.length > 200 || !tasks.has(task) || !['downloads', 'lastModified', 'trendingScore'].includes(sort)) throw new Error('HF 搜索参数无效');
    const url = new URL('/api/models', ORIGIN);
    for (const [key, val] of Object.entries({ search: query.trim(), limit: '40', sort, direction: '-1', ...(ggufOnly ? { filter: 'gguf' } : {}), ...(task ? { pipeline_tag: task } : {}) })) url.searchParams.set(key, val);
    const result = await this.json(url);
    if (!Array.isArray(result)) throw new Error('HF 返回的列表格式无效');
    return result.map(m => ({ id: m.id, downloads: m.downloads ?? 0, likes: m.likes ?? 0, task: m.pipeline_tag ?? '', updatedAt: m.lastModified ?? m.last_modified ?? '', gated: !!m.gated, tags: (m.tags ?? []).slice(0, 25) }));
  }
  async detail(id) {
    await this.ready; repoId(id);
    const result = await this.json(`${ORIGIN}/api/models/${id}?blobs=true`);
    if (!/^[a-f0-9]{40}$/.test(result.sha)) throw new Error('HF 未提供有效的固定版本');
    return { id, revision: result.sha, downloads: result.downloads ?? 0, likes: result.likes ?? 0, gated: !!result.gated, task: result.pipeline_tag ?? '', license: result.cardData?.license ?? (result.tags ?? []).find(t => t.startsWith('license:'))?.slice(8) ?? '未声明', tags: (result.tags ?? []).slice(0, 25), files: (result.siblings ?? []).map(f => ({ name: f.rfilename, size: f.size ?? f.lfs?.size ?? 0, sha256: f.lfs?.sha256 ?? null, downloadable: /\.(gguf|safetensors|onnx|json|txt|md|model|tiktoken|yaml|yml)$/i.test(f.rfilename) || /(^|\/)LICENSE$/.test(f.rfilename) })) };
  }
  snapshot() { return this.jobs.map(({ controller, ...job }) => job); }
  persist() {
    const value = this.snapshot();
    const save = this.saveQueue.then(() => writeJson(path.join(this.dataDir, 'downloads.json'), value));
    this.saveQueue = save.catch(() => {});
    return save;
  }
  update() { this.emit('download-progress', this.snapshot()); }
  async download({ repo, revision, file }) {
    await this.ready; repoId(repo); fileName(file);
    const info = await this.detail(repo);
    if (revision !== info.revision) throw new Error('仓库版本已变化，请刷新文件列表后重试');
    const metadata = info.files.find(f => f.name === file);
    if (!metadata?.downloadable || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw new Error('此文件没有可靠大小，或格式不在允许的模型/配置清单中');
    const duplicate = this.jobs.find(j => j.repo === repo && j.revision === revision && j.file === file && j.status !== 'cancelled' && j.status !== 'deleted');
    if (duplicate) return duplicate.id;
    if (this.jobs.filter(j => ['queued', 'downloading', 'paused'].includes(j.status)).length >= 30 || this.jobs.length >= 500) throw new Error('下载记录/队列已满');
    const root = this.settings.directory;
    const target = await safeTarget(root, `hf/${repo}/${revision}/${file}`);
    if (await fs.stat(target).catch(() => null)) throw new Error('目标文件已存在；不会覆盖已有模型');
    const queued = this.jobs.find(j => j.repo === repo && j.revision === revision && j.file === file && !['cancelled', 'deleted'].includes(j.status));
    if (queued) return queued.id;
    const id = randomUUID();
    this.jobs.push({ id, repo, revision, file, root, path: target, part: `${target}.${id}.part`, size: metadata.size, sha256: metadata.sha256, bytes: 0, speed: 0, status: 'queued', error: null, createdAt: new Date().toISOString() });
    await this.persist(); this.update(); this.pump(); return id;
  }
  pump() {
    if (this.stopping || this.active) return;
    const job = this.jobs.find(j => j.status === 'queued'); if (!job) return;
    this.active = this.run(job).catch(() => {}).finally(() => { this.active = null; this.pump(); });
  }
  async run(job) {
    job.controller = new AbortController(); job.status = 'downloading'; job.error = null; this.update();
    try {
      await safeTarget(job.root, path.relative(job.root, job.path).split(path.sep).join('/'));
      await safeTarget(job.root, path.relative(job.root, job.part).split(path.sep).join('/'));
      await fs.mkdir(path.dirname(job.path), { recursive: true });
      if (await fs.stat(job.path).catch(() => null)) throw new Error('目标文件已存在，不会覆盖');
      const offset = (await fs.stat(job.part).catch(() => null))?.size ?? 0;
      if (offset > job.size) throw new Error('未完成文件大于预期，请取消任务后重试');
      job.bytes = offset;
      const disk = await fs.statfs(path.dirname(job.path));
      if (disk.bavail * disk.bsize < job.size - offset) throw new Error('下载目录的可用磁盘空间不足');
      if (offset < job.size) {
        const url = `${ORIGIN}/${job.repo}/resolve/${job.revision}/${job.file.split('/').map(encodeURIComponent).join('/')}?download=true`;
        const response = await hfFetch(url, { token: this.token, signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(6 * 60 * 60 * 1000)]), headers: offset ? { Range: `bytes=${offset}-` } : {}, fetcher: job.direct ? fetch : this.fetcher });
        if (offset && (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))) { await response.body?.cancel(); throw new Error('服务不支持本次断点续传；请取消后重新下载'); }
        const handle = await fs.open(job.part, offset ? 'a' : 'wx');
        let lastTime = Date.now(), lastBytes = offset;
        try {
          for await (const chunk of response.body) {
            if (job.controller.signal.aborted) throw new Error('下载已暂停');
            if (job.bytes + chunk.length > job.size) throw new Error('文件内容超过 HF 声明的大小');
            await handle.writeFile(chunk); job.bytes += chunk.length;
            if (Date.now() - lastTime > 250) { job.speed = (job.bytes - lastBytes) * 1000 / (Date.now() - lastTime); lastTime = Date.now(); lastBytes = job.bytes; this.update(); }
          }
          await handle.sync();
        } finally { await handle.close(); }
      }
      if (job.bytes !== job.size) throw new Error('下载不完整，可继续下载');
      job.status = 'verifying'; job.speed = 0; this.update();
      if (/\.gguf$/i.test(job.file)) {
        const handle = await fs.open(job.part, 'r'); const header = Buffer.alloc(24);
        try { await handle.read(header, 0, 24, 0); } finally { await handle.close(); }
        if (header.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4))) throw new Error('下载文件不是 GGUF v2/v3');
      }
      if (job.controller.signal.aborted) throw new Error('下载已暂停');
      // Hard-link publication is atomic and fails rather than overwriting an existing file.
      try { await fs.link(job.part, job.path); }
      catch (error) { if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error; await fs.copyFile(job.part, job.path, constants.COPYFILE_EXCL); }
      await fs.unlink(job.part);
      job.status = 'completed';
      try { await this.register(path.dirname(job.path)); } catch { job.error = '文件已下载，但模型库登记失败；请手动添加文件所在目录'; }
    } catch (error) {
      if (job.status !== 'cancelled') {
        const retry = !job.controller.signal.aborted && /ERR_HTTP2|ECONN|network|fetch failed|HTTP (408|429|5\d\d)/i.test(error.message) && (job.retries || 0) < 3;
        if (retry) { job.retries = (job.retries || 0) + 1; job.direct = !job.direct; job.status = 'queued'; job.error = null; await new Promise(resolve => setTimeout(resolve, job.retries * 1000)); }
        else { job.status = job.controller.signal.aborted ? 'paused' : 'failed'; job.error = job.controller.signal.aborted ? null : error.message; }
      }
    } finally { delete job.controller; job.speed = 0; await this.persist(); this.update(); }
  }
  async action({ id, action }) {
    await this.ready; const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('下载任务不存在');
    if (action === 'pause' && ['queued', 'downloading', 'verifying'].includes(job.status)) { job.status = 'paused'; job.controller?.abort(); }
    else if (action === 'resume' && ['paused', 'failed'].includes(job.status)) { if (job.controller) throw new Error('任务正在停止，请稍后重试'); job.status = 'queued'; job.error = null; job.retries = 0; }
    else if (action === 'cancel' && !['completed', 'deleted'].includes(job.status)) {
      job.status = 'cancelled';
      if (job.controller) { const running = this.active; job.controller.abort(); await running; }
      await safeTarget(job.root, path.relative(job.root, job.part).split(path.sep).join('/'));
      await fs.unlink(job.part).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } else throw new Error('任务状态不允许此操作');
    await this.persist(); this.update(); this.pump(); return this.snapshot();
  }
  async stop() {
    this.stopping = true;
    for (const job of this.jobs) { if (job.status === 'queued') job.status = 'paused'; job.controller?.abort(); }
    await this.active; await this.persist();
  }
}
module.exports = { ModelHub, repoId, fileName, allowedUrl, hfFetch, safeTarget };
