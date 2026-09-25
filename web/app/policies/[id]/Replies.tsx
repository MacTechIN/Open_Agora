"use client";

import { useState } from "react";
import ReplyComposer from "@/components/ReplyComposer";
import { loadOrCreateDid, signWithDevice } from "@/lib/identity";
import { replyPayload } from "@/lib/signing";

/**
 * 댓글 (VS-D3).
 *
 * 카드 아래 한 단계만 있습니다. **답글 버튼이 없습니다** — 스레드가 깊어지면
 * 진영 간 소모적 설전으로 흐르기 때문입니다(`docs/00_PRODUCT_SPEC.md` §4).
 *
 * **반응 버튼도 없습니다.** 브리징 신호는 카드 단위로만 모읍니다. 댓글에
 * 반응을 허용하면 신호가 두 층위로 갈립니다.
 *
 * 톤 스크리닝은 카드와 같게 적용합니다 — 기기 안에서 돌고, 막지 않습니다.
 */
type Reply = {
  id: string;
  body: string;
  author_did: string;
  created_at: number;
  signature: string | null;
};

export default function Replies({ cardId, initial }: { cardId: string; initial: Reply[] }) {
  const [replies, setReplies] = useState(initial);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const did = await loadOrCreateDid();
      const createdAt = Date.now();
      const trimmed = body.trim();

      // 카드와 같은 방식으로 서명한다. 운영자가 댓글을 고치면 드러나야 한다.
      const signature = await signWithDevice(
        replyPayload({ card_id: cardId, author_did: did, created_at: createdAt, body: trimmed })
      );

      const response = await fetch(`/api/cards/${cardId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed, author_did: did, created_at: createdAt, signature }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "댓글을 달지 못했습니다");

      setReplies((before) => [...before, {
        id: data.reply_id, body: trimmed, author_did: did,
        created_at: createdAt, signature,
      }]);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "transparent", border: "none", padding: 0,
                 color: "var(--muted)", fontSize: 12, cursor: "pointer" }}
      >
        {`댓글 ${replies.length}${open ? " 접기" : ""}`}
      </button>

      {open && (
        <>
          {replies.map((reply) => (
            <div key={reply.id} style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{reply.body}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {/* 필명 체계는 VS-C3b 에서 붙는다. 그때까지는 식별자 앞부분만 보인다. */}
                {reply.author_did.slice(0, 18)}…
                {/* 답글 버튼도 반응 버튼도 없다. 의도된 것이다. */}
              </div>
            </div>
          ))}

          <ReplyComposer
            value={body}
            onChange={setBody}
            onSubmit={submit}
            busy={busy}
            error={error}
          />
        </>
      )}
    </div>
  );
}
