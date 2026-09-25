//! 작성자 서명 (VS-A4)
//!
//! 글을 올릴 때 작성자의 기기 키로 내용에 서명하고, 서명을 함께 저장한다.
//! 운영자가 글을 고치면 서명 검증이 깨지므로 **고친 사실이 드러난다.**
//!
//! 블록체인이 필요 없다. 이미 있는 것으로 된다 (`docs/16_ONCHAIN_PLAN.md` 1단계).
//! 이것이 앵커링보다 먼저인 이유는, 서명 없이 앵커링만 하면 "무언가 바뀌었다"는
//! 것만 알고 **어느 글이 어떻게 바뀌었는지**는 알 수 없기 때문이다.
//!
//! ## 무엇에 서명하는가
//!
//! 식별자(내용 해시)가 아니라 **정규화된 내용 자체**에 서명한다. 식별자는
//! 서버가 계산하므로, 그것에만 서명하면 서버가 다른 내용으로 같은 식별자를
//! 주장할 때 검증이 소용없다. 내용에 직접 서명하면 화면에 보이는 글자
//! 하나하나가 서명의 대상이 된다.
//!
//! ## 형식
//!
//! ```text
//! <도메인>\n<길이>:<바이트><길이>:<바이트>...
//! ```
//!
//! 길이는 UTF-8 바이트 수를 십진수 ASCII 로 적는다. 구분자가 아니라 길이를
//! 쓰는 이유는 본문에 줄바꿈과 콜론이 들어갈 수 있기 때문이다. 십진수를 쓰는
//! 이유는 이 형식을 **서버(TypeScript)가 한 번 더 구현해야 하고**, 바이트
//! 정렬(빅엔디언) 실수가 그쪽에서 가장 흔하기 때문이다.
//!
//! 도메인을 앞에 두어 주제 서명을 의견 서명으로 재사용할 수 없게 한다.
//!
//! 두 구현이 갈리지 않는지는 `contracts/signing-vectors.json` 의 공용 벡터로
//! 양쪽에서 확인한다.
//!
//! ## 서명 알고리즘
//!
//! ECDSA P-256 / SHA-256, 서명은 P1363(r‖s, 64바이트). 곡선이 P-256 인 것은
//! 선택이 아니라 하드웨어 저장소의 제약이다 (`docs/08_DECISIONS.md` D15).

use crate::card::{DebateCard, DraftCard};
use crate::identity::verify_signature;
use crate::policy::{DraftPolicy, Policy};

/// 주제 서명의 도메인. 형식이 바뀌면 v2 로 올린다.
const POLICY_DOMAIN: &str = "civicagora/policy/v1";

/// 의견 서명의 도메인.
const OPINION_DOMAIN: &str = "civicagora/opinion/v1";

/// 댓글 서명의 도메인 (VS-D3).
const REPLY_DOMAIN: &str = "civicagora/reply/v1";

/// 익명 회원 명부 루트의 도메인 (VS-C3a).
///
/// 서명용이 아니라 앵커링용입니다. 명부가 그때 어떤 모습이었는지를 앵커에
/// 남겨야, 운영자가 나중에 가짜 회원을 끼워 넣은 것이 드러납니다.
const GROUP_DOMAIN: &str = "civicagora/group/v1";

/// 서명 상태.
///
/// "없음"과 "틀림"을 구분한다. 서명 이전에 올라온 글은 없는 것이고, 그것은
/// 위조가 아니다. 둘을 하나로 묶으면 오래된 글이 전부 위조로 보인다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureStatus {
    /// 서명이 없다. VS-A4 이전에 올라온 글.
    Unsigned,
    /// 서명이 작성자 DID 와 내용에 맞는다.
    Valid,
    /// 서명이 맞지 않는다. 내용이 바뀌었거나 작성자가 아니다.
    Invalid,
    /// 서명이나 DID 의 형식이 깨졌다. 위조라기보다 버그에 가깝다.
    Malformed,
}

