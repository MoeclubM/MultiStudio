const path = require('node:path');
const { AudioCpp } = require('./runtime.cjs');
const { families } = require('./families.cjs');
const { runtimePackages } = require('./packages.cjs');

module.exports.backends = {
  audiocpp: {
    runtimePackages,
    accepts: model => !!families[model.family],
    create(host) {
      const runtime = new AudioCpp(host.dataDir, path.join(host.runtimeDirectory, 'audiocpp'), host.library.settings.cacheDirectory, host.runtimes);
      let queue = Promise.resolve();
      const serial = operation => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; };
      async function selected(config, family) {
        const installed = (await host.library.catalogue()).models.filter(entry => entry.family === family && entry.installed);
        const model = config.modelPath ? installed.find(entry => path.resolve(entry.path) === path.resolve(config.modelPath)) : installed[0];
        if (!model) throw new Error('请选择已安装的 ' + families[family].label + ' 模型');
        return model;
      }
      async function options(config, family) {
        const sessionOptions = { ...families[family].session, ...JSON.parse(config.sessionOptions || '{}') };
        if (family === 'sense_asr' && !sessionOptions['sense_asr.vad_model_path']) {
          const vad = (await host.library.catalogue()).models.find(model => ['silero_vad', 'firered_vad', 'pulsevad'].includes(model.family) && model.installed);
          if (!vad) throw new Error('SenseVoice 需要已安装的 VAD 模型，或在引擎参数中指定 sense_asr.vad_model_path');
          sessionOptions['sense_asr.vad_model_path'] = vad.path;
        }
        const { language, ...settings } = config;
        return { ...settings, ...(families[family].task === 'asr' || families[family].language ? { language } : {}), family, task: families[family].task, sessionOptions, requestOptions: JSON.parse(config.requestOptions || '{}') };
      }
      const models = { async list() { return (await host.library.catalogue()).models.filter(entry => families[entry.family]).map(entry => ({ id: entry.id, name: entry.name, task: families[entry.family].task, engine: entry.family, directory: path.dirname(entry.path), path: entry.path, size: entry.sizeBytes, languages: '', status: entry.installed ? 'ready' : 'missing' })); } };
      return {
        models, status: () => ({ backend: runtime.backend || null }), diagnostics: () => runtime.diagnostic,
        async preflight(config, family, signal) {
          const model = await selected(config, family); await options(config, family);
          if (families[family].task === 'tts') {
            if (!config.referenceAudioId) throw new Error('请选择参考音频');
            await host.speech.validateAudio(config.referenceAudioId);
          }
          await runtime.ensureBackend(config.device, signal);
          return model;
        },
        transcribe: (config, audioId, signal, family) => serial(async () => {
          signal?.throwIfAborted();
          const model = await selected(config, family);
          return runtime.transcribe(model.path, await host.speech.validateAudio(audioId), await options(config, family), signal);
        }),
        async openStream(config, signal, onUpdate, family) {
          return new Promise((resolve, reject) => {
            void serial(async () => {
              signal?.throwIfAborted();
              const model = await selected(config, family), stream = await runtime.openStream(model.path, await options(config, family), signal, onUpdate);
              resolve(stream); await stream.done;
            }).catch(reject);
          });
        },
        synthesize: (config, text, signal, family) => serial(async () => {
          signal?.throwIfAborted();
          const model = await selected(config, family), reference = await host.speech.validateAudio(config.referenceAudioId);
          const audio = await runtime.synthesize(model.path, text, reference, await options(config, family), signal);
          return (await host.speech.saveInput(audio)).id;
        }),
        stop: () => runtime.stop(),
      };
    },
  },
};
module.exports.nodes = Object.fromEntries(Object.entries(families).map(([family, definition]) => [definition.kind, {
  preflight: ({ host, config, signal }) => host.inference.get('audiocpp').preflight(config, family, signal),
  ...(definition.streaming ? {
    canStream: () => true,
    openStream: ({ host, config, signal, onUpdate }) => host.inference.get('audiocpp').openStream(config, signal, onUpdate, family),
  } : {}),
  async execute({ host, config, input, signal }) {
    const backend = host.inference.get('audiocpp');
    return definition.task === 'asr'
      ? { type: 'text', text: await backend.transcribe(config, input.audioId, signal, family) }
      : { type: 'audio', audioId: await backend.synthesize(config, input.text, signal, family) };
  },
}]));
