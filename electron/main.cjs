const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, net, session, dialog, systemPreferences, safeStorage, shell, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { NativeBackend } = require('./backend.cjs');
const { ApplicationBackend } = require('./application-backend.cjs');
const { Inference } = require('./inference.cjs');
const { backendCommands, shellCommands, events } = require('./contract.cjs');
const { readEnvironment } = require('./environment.cjs');
const { ModelHub, repoId, safeTarget } = require('./hub.cjs');
const { SpeechService, audioPath, ID, AUDIO_LIMIT } = require('./speech.cjs');
const { Conversations } = require('./conversations.cjs');
const { desktopFetch } = require('./network.cjs');
const { Workflows } = require('./workflows.cjs');
const { nodeRegistry } = require('./node-registry.cjs');
const { validateWorkflow } = require('./workflow-graph.cjs');
const { writeJson } = require('./storage.cjs');
const { AudioCapture } = require('./capture.cjs');
const { DesktopOutputs } = require('./outputs.cjs');
const { Plugins } = require('./plugins.cjs');
const { PluginModels } = require('./plugin-models.cjs');
const { ApiServer } = require('./api-server.cjs');
const { Runtimes } = require('./runtimes.cjs');

// Keep the existing Chromium origin so theme/subtitle localStorage survives renaming.
protocol.registerSchemesAsPrivileged([{ scheme: 'prism', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('MultiStudio');
// Keep the existing data directory across desktop upgrades.
const dataDir = readEnvironment('DATA_DIR') || (process.platform === 'win32'
  ? path.join(app.getPath('appData'), 'app.livetranslator.desktop')
  : process.platform === 'darwin'
    ? path.join(app.getPath('appData'), 'app.livetranslator.desktop')
    : path.join(app.getPath('home'), '.local', 'share', 'app.livetranslator.desktop'));
fs.mkdirSync(path.resolve(dataDir), { recursive: true });
const customNodes = path.join(path.resolve(dataDir), 'custom_nodes');
nodeRegistry.load(customNodes);
app.setPath('userData', path.resolve(dataDir));
if (process.platform === 'win32') app.setAppUserModelId('app.livetranslator.desktop');

const root = path.join(__dirname, '..');
const rendererRoot = path.resolve(!app.isPackaged && readEnvironment('RENDERER_DIR') || path.join(root, 'dist'));
const baseUrl = 'prism://app/index.html';
const windows = new Set();
let mainWindow, tray, backend, hub, speech, conversations, workflows, capture, outputs, plugins, speechModels, inference, api, runtimes;
let activeOperations = 0;
const exclusiveCommands = new Set(['runtime_install','test_llm', 'generate_text', 'generate_chat', 'translate_text', 'audio_transcribe', 'audio_synthesize', 'load_local_model', 'unload_local_model', 'switch_builtin_translation_model', 'set_config', 'speech_configure', 'hub_delete_model', 'set_model_load_options', 'import_model', 'forget_model', 'add_model_directory', 'remove_model_directory']);
let quitting = false;
function trusted(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'prism:' && parsed.hostname === 'app';
  } catch { return false; }
}
function broadcast(event, payload) {
  if (!events.has(event)) return;
  api?.publish(event, payload);
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    const url = win.webContents.getURL();
    if (!trusted(url)) continue;
    const recipient = event === 'desktop-output' ? new URL(url).hash === '#/output/' + encodeURIComponent(payload.key) : win === mainWindow;
    if (recipient) win.webContents.send('multistudio:event', { event, payload });
  }
}
function windowOptions(overlay = false) {
  return {
    title: overlay ? 'MultiStudio — 悬浮字幕' : 'MultiStudio — 本地模型工作室',
    width: overlay ? 840 : 1180, height: overlay ? 180 : 800,
    minWidth: overlay ? 360 : 900, minHeight: overlay ? 80 : 560, show: false,
    frame: false, autoHideMenuBar: true, transparent: overlay, alwaysOnTop: overlay, skipTaskbar: overlay,
    backgroundColor: overlay ? '#00000000' : '#f7f7f8',
    icon: path.join(root, 'assets', 'icons', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  };
}
function trackWindow(win) {
  windows.add(win);
  const windowState = () => {
    if (!win.isDestroyed()) win.webContents.send('multistudio:event', { event: 'window-state', payload: { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } });
  };
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(event, windowState);
  win.on('closed', () => windows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', () => broadcast('backend-error', '界面进程异常，请重新启动应用'));
}
async function createMain() {
  mainWindow = new BrowserWindow(windowOptions());
  trackWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; if (process.platform !== 'darwin') app.quit(); });
  await mainWindow.loadURL(baseUrl);
}
function showMain() { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.restore(); mainWindow.focus(); } else void createMain(); }

