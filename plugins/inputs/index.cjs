const audio = {
  bindInput(config, input) {
    if (typeof input.audioId !== 'string') throw new Error('音频输入需要 audioId');
    return { ...config, audioId: input.audioId, filename: '', duration: 0 };
  },
  migrate(data) {
    const { audioId = '', filename = '', duration = 0, source = 'file', deviceId = '', segmentSeconds = 4 } = data.config;
    if (source !== 'file' && !audioId) return { kind: 'live-audio-input', label: '实时音频', config: { source, deviceId, segmentSeconds, audioId, filename, duration } };
    return { ...data, label: ['音频输入', '音频文件'].includes(data.label) ? '音频文件' : data.label, config: { audioId, filename, duration } };
  },
  validate(config, { executable }) {
    if (executable && !config.audioId) throw new Error('请选择音频文件');
  },
  async preflight({ config, host }) { await host.speech.validateAudio(config.audioId); },
  async execute({ config, host }) { await host.speech.validateAudio(config.audioId); return { type: 'audio', audioId: config.audioId }; },
};
module.exports.nodes = {
  'text-input': {
    bindInput(config, input) {
      if (typeof input.text !== 'string') throw new Error('文本输入需要 text');
      return { ...config, text: input.text };
    },
    validate(config, { executable }) { if (executable && !config.text.trim()) throw new Error('文本输入为空'); },
    execute: ({ config }) => ({ type: 'text', text: config.text }),
  },
  'audio-input': audio,
};
