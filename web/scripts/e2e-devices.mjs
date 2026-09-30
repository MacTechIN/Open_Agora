/**
 * 기기 등록 확인 — 한 사람이 여러 기기를 쓸 수 있는가.
 *
 * 시민 ID 는 기기 밖으로 나오지 않으므로 기기마다 다른 DID 가 된다. 같은
 * 이메일로 다시 인증하면 **기기가 더해져야** 한다. 거절하면 웹에서 가입한
 * 사람이 앱에서 글을 못 쓰고, 브라우저를 지우면 영구히 잠긴다.
 *
 * ## 왜 HTTP 경로까지 보는가
 *
 * 처음에는 인증 계층만 직접 불렀다. "확인하려는 것은 메일이 아니라 등록
 * 규칙"이라는 이유였고, 그 판단이 **실제로 버그를 통과시켰다.**
 * `verifyAndRegister` 는 기기를 제대로 더하는데 `/api/auth/request` 가
 * 가입한 이메일을 막고 있어서, 사용자는 코드를 받을 수 없었다. 규칙은
 * 맞았고 거기로 가는 길이 막혀 있었다.
 *
 * 그래서 **라이브러리와 그 앞의 경로를 함께** 본다. 코드 값은 메일로만
 * 가므로 HTTP 로는 "코드가 발급되었는가"까지만 확인하고, 맞히는 것은
 * 계층을 직접 불러 확인한다.
 *
 *   DATABASE_URL=... AUTH_SECRET=... E2E_BASE=http://127.0.0.1:3119 \
 *     npm run e2e:devices        # 개발 서버가 떠 있어야 한다
 */
const { issueCode, verifyAndRegister, hashEmail, isMember, migrateAuth } =
  await import("../lib/auth.ts");
const { migrate, sql } = await import("../lib/db.ts");

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3119";

await migrate();
await migrateAuth();

const results = [];
const check = (name, ok, detail = "") => results.push([ok, name, detail]);

const email = `기기시험-${Date.now()}@example.com`;
const hash = hashEmail(email);
const did = (n) => `did:key:zTestDevice${n}${Date.now()}`;

// ── 1. 첫 기기 ─────────────────────────────────────────────────────
const first = did(1);
let result = await verifyAndRegister(hash, await issueCode(hash), first);
check("첫 기기가 등록된다", result.added && result.devices === 1, JSON.stringify(result));
check("첫 기기가 회원이다", await isMember(first));

// ── 2. 둘째 기기 (웹 → 앱) ─────────────────────────────────────────
const second = did(2);
result = await verifyAndRegister(hash, await issueCode(hash), second);
check("같은 이메일로 둘째 기기가 더해진다", result.added && result.devices === 2, JSON.stringify(result));
check("둘째 기기도 회원이다", await isMember(second));
check("첫 기기는 그대로 회원이다", await isMember(first));

// ── 3. 같은 기기를 다시 ────────────────────────────────────────────
result = await verifyAndRegister(hash, await issueCode(hash), first);
check("이미 등록된 기기는 수를 늘리지 않는다", !result.added && result.devices === 2,
      JSON.stringify(result));

// ── 4. 상한 ────────────────────────────────────────────────────────
for (let n = 3; n <= 5; n += 1) {
  await verifyAndRegister(hash, await issueCode(hash), did(n));
}
let capped = false;
try {
  await verifyAndRegister(hash, await issueCode(hash), did(6));
} catch (error) {
  capped = /기기 5대/.test(error.message);
}
check("상한을 넘으면 거절한다", capped);

// ── 5. 다른 이메일은 영향 없음 ─────────────────────────────────────
const other = hashEmail(`다른사람-${Date.now()}@example.com`);
result = await verifyAndRegister(other, await issueCode(other), did(99));
check("다른 이메일은 따로 센다", result.added && result.devices === 1, JSON.stringify(result));

// ── 6. 요청 경로 (HTTP) ────────────────────────────────────────────
// 여기가 비어 있어서 버그가 나갔다. 등록 규칙이 아무리 맞아도 코드를 받지
// 못하면 사용자는 아무것도 할 수 없다.
const request = (address) =>
  fetch(`${BASE}/api/auth/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: address }),
  });

// 요청 **전에 지우고** 뒤에 있는지 본다. 남아 있던 행을 그대로 세면,
// 경로가 막혀 코드를 새로 내지 않아도 통과한다 — 실제로 한 번 그랬다.
const clearCode = (address) =>
  sql`DELETE FROM verification_codes WHERE email_hash = ${hashEmail(address)}`;
const issued = async (address) => {
  const rows = await sql`
    SELECT 1 FROM verification_codes WHERE email_hash = ${hashEmail(address)}`;
  return rows.length > 0;
};

const fresh = `처음-${Date.now()}@example.com`;
await clearCode(fresh);
const freshRes = await request(fresh);
const freshBody = await freshRes.text();
check("처음 보는 이메일이 코드를 받는다", freshRes.status === 200, freshBody.slice(0, 120));
check("처음 보는 이메일의 코드가 발급된다", await issued(fresh));

// `email` 은 위에서 5대를 모두 쓴 주소다. 상한에 닿았어도 **코드는 나가야**
// 한다 — 상한 안내는 코드를 맞힌 뒤, 메일함을 가진 사람에게만 닿아야 한다.
await clearCode(email);
const againRes = await request(email);
const againBody = await againRes.text();
check("이미 가입한 이메일도 코드를 받는다", againRes.status === 200, againBody.slice(0, 120));
check("이미 가입한 이메일의 코드가 발급된다", await issued(email));

// 응답이 갈리면 아무나 남의 주소를 넣어 회원인지 알아낼 수 있다.
check("가입 여부가 응답으로 새지 않는다",
      freshRes.status === againRes.status && freshBody === againBody,
      `${freshRes.status}:${freshBody.slice(0, 60)} vs ${againRes.status}:${againBody.slice(0, 60)}`);
check("응답에 인증코드가 담기지 않는다", !/\d{6}/.test(againBody), againBody.slice(0, 120));

// 상한은 코드를 맞힌 뒤에 알린다. (4번에서 이미 확인 — 여기서는 순서를 못박는다)
check("상한 안내는 요청이 아니라 확인 단계에서 나온다",
      !/기기 5대/.test(againBody), againBody.slice(0, 120));

let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
