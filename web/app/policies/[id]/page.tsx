import Link from "next/link";
import { notFound } from "next/navigation";
import { migrate, sql } from "@/lib/db";
import { CATEGORY_LABEL, STANCE_LABEL, type DebateCard, type Policy, type Stance } from "@/lib/types";
import AddOpinion from "./AddOpinion";
import Endorse from "./Endorse";
import Reactions from "@/components/Reactions";
import { countsFor } from "@/lib/reactions";
import { countFor } from "@/lib/anon";
import { hashScopeServer } from "@/lib/scope";
import SignatureBadge from "@/components/SignatureBadge";
import AnchorNotice from "@/components/AnchorNotice";
import { proofFor } from "@/lib/anchor";
import { checkSignature } from "@/lib/verify.ts";
import { opinionPayload, policyPayload } from "@/lib/signing.ts";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!sql) return null;
  await migrate();
  const [policy] = await sql`SELECT * FROM policies WHERE id = ${id}`;
  if (!policy) return null;
  const opinions = await sql`
    SELECT * FROM cards WHERE policy_id = ${id} ORDER BY created_at DESC`;
  return {
    policy: policy as unknown as Policy,
    opinions: opinions as unknown as DebateCard[],
    // 앵커 증명. 아직 배치에 들어가지 않았으면 null 이다.
    anchor: await proofFor("policy", id),
    // 익명 지지 수 (VS-C3a). 누가 눌렀는지는 어디에도 없다.
    endorsements: await countFor(hashScopeServer(id)),
    // 반응 집계 (VS-D2). **집계만** 받는다 — 필명은 오지 않는다.
    reactions: await countsFor((opinions as unknown as DebateCard[]).map((c) => c.id)),
  };
}

function Column({ stance, cards, reactions }: {
  stance: Stance;
  cards: DebateCard[];
  reactions: Record<string, Record<string, number>>;
}) {
  const mine = cards.filter((c) => c.stance === stance);
  return (
    <div>
      <h3 className={stance}>
        {stance === "ALTERNATIVE" ? "대안 · 합의" : STANCE_LABEL[stance]} {mine.length}
      </h3>
      {mine.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 12 }}>아직 없습니다</div>}
      {mine.map((c) => (
        <div key={c.id} className="card" style={{ padding: 14 }}>
          <div className="section">
            <span className="label">논점</span>
            {c.problem_definition}
          </div>
          <div className="section">
            <span className="label">근거</span>
            {c.evidence_source}
          </div>
          <a href={c.evidence_url} target="_blank" rel="noopener noreferrer"
             style={{ fontSize: 12, wordBreak: "break-all" }}>
            {c.evidence_url}
          </a>
          <div className="section" style={{ marginTop: 10 }}>
            <span className="label">제안</span>
            {c.actionable_solution}
          </div>
          <Reactions cardId={c.id} authorDid={c.author_did}
                     counts={reactions[c.id] ?? {}} />

          <div className="muted"
               style={{ marginTop: 10, fontSize: 12, display: "flex",
                        justifyContent: "space-between", gap: 8 }}>
            {/* 필명 체계는 VS-C3에서 붙는다. 그때까지는 식별자 앞부분만 보인다. */}
            <span>작성자 {c.author_did.slice(0, 22)}…</span>
            <SignatureBadge status={checkSignature(c.author_did, opinionPayload(c), c.signature)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function PolicyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { policy, opinions, anchor, endorsements, reactions } = data;

  return (
    <>
      <Link href="/" className="muted">← 광장으로</Link>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: 0, fontSize: 21 }}>{policy.title}</h2>
        <div className="muted"
             style={{ marginTop: 4, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>
            {CATEGORY_LABEL[policy.category]}
            {policy.target_agency ? ` · ${policy.target_agency}` : ""}
          </span>
          {/* 서명은 이 글이 올라온 뒤 바뀌지 않았다는 것만 말한다. 내용이
              사실이라는 뜻은 아니다. */}
          <SignatureBadge
            status={checkSignature(policy.author_did, policyPayload(policy), policy.signature)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <span className="label">쟁점 질문</span>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{policy.core_question}</div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span className="label">왜 지금 이슈인가</span>
          {policy.background}
        </div>

        <div style={{ marginTop: 14 }}>
          <span className="label">공식 출처</span>
          <a href={policy.official_source_url} target="_blank" rel="noopener noreferrer"
             style={{ wordBreak: "break-all" }}>
            {policy.official_source_url}
          </a>
        </div>

        <AnchorNotice proof={anchor} />
      </div>

      <Endorse policyId={policy.id} initial={endorsements} />

      {/* 3열. 좌우 폭이 같아야 한다 — 어느 쪽도 시각적으로 우대하지 않는다.
          가운데 대안 열은 브리징 알고리즘의 자리이며, 합의 배너는 VS-F5에서 붙는다. */}
      <h2 style={{ fontSize: 18, marginTop: 28 }}>의견 {opinions.length}건</h2>
      <div className="columns">
        <Column stance="SUPPORT" cards={opinions} reactions={reactions} />
        <Column stance="ALTERNATIVE" cards={opinions} reactions={reactions} />
        <Column stance="OPPOSE" cards={opinions} reactions={reactions} />
      </div>

      <AddOpinion policyId={policy.id} question={policy.core_question} />
    </>
  );
}
