/**
 * 작성자 서명의 서명 대상 바이트 (VS-A4).
 *
 * **코어(core/src/signing.rs)와 같은 바이트를 만들어야 한다.** 두 구현이
 * 갈리면 앱이 올린 글이 서버에서 전부 검증 실패하는데, 그 원인은 서명이
 * 아니라 바이트 한 칸이라 찾기 어렵다. 그래서 공용 벡터
 * (contracts/signing-vectors.json)를 양쪽에서 대조한다.
 *
 * 이 파일은 **브라우저에서도 돈다.** node: 모듈을 import 하지 않는다 —
 * 검증(서버 전용)은 lib/verify.ts 에 있다.
 *
 * 형식:  <도메인>\n<길이>:<바이트><길이>:<바이트>...
 * 길이는 UTF-8 바이트 수를 십진수로 적는다. 구분자가 아니라 길이를 쓰는 이유는
 * 본문에 줄바꿈과 콜론이 들어갈 수 있기 때문이다.
 */

const POLICY_DOMAIN = "civicagora/policy/v1";
const OPINION_DOMAIN = "civicagora/opinion/v1";
/** 익명 회원 명부 루트 (VS-C3a). 서명용이 아니라 앵커링용이다. */
const GROUP_DOMAIN = "civicagora/group/v1";

export type SignablePolicy = {
  author_did: string;
  created_at: number;
  title: string;
  category: string;
  background: string;
  core_question: string;
  official_source_url: string;
  target_agency?: string | null;
};

export type SignableOpinion = {
  policy_id: string;
  author_did: string;
  created_at: number;
  stance: string;
  problem_definition: string;
  evidence_source: string;
  evidence_url: string;
  actionable_solution: string;
};

function encode(domain: string, fields: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(domain + "\n")];
  for (const field of fields) {
    const bytes = encoder.encode(field);
    parts.push(encoder.encode(`${bytes.length}:`), bytes);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function policyPayload(policy: SignablePolicy): Uint8Array {
  return encode(POLICY_DOMAIN, [
    policy.author_did,
    String(policy.created_at),
    policy.title,
    policy.category,
    policy.background,
    policy.core_question,
    policy.official_source_url,
    // 없는 기관과 빈 문자열을 같게 본다. 확정된 주제의 기관은 비어 있으면
    // 저장되지 않으므로 둘이 같은 상태다.
    policy.target_agency ?? "",
  ]);
}

export function opinionPayload(card: SignableOpinion): Uint8Array {
  return encode(OPINION_DOMAIN, [
    card.policy_id,
    card.author_did,
    String(card.created_at),
    card.stance,
    card.problem_definition,
    card.evidence_source,
    card.evidence_url,
    card.actionable_solution,
  ]);
}

/**
 * 명부 루트의 앵커 대상 바이트 (VS-C3a).
 *
 * 명부가 그때 어떤 모습이었는지를 앵커에 남겨야, 운영자가 나중에 가짜 회원을
 * 끼워 넣은 것이 드러난다. 코어의 group_payload 와 같아야 한다.
 */
export function groupPayload(root: string): Uint8Array {
  return encode(GROUP_DOMAIN, [root]);
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 16진 문자열을 바이트로. 형식이 틀리면 null — 던지지 않는다. */
export function fromHex(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * did:key 에서 압축 공개키(33바이트)를 꺼낸다.
 *
 * 형식이 틀리면 null 을 준다. 위조와 오타를 구분할 수 없는 자리이므로
 * 예외를 던져 500 을 만들기보다 호출한 쪽이 판단하게 한다.
 */
export function publicKeyFromDid(did: string): Uint8Array | null {
  const prefix = "did:key:z";
  if (!did.startsWith(prefix)) return null;
  const decoded = base58Decode(did.slice(prefix.length));
  // multicodec p256-pub = 0x1200 → varint [0x80, 0x24]
  if (!decoded || decoded.length !== 35 || decoded[0] !== 0x80 || decoded[1] !== 0x24) return null;
  const point = decoded.slice(2);
  if (point[0] !== 0x02 && point[0] !== 0x03) return null;
  return point;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(text: string): Uint8Array | null {
  const bytes = [0];
  for (const character of text) {
    const value = BASE58.indexOf(character);
    if (value < 0) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // 앞쪽 '1' 은 0 바이트다.
  let leading = 0;
  while (leading < text.length && text[leading] === "1") leading += 1;
  return new Uint8Array([...new Array(leading).fill(0), ...bytes.reverse()]);
}

/**
 * 내용 해시로 식별자를 만든다.
 *
 * **코어(core/src/card.rs content_id)와 같은 규칙이어야 한다.** 첫 의견의
 * 서명이 주제 식별자를 덮으므로, 두 규칙이 갈리면 앱이 올린 첫 의견이
 * 서버에서 전부 검증 실패한다. 공용 벡터가 두 구현을 대조한다.
 *
 * 난수를 쓰지 않으므로 같은 입력이 같은 식별자를 만들고, 버튼을 두 번 눌러도
 * 글이 두 개 생기지 않는다. 필드마다 길이를 함께 넣어 경계가 섞이지 않게 한다.
 */
export async function contentId(parts: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const bytes = encoder.encode(part);
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(bytes.length));
    chunks.push(length, bytes);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }

  const digest = await crypto.subtle.digest("SHA-256", joined as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
