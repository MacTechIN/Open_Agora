/**
 * 작성자 서명 확인 (VS-A4) — 서버 전용.
 *
 * 글을 올릴 때 기기 키로 만든 서명을 받아 확인한다. 운영자가 글을 고치면
 * 검증이 깨지므로 **고친 사실이 드러난다**(`docs/16_ONCHAIN_PLAN.md` 1단계).
 *
 * ## 왜 시각을 클라이언트가 정하는가
 *
 * 서명이 시각을 덮으려면 서명하는 쪽이 그 값을 알아야 한다. 서버가 정하면
 * 서버가 나중에 시각을 바꿔도 검증이 통과하고, 그러면 순서를 조작할 수 있다.
 * 대신 서버가 허용 범위를 좁게 본다 — 아래 SKEW_MS.
 *
 * ## 왜 서명 없는 글을 아직 받는가
 *
 * 이미 배포된 앱들이 서명을 보내지 않는다. 지금 막으면 그 앱을 쓰는 사람은
 * 갱신하기 전까지 글을 쓸 수 없다. 대신 **서명이 있는데 틀리면 거절한다** —
 * 그것은 위조이거나 버그이고, 둘 다 받아서는 안 된다.
 *
 * 모든 클라이언트가 갱신되면 REQUIRE_SIGNATURES=1 로 막는다. 그 전까지는
 * 서명 없는 글이 화면에 「미서명」으로 표시된다.
 */
import { checkSignature } from "./verify.ts";
import { opinionPayload, policyPayload, type SignableOpinion, type SignablePolicy } from "./signing.ts";
import { ValidationError } from "./validate";

/**
 * 허용하는 시각 오차. 기기 시계가 몇 분 어긋나는 것은 흔하다.
 * 넓히면 순서를 조작할 여지가 생기고, 좁히면 멀쩡한 글이 거절된다.
 */
const SKEW_MS = 5 * 60 * 1000;

/** 모든 클라이언트가 서명을 보내게 되면 이것을 켠다. */
const required = process.env.REQUIRE_SIGNATURES === "1";

/**
 * 클라이언트가 보낸 작성 시각을 받는다.
 *
 * 없으면 서버 시각을 쓴다(서명하지 않는 옛 클라이언트). 있으면 범위를 본다.
 */
export function resolveCreatedAt(value: unknown): number {
  const now = Date.now();
  if (value === undefined || value === null) return now;

  const at = Number(value);
  if (!Number.isFinite(at) || !Number.isInteger(at)) {
    throw new ValidationError("작성 시각이 올바르지 않습니다");
  }
  if (Math.abs(at - now) > SKEW_MS) {
    // 기기 시계가 틀린 것이 대부분이므로 그렇게 안내한다.
    throw new ValidationError("기기 시계가 서버와 많이 다릅니다. 시간을 맞추고 다시 시도해 주세요.");
  }
  return at;
}

function hexOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

/** 검증을 통과한 서명을 돌려준다. 틀리면 거절한다. */
function verified(did: string, payload: Uint8Array, raw: unknown, what: string): string | null {
  const signature = hexOrNull(raw);
  if (!signature) {
    if (required) {
      throw new ValidationError(`${what}에 서명이 없습니다. 앱을 최신판으로 갱신해 주세요.`);
    }
    return null;
  }

  const verdict = checkSignature(did, payload, signature);
  if (verdict === "valid") return signature;
  if (verdict === "malformed") {
    throw new ValidationError(`${what}의 서명 형식이 올바르지 않습니다`);
  }
  // 내용과 서명이 맞지 않는다. 보낸 쪽 버그이거나 위조다.
  throw new ValidationError(
    `${what}의 서명이 내용과 맞지 않습니다. 저장하지 않았습니다.`
  );
}

export function verifyPolicySignature(policy: SignablePolicy, raw: unknown): string | null {
  return verified(policy.author_did, policyPayload(policy), raw, "주제");
}

export function verifyOpinionSignature(opinion: SignableOpinion, raw: unknown): string | null {
  return verified(opinion.author_did, opinionPayload(opinion), raw, "의견");
}
