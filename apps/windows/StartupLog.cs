using System;
using System.IO;

namespace CivicAgora.Windows;

/// <summary>
/// 시작 진단 로그.
///
/// WinUI 앱은 콘솔이 없어 시작 중 실패하면 사용자가 아무것도 보지 못한다.
/// 창이 뜨기 전에 죽는 경우를 진단하려면 파일에 흔적을 남기는 수밖에 없다.
///
/// 로그는 %LOCALAPPDATA%\CivicAgora\startup.log 에 쌓인다.
/// 실행할 때마다 덮어쓰지 않고 이어 붙여, 성공한 실행과 실패한 실행을
/// 나란히 비교할 수 있게 한다.
/// </summary>
internal static class StartupLog
{
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CivicAgora",
        "startup.log");

    /// <summary>진단 로그 경로. 사용자에게 보여주기 위해 공개한다.</summary>
    internal static string Location => Path;

    internal static void Write(string stage, string? detail = null)
    {
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
            var line = detail is null
                ? $"{DateTime.Now:HH:mm:ss.fff}  {stage}"
                : $"{DateTime.Now:HH:mm:ss.fff}  {stage}: {detail}";
            File.AppendAllText(Path, line + Environment.NewLine);
        }
        catch
        {
            // 로그 실패가 앱을 죽이면 본말전도다. 조용히 무시한다.
        }
    }

    internal static void WriteHeader()
    {
        Write("─────────── 실행 시작 ───────────");
        Write("OS", Environment.OSVersion.VersionString);
        Write("아키텍처", $"{System.Runtime.InteropServices.RuntimeInformation.OSArchitecture} / 프로세스 {System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");
        Write(".NET", Environment.Version.ToString());
        Write("실행 경로", AppContext.BaseDirectory);
    }

    internal static void WriteException(string stage, Exception ex)
    {
        Write($"{stage} 실패", $"{ex.GetType().FullName}: {ex.Message}");
        if (ex.InnerException is { } inner)
        {
            Write("  내부 예외", $"{inner.GetType().FullName}: {inner.Message}");
        }
        Write("  스택", ex.StackTrace ?? "(없음)");
    }
}
