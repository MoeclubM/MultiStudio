const http = require('node:http');
const { StringDecoder } = require('node:string_decoder');

function transcribeStream(url, { signal, onUpdate }) {
  let ended = false, complete = false, text = '', request;
  const done = new Promise((resolve, reject) => {
    request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked', Accept: 'text/event-stream' } }, async response => {
      try {
        if (response.statusCode !== 200) { let body = ''; for await (const chunk of response) body += chunk; throw new Error(`语音流式接口 HTTP ${response.statusCode}：${body.slice(0, 1000)}`); }
        const decoder = new StringDecoder('utf8'); let buffer = '';
        for await (const chunk of response) {
          buffer += decoder.write(chunk).replace(/\r\n/g, '\n');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data || data === '[DONE]') continue;
            const event = JSON.parse(data);
            if (event.type === 'error' || event.error) throw new Error(event.error?.message || event.message || String(event.error));
            if (event.type === 'transcript.text.delta') { text += event.delta; await onUpdate({ text, final: false, committed: true }); }
            if (event.type === 'transcript.text.partial') await onUpdate({ text: event.text, final: false, committed: false });
            if (event.type === 'transcript.text.done') { text = event.text; complete = true; await onUpdate({ text, final: true, committed: true }); }
          }
        }
        if (!complete) throw new Error('语音识别流意外结束');
        resolve(text);
      } catch (error) { request.destroy(); reject(error); }
    });
    request.on('error', reject);
    request.flushHeaders();
  });
  const abort = () => request.destroy(signal.reason || new Error('识别已停止'));
  signal?.addEventListener('abort', abort, { once: true });
  done.finally(() => signal?.removeEventListener('abort', abort)).catch(() => {});
  return {
    done,
    write(samples) {
      if (ended) return;
      const buffer = Buffer.allocUnsafe(samples.length * 2);
      samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
      request.write(buffer);
    },
    finish() { if (!ended) { ended = true; request.end(Buffer.alloc(9600)); } return done; },
    cancel() { ended = true; request.destroy(new Error('识别已停止')); },
  };
}
module.exports = { transcribeStream };
