const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./storage.cjs');
const { validateWorkflow, migrateWorkflow } = require('./workflow-graph.cjs');
const { ID } = require('./speech.cjs');
const { nodeRegistry } = require('./node-registry.cjs');
const { LiveWorkflow } = require('./live-workflow.cjs');
class Workflows {
  constructor(dataDir, { backend, speech, inference, fetcher = fetch, emit = () => {}, outputs } = {}) {
    this.file = path.join(dataDir, 'workflows.json'); this.runsFile = path.join(dataDir, 'workflow-runs.json');
    this.contextFile = path.join(dataDir, 'workflow-contexts.json'); this.contextQueue = Promise.resolve();
    this.backend = backend; this.speech = speech; this.inference = inference; this.fetcher = fetcher; this.emit = emit;
    this.outputs = outputs;
    this.active = null; this.execution = null; this.queue = Promise.resolve(); this.ready = this.open();
  }
  async open() {
    this.items = await readJson(this.file, []); this.runs = await readJson(this.runsFile, []);
    const oldItems = JSON.stringify(this.items), oldRuns = JSON.stringify(this.runs);
    const textBackend = this.backend?.defaultTextBackend || 'openai';
    this.items = this.items.map(item => migrateWorkflow(item, textBackend));
    for (const run of this.runs) if (run.workflow) run.workflow = migrateWorkflow(run.workflow, textBackend);
    if (JSON.stringify(this.items) !== oldItems) await writeJson(this.file, this.items);
    if (JSON.stringify(this.runs) !== oldRuns) await writeJson(this.runsFile, this.runs);
    this.contexts = await readJson(this.contextFile, {});
    for (const run of this.runs) if (['running', 'cancelling'].includes(run.status)) { run.status = 'interrupted'; run.endedAt = new Date().toISOString(); run.error = '应用关闭时运行中断，可重新执行'; for (const node of Object.values(run.nodes)) { if (node.status === 'running') node.status = 'interrupted'; else if (node.status === 'idle') node.status = 'skipped'; } }
  }
  list() { return this.items.map(({ nodes, edges, ...item }) => ({ ...item, count: nodes.length })); }
  get(id) { if (!ID.test(id ?? '')) throw new Error('工作流 ID 无效'); return this.items.find(w => w.id === id) ?? null; }
  listRuns() { return this.runs.map(({ nodes, workflow, ...run }) => ({ ...run, count: Object.keys(nodes).length })); }
  getRun(id) { if (!ID.test(id ?? '')) throw new Error('运行 ID 无效'); return this.runs.find(r => r.id === id) ?? null; }
  contextKey(workflowId, nodeId) { if (!ID.test(workflowId ?? '') || !ID.test(nodeId ?? '')) throw new Error('节点上下文 ID 无效'); return `${workflowId}:${nodeId}`; }
  getContext(workflowId, nodeId) { return JSON.parse(JSON.stringify(this.contexts[this.contextKey(workflowId, nodeId)]?.messages ?? [])); }
  async clearContext(workflowId, nodeId) { if (this.active) throw new Error('请等待工作流结束后再清空上下文'); await this.writeContext(this.contextKey(workflowId, nodeId), null); }
  writeContext(key, entry) {
    const task = this.contextQueue.then(async () => {
      const rest = Object.entries(this.contexts).filter(([id]) => id !== key);
      const next = Object.fromEntries((entry ? [[key, entry], ...rest] : rest).slice(0, 100));
      await writeJson(this.contextFile, next); this.contexts = next;
    }); this.contextQueue = task.catch(() => {}); return task;
  }
  async save(value) {
    const { workflow } = validateWorkflow(value);
    const task = this.queue.then(async () => {
      if (!this.items.some(w => w.id === workflow.id) && this.items.length >= 100) throw new Error('最多保存 100 个工作流');
      const entry = { ...workflow, updatedAt: new Date().toISOString() }; const items = [entry, ...this.items.filter(w => w.id !== entry.id)];
      await writeJson(this.file, items); this.items = items; return entry;
    }); this.queue = task.catch(() => {}); return task;
  }
  async delete(id) {
    if (!ID.test(id ?? '') || this.active?.workflowId === id) throw new Error('工作流不存在或正在运行');
    const task = this.queue.then(async () => { const items = this.items.filter(w => w.id !== id); await writeJson(this.file, items); this.items = items; }); this.queue = task.catch(() => {}); await task;
  }
  status() { return this.live ? this.live.snapshot() : this.active ? this.snapshot() : this.lastRun ?? this.runs[0] ?? null; }
  snapshot() { return JSON.parse(JSON.stringify(this.active)); }
  publish(nodeId) { if (this.live) this.live.merge(this.active, nodeId); else this.emit('workflow-event', this.snapshot()); }
  beginLive(workflow) { this.live = new LiveWorkflow(this, workflow); this.live.publish(true); return this.live; }
  start(value, { transient = false, seed, runId, startedAt, branchId, exclude = [] } = {}) {
    if (this.active) throw new Error('已有工作流正在执行，请等待或停止它');
    const plan = validateWorkflow(value, true, { live: !!seed }); const id = runId || randomUUID();
    if (seed) {
      const reachable = new Set([seed.nodeId]);
      for (const node of plan.order) if (!exclude.includes(node.id) && reachable.has(plan.inputs.get(node.id)) && (!branchId || plan.inputs.get(node.id) !== seed.nodeId || node.id === branchId)) reachable.add(node.id);
      plan.order = plan.order.filter(node => reachable.has(node.id) && node.id !== seed.nodeId);
      plan.unused = plan.workflow.nodes.filter(node => !reachable.has(node.id)).map(node => node.id);
      plan.seed = seed;
    }
    this.transient = transient;
    this.controller = new AbortController();
    this.active = { id, workflowId: plan.workflow.id, workflowName: plan.workflow.name, workflow: plan.workflow, status: 'running', startedAt: startedAt || new Date().toISOString(), nodes: Object.fromEntries(plan.workflow.nodes.map(n => [n.id, { status: plan.unused.includes(n.id) ? 'skipped' : 'idle' }])) };
    if (seed) this.active.nodes[seed.nodeId] = { status: 'completed', output: seed.output };
    this.publish(); const initial = this.snapshot();
    this.execution = this.execute(plan).finally(() => { this.active = null; this.execution = null; });
    return initial;
  }
  plan(value, executable = false, options = {}) { return validateWorkflow(value, executable, options); }
  async preflight(plan, signal, { live = false } = {}) {
    for (const node of plan.order) {
      signal.throwIfAborted();
      try { await nodeRegistry.handler(node.data.kind).preflight?.({ node, config: node.data.config, host: this, signal, live }); }
      catch (error) { throw new Error(`${node.data.label}：${error.message ?? error}`); }
    }
  }
  async execute(plan) {
    const run = this.active, signal = this.controller.signal, values = new Map(plan.seed ? [[plan.seed.nodeId, plan.seed.output]] : []); let current;
    try {
      if (!this.transient) await writeJson(this.runsFile, [this.snapshot(), ...this.runs].slice(0, 10));
      await this.preflight(plan, signal);
      for (const node of plan.order) {
        signal.throwIfAborted(); current = node.id; const state = run.nodes[current]; state.status = 'running'; state.startedAt = new Date().toISOString(); this.publish(current);
        const config = node.data.config, input = values.get(plan.inputs.get(node.id)); let output;
        if (this.transient && input?.type === 'text' && !input.text.trim()) {
          state.status = 'skipped'; values.set(node.id, input); this.publish(current); continue;
        }
        output = await nodeRegistry.handler(node.data.kind).execute({ node, config, input, signal, host: this, run, transient: this.transient, onUpdate: this.live ? text => this.live.preview(node, { type: 'text', text, partial: true }, run) : undefined });
        if (!output || output.type !== nodeRegistry.definitions[node.data.kind].output && nodeRegistry.definitions[node.data.kind].output) throw new Error('节点返回类型与端口不符');
        signal.throwIfAborted();
        if (output.type === 'text' && output.text.length > 32768) throw new Error('节点输出超过 32768 字符');
        values.set(node.id, output); state.output = output; state.status = 'completed'; state.endedAt = new Date().toISOString(); this.publish(current);
      }
      run.status = 'completed';
    } catch (error) {
      const cancelled = signal.aborted; run.status = cancelled ? 'cancelled' : 'failed'; run.error = cancelled ? '已停止工作流' : String(error.message ?? error).slice(0, 4096);
      if (current && run.nodes[current].status === 'running') { run.nodes[current].status = cancelled ? 'cancelled' : 'error'; run.nodes[current].error = run.error; }
      for (const state of Object.values(run.nodes)) if (state.status === 'idle') state.status = 'skipped';
    } finally {
      run.endedAt = new Date().toISOString(); this.lastRun = this.snapshot();
      if (!this.transient) {
        this.runs = [this.snapshot(), ...this.runs].slice(0, 10);
        try { await writeJson(this.runsFile, this.runs); } catch { run.error = (run.error ? `${run.error}；` : '') + '运行记录保存失败'; }
      }
      this.publish(current);
    }
    return this.lastRun;
  }
  cancel(id) { if (!this.active || this.active.id !== id || !['running', 'cancelling'].includes(this.active.status)) throw new Error('没有此运行任务或任务已经结束'); this.active.status = 'cancelling'; this.controller.abort(new Error('用户停止工作流')); this.publish(); return this.snapshot(); }
  stop() { if (this.active && ['running', 'cancelling'].includes(this.active.status)) this.cancel(this.active.id); }
}
module.exports = { Workflows };
