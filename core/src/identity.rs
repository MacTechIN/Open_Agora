//! 신원 — did:key 인코딩과 서명 검증 (VS-A2)
//!
//! **개인키는 이 크레이트에 존재하지 않습니다.** 키 생성과 서명은 플랫폼의
//! 하드웨어 저장소(Android Keystore StrongBox / Windows CNG·TPM)가 수행하고,
//! 코어는 공개키를 받아 DID를 만들고 서명을 검증하기만 합니다.
//!
//! 이 분리가 VS-A2의 수용 기준 — "개인키가 앱 메모리로 평문 노출되지 않는다" —
//! 를 구조적으로 보장합니다. 코어가 개인키를 다룰 수 있다면 언젠가 다루게 됩니다.
//!
//! ## 곡선 선택
//!
//! 명세(`docs/01_ARCHITECTURE.md`)는 secp256k1을 적었으나, **Android Keystore
//! StrongBox는 P-256만 지원합니다.** secp256k1을 쓰면 하드웨어 보호를 포기해야
//! 하므로 P-256을 씁니다. Ceramic은 did:key를 지원하고 did:key는 P-256을
//! 포함하므로 데이터 계층과도 호환됩니다.

use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::EncodedPoint;

/// did:key의 P-256 공개키 multicodec 식별자 `p256-pub`(0x1200)를
/// unsigned-varint로 인코딩한 값.
///
/// 0x1200 = 4608 → varint: 하위 7비트 0000000에 연속 비트를 세워 0x80,
/// 다음 7비트 4608 >> 7 = 36 = 0x24.
const P256_PUB_MULTICODEC: [u8; 2] = [0x80, 0x24];

/// did:key 접두사.
const DID_KEY_PREFIX: &str = "did:key:z";

/// 신원 처리 중 발생하는 오류.
#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    /// 공개키가 P-256 점으로 해석되지 않는다.
    #[error("공개키 형식이 올바르지 않습니다")]
    InvalidPublicKey,

    /// DID 문자열이 우리가 만든 형식이 아니다.
    #[error("DID 형식이 올바르지 않습니다: {reason}")]
    InvalidDid { reason: String },

    /// 서명이 ECDSA 형식이 아니다. 검증 실패와 구분한다.
    #[error("서명 형식이 올바르지 않습니다")]
    InvalidSignature,
}

/// 플랫폼이 제공한 P-256 공개키로 `did:key` 문자열을 만든다.
///
/// 입력은 SEC1 인코딩된 점이며, 압축(33바이트)과 비압축(65바이트)을 모두
/// 받습니다. 플랫폼마다 내보내는 형식이 달라서입니다. 출력 DID는 항상
/// 압축 형식 기준이므로, **같은 키라면 입력 형식과 무관하게 같은 DID**가 나옵니다.
pub fn did_from_public_key(public_key: Vec<u8>) -> Result<String, IdentityError> {
    let point =
        EncodedPoint::from_bytes(&public_key).map_err(|_| IdentityError::InvalidPublicKey)?;

    // 점이 실제로 곡선 위에 있는지 확인한다. 형식만 맞는 쓰레기를 거르지 않으면
    // 검증 불가능한 DID가 만들어진다.
    let verifying_key =
        VerifyingKey::from_encoded_point(&point).map_err(|_| IdentityError::InvalidPublicKey)?;

    let compressed = verifying_key.to_encoded_point(true);

    let mut payload = Vec::with_capacity(2 + compressed.as_bytes().len());
    payload.extend_from_slice(&P256_PUB_MULTICODEC);
    payload.extend_from_slice(compressed.as_bytes());

    Ok(format!(
        "{DID_KEY_PREFIX}{}",
        bs58::encode(payload).into_string()
    ))
}

/// `did:key` 문자열에서 공개키를 복원한다.
pub fn public_key_from_did(did: String) -> Result<Vec<u8>, IdentityError> {
    let encoded = did
        .strip_prefix(DID_KEY_PREFIX)
        .ok_or_else(|| IdentityError::InvalidDid {
            reason: format!("{DID_KEY_PREFIX}로 시작하지 않습니다"),
        })?;

    let payload = bs58::decode(encoded)
        .into_vec()
        .map_err(|_| IdentityError::InvalidDid {
            reason: "base58 디코딩 실패".into(),
        })?;

    let key = payload
        .strip_prefix(&P256_PUB_MULTICODEC[..])
        .ok_or_else(|| IdentityError::InvalidDid {
            reason: "P-256 공개키가 아닙니다".into(),
        })?;

    Ok(key.to_vec())
}

