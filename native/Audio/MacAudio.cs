using SoundFlow.Abstracts.Devices;
using SoundFlow.Backends.MiniAudio;
using SoundFlow.Backends.MiniAudio.Devices;
using SoundFlow.Enums;
using SoundFlow.Structs;

namespace MultiStudio.Native;

public sealed class MacAudio : IAudioSource {
    private readonly MiniAudioEngine engine = new();
    private AudioCaptureDevice? capture;
    public IEnumerable<AudioEndpoint> Devices() => engine.CaptureDevices.Select(device => new AudioEndpoint(device.Name, device.Name, "input", device.IsDefault));
    public void Start(string source, string deviceId, Action<float[]> receive) {
        if (source == "system") throw new NotSupportedException("macOS 请在麦克风输入中选择虚拟音频设备");
        var format = new AudioFormat { Channels = 1, SampleRate = 16000, Format = SampleFormat.F32 };
        var selected = string.IsNullOrEmpty(deviceId) ? engine.CaptureDevices.FirstOrDefault(device => device.IsDefault) : engine.CaptureDevices.First(device => device.Name == deviceId);
        capture = engine.InitializeCaptureDevice(selected, format, new MiniAudioDeviceConfig { PeriodSizeInMilliseconds = 20 });
        capture.OnAudioProcessed += (samples, _) => receive(samples.ToArray());
        capture.Start();
    }
    public void Stop() { capture?.Stop(); capture?.Dispose(); capture = null; }
    public void Dispose() { Stop(); engine.Dispose(); }
}
