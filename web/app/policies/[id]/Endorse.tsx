"use client";

import { useEffect, useState } from "react";
import { loadPhrase, proveMembership } from "@/lib/anon-client";

/**
 * 익명 지지 (VS-C3a).
 *
 * 한 사람이 한 주제에 한 번만 누를 수 있고, **서버는 누가 눌렀는지 알지
 * 못합니다.** 영지식 증명으로 "이 그룹의 누군가"임만 보이기 때문입니다.
 *
 * 누른 사실을 이 브라우저에 기억하지 않습니다. 기억하면 그 기록이 곧
 * "이 브라우저 주인이 이 주제를 지지했다"는 증거가 되어, 서버가 모르게 하려던
 * 것을 브라우저가 대신 남기게 됩니다. 대신 서버가 nullifier 로 판단합니다.
 */
export default function Endorse({ policyId, initial }: { policyId: string; initial: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hasPhrase, setHasPhrase] = useState(false);

  useEffect(() => { setHasPhrase(Boolean(loadPhrase())); }, []);

  async function endorse() {
    setBusy(true);
    setNote(null);
    try {
      const phrase = loadPhrase();
      if (!phrase) throw new Error("복구 문구가 없습니다. 시민 인증에서 등록해 주세요.");

      // 증명을 만드는 데 몇 초 걸립니다. 회로와 아티팩트를 처음 불러올 때가
      // 가장 오래 걸리므로, 기다린다는 것을 화면에 알립니다.
      setNote("익명 증명을 만드는 중… (몇 초 걸립니다)");
      const proof = await proveMembership(phrase, policyId);

      const response = await fetch(`/api/policies/${policyId}/endorse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const data = await response.json();
      if (response.status === 409) { setNote("이미 지지하셨습니다."); return; }
      if (!response.ok) throw new Error(data.error ?? "지지를 남기지 못했습니다");

      setCount(data.count ?? count + 1);
      setNote("지지가 익명으로 기록되었습니다.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <strong>이 주제를 공론화할 가치가 있다고 보십니까?</strong>
          <div className="hint" style={{ marginTop: 4 }}>
            지지 <strong>{count}</strong>명 · 한 사람이 한 번만 누를 수 있고,
            누가 눌렀는지는 서버도 알지 못합니다.
          </div>
        </div>
        <button onClick={endorse} disabled={busy || !hasPhrase} style={{ whiteSpace: "nowrap" }}>
          {busy ? "만드는 중…" : "익명으로 지지"}
        </button>
      </div>

      {!hasPhrase && (
        <div className="hint" style={{ marginTop: 10 }}>
          익명 참여에는 복구 문구가 필요합니다. <a href="/register">시민 인증</a>에서
          등록해 주세요.
        </div>
      )}
      {note && <div className="hint" style={{ marginTop: 10 }}>{note}</div>}
    </div>
  );
}
