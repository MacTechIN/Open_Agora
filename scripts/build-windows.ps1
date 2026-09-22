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

# 콘솔 출력 인코딩을 UTF-8로 맞춘다. 맞추지 않으면 한글이 깨진다.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Step($text) { Write-Host "`n▶ $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "✗ $text" -ForegroundColor Red; exit 1 }

# msbuild는 일반 PowerShell의 PATH에 없는 것이 정상이다.
# Visual Studio 설치 위치를 vswhere로 찾아 직접 지정한다.
function Find-MSBuild {
    if (Get-Command msbuild -ErrorAction SilentlyContinue) {
        return (Get-Command msbuild).Source
    }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * `
        -requires Microsoft.Component.MSBuild `
        -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    return $path
}

# ── 선행 도구 확인 ────────────────────────────────────────────────
Step "선행 도구 확인"

$script:MSBuild = Find-MSBuild

$missing = @()
foreach ($tool in @('cargo', 'dotnet')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if (-not $script:MSBuild) { $missing += 'msbuild' }
if ($missing) {
    Write-Host "다음 도구가 없습니다: $($missing -join ', ')" -ForegroundColor Red
    Write-Host @"

설치 방법:
  cargo    winget install Rustlang.Rustup
           설치 후 PowerShell을 새로 열어야 PATH가 잡힙니다.

  dotnet   winget install Microsoft.DotNet.SDK.8

  msbuild  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Workload.ManagedDesktopBuildTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"

           WinUI의 리소스(PRI) 생성 도구가 필요하므로 위 워크로드를
           반드시 포함해야 합니다.

설치 후 PowerShell을 새로 열고 다시 실행하십시오.
"@
    exit 1
}
foreach ($tool in @('cargo', 'dotnet')) {
    Write-Host ("  {0,-10} {1}" -f $tool, (Get-Command $tool).Source)
}
Write-Host ("  {0,-10} {1}" -f 'msbuild', $script:MSBuild)

# MSBuild가 있어도 .NET SDK 확인자가 없으면 Microsoft.NET.Sdk를 못 찾는다.
# Build Tools를 워크로드 없이 설치하면 이 상태가 되며, 오류 메시지(MSB4236)만
# 보면 원인을 짐작하기 어렵다. 미리 확인해 무엇을 추가해야 하는지 알린다.
$sdkDir = Join-Path (Split-Path -Parent (Split-Path -Parent $script:MSBuild)) 'Sdks\Microsoft.NET.Sdk'
if (-not (Test-Path $sdkDir)) {
    Write-Host "`n✗ MSBuild에 .NET SDK 확인자가 없습니다." -ForegroundColor Red
    Write-Host @"

Visual Studio Build Tools에 .NET 워크로드가 설치되지 않았습니다.
이대로 빌드하면 MSB4236 (Microsoft.NET.Sdk를 찾을 수 없음)이 납니다.

해결 — 다음 중 하나:

  1) 시작 메뉴 → Visual Studio Installer → Build Tools 2022 → 수정
     체크: '.NET 데스크톱 빌드 도구'
           'Windows 앱 개발 빌드 도구'   (WinUI 리소스 생성에 필요)

  2) 관리자 PowerShell에서:

     & "`${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" modify ``
        --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" ``
        --add Microsoft.VisualStudio.Workload.ManagedDesktopBuildTools ``
        --add Microsoft.VisualStudio.Workload.VCTools ``
        --add Microsoft.VisualStudio.Component.Windows11SDK.22621 ``
        --quiet --wait
"@
    exit 1
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
& $script:MSBuild apps\windows\CivicAgora.Windows.csproj /t:Restore /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /v:minimal
if ($LASTEXITCODE -ne 0) { Fail "복원 실패" }

Step "앱 빌드"
& $script:MSBuild apps\windows\CivicAgora.Windows.csproj /t:Publish /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /p:PublishDir="$out\" /v:minimal
if ($LASTEXITCODE -ne 0) { Fail "앱 빌드 실패" }

Step "진단 도구 빌드"
& $script:MSBuild apps\windows-diag\CivicAgora.Diagnose.csproj /t:Restore /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /v:minimal | Out-Null
& $script:MSBuild apps\windows-diag\CivicAgora.Diagnose.csproj /t:Publish /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /p:PublishDir="$out\diagnose\" /v:minimal
if ($LASTEXITCODE -ne 0) { Write-Host "  진단 도구 빌드 실패 (본체에는 영향 없음)" -ForegroundColor Yellow }

Write-Host "`n✓ 빌드 완료: $out" -ForegroundColor Green
Write-Host "  앱      $out\CivicAgora.exe"
Write-Host "  진단    $out\diagnose\CivicAgora.Diagnose.exe"
Write-Host "  로그    $env:LOCALAPPDATA\CivicAgora\startup.log"

if ($Diagnose) { & "$out\diagnose\CivicAgora.Diagnose.exe" }
elseif ($Run)  { & "$out\CivicAgora.exe" }

Pop-Location
