/**
 * scope 문자열을 Semaphore 의 필드 원소로 바꾼다 (VS-C3a).
 *
 * **서버와 브라우저가 같은 규칙을 써야 합니다.** 다르면 클라이언트가 만든
 * 증명의 scope 가 서버가 기대한 값과 달라 전부 거부됩니다.
 *
 * 앞 31바이트(62자)만 씁니다. BN254 필드는 254비트라 32바이트를 그대로 넣으면
 * 넘칠 수 있습니다. 잘라 쓰는 것이 문제가 되지 않는 이유는, 이 값이 비밀이
 * 아니라 **대상을 가리키는 이름**이기 때문입니다 — 우리 식별자는 SHA-256
 * 이므로 앞 248비트만으로도 충돌을 걱정할 이유가 없습니다.
 */
export function hashScopeServer(scope: string): string {
  const hex = scope.replace(/[^0-9a-f]/gi, "").slice(0, 62) || "0";
  return BigInt("0x" + hex).toString();
}
