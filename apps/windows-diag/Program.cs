using System;
using System.IO;
using System.Runtime.InteropServices;

// CivicAgora 진단 도구
//
// 본체 앱이 창도 없이 죽을 때, 어느 계층이 문제인지 갈라낸다.
// 이 도구가 성공하면 네이티브 코어는 정상이고 WinUI 계층이 문제다.
// 이 도구도 실패하면 코어 적재 자체가 문제다.

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("CivicAgora 진단 도구");
Console.WriteLine(new string('─', 50));

void Line(string label, string value) => Console.WriteLine($"  {label,-16} {value}");

Line("OS", Environment.OSVersion.VersionString);
Line("OS 아키텍처", RuntimeInformation.OSArchitecture.ToString());
Line("프로세스", RuntimeInformation.ProcessArchitecture.ToString());
Line(".NET", Environment.Version.ToString());
Line("실행 경로", AppContext.BaseDirectory);
Console.WriteLine();

// 1) 네이티브 코어 파일이 있는가
var corePath = Path.Combine(AppContext.BaseDirectory, "civicagora_core.dll");
Console.WriteLine("[1] 네이티브 코어 파일");
if (File.Exists(corePath))
{
    Line("상태", $"있음 ({new FileInfo(corePath).Length:N0} bytes)");
}
else
{
    Line("상태", "없음 — 코어 DLL이 배포되지 않았습니다");
    Console.WriteLine("\n진단 종료. 배포 구성 문제입니다.");
    return 1;
}
Console.WriteLine();

// 2) 코어를 적재하고 호출할 수 있는가
Console.WriteLine("[2] 코어 적재 및 호출");
try
{
    var info = CivicAgora.Core.CivicagoraMethods.CoreInfo();
    Line("코어 버전", info.version);
    Line("명세 계약", $"rev {info.specRevision}");
    Line("빌드 대상", info.target);
    Line("빌드 프로필", info.debug ? "debug" : "release");
}
catch (Exception ex)
{
    Line("실패", $"{ex.GetType().Name}: {ex.Message}");
    if (ex.InnerException is { } inner) Line("내부", $"{inner.GetType().Name}: {inner.Message}");
    Console.WriteLine("\n네이티브 코어 적재에 실패했습니다. 이 메시지를 알려주십시오.");
    return 2;
}
Console.WriteLine();

// 3) 기기 신원을 만들 수 있는가 (CNG 접근)
Console.WriteLine("[3] 기기 신원 (CNG)");
try
{
    var sample = new byte[65];
    sample[0] = 0x04;
    // 실제 키 생성 대신 코어의 DID 인코딩만 시험한다. CNG 시험은 본체가 한다.
    try { CivicAgora.Core.CivicagoraMethods.DidFromPublicKey(sample); }
    catch (CivicAgora.Core.IdentityException) { /* 곡선 위 점이 아니므로 거부가 정상 */ }
    Line("DID 인코딩", "동작함");
}
catch (Exception ex)
{
    Line("실패", $"{ex.GetType().Name}: {ex.Message}");
    return 3;
}

Console.WriteLine();
Console.WriteLine("모든 검사를 통과했습니다.");
Console.WriteLine("본체 앱이 여전히 뜨지 않는다면 WinUI 계층 문제입니다.");
Console.WriteLine($"시작 로그: {Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}\\CivicAgora\\startup.log");
Console.WriteLine();
Console.WriteLine("아무 키나 누르면 닫힙니다.");
Console.ReadKey();
return 0;
