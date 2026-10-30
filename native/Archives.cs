using System.IO.Compression;
using System.Text.Json.Nodes;

namespace MultiStudio.Native;

public static class Archives {
    public static object? Extract(JsonObject args) {
        ZipFile.ExtractToDirectory(args["archive"]!.GetValue<string>(), args["directory"]!.GetValue<string>(), true);
        return null;
    }
}
