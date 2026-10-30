const { contextBridge, ipcRenderer } = require('electron');
const allowedEvents = new Set(['model-library-changed', 'pipeline-event', 'generation-event', 'backend-error', 'download-progress', 'transcription-event', 'workflow-event', 'audio-capture', 'desktop-output', 'plugin-state', 'workflow-playback', 'window-state', 'speech-models', 'runtime-state']);

contextBridge.exposeInMainWorld('multistudioDesktop', {
  platform: process.platform,
  invoke: async (command, args = {}) => {
    const reply = await ipcRenderer.invoke('multistudio:invoke', command, args);
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  },
  on: (event, callback) => {
    if (!allowedEvents.has(event) || typeof callback !== 'function') throw new Error('不支持的桌面事件');
    const listener = (_event, message) => { if (message.event === event) callback(message.payload); };
    ipcRenderer.on('multistudio:event', listener);
    return () => ipcRenderer.removeListener('multistudio:event', listener);
  },
});
