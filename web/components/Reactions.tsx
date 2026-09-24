"use client";

import { useEffect, useState } from "react";
import { loadPhrase, proveReaction } from "@/lib/anon-client";
import { loadOrCreateDid } from "@/lib/identity";
import { REACTIONS, type ReactionKind } from "@/lib/scope";

/**
 * 반응 4종 (VS-D2).
 *
 * 💡를 **가장 먼저, 가장 크게** 둡니다. "내 진영은 아니지만 말은 맞다"를
 * 표현하는 통로이고, 브리징 점수를 만들어내는 것이 바로 그 신호이기
 * 때문입니다(명세 §5). 배치가 곧 설계입니다.
 *
 * 누른 사실을 이 브라우저에 기억하지 않습니다. 기억하면 그 기록이
 * "이 브라우저 주인이 이 카드를 어떻게 평가했다"는 증거가 되어, 서버가 모르게
 * 하려던 것을 브라우저가 대신 남기게 됩니다.
 */
const ORDER: ReactionKind[] = ["LOGICAL", "EMPATHY", "FACTCHECK", "DISAGREE"];

export default function Reactions({
  cardId,
  authorDid,
  counts,
}: {
  cardId: string;
  authorDid: string;
  counts: Record<string, number>;
}) {
  const [shown, setShown] = useState(counts);
  const [busy, setBusy] = useState<ReactionKind | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 자기 의견인지는 **브라우저에서만** 판단합니다. 카드의 작성자는 DID 로,
  // 반응자는 필명으로 표시되고 둘은 의도적으로 이어져 있지 않아 서버가 알 수
  // 없습니다. 그래서 이 막음은 약합니다 — lib/reactions.ts 에 적어 두었습니다.
  const [isMine, setIsMine] = useState(false);
  useEffect(() => {
    loadOrCreateDid().then((did) => setIsMine(did === authorDid)).catch(() => setIsMine(false));
  }, [authorDid]);

  async function send(kind: ReactionKind) {
    setBusy(kind);
    setNote("익명 증명을 만드는 중…");
    try {
      const phrase = loadPhrase();
      if (!phrase) throw new Error("복구 문구가 없습니다. 시민 인증에서 등록해 주세요.");

      const at = Date.now();
      const proof = await proveReaction(phrase, cardId, kind, at);
      const response = await fetch(`/api/cards/${cardId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, at, proof }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "반응을 남기지 못했습니다");

      // 서버는 집계만 돌려주므로 화면 숫자는 낙관적으로 올린다. 바꾼
      // 경우에는 이전 것을 줄일 수 없다 — 무엇을 눌렀었는지 모르기 때문이다.
      // 새로고침하면 서버 집계로 맞춰진다.
      setShown((before) => ({ ...before, [kind]: (before[kind] ?? 0) + 1 }));
      setNote(data.changed ? "반응을 바꿨습니다. (새로고침하면 집계가 맞춰집니다)" : "반응을 남겼습니다.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (isMine) {
    return (
      <div className="hint" style={{ marginTop: 8 }}>
        {ORDER.map((k) => `${REACTIONS[k].emoji} ${shown[k] ?? 0}`).join("  ")}
        <span style={{ marginLeft: 8 }}>· 자기 의견에는 반응할 수 없습니다</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {ORDER.map((kind, index) => {
          const first = index === 0;
          return (
            <button
              key={kind}
              onClick={() => send(kind)}
              disabled={busy !== null}
              title={REACTIONS[kind].label}
              style={{
                // 💡가 가장 크다. 이 버튼이 브리징을 만든다.
                fontSize: first ? 15 : 13,
                padding: first ? "7px 13px" : "5px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 999,
                color: "inherit",
                opacity: busy && busy !== kind ? 0.5 : 1,
              }}
            >
              {REACTIONS[kind].emoji} {shown[kind] ?? 0}
            </button>
          );
        })}
      </div>
      {note && <div className="hint" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
