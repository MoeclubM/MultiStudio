const subtitle = {
  execute: async ({ node, input, run, host }) => { await host.outputs.publish(node, input, run); return input; },
  preview: async ({ node, input, run, host }) => host.outputs.publish(node, input, run),
};
module.exports.nodes = {
  'subtitle-output': subtitle,
  'translated-subtitle-output': subtitle,
  'text-output': {
    execute: ({ input }) => input,
    preview: () => {},
    migrate(data) { return Object.hasOwn(data.config, 'overlay') ? data.config.overlay ? { kind: 'desktop-output', label: '桌面输出', config: {} } : { ...data, config: {} } : data; },
  },
  'audio-output': {
    execute({ config, input, host }) {
      if (config.autoplay) host.emit('workflow-playback', { audioId: input.audioId });
      return input;
    },
  },
  'desktop-output': {
    migrate(data) { return data.config.mode === 'overlay' ? { kind: 'subtitle-output', label: '原文字幕', config: { alwaysOnTop: data.config.alwaysOnTop ?? true } } : data; },
    async execute({ node, input, run, host }) { await host.outputs.publish(node, input, run); return input; },
    async preview({ node, input, run, host }) { await host.outputs.publish(node, input, run); },
  },
};
