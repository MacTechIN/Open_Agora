/**
 * VS-C3a 종단 확인 — 익명 회원권과 1인 1표.
 *
 * 확인하려는 것은 넷이다.
 *
 *   1. 회원은 익명으로 참여할 수 있다
 *   2. 같은 사람은 같은 주제에 두 번 참여할 수 없다   ← 1인 1표
 *   3. 다른 주제에서는 엮이지 않는다                  ← 주제 간 비연결
 *   4. 그룹 밖 사람은 참여할 수 없다
 *
 * 2번과 3번이 이 슬라이스의 존재 이유다. 기기 DID 로 세면 한 사람이 다섯
 * 몫을 갖고(D21), 사람 식별자로 세면 누가 무엇에 반응했는지가 서버에 남는다.
 *
 *   docker run -d --rm --name ca-pg -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=civicagora -p 55441:5432 postgres:16-alpine
 *   DATABASE_URL=... AUTH_SECRET=... npx next dev -p 3113
 *   E2E_BASE=http://127.0.0.1:3113 DATABASE_URL=... npm run e2e:anon
 */
import postgres from "postgres";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3113";
const ART = { wasm: "public/semaphore/semaphore-16.wasm", zkey: "public/semaphore/semaphore-16.zkey" };
const DEPTH = 16;

const { hashScopeServer } = await import("../lib/scope.ts");

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

// ── 준비: 회원 둘과 주제 둘 ────────────────────────────────────────
const 회원가 = new Identity("문구 가 " + Date.now());
const 회원나 = new Identity("문구 나 " + Date.now());
const 외부인 = new Identity("문구 밖 " + Date.now());

await db`CREATE TABLE IF NOT EXISTS anon_members (commitment TEXT PRIMARY KEY, joined_on DATE NOT NULL)`;
for (const who of [회원가, 회원나]) {
  await db`INSERT INTO anon_members (commitment, joined_on)
           VALUES (${who.commitment.toString()}, CURRENT_DATE) ON CONFLICT DO NOTHING`;
}

const policies = await db`SELECT id FROM policies ORDER BY created_at LIMIT 2`;
if (policies.length < 2) {
  console.error("주제가 두 개 이상 필요합니다. e2e:signing 을 먼저 돌리십시오.");
  process.exit(2);
}
const [주제1, 주제2] = policies.map((r) => String(r.id));

// 서버가 지금 명부의 루트를 기록하도록 한 번 읽는다.
const group0 = await fetch(`${BASE}/api/anon/group`).then((r) => r.json());
check("명부를 공개한다", Array.isArray(group0.commitments) && group0.commitments.length >= 2);

// 서버의 루트 이력에 현재 루트를 넣는다(가입 경로가 하는 일).
const { join } = await import("../lib/anon.ts");
for (const who of [회원가, 회원나]) await join(who.commitment.toString());

const commitments = (await fetch(`${BASE}/api/anon/group`).then((r) => r.json())).commitments;
const group = new Group(commitments.map(BigInt));

async function endorse(identity, policyId) {
  const proof = await generateProof(identity, group, 1n, BigInt(hashScopeServer(policyId)), DEPTH, ART);
  const response = await fetch(`${BASE}/api/policies/${policyId}/endorse`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proof),
  });
  return { status: response.status, body: await response.json(), nullifier: proof.nullifier };
}

// ── 1. 회원은 참여할 수 있다 ───────────────────────────────────────
const 가1 = await endorse(회원가, 주제1);
check("회원이 익명으로 지지한다", 가1.status === 201, JSON.stringify(가1.body));

// ── 2. 같은 사람 · 같은 주제 = 막힌다 ──────────────────────────────
const 가1다시 = await endorse(회원가, 주제1);
check("같은 사람이 같은 주제에 두 번 못 한다", 가1다시.status === 409, JSON.stringify(가1다시.body));
check("두 번째 nullifier 가 첫 번째와 같다", 가1다시.nullifier === 가1.nullifier);

// ── 3. 다른 주제는 엮이지 않는다 ───────────────────────────────────
const 가2 = await endorse(회원가, 주제2);
check("같은 사람이 다른 주제에는 참여할 수 있다", 가2.status === 201, JSON.stringify(가2.body));
check("주제가 다르면 nullifier 도 다르다", 가2.nullifier !== 가1.nullifier);

// ── 4. 다른 사람은 따로 센다 ───────────────────────────────────────
const 나1 = await endorse(회원나, 주제1);
check("다른 회원은 같은 주제에 참여할 수 있다", 나1.status === 201, JSON.stringify(나1.body));
check("사람이 다르면 nullifier 도 다르다", 나1.nullifier !== 가1.nullifier);
check("지지 수가 2가 된다", 나1.body.count === 2, JSON.stringify(나1.body));

// ── 5. 그룹 밖 사람은 못 한다 ──────────────────────────────────────
const 가짜그룹 = new Group([...commitments.map(BigInt), 외부인.commitment]);
const 가짜증명 = await generateProof(외부인, 가짜그룹, 1n, BigInt(hashScopeServer(주제1)), DEPTH, ART);
const 밖 = await fetch(`${BASE}/api/policies/${주제1}/endorse`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(가짜증명),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check("그룹 밖 사람은 거절된다", 밖.status === 400, JSON.stringify(밖.body));

// 우리 루트로 바꿔치기해도 증명이 맞지 않아야 한다.
const 바꿔치기 = { ...가짜증명, merkleTreeRoot: group.root.toString() };
const 밖2 = await fetch(`${BASE}/api/policies/${주제1}/endorse`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(바꿔치기),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check("루트를 바꿔치기해도 거절된다", 밖2.status === 400, JSON.stringify(밖2.body));

// ── 6. 서버에 사람을 가리키는 것이 남지 않는다 ─────────────────────
const stored = await db`SELECT * FROM anon_actions WHERE scope = ${hashScopeServer(주제1)}`;
const columns = Object.keys(stored[0] ?? {});
check("기록에 DID·이메일·커밋먼트가 없다",
      !columns.some((c) => /did|email|commitment/i.test(c)), columns.join(","));
const commitmentSet = new Set(commitments);
check("기록된 nullifier 가 커밋먼트와 다르다",
      stored.every((row) => !commitmentSet.has(String(row.nullifier))));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
