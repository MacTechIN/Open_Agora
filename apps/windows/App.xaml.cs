using System;
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
        StartupLog.WriteHeader();
        StartupLog.Write("App 생성자 진입");

        InitializeComponent();
        StartupLog.Write("InitializeComponent 완료");

        // 미처리 예외로 조용히 종료되면 사용자도 우리도 원인을 알 수 없다.
        // 최소한 로그에는 남긴다.
        UnhandledException += (_, e) =>
        {
            StartupLog.WriteException("미처리 예외", e.Exception);
            System.Diagnostics.Debug.WriteLine($"[CivicAgora] 미처리 예외: {e.Exception}");
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        StartupLog.Write("OnLaunched 진입");
        try
        {
            _window = new MainWindow();
            StartupLog.Write("MainWindow 생성 완료");
            _window.Activate();
            StartupLog.Write("창 활성화 완료 — 정상 시작");
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("창 생성", ex);
            throw;
        }
    }
}
