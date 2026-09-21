using Microsoft.UI.Xaml;

namespace CivicAgora.Windows;

/// <summary>
/// VS-A1 — 공유 Rust 코어를 uniffi C# 바인딩으로 호출해 결과를 표시한다.
/// 이 창이 뜨면 UI → 바인딩 → 코어 경로가 뚫린 것이다.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        // 생성된 바인딩을 통한 코어 호출. 손으로 쓴 P/Invoke를 두지 않는다.
        var info = global::CivicAgora.Core.CivicagoraMethods.CoreInfo();

        VersionText.Text = info.version;
        SpecText.Text = $"rev {info.specRevision}";
        TargetText.Text = info.target;
        ProfileText.Text = info.debug ? "debug" : "release";
    }
}
