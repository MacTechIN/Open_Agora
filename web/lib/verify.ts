/**
 * 작성자 서명 검증 (서버 전용).
 *
 * **node:crypto 를 쓰므로 클라이언트 컴포넌트에서 import 하면 안 된다.**
 * 서명 대상 바이트를 만드는 쪽은 lib/signing.ts 에 있고 브라우저에서도 돈다.
 *
 * 압축된 공개키를 SPKI DER 로 감싸 OpenSSL 에 넘긴다. 직접 점 압축을 푸는
 * 대신 이렇게 하는 이유는, 모듈러 제곱근을 손으로 구현하면 틀려도 조용히
 * 틀리기 때문이다.
 */
import { createPublicKey, verify } from "node:crypto";
import { fromHex, publicKeyFromDid } from "./signing.ts";

/**
 * P-256 SPKI DER 의 고정 앞부분.
 *
 * SEQUENCE(57) { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING(33+1) }
 * 뒤에 33바이트 압축 점이 붙는다.
 */
const SPKI_PREFIX = Uint8Array.from([
  0x30, 0x39, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x22, 0x00,
]);

export type SignatureCheck = "unsigned" | "valid" | "invalid" | "malformed";

/**
 * 서명을 확인한다.
 *
 * "없음"과 "틀림"을 구분한다. VS-A4 이전에 올라온 글은 서명이 없고, 그것은
 * 위조가 아니다. 둘을 하나로 묶으면 오래된 글이 전부 위조로 보인다.
 */
export function checkSignature(
  did: string,
  payload: Uint8Array,
  signatureHex: string | null | undefined
): SignatureCheck {
  if (!signatureHex) return "unsigned";

  const signature = fromHex(signatureHex);
  const point = publicKeyFromDid(did);
  // P1363 은 r‖s 로 32바이트씩이다. 길이가 다르면 형식이 틀린 것이다.
  if (!signature || signature.length !== 64 || !point) return "malformed";

  try {
    const der = new Uint8Array(SPKI_PREFIX.length + point.length);
    der.set(SPKI_PREFIX, 0);
    der.set(point, SPKI_PREFIX.length);

    const key = createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" });
    const ok = verify("sha256", Buffer.from(payload), { key, dsaEncoding: "ieee-p1363" },
                      Buffer.from(signature));
    return ok ? "valid" : "invalid";
  } catch {
    // 키를 만들지 못했다는 것은 DID 가 P-256 공개키가 아니라는 뜻이다.
    return "malformed";
  }
}
