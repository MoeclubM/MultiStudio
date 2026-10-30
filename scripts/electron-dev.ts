import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(import.meta.url);
let desktop: ChildProcess | undefined;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MULTISTUDIO_DEV_URL;
delete env.PRISM_DEV_URL;
const runtime = path.resolve('.runtime');
if (!env.MULTISTUDIO_RUNTIME_DIR && existsSync(runtime)) env.MULTISTUDIO_RUNTIME_DIR = runtime;
env.MULTISTUDIO_RENDERER_DIR = path.resolve('.cache/desktop-ui');
const watcher = await build({ build: { outDir: env.MULTISTUDIO_RENDERER_DIR, emptyOutDir: false, watch: {} } });
if (!('on' in watcher)) throw new Error('无法启动桌面构建监听');
watcher.on('event', event => {
  if (event.code === 'ERROR') console.error(event.error);
  if (event.code !== 'END') return;
  if (desktop) { if (desktop.connected) desktop.send({ type: 'renderer-reload' }); return; }
  desktop = spawn(require('electron'), ['.'], { env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  desktop.on('exit', async code => { await watcher.close(); process.exit(code ?? 0); });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (desktop?.connected) desktop.send({ type: 'desktop-quit' });
  else { void watcher.close(); process.exit(); }
});
