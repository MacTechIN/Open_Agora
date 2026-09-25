/**
 * 댓글 (VS-D3) — 서버 전용.
 *
 * 카드 아래에 지지·반박을 답니다. 카드와 달리 3단 구조를 강제하지 않고 자유
 * 서술 500자입니다(`docs/00_PRODUCT_SPEC.md` §4).
 *
 * ## 한 단계만 허용한다
 *
 * 댓글의 댓글이 없습니다. 스레드가 깊어지면 진영 간 소모적 설전으로 흐르기
 * 때문입니다. **표에 부모 댓글을 가리키는 열이 아예 없습니다** — 자리가
 * 있으면 언젠가 채워집니다.
 *
 * ## 반응을 달 수 없다
 *
 * 브리징 신호는 카드 단위로만 모읍니다. 댓글에 반응을 허용하면 신호가 두
 * 층위로 갈리고, 어느 쪽이 품질을 뜻하는지 알 수 없게 됩니다.
 *
 * ## 지우거나 고칠 수 없다
 *
 * 카드와 같습니다(G-IMMUT). UPDATE 도 DELETE 도 없습니다.
 */
import { requireDb } from "./db.ts";
import { replyPayload, type SignableReply } from "./signing.ts";

export type Reply = {
  id: string;
  card_id: string;
  body: string;
  author_did: string;
  created_at: number;
  signature: string | null;
};

export async function migrateReplies() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS replies (
      id         TEXT PRIMARY KEY,
      card_id    TEXT NOT NULL REFERENCES cards(id),
      body       TEXT NOT NULL,
      author_did TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      signature  TEXT
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_replies_card ON replies (card_id, created_at)`;
}

/** 한 카드의 댓글. 오래된 순 — 대화는 읽는 순서가 있다. */
export async function repliesFor(cardIds: string[]): Promise<Record<string, Reply[]>> {
  await migrateReplies();
  const out: Record<string, Reply[]> = {};
  for (const id of cardIds) out[id] = [];
  if (cardIds.length === 0) return out;

  const db = requireDb();
  const rows = await db`
    SELECT * FROM replies WHERE card_id = ANY(${cardIds}) ORDER BY created_at, id`;
  for (const row of rows) {
    out[String(row.card_id)]?.push({
      id: String(row.id),
      card_id: String(row.card_id),
      body: String(row.body),
      author_did: String(row.author_did),
      created_at: Number(row.created_at),
      signature: row.signature == null ? null : String(row.signature),
    });
  }
  return out;
}

/** 댓글 하나를 넣는다. 같은 식별자면 조용히 넘어간다(중복 클릭). */
export async function addReply(reply: Reply): Promise<void> {
  await migrateReplies();
  const db = requireDb();
  await db`
    INSERT INTO replies (id, card_id, body, author_did, created_at, signature)
    VALUES (${reply.id}, ${reply.card_id}, ${reply.body}, ${reply.author_did},
            ${reply.created_at}, ${reply.signature})
    ON CONFLICT (id) DO NOTHING`;
}

/** 서명 대상 바이트. 코어와 같은 규칙이어야 한다. */
export function payloadFor(reply: SignableReply): Uint8Array {
  return replyPayload(reply);
}