async function startWorkflow(workflow) {
  if (quitting || activeOperations || plugins.busy || workflows.active || capture.current) throw Object.assign(new Error('请先结束当前任务或音频采集'), { status: 409 });
  activeOperations++;
  try {
    const plan = workflows.plan(workflow);
    if (plan.order.some(node => nodeRegistry.definitions[node.data.kind].session)) {
      await plugins.startWorkflow(workflow); return { run: null, plugins: plugins.list() };
    }
    return { run: workflows.start(workflow), plugins: plugins.list() };
  } finally { activeOperations--; }
}
async function cancelWorkflow(id) {
  if (plugins.busy) { await plugins.shutdown(); return workflows.status(); }
  return workflows.cancel(id);
}

ipcMain.handle('multistudio:invoke', async (event, command, args = {}) => {
  let tracked = false;
  try {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!windows.has(sender) || event.senderFrame !== event.sender.mainFrame || !trusted(event.senderFrame.url)) throw new Error('未授权的 IPC 来源');
    if (!backendCommands.has(command) && !shellCommands.has(command)) throw new Error('不支持的桌面命令');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('命令参数无效');
    if (command === 'save_audio_input') {
      if (!(args.bytes instanceof Uint8Array) || args.bytes.byteLength > AUDIO_LIMIT || Object.keys(args).some(k => k !== 'bytes')) throw new Error('音频数据无效或超过 25 MB');
    } else if (Buffer.byteLength(JSON.stringify(args)) > 2 * 1024 * 1024) throw new Error('命令数据过大');
    if (exclusiveCommands.has(command)) {
      if (activeOperations || workflows?.active || plugins?.busy) throw new Error('请先停止当前任务');
      activeOperations++; tracked = true;
    }
    let result;
    switch (command) {
      case 'window_minimize': sender.minimize(); break;
      case 'window_state': result = { maximized: sender.isMaximized(), fullscreen: sender.isFullScreen() }; break;
      case 'window_toggle_maximize': sender.isMaximized() ? sender.unmaximize() : sender.maximize(); break;
      case 'window_close': sender.close(); break;
      case 'runtime_settings': result = await runtimes.snapshot(); break;
      case 'runtime_install': await runtimes.ensure(args.id); result = await runtimes.snapshot(); break;
      case 'runtime_cancel': runtimes.cancel(args.id); break;
      case 'runtime_pick_directory': {
        if (activeOperations || runtimes.busy || workflows.active || plugins.busy || capture.current) throw new Error('请先停止当前任务');
        const picked = await dialog.showOpenDialog(sender, { title: '选择运行库目录', properties: ['openDirectory', 'createDirectory'] });
        result = picked.canceled ? await runtimes.snapshot() : await runtimes.configure(picked.filePaths[0]); break;
      }
      case 'api_settings': await api.ready; result = api.snapshot(); break;
      case 'api_configure': result = await api.configure(args); break;
      case 'hub_search': result = await hub.search(args); break;
      case 'hub_detail': result = await hub.detail(args.repo); break;
      case 'hub_download': result = await hub.download(args); break;
      case 'hub_downloads': await hub.ready; result = hub.snapshot(); break;
      case 'hub_download_action': result = await hub.action(args); break;
      case 'hub_settings': await hub.ready; result = hub.publicSettings(); break;
      case 'hub_configure': result = await hub.setSettings(args); break;
      case 'hub_open_repository': await shell.openExternal(`https://huggingface.co/${repoId(args.repo)}`); break;
      case 'hub_delete_model': {
        const job = hub.jobs.find(j => j.id === args.id && j.status === 'completed');
        if (!job) throw new Error('只能删除由 MultiStudio 下载的文件');
        const snapshot = await backend.invoke('get_model_library');
        if (snapshot.engine.phase === 'loading' || snapshot.models.some(m => m.id === snapshot.engine.activeModelId && path.resolve(m.path) === path.resolve(job.path))) throw new Error('请先卸载模型');
        await safeTarget(job.root, path.relative(job.root, job.path).split(path.sep).join('/'));
        await shell.trashItem(job.path); job.status = 'deleted'; await hub.persist(); hub.update(); broadcast('model-library-changed', null); result = '已移至回收站'; break;
      }
      case 'speech_settings': await speech.ready; result = speech.snapshot(); break;
      case 'speech_models': result = await speechModels.list(); break;
      case 'speech_model_download': await speechModels.download(args.id); result = await speechModels.list(); break;
      case 'speech_model_import': {
        const descriptor = nodeRegistry.backends[args.backendId]?.modelImports?.find(item => item.engine === args.engine);
        if (!descriptor) throw new Error('模型导入插件不可用');
        const file = descriptor.format === 'gguf';
        const picked = await dialog.showOpenDialog(sender, file ? { title: `导入 ${descriptor.name}`, properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] } : { title: '导入语音模型目录', properties: ['openDirectory'] });
        if (!picked.canceled) {
          if (file) await backend.invoke('import_model', { path: picked.filePaths[0], name: '', kind: 'speech' });
          else await speechModels.import(picked.filePaths[0], descriptor.task, args.engine, args.backendId);
        }
        result = await speechModels.list(); break;
      }
      case 'speech_configure': result = await speech.configure(args); break;
      case 'save_audio_input': result = await speech.saveInput(args.bytes); break;
      case 'audio_export': {
        const file = audioPath(speech.directory, args.audioId);
        const picked = await dialog.showSaveDialog(sender, { title: '保存音频', defaultPath: 'MultiStudio-audio.wav', filters: [{ name: 'WAV 音频', extensions: ['wav'] }] });
        if (!picked.canceled && picked.filePath) await fs.promises.copyFile(file, picked.filePath);
        result = picked.canceled ? null : picked.filePath; break;
      }
      case 'text_export': {
        if (typeof args.text !== 'string' || args.text.length > 32768) throw new Error('文本输出无效');
        const picked = await dialog.showSaveDialog(sender, { title: '保存文本', defaultPath: 'MultiStudio-output.txt', filters: [{ name: '文本', extensions: ['txt'] }] });
        if (!picked.canceled && picked.filePath) await fs.promises.writeFile(picked.filePath, args.text, 'utf8');
        result = picked.canceled ? null : picked.filePath; break;
      }
      case 'audio_capture_start':
        if (plugins.busy || workflows.active || activeOperations) throw new Error('请先结束当前任务');
        result = await capture.start({ ...args, continuous: false, segmentSeconds: 120 }); break;
      case 'audio_capture_stop':
        if (capture.current?.owner !== 'manual') throw new Error('请停止工作流');
        result = await capture.stop(args.sessionId); break;
      case 'audio_capture_status': result = capture.status(); break;
      case 'desktop_output_get': result = outputs.get(args.key); break;
      case 'desktop_output_copy': outputs.copy(args.key); break;
      case 'plugin_list': await plugins.ready; result = plugins.list(); break;
      case 'node_catalog': result = nodeRegistry.catalog(); break;
      case 'node_plugin_directory': await shell.openPath(customNodes); break;
      case 'node_plugin_reload':
      case 'node_plugin_toggle':
      case 'node_plugin_import': {
        if (workflows.active || plugins.busy || capture.current || activeOperations) throw new Error('请先停止当前任务');
        if (command === 'node_plugin_import') {
          const picked = await dialog.showOpenDialog(sender, { title: '导入受信任的节点插件', properties: ['openDirectory'] });
          if (picked.canceled) { result = nodeRegistry.catalog(); break; }
          const source = path.resolve(picked.filePaths[0]);
          const manifest = JSON.parse(await fs.promises.readFile(path.join(source, 'manifest.json'), 'utf8'));
          if (manifest.apiVersion !== 1 || !/^[a-z][a-z0-9.-]+$/.test(manifest.id) || !manifest.nodes && !manifest.backends) throw new Error('插件格式无效');
          if (nodeRegistry.packages.some(item => item.id === manifest.id)) throw new Error('此插件已安装');
          const destination = path.join(customNodes, manifest.id);
          if (fs.existsSync(destination) || customNodes.startsWith(source + path.sep) || source === customNodes) throw new Error('请选择独立的插件目录');
          await fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false, filter: file => path.basename(file) !== '.git' });
        }
        await plugins.shutdown();
        await inference.stop();
        result = command === 'node_plugin_toggle' ? nodeRegistry.toggle(args.id, args.enabled) : nodeRegistry.load();
        plugins.reload(); broadcast('runtime-state', null); broadcast('model-library-changed', null); broadcast('speech-models', null); break;
      }
      case 'conversation_list': result = await conversations.list(); break;
      case 'conversation_get': result = await conversations.get(args.id); break;
      case 'conversation_save': result = await conversations.save(args.conversation); break;
      case 'conversation_delete': await conversations.delete(args.id); break;
      case 'workflow_list': result = workflows.list(); break;
      case 'workflow_get': result = workflows.get(args.id); break;
      case 'workflow_save': result = await workflows.save(args.workflow); break;
      case 'workflow_delete': result = await workflows.delete(args.id); break;
      case 'workflow_status': result = workflows.status(); break;
      case 'workflow_start': result = await startWorkflow(args.workflow); break;
      case 'workflow_cancel': result = await cancelWorkflow(args.id); break;
      case 'workflow_runs': result = workflows.listRuns(); break;
      case 'workflow_run_get': result = workflows.getRun(args.id); break;
      case 'workflow_context_get': result = workflows.getContext(args.workflowId, args.nodeId); break;
      case 'workflow_context_clear': result = await workflows.clearContext(args.workflowId, args.nodeId); break;
      case 'workflow_export': {
        const { workflow } = validateWorkflow(args.workflow);
        const picked = await dialog.showSaveDialog(sender, { title: '导出工作流 JSON', defaultPath: `MultiStudio-workflow-${workflow.id.slice(0, 8)}.json`, filters: [{ name: '工作流 JSON', extensions: ['json'] }] });
        if (!picked.canceled && picked.filePath) await writeJson(picked.filePath, workflow);
        result = picked.canceled ? null : picked.filePath; break;
      }
      case 'pick_model_file':
      case 'pick_model_directory': {
        const picked = await dialog.showOpenDialog(sender, command === 'pick_model_file'
          ? { title: '导入 GGUF 模型', properties: ['openFile'], filters: [{ name: 'GGUF 模型', extensions: ['gguf'] }] }
          : { title: '添加模型目录', properties: ['openDirectory'] });
        result = picked.canceled ? null : picked.filePaths[0]; break;
      }
      default: if (!backend) throw new Error('本地后端未启动'); result = await backend.invoke(command, args);
    }
    return { result };
  } catch (error) { return { error: { message: error.message ?? String(error) } }; }
  finally { if (tracked) activeOperations--; }
});

