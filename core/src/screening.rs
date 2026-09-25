//! 온디바이스 톤 스크리닝 — 1단계 게이트 (VS-E1)
//!
//! ## 이 단계가 왜 기기 안에 있는가
//!
//! 작성 중인 정치적 의견을 서버로 보내지 않기 위해서입니다. 타이핑하는 동안
//! 매 글자가 서버로 간다면, 지우고 다시 쓴 문장까지 남습니다. **쓰다 만 말은
//! 쓴 말보다 사람을 더 많이 드러냅니다.**
//!
//! 비용도 이유입니다. 대부분의 입력은 무해하므로 가벼운 게이트가 먼저 걸러야
//! 무거운 분류기(2단계)를 아낄 수 있습니다.
//!
//! ## 코치지 차단기가 아니다
//!
//! 이 점수는 **아무것도 막지 않습니다.** 0.30을 넘으면 2단계로 보낼 뿐이고,
//! 사용자는 언제나 원문을 게시할 수 있습니다(`docs/00_PRODUCT_SPEC.md` §7).
//! 점수가 게시를 막는 순간 이것은 코치가 아니라 검열이 됩니다.
//!
//! ## 지금은 스텁입니다
//!
//! 명세(`docs/03_ALGORITHMS_AI.md` §3.1)는 KcELECTRA ONNX 임베딩을 요구합니다.
//! 실측한 ONNX 배포본은 가장 작은 양자화판이 **96MB**입니다. 타이핑마다 도는
//! 기기 안 모델로 쓰기에는 너무 큽니다.
//!
//! 그래서 지금은 **어휘 기반 스텁**입니다. 대놓고 드러나는 욕설과 초성 비하만
//! 잡고, 맥락이나 새 은어는 잡지 못합니다. 신경망이 들어오면 이 함수만
//! 갈아 끼우면 되도록 경계를 좁게 뒀습니다.
//!
//! ## 어휘에 정치 용어를 넣지 않는다
//!
//! 이것이 가장 중요한 규칙입니다. 정당·정치인·이념을 가리키는 말을 목록에
//! 넣는 순간, 이 플랫폼은 막으려던 바로 그 일(진영 논리에 따른 검열)을 하게
//! 됩니다. 목록은 **욕설과 비하 표현만** 담습니다.

use unicode_normalization::UnicodeNormalization;

/// 2단계로 보낼지 정하는 문턱. 이 아래는 서버를 부르지 않는다.
pub const STEP2_THRESHOLD: f64 = 0.30;

/// 사용자에게 배너를 띄우는 문턱. 2단계가 판단하며 여기서는 쓰지 않는다.
pub const BANNER_THRESHOLD: f64 = 0.65;

/// 어휘와 무게.
///
/// 무게는 "얼마나 대놓고 드러나는가"입니다. 심한 욕설은 한 번만 나와도
/// 2단계로 보내고, 약한 것은 겹쳐야 넘어갑니다. 0.30~0.65 사이를 회색지대로
/// 두라는 명세(§3.2)에 맞춰, 약한 표현 하나로는 배너까지 가지 않게 합니다.
///
/// **정치 용어는 넣지 않습니다.** `정치_용어가_목록에_없다` 시험이 지킵니다.
const LEXICON: &[(&str, f64)] = &[
    // 초성 비하 — 자판을 두드려 만든 형태. 신경망 없이도 잡히는 대표 사례다.
    ("ㅅㅂ", 0.55),
    ("ㅆㅂ", 0.60),
    ("ㅄ", 0.55),
    ("ㅂㅅ", 0.55),
    ("ㅈㄹ", 0.45),
    ("ㄱㅅㄲ", 0.70),
    ("ㅁㅊ", 0.40),
    ("ㅈㄴ", 0.35),
    // 욕설
    ("씨발", 0.70),
    ("시발", 0.65),
    ("좆", 0.70),
    ("병신", 0.65),
    ("새끼", 0.40),
    ("지랄", 0.50),
    ("미친놈", 0.55),
    ("미친년", 0.60),
    ("꺼져", 0.35),
    ("닥쳐", 0.35),
    ("멍청이", 0.38),
    ("등신", 0.45),
    // 인신 비하
    ("벌레같", 0.45),
    ("쓰레기같", 0.45),
];

