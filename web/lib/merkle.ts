/**
 * 머클 트리 (VS-F6) — 브라우저에서도 돈다.
 *
 * **코어(core/src/merkle.rs)와 같은 루트를 만들어야 한다.** 두 구현이 갈리면
 * 서버가 만든 증명이 앱에서 통과하지 않는데, 그 원인은 접두사 한 바이트인
 * 경우가 많아 로그만 봐서는 찾기 어렵다. 공용 벡터
 * (contracts/anchor-vectors.json)가 양쪽을 대조한다.
 *
 * RFC 6962 방식:
 *   잎  = SHA-256(0x00 ‖ 바이트)
 *   내부 = SHA-256(0x01 ‖ 왼쪽 ‖ 오른쪽)
 *
 * 잎과 내부에 다른 접두사를 두는 이유는 둘을 섞을 수 없게 하기 위해서다.
 * 접두사가 없으면 내부 노드를 잎인 척 제시해 가짜 증명을 만들 수 있다.
 *
 * 홀수로 남는 노드는 복제하지 않고 그대로 올린다. 비트코인처럼 복제하면
 * 서로 다른 잎 목록이 같은 루트를 만든다(CVE-2012-2459).
 */

export type MerkleStep = { hash: string; sibling_is_left: boolean };

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined as BufferSource));
}

const LEAF = Uint8Array.from([0x00]);
const NODE = Uint8Array.from([0x01]);

/** 잎 해시. 서명과 같은 정규 바이트에서 만든다. */
export function leafHash(payload: Uint8Array): Promise<Uint8Array> {
  return sha256(LEAF, payload);
}

function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(NODE, left, right);
}

/** 한 층을 위로 접는다. 홀수로 남는 하나는 그대로 올린다. */
async function fold(level: Uint8Array[]): Promise<Uint8Array[]> {
  const next: Uint8Array[] = [];
  for (let i = 0; i + 1 < level.length; i += 2) {
    next.push(await nodeHash(level[i], level[i + 1]));
  }
  if (level.length % 2 === 1) next.push(level[level.length - 1]);
  return next;
}

function check(leaves: Uint8Array[]): void {
  // 빈 트리에 루트를 정의하지 않는다. 0으로 두면 "아무것도 없었다"와
  // "0이 들어 있었다"를 구분할 수 없다.
  if (leaves.length === 0) throw new Error("잎이 없습니다");
  for (const leaf of leaves) {
    if (leaf.length !== 32) throw new Error(`잎은 32바이트여야 합니다 (받은 길이 ${leaf.length})`);
  }
}

/** 루트. **정렬하지 않는다** — 잎의 순서 자체가 증명의 일부다. */
export async function merkleRoot(leaves: Uint8Array[]): Promise<Uint8Array> {
  check(leaves);
  let level = leaves;
  while (level.length > 1) level = await fold(level);
  return level[0];
}

export async function merkleProof(leaves: Uint8Array[], index: number): Promise<MerkleStep[]> {
  check(leaves);
  if (index < 0 || index >= leaves.length) {
    throw new Error(`${index}번 잎이 없습니다 (전체 ${leaves.length})`);
  }

  const steps: MerkleStep[] = [];
  let level = leaves;
  let position = index;
  while (level.length > 1) {
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    // 형제가 없으면(홀수로 남은 마지막) 기록할 것이 없다 — 그대로 올라간다.
    if (sibling < level.length) {
      steps.push({ hash: toHex(level[sibling]), sibling_is_left: sibling < position });
    }
    level = await fold(level);
    position = Math.floor(position / 2);
  }
  return steps;
}

/** 잎과 증명으로 루트를 다시 만든다. 대조는 부르는 쪽의 몫이다. */
export async function merkleApply(leaf: Uint8Array, steps: MerkleStep[]): Promise<Uint8Array> {
  let current = leaf;
  for (const step of steps) {
    const sibling = fromHex(step.hash);
    current = step.sibling_is_left
      ? await nodeHash(sibling, current)
      : await nodeHash(current, sibling);
  }
  return current;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    throw new Error("16진 문자열이 아닙니다");
  }
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
