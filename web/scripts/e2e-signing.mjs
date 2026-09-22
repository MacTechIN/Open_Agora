/** VS-A4 종단 확인 — 실제 서버에 서명한 글을 올리고, 위조를 거절하는지 본다. */
import { generateKeyPairSync, createSign, createPrivateKey } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3111";
const { policyPayload, opinionPayload, toHex, contentId } = await import("../lib/signing.ts");

// ── 키와 DID ───────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const raw = publicKey.export({ format: "jwk" });
const b64 = (s) => Buffer.from(s, "base64url");
const x = b64(raw.x), y = b64(raw.y);
const compressed = Buffer.concat([Buffer.from([(y[31] & 1) === 0 ? 2 : 3]), x]);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return digits.reverse().map((d) => BASE58[d]).join("");
}
const did = `did:key:z${base58(Buffer.concat([Buffer.from([0x80, 0x24]), compressed]))}`;

function sign(payload) {
  const s = createSign("SHA256");
  s.update(Buffer.from(payload));
  return toHex(new Uint8Array(s.sign({ key: privateKey, dsaEncoding: "ieee-p1363" })));
}

// ── 회원 등록(이메일 단계는 건너뛴다) ───────────────────────────────
const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 2 });
await db`CREATE TABLE IF NOT EXISTS members (did TEXT PRIMARY KEY, registered_on DATE NOT NULL)`;
await db`INSERT INTO members (did, registered_on) VALUES (${did}, CURRENT_DATE) ON CONFLICT DO NOTHING`;

const results = [];
const check = (name, ok, detail = "") => { results.push([ok, name, detail]); };

// ── 1. 서명한 주제는 통과한다 ───────────────────────────────────────
const createdAt = Date.now();
const policy = {
  title: "시험 주제",
  category: "GOV_POLICY",
  background: "서명 확인을 위한 글입니다: 줄바꿈\n포함",
  core_question: "이 서명이 통과하는가?",
  official_source_url: "https://github.com/MacTechIN/Open_Agora",
  target_agency: null,
};
const opinion = {
  stance: "SUPPORT",
  problem_definition: "서명 경로가 아직 없었다",
  evidence_source: "docs/16_ONCHAIN_PLAN.md 1단계",
  evidence_url: "https://github.com/MacTechIN/Open_Agora",
  actionable_solution: "기기 키로 내용에 서명한다",
};

const policySignature = sign(policyPayload({ ...policy, author_did: did, created_at: createdAt }));

const policyId = await contentId([did, String(createdAt), policy.title, policy.background, policy.core_question]);
const opinionSignature = sign(opinionPayload({ ...opinion, policy_id: policyId, author_did: did, created_at: createdAt }));

const post = (path, body) => fetch(BASE + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const created = await post("/api/policies", {
  author_did: did, created_at: createdAt, policy, first_opinion: opinion,
  policy_signature: policySignature, opinion_signature: opinionSignature,
});
check("서명한 주제가 등록된다", created.status === 201, JSON.stringify(created.body));

// ── 2. 저장된 서명이 실제로 들어갔는가 ──────────────────────────────
if (created.status === 201) {
  const [row] = await db`SELECT signature FROM policies WHERE id = ${created.body.policy_id}`;
  check("서명이 저장된다", row?.signature === policySignature);
  const [card] = await db`SELECT signature FROM cards WHERE policy_id = ${created.body.policy_id}`;
  check("첫 의견의 서명도 저장된다", card?.signature === opinionSignature);
}

// ── 3. 내용을 바꾼 서명은 거절한다 ──────────────────────────────────
const at2 = Date.now();
const tampered = await post("/api/policies", {
  author_did: did, created_at: at2,
  policy: { ...policy, title: "다른 제목" },
  first_opinion: opinion,
  // 원래 제목으로 만든 서명을 붙인다 — 운영자가 제목을 바꾼 상황과 같다.
  policy_signature: sign(policyPayload({ ...policy, author_did: did, created_at: at2 })),
});
check("내용이 바뀐 서명을 거절한다", tampered.status === 400, JSON.stringify(tampered.body));

// ── 4. 시각을 바꾸면 거절한다 ───────────────────────────────────────
const at3 = Date.now();
const moved = await post("/api/policies", {
  author_did: did, created_at: at3, policy, first_opinion: opinion,
  policy_signature: sign(policyPayload({ ...policy, author_did: did, created_at: at3 - 1000 })),
});
check("시각이 바뀐 서명을 거절한다", moved.status === 400, JSON.stringify(moved.body));

// ── 5. 기기 시계가 크게 틀리면 거절한다 ─────────────────────────────
const skewed = await post("/api/policies", {
  author_did: did, created_at: Date.now() + 40 * 60 * 1000, policy, first_opinion: opinion,
});
check("시각 범위를 벗어나면 거절한다", skewed.status === 400, JSON.stringify(skewed.body));

// ── 6. 서명 없는 글은 아직 받는다(전환기) ───────────────────────────
const unsigned = await post("/api/policies", {
  author_did: did, policy: { ...policy, title: "미서명 주제" }, first_opinion: opinion,
});
check("서명 없는 글은 아직 받는다", unsigned.status === 201, JSON.stringify(unsigned.body));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
