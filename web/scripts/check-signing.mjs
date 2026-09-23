/**
 * 서명 대상 바이트가 Rust 코어와 같은지 확인한다.
 *
 * 이 형식은 코어와 서버 두 곳에 구현되어 있다. 하나로 합칠 수 없는 이유는
 * 서버가 Rust 를 부를 수 없기 때문이다. 대신 **같은 벡터 파일**을 양쪽에서
 * 대조한다 — 코어 쪽은 core/src/signing.rs 의 공용_벡터와_같은_바이트를_만든다.
 *
 * 한쪽만 고치면 앱이 올린 글이 서버에서 전부 검증 실패하는데, 그 원인은
 * 서명이 아니라 바이트 한 칸이라 로그만 봐서는 찾기 어렵다.
 *
 * 타입을 지우고 lib/*.ts 를 그대로 불러온다. 스크립트가 형식을 다시 구현하면
 * 검사가 자기 자신을 확인하게 되어 아무것도 막지 못한다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { policyPayload, opinionPayload, groupPayload, toHex, contentId } = await import("../lib/signing.ts");
const { checkSignature } = await import("../lib/verify.ts");

const doc = JSON.parse(readFileSync(join(here, "../lib/generated/signing-vectors.json"), "utf8"));

let failed = 0;
const ok = (name, detail = "") => console.log(`  OK   ${name}${detail ? "  " + detail : ""}`);
const bad = (name, detail) => { console.error(`  FAIL ${name} — ${detail}`); failed += 1; };

for (const testCase of doc.cases) {
  const input = testCase.input;
  const common = { author_did: testCase.author_did, created_at: testCase.created_at };
  const payload = testCase.kind === "policy"
    ? policyPayload({ ...common, ...input })
    : opinionPayload({ ...common, ...input });

  const actual = toHex(payload);
  if (actual !== testCase.payload_hex) {
    bad(testCase.name, "코어와 다른 바이트를 만듭니다");
    console.error(`         기대 ${testCase.payload_hex.slice(0, 64)}…`);
    console.error(`         실제 ${actual.slice(0, 64)}…`);
    continue;
  }

  // 식별자 규칙도 대조한다. 첫 의견의 서명이 주제 식별자를 덮으므로,
  // 이 규칙이 코어와 갈리면 서명이 통째로 못 쓰게 된다.
  if (testCase.id) {
    const parts = testCase.kind === "policy"
      ? [testCase.author_did, String(testCase.created_at),
         input.title, input.background, input.core_question]
      : [input.policy_id, testCase.author_did, String(testCase.created_at), input.stance,
         input.problem_definition, input.evidence_source, input.evidence_url,
         input.actionable_solution];
    const actual = await contentId(parts);
    if (actual !== testCase.id) {
      bad(testCase.name, `식별자가 코어와 다릅니다 (${actual.slice(0, 16)}… ≠ ${testCase.id.slice(0, 16)}…)`);
      continue;
    }
  }

  if (testCase.signature_hex) {
    const verdict = checkSignature(testCase.author_did, payload, testCase.signature_hex);
    if (verdict !== "valid") { bad(testCase.name, `서명 검증이 ${verdict}`); continue; }
    // 한 비트만 바꿔도 검증이 깨져야 한다. 늘 valid 를 주는 검증은 검증이 아니다.
    const tampered = new Uint8Array(payload);
    tampered[tampered.length - 1] ^= 1;
    const after = checkSignature(testCase.author_did, tampered, testCase.signature_hex);
    if (after !== "invalid") { bad(testCase.name, `내용을 바꿨는데 ${after}`); continue; }
  }
  ok(testCase.name, testCase.signature_hex ? "바이트·서명 일치" : "바이트 일치");
}

// 명부 루트 페이로드 (VS-C3a). 앵커링에 쓰므로 코어와 같아야 한다.
if (doc.group) {
  const actual = toHex(groupPayload(doc.group.root));
  if (actual !== doc.group.payload_hex) bad("명부 루트 페이로드", "코어와 다릅니다");
  else ok("명부 루트 페이로드");
}

// 서명이 없는 것과 틀린 것을 구분하는지.
const did = doc.did;
if (checkSignature(did, new Uint8Array([1]), null) !== "unsigned") {
  bad("미서명 판정", "서명이 없는데 unsigned 가 아닙니다");
} else { ok("미서명 판정"); }
if (checkSignature(did, new Uint8Array([1]), "빨간색") !== "malformed") {
  bad("형식 오류 판정", "16진수가 아닌데 malformed 가 아닙니다");
} else { ok("형식 오류 판정"); }

if (failed) {
  console.error(`\n서명 형식이 코어와 어긋납니다 (${failed}건).`);
  process.exit(1);
}
console.log("  OK   서명 형식이 코어와 같음");
