const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('../../electron/storage.cjs');
const { hfFetch } = require('../../electron/hub.cjs');

const presets = [
  { id: 'sensevoice-int8', name: 'SenseVoice Small', task: 'asr', engine: 'senseVoice', repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', revision: '2365baeacb507f821a0c8120fcee3d484dba7a07', size: 240000000, languages: '中文 / 英文 / 日文 / 韩文 / 粤语', files: ['model.int8.onnx', 'tokens.txt', 'LICENSE'], config: { model: 'model.int8.onnx', tokens: 'tokens.txt' } },
  { id: 'kokoro-zh-en', name: 'Kokoro 中英文', task: 'tts', engine: 'kokoro', repo: 'csukuangfj/kokoro-multi-lang-v1_0', revision: 'f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b', size: 363000000, languages: '中文 / 英文', speakers: 54, files: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'LICENSE'], config: { model: 'model.onnx', voices: 'voices.bin', tokens: 'tokens.txt', lexicon: 'lexicon-us-en.txt,lexicon-zh.txt' } },
];

class SpeechModels {
  constructor(directory, { fetcher = fetch, emit = () => {}, modelDirectory = path.join(directory, 'models') } = {}) {
    this.root = path.join(modelDirectory, 'speech'); this.file = path.join(directory, 'speech-models.json');
    this.fetcher = fetcher; this.emit = emit; this.jobs = new Map(); this.ready = this.open();
  }
  async open() { await fs.mkdir(this.root, { recursive: true }); this.imports = await readJson(this.file, []); }
  entries() { return [...presets.map(model => ({ ...model, directory: path.join(this.root, model.id) })), ...this.imports]; }
  publish() { this.emit('speech-models', null); }
  async list() {
    await this.ready;
    return Promise.all(this.entries().map(async model => {
      const ready = (await Promise.all(model.files.map(file => fs.stat(path.join(model.directory, file)).then(stat => stat.size > 0).catch(() => false)))).every(Boolean);
      return { ...model, status: ready ? 'ready' : 'missing', ...this.jobs.get(model.id) };
    }));
  }
  async get(id, task) {
    const model = (await this.list()).find(model => model.id === id && model.task === task);
    if (!model || model.status !== 'ready') throw new Error('请先在模型库下载或导入所选语音模型');
    return model;
  }
  async download(id) {
    await this.ready; const model = presets.find(model => model.id === id);
    if (!model) throw new Error('语音模型不存在');
    if (this.jobs.get(id)?.status === 'downloading') return;
    const controller = new AbortController();
    const job = { status: 'downloading', bytes: 0, total: model.size, error: null }; this.jobs.set(id, job); this.publish();
    const operation = this.install(model, job, controller.signal).then(() => { this.jobs.delete(id); }).catch(error => {
      Object.assign(job, { status: controller.signal.aborted ? 'missing' : 'error', error: controller.signal.aborted ? null : error.message });
    }).finally(() => { this.publish(); this.operations.delete(id); });
    this.operations ??= new Map(); this.operations.set(id, { controller, operation }); return;
  }
  async install(model, job, signal) {
    const metadata = await hfFetch(`https://huggingface.co/api/models/${model.repo}/revision/${model.revision}?blobs=true`, { fetcher: this.fetcher, signal }).then(response => response.json());
    const files = model.files.map(name => { const file = metadata.siblings.find(file => file.rfilename === name); if (!file?.size) throw new Error(`缺少模型资源 ${name}`); return { name, size: file.size }; });
    job.total = files.reduce((total, file) => total + file.size, 0);
    const directory = path.join(this.root, model.id); await fs.mkdir(directory, { recursive: true });
    let lastUpdate = 0;
    for (const file of files) {
      const target = path.join(directory, file.name), partial = target + '.part';
      if ((await fs.stat(target).catch(() => null))?.size === file.size) { job.bytes += file.size; continue; }
      const response = await hfFetch(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.name}`, { fetcher: this.fetcher, signal });
      const output = await fs.open(partial, 'w'); let received = 0;
      try { for await (const chunk of response.body) {
        await output.write(chunk); received += chunk.length; job.bytes += chunk.length;
        if (Date.now() - lastUpdate > 300) { this.publish(); lastUpdate = Date.now(); }
      } } finally { await output.close(); }
      if (received !== file.size) throw new Error(`${file.name} 下载未完成，请重试`);
      await fs.rename(partial, target);
    }
  }
  async import(directory, task, engine) {
    await this.ready;
    if (!path.isAbsolute(directory) || !['asr', 'tts'].includes(task)) throw new Error('请选择语音模型目录');
    const names = await fs.readdir(directory); const pick = pattern => names.find(name => pattern.test(name));
    const tokens = pick(/tokens.*\.txt$/i) || pick(/.*tokens\.txt$/i);
    let config;
    if (['senseVoice', 'paraformer'].includes(engine) && task === 'asr') config = { model: pick(/int8.*\.onnx$/i) || pick(/\.onnx$/i), tokens };
    else if (['kokoro', 'vits'].includes(engine) && task === 'tts') config = { model: pick(/\.onnx$/i), tokens, lexicon: names.filter(name => /^lexicon.*\.txt$/.test(name)).join(','), ...(engine === 'kokoro' ? { voices: 'voices.bin' } : {}) };
    else throw new Error('所选引擎与模型类型不匹配');
    if (Object.values(config).some(value => !value)) throw new Error('目录中缺少模型、词表或发音词典');
    const files = Object.values(config).flatMap(value => value.split(','));
    for (const file of files) await fs.access(path.join(directory, file));
    const existing = this.imports.find(model => model.directory === directory && model.engine === engine);
    if (existing) return existing.id;
    const id = randomUUID(); this.imports.push({ id, name: path.basename(directory), task, engine, directory, config, files, languages: '', size: 0 });
    await writeJson(this.file, this.imports); this.publish(); return id;
  }
  async stop() { for (const { controller } of this.operations?.values() || []) controller.abort(); await Promise.all([...this.operations?.values() || []].map(item => item.operation)); }
}
module.exports = { SpeechModels, presets };
