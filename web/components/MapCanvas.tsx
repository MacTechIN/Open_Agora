"use client";

import { useEffect, useState } from "react";
import { loadPhrase, provePseudonym } from "@/lib/anon-client";

/**
 * 여론 지형도 (VS-F4).
 *
 * 점 하나가 사람 한 명입니다. **누구인지는 아무도 알 수 없습니다** — 서버도
 * 화면도 점에 이름을 붙이지 않고, 개인의 반응 이력이 공개되지 않으므로
 * 남의 점을 짚어낼 단서도 없습니다.
 *
 * 내 위치만 따로 표시할 수 있습니다. 영지식 증명으로 본인임을 보인 뒤에요.
 */
type PublicMap = {
  ready: boolean;
  reason?: string;
  participants: number;
  k: number;
  silhouette: number;
  clusters: Array<{ id: number; size: number; x: number; y: number }>;
  points: Array<[number, number, number]>;
  updated_at: number;
};

/** 군집 색. 어느 군집도 시각적으로 우대하지 않도록 채도를 맞춘다. */
const COLORS = ["#4b9e7f", "#6a5acd", "#d9a441", "#9e5b4a", "#4c8dff"];

export default function MapCanvas({ map }: { map: PublicMap }) {
  const [mine, setMine] = useState<{ x: number; y: number; cluster: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasPhrase, setHasPhrase] = useState(false);

  useEffect(() => { setHasPhrase(Boolean(loadPhrase())); }, []);

  if (!map.ready) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>{map.reason ?? "아직 지형도를 만들 수 없습니다."}</p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          사람이 몇 안 될 때 점 구름은 익명이 아닙니다 — 누가 참여했는지 아는
          사람에게는 점이 곧 이름입니다. 그래서 일정 인원이 모일 때까지
          공개하지 않습니다.
        </p>
      </div>
    );
  }

  // 좌표를 화면 상자에 맞춘다. 축 자체에는 뜻이 없다 — 주성분일 뿐이고,
  // 뜻은 "어느 점들이 서로 가까운가"에 있다.
  const all = [...map.points, ...(mine ? [[mine.x, mine.y, mine.cluster] as const] : [])];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 0.08;
  const spread = (values: number[]) => {
    const lo = Math.min(...values), hi = Math.max(...values);
    const range = hi - lo || 1;
    return (v: number) => ((v - lo) / range) * (1 - 2 * pad) + pad;
  };
  const sx = spread(xs), sy = spread(ys);

  async function locate() {
    setBusy(true);
    setNote(null);
    try {
      const phrase = loadPhrase();
      if (!phrase) throw new Error("복구 문구가 없습니다. 시민 인증에서 등록해 주세요.");
      setNote("본인 확인 증명을 만드는 중… (몇 초 걸립니다)");

      // 반응과 같은 고정 scope 로 증명한다. 그래야 나오는 필명이 내 반응의
      // 것과 같아 서버가 좌표를 찾을 수 있다.
      const proof = await provePseudonym(phrase);
      const response = await fetch("/api/opinion-map/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "위치를 찾지 못했습니다");
      if (data.absent) {
        setNote("아직 지형도에 들어가지 않았습니다. 의견에 반응을 몇 번 남겨 보세요.");
        return;
      }
      setMine(data);
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <svg viewBox="0 0 100 100" style={{ width: "100%", aspectRatio: "1 / 1" }}
             role="img" aria-label={`여론 지형도. 참여 ${map.participants}명, 군집 ${map.k}개`}>
          {map.points.map(([x, y, cluster], i) => (
            <circle key={i} cx={sx(x) * 100} cy={sy(y) * 100} r={0.9}
                    fill={COLORS[cluster % COLORS.length]} opacity={0.55} />
          ))}
          {mine && (
            <>
              <circle cx={sx(mine.x) * 100} cy={sy(mine.y) * 100} r={3.2}
                      fill="none" stroke="#fff" strokeWidth={1.1} />
              <circle cx={sx(mine.x) * 100} cy={sy(mine.y) * 100} r={1.6} fill="#fff" />
            </>
          )}
        </svg>

        <div className="muted" style={{ fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {map.clusters.map((c) => (
            <span key={c.id}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9,
                             background: COLORS[c.id % COLORS.length], marginRight: 5 }} />
              군집 {c.id + 1} · {c.size}명
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <button onClick={locate} disabled={busy || !hasPhrase || Boolean(mine)}>
          {busy ? "확인 중…" : mine ? "내 위치가 표시되었습니다" : "내 위치 보기"}
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          {hasPhrase
            ? "본인임을 영지식 증명으로 보인 뒤에만 표시합니다. 서버는 그것이 누구인지 끝내 알지 못하고, 다른 사람의 위치는 누구도 조회할 수 없습니다."
            : "내 위치를 보려면 복구 문구가 필요합니다. 시민 인증에서 등록해 주세요."}
        </div>
        {note && <div className="hint" style={{ marginTop: 6 }}>{note}</div>}
      </div>
    </>
  );
}
