//! 토론 카드 — 3단 구조화 입력과 검증 (VS-A3)
//!
//! 명세: `docs/00_PRODUCT_SPEC.md` §3
//!
//! 감정적 선동을 억제하기 위해 단일 텍스트 박스를 제공하지 않는다. 세 필드가
//! 모두 필수이며 합계 정확히 500자다.
//!
//! | 필드 | 최대 |
//! |-|-|
//! | 문제 정의 | 150자 |
//! | 데이터 및 팩트 근거 | 200자 |
//! | 실행 가능한 해결책 | 150자 |
//!
//! ## 삭제가 없다
//!
//! 이 모듈에는 카드를 지우거나 고치는 함수가 없다. 작성자 본인도 삭제할 수
//! 없으며, 대응은 노출 조정 3단계뿐이다(`docs/04_REPUTATION_MODERATION.md` §3).
//! 삭제 경로를 만드는 것은 G-IMMUT 게이트 위반이다.

use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;

/// 문제 정의 최대 길이.
pub const MAX_PROBLEM: usize = 150;
/// 근거 서술 최대 길이.
pub const MAX_EVIDENCE: usize = 200;
/// 해결책 최대 길이.
pub const MAX_SOLUTION: usize = 150;
/// 근거 URL 최대 길이. 글자 수 합계에는 포함되지 않는다.
pub const MAX_URL: usize = 500;

/// 스탠스. 등록 후 변경할 수 없다.
///
/// `ALTERNATIVE`는 찬성도 반대도 아닌 제3안이며 가운데 열에만 배치된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StanceType {
    Support,
    Alternative,
    Oppose,
}

impl StanceType {
    fn as_str(self) -> &'static str {
        match self {
            StanceType::Support => "SUPPORT",
            StanceType::Alternative => "ALTERNATIVE",
            StanceType::Oppose => "OPPOSE",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "SUPPORT" => Some(StanceType::Support),
            "ALTERNATIVE" => Some(StanceType::Alternative),
            "OPPOSE" => Some(StanceType::Oppose),
            _ => None,
        }
    }
}

/// 작성 중인 카드.
#[derive(Debug, Clone)]
pub struct DraftCard {
    pub stance: StanceType,
    pub problem_definition: String,
    pub evidence_source: String,
    pub evidence_url: String,
    pub actionable_solution: String,
}

/// 저장된 카드.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DebateCard {
    pub id: String,
    pub stance: StanceType,
    pub problem_definition: String,
    pub evidence_source: String,
    pub evidence_url: String,
    pub actionable_solution: String,
    pub author_did: String,
    /// 작성 시각. epoch 밀리초.
    pub created_at: i64,
}

/// 카드 검증·저장 오류.
#[derive(Debug, thiserror::Error)]
pub enum CardError {
    /// 필수 필드가 비어 있다.
    #[error("{field}을(를) 입력해야 합니다")]
    Empty { field: String },

    /// 글자 수 초과. UI가 남은 글자를 표시할 수 있도록 한도와 실제를 모두 준다.
    #[error("{field}이(가) {limit}자를 넘습니다 (현재 {actual}자)")]
    TooLong {
        field: String,
        limit: u32,
        actual: u32,
    },

    /// 근거 URL 형식 오류.
    #[error("근거 URL이 올바르지 않습니다: {reason}")]
    InvalidUrl { reason: String },

    /// 저장 실패.
    #[error("저장하지 못했습니다: {reason}")]
    Storage { reason: String },
}

/// 사용자가 인식하는 "글자" 수를 센다.
///
/// `chars()`를 쓰지 않는 이유: 한글이 NFD로 분해되어 들어오면 한 음절이 2~3개
/// 스칼라가 되고, 이모지 ZWJ 조합은 여러 스칼라가 한 글자로 보인다. 어느
/// 경우든 사용자가 센 글자 수와 시스템이 센 수가 어긋나 한도에 걸리는 이유를
/// 알 수 없게 된다. 자소 클러스터가 사용자의 직관과 일치한다.
pub(crate) fn count_graphemes(text: &str) -> usize {
    text.graphemes(true).count()
}

