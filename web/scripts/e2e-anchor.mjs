/**
 * VS-F6 종단 확인 — 앵커링이 실제로 무엇을 보장하는지 확인한다.
 *
 * 단위 시험과 게이트는 루트 계산이 맞는지만 본다. 이 스크립트는 **실제
 * 경로**를 확인한다 — 배치가 만들어지고, 증명이 루트로 이어지고, **지워진
 * 글도 사본만 있으면 증명된다**는 것.
 *
 * 마지막 항목이 이 슬라이스의 존재 이유다. 서명(VS-A4)은 고친 글을
 * 드러내지만 지운 글은 드러내지 못한다.
 *
 * 돌리는 법 (서버와 Postgres 가 떠 있어야 한다):
 *
 *   docker run -d --rm --name ca-pg -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=civicagora -p 55438:5432 postgres:16-alpine
 *
 *   DATABASE_URL="postgres://postgres:test@127.0.0.1:55438/civicagora?sslmode=disable" \
 *   AUTH_SECRET="0123456789abcdef0123456789abcdef" \
 *   ANCHOR_SECRET="test-anchor-secret" npx next dev -p 3112
 *
 *   E2E_BASE=http://127.0.0.1:3112 DATABASE_URL=... npm run e2e:signing   # 글을 만든다
 *   E2E_BASE=http://127.0.0.1:3112 ANCHOR_SECRET=test-anchor-secret \
 *     DATABASE_URL=... npm run e2e:anchor
 *
 * **달력에 실제로 제출한다.** OpenTimestamps 공개 서비스에 해시 하나를
 * 보내는 것이며 비용은 없다. 시험용 루트가 비트코인에 남는 것이 싫다면
 * SKIP_STAMP=1 로 제출 없이 나머지만 확인할 수 있다.
 *
 * CI 에서 돌리지 않는다. 서버·데이터베이스·외부 네트워크가 필요해 게이트로
 * 두기에는 무겁고, 루트 계산은 check:anchor 가 이미 본다.
 */
import postgres from "postgres";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3112";
const SECRET = process.env.ANCHOR_SECRET ?? "test-anchor-secret";

const { opinionPayload } = await import("../lib/signing.ts");
const { leafHash, merkleProof, merkleApply, toHex } = await import("../lib/merkle.ts");

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 2 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);
const hex = (text) => Uint8Array.from(text.match(/../g).map((h) => Number.parseInt(h, 16)));

// ── 1. 배치를 만든다 ───────────────────────────────────────────────
const built = await fetch(`${BASE}/api/anchor/build`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SECRET}` },
}).then(async (r) => ({ status: r.status, body: await r.json() }));

check("배치가 만들어진다", built.status === 201 && built.body.built, JSON.stringify(built.body));
if (!built.body.built) {
  console.log("  (앵커에 넣을 새 글이 없습니다. e2e:signing 을 먼저 돌리십시오.)");
}

// 잠기지 않은 채로 돌지 않는지.
const unguarded = await fetch(`${BASE}/api/anchor/build`, { method: "POST" });
check("비밀값 없이는 거절한다", unguarded.status === 401);

const batchId = built.body.batchId;

// ── 2. 증명이 루트로 이어진다 ──────────────────────────────────────
if (batchId) {
  const [leafRow] = await db`
    SELECT kind, item_id FROM anchor_leaves WHERE batch_id = ${batchId} ORDER BY position LIMIT 1`;
  const proof = await fetch(
    `${BASE}/api/anchor/proof?kind=${leafRow.kind}&id=${leafRow.item_id}`
  ).then((r) => r.json());

  const rebuilt = toHex(await merkleApply(hex(proof.leaf), proof.steps));
  check("증명이 앵커된 루트로 이어진다", rebuilt === proof.root, `${rebuilt} ≠ ${proof.root}`);

  // 증명을 한 걸음 뒤집으면 깨져야 한다. 늘 통과하는 검증은 검증이 아니다.
  if (proof.steps.length > 0) {
    const tampered = proof.steps.map((s, i) =>
      i === 0 ? { ...s, sibling_is_left: !s.sibling_is_left } : s);
    const wrong = toHex(await merkleApply(hex(proof.leaf), tampered));
    check("뒤집은 증명은 다른 루트를 낸다", wrong !== proof.root);
  }

  // 잎 목록이 공개되어야 제3자가 보관할 수 있다.
  const leaves = await fetch(`${BASE}/api/anchor/batches/${batchId}/leaves`).then((r) => r.json());
  check("잎 목록을 공개한다", Array.isArray(leaves.leaves) && leaves.leaves.length > 0);

  // ── 3. 영수증이 표준 .ots 인가 ───────────────────────────────────
  if (process.env.SKIP_STAMP !== "1") {
    const receipt = await fetch(`${BASE}/api/anchor/batches/${batchId}/receipt`);
    const bytes = new Uint8Array(await receipt.arrayBuffer());
    const MAGIC = "004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294";
    check("영수증이 표준 .ots 머리말로 시작한다",
      receipt.ok && toHex(bytes.slice(0, 31)) === MAGIC);
    // 머리말 다음은 버전(0x01) · 해시 연산(0x08=sha256) · 루트 32바이트.
    check("영수증에 배치의 루트가 들어 있다",
      toHex(bytes.slice(33, 65)) === built.body.root);
  }
}

// ── 4. 지워진 글도 사본만 있으면 증명된다 ──────────────────────────
// 이것이 이 슬라이스의 존재 이유다.
const [card] = await db`SELECT * FROM cards ORDER BY created_at LIMIT 1`;
if (card) {
  const archived = { ...card, created_at: Number(card.created_at) };
  const [row] = await db`
    SELECT * FROM anchor_leaves WHERE kind = 'opinion' AND item_id = ${archived.id}`;

  if (row) {
    // 운영자가 지운다.
    await db`DELETE FROM cards WHERE id = ${archived.id}`;
    const gone = await db`SELECT 1 FROM cards WHERE id = ${archived.id}`;
    check("운영자가 글을 지울 수 있다(막지 못한다)", gone.length === 0);

    // 사본을 가진 사람이 잎을 다시 만든다.
    const leaf = toHex(await leafHash(opinionPayload(archived)));
    check("보관한 사본이 앵커의 잎과 일치한다", leaf === row.leaf);

    const [batch] = await db`SELECT root FROM anchor_batches WHERE id = ${row.batch_id}`;
    const all = await db`
      SELECT leaf FROM anchor_leaves WHERE batch_id = ${row.batch_id} ORDER BY position`;
    const steps = await merkleProof(all.map((l) => hex(l.leaf)), Number(row.position));
    const root = toHex(await merkleApply(hex(leaf), steps));
    check("지워진 글이 앵커된 루트에 있었음을 증명한다", root === batch.root);

    // 되돌려 둔다. 시험이 데이터를 축내면 다시 돌릴 때마다 준비가 필요해진다.
    await db`
      INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                         evidence_url, actionable_solution, author_did, created_at, signature)
      VALUES (${archived.id}, ${archived.policy_id}, ${archived.stance},
              ${archived.problem_definition}, ${archived.evidence_source},
              ${archived.evidence_url}, ${archived.actionable_solution},
              ${archived.author_did}, ${archived.created_at}, ${archived.signature})
      ON CONFLICT (id) DO NOTHING`;
  }
}

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
