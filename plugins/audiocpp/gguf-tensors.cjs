const fs = require('node:fs');

// Only metadata and tensor descriptors are read; weight data is never scanned.
function embeddingType(file) {
  const fd = fs.openSync(file, 'r'); let position = 0;
  const read = size => { const bytes = Buffer.alloc(size); fs.readSync(fd, bytes, 0, size, position); position += size; return bytes; };
  const u32 = () => read(4).readUInt32LE(), u64 = () => Number(read(8).readBigUInt64LE());
  const string = () => read(u64()).toString('utf8');
  function skip(type) {
    if (type === 8) { const size = u64(); position += size; return; }
    if (type === 9) {
      const subtype = u32(), count = u64();
      if (subtype !== 8 && subtype !== 9) { position += [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8][subtype] * count; return; }
      for (let i = 0; i < count; i++) skip(subtype);
      return;
    }
    position += [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8][type];
  }
  try {
    const header = read(24); if (header.toString('ascii', 0, 4) !== 'GGUF') throw new Error('不是 GGUF 模型');
    const tensors = Number(header.readBigUInt64LE(8)), metadata = Number(header.readBigUInt64LE(16));
    for (let i = 0; i < metadata; i++) { string(); skip(u32()); }
    for (let i = 0; i < tensors; i++) {
      const name = string(), dimensions = u32(); position += dimensions * 8;
      const type = u32(); position += 8;
      if (name.endsWith('embed_tokens.weight')) return type;
    }
    return null;
  } finally { fs.closeSync(fd); }
}
module.exports = { embeddingType };
