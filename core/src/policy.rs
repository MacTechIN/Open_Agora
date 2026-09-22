//! 안건(주제) — 공론화할 주제와 쟁점 질문 (VS-A3′)
//!
//! 명세: `docs/00_PRODUCT_SPEC.md` §6, `docs/14_USER_JOURNEY.md` §3
//!
//! ## 쟁점 질문이 토론의 축이다
//!
//! 찬반은 주제가 아니라 **쟁점 질문**에 대한 것이다. "탄력 근로제 개선"에는
//! 찬반이 성립하지 않지만 "직종별로 기준을 달리해야 하는가?"에는 성립한다.
//! 질문이 흐리면 같은 주제 아래 서로 다른 것을 두고 찬반하게 된다.
//!
//! ## 주제만 던지고 빠질 수 없다
//!
//! 안건 등록은 첫 의견과 함께만 가능하다(`CardStore::open_policy`). 토론이
//! 빈 상태로 시작하지 않게 하고, 여는 사람도 자기 입장을 밝히게 한다.

use sha2::{Digest, Sha256};

use crate::card::{check_field, check_url, CardError};

/// 제목 최대 길이.
pub const MAX_TITLE: usize = 60;
/// 배경 서술 최대 길이.
pub const MAX_BACKGROUND: usize = 300;
/// 쟁점 질문 최대 길이.
pub const MAX_QUESTION: usize = 100;

/// 안건 분류.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyCategory {
    /// 정부 정책
    GovPolicy,
    /// 입법안
    Legislation,
    /// 정당 정책
    PartyPolicy,
    /// 지자체
    Local,
    /// 공공기관
    PublicOrg,
    /// 사회 현안
    SocialIssue,
    /// 문제 고발
    Whistleblow,
}

impl PolicyCategory {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            PolicyCategory::GovPolicy => "GOV_POLICY",
            PolicyCategory::Legislation => "LEGISLATION",
            PolicyCategory::PartyPolicy => "PARTY_POLICY",
            PolicyCategory::Local => "LOCAL",
            PolicyCategory::PublicOrg => "PUBLIC_ORG",
            PolicyCategory::SocialIssue => "SOCIAL_ISSUE",
            PolicyCategory::Whistleblow => "WHISTLEBLOW",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "GOV_POLICY" => PolicyCategory::GovPolicy,
            "LEGISLATION" => PolicyCategory::Legislation,
            "PARTY_POLICY" => PolicyCategory::PartyPolicy,
            "LOCAL" => PolicyCategory::Local,
            "PUBLIC_ORG" => PolicyCategory::PublicOrg,
            "SOCIAL_ISSUE" => PolicyCategory::SocialIssue,
            "WHISTLEBLOW" => PolicyCategory::Whistleblow,
            _ => return None,
        })
    }
}

/// 등록하려는 안건.
#[derive(Debug, Clone)]
pub struct DraftPolicy {
    pub title: String,
    pub category: PolicyCategory,
    /// 왜 지금 이슈인가.
    pub background: String,
    /// 찬반이 성립하는 하나의 질문. 토론의 축이다.
    pub core_question: String,
    pub official_source_url: String,
    /// 소관 기관. 보고서 수신처 후보가 된다.
    pub target_agency: Option<String>,
}

/// 등록된 안건.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub id: String,
    pub title: String,
    pub category: PolicyCategory,
    pub background: String,
    pub core_question: String,
    pub official_source_url: String,
    pub target_agency: Option<String>,
    pub author_did: String,
    pub created_at: i64,
}

/// 광장 목록에 쓰는 안건 요약.
///
/// 목록 화면이 안건마다 의견을 다시 읽지 않아도 되도록 집계를 함께 준다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicySummary {
    pub policy: Policy,
    pub support_count: u32,
    pub alternative_count: u32,
    pub oppose_count: u32,
    /// 마지막 의견이 올라온 시각. 없으면 안건 등록 시각.
    pub last_activity_at: i64,
}

impl PolicySummary {
    /// 전체 의견 수.
    pub fn total(&self) -> u32 {
        self.support_count + self.alternative_count + self.oppose_count
    }
}

impl DraftPolicy {
    /// 모든 필드를 검증한다.
    pub fn validate(&self) -> Result<(), CardError> {
        check_field("주제 제목", &self.title, MAX_TITLE)?;
        check_field("배경", &self.background, MAX_BACKGROUND)?;
        check_field("쟁점 질문", &self.core_question, MAX_QUESTION)?;
        check_url(&self.official_source_url)?;
        Ok(())
    }

    pub(crate) fn finalize(self, author_did: &str, created_at: i64) -> Result<Policy, CardError> {
        self.validate()?;

        let mut hasher = Sha256::new();
        hasher.update(author_did.as_bytes());
        hasher.update(created_at.to_be_bytes());
        for field in [&self.title, &self.background, &self.core_question] {
            // 길이를 함께 넣어 필드 경계가 섞이는 것을 막는다.
            hasher.update((field.len() as u64).to_be_bytes());
            hasher.update(field.as_bytes());
        }
        let id = format!("{:x}", hasher.finalize());

        Ok(Policy {
            id,
            title: self.title.trim().to_string(),
            category: self.category,
            background: self.background.trim().to_string(),
            core_question: self.core_question.trim().to_string(),
            official_source_url: self.official_source_url.trim().to_string(),
            target_agency: self
                .target_agency
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty()),
            author_did: author_did.to_string(),
            created_at,
        })
    }
}
