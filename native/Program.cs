using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using MultiStudio.Native;

Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var messages = Channel.CreateUnbounded<object>(new UnboundedChannelOptions { SingleReader = true });
void Emit(string name, object? payload) => messages.Writer.TryWrite(new { @event = name, payload });
var writer = Task.Run(async () => {
    await foreach (var message in messages.Reader.ReadAllAsync())
        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(message, options));
});
var dataDir = Argument("--data-dir") ?? throw new ArgumentException("缺少 --data-dir");
using var audio = new AudioCapture(dataDir, Emit);
Emit("backend-ready", new { protocolVersion = 1, language = "csharp" });
var tasks = new List<Task>();
while (await Console.In.ReadLineAsync() is { } line) {
    JsonObject request;
    try { request = JsonNode.Parse(line)!.AsObject(); }
    catch (JsonException error) { await Console.Error.WriteLineAsync(error.Message); continue; }
    var command = request["command"]!.GetValue<string>();
    if (command == "__shutdown") break;
    tasks.Add(Task.Run(() => {
        var id = request["id"]!.GetValue<long>();
        var args = request["args"]?.AsObject() ?? new JsonObject();
        try {
            object? result = command switch {
                "backend_info" => new { protocolVersion = 1, platform = OperatingSystem.IsWindows() ? "windows" : "macos", language = "csharp", framework = ".NET 10", workerPid = Environment.ProcessId },
                "list_audio_devices" => audio.Devices(),
                "native_audio_available" => OperatingSystem.IsWindows(),
                "audio_capture_start" => audio.Start(args.Deserialize<CaptureOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!),
                "audio_capture_stop" => audio.Stop(args["sessionId"]?.GetValue<string>()),
                "runtime_extract" => Archives.Extract(args),
                _ => throw new InvalidOperationException($"未知原生操作：{command}"),
            };
            messages.Writer.TryWrite(new { id, result });
        } catch (Exception error) { messages.Writer.TryWrite(new { id, error = new { message = error.Message } }); }
    }));
    tasks.RemoveAll(task => task.IsCompleted);
}
audio.Stop(null);
await Task.WhenAll(tasks);
messages.Writer.Complete();
await writer;

string? Argument(string name) {
    var index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
}
