import type { Proof } from "@/lib/anchor";

/**
 * 앵커 상태 표시 (VS-F6).
 *
 * 서버 컴포넌트에서만 씁니다 — 증명은 lib/anchor.ts 가 만들고 그것은
 * 데이터베이스를 씁니다.
 *
 * 「기록됨」을 자랑하지 않습니다. 앵커는 **이 글이 그때 존재했다**만 말하고,
 * 글이 사실이라는 뜻도 지워지지 않는다는 뜻도 아닙니다. 대신 **무엇을 어떻게
 * 확인하는지**를 적습니다 — 확인 방법을 감추면 앵커링은 또 하나의 "믿어
 * 주세요"가 됩니다.
 */
export default function AnchorNotice({ proof }: { proof: Proof | null }) {
  if (!proof) {
    return (
      <div className="hint" style={{ marginTop: 12 }}>
        아직 외부 기록에 남지 않았습니다. 앵커링은 6시간마다 묶어서 하므로
        조금 기다리면 들어갑니다.
      </div>
    );
  }

  const stamped = proof.ots_status === "stamped" && proof.calendars.length > 0;
  return (
    <div className="hint" style={{ marginTop: 12, lineHeight: 1.7 }}>
      <div>
        <strong>앵커 배치 #{proof.batch_id}</strong> · 함께 묶인 글 {proof.leaf_count}건 ·{" "}
        {new Date(proof.anchored_at).toLocaleString("ko-KR")}
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
        루트 {proof.root}
      </div>
      {stamped ? (
        <div>
          이 루트는 <strong>비트코인</strong>에 커밋되었습니다(OpenTimestamps).{" "}
          <a href={`/api/anchor/batches/${proof.batch_id}/receipt`}>영수증 내려받기</a> ·{" "}
          <a href={`/api/anchor/batches/${proof.batch_id}/leaves`}>잎 목록</a>
          <br />
          <span style={{ fontSize: 11 }}>
            확인: <code>ots verify -d {proof.root.slice(0, 16)}… civicagora-batch-{proof.batch_id}.ots</code>{" "}
            — 이 확인에는 우리 코드가 쓰이지 않습니다.
          </span>
        </div>
      ) : (
        <div>
          루트가 아직 외부에 남지 않았습니다(상태: {proof.ots_status}). 여기까지는
          운영자를 믿는 것과 같습니다.
        </div>
      )}
    </div>
  );
}
