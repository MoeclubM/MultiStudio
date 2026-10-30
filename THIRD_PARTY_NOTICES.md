# Third-party components

MultiStudio includes open-source software and platform runtime components. Their
licenses apply separately from MultiStudio's MIT license. Full license files
collected during packaging are in `resources/licenses/`, and inference runtime
licenses accompany each component in `resources/runtime/`.

| Component | Source | License |
| --- | --- | --- |
| Electron / Chromium | https://github.com/electron/electron | MIT / third-party notices distributed with Electron |
| React, React Router, Zustand, Radix UI, Tailwind CSS | npm package metadata in resources/licenses/npm-packages.json | Individual package licenses |
| React Flow | https://github.com/xyflow/xyflow | MIT |
| Lucide | https://github.com/lucide-icons/lucide | ISC |
| audio.cpp | https://github.com/0xShug0/audio.cpp | Apache-2.0 |
| llama.cpp / GGML | https://github.com/ggml-org/llama.cpp | MIT |
| sherpa-onnx | https://github.com/k2-fsa/sherpa-onnx | Apache-2.0 |
| ONNX Runtime | https://github.com/microsoft/onnxruntime | MIT |
| .NET runtime | https://github.com/dotnet/runtime | MIT and included third-party notices |
| NAudio | https://github.com/naudio/NAudio | MIT |
| SoundFlow | https://github.com/LSXPrime/SoundFlow | MIT |
| MiniAudio | https://github.com/mackron/miniaudio | Public domain / MIT-0 |
| NVIDIA CUDA runtime / cuBLAS | https://docs.nvidia.com/cuda/eula/ | NVIDIA CUDA Toolkit license |

Model weights are not included in the installer. Their respective authors'
licenses apply to separately downloaded models.
