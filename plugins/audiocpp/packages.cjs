const fs = require('node:fs');
const path = require('node:path');

function runtimePackages(directory) {
  if (!directory || process.platform !== 'win32' || process.arch !== 'x64') return [];
  const metadata = path.join(directory, 'audiocpp', 'runtime.json');
  if (!fs.existsSync(metadata)) return [];
  const { version } = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  const origin = `https://github.com/0xShug0/audio.cpp/releases/download/${version}/audio-${version}`;
  return [{
    id: 'audiocpp-cuda', name: 'NVIDIA CUDA', version, installedBytes: 1080000000,
    executables: ['audiocpp_server.exe', 'audiocpp_gguf.exe'], directories: ['model_specs'],
    required: ['audiocpp_server.exe', 'audiocpp_gguf.exe', 'ggml-cuda.dll', 'cublas64_13.dll', 'cublasLt64_13.dll', 'cudart64_13.dll', 'cufft64_12.dll', 'LICENSE'],
    archives: [
      { url: `${origin}-bin-windows-x64-cuda13.3.zip`, size: 277336614, executable: 'audiocpp_server.exe' },
      { url: `${origin}-cudart-windows-x64-cuda13.3.zip`, size: 575457454 },
    ],
  }];
}
module.exports = { runtimePackages };
