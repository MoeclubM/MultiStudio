const fs = require('node:fs/promises');
const path = require('node:path');
const { Utterances, wave } = require('./utterances.cjs');

module.exports.createSession = function realtimeAudio(host) {
  let active = false, stopping = false, sessionId, workflow, input, listener, pcmListener, controller, live;
  let routers = [], pending = [], processing = null, failure, shutdown;
  const temporary = new Set();
  let state = { status: 'stopped', processed: 0, skipped: 0, queued: 0, error: null };
  const publish = patch => { state = { ...state, ...patch }; host.update(state); };
  async function discard(id) { if (temporary.delete(id)) await fs.unlink(path.join(host.audioDirectory, `${id}.wav`)).catch(() => {}); }
  function fail(error) {
    if (failure || stopping) return;
    failure = error; active = false; controller?.abort();
    publish({ status: 'error', error: error.message });
    void stop(error).catch(() => {});
  }
  async function drain() {
    while (active && pending.length) {
      const item = pending.shift(); publish({ queued: pending.length });
      try {
        const run = await live.executeFrom(item.node, item.output, item.utterance, item.branchId);
        if (run.status === 'failed') throw new Error(run.error);
        if (active) publish({ processed: state.processed + 1 });
      } catch (error) { fail(error); }
      finally { if (item.audioId) await discard(item.audioId); }
    }
  }
  function enqueue(item) {
    if (!active) { if (item.audioId) void discard(item.audioId); return; }
    pending.push(item); publish({ queued: pending.length });
    if (!processing) processing = drain().finally(() => { processing = null; });
  }
  function stop(error) {
    if (!shutdown) shutdown = stopInternal(error).finally(() => { shutdown = null; });
    return shutdown;
  }
  async function stopInternal(error) {
    stopping = true; active = false; publish({ status: 'stopping' });
    try {
      if (host.capture.current?.owner === 'realtime-translation') await host.capture.stop(sessionId);
      if (error) routers.forEach(router => router.cancel());
      else await Promise.all(routers.map(router => router.finish()));
      controller?.abort();
      host.workflows.stop(); await processing;
    } catch (stopError) { error ||= stopError; }
    finally {
      if (listener) host.capture.off('capture', listener);
      if (pcmListener) host.capture.off('pcm', pcmListener);
      routers = []; pending = []; for (const id of [...temporary]) await discard(id);
      live?.end(error); live = null; processing = null; sessionId = null; stopping = false;
      publish({ status: error ? 'error' : 'stopped', error: error?.message || null, queued: 0 });
    }
  }
  return {
    async start({ workflow: value }) {
      if (active || stopping) throw new Error('实时音频正在运行或停止中');
      controller = new AbortController(); failure = null;
      workflow = structuredClone(value);
      const plan = host.workflows.plan(workflow, true, { live: true });
      const sources = plan.order.filter(node => host.isSessionNode(node));
      if (sources.length !== 1) throw new Error('工作流需要一个实时音频输入');
      input = sources[0];
      if (input.data.config.source === 'system' && plan.order.some(node => node.data.kind === 'audio-output' && node.data.config.autoplay)) throw new Error('系统音频采集时请关闭自动播放，避免回声');
      await host.workflows.preflight(plan, controller.signal, { live: true });
      controller.signal.throwIfAborted();
      live = host.workflows.beginLive(workflow); live.onChunk = enqueue; active = true;
      const consumers = plan.order.filter(node => plan.inputs.get(node.id) === input.id);
      routers = consumers.map(node => new Utterances({
        onError: fail,
        open: async utterance => {
          const handler = host.nodeRuntime(node);
          if (handler.canStream?.(node.data.config)) {
            return handler.openStream({ host: host.workflows, config: node.data.config, node, signal: controller.signal,
              onUpdate: ({ text, final, committed }) => text.trim() ? live.preview(node, { type: 'text', text, partial: !final, committed }, utterance) : undefined });
          }
          const frames = []; let resolve;
          const done = new Promise(next => { resolve = next; });
          return { done, write: samples => frames.push(samples), cancel: () => resolve(null), finish: async () => {
            const audio = await host.workflows.speech.saveInput(wave(frames)); temporary.add(audio.id); resolve(audio); return audio;
          } };
        },
        onFinal: async (result, utterance) => {
          if (typeof result === 'string') {
            if (result.trim()) enqueue({ node, output: { type: 'text', text: result }, utterance });
            else publish({ skipped: state.skipped + 1 });
          } else if (result) enqueue({ node: input, output: { type: 'audio', audioId: result.id }, audioId: result.id, utterance, branchId: node.id });
        },
      }));
      listener = event => {
        if (event.owner === 'realtime-translation' && event.nodeId === input.id && event.state === 'error') fail(new Error(event.error));
      };
      pcmListener = event => {
        if (event.owner === 'realtime-translation' && event.nodeId === input.id) for (const router of routers) router.push(event.samples);
      };
      host.capture.on('capture', listener); host.capture.on('pcm', pcmListener);
      try {
        ({ sessionId } = await host.capture.start({ nodeId: input.id, source: input.data.config.source, deviceId: input.data.config.deviceId, streaming: true, continuous: true }, 'realtime-translation'));
        publish({ status: 'running', workflowId: workflow.id, processed: 0, skipped: 0, queued: 0, error: null });
      } catch (error) { await stop(error); throw error; }
    },
    stop,
  };
};

module.exports.nodes = {
  'live-audio-input': {
    migrate(data) {
      const { segmentSeconds, ...config } = data.config;
      return { ...data, label: data.label === '连续音频' ? '实时音频' : data.label, config };
    },
    validate(config) { if (!['microphone', 'system'].includes(config.source)) throw new Error('实时音频需要麦克风或系统声音'); },
    async preflight({ config, host, live }) { if (!live) await host.speech.validateAudio(config.audioId); },
    async execute({ config, host }) { await host.speech.validateAudio(config.audioId); return { type: 'audio', audioId: config.audioId }; },
  },
};