/// 도메인과 필드들을 서명 대상 바이트로 만든다.
fn encode(domain: &str, fields: &[&str]) -> Vec<u8> {
    let mut out =
        Vec::with_capacity(domain.len() + 1 + fields.iter().map(|f| f.len() + 8).sum::<usize>());
    out.extend_from_slice(domain.as_bytes());
    out.push(b'\n');
    for field in fields {
        out.extend_from_slice(field.len().to_string().as_bytes());
        out.push(b':');
        out.extend_from_slice(field.as_bytes());
    }
    out
}

/// 저장된 주제의 서명 대상 바이트.
///
/// 서버가 돌려준 값 그대로 쓴다. 여기서 다시 다듬으면 서버가 보낸 것과
/// 다른 것을 검증하게 되고, 그러면 검증이 아무것도 보장하지 않는다.
pub fn policy_payload(policy: &Policy) -> Vec<u8> {
    encode(
        POLICY_DOMAIN,
        &[
            &policy.author_did,
            &policy.created_at.to_string(),
            &policy.title,
            policy.category.as_str(),
            &policy.background,
            &policy.core_question,
            &policy.official_source_url,
            // 없는 기관과 빈 문자열을 같게 본다. 확정된 주제의 기관은
            // 비어 있으면 None 이므로 둘이 같은 상태다.
            policy.target_agency.as_deref().unwrap_or(""),
        ],
    )
}

/// 저장된 의견의 서명 대상 바이트.
pub fn opinion_payload(card: &DebateCard) -> Vec<u8> {
    encode(
        OPINION_DOMAIN,
        &[
            &card.policy_id,
            &card.author_did,
            &card.created_at.to_string(),
            card.stance.as_str(),
            &card.problem_definition,
            &card.evidence_source,
            &card.evidence_url,
            &card.actionable_solution,
        ],
    )
}

/// 저장된 댓글의 서명 대상 바이트.
pub fn reply_payload(reply: &crate::reply::Reply) -> Vec<u8> {
    encode(
        REPLY_DOMAIN,
        &[
            &reply.card_id,
            &reply.author_did,
            &reply.created_at.to_string(),
            &reply.body,
        ],
    )
}

/// 올리기 전에 서명할 바이트를 만든다 (댓글).
pub fn reply_signing_payload(
    card_id: String,
    reply: crate::reply::DraftReply,
    author_did: String,
    created_at: i64,
) -> Result<Vec<u8>, crate::card::CardError> {
    let finalized = reply.finalize(&card_id, &author_did, created_at, None)?;
    Ok(reply_payload(&finalized))
}

/// 댓글의 서명을 확인한다.
pub fn check_reply(reply: crate::reply::Reply) -> SignatureStatus {
    let payload = reply_payload(&reply);
    check(&reply.author_did, &payload, reply.signature.as_ref())
}

/// 올리기 전에 서명할 바이트를 만든다.
///
/// 초안을 확정한 뒤 만들므로 **서버에 저장될 것과 같은 바이트**다. 앞뒤 공백
/// 처리가 갈리면 보낸 쪽과 받은 쪽의 서명 대상이 달라지는데, 그 버그는
/// 검증 실패로만 나타나 원인을 찾기 어렵다.
pub fn policy_signing_payload(
    policy: DraftPolicy,
    author_did: String,
    created_at: i64,
) -> Result<Vec<u8>, crate::card::CardError> {
    let finalized = policy.finalize(&author_did, created_at, None)?;
    Ok(policy_payload(&finalized))
}

/// 올리기 전에 서명할 바이트를 만든다 (의견).
pub fn opinion_signing_payload(
    policy_id: String,
    card: DraftCard,
    author_did: String,
    created_at: i64,
) -> Result<Vec<u8>, crate::card::CardError> {
    let finalized = card.finalize(&policy_id, &author_did, created_at, None)?;
    Ok(opinion_payload(&finalized))
}

/// 익명 회원 명부 루트의 앵커 대상 바이트.
pub fn group_payload(root: String) -> Vec<u8> {
    encode(GROUP_DOMAIN, &[&root])
}

/// 주제 식별자.
///
/// 첫 의견에 서명하려면 이 값이 필요하다 — 의견 서명이 주제 식별자를 덮어야
/// 같은 서명을 다른 주제에 옮겨 붙일 수 없다. 규칙은 서버와 같다.
pub fn policy_id(
    policy: DraftPolicy,
    author_did: String,
    created_at: i64,
) -> Result<String, crate::card::CardError> {
    Ok(policy.finalize(&author_did, created_at, None)?.id)
}

