"use client";

import { PSEUDONYM_SCOPE, hashScopeServer, reactionMessage, type ReactionKind } from "./scope.ts";

/**
 * 익명 회원권 — 브라우저 쪽 (VS-C3a).
 *
 * ## 복구 문구가 신원이다
 *
 * 시민 ID(did:key)는 기기 안에서 만들어지고 기기 밖으로 나오지 않습니다.
 * 그래서 기기마다 다릅니다. 그것으로 표를 세면 기기 수만큼 몫이 생깁니다(D21).
 *
 * 익명 회원권은 반대로 **사람에게 묶여야** 합니다. 그래서 12단어 복구 문구에서
 * 결정적으로 만듭니다 — 같은 문구는 어느 기기에서든 같은 신원을 냅니다.
 *
 * 문구를 잃으면 익명 참여 자격을 되찾을 수 없습니다. 서버가 대신 복구해 줄 수
 * 있다면 서버가 그 사람의 표를 흉내 낼 수 있다는 뜻이므로, 복구할 수 없다는
 * 것이 이 설계의 성질입니다. 가입 화면에서 그대로 알립니다.
 *
 * ## 무거운 것은 필요할 때만 불러온다
 *
 * snarkjs 와 회로 아티팩트는 합쳐 5MB가 넘습니다. 광장을 보러 온 사람에게까지
 * 받게 할 이유가 없으므로 증명을 만들 때 동적으로 불러옵니다.
 */

/** 저장소에 고정한 아티팩트. 런타임 다운로드 경로를 두지 않는다. */
const ARTIFACTS = {
  wasm: "/semaphore/semaphore-16.wasm",
  zkey: "/semaphore/semaphore-16.zkey",
};
const TREE_DEPTH = 16;
const PHRASE_KEY = "civicagora.anon.phrase.v1";

/** 12단어 복구 문구를 만든다. */
export async function createPhrase(): Promise<string> {
  const { generateMnemonic } = await import("@scure/bip39");
  const { wordlist } = await import("@scure/bip39/wordlists/english");
  return generateMnemonic(wordlist, 128);
}

export async function isValidPhrase(phrase: string): Promise<boolean> {
  const { validateMnemonic } = await import("@scure/bip39");
  const { wordlist } = await import("@scure/bip39/wordlists/english");
  return validateMnemonic(normalize(phrase), wordlist);
}

