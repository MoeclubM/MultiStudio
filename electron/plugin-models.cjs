const { nodeRegistry } = require('./node-registry.cjs');

class PluginModels {
  constructor(inference) { this.inference = inference; }
  async list() {
    const models = [];
    for (const [id, definition] of Object.entries(nodeRegistry.backends)) {
      if (!definition.modelImports?.length) continue;
      const service = this.inference.get(id).models;
      for (const model of await service.list()) models.push({ ...model, backendId: id, downloadable: !!model.repo });
    }
    return models;
  }
  async owner(id) {
    const model = (await this.list()).find(item => item.id === id);
    if (!model) throw new Error('模型未登记或推理插件已停用');
    return this.inference.get(model.backendId).models;
  }
  async download(id) { return (await this.owner(id)).download(id); }
  async get(id, task) { const item = (await this.list()).find(model => model.id === id && model.task === task && model.status === 'ready'); if (!item) throw new Error('请选择已就绪的模型'); return item; }
  import(directory, task, engine, backendId) { return this.inference.get(backendId).models.import(directory, task, engine); }
  async stop() {}
}
module.exports = { PluginModels };
