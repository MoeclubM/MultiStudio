const { randomUUID } = require('node:crypto');
const { nodeRegistry } = require('./node-registry.cjs');

class LiveWorkflow {
  constructor(host, workflow) {
    this.host = host; this.workflow = workflow; this.textStreams = new Map();
    this.run = { id: randomUUID(), workflowId: workflow.id, workflowName: workflow.name, workflow, status: 'running', streaming: true, startedAt: new Date().toISOString(), nodes: Object.fromEntries(workflow.nodes.map(node => [node.id, { status: nodeRegistry.definitions[node.data.kind].session ? 'running' : 'idle' }])) };
  }
  snapshot() { return structuredClone(this.run); }
  publish(immediate = false) {
    if (!immediate) { this.publishTimer ||= setTimeout(() => this.publish(true), 50); return; }
    clearTimeout(this.publishTimer); this.publishTimer = null;
    // The graph is immutable during a run; only changing results need to cross IPC.
    const { workflow, ...state } = this.run;
    this.host.emit('workflow-event', structuredClone(state));
  }
  merge(execution, nodeId) {
    if (nodeId) {
      const previous = this.run.nodes[nodeId];
      if (!previous.utteranceStartedAt || previous.utteranceStartedAt <= execution.startedAt) this.run.nodes[nodeId] = { ...execution.nodes[nodeId], utteranceStartedAt: execution.startedAt };
    }
    this.publish();
  }
  async preview(node, value, utterance) {
    const result = this.run.nodes[node.id];
    Object.assign(result, { status: value.partial ? 'running' : 'completed', output: value, utteranceStartedAt: utterance.startedAt });
    this.publish();
    const run = { ...this.run, id: utterance.id, startedAt: utterance.startedAt };
    for (const edge of this.workflow.edges.filter(edge => edge.source === node.id)) {
      const target = this.workflow.nodes.find(node => node.id === edge.target), handler = nodeRegistry.handler(target.data.kind);
      if (handler.createTextStream) {
        let processor = this.textStreams.get(target.id);
        if (!processor) {
          processor = handler.createTextStream({ config: target.data.config,
            emit: (output, part) => { this.run.nodes[target.id] = { status: 'completed', output, utteranceStartedAt: part.startedAt }; this.publish(); this.onChunk?.({ node: target, output, utterance: part }); },
            preview: (output, part) => { this.run.nodes[target.id] = { status: 'running', output, utteranceStartedAt: part.startedAt }; this.publish(); },
          });
          this.textStreams.set(target.id, processor);
        }
        await processor.push(value, utterance); continue;
      }
      if (!handler.preview) continue;
      await handler.preview({ node: target, config: target.data.config, input: value, host: this.host, run });
      this.run.nodes[target.id] = { status: value.partial ? 'running' : 'completed', output: value, utteranceStartedAt: utterance.startedAt };
      this.publish();
    }
  }
  async executeFrom(node, output, utterance, branchId) {
    this.host.start(this.workflow, { transient: true, seed: { nodeId: node.id, output }, runId: utterance.id, startedAt: utterance.startedAt, branchId, exclude: [...this.textStreams.keys()] });
    return await this.host.execution;
  }
  end(error) {
    for (const processor of this.textStreams.values()) processor.cancel?.();
    this.run.status = error ? 'failed' : 'cancelled'; this.run.error = error?.message; this.run.endedAt = new Date().toISOString();
    for (const state of Object.values(this.run.nodes)) if (state.status === 'running') state.status = state.output ? 'completed' : 'cancelled';
    this.publish(true); this.host.lastRun = this.snapshot(); this.host.live = null;
  }
}
module.exports = { LiveWorkflow };
