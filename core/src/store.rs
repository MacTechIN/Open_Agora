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

/// 스키마 버전. 마이그레이션 판단에 쓴다.
const SCHEMA_VERSION: i64 = 1;

fn storage_error(e: impl std::fmt::Display) -> CardError {
    CardError::Storage {
        reason: e.to_string(),
    }
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
                "CREATE TABLE IF NOT EXISTS cards (
                     id                   TEXT PRIMARY KEY,
                     stance               TEXT NOT NULL,
                     problem_definition   TEXT NOT NULL,
                     evidence_source      TEXT NOT NULL,
                     evidence_url         TEXT NOT NULL,
                     actionable_solution  TEXT NOT NULL,
                     author_did           TEXT NOT NULL,
                     created_at           INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_cards_created_at
                     ON cards (created_at DESC);",
            )
            .map_err(storage_error)?;

        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(storage_error)?;
        Ok(())
    }

    /// 카드를 추가한다. 반환값은 카드 식별자.
    ///
    /// 같은 내용을 같은 밀리초에 두 번 추가하면 식별자가 같으므로 조용히
    /// 무시된다. 의도된 동작이다 — 버튼 중복 클릭으로 같은 카드가 두 개
    /// 생기는 것을 막는다.
    pub fn add(
        &self,
        draft: DraftCard,
        author_did: String,
        created_at: i64,
    ) -> Result<String, CardError> {
        let card = draft.finalize(&author_did, created_at)?;
        let connection = self.connection.lock().map_err(storage_error)?;

        connection
            .execute(
                "INSERT OR IGNORE INTO cards
                   (id, stance, problem_definition, evidence_source,
                    evidence_url, actionable_solution, author_did, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    card.id,
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

        Ok(card.id)
    }

    /// 카드를 최신순으로 돌려준다.
    ///
    /// 브리징 점수순 정렬은 VS-F3에서 붙는다. 그때까지는 최신순이다.
    pub fn list(&self) -> Result<Vec<DebateCard>, CardError> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection
            .prepare(
                "SELECT id, stance, problem_definition, evidence_source,
                        evidence_url, actionable_solution, author_did, created_at
                   FROM cards
                  ORDER BY created_at DESC, id",
            )
            .map_err(storage_error)?;

        let rows = statement
            .query_map([], |row| {
                let stance: String = row.get(1)?;
                Ok(DebateCard {
                    id: row.get(0)?,
                    // 알 수 없는 스탠스는 데이터 손상이다. 조용히 기본값으로
                    // 바꾸면 찬성 글이 반대 열에 나타날 수 있으므로 오류로 만든다.
                    stance: stance_from_str(&stance).ok_or_else(|| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            format!("알 수 없는 스탠스: {stance}").into(),
                        )
                    })?,
                    problem_definition: row.get(2)?,
                    evidence_source: row.get(3)?,
                    evidence_url: row.get(4)?,
                    actionable_solution: row.get(5)?,
                    author_did: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    /// 저장된 카드 수.
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

    const DID: &str = "did:key:zDnaewBSXeQ82kLpw79E5X3yjpPfRFz1fxApcEVaxh6TxWMP4";

    fn draft(stance: StanceType, problem: &str) -> DraftCard {
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

    #[test]
    fn 새_저장소는_비어_있다() {
        let store = memory_store();
        assert_eq!(store.count().unwrap(), 0);
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn 카드를_저장하고_읽는다() {
        let store = memory_store();
        let id = store
            .add(
                draft(StanceType::Oppose, "행정 비용 문제"),
                DID.into(),
                1_000,
            )
            .unwrap();

        let cards = store.list().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, id);
        assert_eq!(cards[0].stance, StanceType::Oppose);
        assert_eq!(cards[0].problem_definition, "행정 비용 문제");
        assert_eq!(cards[0].author_did, DID);
        assert_eq!(cards[0].created_at, 1_000);
    }

    #[test]
    fn 세_스탠스가_모두_왕복한다() {
        // 스탠스가 뒤바뀌면 찬성 글이 반대 열에 나타난다.
        let store = memory_store();
        for (i, stance) in [
            StanceType::Support,
            StanceType::Alternative,
            StanceType::Oppose,
        ]
        .into_iter()
        .enumerate()
        {
            store
                .add(
                    draft(stance, &format!("의견 {i}")),
                    DID.into(),
                    1_000 + i as i64,
                )
                .unwrap();
        }
        let stored: Vec<_> = store.list().unwrap().iter().map(|c| c.stance).collect();
        // 최신순이므로 역순이다
        assert_eq!(
            stored,
            vec![
                StanceType::Oppose,
                StanceType::Alternative,
                StanceType::Support
            ]
        );
    }

    #[test]
    fn 최신순으로_정렬한다() {
        let store = memory_store();
        for t in [100, 300, 200] {
            store
                .add(draft(StanceType::Support, &format!("t{t}")), DID.into(), t)
                .unwrap();
        }
        let times: Vec<_> = store.list().unwrap().iter().map(|c| c.created_at).collect();
        assert_eq!(times, vec![300, 200, 100]);
    }

    #[test]
    fn 중복_추가를_무시한다() {
        // 버튼을 두 번 누르면 같은 카드가 두 개 생겨서는 안 된다.
        let store = memory_store();
        let first = store
            .add(draft(StanceType::Support, "같은 글"), DID.into(), 500)
            .unwrap();
        let second = store
            .add(draft(StanceType::Support, "같은 글"), DID.into(), 500)
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(store.count().unwrap(), 1);
    }

    #[test]
    fn 검증에_실패하면_저장하지_않는다() {
        let store = memory_store();
        let mut bad = draft(StanceType::Support, "정상");
        bad.evidence_url = "".into();
        assert!(store.add(bad, DID.into(), 1).is_err());
        assert_eq!(store.count().unwrap(), 0, "실패한 카드가 저장됐다");
    }

    #[test]
    fn 파일에_저장하면_재시작_후에도_남는다() {
        // VS-A3의 수용 기준. 앱을 다시 열어도 카드가 보여야 한다.
        let dir = std::env::temp_dir().join(format!("civicagora-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.db");
        let path_str = path.to_string_lossy().to_string();

        let id = {
            let store = CardStore::new(path_str.clone()).unwrap();
            store
                .add(
                    draft(StanceType::Alternative, "영속성 확인"),
                    DID.into(),
                    7_000,
                )
                .unwrap()
        }; // 저장소를 닫는다 = 앱 종료

        {
            let reopened = CardStore::new(path_str).unwrap();
            let cards = reopened.list().unwrap();
            assert_eq!(cards.len(), 1, "재시작 후 카드가 사라졌다");
            assert_eq!(cards[0].id, id);
            assert_eq!(cards[0].problem_definition, "영속성 확인");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
