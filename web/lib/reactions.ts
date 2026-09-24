/**
 * 반응 4종 (VS-D2) — 서버 전용.
 *
 * 💡논리적이에요 · 🤝공감해요 (`r=1`) / 🔍팩트체크 필요해요 · ⚖️이견 있어요 (`r=0`)
 *
 * 💡가 이 제품의 핵심입니다. "내 진영은 아니지만 말은 맞다"를 표현하는
 * 통로이고, 브리징 점수를 만들어내는 것이 바로 그 신호입니다.
 *
 * ## 누가 눌렀는지 저장하지 않습니다
 *
 * 저장하는 것은 **필명**입니다 — `Poseidon(비밀, 고정 scope)` 로, 비밀에
 * 묶여 있어 위조할 수 없고 이메일·DID 와는 이어지지 않습니다. 브리징 행렬의
 * 행이 이 필명이며, 그 이상은 필요하지 않습니다.
 *
 * **반응자 목록을 내보내는 화면도 API 도 두지 않습니다**(G-PRIV, INV-3).
 * 집계만 공개합니다. `scripts/check-no-reactor-list.mjs` 가 지킵니다.
 *
 * ## 아직 못 막는 것 — 자기 카드에 반응하기
 *
 * 명세는 자기 카드에 반응할 수 없다고 합니다(§5). 그런데 카드의 작성자는
 * DID 로, 반응자는 필명으로 표시되고 **둘은 의도적으로 이어져 있지 않습니다.**
 * 서버는 둘이 같은 사람인지 알 수 없습니다.
 *
 * 지금은 화면에서만 막습니다. 서버에서 막으려면 카드를 올릴 때도 영지식
 * 증명을 함께 받아야 하고, 그러면 네이티브 앱이 Semaphore 를 갖추기 전까지
 * 글을 올릴 수 없게 됩니다. 감춘 한계가 아니라 **적어 둔 한계**입니다.
 */
import { requireDb } from "./db.ts";
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { migrateAnon } from "./anon.ts";
import {
  PSEUDONYM_SCOPE, reactionMessage, signalOf, type ReactionKind,
} from "./scope.ts";

/** 기기 시계 오차 허용치. 서명(VS-A4)과 같은 기준. */
const SKEW_MS = 5 * 60 * 1000;

export async function migrateReactions() {
  await migrateAnon();
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS reactions (
      pseudonym  TEXT NOT NULL,
      card_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      signal     SMALLINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (pseudonym, card_id)
    )`;
  // 카드별 집계를 자주 읽는다.
  await db`CREATE INDEX IF NOT EXISTS idx_reactions_card ON reactions (card_id)`;
}

export type ReactResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

/**
 * 반응 하나를 남기거나 바꾼다.
 *
 * 검증이 저장보다 먼저다. 증명을 확인하기 전에 쓰면 가짜 증명으로 남의
 * 반응을 덮어쓸 수 있다.
 */
export async function react(
  proof: SemaphoreProof,
  cardId: string,
  kind: ReactionKind,
  at: number
): Promise<ReactResult> {
  await migrateReactions();
  const db = requireDb();

  // 1) 필명 scope 인가. 다른 scope 의 증명이면 지지(VS-C3a)용을 옮겨 온 것이다.
  if (String(proof.scope) !== PSEUDONYM_SCOPE) {
    return { ok: false, reason: "증명의 용도가 다릅니다" };
  }

  // 2) 시각이 지금과 가까운가. 지나간 증명을 다시 보내 남의 반응을 되돌리는
  //    것을 막는다.
  if (!Number.isInteger(at) || Math.abs(Date.now() - at) > SKEW_MS) {
    return { ok: false, reason: "기기 시계가 서버와 많이 다릅니다. 시간을 맞추고 다시 시도해 주세요." };
  }

  // 3) 증명이 이 카드·이 반응·이 시각을 묶고 있는가. 아니면 다른 카드의
  //    증명을 옮겨 붙인 것이다.
  if (String(proof.message) !== reactionMessage(cardId, kind, at)) {
    return { ok: false, reason: "증명이 이 반응과 맞지 않습니다" };
  }

  // 4) 우리가 아는 회원 명부인가.
  const [known] = await db`
    SELECT 1 FROM anon_roots WHERE root = ${String(proof.merkleTreeRoot)}`;
  if (!known) {
    return { ok: false, reason: "회원 명부가 바뀌었습니다. 새로고침 후 다시 시도해 주세요." };
  }

  // 5) 증명 자체.
  if (!(await verifyProof(proof))) {
    return { ok: false, reason: "증명이 유효하지 않습니다" };
  }

  const pseudonym = String(proof.nullifier);
  const [previous] = await db`
    SELECT kind, updated_at FROM reactions
     WHERE pseudonym = ${pseudonym} AND card_id = ${cardId}`;

  // 앞선 반응보다 나중 것만 받는다. 같은 시각의 재전송은 무시한다.
  if (previous && Number(previous.updated_at) >= at) {
    return { ok: false, reason: "이미 반영된 반응입니다" };
  }

  await db`
    INSERT INTO reactions (pseudonym, card_id, kind, signal, updated_at)
    VALUES (${pseudonym}, ${cardId}, ${kind}, ${signalOf(kind)}, ${at})
    ON CONFLICT (pseudonym, card_id)
    DO UPDATE SET kind = ${kind}, signal = ${signalOf(kind)}, updated_at = ${at}`;

  return { ok: true, changed: Boolean(previous) && previous.kind !== kind };
}

export type Counts = Record<ReactionKind, number>;

const EMPTY: Counts = { LOGICAL: 0, EMPATHY: 0, FACTCHECK: 0, DISAGREE: 0 };

/**
 * 카드별 반응 수.
 *
 * **집계만 돌려줍니다.** 필명도 시각도 담지 않습니다 — 담는 순간 그것이
 * 반응자 목록이 됩니다.
 */
export async function countsFor(cardIds: string[]): Promise<Record<string, Counts>> {
  await migrateReactions();
  if (cardIds.length === 0) return {};
  const db = requireDb();
  const rows = await db`
    SELECT card_id, kind, COUNT(*)::int AS n
      FROM reactions
     WHERE card_id = ANY(${cardIds})
     GROUP BY card_id, kind`;

  const out: Record<string, Counts> = {};
  for (const id of cardIds) out[id] = { ...EMPTY };
  for (const row of rows) {
    const kind = String(row.kind) as ReactionKind;
    if (kind in EMPTY) out[String(row.card_id)][kind] = Number(row.n);
  }
  return out;
}
