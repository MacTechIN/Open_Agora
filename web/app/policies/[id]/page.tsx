import Link from "next/link";
import { notFound } from "next/navigation";
import { migrate, sql } from "@/lib/db";
import { CATEGORY_LABEL, STANCE_LABEL, type DebateCard, type Policy, type Stance } from "@/lib/types";
import AddOpinion from "./AddOpinion";
import Endorse from "./Endorse";
import Reactions from "@/components/Reactions";
import Replies from "./Replies";
import { repliesFor, type Reply } from "@/lib/replies";
import { countsFor, scoresFor, type CardScore } from "@/lib/reactions";
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
    // 브리징 점수 (VS-F3). 미산출 카드는 들어 있지 않다.
    scores: await scoresFor((opinions as unknown as DebateCard[]).map((c) => c.id)),
    // 댓글 (VS-D3). 한 단계만 있다.
    replies: await repliesFor((opinions as unknown as DebateCard[]).map((c) => c.id)),
  };
}

/**
 * 한 열의 카드 순서 (VS-F3).
 *
 * 브리징 점수가 있는 카드가 먼저, 점수 높은 순입니다. 점수가 없는 카드는
 * 그 아래에 최신순으로 붙습니다 — **신규 카드의 노출 기회를 보장하는
 * 구간**입니다(`docs/03_ALGORITHMS_AI.md` §1.4). 이 구간이 없으면 반응이
 * 쌓이기 전의 카드는 영원히 보이지 않고, 반응이 쌓일 일도 없습니다.
 */
function order(cards: DebateCard[], scores: Record<string, CardScore>): DebateCard[] {
  const scored = cards.filter((c) => c.id in scores)
    .sort((a, b) => scores[b.id].score - scores[a.id].score);
  const fresh = cards.filter((c) => !(c.id in scores))
    .sort((a, b) => b.created_at - a.created_at);
  return [...scored, ...fresh];
}

function Column({ stance, cards, reactions, scores, replies }: {
  stance: Stance;
  cards: DebateCard[];
  reactions: Record<string, Record<string, number>>;
  scores: Record<string, CardScore>;
  replies: Record<string, Reply[]>;
}) {
  const mine = order(cards.filter((c) => c.stance === stance), scores);
  return (
    <div>
      <h3 className={stance}>
        {stance === "ALTERNATIVE" ? "대안 · 합의" : STANCE_LABEL[stance]} {mine.length}
      </h3>
      {mine.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 12 }}>아직 없습니다</div>}
      {mine.map((c) => (
        <div key={c.id} className="card" style={{ padding: 14 }}>
          {c.id in scores ? (
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}
                 title="양 진영 모두에게 인정받을수록 높아집니다. 한쪽의 몰표로는 오르지 않습니다.">
              브리징 {scores[c.id].score.toFixed(2)}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}
                 title="반응이 20개 이상 모이면 브리징 점수가 매겨집니다.">
              평가 수집 중
            </div>
          )}
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

          <Replies cardId={c.id} initial={replies[c.id] ?? []} />

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
  const { policy, opinions, anchor, endorsements, reactions, scores, replies } = data;

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
        <Column stance="SUPPORT" cards={opinions} reactions={reactions} scores={scores}
                replies={replies} />
        <Column stance="ALTERNATIVE" cards={opinions} reactions={reactions} scores={scores}
                replies={replies} />
        <Column stance="OPPOSE" cards={opinions} reactions={reactions} scores={scores}
                replies={replies} />
      </div>

      <AddOpinion policyId={policy.id} question={policy.core_question} />
    </>
  );
}
