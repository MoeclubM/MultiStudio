const path = require('node:path');
const { readJson, writeJson } = require('./storage.cjs');
const { nodeRegistry } = require('./node-registry.cjs');

class Plugins {
  constructor(directory, services, emit) {
    this.directory = directory; this.services = services; this.emit = emit; this.items = new Map();
    this.ready = this.open();
  }
  async open() {
    this.reload();
    const file = path.join(this.directory, 'plugins.json'), previous = await readJson(file, {});
    const binding = previous['realtime-translation'];
    if (binding?.workflowId && nodeRegistry.definitions['live-audio-input']) {
      const original = this.services.workflows.get(binding.workflowId);
      if (original && !original.nodes.some(node => node.data.kind === 'live-audio-input')) {
        const workflow = structuredClone(original);
        const input = workflow.nodes.find(node => node.data.kind === 'audio-input' && node.data.config.source !== 'file');
        if (input) { input.data.kind = 'live-audio-input'; input.data.label = '连续音频'; await this.services.workflows.save(workflow); }
      }
      delete previous['realtime-translation']; await writeJson(file, previous);
    }
  }
  reload() {
    this.items.clear();
    for (const plugin of nodeRegistry.packages.filter(item => item.enabled && !item.error && item.runtime.createSession)) {
      const entry = { id: plugin.id, name: plugin.name, workflowId: '', status: 'stopped', processed: 0, skipped: 0, queued: 0, error: null };
      const update = patch => { Object.assign(entry, patch); this.emit('plugin-state', this.list()); };
      const runtime = plugin.runtime.createSession({ ...this.services, update, isSessionNode: node => nodeRegistry.definitions[node.data.kind]?.session, nodeRuntime: node => nodeRegistry.handler(node.data.kind) });
      this.items.set(plugin.id, { entry, runtime });
    }
    this.emit('plugin-state', this.list());
  }
  list() { return [...this.items.values()].map(({ entry }) => ({ ...entry })); }
  get busy() { return this.list().some(entry => ['starting', 'running', 'stopping'].includes(entry.status)); }
  async startWorkflow(workflow) {
    await this.ready;
    if (this.busy || this.services.workflows.active || this.services.capture.current) throw new Error('请先结束当前任务或音频采集');
    const plan = this.services.workflows.plan(workflow, true, { live: true });
    const sources = plan.order.filter(node => nodeRegistry.definitions[node.data.kind].session);
    if (sources.length !== 1) throw new Error('每个工作流只能运行一个连续输入节点');
    const item = this.items.get(nodeRegistry.definitions[sources[0].data.kind].pluginId);
    if (!item) throw new Error('连续输入插件未加载');
    await item.runtime.stop();
    Object.assign(item.entry, { workflowId: workflow.id, status: 'starting', error: null }); this.emit('plugin-state', this.list());
    try { await item.runtime.start({ workflow: plan.workflow }); }
    catch (error) { if (error.name === 'AbortError') Object.assign(item.entry, { status: 'stopped', error: null }); else Object.assign(item.entry, { status: 'error', error: error.message }); this.emit('plugin-state', this.list()); if (error.name !== 'AbortError') throw error; }
    return this.list();
  }
  async shutdown() { await this.ready; for (const { runtime } of this.items.values()) await runtime.stop(); }
}
module.exports = { Plugins };
