/**
 * 앵커링 (VS-F6) — 서버 전용.
 *
 * 서명(VS-A4)은 **고친 글**을 드러냅니다. 지운 글은 드러내지 못합니다 —
 * 대조할 대상이 사라지기 때문입니다. 앵커링이 그 자리를 메웁니다.
 *
 * 아직 앵커에 넣지 않은 글을 모아 머클 트리로 묶고, **루트 하나**를 외부의
 * 바꿀 수 없는 기록에 남깁니다. 나중에 운영자가 글을 지우면, 그 글을 가진
 * 누구나 증명을 들고 와 "이 글이 그때 루트에 들어 있었다"를 보일 수 있습니다.
 *
 * ## 왜 OpenTimestamps 인가
 *
 * 계획서(`docs/16_ONCHAIN_PLAN.md`)는 EVM L2 를 적었습니다. 그런데 그 길은
 * 지금 막혀 있습니다 — **체인이 아직 선정되지 않았고**(`08_DECISIONS.md`
 * 미결), 지갑과 가스비가 필요합니다. 쓸 수 없는 경로를 만들어 두는 것보다
 * 도는 것을 만드는 편이 낫습니다.
 *
 * OpenTimestamps 는 해시를 모아 **비트코인**에 커밋하는 공개 서비스입니다.
 *
 * - 지갑도 개인키도 필요 없습니다. 해시만 보냅니다
 * - 비용이 0원입니다
 * - 영수증이 **표준 `.ots` 파일**이라 공식 도구로 검증됩니다. 우리 코드를
 *   믿지 않아도 됩니다 — 그것이 핵심입니다
 *
 * EVM 앵커링을 나중에 더할 수 있도록 배치 표에 자리를 비워 두었습니다
 * (`chain_tx`). 둘은 배타적이지 않습니다.
 *
 * ## 이것이 막지 못하는 것
 *
 * 앵커는 **루트가 그때 존재했다**만 말합니다. 운영자가 글을 지우면서 잎 목록도
 * 함께 지우면, 남의 손에 사본이 없는 한 아무도 그 글을 복원해 증명할 수
 * 없습니다. 앵커링은 삭제를 **막지** 않고 **드러냅니다** — 그것도 사본을 가진
 * 사람이 있을 때만입니다. 진짜 해결은 P2P(Stack B)입니다.
 */
import { requireDb } from "./db.ts";
import { leafHash, merkleProof, merkleRoot, toHex, type MerkleStep } from "./merkle.ts";
import { groupPayload, opinionPayload, policyPayload } from "./signing.ts";
import { currentRoot, migrateAnon } from "./anon.ts";

/**
 * 표준 `.ots` 파일 머리말.
 *
 * `\x00OpenTimestamps\x00\x00Proof\x00` + 마법수 8바이트.
 */
const OTS_MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d,
  0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2,
  0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
const OTS_VERSION = 0x01;
const OTS_OP_SHA256 = 0x08;

/**
 * 제출할 달력.
 *
 * 둘 이상에 내는 이유는 한 곳이 사라져도 증명이 남게 하기 위해서입니다.
 * 각 영수증은 따로 보관합니다 — 하나로 합치려면 타임스탬프 트리를 병합해야
 * 하는데, 그 코드를 직접 쓰면 표준 도구로 검증되지 않을 위험이 있습니다.
 */
const CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org"];

export type BatchRow = {
  id: number;
  root: string;
  leaf_count: number;
  period_start: number;
  period_end: number;
  created_at: number;
  ots_status: string;
};

