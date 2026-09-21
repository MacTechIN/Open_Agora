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

    private static (CngKey Key, Protection Protection) OpenOrCreateKey()
    {
        if (CngKey.Exists(KeyName))
        {
            var existing = CngKey.Open(KeyName);
            return (existing, DetectProtection(existing));
        }

        // 하드웨어 제공자를 먼저 시도한다. TPM이 없는 기기가 많으므로
        // 실패는 정상 경로이며, 소프트웨어 KSP로 내려앉는다.
        foreach (var (provider, protection) in new[]
                 {
                     (CngProvider.MicrosoftPlatformCryptoProvider, Protection.Hardware),
                     (CngProvider.MicrosoftSoftwareKeyStorageProvider, Protection.Software),
                 })
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
                return (CngKey.Create(CngAlgorithm.ECDsaP256, KeyName, parameters), protection);
            }
            catch (CryptographicException)
            {
                // 다음 제공자로 넘어간다.
            }
        }

        throw new InvalidOperationException("기기 신원 키를 생성할 수 없습니다.");
    }

    private static Protection DetectProtection(CngKey key) =>
        key.Provider == CngProvider.MicrosoftPlatformCryptoProvider
            ? Protection.Hardware
            : Protection.Software;
}
