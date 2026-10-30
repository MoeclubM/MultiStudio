namespace MultiStudio.Native;

public record AudioEndpoint(string Id, string Name, string Kind, bool IsDefault);

public interface IAudioSource : IDisposable {
    IEnumerable<AudioEndpoint> Devices();
    void Start(string source, string deviceId, Action<float[]> receive);
    void Stop();
}
