using System;
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

        // 코어 호출은 반드시 보호한다. 생성자에서 예외가 나가면 창이 뜨기 전에
        // 앱이 죽고, 사용자는 아무 메시지도 보지 못한다. 네이티브 DLL 로드
        // 실패가 대표적인 경우다.
        try
        {
            // 생성된 바인딩을 통한 코어 호출. 손으로 쓴 P/Invoke를 두지 않는다.
            var info = global::CivicAgora.Core.CivicagoraMethods.CoreInfo();

            VersionText.Text = info.version;
            SpecText.Text = $"rev {info.specRevision}";
            TargetText.Text = info.target;
            ProfileText.Text = info.debug ? "debug" : "release";
        }
        catch (Exception ex)
        {
            VersionText.Text = "코어를 불러오지 못했습니다";
            SpecText.Text = ex.GetType().Name;
            TargetText.Text = ex.Message;
            ProfileText.Text = "civicagora_core.dll 로드 실패 가능성";
        }

        // 키는 CNG 안에 있고 여기선 DID만 받는다. 실패해도 창이 뜨지 않으면
        // 원인을 알 수 없으므로 화면에 표시한다.
        try
        {
            var identity = DeviceIdentity.LoadOrCreate();
            DidText.Text = identity.Did;
            ProtectionText.Text = identity.Protection == DeviceIdentity.Protection.Hardware
                ? "하드웨어 (TPM)"
                : "소프트웨어 KSP — 내보내기 차단";
        }
        catch (Exception ex)
        {
            DidText.Text = "신원 생성 실패";
            ProtectionText.Text = ex.Message;
        }
    }
}
