//! 공유 API 코덱 — 요청 본문 생성과 응답 파싱 (VS-A3″)
//!
//! **HTTP 전송은 여기서 하지 않는다.** 각 플랫폼이 자기 HTTP 스택으로
//! 보낸다(Android OkHttp, Windows HttpClient). 이유는 둘이다.
//!
//! 1. Rust 에 TLS 를 넣으면 세 타깃 크로스 컴파일 위험이 커진다.
//! 2. OS 의 네트워크 정책(프록시, 인증서 고정, 안드로이드 백그라운드 제한)을
//!    플랫폼 스택이 이미 다룬다. 직접 구현하면 그것을 잃는다.
//!
//! 대신 **검증과 JSON 모양은 한 곳에서** 만든다. 두 플랫폼이 각자 JSON 을
//! 조립하면 필드 이름이나 형식이 어긋나고, 그 버그는 서버 로그에서만 보인다.
//!
//! 서버 구현: `web/app/api/policies/`

use serde::{Deserialize, Serialize};

use crate::card::{CardError, DebateCard, DraftCard, StanceType};
use crate::policy::{DraftPolicy, Policy, PolicyCategory, PolicySummary};
use crate::signing::to_hex;

// ── 내부 표현 ↔ 서버 JSON ──────────────────────────────────────────
//
// 서버는 snake_case 를 쓴다. 코어의 필드 이름과 같으므로 별도 매핑이 없다.
// 이름이 갈리면 여기서 드러나도록 구조체를 따로 둔다.

fn stance_json(stance: StanceType) -> &'static str {
    match stance {
        StanceType::Support => "SUPPORT",
        StanceType::Alternative => "ALTERNATIVE",
        StanceType::Oppose => "OPPOSE",
    }
}

fn stance_from_json(value: &str) -> Result<StanceType, CardError> {
    Ok(match value {
        "SUPPORT" => StanceType::Support,
        "ALTERNATIVE" => StanceType::Alternative,
        "OPPOSE" => StanceType::Oppose,
        // 알 수 없는 값을 기본값으로 바꾸면 찬성 글이 반대 열에 나타난다.
        other => {
            return Err(CardError::Storage {
                reason: format!("알 수 없는 입장: {other}"),
            })
        }
    })
}

fn category_json(category: PolicyCategory) -> &'static str {
    match category {
        PolicyCategory::GovPolicy => "GOV_POLICY",
        PolicyCategory::Legislation => "LEGISLATION",
        PolicyCategory::PartyPolicy => "PARTY_POLICY",
        PolicyCategory::Local => "LOCAL",
        PolicyCategory::PublicOrg => "PUBLIC_ORG",
        PolicyCategory::SocialIssue => "SOCIAL_ISSUE",
        PolicyCategory::Whistleblow => "WHISTLEBLOW",
    }
}

fn category_from_json(value: &str) -> Result<PolicyCategory, CardError> {
    Ok(match value {
        "GOV_POLICY" => PolicyCategory::GovPolicy,
        "LEGISLATION" => PolicyCategory::Legislation,
        "PARTY_POLICY" => PolicyCategory::PartyPolicy,
        "LOCAL" => PolicyCategory::Local,
        "PUBLIC_ORG" => PolicyCategory::PublicOrg,
        "SOCIAL_ISSUE" => PolicyCategory::SocialIssue,
        "WHISTLEBLOW" => PolicyCategory::Whistleblow,
        other => {
            return Err(CardError::Storage {
                reason: format!("알 수 없는 분류: {other}"),
            })
        }
    })
}

#[derive(Serialize)]
struct CardBody<'a> {
    stance: &'a str,
    problem_definition: &'a str,
    evidence_source: &'a str,
    evidence_url: &'a str,
    actionable_solution: &'a str,
}

#[derive(Serialize)]
struct PolicyBody<'a> {
    title: &'a str,
    category: &'a str,
    background: &'a str,
    core_question: &'a str,
    official_source_url: &'a str,
    target_agency: Option<&'a str>,
}

