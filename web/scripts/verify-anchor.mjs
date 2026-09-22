/**
 * 제3자 검증 CLI (VS-F6).
 *
 * 서버가 주는 말을 믿지 않고 **직접 다시 계산합니다.**
 *
 *   1. 공개 API 에서 글을 받는다
 *   2. 글의 내용으로 잎 해시를 다시 만든다   ← 서버가 준 잎을 쓰지 않는다
 *   3. 증명 경로를 적용해 루트를 다시 만든다
 *   4. 배치에 기록된 루트와 대조한다
 *   5. OpenTimestamps 영수증을 내려받아 공식 도구로 확인할 방법을 알려준다
 *
 * 2번이 핵심입니다. 서버가 준 잎 해시를 그대로 쓰면 "서버가 준 숫자끼리
 * 맞는다"만 확인하게 되고, 그것은 검증이 아닙니다.
 *
 * 쓰는 법:
 *   node --experimental-strip-types scripts/verify-anchor.mjs <policy-id>
 *   node --experimental-strip-types scripts/verify-anchor.mjs --opinion <opinion-id>
 *   CIVICAGORA_BASE=http://127.0.0.1:3111 node ... 로 서버를 바꿀 수 있습니다
 */
import { writeFileSync } from "node:fs";

const { policyPayload, opinionPayload } = await import("../lib/signing.ts");
const { leafHash, merkleApply, toHex } = await import("../lib/merkle.ts");

const BASE = (process.env.CIVICAGORA_BASE ?? "https://open-agora.vercel.app").replace(/\/$/, "");
const args = process.argv.slice(2);
const kind = args.includes("--opinion") ? "opinion" : "policy";
const id = args.find((a) => !a.startsWith("--"));

if (!id) {
  console.error("쓰는 법: verify-anchor.mjs [--opinion] <식별자>");
  process.exit(2);
}

const get = async (path) => {
  const response = await fetch(BASE + path);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
};

console.log(`공론장: ${BASE}`);
console.log(`대상:   ${kind} ${id}\n`);

// ── 1. 글을 받는다 ─────────────────────────────────────────────────
let item;
if (kind === "policy") {
  const { status, body } = await get(`/api/policies/${id}`);
  if (status !== 200) { console.error(`주제를 받지 못했습니다 (HTTP ${status})`); process.exit(1); }
  item = body.policy;
} else {
  // 의견은 주제를 거쳐야 받을 수 있다. 증명이 알려주는 배치에서 주제를 찾는다.
  const { status, body } = await get(`/api/anchor/proof?kind=opinion&id=${id}`);
  if (status !== 200) { console.error(`증명을 받지 못했습니다: ${body.error ?? status}`); process.exit(1); }
  const list = await get("/api/policies");
  for (const summary of list.body) {
    const detail = await get(`/api/policies/${summary.id}`);
    const found = (detail.body.opinions ?? []).find((o) => o.id === id);
    if (found) { item = found; break; }
  }
  if (!item) { console.error("의견을 찾지 못했습니다"); process.exit(1); }
}

// ── 2. 잎 해시를 직접 만든다 ───────────────────────────────────────
// 서버가 준 잎을 쓰지 않는다. 여기가 이 스크립트의 존재 이유다.
const payload = kind === "policy" ? policyPayload(item) : opinionPayload(item);
const leaf = toHex(await leafHash(payload));
console.log(`직접 계산한 잎: ${leaf}`);

// ── 3~4. 증명을 적용해 루트를 만들고 대조한다 ──────────────────────
const { status, body: proof } = await get(`/api/anchor/proof?kind=${kind}&id=${id}`);
if (status !== 200) {
  console.error(`\n✗ 증명을 받지 못했습니다: ${proof.error ?? status}`);
  if (proof.anchored === false) {
    console.error("  아직 앵커 배치에 들어가지 않았습니다. 다음 배치를 기다리십시오.");
  }
  process.exit(1);
}

if (proof.leaf !== leaf) {
  console.error(`\n✗ 서버가 기록한 잎이 글의 내용과 다릅니다.`);
  console.error(`    서버: ${proof.leaf}`);
  console.error(`    계산: ${leaf}`);
  console.error(`  글이 앵커에 들어간 뒤 바뀌었다는 뜻입니다.`);
  process.exit(1);
}
console.log(`서버가 기록한 잎과 일치`);

const rebuilt = toHex(await merkleApply(
  Uint8Array.from(leaf.match(/../g).map((h) => parseInt(h, 16))),
  proof.steps
));
console.log(`증명 ${proof.steps.length}단계로 만든 루트: ${rebuilt}`);
console.log(`배치 #${proof.batch_id} 에 기록된 루트:    ${proof.root}`);

if (rebuilt !== proof.root) {
  console.error("\n✗ 루트가 맞지 않습니다. 증명이 유효하지 않습니다.");
  process.exit(1);
}
console.log(`\n✓ 이 글은 배치 #${proof.batch_id}(잎 ${proof.leaf_count}건)의 루트에 들어 있습니다.`);

// ── 5. 영수증 ──────────────────────────────────────────────────────
if (proof.ots_status !== "stamped" || proof.calendars.length === 0) {
  console.log(`\n다만 이 배치는 아직 외부 기록에 남지 않았습니다 (상태: ${proof.ots_status}).`);
  console.log("루트가 우리 서버 안에만 있으므로, 여기까지는 운영자를 믿는 것과 같습니다.");
  process.exit(0);
}

const receipt = await fetch(`${BASE}/api/anchor/batches/${proof.batch_id}/receipt`);
if (!receipt.ok) {
  console.log(`\n영수증을 내려받지 못했습니다 (HTTP ${receipt.status}).`);
  process.exit(0);
}
const file = `civicagora-batch-${proof.batch_id}.ots`;
writeFileSync(file, Buffer.from(await receipt.arrayBuffer()));

console.log(`\n영수증을 ${file} 로 받았습니다. 공식 도구로 확인하십시오:`);
console.log(`\n    pip install opentimestamps-client`);
console.log(`    ots verify -d ${proof.root} ${file}\n`);
console.log("낸 지 얼마 안 된 배치는 「Pending confirmation in Bitcoin blockchain」이");
console.log("나옵니다. 정상입니다 — 달력이 받아 두었고 비트코인 블록에 들어가기를");
console.log("기다리는 중입니다. 보통 몇 시간 뒤 `ots upgrade`로 블록 증명을 받습니다.");
console.log(`\n    ots upgrade ${file}`);
console.log(`    ots verify -d ${proof.root} ${file}\n`);
console.log("이 마지막 단계는 우리 코드를 전혀 쓰지 않습니다. 그것이 요점입니다 —");
console.log("루트가 비트코인에 언제 커밋되었는지는 우리가 아니라 비트코인이 말합니다.");
