const { textNode } = require('../../electron/text-node.cjs');
const path = require('node:path');
const { LlamaServer } = require('./runtime.cjs');
const initial = () => ({ phase: 'unloaded', activeModelId: null, lastError: null, loadOptions: null });
module.exports.backends = {
  llmcore: {
    accepts: model => model.kind === 'text' && model.architecture !== 'audiocpp',
    create(host) {
      const runtime = new LlamaServer(path.join(host.runtimeDirectory, 'llama'));
      let state = initial(), loaded, queue = Promise.resolve();
      const publish = patch => { state = { ...state, ...patch }; host.emit('model-library-changed', null); };
      const serialized = operation => { const task = queue.then(operation); queue = task.catch(() => {}); return task; };
      async function selected(id) {
        if (id || state.activeModelId) return host.library.resolve(id || state.activeModelId, 'llmcore');
        const models = (await host.library.catalogue()).models.filter(model => model.installed && model.loadable && model.backends.includes('llmcore'));
        const model = models.find(model => model.id === host.library.settings.lastModelId) || models[0];
        if (!model) throw new Error('请选择已安装的文本模型');
        return model;
      }
      async function load(entry, options) {
        const key = JSON.stringify([entry.path, options]); if (loaded === key && runtime.running) return;
        publish({ phase: 'loading', lastError: null });
        try { await runtime.load(entry.path, options); loaded = key; publish({ phase: 'ready', activeModelId: entry.id, loadOptions: options }); }
        catch (error) { loaded = null; publish({ ...initial(), phase: 'error', lastError: error.message }); throw error; }
      }
      async function unload() { await runtime.stop(); loaded = null; publish(initial()); }
      return {
        status: () => state,
        load: (entry, options) => serialized(() => load(entry, options)),
        unload: () => serialized(unload),
        async preflight(config) { await selected(config.modelId); },
        generate: args => serialized(async () => {
          const entry = await selected(args.modelId), previous = state.activeModelId, previousOptions = state.loadOptions;
          await load(entry, { ...host.library.settings.loadOptions, useGpu: args.device === 'cpu' ? false : args.device && args.device !== 'auto' ? true : host.library.settings.loadOptions.useGpu });
          if (host.library.settings.lastModelId !== entry.id) await host.library.persist(settings => { settings.lastModelId = entry.id; });
          try {
            args.signal?.throwIfAborted();
            return await runtime.generate(args);
          } finally {
            if (previous && previous !== entry.id) await load(await host.library.resolve(previous), previousOptions);
            else if (!previous) await unload();
          }
        }),
        stop: async () => { await runtime.stop(); await serialized(unload); },
      };
    },
  },
};
module.exports.nodes = { 'llmcore.text': textNode('llmcore'), 'llmcore.translate': textNode('llmcore', true) };