export async function migrateAnchor() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS anchor_batches (
      id           BIGSERIAL PRIMARY KEY,
      root         TEXT NOT NULL,
      leaf_count   INT NOT NULL,
      period_start BIGINT NOT NULL,
      period_end   BIGINT NOT NULL,
      created_at   BIGINT NOT NULL,
      ots_status   TEXT NOT NULL DEFAULT 'pending',
      ots_error    TEXT,
      chain_tx     TEXT
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS anchor_receipts (
      batch_id  BIGINT NOT NULL REFERENCES anchor_batches(id),
      calendar  TEXT NOT NULL,
      receipt   TEXT NOT NULL,
      PRIMARY KEY (batch_id, calendar)
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS anchor_leaves (
      batch_id BIGINT NOT NULL REFERENCES anchor_batches(id),
      position INT NOT NULL,
      kind     TEXT NOT NULL,
      item_id  TEXT NOT NULL,
      leaf     TEXT NOT NULL,
      PRIMARY KEY (batch_id, position)
    )`;
  // 한 글이 두 배치에 들어가면 어느 루트가 맞는지 알 수 없다.
  await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_item ON anchor_leaves (kind, item_id)`;
}

type Candidate = { kind: "policy" | "opinion" | "group"; id: string; leaf: Uint8Array; created_at: number };

/**
 * 아직 앵커에 들어가지 않은 글을 모읍니다.
 *
 * 기간으로 자르지 않고 **아직 들어가지 않은 것**으로 고릅니다. 기기 시계가
 * 조금 뒤처진 글이 늦게 도착해도 빠뜨리지 않기 위해서입니다.
 *
 * 순서는 작성 시각 오름차순, 같으면 식별자순입니다. 순서가 증명의 일부이므로
 * 규칙이 필요하고, 그 규칙은 다시 계산할 수 있어야 합니다.
 */
async function pending(): Promise<Candidate[]> {
  const db = requireDb();
  const policies = await db`
    SELECT p.* FROM policies p
     WHERE NOT EXISTS (
       SELECT 1 FROM anchor_leaves a WHERE a.kind = 'policy' AND a.item_id = p.id)`;
  const cards = await db`
    SELECT c.* FROM cards c
     WHERE NOT EXISTS (
       SELECT 1 FROM anchor_leaves a WHERE a.kind = 'opinion' AND a.item_id = c.id)`;

  // 필드를 하나씩 적는다. 행을 통째로 넘기면 열이 하나 빠져도 타입이
  // 넘어가고, 그러면 잎 해시가 조용히 달라진다 — 앵커가 가리키는 것이
  // 화면에 보이는 글과 다른 상태가 된다.
  const text = (value: unknown) => String(value ?? "");
  const out: Candidate[] = [];

  for (const row of policies) {
    const created_at = Number(row.created_at);
    out.push({
      kind: "policy",
      id: text(row.id),
      created_at,
      leaf: await leafHash(policyPayload({
        author_did: text(row.author_did),
        created_at,
        title: text(row.title),
        category: text(row.category),
        background: text(row.background),
        core_question: text(row.core_question),
        official_source_url: text(row.official_source_url),
        target_agency: row.target_agency == null ? null : text(row.target_agency),
      })),
    });
  }

  for (const row of cards) {
    const created_at = Number(row.created_at);
    out.push({
      kind: "opinion",
      id: text(row.id),
      created_at,
      leaf: await leafHash(opinionPayload({
        policy_id: text(row.policy_id),
        author_did: text(row.author_did),
        created_at,
        stance: text(row.stance),
        problem_definition: text(row.problem_definition),
        evidence_source: text(row.evidence_source),
        evidence_url: text(row.evidence_url),
        actionable_solution: text(row.actionable_solution),
      })),
    });
  }
  // 익명 회원 명부의 루트도 함께 묶는다 (VS-C3a). 명부가 그때 어떤 모습이었는지
  // 남지 않으면, 운영자가 나중에 가짜 회원을 끼워 넣어도 드러나지 않는다.
  // 루트가 지난번과 같으면 (kind, item_id) 유일 색인이 걸러 준다.
  await migrateAnon();
  const group = await currentRoot();
  if (group) {
    const [seen] = await db`
      SELECT 1 FROM anchor_leaves WHERE kind = 'group' AND item_id = ${group.root}`;
    if (!seen) {
      out.push({
        kind: "group",
        id: group.root,
        created_at: Date.now(),
        leaf: await leafHash(groupPayload(group.root)),
      });
    }
  }

  out.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** 달력에 루트를 내고 표준 `.ots` 바이트를 만듭니다. */
async function stamp(root: Uint8Array, calendar: string): Promise<Uint8Array> {
  const response = await fetch(`${calendar}/digest`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: root as BufferSource,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${calendar} 가 ${response.status} 를 돌려주었습니다`);
  const timestamp = new Uint8Array(await response.arrayBuffer());

  const file = new Uint8Array(OTS_MAGIC.length + 2 + root.length + timestamp.length);
  file.set(OTS_MAGIC, 0);
  file[OTS_MAGIC.length] = OTS_VERSION;
  file[OTS_MAGIC.length + 1] = OTS_OP_SHA256;
  file.set(root, OTS_MAGIC.length + 2);
  file.set(timestamp, OTS_MAGIC.length + 2 + root.length);
  return file;
}

export type BuildResult =
  | { built: false; reason: string }
  | { built: true; batchId: number; root: string; leafCount: number; receipts: string[]; errors: string[] };

/**
 * 배치를 만들고 앵커에 냅니다.
 *
 * 달력 제출이 모두 실패해도 배치는 남깁니다. 루트와 잎 목록이 있으면 나중에
 * 다시 낼 수 있고, 그때 증명하려는 대상은 같기 때문입니다.
 */
export async function buildBatch(): Promise<BuildResult> {
  await migrateAnchor();
  const db = requireDb();

  const items = await pending();
  if (items.length === 0) return { built: false, reason: "앵커에 넣을 새 글이 없습니다" };

  const root = await merkleRoot(items.map((i) => i.leaf));
  const rootHex = toHex(root);
  const now = Date.now();

  const [batch] = await db`
    INSERT INTO anchor_batches (root, leaf_count, period_start, period_end, created_at)
    VALUES (${rootHex}, ${items.length}, ${items[0].created_at},
            ${items[items.length - 1].created_at}, ${now})
    RETURNING id`;
  const batchId = Number(batch.id);

  // 잎은 한 번에 넣는다. 한 건씩 넣으면 왕복이 잎 수만큼 늘어난다.
  await db`
    INSERT INTO anchor_leaves ${db(
      items.map((item, position) => ({
        batch_id: batchId,
        position,
        kind: item.kind,
        item_id: item.id,
        leaf: toHex(item.leaf),
      })),
      "batch_id", "position", "kind", "item_id", "leaf"
    )}`;

  const receipts: string[] = [];
  const errors: string[] = [];
  for (const calendar of CALENDARS) {
    try {
      const file = await stamp(root, calendar);
      await db`
        INSERT INTO anchor_receipts (batch_id, calendar, receipt)
        VALUES (${batchId}, ${calendar}, ${Buffer.from(file).toString("base64")})
        ON CONFLICT DO NOTHING`;
      receipts.push(calendar);
    } catch (error) {
      errors.push(`${calendar}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await db`
    UPDATE anchor_batches
       SET ots_status = ${receipts.length > 0 ? "stamped" : "failed"},
           ots_error  = ${errors.length > 0 ? errors.join(" / ") : null}
     WHERE id = ${batchId}`;

  return { built: true, batchId, root: rootHex, leafCount: items.length, receipts, errors };
}

export type Proof = {
  batch_id: number;
  root: string;
  leaf: string;
  index: number;
  leaf_count: number;
  anchored_at: number;
  ots_status: string;
  calendars: string[];
  steps: MerkleStep[];
};

/** 한 글의 증명을 만듭니다. 아직 배치에 들어가지 않았으면 null. */
export async function proofFor(kind: "policy" | "opinion", id: string): Promise<Proof | null> {
  await migrateAnchor();
  const db = requireDb();

  const [row] = await db`
    SELECT batch_id, position, leaf FROM anchor_leaves
     WHERE kind = ${kind} AND item_id = ${id}`;
  if (!row) return null;

  const batchId = Number(row.batch_id);
  const [batch] = await db`SELECT * FROM anchor_batches WHERE id = ${batchId}`;
  const leaves = await db`
    SELECT leaf FROM anchor_leaves WHERE batch_id = ${batchId} ORDER BY position`;
  const calendars = await db`
    SELECT calendar FROM anchor_receipts WHERE batch_id = ${batchId} ORDER BY calendar`;

  const steps = await merkleProof(
    leaves.map((l) => hexToBytes(l.leaf as string)),
    Number(row.position)
  );

  return {
    batch_id: batchId,
    root: batch.root as string,
    leaf: row.leaf as string,
    index: Number(row.position),
    leaf_count: Number(batch.leaf_count),
    anchored_at: Number(batch.created_at),
    ots_status: batch.ots_status as string,
    calendars: calendars.map((c) => c.calendar as string),
    steps,
  };
}

function hexToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
