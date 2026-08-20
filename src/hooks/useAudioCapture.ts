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
          const getDisplayMedia = (navigator.mediaDevices as unknown as {
            getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
          }).getDisplayMedia;
          if (!getDisplayMedia) {
            throw new Error("浏览器不支持 getDisplayMedia，无法捕获系统音频。请改用麦克风，或在桌面端未来版本使用原生 WASAPI loopback。");
          }
          const display = await getDisplayMedia.call(navigator.mediaDevices, {
            audio: {
              // 关键：禁止用 video:true，否则用户选窗口时会把画面“分享”出去，Tauri 窗口变黑/被遮。
              // 系统音频只需要 audio，video 用极小的 ideal 约束，选“整个屏幕”也能捕获音频。
            } as MediaTrackConstraints,
            video: {
              width: { ideal: 1 },
              height: { ideal: 1 },
              frameRate: { ideal: 1 },
            },
          } as MediaStreamConstraints);

          const audioTracks = display.getAudioTracks();
          if (audioTracks.length === 0) {
            display.getTracks().forEach((t) => t.stop());
            throw new Error("系统音频未捕获到音轨。请在分享弹窗中勾选“分享音频/Share audio”（或“Share system audio”），并选择“整个屏幕/Entire screen”或“标签页/Tab”。");
          }

          // 关键：视频轨 enabled=false 而非 stop()，避免某些 WebView 在无 video 轨时误判流结束导致画面闪烁；
          // 但但绝不能让视频轨推到混音中，也不能回放到扬声器。
          const videoTracks = display.getVideoTracks();
          videoTracks.forEach((t) => {
            t.enabled = false;
            // 立即停止视频轨，避免持续捕获桌面造成黑屏/回声
            t.stop();
          });

          // 用户取消分享时自动停止采集
          audioTracks.forEach((t) => {
            t.addEventListener("ended", () => {
              void stop();
            });
          });

          if (kind === "microphone+loopback") {
            try {
              const mic = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined },
              });
              mic.getAudioTracks().forEach((t) => display.addTrack(t));
            } catch (e) {
              // 麦克风失败不阻断系统音频，仅提示
              console.warn("[audio] mic add failed", e);
            }
          }
          stream = display;
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
          // 用户取消或未勾音频等，提示后回退麦克风
          const isAbort = /NotAllowedError|AbortError|Permission denied/i.test(msg);
          if (isAbort) {
            setError("系统音频捕获已取消。如需系统音频，请重选并勾选“分享音频”。已回退到麦克风。");
          } else {
            setError(msg);
          }
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
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
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      src.connect(processor);
      // 关键：不连接 ctx.destination，避免麦克风/系统音频回放到扬声器造成啸叫与回声
      // 旧代码 processor.connect(ctx.destination) 会把输入直接回放

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

      // Keep ref so stop() can disconnect; ScriptProcessor is AudioNode, cast narrow
      workletRef.current = processor as unknown as AudioWorkletNode;
      setActive(true);
    },
    [stop],
  );

  return { active, error, start, stop };
}
