import type { Edge, Node, Connection } from "@xyflow/react";
import type { NodeCatalog, NodeDefinition, NodeTemplate, NodeConfig } from "./node-plugins";
export type { NodeConfig } from "./node-plugins";
export type NodeKind = string;
export type StudioData = { kind: NodeKind; label: string; config: NodeConfig };
export type StudioNode = Node<StudioData, "studio">;
export type Workflow = { version: 1; id: string; name: string; nodes: StudioNode[]; edges: Edge[] };
export type WorkflowSummary = Omit<Workflow, "nodes" | "edges"> & { count: number; updatedAt?: string };
export type NodeResult = { status: "idle" | "running" | "completed" | "error" | "skipped" | "cancelled" | "interrupted"; output?: { type: "text"; text: string; partial?: boolean } | { type: "audio"; audioId: string }; error?: string };
export type WorkflowRun = { id: string; workflowId: string; workflowName: string; workflow?: Workflow; status: "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted"; startedAt: string; endedAt?: string; streaming?: boolean; error?: string; nodes: Record<string, NodeResult> };
export type RunSummary = Omit<WorkflowRun, "nodes" | "workflow"> & { count: number };
export type ContextMessage = { role: "user" | "assistant"; content: string };
export const spec: Record<string, NodeDefinition> = {};
export const templates: Record<string, NodeTemplate> = {};
export const templateLabels: Record<string, string> = { empty: "空白画布" };
export function installCatalog(catalog: NodeCatalog) {
  for (const key of Object.keys(spec)) delete spec[key];
  Object.assign(spec, catalog.nodes);
  for (const key of Object.keys(templates)) delete templates[key];
  for (const key of Object.keys(templateLabels)) if (key !== "empty") delete templateLabels[key];
  for (const template of catalog.templates) { templates[template.id] = template; templateLabels[template.id] = template.label; }
}
export const resultLabels = { idle: "等待", running: "执行中", completed: "已完成", error: "失败", skipped: "未执行", cancelled: "已停止", interrupted: "已中断", cancelling: "正在停止", failed: "失败" };
export type Template = string;
export function makeNode(kind: NodeKind, position = { x: 100, y: 100 }): StudioNode {
  const definition = spec[kind]; if (!definition) throw new Error(`节点插件不可用：${kind}`);
  return { id: crypto.randomUUID(), type: "studio", position, data: { kind, label: definition.label, config: { ...definition.defaults } } };
}
export function makeTemplate(template: Template = "empty"): Workflow {
  const definition = templates[template];
  const nodes = (definition?.nodes || []).map((item, index) => {
    const node = makeNode(item.kind, { x: index * 370, y: index % 2 * 35 + 60 });
    Object.assign(node.data.config, item.config);
    return node;
  });
  const links = definition?.links || nodes.slice(1).map((_, index) => [index, index + 1]);
  const edges = links.map(([source, target]) => ({ id: crypto.randomUUID(), source: nodes[source].id, target: nodes[target].id, sourceHandle: spec[nodes[source].data.kind].output!, targetHandle: spec[nodes[target].data.kind].input! }));
  return { version: 1, id: crypto.randomUUID(), name: definition?.label || "工作流", nodes, edges };
}
export function validConnection(connection: Connection, nodes: StudioNode[], edges: Edge[]) {
  const from = nodes.find(n => n.id === connection.source), to = nodes.find(n => n.id === connection.target);
  if (!from || !to || from.id === to.id || !spec[from.data.kind]?.output || spec[from.data.kind].output !== spec[to.data.kind]?.input || connection.sourceHandle !== spec[from.data.kind].output || connection.targetHandle !== spec[to.data.kind].input || edges.some(e => e.target === to.id)) return false;
  const visited = new Set<string>();
  function reaches(id: string): boolean { if (id === from!.id) return true; if (visited.has(id)) return false; visited.add(id); return edges.filter(e => e.source === id).some(e => reaches(e.target)); }
  return !reaches(to.id);
}
/** Connecting to an occupied input atomically replaces that wire, never its audio asset. */
export function connectionEdges(connection: Connection, nodes: StudioNode[], edges: Edge[], reconnectId?: string): Edge[] | null {
  const candidates = edges.filter(edge => edge.id !== reconnectId && edge.target !== connection.target);
  if (!validConnection(connection, nodes, candidates)) return null;
  return [...candidates, { ...connection, id: reconnectId || crypto.randomUUID() }];
}
export function serializeWorkflow(graph: Workflow): Workflow { return { version: 1, id: graph.id, name: graph.name, nodes: graph.nodes.map(({ id, position, data }) => ({ id, type: "studio", position, data })), edges: graph.edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })) }; }
export function parseWorkflow(value: unknown): Workflow {
  const graph = value as Workflow;
  if (!graph || graph.version !== 1 || typeof graph.name !== "string" || !graph.name.trim() || graph.name.length > 120 || !Array.isArray(graph.nodes) || graph.nodes.length > 64 || !Array.isArray(graph.edges) || graph.edges.length > 128 || new TextEncoder().encode(JSON.stringify(graph)).byteLength > 512000) throw new Error("工作流 JSON 格式无效或超出大小限制");
  const ids = new Set<string>(), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const nodes = graph.nodes.map(original => {
    const node = original;
    if (!node || typeof node.id !== "string" || !uuid.test(node.id) || ids.has(node.id) || !Object.keys(spec).includes(node.data?.kind) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y) || Math.abs(node.position.x) > 100000 || Math.abs(node.position.y) > 100000 || typeof node.data.config !== "object" || !node.data.config || Array.isArray(node.data.config)) throw new Error("节点类型、ID、位置或配置无效"); ids.add(node.id);
    const config: NodeConfig = { ...spec[node.data.kind].defaults };
    const incoming = { ...node.data.config };
    if (Object.hasOwn(config, 'device') && Object.hasOwn(incoming, 'useGpu')) { incoming.device = incoming.device || (incoming.useGpu === false ? 'cpu' : 'auto'); delete incoming.useGpu; }
    for (const [key, input] of Object.entries(incoming)) {
      if (!Object.keys(config).includes(key)) throw new Error("工作流含有未知配置；不允许保存密钥或可执行代码");
      if (typeof input !== typeof config[key] || typeof input === "string" && (input.includes("\x00") || input.length > (spec[node.data.kind].fields.find(field => field.key === key)?.maxLength || 2048))) throw new Error("节点配置值无效");
      config[key] = input;
    }
    for (const field of spec[node.data.kind].fields) {
      const value = config[field.key];
      if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) throw new Error(`参数 ${field.label} 超出范围`);
      if (field.options && !field.options.some(option => option.value === value)) throw new Error(`参数 ${field.label} 无效`);
    }
    return { id: node.id, type: "studio" as const, position: { x: node.position.x, y: node.position.y }, data: { kind: node.data.kind, label: typeof node.data.label === "string" ? node.data.label.slice(0, 120) : spec[node.data.kind].label, config } };
  });
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) { if (!edge || !uuid.test(edge.id) || edgeIds.has(edge.id) || !validConnection({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null }, nodes, edges)) throw new Error("工作流连线 ID / 类型不匹配、输入重复或形成循环"); edgeIds.add(edge.id); edges.push(edge); }
  // Imported IDs are local references. Save as a fresh flow, never silently overwrite an existing one.
  return serializeWorkflow({ ...graph, nodes, edges, id: crypto.randomUUID() });
}