/// UI가 남은 글자를 표시할 때 코어와 같은 기준을 쓰도록 노출한다.
///
/// 플랫폼마다 글자를 다르게 세면, 사용자는 UI가 149자라고 하는데 제출이
/// 거부되는 상황을 만난다.
pub fn grapheme_count(text: String) -> u32 {
    count_graphemes(&text) as u32
}

fn check_field(label: &str, value: &str, limit: usize) -> Result<(), CardError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CardError::Empty {
            field: label.to_string(),
        });
    }
    let count = count_graphemes(trimmed);
    if count > limit {
        return Err(CardError::TooLong {
            field: label.to_string(),
            limit: limit as u32,
            actual: count as u32,
        });
    }
    Ok(())
}

/// 근거 URL을 검증한다.
///
/// 여기서는 형식만 본다. 허용 도메인 화이트리스트와 "미검증 출처" 배지는
/// VS-D5에서 붙는다(`docs/00_PRODUCT_SPEC.md` §3).
fn check_url(value: &str) -> Result<(), CardError> {
    let url = value.trim();
    if url.is_empty() {
        // 근거 없는 주장을 걸러내는 것이 3단 입력의 존재 이유이므로 필수다.
        return Err(CardError::InvalidUrl {
            reason: "근거 URL은 필수입니다".into(),
        });
    }
    if url.len() > MAX_URL {
        return Err(CardError::InvalidUrl {
            reason: format!("{MAX_URL}자를 넘습니다"),
        });
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| CardError::InvalidUrl {
            reason: "http:// 또는 https:// 로 시작해야 합니다".into(),
        })?;

    if url.chars().any(char::is_whitespace) {
        return Err(CardError::InvalidUrl {
            reason: "공백이 들어 있습니다".into(),
        });
    }

    // 호스트가 있어야 한다. "https://" 만 적은 경우를 거른다.
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || !host.contains('.') {
        return Err(CardError::InvalidUrl {
            reason: "호스트 이름이 없습니다".into(),
        });
    }
    Ok(())
}

impl DraftCard {
    /// 모든 필드를 검증한다.
    ///
    /// 첫 오류에서 멈춘다. 여러 오류를 모아 돌려주는 편이 친절하겠지만, UI가
    /// 필드별로 실시간 검증하므로 제출 시점에는 하나만 남는 것이 보통이다.
    pub fn validate(&self) -> Result<(), CardError> {
        check_field("문제 정의", &self.problem_definition, MAX_PROBLEM)?;
        check_field("데이터 및 팩트 근거", &self.evidence_source, MAX_EVIDENCE)?;
        check_field(
            "실행 가능한 해결책",
            &self.actionable_solution,
            MAX_SOLUTION,
        )?;
        check_url(&self.evidence_url)?;
        Ok(())
    }

    /// 검증을 통과한 초안을 카드로 확정한다.
    ///
    /// 식별자는 내용과 작성자, 시각의 해시다. 난수를 쓰지 않으므로 같은 입력이
    /// 같은 식별자를 만들고, 이는 뒤에 붙을 내용 주소 지정(IPFS CID)과 결이 맞다.
    pub(crate) fn finalize(
        self,
        author_did: &str,
        created_at: i64,
    ) -> Result<DebateCard, CardError> {
        self.validate()?;

        let mut hasher = Sha256::new();
        hasher.update(author_did.as_bytes());
        hasher.update(created_at.to_be_bytes());
        hasher.update(self.stance.as_str().as_bytes());
        for field in [
            &self.problem_definition,
            &self.evidence_source,
            &self.evidence_url,
            &self.actionable_solution,
        ] {
            // 길이를 함께 넣어 필드 경계가 섞이는 것을 막는다.
            hasher.update((field.len() as u64).to_be_bytes());
            hasher.update(field.as_bytes());
        }
        let id = format!("{:x}", hasher.finalize());

        Ok(DebateCard {
            id,
            stance: self.stance,
            problem_definition: self.problem_definition.trim().to_string(),
            evidence_source: self.evidence_source.trim().to_string(),
            evidence_url: self.evidence_url.trim().to_string(),
            actionable_solution: self.actionable_solution.trim().to_string(),
            author_did: author_did.to_string(),
            created_at,
        })
    }
}

