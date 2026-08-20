import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type StartOpts = {
  sourceKind: "microphone" | "loopback" | "microphone+loopback";
  deviceId?: string | null;
};

export function useAudioCapture() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(async () => {
    try {
      workletRef.current?.disconnect();
      workletRef.current = null;
      if (ctxRef.current) {
        await ctxRef.current.close();
        ctxRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {
      // ignore
    }
    setActive(false);
  }, []);

  const start = useCallback(
    async (opts: StartOpts) => {
      setError(null);
      const kind = opts.sourceKind;

      let stream: MediaStream;
      try {
        if (kind === "loopback" || kind === "microphone+loopback") {
          // System audio via getDisplayMedia (user picks screen/window; audio loopback requires audio:true).
          // Not all browsers/platforms expose loopback, so we fall back to mic if denied.
          const display = await (navigator.mediaDevices as unknown as { getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> }).getDisplayMedia?.({
            audio: true,
            video: true,
          });
          if (display) {
            const audioTracks = display.getAudioTracks();
            if (audioTracks.length === 0) {
              display.getTracks().forEach((t) => t.stop());
              throw new Error("系统音频未捕获到音轨，请在分享弹窗中勾选“分享音频/Share audio”");
            }
            // Drop video track, keep audio only
            display.getVideoTracks().forEach((t) => t.stop());
            if (kind === "microphone+loopback") {
              const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined } });
              mic.getAudioTracks().forEach((t) => display.addTrack(t));
            }
            stream = display;
          } else {
            throw new Error("浏览器不支持 getDisplayMedia，无法捕获系统音频");
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (kind !== "microphone") {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            setError(msg);
            throw e;
          }
        } else {
          setError(msg);
          throw e;
        }
      }

      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 48000 });
      ctxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      // Use ScriptProcessor fallback if AudioWorklet unavailable (simpler, universally supported for MVP)
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      src.connect(processor);
      processor.connect(ctx.destination);

      let pending: Float32Array[] = [];
      let pendingLen = 0;
      const CHUNK_SAMPLES = 4800; // 100ms @ 48k

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        pending.push(copy);
        pendingLen += copy.length;
        while (pendingLen >= CHUNK_SAMPLES) {
          const out = new Float32Array(CHUNK_SAMPLES);
          let off = 0;
          while (off < CHUNK_SAMPLES && pending.length > 0) {
            const head = pending[0]!;
            const need = CHUNK_SAMPLES - off;
            if (head.length <= need) {
              out.set(head, off);
              off += head.length;
              pending.shift();
              pendingLen -= head.length;
            } else {
              out.set(head.subarray(0, need), off);
              pending[0] = head.subarray(need);
              pendingLen -= need;
              off += need;
            }
          }
          const samples = Array.from(out);
          invoke("push_audio_chunk", { samples, sampleRate: ctx.sampleRate, channels: 1 }).catch(() => {});
        }
      };

      // Keep ref so stop() can disconnect
      workletRef.current = processor as unknown as AudioWorkletNode;
      setActive(true);
    },
    [],
  );

  return { active, error, start, stop };
}
