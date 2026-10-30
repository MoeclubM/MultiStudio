const { randomUUID, createHash } = require('node:crypto');

function textNode(backendId, translate = false) {
  return {
    preflight: ({ host, config }) => host.inference.get(backendId).preflight(config, 'text'),
    validate(config, { executable }) { if (executable && (translate ? !config.targetLanguage.trim() : !config.prompt.includes('{input}'))) throw new Error(translate ? '请填写目标语言' : '提示词缺少 {input}'); },
    async execute({ host, node, config, input, signal, onUpdate }) {
      const prompt = translate ? `将以下${config.sourceLanguage || '自动检测语言'}文本翻译为${config.targetLanguage}，忠实保留原意，只输出译文。\n\n${input.text}` : config.prompt.replaceAll('{input}', input.text);
      const turns = translate ? config.contextSentences : config.rememberHistory ? config.historyLimit : 0;
      const key = turns ? host.contextKey(host.active.workflowId, node.id) : null;
      const signature = createHash('sha256').update(JSON.stringify([backendId, config, host.backend.config?.llm.baseUrl, host.backend.config?.llm.llmModel])).digest('hex');
      const history = key && host.contexts[key]?.signature === signature ? host.contexts[key].messages.slice(-turns * 2) : [];
      const messages = [...(!translate && config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []), ...history, { role: 'user', content: prompt }];
      const text = await host.inference.get(backendId).generate({ ...config, messages, signal, onUpdate, requestId: randomUUID() });
      signal.throwIfAborted();
      if (!text?.trim()) throw new Error('模型未返回文字');
      if (key) await host.writeContext(key, { signature, messages: [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text }].slice(-turns * 2) });
      return { type: 'text', text };
    },
  };
}
module.exports = { textNode };
