<#
.SYNOPSIS
    Windows에서 CivicAgora를 빌드하고 실행한다.

.DESCRIPTION
    CI를 거치지 않고 로컬에서 바로 빌드한다. 수정-확인 왕복이 몇 분에서
    몇십 초로 줄고, 무엇보다 콘솔 출력과 디버거를 쓸 수 있다.

.PARAMETER Run
    빌드 후 앱을 실행한다.

.PARAMETER Diagnose
    앱 대신 콘솔 진단 도구를 실행한다.

.PARAMETER SkipCore
    Rust 코어 빌드를 건너뛴다. C# 쪽만 고칠 때 쓴다.

.EXAMPLE
    .\scripts\build-windows.ps1 -Run
#>
[CmdletBinding()]
param(
    [switch]$Run,
    [switch]$Diagnose,
    [switch]$SkipCore
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

function Step($text) { Write-Host "`n▶ $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "✗ $text" -ForegroundColor Red; exit 1 }

# ── 선행 도구 확인 ────────────────────────────────────────────────
Step "선행 도구 확인"
$missing = @()
foreach ($tool in @('cargo', 'dotnet', 'msbuild')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if ($missing) {
    Write-Host "다음 도구가 없습니다: $($missing -join ', ')" -ForegroundColor Red
    Write-Host @"

설치 방법:
  cargo    https://rustup.rs
  dotnet   winget install Microsoft.DotNet.SDK.8
  msbuild  Visual Studio Build Tools + 'Windows 앱 개발' 워크로드
           winget install Microsoft.VisualStudio.2022.BuildTools
           설치 관리자에서 '.NET 데스크톱 빌드 도구'와
           'Windows 앱 개발 빌드 도구'를 선택해야 합니다.

msbuild가 PATH에 없으면 'Developer PowerShell for VS 2022'에서 실행하십시오.
"@
    exit 1
}
foreach ($tool in @('cargo', 'dotnet', 'msbuild')) {
    Write-Host ("  {0,-10} {1}" -f $tool, (Get-Command $tool).Source)
}

# ── C# 바인딩 생성기 ──────────────────────────────────────────────
$bindgenTag = 'v0.9.2+v0.28.3'
if (-not (Get-Command uniffi-bindgen-cs -ErrorAction SilentlyContinue)) {
    Step "C# 바인딩 생성기 설치 (최초 1회, 수 분 소요)"
    cargo install uniffi-bindgen-cs `
        --git https://github.com/NordSecurity/uniffi-bindgen-cs --tag $bindgenTag
    if ($LASTEXITCODE -ne 0) { Fail "바인딩 생성기 설치 실패" }
}

# ── 공유 코어 ─────────────────────────────────────────────────────
if (-not $SkipCore) {
    Step "Rust 코어 빌드"
    cargo build --release --target x86_64-pc-windows-msvc -p civicagora-core
    if ($LASTEXITCODE -ne 0) { Fail "코어 빌드 실패" }

    Step "C# 바인딩 생성"
    uniffi-bindgen-cs core/src/civicagora.udl --out-dir target/bindings/csharp --config core/uniffi.toml
    if ($LASTEXITCODE -ne 0) { Fail "바인딩 생성 실패" }
}

# ── 앱 ────────────────────────────────────────────────────────────
# 복원과 빌드는 반드시 분리해 호출한다. 한 번에 호출하면 프로젝트 평가가
# 복원보다 먼저 끝나 Windows App SDK의 XAML 타깃이 임포트되지 않는다.
$out = Join-Path $repo 'dist\windows'

Step "복원"
msbuild apps\windows\CivicAgora.Windows.csproj /t:Restore /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /v:minimal
if ($LASTEXITCODE -ne 0) { Fail "복원 실패" }

Step "앱 빌드"
msbuild apps\windows\CivicAgora.Windows.csproj /t:Publish /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /p:PublishDir="$out\" /v:minimal
if ($LASTEXITCODE -ne 0) { Fail "앱 빌드 실패" }

Step "진단 도구 빌드"
msbuild apps\windows-diag\CivicAgora.Diagnose.csproj /t:Restore /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /v:minimal | Out-Null
msbuild apps\windows-diag\CivicAgora.Diagnose.csproj /t:Publish /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /p:PublishDir="$out\diagnose\" /v:minimal
if ($LASTEXITCODE -ne 0) { Write-Host "  진단 도구 빌드 실패 (본체에는 영향 없음)" -ForegroundColor Yellow }

Write-Host "`n✓ 빌드 완료: $out" -ForegroundColor Green
Write-Host "  앱      $out\CivicAgora.exe"
Write-Host "  진단    $out\diagnose\CivicAgora.Diagnose.exe"
Write-Host "  로그    $env:LOCALAPPDATA\CivicAgora\startup.log"

if ($Diagnose) { & "$out\diagnose\CivicAgora.Diagnose.exe" }
elseif ($Run)  { & "$out\CivicAgora.exe" }

Pop-Location
