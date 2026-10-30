import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const output = path.resolve(process.env.MULTISTUDIO_RELEASE_DIR || 'release');
const app = process.platform === 'win32' ? path.join(output, 'win-unpacked') : path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'MultiStudio.app/Contents');
const resources = path.join(app, process.platform === 'win32' ? 'resources' : 'Resources');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const packed = JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json'));
assert.equal(packed.version, pkg.version);
const files: string[] = asar.listPackage(path.join(resources, 'app.asar'));
assert.ok(files.some(file => /[\\/]electron[\\/]api-server\.cjs$/.test(file)));
assert.ok(!files.some(file => /\.rs$|Cargo\.(toml|lock)$|[\\/](src-tauri|whisper|tests|node_modules)[\\/]/i.test(file)), '包内含有开发文件或已移除组件');
const runtime = path.join(resources, 'runtime');
const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'runtimes.json'), 'utf8'));
assert.ok(['base', 'offline'].includes(manifest.profile));
const offline = manifest.profile === 'offline';
const entries = await fs.readdir(runtime, { recursive: true });
assert.ok(!entries.some(file => /\.(gguf|onnx|safetensors|bin)$/i.test(file) || /(^|[\\/])(whisper|llmcore\.dll)([\\/]|$)/i.test(file)), '运行库目录含有权重或旧组件');
for (const file of ['licenses/npm-packages.json', 'runtime/runtimes.json']) await fs.access(path.join(resources, file));
for (const component of ['audiocpp', 'llama', ...(process.platform === 'win32' && offline ? ['audiocpp-cuda'] : [])]) await fs.access(path.join(runtime, component, 'LICENSE'));
if (process.platform === 'win32') {
  for (const name of ['multistudio-native.exe', 'hostfxr.dll', 'coreclr.dll', 'System.Private.CoreLib.dll']) await fs.access(path.join(resources, 'native', name));
  if (offline) for (const name of ['cublas64_13.dll', 'cublasLt64_13.dll', 'cudart64_13.dll', 'cufft64_12.dll', 'audiocpp_gguf.exe']) await fs.access(path.join(runtime, 'audiocpp-cuda', name));
  else assert.ok(!entries.some(file => file.startsWith('audiocpp-cuda')), '基础包不应附带 CUDA');
}
for (const [component, filename] of [['audiocpp', 'audiocpp_server'], ['llama', 'llama-server']]) {
  const result = spawnSync(path.join(runtime, component, filename + (process.platform === 'win32' ? '.exe' : '')), ['--version'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, `${component} 无法启动：${result.error?.message || result.stderr}`);
}
if (process.argv.includes('--installer')) {
  const filename = `MultiStudio-${pkg.version}-win-x64-${offline ? 'Offline-' : ''}Setup.exe`, file = path.join(output, filename);
  assert.ok((await fs.stat(file)).size > 1024 * 1024, '安装包大小异常');
  const handle = await fs.open(file, 'r'); const header = Buffer.alloc(2);
  try { await handle.read(header, 0, 2, 0); } finally { await handle.close(); }
  assert.equal(header.toString(), 'MZ', '安装包不是 Windows 可执行程序');
}
console.log(`桌面包结构、运行库、自带运行环境与版本检查通过：${pkg.version}`);