pub(crate) fn stance_to_str(stance: StanceType) -> &'static str {
    stance.as_str()
}

pub(crate) fn stance_from_str(value: &str) -> Option<StanceType> {
    StanceType::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn valid_draft() -> DraftCard {
        DraftCard {
            stance: StanceType::Oppose,
            problem_definition: "현행 제도는 일률 적용으로 소상공인의 행정 비용을 키운다".into(),
            evidence_source: "통계청 2026년 사업체노동력조사, 5인 미만 사업장 행정부담 항목".into(),
            evidence_url: "https://kostat.go.kr/board.es?mid=a10301010000".into(),
            actionable_solution: "업종별 가이드라인을 차등화하고 바우처 기반 감독을 도입한다"
                .into(),
        }
    }

    mod 글자수 {
        use super::*;

        #[test]
        fn 한글_음절을_한_글자로_센다() {
            assert_eq!(grapheme_count("공론장".into()), 3);
        }

        #[test]
        fn 분해된_한글도_한_글자로_센다() {
            // NFD로 분해된 "가" (ᄀ + ᅡ). chars()로 세면 2가 나와
            // 사용자가 센 수와 어긋난다.
            assert_eq!(grapheme_count("\u{1100}\u{1161}".into()), 1);
        }

        #[test]
        fn 이모지_조합을_한_글자로_센다() {
            // 가족 이모지는 여러 스칼라가 ZWJ로 묶인 하나의 글자다.
            assert_eq!(grapheme_count("👨‍👩‍👧".into()), 1);
        }

        #[test]
        fn 빈_문자열은_영이다() {
            assert_eq!(grapheme_count("".into()), 0);
        }
    }

    mod 검증 {
        use super::*;

        #[test]
        fn 올바른_초안을_통과시킨다() {
            valid_draft().validate().expect("통과해야 함");
        }

        #[test]
        fn 빈_필드를_거부한다() {
            for (label, mutate) in [
                (
                    "문제 정의",
                    (|d: &mut DraftCard| d.problem_definition = "  ".into()) as fn(&mut DraftCard),
                ),
                ("데이터 및 팩트 근거", |d: &mut DraftCard| {
                    d.evidence_source = "".into()
                }),
                ("실행 가능한 해결책", |d: &mut DraftCard| {
                    d.actionable_solution = "\t".into()
                }),
            ] {
                let mut draft = valid_draft();
                mutate(&mut draft);
                match draft.validate() {
                    Err(CardError::Empty { field }) => assert_eq!(field, label),
                    other => panic!("{label}: 빈 필드를 통과시켰다 — {other:?}"),
                }
            }
        }

        #[test]
        fn 한도를_넘으면_거부하고_실제_글자수를_알려준다() {
            let mut draft = valid_draft();
            draft.problem_definition = "가".repeat(MAX_PROBLEM + 5);
            match draft.validate() {
                Err(CardError::TooLong { limit, actual, .. }) => {
                    assert_eq!(limit, MAX_PROBLEM as u32);
                    // 한도만 알려주면 UI가 얼마나 줄여야 하는지 표시할 수 없다.
                    assert_eq!(actual, (MAX_PROBLEM + 5) as u32);
                }
                other => panic!("초과를 통과시켰다: {other:?}"),
            }
        }

        #[test]
        fn 한도_경계값을_허용한다() {
            let mut draft = valid_draft();
            draft.problem_definition = "가".repeat(MAX_PROBLEM);
            draft.evidence_source = "나".repeat(MAX_EVIDENCE);
            draft.actionable_solution = "다".repeat(MAX_SOLUTION);
            draft.validate().expect("경계값은 허용해야 함");
        }

        #[test]
        fn 근거_url이_없으면_거부한다() {
            // 근거 없는 주장을 걸러내는 것이 3단 입력의 존재 이유다.
            let mut draft = valid_draft();
            draft.evidence_url = "".into();
            assert!(matches!(
                draft.validate(),
                Err(CardError::InvalidUrl { .. })
            ));
        }

        #[test]
        fn 잘못된_url을_거부한다() {
            for bad in [
                "kostat.go.kr",         // 스킴 없음
                "ftp://kostat.go.kr",   // 허용하지 않는 스킴
                "https://",             // 호스트 없음
                "https://localhost",    // 점 없음
                "https://kostat go kr", // 공백
                "javascript:alert(1)",  // 스킴 아님
            ] {
                let mut draft = valid_draft();
                draft.evidence_url = bad.into();
                assert!(
                    matches!(draft.validate(), Err(CardError::InvalidUrl { .. })),
                    "통과시켰다: {bad}"
                );
            }
        }

        #[test]
        fn http와_https를_모두_허용한다() {
            for good in [
                "https://kostat.go.kr/a?b=1#c",
                "http://likms.assembly.go.kr/bill/billDetail.do",
            ] {
                let mut draft = valid_draft();
                draft.evidence_url = good.into();
                draft
                    .validate()
                    .unwrap_or_else(|e| panic!("{good} 거부됨: {e}"));
            }
        }

        #[test]
        fn 세_필드_합계가_500자다() {
            // 명세의 500자는 세 필드 한도의 합이다. 어긋나면 명세와 구현이 갈린다.
            assert_eq!(MAX_PROBLEM + MAX_EVIDENCE + MAX_SOLUTION, 500);
        }
    }

    mod 확정 {
        use super::*;

        #[test]
        fn 앞뒤_공백을_제거해_저장한다() {
            let mut draft = valid_draft();
            draft.problem_definition = "  앞뒤 공백  ".into();
            let card = draft.finalize("did:key:zTest", 1_700_000_000_000).unwrap();
            assert_eq!(card.problem_definition, "앞뒤 공백");
        }

        #[test]
        fn 같은_입력이_같은_식별자를_만든다() {
            let a = valid_draft().finalize("did:key:zTest", 42).unwrap();
            let b = valid_draft().finalize("did:key:zTest", 42).unwrap();
            assert_eq!(a.id, b.id);
        }

        #[test]
        fn 작성자가_다르면_식별자가_다르다() {
            let a = valid_draft().finalize("did:key:zA", 42).unwrap();
            let b = valid_draft().finalize("did:key:zB", 42).unwrap();
            assert_ne!(a.id, b.id);
        }

        #[test]
        fn 시각이_다르면_식별자가_다르다() {
            let a = valid_draft().finalize("did:key:zTest", 42).unwrap();
            let b = valid_draft().finalize("did:key:zTest", 43).unwrap();
            assert_ne!(a.id, b.id);
        }

        #[test]
        fn 필드_경계가_섞이지_않는다() {
            // 길이 없이 이어붙이면 ("ab","c")와 ("a","bc")가 같은 해시를 낸다.
            let mut first = valid_draft();
            first.problem_definition = "가나".into();
            first.evidence_source = "다".into();

            let mut second = valid_draft();
            second.problem_definition = "가".into();
            second.evidence_source = "나다".into();

            let a = first.finalize("did:key:zTest", 42).unwrap();
            let b = second.finalize("did:key:zTest", 42).unwrap();
            assert_ne!(a.id, b.id);
        }

        #[test]
        fn 검증에_실패하면_확정되지_않는다() {
            let mut draft = valid_draft();
            draft.evidence_url = "잘못된 주소".into();
            assert!(draft.finalize("did:key:zTest", 42).is_err());
        }
    }
}
