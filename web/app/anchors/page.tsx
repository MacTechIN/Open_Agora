import Link from "next/link";
import { migrateAnchor } from "@/lib/anchor";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 앵커 기록 (VS-F6).
 *
 * 공개합니다. 앵커링의 값어치는 **누구나 확인할 수 있다**는 데서 나오므로,
 * 확인에 필요한 것을 감추면 남는 것이 없습니다.
 */
async function load() {
  if (!sql) return [];
  await migrateAnchor();
  return sql`
    SELECT b.id, b.root, b.leaf_count, b.created_at, b.ots_status,
           COUNT(r.calendar)::int AS receipts
      FROM anchor_batches b
      LEFT JOIN anchor_receipts r ON r.batch_id = b.id
     GROUP BY b.id
     ORDER BY b.id DESC
     LIMIT 100`;
}

export default async function Anchors() {
  const batches = await load();

  return (
    <>
      <Link href="/" className="muted">← 광장으로</Link>
      <h2 style={{ marginTop: 14 }}>앵커 기록</h2>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          6시간마다 그때까지 올라온 글을 머클 트리로 묶어 <strong>루트 하나</strong>를
          비트코인에 남깁니다(OpenTimestamps). 글 하나하나를 올리는 것이 아니라 수천
          건을 해시 하나로 묶어 그것만 올리므로 비용이 들지 않습니다.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          이것이 막는 것은 <strong>소급 조작</strong>입니다. 운영자가 글을 고치면
          서명이 깨지고(각 글의 서명 표시), 지우면 루트와 맞지 않게 됩니다. 다만
          <strong> 사본을 가진 사람이 있어야</strong> 지워진 글을 되살려 증명할 수
          있습니다 — 그래서 잎 목록을 공개합니다. 내려받아 보관해 두십시오.
        </p>
      </div>

      {batches.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>아직 앵커 배치가 없습니다.</p>
        </div>
      )}

      {batches.map((batch) => (
        <div key={String(batch.id)} className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>배치 #{String(batch.id)}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {new Date(Number(batch.created_at)).toLocaleString("ko-KR")}
            </span>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all", marginTop: 6 }}>
            {String(batch.root)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            글 {Number(batch.leaf_count)}건 · 상태 {String(batch.ots_status)} ·
            영수증 {Number(batch.receipts)}건
            {Number(batch.receipts) > 0 && (
              <>
                {" · "}
                <a href={`/api/anchor/batches/${batch.id}/receipt`}>영수증</a>
                {" · "}
                <a href={`/api/anchor/batches/${batch.id}/leaves`}>잎 목록</a>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
