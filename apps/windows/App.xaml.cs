using Microsoft.UI.Xaml;

namespace CivicAgora.Windows;

/// <summary>
/// VS-A1 — 골격 검증용 앱 진입점.
/// 작업 단위: docs/09_DEVELOPMENT_PLAN.md VS-A1
/// </summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();

        // 미처리 예외로 조용히 종료되면 사용자도 우리도 원인을 알 수 없다.
        // 최소한 로그에는 남긴다.
        UnhandledException += (_, e) =>
        {
            System.Diagnostics.Debug.WriteLine($"[CivicAgora] 미처리 예외: {e.Exception}");
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
