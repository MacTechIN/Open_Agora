/**
 * 검증 한도 — contracts/limits.json 에서 읽는다.
 *
 * Rust 코어도 같은 파일을 읽으며, 값이 어긋나면 코어 테스트가 실패한다
 * (core/src/card.rs contract_tests).
 */
// web 바깥을 import 하면 호스팅 환경에 따라 빌드가 깨진다.
// scripts/sync-contracts.mjs 가 contracts/ 에서 복사해 둔 것을 읽는다.
import raw from "./generated/limits.json";

export const LIMITS = {
  policy: raw.policy,
  card: raw.card,
  reply: raw.reply,
  url: raw.url,
} as const;

/**
 * 사용자가 인식하는 "글자" 수를 센다.
 *
 * 코드 포인트가 아니라 자소 클러스터로 센다. 한글이 NFD로 분해되어 들어오면
 * 한 음절이 2~3개 코드 포인트가 되고, 이모지 ZWJ 조합은 여러 코드 포인트가
 * 한 글자로 보인다. 어느 경우든 사용자가 센 수와 시스템이 센 수가 어긋난다.
 *
 * Rust 코어는 unicode-segmentation 을 쓴다. 브라우저·Node 18+ 에는
 * Intl.Segmenter 가 있어 같은 기준을 쓸 수 있다.
 */
export function graphemeCount(text: string): number {
  if (!text) return 0;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    let count = 0;
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  }
  // Segmenter 가 없는 환경에서는 코드 포인트로 센다. 정확하지는 않지만
  // 서버가 멈추는 것보다는 낫다.
  return [...text].length;
}
