/**
 * 여론 지형도 (VS-F4) — 서버 전용.
 *
 * 배치가 계산한 군집과 좌표를 보관하고, **공개해도 되는 것만** 내보냅니다.
 *
 * ## 무엇을 공개하고 무엇을 감추는가
 *
 * | | 공개 |
 * |-|-|
 * | 군집 인원·중심 | 인원 20명 이상인 군집만 (INV-5) |
 * | 점 구름 | 식별자 **없이**. 순서도 섞는다 |
 * | 누구의 점인가 | **공개하지 않음** (INV-2) |
 *
 * 점 구름이 안전한 이유는 개인의 반응 이력이 어디에도 공개되지 않기
 * 때문입니다 — 남의 점을 짚어낼 단서가 없습니다.
 *
 * 내 위치는 영지식 증명으로 본인임을 보인 사람에게만 돌려줍니다. 이 파일
 * 밖(라우트·화면)에서는 필명을 다루지 않습니다 — `check-no-reactor-list.mjs`
 * 가 그것을 지킵니다.
 */
import { requireDb } from "./db.ts";

/** 이 인원 미만의 군집은 요약을 내지 않는다 (INV-5). */
export const MIN_CLUSTER_SIZE = 20;

/** 지형도를 공개할 최소 참여 인원 (INV-5). */
export const MIN_PARTICIPANTS = 50;

export type Cluster = { id: number; size: number; x: number; y: number };
export type PublicMap = {
  ready: boolean;
  reason?: string;
  participants: number;
  k: number;
  silhouette: number;
  clusters: Cluster[];
  /** 식별자 없는 점 구름. [x, y, 군집] */
  points: Array<[number, number, number]>;
  snapshot_hash: string;
  updated_at: number;
};

export async function migrateMap() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS opinion_runs (
      id            BIGSERIAL PRIMARY KEY,
      snapshot_hash TEXT NOT NULL,
      k             INT NOT NULL,
      silhouette    DOUBLE PRECISION NOT NULL,
      participants  INT NOT NULL,
      seed          BIGINT NOT NULL,
      created_at    BIGINT NOT NULL
    )`;
  // 좌표는 사람마다 하나씩 있다. **공개하지 않는다** — 내 위치 조회에만 쓴다.
  await db`
    CREATE TABLE IF NOT EXISTS opinion_positions (
      pseudonym TEXT PRIMARY KEY,
      x         DOUBLE PRECISION NOT NULL,
      y         DOUBLE PRECISION NOT NULL,
      cluster   INT NOT NULL
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS opinion_clusters (
      cluster INT PRIMARY KEY,
      size    INT NOT NULL,
      x       DOUBLE PRECISION NOT NULL,
      y       DOUBLE PRECISION NOT NULL
    )`;
}

type Incoming = {
  snapshot_hash: string;
  k: number;
  silhouette: number;
  participants: number;
  seed: number;
  clusters: Array<{ id: number; size: number; x: number; y: number }>;
  positions: Array<[string, number, number, number]>;
};

/** 배치 결과를 저장한다. 이전 판을 대체한다 — 지형도는 기록이 아니라 현재 모습이다. */
export async function storeMap(incoming: Incoming): Promise<number> {
  await migrateMap();
  const db = requireDb();
  const now = Date.now();

  await db`
    INSERT INTO opinion_runs (snapshot_hash, k, silhouette, participants, seed, created_at)
    VALUES (${incoming.snapshot_hash}, ${incoming.k}, ${incoming.silhouette},
            ${incoming.participants}, ${incoming.seed}, ${now})`;

  // 좌표는 매번 새로 계산되므로 통째로 바꾼다. 남겨 두면 떠난 사람의 옛
  // 위치가 지형도에 계속 찍힌다.
  await db.begin(async (tx) => {
    await tx`TRUNCATE opinion_positions`;
    await tx`TRUNCATE opinion_clusters`;
    if (incoming.positions.length > 0) {
      await tx`
        INSERT INTO opinion_positions ${tx(
          incoming.positions.map(([who, x, y, cluster]) => ({
            pseudonym: who, x, y, cluster,
          })),
          "pseudonym", "x", "y", "cluster"
        )}`;
    }
    if (incoming.clusters.length > 0) {
      await tx`
        INSERT INTO opinion_clusters ${tx(
          incoming.clusters.map((c) => ({ cluster: c.id, size: c.size, x: c.x, y: c.y })),
          "cluster", "size", "x", "y"
        )}`;
    }
  });
  return incoming.positions.length;
}

/**
 * 공개용 지형도.
 *
 * 참여자가 적으면 아예 내보내지 않습니다. 사람이 몇 안 될 때 점 구름은
 * 익명이 아닙니다 — 누가 참여했는지 아는 사람에게는 점이 곧 이름입니다.
 */
export async function publicMap(): Promise<PublicMap> {
  await migrateMap();
  const db = requireDb();

  const [run] = await db`SELECT * FROM opinion_runs ORDER BY id DESC LIMIT 1`;
  const empty: PublicMap = {
    ready: false, participants: 0, k: 0, silhouette: 0,
    clusters: [], points: [], snapshot_hash: "", updated_at: 0,
  };
  if (!run) return { ...empty, reason: "아직 지형도를 만들 만큼 반응이 모이지 않았습니다." };

  const participants = Number(run.participants);
  if (participants < MIN_PARTICIPANTS) {
    return {
      ...empty,
      participants,
      reason: `참여자가 ${MIN_PARTICIPANTS}명을 넘어야 지형도를 공개합니다 (현재 ${participants}명).`,
    };
  }

  const clusters = await db`
    SELECT cluster, size, x, y FROM opinion_clusters
     WHERE size >= ${MIN_CLUSTER_SIZE} ORDER BY cluster`;
  // 필명은 고르지 않는다. 좌표와 군집만 가져와 섞는다.
  const rows = await db`
    SELECT x, y, cluster FROM opinion_positions ORDER BY random()`;

  return {
    ready: true,
    participants,
    k: Number(run.k),
    silhouette: Number(run.silhouette),
    clusters: clusters.map((c) => ({
      id: Number(c.cluster), size: Number(c.size),
      x: Number(c.x), y: Number(c.y),
    })),
    points: rows.map((r) => [Number(r.x), Number(r.y), Number(r.cluster)]),
    snapshot_hash: String(run.snapshot_hash),
    updated_at: Number(run.created_at),
  };
}

/**
 * 한 사람의 위치.
 *
 * **본인임을 영지식 증명으로 보인 뒤에만** 부릅니다. 이 함수를 인증 없이
 * 부르는 경로를 만들면 그 순간 "타인의 위치 조회"가 됩니다.
 */
export async function positionOf(who: string): Promise<{ x: number; y: number; cluster: number } | null> {
  await migrateMap();
  const db = requireDb();
  const [row] = await db`
    SELECT x, y, cluster FROM opinion_positions WHERE pseudonym = ${who}`;
  if (!row) return null;
  return { x: Number(row.x), y: Number(row.y), cluster: Number(row.cluster) };
}