/** 띄어쓰기와 대소문자를 고른다. 사람이 옮겨 적는 값이라 흔들린다. */
export function normalize(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

/**
 * 이 브라우저에 문구를 둔다.
 *
 * 편의일 뿐입니다 — 데이터를 지우면 사라지므로 **적어 두는 것이 본체**입니다.
 * 사생활 보호 모드나 저장소 차단에서는 예외가 나므로 감싸 둡니다.
 */
export function savePhrase(phrase: string): void {
  try {
    localStorage.setItem(PHRASE_KEY, normalize(phrase));
  } catch {
    /* 저장하지 못해도 문구 자체는 사용자가 갖고 있다 */
  }
}

export function loadPhrase(): string | null {
  try {
    return localStorage.getItem(PHRASE_KEY);
  } catch {
    return null;
  }
}

/** 문구에서 그룹에 넣을 커밋먼트를 만든다. 비밀은 나가지 않는다. */
export async function commitmentOf(phrase: string): Promise<string> {
  const { Identity } = await import("@semaphore-protocol/identity");
  return new Identity(normalize(phrase)).commitment.toString();
}

export type AnonProof = {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: string[];
};

/**
 * 한 대상(scope)에 대해 익명 증명을 만든다.
 *
 * 회원 명부를 받아 그룹을 다시 만든다. 서버가 준 루트를 그대로 쓰지 않는
 * 이유는, 그러면 서버가 아무 루트나 주고 우리가 거기 서명하게 되기 때문이다.
 * 명부에서 직접 계산해야 "내가 그 안에 있다"가 의미를 갖는다.
 */
export async function proveMembership(phrase: string, scope: string): Promise<AnonProof> {
  const [{ Identity }, { Group }, { generateProof }] = await Promise.all([
    import("@semaphore-protocol/identity"),
    import("@semaphore-protocol/group"),
    import("@semaphore-protocol/proof"),
  ]);

  const response = await fetch("/api/anon/group");
  if (!response.ok) throw new Error("회원 명부를 받지 못했습니다");
  const { commitments } = (await response.json()) as { commitments: string[] };

  const identity = new Identity(normalize(phrase));
  const mine = identity.commitment.toString();
  if (!commitments.includes(mine)) {
    throw new Error("이 복구 문구는 아직 회원으로 등록되지 않았습니다.");
  }

  const group = new Group(commitments.map(BigInt));
  // message 는 행동의 종류다. 지금은 한 가지뿐이라 1로 고정한다.
  const proof = await generateProof(identity, group, 1n, BigInt(hashScopeServer(scope)), TREE_DEPTH, ARTIFACTS);
  return proof as unknown as AnonProof;
}



/**
 * 반응 증명을 만든다 (VS-D2).
 *
 * 지지(VS-C3a)와 달리 **고정 scope** 를 씁니다. 그래야 nullifier 가 사람마다
 * 하나로 고정되어 **필명**이 되고, 브리징 행렬의 행이 생깁니다. 대신 한
 * 사람의 반응들은 서로 묶입니다 — 그것이 브리징의 전제입니다.
 *
 * 묶이는 것은 필명끼리이고, 필명은 이메일·DID 어느 쪽과도 이어지지 않습니다.
 */
export async function proveReaction(
  phrase: string,
  cardId: string,
  kind: ReactionKind,
  at: number
): Promise<AnonProof> {
  const [{ Identity }, { Group }, { generateProof }] = await Promise.all([
    import("@semaphore-protocol/identity"),
    import("@semaphore-protocol/group"),
    import("@semaphore-protocol/proof"),
  ]);

  const response = await fetch("/api/anon/group");
  if (!response.ok) throw new Error("회원 명부를 받지 못했습니다");
  const { commitments } = (await response.json()) as { commitments: string[] };

  const identity = new Identity(normalize(phrase));
  if (!commitments.includes(identity.commitment.toString())) {
    throw new Error("이 복구 문구는 아직 회원으로 등록되지 않았습니다.");
  }

  const group = new Group(commitments.map(BigInt));
  const proof = await generateProof(
    identity,
    group,
    BigInt(reactionMessage(cardId, kind, at)),
    BigInt(PSEUDONYM_SCOPE),
    TREE_DEPTH,
    ARTIFACTS
  );
  return proof as unknown as AnonProof;
}

/**
 * 본인임을 보이는 증명 (VS-F4).
 *
 * 반응과 **같은 고정 scope** 를 씁니다. 그래야 나오는 nullifier 가 반응에
 * 쓴 필명과 같고, 서버가 "이 필명의 좌표"를 찾아 줄 수 있습니다.
 * 대상별 scope(지지)로 만들면 다른 필명이 나와 아무것도 찾지 못합니다.
 *
 * message 는 고정합니다. 이 증명은 무엇을 주장하는 것이 아니라 **누구인지를
 * 밝히는 것**이기 때문입니다.
 */
export async function provePseudonym(phrase: string): Promise<AnonProof> {
  const [{ Identity }, { Group }, { generateProof }] = await Promise.all([
    import("@semaphore-protocol/identity"),
    import("@semaphore-protocol/group"),
    import("@semaphore-protocol/proof"),
  ]);

  const response = await fetch("/api/anon/group");
  if (!response.ok) throw new Error("회원 명부를 받지 못했습니다");
  const { commitments } = (await response.json()) as { commitments: string[] };

  const identity = new Identity(normalize(phrase));
  if (!commitments.includes(identity.commitment.toString())) {
    throw new Error("이 복구 문구는 아직 회원으로 등록되지 않았습니다.");
  }

  const group = new Group(commitments.map(BigInt));
  const proof = await generateProof(
    identity, group, 1n, BigInt(PSEUDONYM_SCOPE), TREE_DEPTH, ARTIFACTS
  );
  return proof as unknown as AnonProof;
}
