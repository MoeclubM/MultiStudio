const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { textNode } = require('../../electron/text-node.cjs');
const { validateBase, wave } = require('../../electron/speech.cjs');
const { boundedBody } = require('../../electron/storage.cjs');
const { sseEvents } = require('../../electron/sse.cjs');

module.exports.backends = {
  openai: {
    create(host) {
      const controllers = new Set();
      async function request(base, route, key, init, signal) {
        if (!base) throw new Error('请在连接设置填写服务地址');
        const controller = new AbortController(); controllers.add(controller);
        const response = await host.fetcher(`${validateBase(base)}/${route}`, { ...init, headers: { ...init.headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000), ...(signal ? [signal] : [])]) }).catch(error => { controllers.delete(controller); throw error; });
        if (!response.ok) { controllers.delete(controller); await response.body?.cancel(); throw new Error(`模型服务 HTTP ${response.status}`); }
        return { response, release: () => controllers.delete(controller) };
      }
      return {
        async preflight(config, task) {
          const cfg = task === 'text' ? host.backend.config.llm : host.speech.settings;
          if (!validateBase(cfg.baseUrl)) throw new Error('请配置远程模型服务');
        },
        async generate(config) {
          const cfg = host.backend.config.llm, model = config.model || cfg.llmModel;
          if (!model) throw new Error('请填写文本服务模型名');
          const { response, release } = await request(cfg.baseUrl, 'chat/completions', cfg.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: config.messages, temperature: config.temperature, max_tokens: config.maxTokens, stream: !!config.onUpdate }) }, config.signal);
          try {
            if (config.onUpdate && response.headers.get('content-type')?.includes('text/event-stream')) {
              let text = ''; for await (const event of sseEvents(response.body)) { if (event.error) throw new Error(event.error.message); const part = event.choices?.[0]?.delta?.content; if (typeof part === 'string') { text += part; await config.onUpdate(text); } } return text;
            }
            return JSON.parse((await boundedBody(response, 2 * 1024 * 1024)).toString()).choices?.[0]?.message?.content;
          } finally { release(); }
        },
        async transcribe(config, audioId, signal) {
          const cfg = host.speech.settings, input = await host.speech.validateAudio(audioId), form = new FormData();
          form.append('file', new Blob([await fs.readFile(input)], { type: 'audio/wav' }), 'input.wav'); form.append('model', config.model || cfg.asrModel); form.append('response_format', 'json');
          if (config.language) form.append('language', config.language);
          const { response, release } = await request(cfg.baseUrl, 'audio/transcriptions', host.speech.apiKey, { method: 'POST', body: form }, signal);
          try { return JSON.parse((await boundedBody(response, 1024 * 1024)).toString()).text || ''; } finally { release(); }
        },
        async synthesize(config, text, signal) {
          const cfg = host.speech.settings;
          const { response, release } = await request(cfg.baseUrl, 'audio/speech', host.speech.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model || cfg.ttsModel, voice: config.voice || cfg.voice, speed: config.speed, input: text, response_format: 'wav' }) }, signal);
          try { const bytes = await boundedBody(response, 25 * 1024 * 1024); wave(bytes); const id = randomUUID(); await fs.writeFile(path.join(host.speech.directory, id + '.wav'), bytes); return id; } finally { release(); }
        },
        stop() { for (const controller of controllers) controller.abort(); controllers.clear(); },
      };
    },
  },
};
module.exports.nodes = {
  'openai.text': textNode('openai'), 'openai.translate': textNode('openai', true),
  'openai.asr': {
    preflight: ({ host, config }) => host.inference.get('openai').preflight(config, 'asr'),
    async execute({ host, config, input, signal }) { return { type: 'text', text: await host.inference.get('openai').transcribe(config, input.audioId, signal) }; },
  },
  'openai.tts': {
    preflight: ({ host, config }) => host.inference.get('openai').preflight(config, 'tts'),
    async execute({ host, config, input, signal }) { return { type: 'audio', audioId: await host.inference.get('openai').synthesize(config, input.text, signal) }; },
  },
};
