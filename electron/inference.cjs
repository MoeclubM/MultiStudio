const { nodeRegistry } = require('./node-registry.cjs');

class Inference {
  constructor(services) { this.services = services; this.instances = new Map(); }
  get(id) {
    if (!this.instances.has(id)) {
      const handler = nodeRegistry.backendHandlers.get(id);
      if (!handler) throw new Error(`推理插件未加载：${id}`);
      this.instances.set(id, handler.create(this.services));
    }
    return this.instances.get(id);
  }
  runtimePackages() {
    return [...nodeRegistry.backendHandlers].flatMap(([backendId, handler]) => (handler.runtimePackages?.(this.services.runtimeDirectory) || []).map(item => ({ ...item, backendId })));
  }
  describe() { return Object.entries(nodeRegistry.backends).map(([id, definition]) => ({ id, ...definition, state: this.instances.get(id)?.status?.() || null })); }
  async stop() { await Promise.all([...this.instances.values()].map(backend => backend.stop?.())); this.instances.clear(); }
}
module.exports = { Inference };
