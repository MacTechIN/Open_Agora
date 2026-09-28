"use client";

/**
 * 권고서 내려받기 (VS-H1 / VS-H2′).
 *
 * TXT 는 서버가 그대로 내려줍니다. PDF 는 브라우저의 인쇄 기능을 씁니다 —
 * 서버에서 PDF 를 만들면 한글 글꼴을 함께 실어야 하고, 그 글꼴이 기기마다
 * 다르게 보이는 것보다 사용자의 브라우저가 이미 가진 글꼴로 뽑는 편이
 * 확실합니다.
 */
export default function BriefActions({ policyId }: { policyId: string }) {
  return (
    <div className="card no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <a href={`/api/policies/${policyId}/brief?format=txt`} download>
        <button>TXT 내려받기</button>
      </a>
      <a href={`/api/policies/${policyId}/brief?format=docx`} download>
        <button>DOCX 내려받기</button>
      </a>
      <button onClick={() => window.print()}>PDF 로 저장 (인쇄)</button>
    </div>
  );
}