/// 16진 문자열을 바이트로. 형식이 틀리면 None.
pub(crate) fn from_hex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

/// 바이트를 16진 문자열로.
pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn check(did: &str, payload: &[u8], signature: Option<&String>) -> SignatureStatus {
    let Some(hex) = signature else {
        return SignatureStatus::Unsigned;
    };
    let Some(bytes) = from_hex(hex) else {
        return SignatureStatus::Malformed;
    };
    match verify_signature(did.to_string(), payload.to_vec(), bytes) {
        Ok(true) => SignatureStatus::Valid,
        Ok(false) => SignatureStatus::Invalid,
        Err(_) => SignatureStatus::Malformed,
    }
}

/// 주제의 서명을 확인한다.
pub fn check_policy(policy: Policy) -> SignatureStatus {
    let payload = policy_payload(&policy);
    check(&policy.author_did, &payload, policy.signature.as_ref())
}

/// 의견의 서명을 확인한다.
pub fn check_opinion(card: DebateCard) -> SignatureStatus {
    let payload = opinion_payload(&card);
    check(&card.author_did, &payload, card.signature.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{tests::valid_draft, StanceType};
    use crate::identity::did_from_public_key;
    use crate::policy::PolicyCategory;
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::{Signature, SigningKey};

    fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[9u8; 32].into()).expect("유효한 스칼라")
    }

    fn test_did() -> String {
        let key = test_key();
        let point = key.verifying_key().to_encoded_point(true);
        did_from_public_key(point.as_bytes().to_vec()).expect("유효한 공개키")
    }

    fn sign(payload: &[u8]) -> String {
        let signature: Signature = test_key().sign(payload);
        to_hex(&signature.to_bytes())
    }

    fn draft_policy() -> DraftPolicy {
        DraftPolicy {
            title: "탄력 근로제 직종별 차등 적용".into(),
            category: PolicyCategory::Legislation,
            background: "개정안이 발의되면서 업종별 적용 기준을 두고 이견이 커지고 있습니다."
                .into(),
            core_question: "직종별로 적용 기준을 달리해야 하는가?".into(),
            official_source_url: "https://likms.assembly.go.kr/bill/1".into(),
            target_agency: Some("고용노동부".into()),
        }
    }

    #[test]
    fn 도메인이_다르면_바이트가_다르다() {
        // 주제 서명을 의견 서명으로 재사용할 수 없어야 한다.
        assert_ne!(encode("a", &["x"]), encode("b", &["x"]));
    }

    #[test]
    fn 필드_경계가_섞이지_않는다() {
        // "ab" + "c" 와 "a" + "bc" 가 같은 바이트가 되면 안 된다.
        assert_ne!(encode("d", &["ab", "c"]), encode("d", &["a", "bc"]));
    }

    #[test]
    fn 빈_필드와_없는_필드를_같게_본다() {
        let mut with_empty = draft_policy();
        with_empty.target_agency = Some("   ".into());
        let mut without = draft_policy();
        without.target_agency = None;

        let a = policy_signing_payload(with_empty, test_did(), 1).unwrap();
        let b = policy_signing_payload(without, test_did(), 1).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn 앞뒤_공백은_서명_대상에_들어가지_않는다() {
        let mut padded = draft_policy();
        padded.title = format!("  {}  ", padded.title);

        let a = policy_signing_payload(padded, test_did(), 1).unwrap();
        let b = policy_signing_payload(draft_policy(), test_did(), 1).unwrap();
        assert_eq!(a, b, "저장은 다듬은 값으로 하므로 서명도 그래야 한다");
    }

    #[test]
    fn 올바른_서명을_통과시킨다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1700000000000, None).unwrap();
        let signed = Policy {
            signature: Some(sign(&policy_payload(&policy))),
            ..policy
        };
        assert_eq!(check_policy(signed), SignatureStatus::Valid);
    }

    #[test]
    fn 내용이_바뀌면_검증에_실패한다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1700000000000, None).unwrap();
        let signature = sign(&policy_payload(&policy));

        // 운영자가 제목을 고친 상황.
        let tampered = Policy {
            title: "탄력 근로제 전면 확대".into(),
            signature: Some(signature),
            ..policy
        };
        assert_eq!(check_policy(tampered), SignatureStatus::Invalid);
    }

    #[test]
    fn 시각이_바뀌면_검증에_실패한다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1700000000000, None).unwrap();
        let signature = sign(&policy_payload(&policy));

        let tampered = Policy {
            created_at: 1700000000001,
            signature: Some(signature),
            ..policy
        };
        assert_eq!(check_policy(tampered), SignatureStatus::Invalid);
    }

    #[test]
    fn 서명이_없으면_위조가_아니라_미서명이다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1, None).unwrap();
        assert_eq!(check_policy(policy), SignatureStatus::Unsigned);
    }

    #[test]
    fn 깨진_16진수는_형식_오류다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1, None).unwrap();
        let broken = Policy {
            signature: Some("빨간색".into()),
            ..policy
        };
        assert_eq!(check_policy(broken), SignatureStatus::Malformed);
    }

    #[test]
    fn 의견_서명도_같은_방식으로_동작한다() {
        let did = test_did();
        let card = valid_draft()
            .finalize("policy-1", &did, 1700000000000, None)
            .unwrap();
        let signature = sign(&opinion_payload(&card));

        let signed = DebateCard {
            signature: Some(signature.clone()),
            ..card.clone()
        };
        assert_eq!(check_opinion(signed), SignatureStatus::Valid);

        // 입장만 바꿔도 검증이 깨져야 한다. 반대 글을 찬성 열로 옮기는 것은
        // 내용을 고치는 것과 같다.
        let moved = DebateCard {
            stance: StanceType::Support,
            signature: Some(signature),
            ..card
        };
        assert_eq!(check_opinion(moved), SignatureStatus::Invalid);
    }

    #[test]
    fn 주제_서명을_의견에_쓸_수_없다() {
        let did = test_did();
        let policy = draft_policy().finalize(&did, 1700000000000, None).unwrap();
        let card = valid_draft()
            .finalize(&policy.id, &did, 1700000000000, None)
            .unwrap();

        let stolen = DebateCard {
            signature: Some(sign(&policy_payload(&policy))),
            ..card
        };
        assert_eq!(check_opinion(stolen), SignatureStatus::Invalid);
    }

    #[test]
    fn 십육진_변환이_왕복한다() {
        let bytes = vec![0u8, 1, 15, 16, 255];
        assert_eq!(from_hex(&to_hex(&bytes)), Some(bytes));
        assert_eq!(from_hex("abc"), None, "홀수 길이");
        assert_eq!(from_hex("zz"), None, "16진수가 아님");
    }
}

