const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./storage.cjs');

class Runtimes {
  constructor(dataDir, { directory, runtimeDirectory, packages, native, fetcher = fetch, emit = () => {} }) {
    Object.assign(this, { runtimeDirectory, packages, native, fetcher, emit });
    this.file = path.join(dataDir, 'runtime-settings.json'); this.jobs = new Map();
    this.ready = this.open(directory || path.join(dataDir, 'runtime', 'engines'));
  }
  async open(directory) {
    this.settings = await readJson(this.file, { directory });
    await fs.mkdir(this.settings.directory, { recursive: true });
    await writeJson(this.file, this.settings);
  }
  get busy() { return [...this.jobs.values()].some(job => job.promise); }
  publish() { this.emit('runtime-state', null); }
  spec(id) { const spec = this.packages().find(spec => spec.id === id); if (!spec) throw new Error('运行库插件不可用'); return spec; }
  target(spec) {
    const root = path.resolve(this.settings.directory), target = path.resolve(root, spec.id, spec.version);
    if (!target.startsWith(root + path.sep)) throw new Error('运行库安装路径无效');
    return target;
  }
  async installed(directory, spec) {
    const marker = await readJson(path.join(directory, 'runtime.json'), null);
    return marker?.version === spec.version && marker.platform === process.platform && marker.arch === process.arch &&
      (await Promise.all(spec.required.map(file => fs.stat(path.join(directory, file)).then(stat => stat.size > 0).catch(() => false)))).every(Boolean);
  }
  async resolve(spec) {
    const bundled = path.join(this.runtimeDirectory, spec.id);
    if (await this.installed(bundled, spec)) return { directory: bundled, status: 'bundled' };
    const directory = this.target(spec);
    return await this.installed(directory, spec) ? { directory, status: 'ready' } : null;
  }
  async snapshot() {
    await this.ready;
    const items = await Promise.all(this.packages().map(async spec => {
      const installed = await this.resolve(spec), job = this.jobs.get(spec.id);
      return { id: spec.id, name: spec.name, version: spec.version, backendId: spec.backendId,
        directory: installed?.directory || this.target(spec), status: installed?.status || job?.status || 'missing',
        bytes: job?.bytes || 0, total: spec.archives.reduce((sum, archive) => sum + archive.size, 0), error: job?.error || null };
    }));
    return { directory: this.settings.directory, items };
  }
  async configure(directory) {
    await this.ready;
    if (this.busy) throw new Error('请先停止运行库下载');
    if (!path.isAbsolute(directory)) throw new Error('请选择运行库目录');
    await fs.mkdir(directory, { recursive: true });
    this.settings = { directory: await fs.realpath(directory) };
    await writeJson(this.file, this.settings); this.publish(); return this.snapshot();
  }
  async ensure(id, signal) {
    await this.ready; signal?.throwIfAborted();
    const spec = this.spec(id), installed = await this.resolve(spec);
    if (installed) return installed.directory;
    const existing = this.jobs.get(id);
    if (existing?.promise) return existing.promise;
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const job = { status: 'downloading', bytes: 0, error: null, controller };
    this.jobs.set(id, job); this.publish();
    job.promise = this.install(spec, job).then(directory => { job.status = 'ready'; return directory; }).catch(error => {
      job.status = controller.signal.aborted ? 'missing' : 'error'; job.error = controller.signal.aborted ? null : error.message; throw error;
    }).finally(() => { job.promise = null; if (job.status === 'ready') this.jobs.delete(id); signal?.removeEventListener('abort', abort); this.publish(); });
    return job.promise;
  }
  cancel(id) { this.jobs.get(id)?.controller.abort(new Error('已取消运行库下载')); }
  async download(archive, file, job, previous) {
    const signal = job.controller.signal;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      let offset = (await fs.stat(file).catch(() => null))?.size || 0;
      if (offset === archive.size) { job.bytes = previous + offset; this.publish(); return; }
      try {
        const response = await (attempt === 1 ? this.fetcher : fetch)(archive.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: AbortSignal.any([signal, AbortSignal.timeout(1800000)]) });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`运行库下载 HTTP ${response.status}`); }
        if (offset && response.status === 200) offset = 0;
        if (offset && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) { await response.body?.cancel(); throw new Error('服务器未正确响应续传请求'); }
        const handle = await fs.open(file, offset ? 'a' : 'w');
        let received = offset, lastUpdate = 0;
        try {
          for await (const chunk of response.body) {
            signal.throwIfAborted(); received += chunk.length;
            if (received > archive.size) throw new Error('运行库文件超过预期大小');
            await handle.writeFile(chunk); job.bytes = previous + received;
            if (Date.now() - lastUpdate >= 250) { this.publish(); lastUpdate = Date.now(); }
          }
        } finally { await handle.close(); }
        if (received !== archive.size) throw new Error('运行库下载不完整');
        return;
      } catch (error) { if (signal.aborted || attempt === 2) throw error; }
    }
  }
  async copy(source, destination, spec) {
    for (const relative of await fs.readdir(source, { recursive: true })) {
      const name = path.basename(relative);
      if (!spec.executables.includes(name) && !/\.dll$/i.test(name) && !/license|notice|eula/i.test(relative) && !spec.directories?.some(directory => relative.split(path.sep).includes(directory))) continue;
      const from = path.join(source, relative); if (!(await fs.stat(from)).isFile()) continue;
      const to = path.join(destination, relative); await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to);
    }
  }
  async install(spec, job) {
    const signal = job.controller.signal, target = this.target(spec), root = path.resolve(this.settings.directory);
    const archives = path.resolve(root, '.downloads', spec.id, spec.version), staging = path.resolve(root, `.install-${spec.id}-${randomUUID()}`);
    if (![archives, staging, target].every(file => file.startsWith(root + path.sep))) throw new Error('运行库暂存路径无效');
    await fs.mkdir(archives, { recursive: true });
    const disk = await fs.statfs(root), required = spec.installedBytes * 2 + spec.archives.reduce((sum, archive) => sum + archive.size, 0);
    if (disk.bavail * disk.bsize < required) throw new Error('运行库目录空间不足，请在设置 → 插件更换目录');
    const prepared = path.join(staging, 'prepared'); await fs.mkdir(prepared, { recursive: true });
    try {
      let previous = 0;
      for (const [index, archive] of spec.archives.entries()) {
        const file = path.join(archives, `${index}.zip`);
        job.status = 'downloading'; await this.download(archive, file, job, previous); previous += archive.size;
        signal.throwIfAborted(); job.status = 'installing'; this.publish();
        const unpacked = path.join(staging, String(index));
        try { await this.native.invoke('runtime_extract', { archive: file, directory: unpacked }); }
        catch (error) { await fs.rm(file, { force: true }); throw error; }
        signal.throwIfAborted();
        let source = unpacked;
        if (archive.executable) {
          const server = (await fs.readdir(unpacked, { recursive: true })).find(file => path.basename(file) === archive.executable);
          if (!server) throw new Error('运行库压缩包中没有所需程序');
          source = path.dirname(path.join(unpacked, server));
        }
        await this.copy(source, prepared, spec); await fs.rm(unpacked, { recursive: true, force: true });
      }
      signal.throwIfAborted();
      await writeJson(path.join(prepared, 'runtime.json'), { version: spec.version, platform: process.platform, arch: process.arch, sources: spec.archives.map(archive => archive.url) });
      if (!await this.installed(prepared, spec)) throw new Error('运行库文件不完整');
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rm(target, { recursive: true, force: true }); await fs.rename(prepared, target);
      await fs.rm(archives, { recursive: true, force: true }); return target;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async stop() {
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(job => job.promise));
  }
}
module.exports = { Runtimes };
