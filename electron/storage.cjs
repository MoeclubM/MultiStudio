const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, file); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}
async function boundedBody(response, maximum) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maximum) { await response.body?.cancel().catch(() => {}); throw new Error('服务响应超过大小限制'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function secretStore(safeStorage) {
  return {
    encode(value) { return value && safeStorage?.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : null; },
    decode(value) { try { return value && safeStorage?.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : ''; } catch { return ''; } },
    available() { return !!safeStorage?.isEncryptionAvailable(); },
  };
}
module.exports = { readJson, writeJson, boundedBody, secretStore };
