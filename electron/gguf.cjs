const fs = require('node:fs');

// Reads the format header and selected metadata, never the model weight data.
function metadata(file) {
  const descriptor = fs.openSync(file, 'r'); let position = 0;
  const read = size => { const bytes = Buffer.alloc(size); fs.readSync(descriptor, bytes, 0, size, position); position += size; return bytes; };
  const u32 = () => read(4).readUInt32LE(), u64 = () => Number(read(8).readBigUInt64LE());
  const string = () => read(u64()).toString('utf8');
  const widths = [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8];
  function skip(type) {
    if (type === 8) { const size = u64(); position += size; }
    else if (type === 9) { const subtype = u32(), length = u64(); if (subtype !== 8 && subtype !== 9) position += widths[subtype] * length; else for (let i = 0; i < length; i++) skip(subtype); }
    else position += widths[type];
  }
  try {
    const header = read(24);
    if (header.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4))) throw new Error('需要 GGUF v2/v3 模型');
    const result = {}, count = Number(header.readBigUInt64LE(16));
    for (let index = 0; index < count; index++) {
      const key = string(), type = u32();
      if (['general.architecture', 'general.name', 'audiocpp.model_spec.family'].includes(key) && type === 8) result[key] = string();
      else skip(type);
    }
    return result;
  } finally { fs.closeSync(descriptor); }
}
module.exports = { metadata };
