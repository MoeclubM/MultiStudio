const { StringDecoder } = require('node:string_decoder');
async function* sseEvents(body) {
  const decoder = new StringDecoder('utf8'); let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.write(Buffer.from(chunk)).replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') return;
      yield JSON.parse(data);
    }
  }
}
module.exports = { sseEvents };
