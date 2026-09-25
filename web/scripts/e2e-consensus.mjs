/**
 * VS-F5 종단 확인 — 합의 배너.
 *
 *   1. 배치가 군집별 찬성률을 저장한다
 *   2. **양 진영이 찬성한 대안 카드가 배너로 오른다**
 *   3. 한 진영만 찬성한 카드는 오르지 않는다
 *   4. 배너에 군집별 찬성률이 모두 표시된다
 *   5. 대안이 아닌 열에는 배너가 없다
 *   6. 배너로 오른 카드는 아래 목록에 겹쳐 나오지 않는다
 *
 * 2·3 번이 이 슬라이스의 존재 이유다. "진영을 넘었다"는 말이 실제로
 * 진영을 넘은 것만 가리켜야 한다.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3118";
const SECRET = process.env.BRIDGING_SECRET ?? "test-bridging-secret";

const { migrate } = await import("../lib/db.ts");
const { migrateReactions } = await import("../lib/reactions.ts");
await migrate();
await migrateReactions();

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

const stamp = Date.now();
const POLICY = `pol-f5-${stamp}`;
const COMMON = `card-common-${stamp}`;   // 양 진영 찬성 → 배너
const ONESIDE = `card-oneside-${stamp}`; // 한 진영만 → 배너 아님
const SUPPORT = `card-support-${stamp}`; // 찬성 열. 배너가 없어야 한다
const DID = "did:key:zF5TestAuthor";

await db`
  INSERT INTO policies (id, title, category, background, core_question,
                        official_source_url, target_agency, author_did, created_at)
  VALUES (${POLICY}, ${"합의 배너 시험"}, ${"GOV_POLICY"}, ${"배경"}, ${"질문?"},
          ${"https://example.com/x"}, NULL, ${DID}, ${stamp})`;

const cards = [
  [COMMON, "ALTERNATIVE", "양쪽이 받아들인 대안", "업종별로 기준을 나눈다"],
  [ONESIDE, "ALTERNATIVE", "한쪽만 민 대안", "원안을 그대로 간다"],
  [SUPPORT, "SUPPORT", "찬성 쪽 의견", "지금대로 간다"],
];
for (const [id, stance, problem, solution] of cards) {
  await db`
    INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                       evidence_url, actionable_solution, author_did, created_at)
    VALUES (${id}, ${POLICY}, ${stance}, ${problem}, ${"근거"},
            ${"https://example.com/e"}, ${solution}, ${DID}, ${stamp})`;
}

// ── 진영이 드러나는 배경 + 시험 반응 ───────────────────────────────
const A = Array.from({ length: 60 }, (_, i) => `ca${stamp}-${i}`);
const B = Array.from({ length: 60 }, (_, i) => `cb${stamp}-${i}`);
let rnd = 4242;
const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

const rows = [];
for (let c = 0; c < 40; c += 1) {
  const card = `bgf5-${stamp}-${c}`;
  const favoursA = c % 2 === 0;
  for (const who of [...A, ...B]) {
    if (next() > 0.5) continue;
    const aligned = who.startsWith(`ca${stamp}`) === favoursA;
    rows.push({ pseudonym: who, card_id: card, kind: "LOGICAL",
                signal: next() < (aligned ? 0.85 : 0.15) ? 1 : 0, updated_at: stamp });
  }
}
// 합의 카드: 양 진영 80% 찬성
for (const who of [...A, ...B]) {
  rows.push({ pseudonym: who, card_id: COMMON, kind: "LOGICAL",
              signal: next() < 0.8 ? 1 : 0, updated_at: stamp });
}
// 한쪽만: A 진영 전원 찬성, B 진영은 반응 없음
for (const who of A) {
  rows.push({ pseudonym: who, card_id: ONESIDE, kind: "LOGICAL", signal: 1, updated_at: stamp });
}
// 찬성 열 카드도 양쪽이 찬성 — 그래도 배너는 안 된다
for (const who of [...A, ...B]) {
  rows.push({ pseudonym: who, card_id: SUPPORT, kind: "LOGICAL",
              signal: next() < 0.85 ? 1 : 0, updated_at: stamp });
}
for (let i = 0; i < rows.length; i += 500) {
  await db`INSERT INTO reactions ${db(rows.slice(i, i + 500),
    "pseudonym", "card_id", "kind", "signal", "updated_at")} ON CONFLICT DO NOTHING`;
}

// ── 1. 배치 ────────────────────────────────────────────────────────
const out = execFileSync("python3", ["batch.py"], {
  cwd: "../services/bridging",
  env: { ...process.env, BRIDGING_SECRET: SECRET, CIVICAGORA_BASE: BASE },
  encoding: "utf8",
});
check("배치가 합의율을 저장한다", /합의율 저장/.test(out), out.split("\n").slice(-3).join(" "));

const stored = await db`
  SELECT card_id, cluster, rate FROM card_consensus
   WHERE card_id IN (${COMMON}, ${ONESIDE}, ${SUPPORT}) ORDER BY card_id, cluster`;
const per = {};
for (const row of stored) (per[row.card_id] ??= []).push(Number(row.rate));

check("합의 카드는 두 군집 모두에 값이 있다", (per[COMMON] ?? []).length >= 2,
      JSON.stringify(per[COMMON]));
check("합의 카드는 모든 군집이 60%를 넘는다",
      (per[COMMON] ?? []).length >= 2 && Math.min(...per[COMMON]) >= 0.6,
      JSON.stringify(per[COMMON]?.map((v) => v.toFixed(2))));
check("한쪽만 찬성한 카드는 군집이 하나뿐이다", (per[ONESIDE] ?? []).length < 2,
      JSON.stringify(per[ONESIDE]));

// ── 2~6. 화면 ──────────────────────────────────────────────────────
// 사람이 보는 화면만 본다. <script> 안의 RSC 페이로드는 같은 본문을 한 번 더
// 싣기 때문에, 그대로 세면 모든 것이 두 배로 나온다.
const raw = await fetch(`${BASE}/policies/${POLICY}`).then((r) => r.text());
const page = raw.replace(/<script[\s\S]*?<\/script>/g, "");
check("배너가 뜬다", page.includes("진영을 넘은 합의"));
check("배너에 합의 카드가 실린다", page.includes("업종별로 기준을 나눈다"));
check("한쪽만 민 대안은 배너가 아니다",
      page.indexOf("진영을 넘은 합의") < page.indexOf("업종별로 기준을 나눈다") &&
      !new RegExp("진영을 넘은 합의[\\s\\S]{0,400}원안을 그대로 간다").test(page));
check("군집별 찬성률이 모두 표시된다", (page.match(/군집 \d+ \d+%/g) ?? []).length >= 2,
      String((page.match(/군집 \d+ \d+%/g) ?? []).length));
check("찬성 열에는 배너가 없다", (page.match(/진영을 넘은 합의/g) ?? []).length === 1);
check("배너 카드가 목록에 겹쳐 나오지 않는다",
      (page.match(/업종별로 기준을 나눈다/g) ?? []).length === 1,
      String((page.match(/업종별로 기준을 나눈다/g) ?? []).length));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
