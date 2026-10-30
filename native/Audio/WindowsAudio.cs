using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace MultiStudio.Native;

public sealed class WindowsAudio : IAudioSource {
    private readonly MMDeviceEnumerator enumerator = new();
    private WasapiCapture? capture;
    public IEnumerable<AudioEndpoint> Devices() {
        foreach (var flow in new[] { DataFlow.Capture, DataFlow.Render }) {
            var defaultId = enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia).ID;
            foreach (var device in enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
                yield return new(device.ID, device.FriendlyName, flow == DataFlow.Capture ? "input" : "output", device.ID == defaultId);
        }
    }
    public void Start(string source, string deviceId, Action<float[]> receive) {
        var flow = source == "system" ? DataFlow.Render : DataFlow.Capture;
        var device = string.IsNullOrWhiteSpace(deviceId) ? enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia)
            : enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active).FirstOrDefault(item => item.ID == deviceId || item.FriendlyName == deviceId.Replace("output:", ""))
                ?? throw new InvalidOperationException("所选音频设备不可用");
        capture = source == "system" ? new WasapiLoopbackCapture(device) : new WasapiCapture(device);
        var buffer = new BufferedWaveProvider(capture.WaveFormat) { ReadFully = false, BufferDuration = TimeSpan.FromSeconds(5) };
        ISampleProvider samples = buffer.ToSampleProvider();
        if (samples.WaveFormat.Channels == 2) samples = new StereoToMonoSampleProvider(samples) { LeftVolume = .5f, RightVolume = .5f };
        else if (samples.WaveFormat.Channels > 2) samples = new ChannelAverage(samples);
        var mono = new WdlResamplingSampleProvider(samples, 16000);
        capture.DataAvailable += (_, eventArgs) => {
            buffer.AddSamples(eventArgs.Buffer, 0, eventArgs.BytesRecorded);
            var output = new float[1600];
            while (buffer.BufferedBytes > 0) {
                var count = mono.Read(output, 0, output.Length);
                if (count == 0) break;
                receive(output[..count]);
            }
        };
        capture.StartRecording();
    }
    public void Stop() { capture?.StopRecording(); capture?.Dispose(); capture = null; }
    public void Dispose() { Stop(); enumerator.Dispose(); }

    private sealed class ChannelAverage(ISampleProvider source) : ISampleProvider {
        public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 1);
        public int Read(float[] buffer, int offset, int count) {
            var channels = source.WaveFormat.Channels;
            var input = new float[count * channels];
            var frames = source.Read(input, 0, input.Length) / channels;
            for (var frame = 0; frame < frames; frame++) {
                float sum = 0;
                for (var channel = 0; channel < channels; channel++) sum += input[frame * channels + channel];
                buffer[offset + frame] = sum / channels;
            }
            return frames;
        }
    }
}
