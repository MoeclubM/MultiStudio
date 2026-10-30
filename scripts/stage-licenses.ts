import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { download } from './runtime-artifacts.ts';

const destination = path.resolve('.cache/package-licenses');
await fs.mkdir(destination, { recursive: true });
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const packages = [];
for (const [location, entry] of Object.entries<any>(lock.packages)) {
  if (!location || entry.dev) continue;
  const directory = path.resolve(location);
  const metadata = await fs.readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!metadata) continue; // Platform-specific optional packages may be absent.
  const files = (await fs.readdir(directory)).filter(file => /^(license|licence|copying|notice)(\.|$|-)/i.test(file));
  const target = path.join(destination, 'npm', location.replaceAll('node_modules/', ''));
  await fs.mkdir(target, { recursive: true });
  for (const file of files) await fs.cp(path.join(directory, file), path.join(target, file), { recursive: true });
  packages.push({ name: metadata.name, version: metadata.version, license: metadata.license || entry.license || 'See upstream', repository: metadata.repository, notices: files });
}
await fs.writeFile(path.join(destination, 'npm-packages.json'), JSON.stringify(packages, null, 2));
const assets = JSON.parse(await fs.readFile('native/obj/project.assets.json', 'utf8'));
for (const library of Object.values<any>(assets.libraries)) {
  if (library.type !== 'package') continue;
  const source = path.join(process.env.NUGET_PACKAGES || path.join(os.homedir(), '.nuget/packages'), library.path);
  for (const file of (await fs.readdir(source).catch(() => [])).filter(file => /license|notice|copying/i.test(file))) {
    const target = path.join(destination, 'nuget', library.path, file);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.cp(path.join(source, file), target, { recursive: true });
  }
}
const runtimeConfig = JSON.parse(await fs.readFile('.cache/native-host/multistudio-native.runtimeconfig.json', 'utf8'));
const dotnetVersion = runtimeConfig.runtimeOptions.includedFrameworks[0].version;
const upstream = [
  ['sherpa-onnx.txt', 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v2.0.1/LICENSE'],
  ['onnxruntime-1.28.2.txt', 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/LICENSE'],
  [`dotnet-${dotnetVersion}.txt`, `https://raw.githubusercontent.com/dotnet/runtime/v${dotnetVersion}/LICENSE.TXT`],
  [`dotnet-${dotnetVersion}-third-party.txt`, `https://raw.githubusercontent.com/dotnet/runtime/v${dotnetVersion}/THIRD-PARTY-NOTICES.TXT`],
  ['cuda-license.html', 'https://docs.nvidia.com/cuda/archive/13.3.0/eula/index.html'],
];
for (const [file, url] of upstream) {
  if (file.startsWith('cuda-') && process.platform !== 'win32') continue;
  const target = path.join(destination, file);
  if (!await fs.access(target).then(() => true).catch(() => false)) await download(url, target);
}
console.log(`已收集 ${packages.length} 个运行依赖的许可信息。`);
