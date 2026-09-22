import Foundation
import Security

/// 단말 신원 — Secure Enclave 에 보관하는 P-256 키.
///
/// 개인키는 **꺼낼 수 없다.** Secure Enclave 에서 만든 키는 칩 밖으로
/// 나오지 않고, 서명도 칩 안에서 한다. 코어에 개인키를 다루는 함수가 없는
/// 것과 같은 이유다 — 다룰 수 있으면 언젠가 다루게 된다.
///
/// 곡선이 P-256 인 것은 선택이 아니다. Secure Enclave 가 P-256 만 지원하고,
/// Android StrongBox 도 마찬가지다. 그래서 secp256k1 이 아니라 P-256 을
/// 쓴다 (docs/08_DECISIONS.md D15).
enum DeviceIdentity {

    enum Protection {
        case secureEnclave
        case software

        var label: String {
            switch self {
            case .secureEnclave: return "Secure Enclave (전용 보안 칩)에 보관 — 꺼내갈 수 없습니다"
            case .software: return "소프트웨어 보관 — 하드웨어 보호가 없습니다"
            }
        }
    }

    struct Identity {
        let did: String
        let protection: Protection
    }

    struct IdentityFailure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// 키체인 항목 태그. 바꾸면 기존 사용자의 DID 가 바뀐다 — 바꾸지 않는다.
    private static let tag = Data("org.civicagora.identity.p256".utf8)

    private static var cached: Identity?

    /// 키가 있으면 불러오고 없으면 만든다.
    ///
    /// 두 번 부르면 같은 DID 가 나와야 한다. 재시작마다 DID 가 바뀌면 같은
    /// 사람이 매번 다른 사람이 되고, 회원 자격이 의미를 잃는다.
    static func loadOrCreate() throws -> Identity {
        if let cached { return cached }

        let (key, protection) = try existingKey() ?? createKey()
        guard let publicKey = SecKeyCopyPublicKey(key) else {
            throw IdentityFailure(message: "공개키를 읽지 못했습니다")
        }
        var error: Unmanaged<CFError>?
        guard let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw IdentityFailure(message: "공개키를 꺼내지 못했습니다: \(describe(error))")
        }

        // SecKeyCopyExternalRepresentation 은 X9.63 비압축(0x04 ‖ X ‖ Y)을 준다.
        // 코어의 did_from_public_key 는 압축·비압축을 모두 받는다.
        let identity = Identity(did: try didFromPublicKey(publicKey: raw), protection: protection)
        cached = identity
        return identity
    }

    /// 메시지에 서명한다. 서명은 P1363 형식(r‖s, 64바이트)으로 돌려준다.
    ///
    /// 아직 쓰이지 않는다. 작성자 서명은 VS-A4 에서 붙는다
    /// (docs/16_ONCHAIN_PLAN.md 1단계). Android 와 같은 자리에 같은 모양으로
    /// 둔다 — 그때 가서 한쪽만 만들면 두 앱이 다른 서명을 낸다.
    static func sign(message: Data) throws -> Data {
        guard let (key, _) = try existingKey() else {
            throw IdentityFailure(message: "서명할 키가 없습니다")
        }
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCreateSignature(
            key, .ecdsaSignatureMessageX962SHA256, message as CFData, &error
        ) as Data? else {
            throw IdentityFailure(message: "서명하지 못했습니다: \(describe(error))")
        }
        return try derToP1363(der)
    }

    // ── 키체인 ────────────────────────────────────────────────────

    private static func existingKey() throws -> (SecKey, Protection)? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let item else {
            throw IdentityFailure(message: "키를 읽지 못했습니다 (OSStatus \(status))")
        }
        let key = item as! SecKey
        // 토큰 ID 가 있으면 Secure Enclave 에 있는 키다.
        let attributes = SecKeyCopyAttributes(key) as? [String: Any] ?? [:]
        let inEnclave = (attributes[kSecAttrTokenID as String] as? String)
            == (kSecAttrTokenIDSecureEnclave as String)
        return (key, inEnclave ? .secureEnclave : .software)
    }

    private static func createKey() throws -> (SecKey, Protection) {
        // 시뮬레이터나 Secure Enclave 가 없는 기기에서는 소프트웨어 키로
        // 내려간다. 조용히 내려가지 않고 어디에 보관 중인지 화면에 적는다 —
        // 사용자가 자기 키가 어떻게 보호되는지 알아야 한다.
        if let key = try? generate(inEnclave: true) { return (key, .secureEnclave) }
        return (try generate(inEnclave: false), .software)
    }

    private static func generate(inEnclave: Bool) throws -> SecKey {
        var keyAttributes: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag,
        ]

        if inEnclave {
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(
                nil,
                // 기기가 잠금 해제된 적이 있어야 쓸 수 있고, 백업으로 옮겨가지
                // 않는다. 키는 이 기기의 것이다.
                kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                [.privateKeyUsage],
                &error
            ) else {
                throw IdentityFailure(message: "접근 제어를 만들지 못했습니다: \(describe(error))")
            }
            keyAttributes[kSecAttrAccessControl as String] = access
        }

        var attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: keyAttributes,
        ]
        if inEnclave {
            attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        }

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw IdentityFailure(message: "키를 만들지 못했습니다: \(describe(error))")
        }
        return key
    }

    // ── 서명 형식 변환 ────────────────────────────────────────────

    /// DER(SEQUENCE{INTEGER r, INTEGER s}) → P1363(r‖s, 각 32바이트).
    ///
    /// 애플은 DER 을 주고 코어는 P1363 을 받는다. Android 쪽도 같은 변환을
    /// 한다(DeviceIdentity.kt derToP1363). 두 구현이 갈리면 한 플랫폼의
    /// 서명만 검증에 실패하고, 그 사실은 검증 단계에 가서야 드러난다.
    private static func derToP1363(_ der: Data) throws -> Data {
        var index = 0
        func byte() throws -> UInt8 {
            guard index < der.count else { throw IdentityFailure(message: "서명 형식이 올바르지 않습니다") }
            defer { index += 1 }
            return der[der.startIndex + index]
        }
        func readInteger() throws -> Data {
            guard try byte() == 0x02 else {
                throw IdentityFailure(message: "서명 형식이 올바르지 않습니다")
            }
            let length = Int(try byte())
            guard index + length <= der.count else {
                throw IdentityFailure(message: "서명 형식이 올바르지 않습니다")
            }
            var value = der.subdata(in: (der.startIndex + index)..<(der.startIndex + index + length))
            index += length
            // DER 은 최상위 비트가 서면 0x00 을 앞에 붙인다. 고정폭에서는 뺀다.
            while value.first == 0x00 && value.count > 32 { value.removeFirst() }
            return Data(repeating: 0, count: max(0, 32 - value.count)) + value
        }

        guard try byte() == 0x30 else {
            throw IdentityFailure(message: "서명 형식이 올바르지 않습니다")
        }
        _ = try byte()  // SEQUENCE 길이. 64바이트 고정폭으로 만들므로 쓰지 않는다.
        return try readInteger() + readInteger()
    }

    private static func describe(_ error: Unmanaged<CFError>?) -> String {
        guard let error else { return "알 수 없는 오류" }
        return (error.takeRetainedValue() as Error).localizedDescription
    }
}
