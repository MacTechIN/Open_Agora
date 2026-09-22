//! 로컬 카드 저장소 (VS-A3)
//!
//! SQLite에 보관한다. 이 단계에서는 로컬 전용이며, P2P 전파는 VS-B1에서,
//! Ceramic 영속화는 VS-B2′에서 붙는다.
//!
//! ## 삭제와 수정이 없다
//!
//! `DELETE`도 `UPDATE`도 실행하지 않는다. 카드는 등록 후 지울 수 없고 스탠스도
//! 바꿀 수 없다(`docs/00_PRODUCT_SPEC.md` §2.1, §7). 이 파일에 그런 SQL을
//! 추가하는 것은 G-IMMUT 게이트 위반이다.

use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};

use crate::card::{stance_from_str, stance_to_str, CardError, DebateCard, DraftCard};
use crate::policy::{DraftPolicy, Policy, PolicyCategory, PolicySummary};

/// 스키마 버전. 마이그레이션 판단에 쓴다.
///
/// 2: 안건(policies) 도입, cards에 policy_id 추가.
const SCHEMA_VERSION: i64 = 2;

fn storage_error(e: impl std::fmt::Display) -> CardError {
    CardError::Storage {
        reason: e.to_string(),
    }
}

/// 의견 한 건을 넣는다. 안건 등록(트랜잭션)과 단독 추가가 같은 SQL을 쓰도록 분리한다.
fn insert_card(connection: &Connection, card: &DebateCard) -> Result<(), CardError> {
    connection
        .execute(
            "INSERT OR IGNORE INTO cards
               (id, policy_id, stance, problem_definition, evidence_source,
                evidence_url, actionable_solution, author_did, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                card.id,
                card.policy_id,
                stance_to_str(card.stance),
                card.problem_definition,
                card.evidence_source,
                card.evidence_url,
                card.actionable_solution,
                card.author_did,
                card.created_at,
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

/// 로컬 카드 저장소.
///
/// uniffi가 여러 스레드에서 호출할 수 있으므로 연결을 뮤텍스로 감싼다.
/// SQLite 연결 자체는 `Send`지만 `Sync`가 아니다.
pub struct CardStore {
    connection: Mutex<Connection>,
}

impl CardStore {
    /// 저장소를 연다. 파일이 없으면 만든다.
    ///
    /// `path`에 `:memory:`를 주면 메모리 저장소가 된다. 테스트에서 쓴다.
    pub fn new(path: String) -> Result<Self, CardError> {
        let connection = Connection::open(&path).map_err(storage_error)?;
        Self::migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn migrate(connection: &Connection) -> Result<(), CardError> {
        // 저장 중 전원이 끊겨도 파일이 깨지지 않도록 WAL을 쓴다.
        // 메모리 저장소는 WAL을 지원하지 않으므로 실패를 무시한다.
        let _ = connection.pragma_update(None, "journal_mode", "WAL");

        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS policies (
                     id                   TEXT PRIMARY KEY,
                     title                TEXT NOT NULL,
                     category             TEXT NOT NULL,
                     background           TEXT NOT NULL,
                     core_question        TEXT NOT NULL,
                     official_source_url  TEXT NOT NULL,
                     target_agency        TEXT,
                     author_did           TEXT NOT NULL,
                     created_at           INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS cards (
                     id                   TEXT PRIMARY KEY,
                     policy_id            TEXT NOT NULL REFERENCES policies(id),
                     stance               TEXT NOT NULL,
                     problem_definition   TEXT NOT NULL,
                     evidence_source      TEXT NOT NULL,
                     evidence_url         TEXT NOT NULL,
                     actionable_solution  TEXT NOT NULL,
                     author_did           TEXT NOT NULL,
                     created_at           INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_cards_created_at
                     ON cards (created_at DESC);
                 CREATE INDEX IF NOT EXISTS idx_cards_policy
                     ON cards (policy_id, created_at DESC);
                 CREATE INDEX IF NOT EXISTS idx_policies_created_at
                     ON policies (created_at DESC);",
            )
            .map_err(storage_error)?;

        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(storage_error)?;
        Ok(())
    }

    /// 안건을 열고 첫 의견을 함께 등록한다. 반환값은 안건 식별자.
    ///
    /// 둘을 한 트랜잭션으로 묶는다. 안건만 등록되고 의견이 실패하면 토론이
    /// 빈 상태로 남고, 여는 사람이 자기 입장을 밝히지 않은 채 주제만 던지게
    /// 된다(`docs/14_USER_JOURNEY.md` §3).
    pub fn open_policy(
        &self,
        draft: DraftPolicy,
        first_opinion: DraftCard,
        author_did: String,
        created_at: i64,
    ) -> Result<String, CardError> {
        // 검증을 먼저 모두 끝낸다. 안건이 들어간 뒤 의견이 거부되면
        // 롤백해야 하는데, 그 전에 걸러내는 편이 단순하다.
        let policy = draft.finalize(&author_did, created_at)?;
        let card = first_opinion.finalize(&policy.id, &author_did, created_at)?;

        let mut connection = self.connection.lock().map_err(storage_error)?;
        let tx = connection.transaction().map_err(storage_error)?;

        tx.execute(
            "INSERT OR IGNORE INTO policies
               (id, title, category, background, core_question,
                official_source_url, target_agency, author_did, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                policy.id,
                policy.title,
                policy.category.as_str(),
                policy.background,
                policy.core_question,
                policy.official_source_url,
                policy.target_agency,
                policy.author_did,
                policy.created_at,
            ],
        )
        .map_err(storage_error)?;

        insert_card(&tx, &card)?;
        tx.commit().map_err(storage_error)?;

        Ok(policy.id)
    }

    /// 기존 안건에 의견을 추가한다. 반환값은 의견 식별자.
    ///
    /// 같은 내용을 같은 밀리초에 두 번 추가하면 식별자가 같으므로 조용히
    /// 무시된다. 버튼 중복 클릭으로 같은 의견이 두 개 생기는 것을 막는다.
    pub fn add_opinion(
        &self,
        policy_id: String,
        draft: DraftCard,
        author_did: String,
        created_at: i64,
    ) -> Result<String, CardError> {
        let card = draft.finalize(&policy_id, &author_did, created_at)?;
        let connection = self.connection.lock().map_err(storage_error)?;

        // 없는 안건에 의견을 달면 어디에도 보이지 않는 글이 된다.
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM policies WHERE id = ?1",
                [&policy_id],
                |r| r.get(0),
            )
            .map_err(storage_error)?;
        if exists == 0 {
            return Err(CardError::Storage {
                reason: "없는 주제입니다".into(),
            });
        }

        insert_card(&connection, &card)?;
        Ok(card.id)
    }

    /// 한 안건의 의견을 최신순으로 돌려준다.
    ///
    /// 브리징 점수순 정렬은 VS-F3에서 붙는다. 그때까지는 최신순이다.
    pub fn list_opinions(&self, policy_id: String) -> Result<Vec<DebateCard>, CardError> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection
            .prepare(
                "SELECT id, policy_id, stance, problem_definition, evidence_source,
                        evidence_url, actionable_solution, author_did, created_at
                   FROM cards
                  WHERE policy_id = ?1
                  ORDER BY created_at DESC, id",
            )
            .map_err(storage_error)?;

        let rows = statement
            .query_map([&policy_id], |row| {
                let stance: String = row.get(2)?;
                Ok(DebateCard {
                    id: row.get(0)?,
                    policy_id: row.get(1)?,
                    // 알 수 없는 스탠스는 데이터 손상이다. 조용히 기본값으로
                    // 바꾸면 찬성 글이 반대 열에 나타날 수 있으므로 오류로 만든다.
                    stance: stance_from_str(&stance).ok_or_else(|| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            format!("알 수 없는 스탠스: {stance}").into(),
                        )
                    })?,
                    problem_definition: row.get(3)?,
                    evidence_source: row.get(4)?,
                    evidence_url: row.get(5)?,
                    actionable_solution: row.get(6)?,
                    author_did: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    /// 광장 목록 — 안건과 찬반 분포를 함께 돌려준다.
    ///
    /// 목록 화면이 안건마다 의견을 다시 읽지 않아도 되도록 집계를 한 번에
    /// 만든다. 안건이 늘어나면 N+1 질의가 눈에 띄게 느려진다.
    pub fn list_policies(&self) -> Result<Vec<PolicySummary>, CardError> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection
            .prepare(
                "SELECT p.id, p.title, p.category, p.background, p.core_question,
                        p.official_source_url, p.target_agency, p.author_did, p.created_at,
                        COALESCE(SUM(c.stance = 'SUPPORT'), 0),
                        COALESCE(SUM(c.stance = 'ALTERNATIVE'), 0),
                        COALESCE(SUM(c.stance = 'OPPOSE'), 0),
                        COALESCE(MAX(c.created_at), p.created_at)
                   FROM policies p
                   LEFT JOIN cards c ON c.policy_id = p.id
                  GROUP BY p.id
                  ORDER BY COALESCE(MAX(c.created_at), p.created_at) DESC",
            )
            .map_err(storage_error)?;

        let rows = statement
            .query_map([], |row| {
                let category: String = row.get(2)?;
                Ok(PolicySummary {
                    policy: Policy {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        category: PolicyCategory::parse(&category).ok_or_else(|| {
                            rusqlite::Error::FromSqlConversionFailure(
                                2,
                                rusqlite::types::Type::Text,
                                format!("알 수 없는 분류: {category}").into(),
                            )
                        })?,
                        background: row.get(3)?,
                        core_question: row.get(4)?,
                        official_source_url: row.get(5)?,
                        target_agency: row.get(6)?,
                        author_did: row.get(7)?,
                        created_at: row.get(8)?,
                    },
                    support_count: row.get::<_, i64>(9)? as u32,
                    alternative_count: row.get::<_, i64>(10)? as u32,
                    oppose_count: row.get::<_, i64>(11)? as u32,
                    last_activity_at: row.get(12)?,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    /// 안건 하나를 읽는다.
    pub fn get_policy(&self, policy_id: String) -> Result<Option<Policy>, CardError> {
        Ok(self
            .list_policies()?
            .into_iter()
            .find(|s| s.policy.id == policy_id)
            .map(|s| s.policy))
    }

    /// 저장된 의견 수.
    pub fn count(&self) -> Result<u32, CardError> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cards", [], |row| row.get(0))
            .optional()
            .map_err(storage_error)?
            .unwrap_or(0);
        Ok(count as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::StanceType;
    use crate::policy::PolicyCategory;

    const DID: &str = "did:key:zDnaewBSXeQ82kLpw79E5X3yjpPfRFz1fxApcEVaxh6TxWMP4";

    fn draft_policy(title: &str) -> DraftPolicy {
        DraftPolicy {
            title: title.into(),
            category: PolicyCategory::Legislation,
            background: "현행 제도가 모든 업종에 일률 적용되어 부담이 크다".into(),
            core_question: "직종별로 적용 기준을 달리해야 하는가?".into(),
            official_source_url: "https://likms.assembly.go.kr/bill/detail.do".into(),
            target_agency: Some("고용노동부".into()),
        }
    }

    fn draft_card(stance: StanceType, problem: &str) -> DraftCard {
        DraftCard {
            stance,
            problem_definition: problem.into(),
            evidence_source: "통계청 2026년 사업체노동력조사".into(),
            evidence_url: "https://kostat.go.kr/board.es".into(),
            actionable_solution: "업종별 가이드라인을 차등화한다".into(),
        }
    }

    fn memory_store() -> CardStore {
        CardStore::new(":memory:".into()).expect("메모리 저장소")
    }

    /// 안건 하나를 열고 식별자를 돌려준다.
    fn open(store: &CardStore, title: &str, at: i64) -> String {
        store
            .open_policy(
                draft_policy(title),
                draft_card(StanceType::Support, "첫 의견"),
                DID.into(),
                at,
            )
            .expect("안건 등록")
    }

    #[test]
    fn 새_저장소는_비어_있다() {
        let store = memory_store();
        assert!(store.list_policies().unwrap().is_empty());
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn 안건과_첫_의견이_함께_등록된다() {
        // 주제만 던지고 빠질 수 없다는 규칙을 고정한다.
        let store = memory_store();
        let id = open(&store, "탄력 근로제", 1_000);

        let policies = store.list_policies().unwrap();
        assert_eq!(policies.len(), 1);
        assert_eq!(policies[0].policy.id, id);
        assert_eq!(
            policies[0].policy.core_question,
            "직종별로 적용 기준을 달리해야 하는가?"
        );
        assert_eq!(policies[0].total(), 1, "첫 의견이 함께 저장되지 않았다");

        let opinions = store.list_opinions(id.clone()).unwrap();
        assert_eq!(opinions.len(), 1);
        assert_eq!(opinions[0].policy_id, id);
    }

    #[test]
    fn 안건_검증에_실패하면_아무것도_저장되지_않는다() {
        // 트랜잭션 경계. 안건만 남고 의견이 없으면 빈 토론이 된다.
        let store = memory_store();
        let mut bad = draft_policy("제목");
        bad.core_question = "".into();
        let result = store.open_policy(bad, draft_card(StanceType::Support, "의견"), DID.into(), 1);
        assert!(result.is_err());
        assert!(store.list_policies().unwrap().is_empty());
        assert_eq!(store.count().unwrap(), 0);
    }

    #[test]
    fn 첫_의견_검증에_실패해도_안건이_남지_않는다() {
        let store = memory_store();
        let mut bad = draft_card(StanceType::Support, "의견");
        bad.evidence_url = "".into();
        let result = store.open_policy(draft_policy("제목"), bad, DID.into(), 1);
        assert!(result.is_err());
        assert!(store.list_policies().unwrap().is_empty(), "안건만 남았다");
    }

    #[test]
    fn 기존_안건에_의견을_추가한다() {
        let store = memory_store();
        let id = open(&store, "탄력 근로제", 1_000);
        store
            .add_opinion(
                id.clone(),
                draft_card(StanceType::Oppose, "반대 의견"),
                DID.into(),
                2_000,
            )
            .unwrap();

        let opinions = store.list_opinions(id.clone()).unwrap();
        assert_eq!(opinions.len(), 2);
        // 최신순
        assert_eq!(opinions[0].stance, StanceType::Oppose);
    }

    #[test]
    fn 없는_안건에는_의견을_달_수_없다() {
        // 어디에도 보이지 않는 글이 생기는 것을 막는다.
        let store = memory_store();
        let result = store.add_opinion(
            "없는안건".into(),
            draft_card(StanceType::Support, "의견"),
            DID.into(),
            1,
        );
        assert!(result.is_err());
    }

    #[test]
    fn 찬반_분포를_집계한다() {
        let store = memory_store();
        let id = open(&store, "주제", 1_000); // 첫 의견은 SUPPORT
        for (i, stance) in [
            StanceType::Oppose,
            StanceType::Oppose,
            StanceType::Alternative,
        ]
        .into_iter()
        .enumerate()
        {
            store
                .add_opinion(
                    id.clone(),
                    draft_card(stance, &format!("의견 {i}")),
                    DID.into(),
                    2_000 + i as i64,
                )
                .unwrap();
        }
        let summary = &store.list_policies().unwrap()[0];
        assert_eq!(summary.support_count, 1);
        assert_eq!(summary.oppose_count, 2);
        assert_eq!(summary.alternative_count, 1);
        assert_eq!(summary.total(), 4);
    }

    #[test]
    fn 최근_활동순으로_정렬한다() {
        let store = memory_store();
        let old = open(&store, "오래된 주제", 1_000);
        let recent = open(&store, "최근 주제", 2_000);
        // 오래된 주제에 새 의견을 달면 위로 올라와야 한다
        store
            .add_opinion(
                old.clone(),
                draft_card(StanceType::Oppose, "새 의견"),
                DID.into(),
                3_000,
            )
            .unwrap();

        let order: Vec<_> = store
            .list_policies()
            .unwrap()
            .iter()
            .map(|s| s.policy.id.clone())
            .collect();
        assert_eq!(order, vec![old, recent]);
    }

    #[test]
    fn 의견은_안건별로_분리된다() {
        let store = memory_store();
        let a = open(&store, "주제 A", 1_000);
        let b = open(&store, "주제 B", 2_000);
        store
            .add_opinion(
                a.clone(),
                draft_card(StanceType::Oppose, "A의 의견"),
                DID.into(),
                3_000,
            )
            .unwrap();

        assert_eq!(store.list_opinions(a).unwrap().len(), 2);
        assert_eq!(store.list_opinions(b).unwrap().len(), 1);
    }

    #[test]
    fn 같은_내용도_안건이_다르면_다른_의견이다() {
        // 안건을 해시에 넣지 않으면 식별자가 충돌해 한쪽이 사라진다.
        let store = memory_store();
        let a = open(&store, "주제 A", 1_000);
        let b = open(&store, "주제 B", 1_000);
        let card = draft_card(StanceType::Oppose, "같은 내용");
        let id_a = store
            .add_opinion(a, card.clone(), DID.into(), 5_000)
            .unwrap();
        let id_b = store.add_opinion(b, card, DID.into(), 5_000).unwrap();
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn 중복_추가를_무시한다() {
        let store = memory_store();
        let id = open(&store, "주제", 1_000);
        let card = draft_card(StanceType::Oppose, "같은 글");
        let first = store
            .add_opinion(id.clone(), card.clone(), DID.into(), 500)
            .unwrap();
        let second = store.add_opinion(id, card, DID.into(), 500).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.count().unwrap(), 2, "첫 의견 + 중복 1건");
    }

    #[test]
    fn 파일에_저장하면_재시작_후에도_남는다() {
        // VS-A3의 수용 기준. 앱을 다시 열어도 주제와 의견이 보여야 한다.
        let dir = std::env::temp_dir().join(format!("civicagora-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.db").to_string_lossy().to_string();

        let id = {
            let store = CardStore::new(path.clone()).unwrap();
            open(&store, "영속성 확인", 7_000)
        }; // 저장소를 닫는다 = 앱 종료

        {
            let reopened = CardStore::new(path).unwrap();
            let policies = reopened.list_policies().unwrap();
            assert_eq!(policies.len(), 1, "재시작 후 주제가 사라졌다");
            assert_eq!(policies[0].policy.title, "영속성 확인");
            assert_eq!(reopened.list_opinions(id).unwrap().len(), 1);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 안건을_식별자로_읽는다() {
        let store = memory_store();
        let id = open(&store, "주제", 1_000);
        assert_eq!(store.get_policy(id).unwrap().unwrap().title, "주제");
        assert!(store.get_policy("없음".into()).unwrap().is_none());
    }
}
