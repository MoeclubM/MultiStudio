const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson, writeJson } = require('./storage.cjs');
const { metadata } = require('./gguf.cjs');
const { nodeRegistry } = require('./node-registry.cjs');
const DEFAULT_OPTIONS = { contextLength: 4096, threads: 4, useGpu: true };
const normalized = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
function displayName(fileName, embedded, custom) {
  const label = embedded?.trim();
  return custom?.trim() || (label && !/^[a-f0-9]{16,64}$/i.test(label) ? label : fileName.replace(/\.gguf$/i, ''));
}
function modelId(file) {
  let id = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(normalized(file))) id = BigInt.asUintN(64, (id ^ BigInt(byte)) * 0x100000001b3n);
  return `gguf-${id.toString(16).padStart(16, '0')}`;
}
class ModelLibrary {
  constructor(directory, emit) { this.file = path.join(directory, 'model-library.json'); this.directory = directory; this.emit = emit; this.queue = Promise.resolve(); this.ready = this.open(); }
  async open() { const models = path.join(this.directory, 'models'); this.settings = { directories: [models], storageDirectory: models, cacheDirectory: path.join(this.directory, 'runtime'), imports: [], loadOptions: DEFAULT_OPTIONS, autoLoad: false, ...await readJson(this.file, {}) }; await fs.mkdir(this.settings.storageDirectory, { recursive: true }); }
  async persist(change) {
    const task = this.queue.then(async () => { const next = structuredClone(this.settings); await change(next); await writeJson(this.file, next); this.settings = next; this.emit('model-library-changed', null); });
    this.queue = task.catch(() => {}); return task;
  }
  async catalogue() {
    await this.ready; const files = new Map(), warnings = [];
    async function visit(directory, depth = 0) {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => { warnings.push(`${directory}：${error.message}`); return []; });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() && depth < 6) await visit(file, depth + 1);
        else if (entry.isFile() && /\.gguf$/i.test(entry.name)) files.set(normalized(file), file);
      }
    }
    for (const directory of this.settings.directories) await visit(directory);
    for (const entry of this.settings.imports) files.set(normalized(entry.path), entry.path);
    const models = [];
    for (const file of files.values()) {
      const imported = this.settings.imports.find(entry => normalized(entry.path) === normalized(file));
      const stat = await fs.stat(file).catch(() => null), fileName = path.basename(file);
      let properties = {}, formatError;
      if (stat) { try { properties = metadata(file); } catch (error) { formatError = error.message; } }
      const family = properties['audiocpp.model_spec.family'] || null;
      const kind = family ? 'speech' : imported?.kind || (/mmproj|projector/i.test(fileName) ? 'projector' : /vision|[-_]vl\b/i.test(fileName) ? 'vision' : /asr|tts|whisper|r2t2|breeze|kokoro/i.test(fileName) ? 'speech' : 'text');
      const base = { path: file, kind, family, architecture: properties['general.architecture'] || null, metadata: properties };
      const candidates = !formatError && stat ? [...nodeRegistry.backendHandlers].filter(([, handler]) => handler.accepts?.(base)).map(([id]) => id) : [];
      const backendId = candidates[0] || null;
      models.push({ id: modelId(file), name: displayName(fileName, properties['general.name'], imported?.name), path: file, fileName, sizeBytes: stat?.size || 0, kind, family, backendId, backends: candidates, runtime: family ? `${backendId}:${family}` : backendId, quantization: fileName.toUpperCase().replace(/\.GGUF$/, '').match(/(?:^|[-.])((?:I?Q\d[^-.]*|BF16|F16|F32))$/)?.[1] || null, imported: !!imported, installed: !!stat, loadable: !!backendId && kind === 'text', compatibility: !stat ? '文件已移除' : formatError || (backendId ? nodeRegistry.backends[backendId].name : '没有可用的推理插件') });
    }
    models.sort((a, b) => a.name.localeCompare(b.name));
    return { models, settings: this.settings, warnings };
  }
  async resolve(id, backendId) {
    const entry = (await this.catalogue()).models.find(model => model.id === id || model.path === id);
    if (!entry?.installed || backendId && !entry.backends.includes(backendId)) throw new Error('请选择当前后端支持的已安装模型');
    return entry;
  }
  async import({ path: file, name, kind }) {
    const resolved = await fs.realpath(file); metadata(resolved);
    await this.persist(settings => { settings.imports = settings.imports.filter(entry => normalized(entry.path) !== normalized(resolved)); settings.imports.push({ path: resolved, name: name?.trim() || path.basename(resolved, '.gguf'), kind }); });
    return modelId(resolved);
  }
  async add(directory) {
    const absolute = await fs.realpath(directory); if (!(await fs.stat(absolute)).isDirectory()) throw new Error('请选择模型目录');
    return this.persist(settings => { if (!settings.directories.some(item => normalized(item) === normalized(absolute))) settings.directories.push(absolute); });
  }
  remove(directory) { return this.persist(settings => { settings.directories = settings.directories.filter(item => item !== directory); }); }
  forget(id) { return this.persist(settings => { settings.imports = settings.imports.filter(item => modelId(item.path) !== id); }); }
  configure(options, autoLoad) { return this.persist(settings => { settings.loadOptions = options; settings.autoLoad = autoLoad; }); }
}
module.exports = { ModelLibrary, modelId, displayName, DEFAULT_OPTIONS };