/// 스크리닝 결과.
#[derive(Debug, Clone, PartialEq)]
pub struct Screening {
    /// 0.0~1.0. 높을수록 거친 표현이 드러난다.
    pub score: f64,
    /// 2단계로 보내야 하는가.
    pub needs_review: bool,
    /// 걸린 표현. **화면에 그대로 보여주지 않는다** — 무엇이 걸렸는지 알려
    /// 주면 그것을 피해 쓰는 법을 알려 주는 셈이 되고, 그러면 목록이
    /// 우회 안내서가 된다. 시험과 진단용이다.
    pub matched: Vec<String>,
}

/// 회피 표기를 걷어낸다.
///
/// `ㅅ.ㅂ`, `ㅅ ㅂ`, `씨-발` 같은 형태를 같은 것으로 본다. 완벽하지 않고
/// 완벽할 수도 없다 — 이 단계의 목적은 **대놓고 드러나는 것**을 싸게 잡는
/// 것이지 모든 우회를 막는 것이 아니다.
fn normalize(text: &str) -> String {
    text.nfkc()
        .filter(|c| c.is_alphanumeric() || matches!(c, 'ㄱ'..='ㅎ' | 'ㅏ'..='ㅣ'))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// 문장을 훑어 점수를 낸다.
///
/// 같은 표현이 여러 번 나와도 한 번만 센다. 반복은 강조일 뿐이고, 반복마다
/// 점수를 올리면 긴 글이 무조건 불리해진다.
pub fn screen(text: String) -> Screening {
    let haystack = normalize(&text);
    let mut score: f64 = 0.0;
    let mut matched = Vec::new();

    for (term, weight) in LEXICON {
        let needle = normalize(term);
        if !needle.is_empty() && haystack.contains(&needle) {
            // 겹칠수록 오르되 1을 넘지 않는다. 확률처럼 합성한다.
            score = 1.0 - (1.0 - score) * (1.0 - weight);
            matched.push((*term).to_string());
        }
    }

    Screening {
        score,
        needs_review: score >= STEP2_THRESHOLD,
        matched,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 무해한_문장은_영이다() {
        for text in [
            "탄력 근로제는 업종별로 기준을 달리해야 합니다.",
            "통계청 자료를 보면 소상공인 부담이 큽니다.",
            "이 정책에 반대합니다. 근거는 다음과 같습니다.",
            "",
        ] {
            let result = screen(text.into());
            assert_eq!(result.score, 0.0, "{text}");
            assert!(!result.needs_review);
        }
    }

    #[test]
    fn 대놓고_드러나는_욕설을_잡는다() {
        let result = screen("이건 진짜 씨발 말도 안 되는 정책이다".into());
        assert!(result.needs_review);
        assert!(result.score >= STEP2_THRESHOLD);
    }

    #[test]
    fn 초성_비하를_잡는다() {
        assert!(screen("ㅅㅂ 이게 뭐냐".into()).needs_review);
        assert!(screen("ㅄ 같은 소리".into()).needs_review);
    }

    #[test]
    fn 사이에_낀_기호를_걷어낸다() {
        // 회피 표기를 같은 것으로 본다.
        for text in ["ㅅ.ㅂ", "ㅅ ㅂ", "ㅅ-ㅂ", "ㅅ_ㅂ"] {
            assert!(screen(text.into()).needs_review, "{text}");
        }
    }

    #[test]
    fn 반복해도_한_번만_센다() {
        let once = screen("씨발".into()).score;
        let many = screen("씨발 씨발 씨발 씨발".into()).score;
        assert_eq!(once, many, "반복마다 점수가 오르면 긴 글이 불리해진다");
    }

    #[test]
    fn 겹치면_점수가_오르되_일을_넘지_않는다() {
        let one = screen("씨발".into()).score;
        let two = screen("씨발 병신".into()).score;
        assert!(two > one);
        assert!(two <= 1.0);
        let many = screen("씨발 병신 지랄 좆 ㄱㅅㄲ 미친년".into());
        assert!(many.score <= 1.0);
    }

    #[test]
    fn 약한_표현_하나로는_배너까지_가지_않는다() {
        // 0.30~0.65 는 회색지대다. 무해한 강한 어조까지 경고하면 코치가
        // 잔소리로 전락한다 (§3.2).
        let result = screen("그건 좀 멍청이 같은 생각이다".into());
        assert!(result.needs_review, "2단계로는 보내야 한다");
        assert!(result.score < BANNER_THRESHOLD, "배너까지 가서는 안 된다");
    }

    #[test]
    fn 정치_용어가_목록에_없다() {
        // 이 시험이 이 파일에서 가장 중요하다. 정당·정치인·이념을 목록에
        // 넣는 순간 이 플랫폼은 막으려던 바로 그 일을 하게 된다.
        let forbidden = [
            "민주",
            "국민의힘",
            "보수",
            "진보",
            "좌파",
            "우파",
            "빨갱이",
            "토착왜구",
            "페미",
            "한남",
            "김치녀",
            "대통령",
            "정부",
            "야당",
            "여당",
        ];
        for (term, _) in LEXICON {
            for bad in forbidden {
                assert!(
                    !term.contains(bad),
                    "어휘 목록에 정치 용어가 들어 있다: {term}"
                );
            }
        }
    }

    #[test]
    fn 정치적_주장은_점수가_오르지_않는다() {
        for text in [
            "이 정부의 정책은 실패했다고 봅니다",
            "야당의 주장에 동의하지 않습니다",
            "보수와 진보 모두 책임이 있습니다",
            "대통령의 판단이 잘못되었다고 생각합니다",
        ] {
            assert_eq!(screen(text.into()).score, 0.0, "{text}");
        }
    }

    #[test]
    fn 오백자_한_번이_삼십밀리초_안이다() {
        // 명세의 수용 기준(§VS-E1). 타이핑마다 도는 코드라 예산이 있다.
        //
        // 지금은 어휘 훑기라 마이크로초 단위이고, 이 시험은 사실상 여유를
        // 확인할 뿐이다. 신경망이 들어오면 **이 자리가 진짜 예산선**이 된다.
        // 그때 이 시험이 먼저 빨개져야 한다.
        let text: String = "탄력 근로제는 업종별로 기준을 달리해야 합니다. "
            .chars()
            .cycle()
            .take(500)
            .collect();

        let start = std::time::Instant::now();
        for _ in 0..100 {
            let _ = screen(text.clone());
        }
        let per_call = start.elapsed() / 100;

        assert!(
            per_call < std::time::Duration::from_millis(30),
            "한 번에 {per_call:?} 걸렸다. 예산은 30ms 다"
        );
    }

    #[test]
    fn 결정론적이다() {
        let text = "씨발 이게 무슨 ㅄ 같은 정책이냐";
        assert_eq!(screen(text.into()), screen(text.into()));
    }
}

#[cfg(test)]
mod vectors {
    use super::*;
    use serde::Deserialize;

    /// 공용 시험 벡터.
    ///
    /// 이 규칙은 웹(TypeScript)이 한 번 더 구현한다. 서버에서 도는 것이
    /// 아니라 **브라우저 안에서** 돌아야 하므로 Rust 를 부를 수 없다.
    /// 두 구현이 갈리면 같은 문장이 기기마다 다르게 판정된다.
    const VECTORS: &str = include_str!("../../contracts/screening-vectors.json");

    #[derive(Deserialize)]
    struct Doc {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        text: String,
        score: f64,
        needs_review: bool,
    }

    #[test]
    fn 공용_벡터와_같은_점수를_낸다() {
        let doc: Doc = serde_json::from_str(VECTORS).expect("벡터 파일");
        assert!(!doc.cases.is_empty());
        for case in &doc.cases {
            let result = screen(case.text.clone());
            assert!(
                (result.score - case.score).abs() < 1e-9,
                "{:?}: 기대 {:.6} 실제 {:.6}",
                case.text,
                case.score,
                result.score
            );
            assert_eq!(result.needs_review, case.needs_review, "{:?}", case.text);
        }
    }
}
