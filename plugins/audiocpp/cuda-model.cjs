const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readJson, writeJson } = require('../../electron/storage.cjs');
const { embeddingType } = require('./gguf-tensors.cjs');

async function cudaModel(model, directory, runtimeDirectory, environment, signal) {
  // Released ggml CUDA builds cannot gather Q2_K embedding rows. Preserve all
  // other quantized tensors and cache just this compatibility conversion.
  if (embeddingType(model) !== 10) return model;
  const stat = await fs.stat(model), cache = path.join(directory, 'model-cache', path.basename(model, '.gguf') + '-cuda.gguf');
  const metadata = await readJson(cache + '.json', null);
  if (metadata?.source === model && metadata.modified === stat.mtimeMs && metadata.size === stat.size && await fs.access(cache).then(() => true).catch(() => false)) return cache;
  await fs.mkdir(path.dirname(cache), { recursive: true });
  const converter = path.join(runtimeDirectory, 'audiocpp_gguf.exe');
  await fs.access(converter);
  const child = spawn(converter, ['--input', model, '--output', cache, '--type', 'orig', '--keep-type', 'thinker.model.embed_tokens.weight=f16', '--family', 'confucius4_r2t2', '--model-spec', path.join(runtimeDirectory, 'model_specs', 'confucius4_r2t2.json'), '--overwrite'], { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
  const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true });
  try {
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Q4 显卡格式准备失败：${diagnostic || code}`))); });
    signal?.throwIfAborted();
    await writeJson(cache + '.json', { source: model, modified: stat.mtimeMs, size: stat.size });
    return cache;
  } finally { signal?.removeEventListener('abort', abort); }
}
module.exports = { cudaModel };
