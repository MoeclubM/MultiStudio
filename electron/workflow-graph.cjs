const { nodeRegistry } = require('./node-registry.cjs');
const spec = nodeRegistry.definitions;
const { ID } = require('./speech.cjs');
const { migrateNode } = require('./workflow-migrations.cjs');
function migrateWorkflow(workflow, textBackend) {
  return { ...workflow, nodes: workflow.nodes.map(node => {
    const original = migrateNode(node.data, textBackend);
    const data = nodeRegistry.handlers.get(original.kind)?.migrate?.(original) || original;
    const definition = spec[data.kind];
    return definition ? { ...node, data: { ...data, config: { ...definition.defaults, ...data.config } } } : node;
  }) };
}
function validateWorkflow(value, executable = false, { live = false } = {}) {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || !Array.isArray(value.nodes) || value.nodes.length > 64 || !Array.isArray(value.edges) || value.edges.length > 128 || Buffer.byteLength(JSON.stringify(value), 'utf8') > 512000) throw new Error('工作流格式无效，最多 64 个节点 / 128 条连线 / 500 KB');
  const ids = new Set();
  const nodes = value.nodes.map(node => {
    const definition = Object.hasOwn(spec, node.data?.kind ?? '') ? spec[node.data.kind] : null;
    if (typeof node.id !== 'string' || !ID.test(node.id) || ids.has(node.id) || !definition || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y) || Math.abs(node.position.x) > 100000 || Math.abs(node.position.y) > 100000) throw new Error('节点插件缺失，或节点 ID / 位置无效');
    ids.add(node.id);
    const config = { ...definition.defaults };
    if (!node.data.config || typeof node.data.config !== 'object' || Array.isArray(node.data.config)) throw new Error('节点配置无效');
    for (const [key, input] of Object.entries(node.data.config)) {
      if (!Object.hasOwn(definition.defaults, key)) throw new Error(`节点不接受配置 ${key}，请勿在工作流中存储密钥或代码`);
      if (typeof input !== typeof config[key] || typeof input === 'string' && (input.length > (definition.fields.find(field => field.key === key)?.maxLength || 2048) || input.includes('\x00'))) throw new Error(`节点配置 ${key} 无效`);
      config[key] = input;
    }
    for (const field of definition.fields) {
      const input = config[field.key];
      if (field.type === 'number' && (!Number.isFinite(input) || field.min !== undefined && input < field.min || field.max !== undefined && input > field.max || (field.step ?? 1) === 1 && !Number.isInteger(input))) throw new Error(`参数 ${field.label} 超出范围`);
      if (field.options && !field.options.some(option => option.value === input)) throw new Error(`参数 ${field.label} 无效`);
    }
    nodeRegistry.handler(node.data.kind).validate?.(config, { executable: false, live });
    return { id: node.id, type: 'studio', position: { x: node.position.x, y: node.position.y }, data: { kind: node.data.kind, label: typeof node.data.label === 'string' ? node.data.label.slice(0, 120) : definition.label, config } };
  });
  const byId = new Map(nodes.map(n => [n.id, n])); const inputs = new Map(), edgeIds = new Set();
  const edges = value.edges.map(edge => {
    if (typeof edge.id !== 'string' || !ID.test(edge.id) || edgeIds.has(edge.id)) throw new Error('连线 ID 无效或重复'); edgeIds.add(edge.id);
    const from = byId.get(edge.source), to = byId.get(edge.target);
    if (!from || !to || from.id === to.id || !spec[from.data.kind].output || spec[from.data.kind].output !== spec[to.data.kind].input || edge.sourceHandle !== spec[from.data.kind].output || edge.targetHandle !== spec[to.data.kind].input) throw new Error('连线必须连接相同类型的输出 / 输入端口（文本或音频）');
    if (inputs.has(to.id)) throw new Error('每个输入端口只接受一条连线；输出可以连接多个分支'); inputs.set(to.id, from.id);
    return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle };
  });
  const remaining = new Map(nodes.map(n => [n.id, inputs.has(n.id) ? 1 : 0])); const order = nodes.filter(n => !remaining.get(n.id));
  for (let i = 0; i < order.length; i++) for (const edge of edges.filter(e => e.source === order[i].id)) { remaining.set(edge.target, remaining.get(edge.target) - 1); if (!remaining.get(edge.target)) order.push(byId.get(edge.target)); }
  if (order.length !== nodes.length) throw new Error('工作流包含循环，请移除形成回路的连线');
  const needed = new Set();
  function visit(id) { if (needed.has(id)) return; needed.add(id); if (inputs.has(id)) visit(inputs.get(id)); }
  nodes.filter(n => spec[n.data.kind].group === 'output').forEach(n => visit(n.id));
  if (executable) {
    if (!needed.size) throw new Error('请添加输出节点');
    for (const node of order.filter(n => needed.has(n.id))) {
      if (spec[node.data.kind].input && !inputs.has(node.id)) throw new Error(`${node.data.label} 缺少输入连线`);
      nodeRegistry.handler(node.data.kind).validate?.(node.data.config, { executable: true, live });
    }
  }
  return { workflow: { version: 1, id: value.id, name: value.name.trim(), nodes, edges }, order: order.filter(n => needed.has(n.id)), inputs, unused: nodes.filter(n => !needed.has(n.id)).map(n => n.id) };
}
module.exports = { spec, validateWorkflow, migrateWorkflow };
