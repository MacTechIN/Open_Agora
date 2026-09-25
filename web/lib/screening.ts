/**
 * 온디바이스 톤 스크리닝 — 1단계 게이트 (VS-E1).
 *
 * **이 파일은 브라우저 안에서만 돕니다.** 네트워크를 쓰지 않고, 쓰면 안 됩니다.
 * 작성 중인 정치적 의견을 서버로 보내지 않는 것이 이 단계의 존재 이유입니다 —
 * 타이핑하는 동안 매 글자가 서버로 간다면 지우고 다시 쓴 문장까지 남습니다.
 * **쓰다 만 말은 쓴 말보다 사람을 더 많이 드러냅니다.**
 *
 * 코어(`core/src/screening.rs`)와 **같은 점수**를 내야 합니다. 두 구현이
 * 갈리면 같은 문장이 기기마다 다르게 판정됩니다. 공용 벡터
 * (`contracts/screening-vectors.json`)가 양쪽을 대조합니다.
 *
 * ## 아무것도 막지 않습니다
 *
 * 0.30을 넘으면 2단계로 보낼 뿐이고 사용자는 언제나 원문을 게시할 수
 * 있습니다. 점수가 게시를 막는 순간 코치가 아니라 검열이 됩니다.
 *
 * ## 지금은 스텁입니다
 *
 * 명세는 KcELECTRA ONNX 임베딩을 요구하지만, 실측한 가장 작은 양자화판이
 * 96MB 라 타이핑마다 도는 기기 안 모델로 쓸 수 없습니다. 대놓고 드러나는
 * 욕설과 초성 비하만 잡고 맥락이나 새 은어는 잡지 못합니다.
 */

/** 2단계로 보낼 문턱. 이 아래는 서버를 부르지 않는다. */
export const STEP2_THRESHOLD = 0.3;

/** 배너 문턱. 2단계가 판단하며 여기서는 쓰지 않는다. */
export const BANNER_THRESHOLD = 0.65;

/**
 * 어휘와 무게. `core/src/screening.rs` 의 LEXICON 과 같아야 한다.
 *
 * **정치 용어는 넣지 않는다.** 정당·정치인·이념을 가리키는 말을 목록에 넣는
 * 순간 이 플랫폼은 막으려던 바로 그 일을 하게 된다.
 */
const LEXICON: Array<[string, number]> = [
  ["ㅅㅂ", 0.55], ["ㅆㅂ", 0.6], ["ㅄ", 0.55], ["ㅂㅅ", 0.55],
  ["ㅈㄹ", 0.45], ["ㄱㅅㄲ", 0.7], ["ㅁㅊ", 0.4], ["ㅈㄴ", 0.35],
  ["씨발", 0.7], ["시발", 0.65], ["좆", 0.7], ["병신", 0.65],
  ["새끼", 0.4], ["지랄", 0.5], ["미친놈", 0.55], ["미친년", 0.6],
  ["꺼져", 0.35], ["닥쳐", 0.35], ["멍청이", 0.38], ["등신", 0.45],
  ["벌레같", 0.45], ["쓰레기같", 0.45],
];

export type Screening = {
  score: number;
  needs_review: boolean;
  /** 걸린 표현. **화면에 그대로 보여주지 않는다** — 목록이 우회 안내서가 된다. */
  matched: string[];
};

/**
 * 회피 표기를 걷어낸다.
 *
 * `ㅅ.ㅂ`, `ㅅ ㅂ` 을 같은 것으로 본다. 완벽하지 않고 완벽할 수도 없다 —
 * 이 단계의 목적은 대놓고 드러나는 것을 싸게 잡는 것이지 모든 우회를 막는
 * 것이 아니다.
 */
function normalize(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const jamo = ch >= "ㄱ" && ch <= "ㅣ";
    if (jamo || /\p{L}|\p{N}/u.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

/** 같은 표현이 여러 번 나와도 한 번만 센다. 반복은 강조일 뿐이다. */
export function screen(text: string): Screening {
  const haystack = normalize(text);
  let score = 0;
  const matched: string[] = [];

  for (const [term, weight] of LEXICON) {
    const needle = normalize(term);
    if (needle && haystack.includes(needle)) {
      // 겹칠수록 오르되 1을 넘지 않는다. 확률처럼 합성한다.
      score = 1 - (1 - score) * (1 - weight);
      matched.push(term);
    }
  }

  return { score, needs_review: score >= STEP2_THRESHOLD, matched };
}
