"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OpinionForm, { EMPTY_OPINION, opinionReady, type OpinionValue } from "@/components/OpinionForm";
import { loadOrCreateDid } from "@/lib/identity";

export default function AddOpinion({ policyId, question }: { policyId: string; question: string }) {
  const router = useRouter();
  const [did, setDid] = useState<string | null>(null);
  const [opinion, setOpinion] = useState<OpinionValue>(EMPTY_OPINION);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOrCreateDid().then(setDid).catch((e) => setError(`시민 ID를 만들지 못했습니다: ${e.message}`));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/policies/${policyId}/opinions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opinion, author_did: did }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "등록하지 못했습니다");
      setOpinion({ ...EMPTY_OPINION, stance: opinion.stance });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 28 }}>
      <h3 style={{ marginTop: 0 }}>내 의견 남기기</h3>
      <div className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
        <strong>{question}</strong>
      </div>

      <OpinionForm value={opinion} onChange={setOpinion} />

      {error && <div className="error">{error}</div>}

      <button onClick={submit} disabled={!did || busy || !opinionReady(opinion)}
              style={{ width: "100%", marginTop: 6 }}>
        {busy ? "올리는 중…" : "의견 등록하기"}
      </button>
      <div className="hint" style={{ marginTop: 10 }}>
        올린 글은 수정하거나 지울 수 없습니다.
      </div>
    </div>
  );
}
