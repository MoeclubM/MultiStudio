export type AudioAttachment = { name: string; duration: number; bytes: Uint8Array; url: string };
export async function prepareAudio(blob: Blob, name: string): Promise<AudioAttachment> {
  if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error("输入音频大小应为 1 B–25 MB");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.duration || decoded.duration > 120) throw new Error("当前单条音频支持最多 120 秒");
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(); const samples = rendered.getChannelData(0);
    const bytes = new Uint8Array(44 + samples.length * 2); const view = new DataView(bytes.buffer);
    const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return { name, duration: decoded.duration, bytes, url: URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })) };
  } catch (error) { if (error instanceof DOMException) throw new Error("无法解码此音频；请使用 WAV、MP3 等受支持的音频格式"); throw error; }
  finally { await context.close(); }
}
