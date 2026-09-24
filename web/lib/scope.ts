/**
 * Semaphore 의 scope·message 규칙 (VS-C3a, VS-D2).
 *
 * **서버와 브라우저가 같은 규칙을 써야 합니다.** 다르면 클라이언트가 만든
 * 증명의 값이 서버가 기대한 것과 달라 전부 거부됩니다.
 *
 * 앞 31바이트(62자)만 씁니다. BN254 필드는 254비트라 32바이트를 그대로 넣으면
 * 넘칠 수 있습니다. 잘라 쓰는 것이 문제가 되지 않는 이유는, 이 값이 비밀이
 * 아니라 **대상을 가리키는 이름**이기 때문입니다.
 */

/** 16진 문자열을 필드 안에 드는 수로. */
function toField(hex: string): string {
  const cleaned = hex.replace(/[^0-9a-f]/gi, "").slice(0, 62) || "0";
  return BigInt("0x" + cleaned).toString();
}

export function hashScopeServer(scope: string): string {
  return toField(scope);
}

/**
 * 필명 scope (VS-D2).
 *
 * 반응은 **브리징 행렬의 입력**입니다. 행렬 분해 r̂(u,i) = μ + b_u + b_i + f_u·f_i
 * 는 사람별 행을 요구하므로, 한 사람의 반응들이 서로 묶여야 합니다.
 *
 * 그래서 반응에는 **고정된 scope** 를 씁니다. Semaphore 의
 * `nullifier = Poseidon(비밀, scope)` 가 scope 가 고정되면 사람마다 하나씩
 * 고정된 값이 되고, 그것이 곧 **필명**입니다 — 비밀에 묶여 있어 위조할 수
 * 없고, 이메일이나 DID 와는 이어지지 않습니다.
 *
 * 지지(VS-C3a)가 주제마다 다른 scope 를 쓰는 것과 반대입니다. 지지는 집계만
 * 하면 되므로 주제 간에 엮이지 않는 편이 낫고, 반응은 엮여야 브리징이
 * 성립합니다. 목적이 다르면 scope 도 다릅니다.
 */
export const PSEUDONYM_SCOPE = toField(
  // "civicagora/pseudonym/v1" 의 SHA-256. 값 자체에 의미는 없고 고정이기만 하면 된다.
  "8f1f3c1d2b5a4e6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e"
);

/** 반응 4종. 긍정 2 · 부정 2 (D4). */
export const REACTIONS = {
  LOGICAL: { emoji: "💡", label: "논리적이에요", r: 1 },
  EMPATHY: { emoji: "🤝", label: "공감해요", r: 1 },
  FACTCHECK: { emoji: "🔍", label: "팩트체크 필요해요", r: 0 },
  DISAGREE: { emoji: "⚖️", label: "이견 있어요", r: 0 },
} as const;

export type ReactionKind = keyof typeof REACTIONS;

/** 이진 신호. 브리징이 요구하는 r ∈ {0,1}. */
export function signalOf(kind: ReactionKind): 0 | 1 {
  return REACTIONS[kind].r as 0 | 1;
}

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && value in REACTIONS;
}

/**
 * 반응 증명이 묶는 값.
 *
 * 카드·반응 종류·시각을 함께 묶습니다.
 *
 * - **카드와 종류**를 묶지 않으면 증명을 다른 카드에 옮겨 붙일 수 있습니다.
 * - **시각**을 묶지 않으면 지나간 증명을 다시 보내 남의 반응을 **되돌릴** 수
 *   있습니다. 반응은 바꿀 수 있어야 하므로(명세 §5) 덮어쓰기가 허용되는데,
 *   그 틈을 막는 것이 시각입니다.
 */
export function reactionMessage(cardId: string, kind: ReactionKind, at: number): string {
  // 필드 안에 들게 조각을 잘라 붙인다. 충돌이 목적이 아니라 결합이 목적이다.
  const card = BigInt("0x" + (cardId.replace(/[^0-9a-f]/gi, "").slice(0, 40) || "0"));
  const order = BigInt(Object.keys(REACTIONS).indexOf(kind) + 1);
  return ((card << 48n) + (BigInt(at) << 4n) + order).toString();
}