#[derive(Deserialize)]
struct IdResponse {
    #[serde(default)]
    policy_id: Option<String>,
    #[serde(default)]
    card_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct PolicyRow {
    id: String,
    title: String,
    category: String,
    background: String,
    core_question: String,
    official_source_url: String,
    target_agency: Option<String>,
    author_did: String,
    created_at: i64,
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    support_count: u32,
    #[serde(default)]
    alternative_count: u32,
    #[serde(default)]
    oppose_count: u32,
    #[serde(default)]
    last_activity_at: Option<i64>,
}

#[derive(Deserialize)]
struct CardRow {
    id: String,
    policy_id: String,
    stance: String,
    problem_definition: String,
    evidence_source: String,
    evidence_url: String,
    actionable_solution: String,
    author_did: String,
    created_at: i64,
    #[serde(default)]
    signature: Option<String>,
}

#[derive(Deserialize)]
struct DetailResponse {
    opinions: Vec<CardRow>,
}

fn parse_error(e: impl std::fmt::Display) -> CardError {
    CardError::Storage {
        reason: format!("서버 응답을 읽지 못했습니다: {e}"),
    }
}

// ── 요청 본문 ──────────────────────────────────────────────────────

/// 주제 등록 요청 본문을 만든다.
///
/// 보내기 전에 검증한다. 서버도 다시 검증하지만, 왕복 없이 바로 알려주는
/// 편이 낫고 네트워크가 없을 때도 입력 문제를 알 수 있다.
pub fn open_policy_body(
    policy: DraftPolicy,
    first_opinion: DraftCard,
    author_did: String,
    created_at: i64,
    policy_signature: Vec<u8>,
    opinion_signature: Vec<u8>,
) -> Result<String, CardError> {
    policy.validate()?;
    first_opinion.validate()?;

    let body = serde_json::json!({
        "author_did": author_did,
        // 시각을 클라이언트가 정한다. 서명이 시각을 덮으려면 서명하는 쪽이
        // 그 값을 알아야 하기 때문이다. 서버가 정하면 서버가 시각을 바꿔도
        // 검증이 통과한다. 대신 서버가 허용 범위를 좁게 본다.
        "created_at": created_at,
        "policy_signature": to_hex(&policy_signature),
        "opinion_signature": to_hex(&opinion_signature),
        "policy": PolicyBody {
            title: policy.title.trim(),
            category: category_json(policy.category),
            background: policy.background.trim(),
            core_question: policy.core_question.trim(),
            official_source_url: policy.official_source_url.trim(),
            target_agency: policy.target_agency.as_deref().map(str::trim).filter(|a| !a.is_empty()),
        },
        "first_opinion": CardBody {
            stance: stance_json(first_opinion.stance),
            problem_definition: first_opinion.problem_definition.trim(),
            evidence_source: first_opinion.evidence_source.trim(),
            evidence_url: first_opinion.evidence_url.trim(),
            actionable_solution: first_opinion.actionable_solution.trim(),
        },
    });
    serde_json::to_string(&body).map_err(parse_error)
}

/// 의견 추가 요청 본문을 만든다.
pub fn add_opinion_body(
    card: DraftCard,
    author_did: String,
    created_at: i64,
    signature: Vec<u8>,
) -> Result<String, CardError> {
    card.validate()?;

    let body = serde_json::json!({
        "author_did": author_did,
        "created_at": created_at,
        "signature": to_hex(&signature),
        "stance": stance_json(card.stance),
        "problem_definition": card.problem_definition.trim(),
        "evidence_source": card.evidence_source.trim(),
        "evidence_url": card.evidence_url.trim(),
        "actionable_solution": card.actionable_solution.trim(),
    });
    serde_json::to_string(&body).map_err(parse_error)
}

// ── 응답 파싱 ──────────────────────────────────────────────────────

/// 등록 응답에서 식별자를 꺼낸다.
///
/// 서버가 400 으로 돌려준 검증 메시지도 여기서 오류로 바꾼다. 그래야
/// "논점이 150자를 넘습니다" 같은 안내가 화면까지 그대로 전달된다.
pub fn parse_id(json: String) -> Result<String, CardError> {
    let parsed: IdResponse = serde_json::from_str(&json).map_err(parse_error)?;
    if let Some(message) = parsed.error {
        return Err(CardError::Storage { reason: message });
    }
    parsed
        .policy_id
        .or(parsed.card_id)
        .ok_or_else(|| CardError::Storage {
            reason: "응답에 식별자가 없습니다".into(),
        })
}

/// 광장 목록 응답을 파싱한다.
pub fn parse_policies(json: String) -> Result<Vec<PolicySummary>, CardError> {
    let rows: Vec<PolicyRow> = serde_json::from_str(&json).map_err(parse_error)?;
    rows.into_iter()
        .map(|r| {
            let created_at = r.created_at;
            Ok(PolicySummary {
                policy: Policy {
                    id: r.id,
                    title: r.title,
                    category: category_from_json(&r.category)?,
                    background: r.background,
                    core_question: r.core_question,
                    official_source_url: r.official_source_url,
                    target_agency: r.target_agency,
                    author_did: r.author_did,
                    created_at,
                    signature: r.signature,
                },
                support_count: r.support_count,
                alternative_count: r.alternative_count,
                oppose_count: r.oppose_count,
                last_activity_at: r.last_activity_at.unwrap_or(created_at),
            })
        })
        .collect()
}

/// 주제 상세 응답에서 의견 목록을 꺼낸다.
pub fn parse_opinions(json: String) -> Result<Vec<DebateCard>, CardError> {
    let parsed: DetailResponse = serde_json::from_str(&json).map_err(parse_error)?;
    parsed
        .opinions
        .into_iter()
        .map(|r| {
            Ok(DebateCard {
                id: r.id,
                policy_id: r.policy_id,
                stance: stance_from_json(&r.stance)?,
                problem_definition: r.problem_definition,
                evidence_source: r.evidence_source,
                evidence_url: r.evidence_url,
                actionable_solution: r.actionable_solution,
                author_did: r.author_did,
                created_at: r.created_at,
                signature: r.signature,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DID: &str = "did:key:zDnaewBSXeQ82kLpw79E5X3yjpPfRFz1fxApcEVaxh6TxWMP4";

    /// 실제 배포본에서 받은 응답. 서버가 필드를 바꾸면 여기서 깨진다.
    ///
    /// 손으로 만든 예시를 쓰면 서버와 다른 모양을 시험하게 되고, 그 차이는
    /// 실기기에서만 드러난다.
    const POLICIES_JSON: &str = include_str!("../../contracts/api-samples/policies.json");
    const DETAIL_JSON: &str = include_str!("../../contracts/api-samples/policy-detail.json");

    fn draft_policy() -> DraftPolicy {
        DraftPolicy {
            title: "  탄력 근로제  ".into(),
            category: PolicyCategory::Legislation,
            background: "일률 적용으로 부담이 크다".into(),
            core_question: "직종별로 기준을 달리해야 하는가?".into(),
            official_source_url: "https://likms.assembly.go.kr/bill".into(),
            target_agency: Some("  ".into()),
        }
    }

    fn draft_card() -> DraftCard {
        DraftCard {
            stance: StanceType::Oppose,
            problem_definition: " 행정 비용이 크다 ".into(),
            evidence_source: "통계청 조사".into(),
            evidence_url: "https://kostat.go.kr".into(),
            actionable_solution: "업종별 차등화".into(),
        }
    }

    mod 요청_본문 {
        use super::*;

        #[test]
        fn 주제_등록_본문을_만든다() {
            let body = open_policy_body(
                draft_policy(),
                draft_card(),
                DID.into(),
                1_700_000_000_000,
                vec![],
                vec![],
            )
            .unwrap();
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();

            assert_eq!(v["author_did"], DID);
            assert_eq!(v["policy"]["category"], "LEGISLATION");
            assert_eq!(v["first_opinion"]["stance"], "OPPOSE");
        }

        #[test]
        fn 앞뒤_공백을_없애고_보낸다() {
            // 서버도 다듬지만, 보내는 쪽에서 정리해야 식별자 해시가 일치한다.
            let body = open_policy_body(
                draft_policy(),
                draft_card(),
                DID.into(),
                1_700_000_000_000,
                vec![],
                vec![],
            )
            .unwrap();
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(v["policy"]["title"], "탄력 근로제");
            assert_eq!(v["first_opinion"]["problem_definition"], "행정 비용이 크다");
        }

        #[test]
        fn 빈_소관기관은_null로_보낸다() {
            // 빈 문자열을 보내면 서버에 공백만 든 값이 저장된다.
            let body = open_policy_body(
                draft_policy(),
                draft_card(),
                DID.into(),
                1_700_000_000_000,
                vec![],
                vec![],
            )
            .unwrap();
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert!(v["policy"]["target_agency"].is_null());
        }

        #[test]
        fn 검증에_실패하면_보내지_않는다() {
            // 왕복 없이 바로 알려주는 편이 낫고, 네트워크가 없을 때도 알 수 있다.
            let mut bad = draft_card();
            bad.evidence_url = "".into();
            assert!(add_opinion_body(bad, DID.into(), 1_700_000_000_000, vec![]).is_err());

            let mut bad_policy = draft_policy();
            bad_policy.core_question = "".into();
            assert!(open_policy_body(
                bad_policy,
                draft_card(),
                DID.into(),
                1_700_000_000_000,
                vec![],
                vec![]
            )
            .is_err());
        }

        #[test]
        fn 의견_추가_본문을_만든다() {
            let body =
                add_opinion_body(draft_card(), DID.into(), 1_700_000_000_000, vec![]).unwrap();
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(v["stance"], "OPPOSE");
            assert_eq!(v["author_did"], DID);
        }
    }

    mod 응답_파싱 {
        use super::*;

        #[test]
        fn 실제_광장_응답을_읽는다() {
            let rows = parse_policies(POLICIES_JSON.into()).expect("파싱 실패");
            assert!(!rows.is_empty(), "고정 입력에 주제가 없다");
            let first = &rows[0];
            assert!(!first.policy.core_question.is_empty(), "쟁점 질문이 비었다");
            assert!(!first.policy.id.is_empty());
            // 집계가 전체 의견 수와 맞아야 한다
            assert_eq!(
                first.total(),
                first.support_count + first.alternative_count + first.oppose_count
            );
        }

        #[test]
        fn 실제_상세_응답을_읽는다() {
            let opinions = parse_opinions(DETAIL_JSON.into()).expect("파싱 실패");
            assert!(!opinions.is_empty(), "고정 입력에 의견이 없다");
            for o in &opinions {
                assert!(!o.policy_id.is_empty(), "의견이 주제에 연결되지 않았다");
            }
        }

        #[test]
        fn 식별자를_꺼낸다() {
            assert_eq!(parse_id(r#"{"policy_id":"abc"}"#.into()).unwrap(), "abc");
            assert_eq!(parse_id(r#"{"card_id":"def"}"#.into()).unwrap(), "def");
        }

        #[test]
        fn 서버_검증_메시지를_그대로_전달한다() {
            // "논점이 150자를 넘습니다" 같은 안내가 화면까지 가야 한다.
            let err = parse_id(r#"{"error":"논점이(가) 150자를 넘습니다 (현재 151자)"}"#.into())
                .unwrap_err();
            assert!(err.to_string().contains("151자"), "실제: {err}");
        }

        #[test]
        fn 식별자가_없으면_오류다() {
            assert!(parse_id("{}".into()).is_err());
        }

        #[test]
        fn 알_수_없는_입장을_거부한다() {
            // 기본값으로 바꾸면 찬성 글이 반대 열에 나타난다.
            let json = r#"{"opinions":[{"id":"a","policy_id":"p","stance":"UNKNOWN",
                "problem_definition":"x","evidence_source":"y","evidence_url":"z",
                "actionable_solution":"w","author_did":"d","created_at":1}]}"#;
            assert!(parse_opinions(json.into()).is_err());
        }

        #[test]
        fn 잘못된_json을_거부한다() {
            assert!(parse_policies("not json".into()).is_err());
            assert!(parse_opinions("{}".into()).is_err());
        }
    }
}
