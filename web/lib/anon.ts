/**
 * 익명 회원권과 1인 1표 (VS-C3a) — 서버 전용.
 *
 * ## 무엇을 푸는가
 *
 * 한 사람이 기기를 최대 5대까지 등록할 수 있습니다(D21). 반응·투표를 DID 로
 * 세면 **한 사람이 다섯 몫**을 행사합니다. 그렇다고 사람 식별자로 세면 누가
 * 무엇에 반응했는지가 서버에 남습니다.
 *
 * Semaphore 가 둘 다 풉니다. 회원은 그룹에 **커밋먼트**만 남기고, 행동할 때는
 * "나는 이 그룹의 누군가다"라는 영지식 증명과 함께 `nullifier` 를 냅니다.
 *
 *     nullifier = Poseidon(비밀, scope)
 *
 * 같은 사람이 같은 scope 로 두 번 하면 nullifier 가 같으므로 **두 번째를 막을
 * 수 있고**, scope 가 다르면 nullifier 가 달라 **주제 간에 엮을 수 없습니다.**
 * 서버는 어느 회원인지 끝내 알지 못합니다.
 *
 * ## 자체 세리머니를 하지 않습니다
 *
 * 아티팩트는 2024-07-13 에 400명 이상이 참여해 끝난 Semaphore V4 세리머니의
 * 결과물입니다. 소규모 팀이 직접 세리머니를 하면 "우리는 부산물을 폐기했다"는
 * 주장을 시민에게 믿으라고 요구하게 되는데, 운영자를 믿지 않는 것이 이
 * 플랫폼의 존재 이유이므로 자기모순입니다 (→ `docs/12_ONCHAIN_DEPENDENCIES.md` §2).
 *
 * 아티팩트는 저장소에 고정하고 해시를 대조합니다. 런타임 다운로드 경로를
 * 두지 않습니다 — 그러면 CDN 이 멈출 때 투표가 전면 중단되고, CDN 이 바뀐
 * 아티팩트를 주어도 우리가 모릅니다.
 *
 * ## 체인을 쓰지 않습니다
 *
 * Semaphore 는 온체인 검증기도 제공하지만, 증명 검증 자체는 오프체인에서
 * 됩니다. 온체인이 주는 값어치는 **그룹 루트를 누구나 확인할 수 있다**는
 * 것인데, 그 자리는 이미 만들어 둔 앵커링(VS-F6)이 대신합니다 — 그룹 루트를
 * 배치에 실어 비트코인에 남깁니다.
 *
 * 남은 한계는 정직하게 적습니다. **가입 순간 서버는 이메일과 커밋먼트를 함께
 * 봅니다.** 저장하지 않을 뿐입니다. 이 마지막 연결을 끊는 것이 ZK-Email
 * (VS-C3b)이고, 그것은 DKIM 셀렉터 확보와 체인 선정이 먼저입니다.
 */
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { Group } from "@semaphore-protocol/group";
import { requireDb } from "./db.ts";

/** 아티팩트를 만든 트리 깊이. 최대 65,536명. */
export const TREE_DEPTH = 16;

/**
 * 받아 줄 그룹 루트의 보관 기간.
 *
 * 회원이 새로 들어오면 루트가 바뀝니다. 증명을 만드는 동안 누군가 가입하면
 * 클라이언트가 본 루트와 지금 루트가 달라지므로, 최근 루트도 받아 줍니다.
 * 너무 길게 잡으면 탈퇴 처리를 못 하게 되지만 우리는 탈퇴가 없습니다.
 */
const ROOT_GRACE_MS = 24 * 60 * 60 * 1000;

export async function migrateAnon() {
  const db = requireDb();
  await db`
    CREATE TABLE IF NOT EXISTS anon_members (
      commitment   TEXT PRIMARY KEY,
      joined_on    DATE NOT NULL
    )`;
  // 루트 이력. 증명이 어느 시점의 그룹을 가리키는지 확인하는 데 쓴다.
  await db`
    CREATE TABLE IF NOT EXISTS anon_roots (
      root        TEXT PRIMARY KEY,
      member_count INT NOT NULL,
      created_at  BIGINT NOT NULL
    )`;
  // 쓴 nullifier. 같은 사람이 같은 scope 로 두 번 하는 것을 막는다.
  await db`
    CREATE TABLE IF NOT EXISTS anon_actions (
      nullifier  TEXT PRIMARY KEY,
      scope      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_anon_scope ON anon_actions (scope)`;
}