/// DID가 나타내는 키로 서명을 검증한다.
///
/// 서명은 ECDSA P-256의 IEEE P1363 형식(r‖s, 64바이트)입니다. DER은 받지
/// 않습니다. 플랫폼별로 형식이 갈리면 검증 실패의 원인을 추적하기 어려우므로
/// 한 가지로 고정하고, 변환은 플랫폼 쪽에서 합니다.
///
/// 형식 오류와 검증 실패를 구분합니다. 전자는 버그이고 후자는 위조이므로
/// 대응이 다릅니다.
pub fn verify_signature(
    did: String,
    message: Vec<u8>,
    signature: Vec<u8>,
) -> Result<bool, IdentityError> {
    let public_key = public_key_from_did(did)?;
    let point =
        EncodedPoint::from_bytes(&public_key).map_err(|_| IdentityError::InvalidPublicKey)?;
    let verifying_key =
        VerifyingKey::from_encoded_point(&point).map_err(|_| IdentityError::InvalidPublicKey)?;

    let signature =
        Signature::from_slice(&signature).map_err(|_| IdentityError::InvalidSignature)?;

    Ok(verifying_key.verify(&message, &signature).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::SigningKey;

    /// 테스트 전용 키. 운영 코드에는 개인키를 만드는 경로가 없다.
    fn test_key() -> SigningKey {
        // 고정 시드를 써서 테스트가 재현되게 한다.
        SigningKey::from_bytes(&[7u8; 32].into()).expect("유효한 스칼라")
    }

    fn public_bytes(key: &SigningKey, compressed: bool) -> Vec<u8> {
        key.verifying_key()
            .to_encoded_point(compressed)
            .as_bytes()
            .to_vec()
    }

    #[test]
    fn did가_규격_접두사를_갖는다() {
        let did = did_from_public_key(public_bytes(&test_key(), true)).unwrap();
        assert!(did.starts_with("did:key:z"), "실제: {did}");
    }

    #[test]
    fn 압축_비압축_입력이_같은_did를_만든다() {
        // 플랫폼마다 내보내는 형식이 달라도 같은 신원이어야 한다.
        let key = test_key();
        let from_compressed = did_from_public_key(public_bytes(&key, true)).unwrap();
        let from_uncompressed = did_from_public_key(public_bytes(&key, false)).unwrap();
        assert_eq!(from_compressed, from_uncompressed);
    }

    #[test]
    fn did가_재현된다() {
        // 같은 키에서 매번 같은 DID가 나와야 재실행 후에도 신원이 유지된다.
        let key = test_key();
        let a = did_from_public_key(public_bytes(&key, true)).unwrap();
        let b = did_from_public_key(public_bytes(&key, true)).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn 다른_키는_다른_did를_만든다() {
        let other = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
        let a = did_from_public_key(public_bytes(&test_key(), true)).unwrap();
        let b = did_from_public_key(public_bytes(&other, true)).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn did에서_공개키를_복원한다() {
        let key = test_key();
        let did = did_from_public_key(public_bytes(&key, true)).unwrap();
        assert_eq!(public_key_from_did(did).unwrap(), public_bytes(&key, true));
    }

    #[test]
    fn 유효한_서명을_통과시킨다() {
        let key = test_key();
        let did = did_from_public_key(public_bytes(&key, true)).unwrap();
        let message = b"CivicAgora VS-A2".to_vec();
        let signature: p256::ecdsa::Signature = key.sign(&message);
        assert!(verify_signature(did, message, signature.to_bytes().to_vec()).unwrap());
    }

    #[test]
    fn 변조된_메시지를_거부한다() {
        let key = test_key();
        let did = did_from_public_key(public_bytes(&key, true)).unwrap();
        let signature: p256::ecdsa::Signature = key.sign("원본".as_bytes());
        let result = verify_signature(
            did,
            "변조됨".as_bytes().to_vec(),
            signature.to_bytes().to_vec(),
        );
        assert!(!result.unwrap());
    }

    #[test]
    fn 다른_키의_서명을_거부한다() {
        let signer = test_key();
        let impostor = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
        let did = did_from_public_key(public_bytes(&impostor, true)).unwrap();
        let message = "위조 시도".as_bytes().to_vec();
        let signature: p256::ecdsa::Signature = signer.sign(&message);
        assert!(!verify_signature(did, message, signature.to_bytes().to_vec()).unwrap());
    }

    #[test]
    fn 형식_오류와_검증_실패를_구분한다() {
        // 전자는 버그, 후자는 위조다. 대응이 다르므로 섞이면 안 된다.
        let did = did_from_public_key(public_bytes(&test_key(), true)).unwrap();
        let err = verify_signature(did, b"x".to_vec(), vec![0u8; 10]).unwrap_err();
        assert!(matches!(err, IdentityError::InvalidSignature));
    }

    #[test]
    fn 곡선_밖의_점을_거부한다() {
        // 형식만 맞는 쓰레기를 통과시키면 검증 불가능한 DID가 만들어진다.
        //
        // 압축 점의 x를 뒤집는 방식은 쓰지 않는다. 임의의 x가 곡선 위에 있을
        // 확률이 약 절반이라 테스트가 불안정해진다. 비압축 점의 y를 훼손하면
        // 곡선 방정식을 확정적으로 위반한다.
        let mut bogus = public_bytes(&test_key(), false);
        let last = bogus.len() - 1;
        bogus[last] ^= 0xff;
        assert!(matches!(
            did_from_public_key(bogus),
            Err(IdentityError::InvalidPublicKey)
        ));
    }

    #[test]
    fn 잘못된_점_접두사를_거부한다() {
        let mut bogus = public_bytes(&test_key(), true);
        bogus[0] = 0x07; // SEC1에 없는 접두사
        assert!(matches!(
            did_from_public_key(bogus),
            Err(IdentityError::InvalidPublicKey)
        ));
    }

    #[test]
    fn 빈_공개키를_거부한다() {
        assert!(matches!(
            did_from_public_key(Vec::new()),
            Err(IdentityError::InvalidPublicKey)
        ));
    }

    #[test]
    fn 잘못된_did를_거부한다() {
        for bad in ["", "did:key:", "did:web:example.com", "did:key:z!!!"] {
            assert!(
                public_key_from_did(bad.to_string()).is_err(),
                "통과함: {bad}"
            );
        }
    }
}
