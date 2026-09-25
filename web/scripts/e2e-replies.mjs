/**
 * VS-D3 종단 확인 — 댓글.
 *
 *   1. 회원이 댓글을 달고 목록에 나온다
 *   2. 500자를 넘으면 거절한다
 *   3. 서명이 내용과 맞지 않으면 거절한다
 *   4. 회원이 아니면 거절한다
 *   5. 없는 카드에는 달 수 없다
 *   6. **댓글의 댓글을 만들 수 없다** — 부모를 받는 자리가 없다
 *   7. 화면에 댓글 수가 나온다
 */
import postgres from "postgres";
import { generateKeyPairSync, createSign } from "node:crypto";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3116";
const { replyPayload, toHex } = await import("../lib/signing.ts");
const { migrate } = await import("../lib/db.ts");
const { migrateReplies } = await import("../lib/replies.ts");
const { migrateAuth } = await import("../lib/auth.ts");

await migrate();
await migrateAuth();
await migrateReplies();

const db = postgres(process.env.DATABASE_URL, { ssl: false, max: 3 });
const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

// ── 키와 DID ───────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });
const b64 = (s) => Buffer.from(s, "base64url");
const y = b64(jwk.y);
const compressed = Buffer.concat([Buffer.from([(y[31] & 1) === 0 ? 2 : 3]), b64(jwk.x)]);
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
const sign = (payload) => {
  const s = createSign("SHA256");
  s.update(Buffer.from(payload));
  return toHex(new Uint8Array(s.sign({ key: privateKey, dsaEncoding: "ieee-p1363" })));
};

const outsider = `did:key:zOutsider${Date.now()}`;
await db`INSERT INTO members (did, registered_on) VALUES (${did}, CURRENT_DATE) ON CONFLICT DO NOTHING`;

// ── 시험 대상 카드 ─────────────────────────────────────────────────
const stamp = Date.now();
const POLICY = `pol-d3-${stamp}`;
const CARD = `card-d3-${stamp}`;
await db`
  INSERT INTO policies (id, title, category, background, core_question,
                        official_source_url, target_agency, author_did, created_at)
  VALUES (${POLICY}, ${"댓글 시험"}, ${"GOV_POLICY"}, ${"배경"}, ${"질문?"},
          ${"https://example.com/x"}, NULL, ${did}, ${stamp})`;
await db`
  INSERT INTO cards (id, policy_id, stance, problem_definition, evidence_source,
                     evidence_url, actionable_solution, author_did, created_at)
  VALUES (${CARD}, ${POLICY}, ${"SUPPORT"}, ${"논점"}, ${"근거"},
          ${"https://example.com/e"}, ${"제안"}, ${did}, ${stamp})`;

const post = (cardId, body) => fetch(`${BASE}/api/cards/${cardId}/replies`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const signedReply = (cardId, text, at = Date.now(), didUsed = did) => ({
  body: text, author_did: didUsed, created_at: at,
  signature: sign(replyPayload({ card_id: cardId, author_did: didUsed, created_at: at, body: text })),
});

// ── 1. 댓글을 단다 ─────────────────────────────────────────────────
const first = await post(CARD, signedReply(CARD, "근거 링크가 끊겨 있습니다. 확인 부탁드립니다."));
check("회원이 댓글을 단다", first.status === 201, JSON.stringify(first.body));

const listed = await fetch(`${BASE}/api/cards/${CARD}/replies`).then((r) => r.json());
check("목록에 나온다", listed.replies?.length === 1, JSON.stringify(listed).slice(0, 120));
check("서명이 저장된다", Boolean(listed.replies?.[0]?.signature));

// ── 2. 길이 ────────────────────────────────────────────────────────
const tooLong = await post(CARD, signedReply(CARD, "가".repeat(501)));
check("500자를 넘으면 거절한다", tooLong.status === 400, JSON.stringify(tooLong.body));

// ── 3. 서명 ────────────────────────────────────────────────────────
const at = Date.now();
const tampered = await post(CARD, {
  body: "바꿔치기한 본문", author_did: did, created_at: at,
  signature: sign(replyPayload({ card_id: CARD, author_did: did, created_at: at, body: "원래 본문" })),
});
check("내용이 바뀐 서명을 거절한다", tampered.status === 400, JSON.stringify(tampered.body));

// ── 4. 회원 ────────────────────────────────────────────────────────
const stranger = await post(CARD, { body: "회원이 아닙니다", author_did: outsider, created_at: Date.now() });
check("회원이 아니면 거절한다", stranger.status === 400, JSON.stringify(stranger.body));

// ── 5. 없는 카드 ───────────────────────────────────────────────────
const nowhere = await post("없는카드", signedReply("없는카드", "어디에도 안 보일 글"));
check("없는 카드에는 달 수 없다", nowhere.status === 400, JSON.stringify(nowhere.body));

// ── 6. 댓글의 댓글을 만들 수 없다 ──────────────────────────────────
// 부모를 보내도 자리가 없으므로 무시되고, 표에 그런 열도 없어야 한다.
const nested = await post(CARD, { ...signedReply(CARD, "답글 시도"), parent_id: listed.replies[0].id });
check("부모를 보내도 받아들이지 않는다", nested.status === 201);
const columns = await db`
  SELECT column_name FROM information_schema.columns WHERE table_name = 'replies'`;
const names = columns.map((c) => String(c.column_name));
check("표에 부모 열이 없다", !names.some((n) => /parent|reply_to|thread/i.test(n)), names.join(","));

// ── 7. 화면 ────────────────────────────────────────────────────────
const page = await fetch(`${BASE}/policies/${POLICY}`).then((r) => r.text());
check("화면에 댓글 수가 나온다", /댓글 \d/.test(page));
check("답글·반응 버튼이 댓글에 없다", !page.includes("답글 달기"));

await db.end();
let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
