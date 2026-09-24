/**
 * VS-D2 종단 확인 — 반응 4종.
 *
 * 확인하려는 것:
 *   1. 반응이 집계된다
 *   2. **바꿀 수 있다** (명세 §5)
 *   3. 지나간 증명을 다시 보내 남의 반응을 되돌릴 수 없다  ← 재전송 방어
 *   4. 다른 카드의 증명을 옮겨 붙일 수 없다
 *   5. 사람이 다르면 따로 센다
 *   6. 집계 응답에 필명이 없다
 *
 * 3번이 미묘하다. 반응은 바꿀 수 있어야 하므로 덮어쓰기가 허용되는데, 그
 * 틈으로 남의 옛 증명을 다시 보내면 되돌릴 수 있다. 증명이 시각을 묶고
 * 서버가 앞선 시각을 거부해서 막는다.
 */
import postgres from "postgres";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3114";
const ART = { wasm: "public/semaphore/semaphore-16.wasm", zkey: "public/semaphore/semaphore-16.zkey" };
const DEPTH = 16;

const { PSEUDONYM_SCOPE, reactionMessage } = await import("../lib/scope.ts");
const { join } = await import("../lib/anon.ts");

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

const 갑 = new Identity("반응 갑 " + Date.now());
const 을 = new Identity("반응 을 " + Date.now());
for (const who of [갑, 을]) await join(who.commitment.toString());

const commitments = (await fetch(`${BASE}/api/anon/group`).then((r) => r.json())).commitments;
const group = new Group(commitments.map(BigInt));

const cards = await db`SELECT id FROM cards ORDER BY created_at LIMIT 2`;
if (cards.length < 2) { console.error("의견이 두 개 이상 필요합니다."); process.exit(2); }
const [카드1, 카드2] = cards.map((r) => String(r.id));

async function proofFor(who, cardId, kind, at) {
  return generateProof(who, group, BigInt(reactionMessage(cardId, kind, at)),
                       BigInt(PSEUDONYM_SCOPE), DEPTH, ART);
}
const post = (cardId, body) => fetch(`${BASE}/api/cards/${cardId}/react`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const counts = async (cardId) => {
  const rows = await db`SELECT kind, COUNT(*)::int n FROM reactions WHERE card_id = ${cardId} GROUP BY kind`;
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
};

// ── 1. 반응이 집계된다 ─────────────────────────────────────────────
const t1 = Date.now();
const 첫반응 = await post(카드1, { kind: "LOGICAL", at: t1, proof: await proofFor(갑, 카드1, "LOGICAL", t1) });
check("반응이 남는다", 첫반응.status === 201, JSON.stringify(첫반응.body));
check("집계에 잡힌다", (await counts(카드1)).LOGICAL === 1);

// ── 2. 바꿀 수 있다 ────────────────────────────────────────────────
const t2 = t1 + 1000;
const 바꿈 = await post(카드1, { kind: "DISAGREE", at: t2, proof: await proofFor(갑, 카드1, "DISAGREE", t2) });
check("반응을 바꿀 수 있다", 바꿈.status === 201 && 바꿈.body.changed === true, JSON.stringify(바꿈.body));
const 바꾼뒤 = await counts(카드1);
check("바꾸면 이전 것이 사라진다", !바꾼뒤.LOGICAL && 바꾼뒤.DISAGREE === 1, JSON.stringify(바꾼뒤));

// ── 3. 지나간 증명 재전송은 막힌다 ─────────────────────────────────
const 되돌리기 = await post(카드1, { kind: "LOGICAL", at: t1, proof: await proofFor(갑, 카드1, "LOGICAL", t1) });
check("옛 증명으로 되돌릴 수 없다", 되돌리기.status === 400, JSON.stringify(되돌리기.body));
check("되돌리기 시도 뒤에도 그대로다", (await counts(카드1)).DISAGREE === 1);

// ── 4. 다른 카드로 옮겨 붙일 수 없다 ───────────────────────────────
const t3 = Date.now();
const 옮김 = await post(카드2, { kind: "EMPATHY", at: t3, proof: await proofFor(갑, 카드1, "EMPATHY", t3) });
check("다른 카드의 증명은 거절된다", 옮김.status === 400, JSON.stringify(옮김.body));

// 종류만 바꿔 보내는 것도 막혀야 한다.
const 종류바꿔 = await post(카드2, { kind: "LOGICAL", at: t3, proof: await proofFor(갑, 카드2, "EMPATHY", t3) });
check("증명과 다른 종류는 거절된다", 종류바꿔.status === 400, JSON.stringify(종류바꿔.body));

// ── 5. 사람이 다르면 따로 센다 ─────────────────────────────────────
const t4 = Date.now();
const 을반응 = await post(카드1, { kind: "LOGICAL", at: t4, proof: await proofFor(을, 카드1, "LOGICAL", t4) });
check("다른 사람은 따로 센다", 을반응.status === 201, JSON.stringify(을반응.body));
const 둘다 = await counts(카드1);
check("둘의 반응이 모두 남는다", 둘다.DISAGREE === 1 && 둘다.LOGICAL === 1, JSON.stringify(둘다));

// 같은 사람의 필명은 카드가 달라도 같아야 한다 — 브리징 행렬의 전제.
const rows = await db`SELECT DISTINCT pseudonym FROM reactions WHERE card_id IN (${카드1}, ${카드2})`;
check("한 사람의 필명이 카드 간에 같다", rows.length === 2, `서로 다른 필명 ${rows.length}개`);

// ── 6. 집계 응답에 필명이 없다 ─────────────────────────────────────
const page = await fetch(`${BASE}/policies/${(await db`SELECT policy_id FROM cards WHERE id = ${카드1}`)[0].policy_id}`)
  .then((r) => r.text());
const 필명들 = rows.map((r) => String(r.pseudonym));
check("화면에 필명이 실리지 않는다", !필명들.some((p) => page.includes(p)));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
