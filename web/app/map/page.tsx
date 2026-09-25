import Link from "next/link";
import MapCanvas from "@/components/MapCanvas";
import { publicMap } from "@/lib/opinionmap";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 여론 지형도 (VS-F4).
 *
 * 반응 행렬을 2차원으로 내려 군집을 보여줍니다. 축 자체에는 뜻이 없습니다 —
 * 주성분일 뿐이고, 뜻은 **어느 점들이 서로 가까운가**에 있습니다.
 */
export default async function MapPage() {
  const map = sql
    ? await publicMap()
    : { ready: false as const, reason: "저장소에 연결되지 않았습니다.",
        participants: 0, k: 0, silhouette: 0, clusters: [], points: [],
        snapshot_hash: "", updated_at: 0 };

  return (
    <>
      <Link href="/" className="muted">← 광장으로</Link>
      <h2 style={{ marginTop: 14 }}>여론 지형도</h2>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          반응이 비슷한 사람끼리 가까이 놓입니다. 색은 자동으로 찾아낸
          <strong> 군집</strong>이고, 몇 개로 나눌지는 사람이 정하지 않고
          자료가 정합니다.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          <strong>점 하나가 사람 한 명이지만 누구인지는 아무도 알 수 없습니다.</strong>
          {" "}서버도 화면도 점에 이름을 붙이지 않고, 개인의 반응 이력이 공개되지
          않으므로 남의 점을 짚어낼 단서도 없습니다. 인원 20명 미만 군집은
          찬성률 판정에서 빠집니다.
        </p>
      </div>

      <MapCanvas map={map} />

      {map.ready && (
        <div className="hint" style={{ marginTop: 10 }}>
          참여 {map.participants}명 · 군집 {map.k}개 · 응집도{" "}
          {map.silhouette.toFixed(2)} ·{" "}
          {new Date(map.updated_at).toLocaleString("ko-KR")} 기준
        </div>
      )}
    </>
  );
}
