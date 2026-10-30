using System.Diagnostics;
using System.Threading.Channels;

namespace MultiStudio.Native;

public record CaptureOptions(string NodeId, string Source, string DeviceId = "", float SegmentSeconds = 120, bool Continuous = false, bool Streaming = false);

public sealed class AudioCapture(string dataDir, Action<string, object?> emit) : IDisposable {
    private IAudioSource? source;
    private CaptureOptions? options;
    private string? sessionId;
    private Channel<float[]>? frames;
    private Task? reader;
    private readonly object gate = new();
    private IAudioSource Source => source ??= OperatingSystem.IsWindows() ? new WindowsAudio() : new MacAudio();
    public IEnumerable<AudioEndpoint> Devices() => Source.Devices().ToArray();
    public string Start(CaptureOptions input) {
        lock (gate) {
            if (sessionId != null) throw new InvalidOperationException("音频设备正在使用中");
            options = input; sessionId = Guid.NewGuid().ToString();
            frames = Channel.CreateUnbounded<float[]>(new UnboundedChannelOptions { SingleReader = true });
            var target = frames;
            try { Source.Start(input.Source, input.DeviceId, samples => target.Writer.TryWrite(samples)); }
            catch { sessionId = null; frames = null; throw; }
            reader = Read(target.Reader, sessionId, input);
            emit("audio-capture", new { sessionId, nodeId = input.NodeId, state = "recording" });
            return sessionId;
        }
    }
    private async Task Read(ChannelReader<float[]> channel, string id, CaptureOptions input) {
        var buffer = new List<short>();
        var meter = Stopwatch.StartNew(); long received = 0;
        var packetSize = input.Streaming ? 800 : (int)(input.SegmentSeconds * 16000);
        Directory.CreateDirectory(Path.Combine(dataDir, "audio"));
        await foreach (var samples in channel.ReadAllAsync()) {
            received += samples.Length;
            buffer.AddRange(samples.Select(sample => (short)(Math.Clamp(sample, -1, 1) * short.MaxValue)));
            if (meter.ElapsedMilliseconds >= 200) {
                var rms = Math.Sqrt(samples.Sum(sample => (double)sample * sample) / Math.Max(1, samples.Length));
                emit("audio-capture", new { sessionId = id, nodeId = input.NodeId, state = "recording", rms, seconds = received / 16000d });
                meter.Restart();
            }
            while (buffer.Count >= packetSize) {
                var block = buffer.GetRange(0, packetSize).ToArray(); buffer.RemoveRange(0, packetSize);
                Publish(id, input, block);
            }
        }
        if (buffer.Count > 0) Publish(id, input, buffer.ToArray());
        emit("audio-capture", new { sessionId = id, nodeId = input.NodeId, state = "stopped" });
    }
    private void Publish(string id, CaptureOptions input, short[] samples) {
        if (input.Streaming) { emit("audio-pcm", new { sessionId = id, nodeId = input.NodeId, samples }); return; }
        var audioId = Guid.NewGuid().ToString();
        var filename = Path.Combine(dataDir, "audio", audioId + ".wav");
        using (var writer = new BinaryWriter(File.Create(filename))) {
            writer.Write("RIFF"u8); writer.Write(36 + samples.Length * 2); writer.Write("WAVEfmt "u8); writer.Write(16);
            writer.Write((short)1); writer.Write((short)1); writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
            writer.Write("data"u8); writer.Write(samples.Length * 2);
            foreach (var sample in samples) writer.Write(sample);
        }
        emit("audio-capture", new { sessionId = id, nodeId = input.NodeId, state = "segment", audioId, duration = samples.Length / 16000d });
    }
    public object? Stop(string? id) {
        lock (gate) {
            if (sessionId == null) return null;
            if (id != null && id != sessionId) throw new InvalidOperationException("采集会话已更换");
            Source.Stop(); frames!.Writer.Complete(); reader!.GetAwaiter().GetResult();
            sessionId = null; frames = null; reader = null; return null;
        }
    }
    public void Dispose() { Stop(null); source?.Dispose(); }
}
