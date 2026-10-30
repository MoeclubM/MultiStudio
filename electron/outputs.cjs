const { BrowserWindow, Notification, clipboard, screen } = require('electron');

class DesktopOutputs {
  constructor({ baseUrl, windowOptions, trackWindow, broadcast }) {
    Object.assign(this, { baseUrl, windowOptions, trackWindow, broadcast });
    this.windows = new Map(); this.latest = new Map(); this.pending = new Map();
  }
  async publish(node, output, run) {
    const key = `${run.workflowId}:${node.id}`, config = { ...node.data.config, ...(['subtitle-output', 'translated-subtitle-output'].includes(node.data.kind) ? { mode: 'overlay', title: node.data.label } : {}) };
    const previous = this.latest.get(key);
    if (previous?.startedAt > run.startedAt) return;
    if (previous?.runId === run.id && previous.text === output.text && previous.partial === !!output.partial) return;
    if (config.mode === 'notification' && output.partial) return;
    if (previous && previous.mode !== config.mode) {
      this.windows.get(key)?.destroy(); this.windows.delete(key);
    }
    const item = { key, text: output.text, title: config.title || node.data.label, runId: run.id, mode: config.mode, partial: !!output.partial, startedAt: run.startedAt, appearance: config.mode === 'overlay' ? config : null };
    this.latest.set(key, item);
    if (config.mode === 'notification') {
      if (!Notification.isSupported()) throw new Error('当前系统无法显示桌面通知');
      new Notification({ title: item.title, body: item.text }).show(); return;
    }
    let window = this.windows.get(key);
    if (!window || window.isDestroyed()) {
      const overlay = config.mode === 'overlay';
      window = new BrowserWindow({ ...this.windowOptions(overlay), width: overlay ? config.width || 840 : 560, height: overlay ? Math.max(80, (config.fontSize || 26) * 1.6 * (config.lines || 2) + 40) : 360, minWidth: 320, minHeight: 80, title: item.title, alwaysOnTop: config.alwaysOnTop });
      this.trackWindow(window); this.windows.set(key, window);
      window.on('close', event => { if (!this.quitting) { event.preventDefault(); window.hide(); } });
      await window.loadURL(`${this.baseUrl}#/output/${encodeURIComponent(key)}`); window.showInactive();
    } else {
      if (previous?.title !== item.title) window.setTitle(item.title);
      if (window.isAlwaysOnTop() !== !!config.alwaysOnTop) window.setAlwaysOnTop(!!config.alwaysOnTop);
      if (!window.isVisible() && !window.webContents.isLoading()) window.showInactive();
    }
    if (this.quitting || window.isDestroyed()) return;
    if (config.mode === 'overlay') {
      const layout = JSON.stringify([config.width, config.fontSize, config.lines, config.offsetY]);
      if (window.subtitleLayout !== layout) {
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        const width = Math.min(config.width || 1000, area.width), height = Math.max(80, (config.fontSize || 26) * 1.6 * (config.lines || 2) + 40);
        window.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: Math.max(area.y, Math.round(area.y + area.height - height - (config.offsetY || 0))), width, height: Math.ceil(height) });
        window.subtitleLayout = layout;
      }
    }
    const send = () => { this.pending.delete(key); this.broadcast('desktop-output', this.latest.get(key)); };
    if (!output.partial) { clearTimeout(this.pending.get(key)); send(); }
    else if (!this.pending.has(key)) this.pending.set(key, setTimeout(send, 50));
  }
  get(key) { return this.latest.get(key) || null; }
  copy(key) { clipboard.writeText(this.get(key)?.text || ''); }
  stop() { this.quitting = true; for (const timer of this.pending.values()) clearTimeout(timer); this.pending.clear(); for (const window of this.windows.values()) if (!window.isDestroyed()) window.close(); }
}
module.exports = { DesktopOutputs };
