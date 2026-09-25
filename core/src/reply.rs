//! 댓글 (VS-D3)
//!
//! 카드 아래에 지지·반박을 답니다. 카드와 달리 3단 구조를 강제하지 않고
//! 자유 서술 500자입니다(`docs/00_PRODUCT_SPEC.md` §4).
//!
//! ## 한 단계만 허용한다
//!
//! 댓글의 댓글이 없습니다. 스레드가 깊어지면 진영 간 소모적 설전으로 흐르기
//! 때문입니다. 이것은 화면의 제약이 아니라 **자료 구조의 제약**입니다 —
//! `Reply` 에 부모 댓글을 가리키는 자리가 아예 없습니다. 자리가 있으면
//! 언젠가 채워집니다.
//!
//! ## 반응을 달 수 없다
//!
//! 브리징 신호는 카드 단위로만 모읍니다. 댓글에 반응을 허용하면 신호가
//! 두 층위로 갈리고, 어느 쪽이 품질을 뜻하는지 알 수 없게 됩니다.
//!
//! ## 삭제와 수정이 없다
//!
//! 카드와 같습니다 (G-IMMUT).

use crate::card::{check_field, content_id, CardError};

/// 댓글 최대 길이. 카드 세 칸의 합과 같다.
pub const MAX_BODY: usize = 500;

/// 등록하려는 댓글.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftReply {
    pub body: String,
}

/// 등록된 댓글.
///
/// **부모 댓글을 가리키는 자리가 없다.** 한 단계만 허용한다는 규칙을 타입으로
/// 못박는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub id: String,
    /// 이 댓글이 달린 카드.
    pub card_id: String,
    pub body: String,
    pub author_did: String,
    pub created_at: i64,
    /// 작성자 서명 (P1363, 16진). 서명 이전 글은 없다.
    pub signature: Option<String>,
}

impl DraftReply {
    pub fn validate(&self) -> Result<(), CardError> {
        check_field("댓글", &self.body, MAX_BODY)
    }

    pub(crate) fn finalize(
        self,
        card_id: &str,
        author_did: &str,
        created_at: i64,
        signature: Option<String>,
    ) -> Result<Reply, CardError> {
        self.validate()?;

        // 식별자 규칙은 서버(web/lib/signing.ts contentId)와 같아야 한다.
        let id = content_id(&[
            card_id,
            author_did,
            &created_at.to_string(),
            self.body.trim(),
        ]);

        Ok(Reply {
            id,
            card_id: card_id.to_string(),
            body: self.body.trim().to_string(),
            author_did: author_did.to_string(),
            created_at,
            signature,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(body: &str) -> DraftReply {
        DraftReply { body: body.into() }
    }

    #[test]
    fn 오백자까지_허용한다() {
        let body: String = "가".repeat(MAX_BODY);
        assert!(draft(&body).validate().is_ok());
    }

    #[test]
    fn 오백자를_넘으면_거부하고_실제_글자수를_알려준다() {
        let body: String = "가".repeat(MAX_BODY + 3);
        match draft(&body).validate() {
            Err(CardError::TooLong { limit, actual, .. }) => {
                assert_eq!(limit, MAX_BODY as u32);
                assert_eq!(actual, (MAX_BODY + 3) as u32);
            }
            other => panic!("길이 초과를 잡지 못했다: {other:?}"),
        }
    }

    #[test]
    fn 빈_댓글을_거부한다() {
        assert!(draft("   ").validate().is_err());
    }

    #[test]
    fn 앞뒤_공백을_제거해_저장한다() {
        let reply = draft("  의견 잘 봤습니다  ")
            .finalize("card1", "did:key:zTest", 1, None)
            .unwrap();
        assert_eq!(reply.body, "의견 잘 봤습니다");
    }

    #[test]
    fn 같은_입력이_같은_식별자를_만든다() {
        let a = draft("같은 글")
            .finalize("c1", "did:key:zT", 42, None)
            .unwrap();
        let b = draft("같은 글")
            .finalize("c1", "did:key:zT", 42, None)
            .unwrap();
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn 카드가_다르면_식별자가_다르다() {
        let a = draft("같은 글")
            .finalize("c1", "did:key:zT", 42, None)
            .unwrap();
        let b = draft("같은 글")
            .finalize("c2", "did:key:zT", 42, None)
            .unwrap();
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn 자소로_센다() {
        // 이모지 조합은 한 글자다. 카드와 같은 기준이어야 화면과 저장이 갈리지 않는다.
        let body: String = "👨‍👩‍👧‍👦".repeat(MAX_BODY);
        assert!(draft(&body).validate().is_ok());
        let over: String = "👨‍👩‍👧‍👦".repeat(MAX_BODY + 1);
        assert!(draft(&over).validate().is_err());
    }
}
