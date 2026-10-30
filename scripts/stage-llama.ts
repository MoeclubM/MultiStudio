import path from 'node:path';
import fs from 'node:fs/promises';
import { versions, command, download, installArchive, copyRuntime, findExecutable, current, mark } from './runtime-artifacts.ts';

const version = versions.llamaCpp;
const artifact = process.platform === 'win32' && process.arch === 'x64' ? `llama-${version}-bin-win-vulkan-x64.zip`
  : process.platform === 'darwin' ? `llama-${version}-bin-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz` : '';
if (!artifact) throw new Error('当前桌面平台没有匹配的 llama.cpp 运行库');
const directory = path.resolve('.runtime/llama'), executable = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
if (!await current(directory, version, [executable, 'LICENSE'])) {
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${version}/${artifact}`;
  await installArchive(url, async unpacked => copyRuntime(await findExecutable(unpacked, executable), directory, [executable]));
  await download(`https://raw.githubusercontent.com/ggml-org/llama.cpp/${version}/LICENSE`, path.join(directory, 'LICENSE'));
  await mark(directory, version, url);
}
if (process.platform === 'win32') {
  const portable = path.resolve('.runtime/audiocpp');
  for (const file of (await fs.readdir(portable)).filter(file => /^(msvcp140|vcruntime140|concrt140|vccorlib140|ucrtbase).*\.dll$/i.test(file))) await fs.copyFile(path.join(portable, file), path.join(directory, file));
}
await command(path.join(directory, executable), ['--version']);