app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true; event.preventDefault();
  workflows?.stop();
  void (async () => { try {
    outputs?.stop();
    await api?.stop();
    await runtimes?.stop();
    await Promise.race([plugins?.shutdown(), new Promise(resolve => setTimeout(resolve, 6500))]);
    await capture?.stop(); await speechModels?.stop(); await hub?.stop();
  } finally { await backend?.stop(); } })().finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', showMain);
if (!app.isPackaged) process.on('message', message => {
  if (message?.type === 'renderer-reload') mainWindow?.webContents.reloadIgnoringCache();
  if (message?.type === 'desktop-quit') app.quit();
});
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    protocol.handle('prism', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Forbidden', { status: 403 });
      if (url.pathname.startsWith('/__audio/')) {
        const id = url.pathname.slice('/__audio/'.length).replace(/\.wav$/, '');
        if (!speech || !ID.test(id) || url.pathname !== `/__audio/${id}.wav`) return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(audioPath(speech.directory, id)).href);
      }
      const dist = rendererRoot;
      let file;
      try { file = path.resolve(dist, '.' + decodeURIComponent(url.pathname)); }
      catch { return new Response('Invalid path', { status: 400 }); }
      if (!file.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href).catch(() => new Response('资源暂不可用，请重新加载。', { status: 503 }));
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' prism: blob:; object-src 'none'; frame-src 'none'; base-uri 'self'";
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) =>
      permission === 'media' && trusted(origin) && details.mediaType !== 'video');
    session.defaultSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      if (permission !== 'media' || !trusted(wc.getURL()) || details.mediaTypes?.includes('video')) return callback(false);
      const granted = process.platform !== 'darwin' || await systemPreferences.askForMediaAccess('microphone');
      callback(granted);
    });
    Menu.setApplicationMenu(null);
    const icon = nativeImage.createFromPath(path.join(root, 'assets', 'icons', 'icon.png')).resize({ width: 20, height: 20 });
    if (!icon.isEmpty()) {
      tray = new Tray(icon); tray.setToolTip('MultiStudio');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示工作室', click: showMain }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
      tray.on('click', showMain);
    }
    const runtimeDirectory = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.resolve(readEnvironment('RUNTIME_DIR') || path.join(root, '.runtime'));
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'native', process.platform === 'win32' ? 'multistudio-native.exe' : 'multistudio-native')
      : readEnvironment('BACKEND_PATH') || path.join(root, '.cache', 'native-host', process.platform === 'win32' ? 'multistudio-native.exe' : 'multistudio-native');
    if (!fs.existsSync(executable)) throw new Error('未找到 C# 原生助手，请先运行 npm run backend:build');
    const fetcher = desktopFetch(net);
    const native = new NativeBackend(executable, path.resolve(dataDir));
    backend = new ApplicationBackend(native, path.resolve(dataDir), fetcher);
    backend.on('event', (name, payload) => { if (!['audio-capture', 'audio-pcm'].includes(name)) broadcast(name, payload); });
    backend.on('failure', message => broadcast('backend-error', message));
    await backend.ready;
    speech = new SpeechService(path.resolve(dataDir), { safeStorage });
    await speech.ready;
    runtimes = new Runtimes(path.resolve(dataDir), { directory: path.join(backend.library.settings.cacheDirectory, 'engines'), runtimeDirectory, packages: () => inference?.runtimePackages() || [], native, fetcher, emit: broadcast });
    await runtimes.ready;
    inference = new Inference({ runtimes, dataDir: path.resolve(dataDir), runtimeDirectory, resourcesPath: process.resourcesPath, packaged: app.isPackaged, native, backend, library: backend.library, speech, fetcher, emit: broadcast, createWorker: file => utilityProcess.fork(file, [], { serviceName: 'MultiStudio Inference' }) });
    backend.inference = inference;
    speechModels = new PluginModels(inference);
    hub = new ModelHub(path.resolve(dataDir), { emit: broadcast, safeStorage, fetcher, register: directory => backend.library.add(directory) });
    conversations = new Conversations(path.resolve(dataDir));
    capture = new AudioCapture(backend, broadcast);
    outputs = new DesktopOutputs({ baseUrl, windowOptions, trackWindow, broadcast });
    workflows = new Workflows(path.resolve(dataDir), { backend, speech, inference, fetcher, emit: broadcast, outputs });
    await Promise.all([hub.ready, speech.ready, conversations.ready, workflows.ready]);
    plugins = new Plugins(path.resolve(dataDir), { backend, capture, workflows, audioDirectory: speech.directory }, broadcast);
    await plugins.ready;
    api = new ApiServer(path.resolve(dataDir), { speech, workflows, start: startWorkflow, cancel: cancelWorkflow, safeStorage });
    await api.ready;
    await createMain();
    void backend.invoke('initialize').catch((error) => broadcast('backend-error', error.message));
  }).catch((error) => { dialog.showErrorBox('MultiStudio 启动失败', error.message); app.quit(); });
}
