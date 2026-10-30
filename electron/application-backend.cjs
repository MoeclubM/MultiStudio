const { EventEmitter } = require('node:events');
const path = require('node:path');
const { readJson, writeJson } = require('./storage.cjs');
const { ModelLibrary } = require('./model-library.cjs');
const LOCAL = 'http://127.0.0.1:18700/v1';
const unloaded = () => ({ phase: 'unloaded', activeModelId: null, lastError: null, loadOptions: null });

class ApplicationBackend extends EventEmitter {
  constructor(native, directory, fetcher) {
    super(); this.native = native; this.directory = directory; this.fetcher = fetcher;
    this.file = path.join(directory, 'live-translator.json');
    this.library = new ModelLibrary(directory, (name, value) => this.emit('event', name, value));
    native.on('event', (name, value) => this.emit('event', name, value)); native.on('failure', value => this.emit('failure', value));
    this.ready = this.open();
  }
  async open() {
    await Promise.all([this.native.ready, this.library.ready]);
    const current = await readJson(this.file, {});
    const previous = current.llm || {}, wasLocal = previous.baseUrl === LOCAL;
    this.defaultTextBackend = wasLocal ? 'llmcore' : 'openai';
    if (wasLocal && previous.llmModel && !this.library.settings.lastModelId) await this.library.persist(settings => { settings.lastModelId = previous.llmModel; });
    this.config = { llm: { baseUrl: wasLocal ? '' : previous.baseUrl || '', apiKey: previous.apiKey || '', llmModel: wasLocal ? '' : previous.llmModel || '' } };
    if (JSON.stringify(current) !== JSON.stringify(this.config)) await writeJson(this.file, this.config);
  }
  get engine() { return this.inference?.instances.get(this.activeBackend)?.status?.() || unloaded(); }
  async load(id) {
    const entry = await this.library.resolve(id);
    if (!entry.loadable) throw new Error('此模型没有可用的文本推理插件');
    if (this.activeBackend && this.activeBackend !== entry.backendId) await this.inference.get(this.activeBackend).unload?.();
    this.activeBackend = entry.backendId;
    await this.inference.get(entry.backendId).load(entry, this.library.settings.loadOptions);
    await this.library.persist(settings => { settings.lastModelId = entry.id; });
    return '模型已加载';
  }
  async invoke(command, args = {}) {
    await this.ready;
    switch (command) {
      case 'backend_info': case 'list_audio_devices': case 'native_audio_available': return this.native.invoke(command, args);
      case 'audio_capture_start': case 'audio_capture_stop': return this.native.invoke(command, args);
      case 'get_config': return structuredClone(this.config);
      case 'set_config': await writeJson(this.file, args.config); this.config = args.config; return this.config;
      case 'initialize': {
        if (this.library.settings.autoLoad) {
          const entry = (await this.library.catalogue()).models.find(model => model.id === this.library.settings.lastModelId);
          if (entry?.loadable) await this.load(entry.id);
        }
        return;
      }
      case 'get_model_library': return { ...await this.library.catalogue(), engine: this.engine };
      case 'import_model': return this.library.import(args);
      case 'add_model_directory': return this.library.add(args.path);
      case 'remove_model_directory': return this.library.remove(args.path);
      case 'forget_model': return this.library.forget(args.modelId);
      case 'set_model_load_options': return this.library.configure(args.options, args.autoLoad);
      case 'load_local_model': return this.load(args.modelId);
      case 'unload_local_model': if (this.activeBackend) await this.inference.get(this.activeBackend).unload(); return;
      case 'workflow_generate_local': {
        const entry = await this.library.resolve(args.modelId || this.engine.activeModelId);
        return this.inference.get(entry.backendId).generate({ ...args, modelId: entry.id });
      }
      case 'test_llm': {
        if (!this.config.llm.baseUrl) throw new Error('请填写文本 API 地址');
        const cfg = this.config.llm, response = await this.fetcher(cfg.baseUrl.replace(/\/+$/, '') + '/models', { headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`文本服务 HTTP ${response.status}`); await response.body?.cancel(); return '连接成功';
      }
      case 'get_history': return readJson(path.join(this.directory, 'history.json'), []);
      default: throw new Error(`未实现的应用命令：${command}`);
    }
  }
  async stop() { await this.inference?.stop(); await this.native.stop(); }
}
module.exports = { ApplicationBackend, LOCAL };
