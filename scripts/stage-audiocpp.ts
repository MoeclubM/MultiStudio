import path from 'node:path';
import { versions, command, installArchive, copyRuntime, findExecutable, current, mark } from './runtime-artifacts.ts';

const version = versions.audioCpp, windows = process.platform === 'win32' && process.arch === 'x64';
const artifact = windows ? 'windows-x64-vulkan-portable.zip'
  : process.platform === 'darwin' ? `macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}-metal.tar.gz` : '';
if (!artifact) throw new Error('当前桌面平台没有匹配的 audio.cpp 运行库');
const executable = process.platform === 'win32' ? 'audiocpp_server.exe' : 'audiocpp_server';
const origin = `https://github.com/0xShug0/audio.cpp/releases/download/${version}/audio-${version}`;
async function install(directory: string, artifact: string, required: string[] = [], cuda = false) {
  if (await current(directory, version, [executable, ...required, 'LICENSE'])) return;
  await installArchive(`${origin}-bin-${artifact}`, async unpacked => {
    await copyRuntime(await findExecutable(unpacked, executable), directory, [executable, ...(cuda ? ['audiocpp_gguf.exe'] : [])]);
  });
  if (cuda) await installArchive(`${origin}-cudart-${artifact}`, unpacked => copyRuntime(unpacked, directory, []));
  await command(path.join(directory, executable), ['--version']);
  await mark(directory, version, `${origin}-bin-${artifact}`);
  if (!await current(directory, version, [executable, ...required, 'LICENSE'])) throw new Error(`audio.cpp 运行库不完整：${directory}`);
}
await install(path.resolve('.runtime/audiocpp'), artifact);
const cuda = process.env.MULTISTUDIO_AUDIO_CUDA;
if (windows && cuda === '1') {
  await install(path.resolve('.runtime/audiocpp-cuda'), 'windows-x64-cuda13.3.zip', ['audiocpp_gguf.exe', 'cublas64_13.dll', 'cublasLt64_13.dll', 'cudart64_13.dll', 'cufft64_12.dll'], true);
}
