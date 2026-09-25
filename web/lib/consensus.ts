/**
 * 합의 배너 (VS-F5) — 서버 전용.
 *
 * 군집 **모두**에서 60% 이상 찬성받은 `ALTERNATIVE` 카드를 가운데 열
 * 최상단으로 올립니다(`docs/03_ALGORITHMS_AI.md` §2.2).
 *
 *     Consensus(i) = min over clusters ( 찬성 수 / 군집 인원 ) ≥ 0.60
 *
 * ## 군집이 둘 미만이면 합의가 아니다
 *
 * 한 군집만 있는 상태에서 "모든 군집이 찬성했다"는 말은 "그 한 무리가
 * 찬성했다"와 같습니다. 그것은 진영을 넘은 합의가 아니라 그냥 다수결이고,
 * 이 플랫폼이 굳이 만들지 않아도 세상에 널려 있는 것입니다.
 *
 * ## 인원 20명 미만 군집은 빠진다 (INV-5)
 *
 * 몇 명의 찬성률은 찬성률이 아니라 잡음입니다. 배치에서 이미 걸러 보내므로
 * 여기 저장된 값은 모두 20명 이상 군집의 것입니다.
 *
 * ## 두 관문
 *
 * | 관문 | 기준 | 쓰임 |
 * |-|-|-|
 * | 1차 (여기) | 모든 군집 ≥ 0.60 | 가운데 열 상단 배너 |
 * | 2차 (H1) | 모든 군집 ≥ 0.65 **이며** 격차 ≤ 5%p | 대정부 브리프 수록 |
 *
 * 2차가 더 엄격한 이유는 외부 기관에 나가는 문서의 무게 때문입니다.
 */
import { requireDb } from "./db.ts";

/** 1차 관문 — 합의 배너 승격. */
export const BANNER_THRESHOLD = 0.6;

/** 2차 관문 — 대정부 브리프 수록. 판정은 H1 에서 한다. */
export const BRIEF_THRESHOLD = 0.65;
export const BRIEF_MAX_GAP = 0.05;

export type ClusterRate = { cluster: number; rate: number };

export async function migrateConsensus() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS card_consensus (
      card_id       TEXT NOT NULL,
      cluster       INT NOT NULL,
      rate          DOUBLE PRECISION NOT NULL,
      snapshot_hash TEXT NOT NULL,
      updated_at    BIGINT NOT NULL,
      PRIMARY KEY (card_id, cluster)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_consensus_card ON card_consensus (card_id)`;
}

/** 배치가 낸 군집별 찬성률을 저장한다. 이전 판을 대체한다. */
export async function storeRates(
  snapshotHash: string,
  rates: Array<{ card_id: string; cluster: number; rate: number }>
): Promise<number> {
  await migrateConsensus();
  const db = requireDb();
  const now = Date.now();

  await db.begin(async (tx) => {
    // 군집 번호가 바뀌면 옛 값이 남아 엉뚱한 합의를 만든다. 통째로 바꾼다.
    await tx`TRUNCATE card_consensus`;
    if (rates.length > 0) {
      await tx`
        INSERT INTO card_consensus ${tx(
          rates.map((r) => ({
            card_id: r.card_id, cluster: r.cluster, rate: r.rate,
            snapshot_hash: snapshotHash, updated_at: now,
          })),
          "card_id", "cluster", "rate", "snapshot_hash", "updated_at"
        )}`;
    }
  });
  return rates.length;
}

/** 카드별 군집 찬성률. 값이 없는 카드는 들어 있지 않다. */
export async function ratesFor(cardIds: string[]): Promise<Record<string, ClusterRate[]>> {
  await migrateConsensus();
  const out: Record<string, ClusterRate[]> = {};
  if (cardIds.length === 0) return out;

  const db = requireDb();
  const rows = await db`
    SELECT card_id, cluster, rate FROM card_consensus
     WHERE card_id = ANY(${cardIds}) ORDER BY card_id, cluster`;
  for (const row of rows) {
    (out[String(row.card_id)] ??= []).push({
      cluster: Number(row.cluster), rate: Number(row.rate),
    });
  }
  return out;
}

/**
 * 1차 관문을 통과했는가.
 *
 * 군집이 둘 미만이면 통과시키지 않습니다 — 위의 설명을 보십시오.
 */
export function qualifies(rates: ClusterRate[], threshold = BANNER_THRESHOLD): boolean {
  if (rates.length < 2) return false;
  return Math.min(...rates.map((r) => r.rate)) >= threshold;
}

/**
 * 배너로 올릴 카드 하나를 고른다.
 *
 * 여럿이면 **가장 낮은 군집의 찬성률이 높은** 것을 고릅니다. 평균이 아니라
 * 최솟값으로 고르는 이유는, 이 배너가 말하는 것이 "평균적으로 인기 있다"가
 * 아니라 **"어느 진영에서도 버림받지 않았다"** 이기 때문입니다.
 */
export function pickBanner<T extends { id: string }>(
  cards: T[],
  rates: Record<string, ClusterRate[]>
): { card: T; rates: ClusterRate[] } | null {
  const passing = cards
    .map((card) => ({ card, rates: rates[card.id] ?? [] }))
    .filter((entry) => qualifies(entry.rates));
  if (passing.length === 0) return null;

  passing.sort((a, b) =>
    Math.min(...b.rates.map((r) => r.rate)) - Math.min(...a.rates.map((r) => r.rate)));
  return passing[0];
}
