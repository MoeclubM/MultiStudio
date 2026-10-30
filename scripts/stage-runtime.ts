import fs from 'node:fs/promises';
import path from 'node:path';
import { versions, command, current, copyRuntime } from './runtime-artifacts.ts';

const profile = process.env.MULTISTUDIO_PACKAGE_PROFILE || 'base';
if (!['base', 'offline'].includes(profile)) throw new Error('打包类型需要 base 或 offline');
// The base package installs CUDA when first requested; offline builds include it.
await command(process.execPath, ['--experimental-strip-types', 'scripts/stage-audiocpp.ts'], { ...process.env, MULTISTUDIO_AUDIO_CUDA: process.platform === 'win32' && profile === 'offline' ? '1' : '0' });
await command(process.execPath, ['--experimental-strip-types', 'scripts/stage-llama.ts']);
const destination = path.resolve('.cache/package-runtime');
if (!destination.startsWith(path.resolve('.cache') + path.sep)) throw new Error('运行库暂存目录不在工作区缓存中');
await fs.rm(destination, { recursive: true, force: true }); await fs.mkdir(destination, { recursive: true });
const entries = [{ name: 'audiocpp', version: versions.audioCpp }, { name: 'llama', version: versions.llamaCpp }];
if (process.platform === 'win32' && profile === 'offline') entries.push({ name: 'audiocpp-cuda', version: versions.audioCpp });
for (const entry of entries) {
  const source = path.resolve('.runtime', entry.name);
  if (!await current(source, entry.version, ['LICENSE'])) throw new Error(`缺少已准备的运行库：${entry.name}`);
  const target = path.join(destination, entry.name);
  await copyRuntime(source, target, [process.platform === 'win32' ? 'audiocpp_server.exe' : 'audiocpp_server', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server', ...(entry.name === 'audiocpp-cuda' ? ['audiocpp_gguf.exe'] : [])], process.platform === 'win32');
  if (entry.name === 'llama') await fs.rm(path.join(target, 'llama-cli-impl.dll'), { force: true });
  await fs.copyFile(path.join(source, 'runtime.json'), path.join(target, 'runtime.json'));
}
await fs.writeFile(path.join(destination, 'runtimes.json'), JSON.stringify({ profile, platform: process.platform, arch: process.arch, entries }, null, 2));
console.log(`发布运行库已准备：${entries.map(entry => entry.name).join(', ')}，不包含模型权重。`);
