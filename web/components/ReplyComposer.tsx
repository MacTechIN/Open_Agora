"use client";

import ToneNotice from "@/components/ToneNotice";
import { LIMITS, graphemeCount } from "@/lib/limits";

/**
 * 댓글 입력칸 (VS-D3).
 *
 * **네트워크를 쓰지 않습니다.** 보내는 일은 부모가 합니다 — 작성 중인 글이
 * 기기 밖으로 나가는 경로가 생기지 않도록 입력과 전송을 갈라 둡니다.
 * `scripts/check-no-draft-leak.mjs` 가 이 파일에 네트워크 호출이 없는지
 * 지킵니다.
 *
 * **답글 버튼이 없습니다.** 댓글의 댓글은 허용하지 않습니다 — 스레드가
 * 깊어지면 진영 간 소모적 설전으로 흐릅니다.
 */
export default function ReplyComposer({
  value,
  onChange,
  onSubmit,
  busy,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const count = graphemeCount(value.trim());
  const over = count > LIMITS.reply.body;
  const ready = !busy && count > 0 && !over;

  return (
    <div style={{ marginTop: 10 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="이 의견에 대한 생각을 남겨주세요"
        rows={3}
        style={{ width: "100%", fontSize: 13 }}
      />
      <div className="hint" style={{ color: over ? "#d96b5b" : undefined }}>
        {over
          ? `${count} / ${LIMITS.reply.body}자 — ${count - LIMITS.reply.body}자 초과`
          : `${count} / ${LIMITS.reply.body}자`}
      </div>

      <ToneNotice text={value} />
      {error && <div className="hint" style={{ color: "#d96b5b" }}>{error}</div>}

      <button onClick={onSubmit} disabled={!ready} style={{ marginTop: 6, fontSize: 13 }}>
        {busy ? "다는 중…" : "댓글 달기"}
      </button>
      <div className="hint" style={{ marginTop: 6 }}>
        단 댓글은 수정하거나 지울 수 없습니다.
      </div>
    </div>
  );
}
