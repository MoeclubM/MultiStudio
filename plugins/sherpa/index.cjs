const path = require('node:path');
const { LocalSpeech } = require('./runtime.cjs');
const { SpeechModels } = require('./models.cjs');
const { randomUUID } = require('node:crypto');

module.exports.backends = {
  sherpa: {
    create(host) {
      const runtime = new LocalSpeech({ createWorker: host.createWorker, ...(host.packaged ? { modulePath: path.join(host.resourcesPath, 'speech-runtime/node_modules/sherpa-onnx-node/sherpa-onnx.js'), workerPath: path.join(host.resourcesPath, 'app.asar.unpacked/plugins/sherpa/speech-worker.cjs') } : {}) });
      const models = new SpeechModels(host.dataDir, { fetcher: host.fetcher, emit: host.emit, modelDirectory: host.library.settings.storageDirectory });
      async function selected(config, task) { return models.get(config.modelId || (await models.list()).find(model => model.task === task && model.status === 'ready')?.id, task); }
      return {
        models,
        async preflight(config, task) { await selected(config, task); },
        async transcribe(config, audioId, signal) { return (await runtime.run('asr', { model: await selected(config, 'asr'), input: await host.speech.validateAudio(audioId), language: config.language, threads: config.threads }, signal)).text; },
        async synthesize(config, text, signal) {
          const id = randomUUID(), output = path.join(host.speech.directory, id + '.wav');
          await runtime.run('tts', { model: await selected(config, 'tts'), output, text, threads: config.threads, speakerId: config.speakerId, speed: config.speed }, signal);
          return id;
        },
        async stop() { await models.stop(); await runtime.stop(); },
      };
    },
  },
};
module.exports.nodes = {
  'sherpa.asr': {
    preflight: ({ host, config }) => host.inference.get('sherpa').preflight(config, 'asr'),
    async execute({ host, config, input, signal }) { return { type: 'text', text: await host.inference.get('sherpa').transcribe(config, input.audioId, signal) }; },
  },
  'sherpa.tts': {
    preflight: ({ host, config }) => host.inference.get('sherpa').preflight(config, 'tts'),
    async execute({ host, config, input, signal }) { return { type: 'audio', audioId: await host.inference.get('sherpa').synthesize(config, input.text, signal) }; },
  },
};
