const { randomUUID } = require('node:crypto');

class Sentences {
  constructor({ config, emit, preview }) { Object.assign(this, { config, emit, preview }); this.consumed = 0; this.text = ''; this.segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' }); }
  push(value, utterance) {
    if (value.committed === false && value.partial) return;
    if (this.utterance?.id !== utterance.id) {
      clearTimeout(this.timer); this.utterance = utterance; this.consumed = 0; this.text = ''; this.pendingAt = null;
    }
    this.text = value.text;
    if (this.text.length > this.consumed) this.pendingAt ??= Date.now();
    this.drain(!value.partial);
  }
  boundary(text, final) {
    const sentence = [...this.segmenter.segment(text)].find(part => /(?:[。！？!?]|(?<!\d)\.)[”’"'）)]*\s*$/u.test(part.segment));
    if (sentence) return sentence.index + sentence.segment.length;
    const overdue = Date.now() - this.pendingAt >= this.config.maxWaitMs;
    if (text.length >= this.config.maxChars || overdue && text.length >= this.config.minChars) {
      const limit = Math.min(text.length, this.config.maxChars), head = text.slice(0, limit);
      const breaks = [...head.matchAll(/[，,、：:]\s*|\s+/gu)].filter(match => match.index + match[0].length >= this.config.minChars);
      if (breaks.length) return breaks.at(-1).index + breaks.at(-1)[0].length;
      return limit;
    }
    return final ? text.length : 0;
  }
  drain(final) {
    clearTimeout(this.timer);
    let pending = this.text.slice(this.consumed), boundary;
    while (pending && (boundary = this.boundary(pending, final))) {
      const text = pending.slice(0, boundary).trim(); this.consumed += boundary;
      if (text) this.emit({ type: 'text', text }, { id: randomUUID(), startedAt: new Date().toISOString() });
      pending = this.text.slice(this.consumed); this.pendingAt = pending ? Date.now() : null;
    }
    if (pending) {
      this.preview({ type: 'text', text: pending, partial: true }, this.utterance);
      if (pending.length >= this.config.minChars) this.timer = setTimeout(() => this.drain(false), Math.max(50, this.config.maxWaitMs - (Date.now() - this.pendingAt)));
    }
  }
  cancel() { clearTimeout(this.timer); }
}
module.exports = { Sentences };
