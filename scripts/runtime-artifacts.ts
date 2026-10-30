import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const versions = JSON.parse(await fs.readFile(new URL('./runtime-versions.json', import.meta.url), 'utf8')) as { audioCpp: string; llamaCpp: string };
export const exists = (file: string) => fs.access(file).then(() => true).catch(() => false);
export async function command(program: string, args: string[], env = process.env) {
  const child = spawn(program, args, { env, windowsHide: true, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${program} 退出：${code ?? signal}`)));
  });
}
export async function download(url: string, file: string) {
  const args = ['--silent', '--show-error', '--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--output', file, url];
  try { await command('curl', ['--noproxy', '*', ...args]); }
  catch { await command('curl', args); }
}
export async function installArchive(url: string, copy: (directory: string) => Promise<void>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'multistudio-runtime-'));
  try {
    const archive = path.join(temporary, path.basename(new URL(url).pathname)), unpacked = path.join(temporary, 'unpacked');
    console.log(`准备 ${path.basename(archive)}`);
    await download(url, archive); await fs.mkdir(unpacked);
    await command('tar', ['-xf', archive, '-C', unpacked]);
    await copy(unpacked);
  } finally {
    if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('临时目录不在预期位置');
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
export async function copyRuntime(source: string, destination: string, executables: string[], link = false) {
  await fs.mkdir(destination, { recursive: true });
  const files = await fs.readdir(source, { recursive: true });
  for (const relative of files) {
    const filename = path.basename(relative);
    if (!executables.includes(filename) && !/\.(dll|dylib|so(?:\..*)?)$/i.test(filename) && !/license|notice|eula/i.test(relative) && !relative.split(path.sep).includes('model_specs')) continue;
    const from = path.join(source, relative);
    if (!(await fs.stat(from)).isFile()) continue;
    const to = path.join(destination, relative); await fs.mkdir(path.dirname(to), { recursive: true });
    if (link) await fs.link(from, to).catch(() => fs.copyFile(from, to));
    else await fs.copyFile(from, to);
    if (process.platform !== 'win32') await fs.chmod(to, (await fs.stat(from)).mode);
  }
}
export async function findExecutable(directory: string, executable: string) {
  const file = (await fs.readdir(directory, { recursive: true })).find(file => path.basename(file) === executable);
  if (!file) throw new Error(`运行库中没有 ${executable}`);
  return path.dirname(path.join(directory, file));
}
export async function current(directory: string, version: string, required: string[]) {
  const marker = await fs.readFile(path.join(directory, 'runtime.json'), 'utf8').then(JSON.parse).catch(() => null);
  return marker?.version === version && marker.platform === process.platform && marker.arch === process.arch && (await Promise.all(required.map(file => exists(path.join(directory, file))))).every(Boolean);
}
export async function mark(directory: string, version: string, source: string) {
  await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ version, platform: process.platform, arch: process.arch, source }, null, 2));
}