#[cfg(test)]
mod vectors {
    use super::*;
    use crate::card::{DraftCard, StanceType};
    use crate::policy::{DraftPolicy, PolicyCategory};
    use serde::Deserialize;

    /// 공용 시험 벡터.
    ///
    /// 이 형식은 서버(TypeScript)가 한 번 더 구현한다. 두 구현이 갈리면
    /// 앱이 올린 글이 서버에서 전부 검증 실패하는데, 그 원인은 **서명이
    /// 아니라 바이트 한 칸**이라 찾기 어렵다. 양쪽이 같은 파일을 보게 한다.
    const VECTORS: &str = include_str!("../../contracts/signing-vectors.json");

    #[derive(Deserialize)]
    struct Doc {
        cases: Vec<Case>,
        group: GroupCase,
        reply: ReplyCase,
    }

    #[derive(Deserialize)]
    struct GroupCase {
        root: String,
        payload_hex: String,
    }

    #[derive(Deserialize)]
    struct ReplyCase {
        card_id: String,
        author_did: String,
        created_at: i64,
        body: String,
        payload_hex: String,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        kind: String,
        author_did: String,
        created_at: i64,
        input: serde_json::Value,
        payload_hex: String,
        #[serde(default)]
        signature_hex: Option<String>,
        #[serde(default)]
        id: Option<String>,
    }

