import type { ClusterRate } from "@/lib/consensus";
import { BANNER_THRESHOLD } from "@/lib/consensus";

/**
 * 합의 배너 (VS-F5).
 *
 * 군집 **모두**에서 60% 이상 찬성받은 대안 카드입니다. 이 배너가 말하는 것은
 * "평균적으로 인기 있다"가 아니라 **"어느 진영에서도 버림받지 않았다"** 입니다.
 * 그래서 군집별 찬성률을 **모두** 보여줍니다 — 가장 낮은 값이 이 카드의
 * 실질이고, 평균 하나만 보여주면 그것을 감추게 됩니다.
 *
 * 군집이 둘 미만이면 배너가 뜨지 않습니다. 한 무리의 찬성은 합의가 아니라
 * 다수결입니다.
 */
export default function ConsensusBanner({
  problem,
  solution,
  rates,
}: {
  problem: string;
  solution: string;
  rates: ClusterRate[];
}) {
  const lowest = Math.min(...rates.map((r) => r.rate));

  return (
    <div
      className="card"
      style={{
        padding: 14,
        borderColor: "#6a5acd",
        background: "rgba(106, 90, 205, 0.08)",
      }}
    >
      <div style={{ fontSize: 12, color: "#8f82e0", fontWeight: 600, marginBottom: 6 }}>
        ★ 진영을 넘은 합의
      </div>

      <div style={{ fontSize: 14, lineHeight: 1.6 }}>{solution}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{problem}</div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {rates.map((r) => (
          <span key={r.cluster} className="muted">
            {`군집 ${r.cluster + 1} ${Math.round(r.rate * 100)}%`}
          </span>
        ))}
      </div>

      <div className="hint" style={{ marginTop: 8 }}>
        모든 군집에서 {Math.round(BANNER_THRESHOLD * 100)}% 이상 찬성했습니다
        (가장 낮은 군집 {Math.round(lowest * 100)}%). 인원 20명 미만 군집은
        판정에서 빠집니다.
      </div>
    </div>
  );
}
