/**
 * 공유 데이터 계층 (게이트웨이 단계).
 *
 * ## 이것이 임시인 이유
 *
 * 명세는 중앙 서버 없는 P2P를 규정한다(`docs/01_ARCHITECTURE.md`). 그러나
 * P2P 계층은 ComposeDB 중단으로 재선정 중이고(VS-B2′), 그때까지 사용자들이
 * 서로의 글을 볼 방법이 없다. 아무도 쓸 수 없는 공론장은 원칙을 지켜도
 * 의미가 없다.
 *
 * 그래서 공유 서버를 **다리**로 둔다. P2P가 준비되면 이 서버는 P2P 망으로
 * 들어가는 읽기 게이트웨이가 되고, 데이터의 정본은 P2P로 옮겨간다.
 * 그때까지의 한계를 문서와 화면에 명시한다(→ `docs/15_BRIDGE_SERVER.md`).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;

/**
 * 데이터베이스 연결.
 *
 * 환경변수가 없으면 즉시 실패한다. 조용히 메모리로 내려앉으면 글이 사라지는데
 * 사용자는 저장된 줄 안다.
 */
export const sql = url
  ? postgres(url, { ssl: "require", max: 5 })
  : null;

export function requireDb() {
  if (!sql) {
    throw new Error(
      "DATABASE_URL 이 설정되지 않았습니다. 웹을 실행하려면 Postgres 연결이 필요합니다."
    );
  }
  return sql;
}

/** 스키마를 만든다. 코어의 SQLite 스키마와 같은 모양이다. */
export async function migrate() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS policies (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      category            TEXT NOT NULL,
      background          TEXT NOT NULL,
      core_question       TEXT NOT NULL,
      official_source_url TEXT NOT NULL,
      target_agency       TEXT,
      author_did          TEXT NOT NULL,
      created_at          BIGINT NOT NULL
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS cards (
      id                  TEXT PRIMARY KEY,
      policy_id           TEXT NOT NULL REFERENCES policies(id),
      stance              TEXT NOT NULL,
      problem_definition  TEXT NOT NULL,
      evidence_source     TEXT NOT NULL,
      evidence_url        TEXT NOT NULL,
      actionable_solution TEXT NOT NULL,
      author_did          TEXT NOT NULL,
      created_at          BIGINT NOT NULL
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_cards_policy ON cards (policy_id, created_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_policies_created ON policies (created_at DESC)`;
}
