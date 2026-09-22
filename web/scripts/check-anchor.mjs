/**
 * 머클 루트가 Rust 코어와 같은지 확인한다.
 *
 * 앵커링(VS-F6)의 트리 형식이 코어와 서버 두 곳에 있다. 서버가 Rust 를 부를
 * 수 없어 하나로 합칠 수 없다. 대신 **같은 벡터 파일**을 양쪽에서 대조한다 —
 * 코어 쪽은 core/src/merkle.rs 의 공용_벡터와_같은_루트를_만든다.
 *
 * 한쪽만 고치면 서버가 만든 증명이 앱에서 통과하지 않는다. 원인이 접두사 한
 * 바이트인 경우가 많아 로그만 봐서는 찾기 어렵다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { leafHash, merkleRoot, merkleProof, merkleApply, toHex } =
  await import("../lib/merkle.ts");

const doc = JSON.parse(readFileSync(join(here, "../lib/generated/anchor-vectors.json"), "utf8"));

let failed = 0;
const ok = (name) => console.log(`  OK   ${name}`);
const bad = (name, detail) => { console.error(`  FAIL ${name} — ${detail}`); failed += 1; };

/** 벡터의 leaves_n — i 번째 잎이 leaf(바이트 [i]) 인 목록. */
const leaves = (n) => Promise.all(
  Array.from({ length: n }, (_, i) => leafHash(Uint8Array.from([i])))
);

const leaf = await leafHash(new TextEncoder().encode(doc.leaf.input_utf8));
if (toHex(leaf) !== doc.leaf.hash) bad("잎 해시", `${toHex(leaf)} ≠ ${doc.leaf.hash}`);
else ok("잎 해시");

for (const [count, expected] of Object.entries(doc.roots)) {
  const root = toHex(await merkleRoot(await leaves(Number(count))));
  if (root !== expected) bad(`루트 (잎 ${count}개)`, `${root.slice(0, 16)}… ≠ ${expected.slice(0, 16)}…`);
  else ok(`루트 (잎 ${count}개)`);
}

const all = await leaves(doc.proof.leaf_count);
const steps = await merkleProof(all, doc.proof.index);
const same = steps.length === doc.proof.steps.length &&
  steps.every((s, i) => s.hash === doc.proof.steps[i].hash &&
                        s.sibling_is_left === doc.proof.steps[i].sibling_is_left);
if (!same) bad("증명 경로", "코어와 다릅니다");
else ok("증명 경로");

// 증명이 실제로 루트로 이어지는지. 경로가 같아도 적용이 틀리면 소용없다.
const rebuilt = toHex(await merkleApply(all[doc.proof.index], steps));
const expectedRoot = doc.roots[String(doc.proof.leaf_count)];
if (rebuilt !== expectedRoot) bad("증명 적용", `${rebuilt.slice(0, 16)}… ≠ ${expectedRoot.slice(0, 16)}…`);
else ok("증명 적용");

// 잎 하나를 지우면 루트가 달라져야 한다. 이것이 앵커링의 목적이다.
if (toHex(await merkleRoot(all.slice(0, -1))) === expectedRoot) {
  bad("삭제 탐지", "잎을 지웠는데 루트가 같습니다");
} else ok("삭제 탐지");

if (failed) {
  console.error(`\n머클 형식이 코어와 어긋납니다 (${failed}건).`);
  process.exit(1);
}
console.log("  OK   머클 형식이 코어와 같음");
