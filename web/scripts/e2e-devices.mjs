/**
 * 기기 등록 확인 — 한 사람이 여러 기기를 쓸 수 있는가.
 *
 * 시민 ID 는 기기 밖으로 나오지 않으므로 기기마다 다른 DID 가 된다. 같은
 * 이메일로 다시 인증하면 **기기가 더해져야** 한다. 거절하면 웹에서 가입한
 * 사람이 앱에서 글을 못 쓰고, 브라우저를 지우면 영구히 잠긴다.
 *
 * HTTP 를 거치지 않고 인증 계층을 직접 부른다. 인증코드는 메일로만 가므로
 * 종단 경로로는 시험할 수 없고, 확인하려는 것은 메일이 아니라 등록 규칙이다.
 *
 *   DATABASE_URL=... AUTH_SECRET=... npm run e2e:devices
 */
const { issueCode, verifyAndRegister, hashEmail, isMember, migrateAuth } =
  await import("../lib/auth.ts");
const { migrate } = await import("../lib/db.ts");

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

let bad = 0;
for (const [ok, name, detail] of results) {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) bad += 1;
}
process.exit(bad ? 1 : 0);