    fn text(value: &serde_json::Value, key: &str) -> String {
        value[key].as_str().unwrap_or_default().to_string()
    }

    #[test]
    fn 명부_루트_페이로드가_벡터와_같다() {
        let doc: Doc = serde_json::from_str(VECTORS).expect("벡터 파일");
        assert_eq!(
            to_hex(&group_payload(doc.group.root.clone())),
            doc.group.payload_hex
        );
    }

    #[test]
    fn 댓글_페이로드가_벡터와_같다() {
        let doc: Doc = serde_json::from_str(VECTORS).expect("벡터 파일");
        let payload = reply_signing_payload(
            doc.reply.card_id.clone(),
            crate::reply::DraftReply {
                body: doc.reply.body.clone(),
            },
            doc.reply.author_did.clone(),
            doc.reply.created_at,
        )
        .expect("벡터 입력은 검증을 통과해야 한다");
        assert_eq!(to_hex(&payload), doc.reply.payload_hex);
    }

    #[test]
    fn 공용_벡터와_같은_바이트를_만든다() {
        let doc: Doc = serde_json::from_str(VECTORS).expect("벡터 파일");
        assert!(!doc.cases.is_empty(), "벡터가 비어 있다");

        for case in &doc.cases {
            let payload = match case.kind.as_str() {
                "policy" => {
                    let agency = case.input["target_agency"].as_str().map(str::to_string);
                    policy_signing_payload(
                        DraftPolicy {
                            title: text(&case.input, "title"),
                            category: PolicyCategory::parse(&text(&case.input, "category"))
                                .expect("분류"),
                            background: text(&case.input, "background"),
                            core_question: text(&case.input, "core_question"),
                            official_source_url: text(&case.input, "official_source_url"),
                            target_agency: agency,
                        },
                        case.author_did.clone(),
                        case.created_at,
                    )
                }
                "opinion" => opinion_signing_payload(
                    text(&case.input, "policy_id"),
                    DraftCard {
                        stance: match text(&case.input, "stance").as_str() {
                            "SUPPORT" => StanceType::Support,
                            "ALTERNATIVE" => StanceType::Alternative,
                            _ => StanceType::Oppose,
                        },
                        problem_definition: text(&case.input, "problem_definition"),
                        evidence_source: text(&case.input, "evidence_source"),
                        evidence_url: text(&case.input, "evidence_url"),
                        actionable_solution: text(&case.input, "actionable_solution"),
                    },
                    case.author_did.clone(),
                    case.created_at,
                ),
                other => panic!("알 수 없는 종류: {other}"),
            }
            .expect("벡터 입력은 검증을 통과해야 한다");

            assert_eq!(to_hex(&payload), case.payload_hex, "{}", case.name);

            // 식별자 규칙도 대조한다. 첫 의견의 서명이 주제 식별자를 덮으므로,
            // 식별자 규칙이 서버와 갈리면 서명이 통째로 못 쓰게 된다.
            if let Some(expected) = &case.id {
                let actual = match case.kind.as_str() {
                    "policy" => crate::card::content_id(&[
                        &case.author_did,
                        &case.created_at.to_string(),
                        &text(&case.input, "title"),
                        &text(&case.input, "background"),
                        &text(&case.input, "core_question"),
                    ]),
                    _ => crate::card::content_id(&[
                        &text(&case.input, "policy_id"),
                        &case.author_did,
                        &case.created_at.to_string(),
                        &text(&case.input, "stance"),
                        &text(&case.input, "problem_definition"),
                        &text(&case.input, "evidence_source"),
                        &text(&case.input, "evidence_url"),
                        &text(&case.input, "actionable_solution"),
                    ]),
                };
                assert_eq!(&actual, expected, "{} 식별자", case.name);
            }

            // 서명까지 있는 벡터는 검증도 통과해야 한다. 바이트만 맞고
            // 검증이 안 되면 곡선이나 해시가 어긋난 것이다.
            if let Some(hex) = &case.signature_hex {
                let signature = from_hex(hex).expect("16진 서명");
                assert!(
                    verify_signature(case.author_did.clone(), payload, signature).expect("검증"),
                    "{} 서명 검증 실패",
                    case.name
                );
            }
        }
    }
}