/** 그룹에 든 모든 커밋먼트. 공개한다 — 누구나 루트를 다시 계산할 수 있어야 한다. */
export async function commitments(): Promise<string[]> {
  const db = requireDb();
  const rows = await db`SELECT commitment FROM anon_members ORDER BY commitment`;
  return rows.map((r) => String(r.commitment));
}

/** 지금 그룹의 루트. 회원이 없으면 null. */
export async function currentRoot(): Promise<{ root: string; count: number } | null> {
  const all = await commitments();
  if (all.length === 0) return null;
  const group = new Group(all.map(BigInt));
  return { root: group.root.toString(), count: all.length };
}

/**
 * 커밋먼트를 그룹에 넣는다.
 *
 * 이미 있으면 아무 일도 하지 않는다 — 같은 복구 문구를 다른 기기에서 넣으면
 * 같은 커밋먼트가 나오고, 그것이 여러 기기를 쓰면서도 한 몫만 갖는 방법이다.
 */
export async function join(commitment: string): Promise<{ added: boolean; root: string; count: number }> {
  await migrateAnon();
  const db = requireDb();

  if (!/^[0-9]{1,80}$/.test(commitment)) {
    throw new Error("커밋먼트 형식이 올바르지 않습니다");
  }

  const [existing] = await db`SELECT 1 FROM anon_members WHERE commitment = ${commitment}`;
  if (!existing) {
    const all = await commitments();
    if (all.length >= 2 ** TREE_DEPTH) {
      throw new Error("그룹이 가득 찼습니다. 트리 깊이를 늘려야 합니다.");
    }
    await db`
      INSERT INTO anon_members (commitment, joined_on)
      VALUES (${commitment}, CURRENT_DATE) ON CONFLICT DO NOTHING`;
  }

  const now = await currentRoot();
  if (!now) throw new Error("그룹을 만들지 못했습니다");
  await db`
    INSERT INTO anon_roots (root, member_count, created_at)
    VALUES (${now.root}, ${now.count}, ${Date.now()}) ON CONFLICT DO NOTHING`;

  return { added: !existing, root: now.root, count: now.count };
}

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: "already" | "unknown_root" | "invalid" | "scope"; message: string };

/**
 * 익명 행동 하나를 받는다.
 *
 * 검증 순서가 중요하다. 증명을 확인하기 **전에** nullifier 를 기록하면 가짜
 * 증명으로 남의 nullifier 를 태워 버릴 수 있다. 확인이 먼저다.
 */
export async function act(proof: SemaphoreProof, expectedScope: string): Promise<ActionResult> {
  await migrateAnon();
  const db = requireDb();

  // 1) scope 가 우리가 기대한 것인가. 아니면 다른 곳의 증명을 옮겨 붙인 것이다.
  if (String(proof.scope) !== expectedScope) {
    return { ok: false, reason: "scope", message: "증명이 다른 대상의 것입니다" };
  }

  // 2) 루트가 우리가 아는 그룹인가. 임의의 그룹을 만들어 오면 회원이 아니다.
  const [known] = await db`
    SELECT created_at FROM anon_roots WHERE root = ${String(proof.merkleTreeRoot)}`;
  if (!known) {
    return { ok: false, reason: "unknown_root", message: "회원 명부가 바뀌었습니다. 새로고침 후 다시 시도해 주세요." };
  }
  if (Date.now() - Number(known.created_at) > ROOT_GRACE_MS) {
    return { ok: false, reason: "unknown_root", message: "오래된 회원 명부입니다. 새로고침 후 다시 시도해 주세요." };
  }

  // 3) 증명 자체.
  if (!(await verifyProof(proof))) {
    return { ok: false, reason: "invalid", message: "증명이 유효하지 않습니다" };
  }

  // 4) 쓴 적 없는 nullifier 인가. 경쟁을 막으려 삽입으로 판정한다 —
  //    먼저 읽고 나중에 쓰면 동시에 두 번 눌렀을 때 둘 다 통과한다.
  const inserted = await db`
    INSERT INTO anon_actions (nullifier, scope, message, created_at)
    VALUES (${String(proof.nullifier)}, ${expectedScope}, ${String(proof.message)}, ${Date.now()})
    ON CONFLICT (nullifier) DO NOTHING
    RETURNING nullifier`;
  if (inserted.length === 0) {
    return { ok: false, reason: "already", message: "이미 참여하셨습니다" };
  }
  return { ok: true };
}

/** 한 대상에 모인 익명 행동 수. */
export async function countFor(scope: string): Promise<number> {
  await migrateAnon();
  const db = requireDb();
  const [row] = await db`SELECT COUNT(*)::int AS n FROM anon_actions WHERE scope = ${scope}`;
  return Number(row?.n ?? 0);
}
