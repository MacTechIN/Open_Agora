import type { SignatureCheck } from "@/lib/verify.ts";

/**
 * 서명 상태 표시 (VS-A4).
 *
 * 서버 컴포넌트에서만 쓴다 — 판정은 lib/verify.ts 가 하고 그것은 node:crypto 를
 * 쓴다. 이 파일은 판정 결과만 받아 그린다.
 *
 * 「검증됨」을 크게 자랑하지 않는다. 서명은 **글이 바뀌지 않았다**는 것만
 * 말하고, 글이 사실이라는 뜻은 아니기 때문이다. 대신 검증 실패는 눈에 띄게
 * 한다 — 그것은 반드시 봐야 하는 신호다.
 */
const LOOK: Record<SignatureCheck, { text: string; title: string; color: string }> = {
  valid: {
    text: "✓ 서명 확인",
    title: "작성자의 기기 키로 서명되었고, 올라온 뒤 내용이 바뀌지 않았습니다.",
    color: "#4b9e7f",
  },
  unsigned: {
    text: "서명 없음",
    title: "서명 기능이 붙기 전에 올라온 글입니다. 위조라는 뜻은 아닙니다.",
    color: "#8a8f98",
  },
  invalid: {
    text: "⚠ 서명 불일치",
    title: "서명이 내용과 맞지 않습니다. 올라온 뒤 내용이 바뀌었을 수 있습니다.",
    color: "#d96b5b",
  },
  malformed: {
    text: "⚠ 서명 형식 오류",
    title: "서명이나 시민 ID의 형식이 올바르지 않습니다.",
    color: "#d9a441",
  },
};

export default function SignatureBadge({ status }: { status: SignatureCheck }) {
  const look = LOOK[status];
  return (
    <span title={look.title} style={{ color: look.color, fontSize: 12, whiteSpace: "nowrap" }}>
      {look.text}
    </span>
  );
}
