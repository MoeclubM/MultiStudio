const fs = require('node:fs');
const path = require('node:path');

class NodeRegistry {
  constructor() {
    this.definitions = Object.create(null); this.handlers = new Map(); this.backends = Object.create(null); this.backendHandlers = new Map(); this.packages = [];
    this.bundled = path.join(__dirname, '..', 'plugins');
    this.load();
  }
  load(directory = this.directory) {
    this.directory = directory;
    if (directory) fs.mkdirSync(directory, { recursive: true });
    const disabledFile = directory && path.join(directory, 'disabled.json');
    this.disabled = disabledFile && fs.existsSync(disabledFile) ? JSON.parse(fs.readFileSync(disabledFile, 'utf8')) : [];
    const definitions = Object.create(null), handlers = new Map(), backends = Object.create(null), backendHandlers = new Map(), packages = [], templates = [];
    for (const [root, bundled] of [[this.bundled, true], [directory, false]]) {
      if (!root) continue;
      for (const folder of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const location = path.join(root, folder.name), file = path.join(location, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        let manifest, item;
        try {
          manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (manifest.apiVersion !== 1 || !/^[a-z][a-z0-9.-]+$/.test(manifest.id) || !manifest.name || !manifest.nodes && !manifest.backends || packages.some(p => p.id === manifest.id)) throw new Error('插件标识重复或格式无效');
          item = { id: manifest.id, name: manifest.name, version: manifest.version, bundled, enabled: !this.disabled.includes(manifest.id), nodes: Object.keys(manifest.nodes || {}), backends: Object.keys(manifest.backends || {}), path: location, error: null };
          if (item.enabled) {
            const entry = path.resolve(location, manifest.entry || 'index.cjs');
            if (!entry.startsWith(location + path.sep)) throw new Error('插件入口必须位于插件目录');
            // A reload also picks up helpers belonging to the same plugin.
            for (const cached of Object.keys(require.cache)) if (cached.startsWith(location + path.sep)) delete require.cache[cached];
            const runtime = require(entry), additions = [];
            const backendAdditions = [];
            for (const [id, definition] of Object.entries(manifest.backends || {})) {
              if (backends[id] || typeof runtime.backends?.[id]?.create !== 'function') throw new Error(`推理后端 ${id} 重复或缺少创建入口`);
              backendAdditions.push([id, { ...definition, pluginId: manifest.id }, runtime.backends[id]]);
            }
            for (const [kind, definition] of Object.entries(manifest.nodes || {})) {
              const handler = runtime.nodes?.[kind];
              if (definitions[kind] || !definition.label || !definition.defaults || !Array.isArray(definition.fields) || typeof handler?.execute !== 'function') throw new Error(`节点 ${kind} 重复或缺少定义 / 执行函数`);
              if (definition.session && typeof runtime.createSession !== 'function') throw new Error(`节点 ${kind} 缺少连续执行入口`);
              if (definition.apiInput && typeof handler.bindInput !== 'function') throw new Error(`节点 ${kind} 缺少 API 输入入口`);
              for (const field of definition.fields) if (!Object.hasOwn(definition.defaults, field.key)) throw new Error(`参数 ${field.key} 缺少默认值`);
              additions.push([kind, { ...definition, defaults: { ...definition.defaults, ...definition.platformDefaults?.[process.platform] }, fields: definition.fields.map(field => ({ ...field, options: field.platformOptions?.[process.platform] || field.options })), pluginId: manifest.id, pluginName: manifest.name }, handler]);
            }
            for (const [kind, definition, handler] of additions) { definitions[kind] = definition; handlers.set(kind, handler); }
            for (const [id, definition, handler] of backendAdditions) { backends[id] = definition; backendHandlers.set(id, handler); }
            item.runtime = runtime;
            templates.push(...(manifest.templates || []).map(template => ({ ...template, pluginId: manifest.id })));
          }
        } catch (error) {
          item = { ...(item || { id: folder.name, name: folder.name, version: '', bundled, enabled: true, nodes: [], path: location }), error: error.message };
        }
        packages.push(item);
      }
    }
    for (const key of Object.keys(this.definitions)) delete this.definitions[key];
    Object.assign(this.definitions, definitions); this.handlers = handlers; this.backends = backends; this.backendHandlers = backendHandlers; this.packages = packages;
    this.templates = templates.filter(template => template.nodes.every(node => definitions[node.kind]));
    return this.catalog();
  }
  catalog() {
    return { nodes: this.definitions, backends: this.backends, templates: this.templates, plugins: this.packages.map(({ runtime, ...item }) => item) };
  }
  handler(kind) { const handler = this.handlers.get(kind); if (!handler) throw new Error(`节点插件不可用：${kind}`); return handler; }
  toggle(id, enabled) {
    if (!this.packages.some(item => item.id === id)) throw new Error('插件不存在');
    const disabled = this.disabled.filter(value => value !== id); if (!enabled) disabled.push(id);
    fs.writeFileSync(path.join(this.directory, 'disabled.json'), JSON.stringify(disabled, null, 2));
    return this.load();
  }
}
const nodeRegistry = new NodeRegistry();
module.exports = { NodeRegistry, nodeRegistry };
