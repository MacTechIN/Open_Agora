/**
 * VS-F3 종단 확인 — 브리징 점수가 랭킹에 실제로 반영되는가.
 *
 *   1. 배치가 스냅샷을 받아 점수를 계산하고 저장한다
 *   2. **몰표 카드가 브리징 카드 아래로 내려간다**
 *   3. 반응이 부족한 카드는 "평가 수집 중"으로 그 아래에 남는다
 *   4. 스냅샷에 필명이 나가지 않는다
 *   5. 배치 이력에 해시·모델·시드가 남는다 (G-DETERM)
 *
 * **반응을 데이터베이스에 직접 넣습니다.** 영지식 증명 경로는 e2e-reactions
 * 가 이미 확인했고, 여기서 확인하려는 것은 배치와 랭킹입니다. 진영이 드러날
 * 만큼의 배경 반응을 증명으로 만들면 수백 초가 걸립니다.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3115";
const SECRET = process.env.BRIDGING_SECRET ?? "test-bridging-secret";

// 표를 먼저 만든다. 라우트를 한 번도 부르지 않았으면 아직 없다.
const { migrate } = await import("../lib/db.ts");
const { migrateReactions } = await import("../lib/reactions.ts");
await migrate();
await migrateReactions();

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

const stamp = Date.now();
const POLICY = `pol-f3-${stamp}`;
const BRIGADE = `card-brigade-${stamp}`;
const BRIDGE = `card-bridge-${stamp}`;
const THIN = `card-thin-${stamp}`;
const DID = "did:key:zF3TestAuthor";

// ── 주제와 의견 셋 (같은 열에 놓아 순서를 본다) ────────────────────
await db`
  INSERT INTO policies (id, title, category, background, core_question,
                        official_source_url, target_agency, author_did, created_at)
  VALUES (${POLICY}, ${"브리징 랭킹 시험"}, ${"GOV_POLICY"}, ${"배경"}, ${"질문?"},
          ${"https://example.com/x"}, NULL, ${DID}, ${stamp})`;

for (const [id, problem, offset] of [
  [BRIGADE, "몰표를 받은 의견", 0],
  [BRIDGE, "양쪽에서 인정받은 의견", 1],
  [THIN, "아직 평가가 적은 의견", 2],
]) {
  await db`
    INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                       evidence_url, actionable_solution, author_did, created_at)
    VALUES (${id}, ${POLICY}, ${"SUPPORT"}, ${problem}, ${"근거"},
            ${"https://example.com/e"}, ${"제안"}, ${DID}, ${stamp + offset})`;
}

// ── 배경 반응: 진영이 드러나게 한다 ────────────────────────────────
// 모델이 각 사람의 f_u 를 알아야 몰표 무력화가 성립한다.
const A = Array.from({ length: 120 }, (_, i) => `pa${stamp}-${i}`);
const B = Array.from({ length: 120 }, (_, i) => `pb${stamp}-${i}`);
const rows = [];
let rnd = 12345;
const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

for (let c = 0; c < 60; c += 1) {
  const card = `bg-${stamp}-${c}`;
  const favoursA = c % 2 === 0;
  for (const who of [...A, ...B]) {
    if (next() > 0.35) continue;
    const aligned = who.startsWith(`pa${stamp}`) === favoursA;
    rows.push({ pseudonym: who, card_id: card,
                signal: next() < (aligned ? 0.85 : 0.15) ? 1 : 0 });
  }
}
// 몰표: 진영 A 만 100명
for (const who of A.slice(0, 100)) rows.push({ pseudonym: who, card_id: BRIGADE, signal: 1 });
// 브리징: 양쪽 50명씩 — **긍정 수가 같다**
for (const who of A.slice(0, 50)) rows.push({ pseudonym: who, card_id: BRIDGE, signal: 1 });
for (const who of B.slice(0, 50)) rows.push({ pseudonym: who, card_id: BRIDGE, signal: 1 });
// 평가 부족: 5명만
for (const who of A.slice(0, 5)) rows.push({ pseudonym: who, card_id: THIN, signal: 1 });

for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, kind: r.signal ? "LOGICAL" : "DISAGREE",
                                                     updated_at: stamp }));
  await db`INSERT INTO reactions ${db(chunk, "pseudonym", "card_id", "kind", "signal", "updated_at")}
           ON CONFLICT DO NOTHING`;
}

// ── 1. 스냅샷에 필명이 나가지 않는가 ───────────────────────────────
const snapshot = await fetch(`${BASE}/api/bridging/snapshot`, {
  headers: { Authorization: `Bearer ${SECRET}` },
}).then((r) => r.json());
check("스냅샷을 받는다", Array.isArray(snapshot.reactions) && snapshot.reactions.length > 0);
const text = JSON.stringify(snapshot);
check("스냅샷에 필명이 없다", !A.slice(0, 5).some((p) => text.includes(p)));
check("비밀값 없이는 거절한다",
      (await fetch(`${BASE}/api/bridging/snapshot`)).status === 401);

// ── 2. 배치를 돌린다 ───────────────────────────────────────────────
const out = execFileSync("python3", ["batch.py"], {
  cwd: "../services/bridging",
  env: { ...process.env, BRIDGING_SECRET: SECRET, CIVICAGORA_BASE: BASE },
  encoding: "utf8",
});
check("배치가 점수를 저장한다", /저장 완료/.test(out), out.split("\n").slice(-3).join(" "));

const scored = await db`SELECT card_id, score FROM card_scores WHERE card_id IN (${BRIGADE}, ${BRIDGE}, ${THIN})`;
const score = Object.fromEntries(scored.map((r) => [r.card_id, Number(r.score)]));
check("몰표 카드보다 브리징 카드가 높다", score[BRIDGE] > score[BRIGADE],
      `몰표 ${score[BRIGADE]?.toFixed(4)} · 브리징 ${score[BRIDGE]?.toFixed(4)}`);
check("반응이 부족한 카드는 점수가 없다", score[THIN] === undefined);

// ── 3. 화면 순서 ───────────────────────────────────────────────────
const page = await fetch(`${BASE}/policies/${POLICY}`).then((r) => r.text());
const at = (needle) => page.indexOf(needle);
check("브리징 카드가 몰표 카드보다 위에 있다",
      at("양쪽에서 인정받은 의견") < at("몰표를 받은 의견"),
      `브리징 ${at("양쪽에서 인정받은 의견")} · 몰표 ${at("몰표를 받은 의견")}`);
check("평가가 적은 카드는 맨 아래다",
      at("아직 평가가 적은 의견") > at("몰표를 받은 의견"));
check("평가 수집 중 표시가 있다", page.includes("평가 수집 중"));

// ── 4. 배치 이력 (G-DETERM) ────────────────────────────────────────
const [run] = await db`SELECT * FROM bridging_runs ORDER BY id DESC LIMIT 1`;
check("해시·모델·시드가 남는다",
      Boolean(run?.snapshot_hash) && Number(run?.model_version) > 0 && Number(run?.seed) > 0);

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
