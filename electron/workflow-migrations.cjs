const { nodeRegistry } = require('./node-registry.cjs');

// Migrate saved graphs once; runtime dispatch uses only current plugin fields.
function migrateNode(data, defaultTextBackend = 'llmcore') {
  const config = data.config;
  let kind = data.kind;
  if (kind === 'asr') kind = config.provider === 'api' ? 'openai.asr' : config.engine === 'r2t2' || config.modelPath ? 'audiocpp.asr' : 'sherpa.asr';
  else if (kind === 'tts') kind = config.provider === 'api' ? 'openai.tts' : 'sherpa.tts';
  else if (kind === 'translate' || kind === 'text-model') {
    const backend = config.provider === 'api' ? 'openai' : config.provider === 'local' ? 'llmcore' : defaultTextBackend;
    kind = backend + (kind === 'translate' ? '.translate' : '.text');
  }
  const definition = nodeRegistry.definitions[kind];
  if (!definition) return data;
  const oldDevice = Object.hasOwn(definition.defaults, 'device') && Object.hasOwn(config, 'useGpu');
  if (kind === data.kind && !oldDevice) return data;
  const next = { ...definition.defaults, ...config };
  if (oldDevice) { next.device = config.device || (config.useGpu === false ? 'cpu' : 'auto'); delete next.useGpu; }
  return { ...data, kind, label: kind === data.kind ? data.label : definition.label, config: Object.fromEntries(Object.entries(next).filter(([key]) => Object.hasOwn(definition.defaults, key))) };
}
module.exports = { migrateNode };
