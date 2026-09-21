using Microsoft.UI.Xaml;

namespace CivicAgora.Windows;

/// <summary>
/// VS-A1 — 골격 검증용 앱 진입점.
/// 작업 단위: docs/09_DEVELOPMENT_PLAN.md VS-A1
/// </summary>
public partial class App : Application
{
    private Window? _window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
