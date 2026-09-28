import Link from "next/link";
import { notFound } from "next/navigation";
import { collect, render } from "@/lib/brief";
import { migrate, sql } from "@/lib/db";
import { migrateReplies } from "@/lib/replies";
import { migrateConsensus } from "@/lib/consensus";
import { migrateMap } from "@/lib/opinionmap";
import { migrateAnchor } from "@/lib/anchor";
import BriefActions from "../BriefActions";

export const dynamic = "force-dynamic";

/**
 * 정책 권고서 (VS-H1).
 *
 * 화면에 그대로 보여주고 내려받게 합니다. **플랫폼이 기관에 보내지
 * 않습니다** — 회원이 본인 명의로 씁니다(D18).
 *
 * 기준에 못 미쳐도 볼 수 있습니다. 대신 문서 머리에 그 사실이 적힙니다.
 * 감추고 안 보여주는 것보다, 표본이 작다는 것을 문서 안에서 말하는 편이
 * 낫습니다.
 */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sql) notFound();

  await migrate();
  await migrateReplies();
  await migrateConsensus();
  await migrateMap();
  await migrateAnchor();

  const data = await collect(id);
  if (!data) notFound();

  const markdown = render(data, process.env.NEXT_PUBLIC_BASE_URL ?? "");

  return (
    <>
      <Link href={`/policies/${id}`} className="muted no-print">← 주제로</Link>
      <h2 className="no-print" style={{ marginTop: 14 }}>정책 권고서</h2>

      <div className="card no-print">
        <p style={{ marginTop: 0 }}>
          이 문서는 <strong>회원이 내려받아 본인 명의로</strong> 민원·청원·의원실
          제출에 쓰는 자료입니다. 플랫폼이 기관에 직접 보내지 않습니다 —
          &quot;누가 시민을 대표하는가&quot;라는 물음을 만들지 않기 위해서입니다.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {data.gates.map((gate) => (
            <span key={gate.label} className="muted" style={{ fontSize: 12 }}>
              {`${gate.met ? "✓" : "○"} ${gate.label} ${gate.have}/${gate.need}`}
            </span>
          ))}
        </div>

        {!data.eligible && (
          <div className="hint" style={{ marginTop: 10, color: "#d9a441" }}>
            아직 발행 기준에 못 미칩니다. 그래도 내려받을 수 있고, 문서 머리에
            표본이 작다는 사실이 적힙니다.
          </div>
        )}
      </div>

      <BriefActions policyId={id} />

      <div className="card">
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word",
                      fontSize: 13, lineHeight: 1.7, margin: 0,
                      fontFamily: "inherit" }}>
          {markdown}
        </pre>
      </div>
    </>
  );
}
