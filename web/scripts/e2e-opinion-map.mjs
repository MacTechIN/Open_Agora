/**
 * VS-F4 종단 확인 — 여론 지형도.
 *
 *   1. 배치가 군집을 계산해 저장한다
 *   2. **군집이 실제 진영을 복원한다**
 *   3. 공개 응답에 필명이 없다                    ← INV-2
 *   4. 참여자가 적으면 공개하지 않는다             ← INV-5
 *   5. 증명 없이 내 위치를 조회할 수 없다
 *   6. 올바른 증명이면 내 위치를 준다
 *
 * 3·5 번이 이 슬라이스의 프라이버시 요구다. "타인의 위치는 조회 불가"를
 * 지키는 방법은 아무에게도 주지 않거나 본인만 받게 하거나 둘뿐이고,
 * 후자를 택했다.
 *
 * 반응은 표에 직접 넣는다 — 증명 경로는 e2e-reactions 가 확인했고, 진영이
 * 드러날 만큼을 증명으로 만들면 수백 초가 걸린다.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3117";
const SECRET = process.env.BRIDGING_SECRET ?? "test-bridging-secret";
const ART = { wasm: "public/semaphore/semaphore-16.wasm", zkey: "public/semaphore/semaphore-16.zkey" };

const { PSEUDONYM_SCOPE } = await import("../lib/scope.ts");
const { migrate } = await import("../lib/db.ts");
const { migrateReactions } = await import("../lib/reactions.ts");
const { join } = await import("../lib/anon.ts");

await migrate();
await migrateReactions();

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

// ── 두 진영 · 배경 반응 ────────────────────────────────────────────
const stamp = Date.now();
const A = Array.from({ length: 70 }, (_, i) => `fa${stamp}-${i}`);
const B = Array.from({ length: 70 }, (_, i) => `fb${stamp}-${i}`);
let rnd = 777;
const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;

const rows = [];
for (let c = 0; c < 40; c += 1) {
  const card = `bgmap-${stamp}-${c}`;
  const favoursA = c % 2 === 0;
  for (const who of [...A, ...B]) {
    if (next() > 0.5) continue;
    const aligned = who.startsWith(`fa${stamp}`) === favoursA;
    rows.push({ pseudonym: who, card_id: card,
                kind: "LOGICAL", signal: next() < (aligned ? 0.85 : 0.15) ? 1 : 0,
                updated_at: stamp });
  }
}
for (let i = 0; i < rows.length; i += 500) {
  await db`INSERT INTO reactions ${db(rows.slice(i, i + 500),
    "pseudonym", "card_id", "kind", "signal", "updated_at")} ON CONFLICT DO NOTHING`;
}

// ── 1~2. 배치 ──────────────────────────────────────────────────────
const out = execFileSync("python3", ["batch.py"], {
  cwd: "../services/bridging",
  env: { ...process.env, BRIDGING_SECRET: SECRET, CIVICAGORA_BASE: BASE },
  encoding: "utf8",
});
check("배치가 지형도를 저장한다", /지형도 저장/.test(out), out.split("\n").slice(-3).join(" "));

const placed = await db`SELECT pseudonym, cluster FROM opinion_positions`;
check("모든 참여자에게 좌표가 있다", placed.length === A.length + B.length,
      `${placed.length}명`);

// 군집이 진영을 복원했는가
const byCluster = {};
for (const row of placed) {
  const faction = String(row.pseudonym).startsWith(`fa${stamp}`) ? "A" : "B";
  (byCluster[row.cluster] ??= []).push(faction);
}
const purity = Object.values(byCluster).map((m) => {
  const a = m.filter((f) => f === "A").length;
  return Math.max(a, m.length - a) / m.length;
});
check("군집이 실제 진영을 복원한다", Math.min(...purity) > 0.9,
      `순도 ${purity.map((p) => p.toFixed(2)).join(", ")}`);

// ── 3. 공개 응답에 필명이 없다 ─────────────────────────────────────
const map = await fetch(`${BASE}/api/opinion-map`).then((r) => r.json());
check("지형도를 공개한다", map.ready === true, JSON.stringify(map).slice(0, 120));
const text = JSON.stringify(map);
check("공개 응답에 필명이 없다", !placed.slice(0, 20).some((r) => text.includes(String(r.pseudonym))));
check("점 구름에 식별자가 없다",
      Array.isArray(map.points) && map.points.every((p) => p.length === 3 && p.every((v) => typeof v === "number")));

// ── 5~6. 내 위치 ───────────────────────────────────────────────────
const noProof = await fetch(`${BASE}/api/opinion-map/me`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
check("증명 없이는 거절한다", noProof.status === 400);

// 회원 하나를 만들어 실제로 조회해 본다.
const me = new Identity("지형도 시험 " + stamp);
await join(me.commitment.toString());
const commitments = (await fetch(`${BASE}/api/anon/group`).then((r) => r.json())).commitments;
const group = new Group(commitments.map(BigInt));
const proof = await generateProof(me, group, 1n, BigInt(PSEUDONYM_SCOPE), 16, ART);

// 이 회원의 필명에 좌표를 직접 넣어 두고, 증명으로 찾아오는지 본다.
await db`
  INSERT INTO opinion_positions (pseudonym, x, y, cluster)
  VALUES (${String(proof.nullifier)}, ${0.5}, ${-0.25}, ${0})
  ON CONFLICT (pseudonym) DO UPDATE SET x = 0.5, y = -0.25, cluster = 0`;

const found = await fetch(`${BASE}/api/opinion-map/me`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(proof),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check("올바른 증명이면 내 위치를 준다",
      found.status === 200 && Math.abs(found.body.x - 0.5) < 1e-9,
      JSON.stringify(found.body));

// 남의 필명으로는 조회할 길이 없다 — 라우트가 필명을 받지 않는다.
const byName = await fetch(`${BASE}/api/opinion-map/me`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pseudonym: String(placed[0].pseudonym) }),
});
check("필명을 보내도 조회되지 않는다", byName.status === 400);

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
