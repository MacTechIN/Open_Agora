/**
 * VS-H1 종단 확인 — 정책 권고서.
 *
 *   1. 발행 관문 네 가지가 실제 데이터로 채워진다
 *   2. **4절(합의 미도달 쟁점)과 5절 이하(방법론·검증)가 반드시 있다**
 *   3. 인용이 원문과 글자까지 같다
 *   4. 수렴도가 최솟값 규칙을 따른다 — 한쪽 몰표로 올라가지 않는다
 *   5. 반응자 필명이 문서에 새지 않는다
 *   6. TXT·DOCX 로 내려받힌다
 *
 * 2 번이 이 슬라이스의 수락 조건이다. 합의만 골라 실으면 이 문서는 공론장의
 * 기록이 아니라 선전물이 되고, 검증 방법을 빼면 "믿어 주세요"가 된다.
 * 4 번은 D24 의 정의가 코드와 일치하는지 본다.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3119";
const SECRET = process.env.BRIDGING_SECRET ?? "test-bridging-secret";

const { migrate } = await import("../lib/db.ts");
const { migrateReactions } = await import("../lib/reactions.ts");
const { convergence, passesBriefGate } = await import("../lib/brief.ts");
await migrate();
await migrateReactions();

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

const stamp = Date.now();
const POLICY = `pol-h1-${stamp}`;
const AGREED = `card-agreed-${stamp}`;      // 양 진영 80% → 합의
const SPLIT = `card-split-${stamp}`;        // A 전원 찬성, B 전원 반대 → 미도달
const DID = "did:key:zH1TestAuthor";

const AGREED_SOLUTION = "업종별 상한을 나누고 3년마다 국회가 재승인한다";
const SPLIT_SOLUTION = "상한을 없애고 전면 자율에 맡긴다";

await db`
  INSERT INTO policies (id, title, category, background, core_question,
                        official_source_url, target_agency, author_did, created_at)
  VALUES (${POLICY}, ${"권고서 시험 주제"}, ${"GOV_POLICY"},
          ${"이 배경 문장이 권고서 1절에 그대로 실려야 한다."},
          ${"상한을 유지해야 하는가?"},
          ${"https://example.com/official"}, ${"고용노동부"}, ${DID}, ${stamp})`;

const insertCard = (id, stance, problem, solution) => db`
  INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                     evidence_url, actionable_solution, author_did, created_at)
  VALUES (${id}, ${POLICY}, ${stance}, ${problem}, ${"통계청 2025 보고서"},
          ${"https://example.com/evidence"}, ${solution}, ${DID}, ${stamp})`;

// ── 배경 의견 100건. 관문의 "누적 의견 100건"을 실제로 채운다 ─────────
const STANCES = ["SUPPORT", "ALTERNATIVE", "OPPOSE"];
const background = [];
for (let c = 0; c < 100; c += 1) {
  const id = `bgh1-${stamp}-${c}`;
  background.push(id);
  await insertCard(id, STANCES[c % 3], `배경 논점 ${c}`, `배경 제안 ${c}`);
}
await insertCard(AGREED, "ALTERNATIVE", "양 진영이 받아들인 지점이 있다", AGREED_SOLUTION);
await insertCard(SPLIT, "ALTERNATIVE", "여기서 평가가 갈린다", SPLIT_SOLUTION);

// ── 두 진영 60명씩. 배경 카드는 진영에 따라 갈리게 반응한다 ───────────
const A = Array.from({ length: 60 }, (_, i) => `ha${stamp}-${i}`);
const B = Array.from({ length: 60 }, (_, i) => `hb${stamp}-${i}`);
let rnd = 90210;
const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

const rows = [];
background.forEach((card, c) => {
  const favoursA = c % 2 === 0;
  for (const who of [...A, ...B]) {
    if (next() > 0.5) continue;
    const aligned = who.startsWith(`ha${stamp}`) === favoursA;
    rows.push({ pseudonym: who, card_id: card, kind: "LOGICAL",
                signal: next() < (aligned ? 0.85 : 0.15) ? 1 : 0, updated_at: stamp });
  }
});

// 합의 카드는 양 진영 **정확히** 80%. 난수로 두면 군집 간 격차 5%p 조건이
// 돌릴 때마다 달라져, 실패가 코드 탓인지 운 탓인지 알 수 없다.
for (const faction of [A, B]) {
  faction.forEach((who, i) => {
    rows.push({ pseudonym: who, card_id: AGREED, kind: "LOGICAL",
                signal: i < 48 ? 1 : 0, updated_at: stamp });
  });
}
// 갈린 카드: A 전원 찬성, B 전원 반대. 두 군집 모두에 값이 생긴다.
for (const who of A) {
  rows.push({ pseudonym: who, card_id: SPLIT, kind: "LOGICAL", signal: 1, updated_at: stamp });
}
for (const who of B) {
  rows.push({ pseudonym: who, card_id: SPLIT, kind: "LOGICAL", signal: 0, updated_at: stamp });
}
for (let i = 0; i < rows.length; i += 500) {
  await db`INSERT INTO reactions ${db(rows.slice(i, i + 500),
    "pseudonym", "card_id", "kind", "signal", "updated_at")} ON CONFLICT DO NOTHING`;
}

// ── 배치 ────────────────────────────────────────────────────────────
execFileSync("python3", ["batch.py"], {
  cwd: "../services/bridging",
  env: { ...process.env, BRIDGING_SECRET: SECRET, CIVICAGORA_BASE: BASE },
  encoding: "utf8",
});

// ── 1. 관문 ─────────────────────────────────────────────────────────
const json = await fetch(`${BASE}/api/policies/${POLICY}/brief`).then((r) => r.json());
const gate = (label) => json.gates.find((g) => g.label === label);

check("의견 100건 관문을 채운다", gate("누적 의견")?.met, JSON.stringify(gate("누적 의견")));
check("참여 시민 50명 관문을 채운다", gate("참여 시민")?.met, JSON.stringify(gate("참여 시민")));
check("이념 군집 2개 관문을 채운다", gate("이념 군집")?.met, JSON.stringify(gate("이념 군집")));
check("합의 대안 1건 관문을 채운다", gate("합의 대안")?.met, JSON.stringify(gate("합의 대안")));
check("네 관문을 모두 넘으면 발행 가능이다", json.eligible === true, String(json.eligible));
check("참여 시민은 사람 단위로 센다 (기기 아님)", json.participants === 120,
      String(json.participants));

const md = json.markdown;

// ── 2. 반드시 들어가는 절 ───────────────────────────────────────────
for (const section of ["1. 주제와 쟁점", "2. 참여 규모", "3. 찬반 분포와 수렴도",
                       "4. 진영을 넘은 합의", "5. 합의에 이르지 못한 쟁점",
                       "6. 대표 의견 원문", "7. 검증 정보"]) {
  check(`${section} 절이 있다`, md.includes(`## ${section}`));
}
check("5절이 비어 있지 않다 (갈린 쟁점을 싣는다)", md.includes(SPLIT_SOLUTION));
check("7절에 군집화 방법이 적힌다", md.includes("K-Means") && md.includes("실루엣"));
check("합의 카드에 브리징 점수와 카드 식별자가 실린다",
      /브리징 점수 \$b_i\$ = [-\d.]+ · 진영 편향 \$f_i\$ = [-\d.]+/.test(md) && md.includes(AGREED),
      md.split("\n").find((l) => l.includes("브리징 점수")) ?? "없음");
check("군집 간 격차가 숫자로 적힌다", /격차 \d+\.\d%p/.test(md));
check("개인 잠재 성향이 문서에 없다 (INV-2)",
      !md.includes("f_u") && !md.includes("user_latent"));
check("7절에 재계산 방법이 적힌다", /브리징 모델 v\d+ · 시드 \d+/.test(md), md.slice(-600));
check("꼬리말이 대표성을 주장하지 않는다",
      md.includes("특정 개인이나 단체의 공식 입장이 아닙니다") &&
      md.includes("내려받은 회원이 본인 판단으로"));
check("플랫폼이 발신자로 적히지 않는다", !/발신[:：]/.test(md));

// ── 3. 인용은 지어내지 않는다 ───────────────────────────────────────
check("합의 대안이 원문 그대로 실린다", md.includes(AGREED_SOLUTION));
check("근거 출처 URL 이 함께 실린다", md.includes("https://example.com/evidence"));
check("배경 문장이 1절에 그대로 실린다",
      md.includes("이 배경 문장이 권고서 1절에 그대로 실려야 한다."));

// ── 4. 수렴도 ───────────────────────────────────────────────────────
const stored = await db`
  SELECT card_id, cluster, rate FROM card_consensus
   WHERE card_id IN (${AGREED}, ${SPLIT}) ORDER BY card_id, cluster`;
const per = {};
for (const row of stored) (per[row.card_id] ??= []).push(
  { cluster: Number(row.cluster), rate: Number(row.rate) });

check("합의 카드가 2차 관문을 넘는다 (모두 ≥65%, 격차 ≤5%p)",
      passesBriefGate(per[AGREED] ?? []),
      JSON.stringify((per[AGREED] ?? []).map((r) => r.rate.toFixed(3))));
check("갈린 카드는 2차 관문을 넘지 못한다", !passesBriefGate(per[SPLIT] ?? []),
      JSON.stringify((per[SPLIT] ?? []).map((r) => r.rate.toFixed(3))));

// 몰표는 수렴도를 올리지 못한다 — 최솟값을 쓰기 때문이다. 평균을 쓰면
// 아래 두 값이 같아지고, 그 순간 수렴도는 인기투표가 된다.
const bridged = convergence({ x: [{ cluster: 0, rate: 0.7 }, { cluster: 1, rate: 0.7 }] });
const brigaded = convergence({ x: [{ cluster: 0, rate: 1.0 }, { cluster: 1, rate: 0.4 }] });
check("몰표 카드의 수렴도가 양쪽 찬성 카드보다 낮다 (평균이면 같아진다)",
      brigaded < bridged, `${brigaded?.toFixed(3)} < ${bridged?.toFixed(3)}`);
check("군집이 하나뿐이면 수렴도를 내지 않는다",
      convergence({ x: [{ cluster: 0, rate: 0.9 }] }) === null);

// ── 5. 필명이 새지 않는다 ───────────────────────────────────────────
const leaked = [...A, ...B].filter((who) => md.includes(who));
check("반응자 필명이 문서에 없다", leaked.length === 0, leaked.slice(0, 3).join(","));

// ── 6. 내려받기 ─────────────────────────────────────────────────────
const txt = await fetch(`${BASE}/api/policies/${POLICY}/brief?format=txt`);
check("TXT 가 첨부로 내려온다",
      /attachment; filename="civicagora-brief-/.test(txt.headers.get("content-disposition") ?? ""),
      txt.headers.get("content-disposition") ?? "");
check("TXT 본문이 JSON 의 마크다운과 같다", (await txt.text()) === md);

const docx = await fetch(`${BASE}/api/policies/${POLICY}/brief?format=docx`);
const bytes = Buffer.from(await docx.arrayBuffer());
check("DOCX 가 zip 이다 (PK 서명)", bytes.subarray(0, 2).toString() === "PK",
      bytes.subarray(0, 4).toString("hex"));
check("DOCX 에 word/document.xml 이 있다", bytes.includes(Buffer.from("word/document.xml")));
check("DOCX 가 빈 껍데기가 아니다", bytes.length > 8000, String(bytes.length));

// ── 화면 ────────────────────────────────────────────────────────────
const raw = await fetch(`${BASE}/policies/${POLICY}/brief`).then((r) => r.text());
const page = raw.replace(/<script[\s\S]*?<\/script>/g, "");
check("권고서 페이지가 본문을 보여준다", page.includes("진영을 넘은 합의"));
check("페이지가 플랫폼이 보내지 않음을 밝힌다", page.includes("본인 명의로"));
const fromPolicy = await fetch(`${BASE}/policies/${POLICY}`).then((r) => r.text());
check("주제 화면에서 권고서로 가는 길이 있다",
      fromPolicy.includes(`/policies/${POLICY}/brief`));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
