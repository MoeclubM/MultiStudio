const { EventEmitter } = require('node:events');
const { ID } = require('./speech.cjs');

class AudioCapture extends EventEmitter {
  constructor(backend, broadcast) {
    super(); this.backend = backend; this.broadcast = broadcast; this.current = null; this.last = null;
    backend.on('event', (name, event) => {
      if (name === 'audio-capture') this.receive(event);
      if (name === 'audio-pcm' && this.current?.nodeId === event.nodeId && (!this.current.sessionId || this.current.sessionId === event.sessionId)) this.emit('pcm', { ...this.current, ...event });
    });
  }
  receive(event) {
    if (!this.current || this.current.nodeId !== event.nodeId || this.current.sessionId && this.current.sessionId !== event.sessionId) return;
    this.current.sessionId = event.sessionId;
    this.last = { ...this.current, ...event };
    this.broadcast('audio-capture', this.last); this.emit('capture', this.last);
    if (event.state === 'stopped') this.current = null;
  }
  status() { return this.current ? { ...this.current, state: 'recording' } : this.last; }
  async start({ nodeId, source, deviceId = '', segmentSeconds = 4, continuous = false, streaming = false }, owner = 'manual') {
    if (this.current) throw new Error('另一个节点或插件正在采集音频');
    if (!ID.test(nodeId || '') || !['microphone', 'system'].includes(source)) throw new Error('请选择有效的音频输入节点');
    if (source === 'system' && process.platform !== 'win32') throw new Error('此平台请在麦克风列表选择虚拟音频设备');
    this.current = { nodeId, source, owner, sessionId: null }; this.last = null;
    try {
      const sessionId = await this.backend.invoke('audio_capture_start', { nodeId, source, deviceId, segmentSeconds, continuous, streaming });
      if (this.current) this.current.sessionId = sessionId;
      return { sessionId };
    } catch (error) { this.current = null; throw error; }
  }
  async stop(sessionId) {
    if (this.current) await this.backend.invoke('audio_capture_stop', { sessionId: sessionId || this.current.sessionId });
    return this.last;
  }
}
module.exports = { AudioCapture };
