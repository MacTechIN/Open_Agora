using System;
using System.Security.Cryptography;

namespace CivicAgora.Windows;

/// <summary>
/// 기기 신원 (VS-A2).
///
/// 개인키는 CNG 키 저장소에 **영구 키**로 생성되고 밖으로 내보내지 않습니다
/// (<see cref="CngExportPolicies.None"/>). 서명은 CNG가 수행하며 앱은
/// 핸들만 쥡니다. 공유 코어에도 개인키를 넘기지 않으므로 코어가 유출할
/// 경로 자체가 없습니다.
///
/// 곡선은 P-256입니다. Android StrongBox가 P-256만 지원해 양 플랫폼을
/// 맞췄습니다. 자세한 근거는 core/src/identity.rs 주석을 보십시오.
///
/// 명세: docs/09_DEVELOPMENT_PLAN.md VS-A2
/// </summary>
public static class DeviceIdentity
{
    private const string KeyName = "org.civicagora.device-identity.v1";

    public enum Protection
    {
        /// <summary>TPM 등 하드웨어 제공자가 키를 보관한다.</summary>
        Hardware,

        /// <summary>Microsoft 소프트웨어 KSP. 내보내기는 여전히 차단된다.</summary>
        Software,
    }

    public sealed record Identity(string Did, Protection Protection);

    /// <summary>
    /// 기기 신원을 가져오거나 없으면 만든다.
    ///
    /// 이미 있으면 같은 키를 쓰므로 재실행해도 DID가 유지된다.
    /// </summary>
    public static Identity LoadOrCreate()
    {
        var (key, protection) = OpenOrCreateKey();
        using (key)
        {
            using var ecdsa = new ECDsaCng(key);
            // 코어는 SEC1 점을 받는다. CNG는 X/Y를 따로 주므로 비압축 점으로 조립한다.
            var parameters = ecdsa.ExportParameters(includePrivateParameters: false);
            var q = parameters.Q;
            var sec1 = new byte[65];
            sec1[0] = 0x04;
            q.X!.CopyTo(sec1, 1);
            q.Y!.CopyTo(sec1, 33);

            return new Identity(global::CivicAgora.Core.CivicagoraMethods.DidFromPublicKey(sec1), protection);
        }
    }

    /// <summary>
    /// 저장된 키로 서명한다. 개인키는 이 함수 안에서도 노출되지 않는다.
    /// .NET의 ECDsa는 P1363(r‖s)을 돌려주므로 코어가 요구하는 형식과 같다.
    /// </summary>
    public static byte[] Sign(byte[] message)
    {
        var (key, _) = OpenOrCreateKey();
        using (key)
        {
            using var ecdsa = new ECDsaCng(key);
            return ecdsa.SignData(message, HashAlgorithmName.SHA256);
        }
    }

    /// <summary>
    /// 키를 찾거나 만들 제공자. 순서가 곧 우선순위다.
    ///
    /// 조회도 이 순서로 하므로, 두 제공자에 같은 이름이 있으면 하드웨어를 택한다.
    /// </summary>
    private static readonly CngProvider[] Providers =
    {
        CngProvider.MicrosoftPlatformCryptoProvider,      // TPM
        CngProvider.MicrosoftSoftwareKeyStorageProvider,  // 폴백
    };

    private static (CngKey Key, Protection Protection) OpenOrCreateKey()
    {
        // 1) 기존 키를 **모든 제공자에서** 찾는다.
        //
        // CngKey.Exists(name) 기본 오버로드는 소프트웨어 KSP만 검사한다.
        // 이걸 쓰면 TPM에 있는 키를 못 찾아 새로 만들려 하고, TPM에는 같은
        // 이름이 이미 있어 생성이 실패하며, 결국 소프트웨어 제공자에 다른
        // 키가 만들어져 재실행마다 DID가 바뀐다. 제공자를 명시해야 한다.
        foreach (var provider in Providers)
        {
            // 조회 결과를 남긴다. 어느 제공자에 키가 있는지가 보호 수준을
            // 결정하므로, 기대와 다를 때 원인을 알려면 이 기록이 필요하다.
            bool exists;
            try
            {
                exists = CngKey.Exists(KeyName, provider);
                StartupLog.Write("키 조회", $"{provider.Provider} → {(exists ? "있음" : "없음")}");
            }
            catch (Exception ex)
            {
                // 제공자를 쓸 수 없으면 예외가 난다. 이 경우도 기록하고 넘어간다.
                StartupLog.Write("키 조회 실패", $"{provider.Provider}: {ex.GetType().Name} {ex.Message}");
                continue;
            }

            if (exists)
            {
                try
                {
                    var key = CngKey.Open(KeyName, provider);
                    StartupLog.Write("키 열기 성공", provider.Provider);
                    return (key, ProtectionOf(provider));
                }
                catch (Exception ex)
                {
                    // 존재하지만 열 수 없는 경우가 있다(권한, TPM 상태 등).
                    // 삼키지 말고 남긴 뒤 다음 제공자를 본다.
                    StartupLog.Write("키 열기 실패", $"{provider.Provider}: {ex.GetType().Name} {ex.Message}");
                }
            }
        }

        // 2) 없으면 생성한다. 하드웨어를 먼저 시도하고, TPM이 없는 기기에서는
        //    소프트웨어로 내려앉는다.
        foreach (var provider in Providers)
        {
            try
            {
                var parameters = new CngKeyCreationParameters
                {
                    Provider = provider,
                    KeyCreationOptions = CngKeyCreationOptions.None,
                    // 키를 내보낼 수 없게 한다. 이것이 메모리 노출을 막는 핵심이다.
                    // 타입명은 복수형 CngExportPolicies다.
                    ExportPolicy = CngExportPolicies.None,
                    KeyUsage = CngKeyUsages.Signing,
                };
                var created = CngKey.Create(CngAlgorithm.ECDsaP256, KeyName, parameters);
                StartupLog.Write("키 생성 성공", provider.Provider);
                return (created, ProtectionOf(provider));
            }
            catch (Exception ex)
            {
                // 제공자 미지원, TPM 미탑재 등. 다음 제공자로 넘어간다.
                // 왜 실패했는지 남기지 않으면 소프트웨어로 떨어진 이유를 알 수 없다.
                StartupLog.Write("키 생성 실패", $"{provider.Provider}: {ex.GetType().Name} {ex.Message}");
            }
        }

        throw new InvalidOperationException("기기 신원 키를 생성할 수 없습니다.");
    }

    private static Protection ProtectionOf(CngProvider provider) =>
        provider == CngProvider.MicrosoftPlatformCryptoProvider
            ? Protection.Hardware
            : Protection.Software;

}
