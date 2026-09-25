"use client";

import { useMemo } from "react";
import { screen, STEP2_THRESHOLD } from "@/lib/screening";

/**
 * 톤 스크리닝 표시 (VS-E1).
 *
 * **기기 안에서만 돕니다.** 여기서 네트워크를 부르면 이 단계의 존재 이유가
 * 사라집니다 — `scripts/check-no-draft-leak.mjs` 가 지킵니다.
 *
 * ## 무엇을 보여주고 무엇을 감추는가
 *
 * 점수도, 걸린 표현도 보여주지 않습니다.
 *
 * - **점수**를 보여주면 사람들이 점수를 낮추는 글쓰기를 하게 됩니다. 목표는
 *   낮은 점수가 아니라 좋은 논증입니다.
 * - **걸린 표현**을 보여주면 그것을 피해 쓰는 법을 알려 주는 셈이 되어,
 *   어휘 목록이 우회 안내서가 됩니다.
 *
 * ## 막지 않습니다
 *
 * 버튼을 잠그지 않고 경고도 아닙니다. 다시 볼 기회를 주는 한 줄일 뿐입니다.
 * 명세의 2단계(정밀 분류)와 3단계(순화문 제안)가 붙기 전까지는 여기까지가
 * 할 수 있는 전부이고, 그 이상을 하는 척하면 안 됩니다.
 */
export default function ToneNotice({ text }: { text: string }) {
  // 타이핑마다 돕니다. 어휘 훑기라 비용이 없고, 신경망이 들어오면 이 자리에
  // 지연시간 예산(30ms)이 생깁니다.
  const flagged = useMemo(() => screen(text).needs_review, [text]);

  if (!flagged) return null;

  return (
    <div
      className="hint"
      style={{ marginTop: 6, color: "#d9a441" }}
      role="status"
    >
      거친 표현이 섞여 있을 수 있습니다. 그대로 올리셔도 됩니다 —
      다만 <strong>논거가 표현에 가려지면 반대편이 읽지 않습니다.</strong>
    </div>
  );
}
