/**
 * 정책 권고서 생성 (VS-H1) — 서버 전용.
 *
 * 공론장의 산출물입니다. **플랫폼이 기관에 보내지 않습니다.** 회원이
 * 내려받아 본인 명의로 민원·청원에 첨부합니다(→ `08_DECISIONS.md` D18).
 * 그래서 문서에 "발신: CivicAgora 거버넌스" 같은 머리말을 두지 않습니다 —
 * 누가 시민을 대표하는가라는 물음을 만들지 않기 위해서입니다.
 *
 * ## 반드시 들어가는 것
 *
 * `14_USER_JOURNEY.md` §3 ⑦ 의 일곱 가지입니다. 그중 둘이 특히 중요합니다.
 *
 * - **합의에 이르지 못한 쟁점**을 숨기지 않습니다. 합의만 골라 실으면
 *   선전물이 됩니다.
 * - **검증 정보**를 함께 싣습니다. 읽는 기관이 우리를 믿을 이유가 없으므로,
 *   믿지 않고도 확인할 수 있는 방법을 줘야 합니다.
 *
 * ## 인용은 지어내지 않습니다
 *
 * 대표 의견은 실제 글을 그대로 옮깁니다. 요약하거나 다듬지 않습니다 —
 * 그 순간 문서가 공론장의 기록이 아니라 우리의 주장이 됩니다.
 */
import { requireDb } from "./db.ts";
import { BRIEF_MAX_GAP, BRIEF_THRESHOLD, type ClusterRate } from "./consensus.ts";
import { CATEGORY_LABEL, STANCE_LABEL, type Category, type Stance } from "./types.ts";

/** 발행 조건 (D18 로 1,000건·500명에서 하향). */
export const REQUIRED_OPINIONS = 100;
export const REQUIRED_PARTICIPANTS = 50;
export const REQUIRED_CLUSTERS = 2;

export type Gate = { label: string; have: number; need: number; met: boolean };

export type BriefData = {
  policy: {
    id: string; title: string; category: Category;
    background: string; core_question: string;
    official_source_url: string; target_agency: string | null;
    created_at: number;
  };
  opinions: number;
  replies: number;
  participants: number;
  stance: Record<Stance, number>;
  clusters: number;
  convergence: number | null;
  /** 2차 관문을 통과한 대안. */
  consensus: Array<{ card: Quote; rates: ClusterRate[] }>;
  /** 합의에 이르지 못한 쟁점. 숨기지 않는다. */
  unresolved: Array<{ card: Quote; rates: ClusterRate[] }>;
  quotes: Record<Stance, Quote[]>;
  anchor: { batch_id: number; root: string; status: string } | null;
  model: { version: number; seed: number; snapshot_hash: string } | null;
  gates: Gate[];
  eligible: boolean;
};

export type Quote = {
  id: string;
  stance: Stance;
  problem: string;
  evidence: string;
  evidence_url: string;
  solution: string;
  /**
   * 브리징 점수 $b_i$ 와 진영 편향 $f_i$.
   *
   * 공개해도 되는 값입니다 — **카드 단위**이고 사람 단위가 아닙니다. 개인의
   * $f_u$ 는 어디에도 내보내지 않습니다(INV-2).
   */
  bridging: { score: number; bias: number } | null;
};

/**
 * 수렴도.
 *
 * **문서에 정의가 없어 여기서 정합니다**(→ `08_DECISIONS.md` D24). 정부기관에
 * 나가는 숫자이므로 계산법을 문서 안에 함께 적습니다.
 *
 *     수렴도 = 평균( 카드마다 가장 낮은 군집의 찬성률 )
 *
 * **최솟값**을 쓰는 이유는 한 진영의 몰표로 올릴 수 없게 하기 위해서입니다.
 * 평균 찬성률을 쓰면 한쪽이 몰아준 카드가 수렴도를 끌어올립니다 — 그것은
 * 수렴이 아니라 그 반대입니다.
 *
 * 군집이 둘 미만인 카드는 뺍니다. 비교할 상대가 없으면 수렴을 말할 수 없습니다.
 */
export function convergence(rates: Record<string, ClusterRate[]>): number | null {
  const usable = Object.values(rates).filter((r) => r.length >= 2);
  if (usable.length === 0) return null;
  const mins = usable.map((r) => Math.min(...r.map((x) => x.rate)));
  return mins.reduce((a, b) => a + b, 0) / mins.length;
}

/** 2차 관문 — 모든 군집 ≥ 0.65 이며 군집 간 격차 ≤ 5%p. */
export function passesBriefGate(rates: ClusterRate[]): boolean {
  if (rates.length < 2) return false;
  const values = rates.map((r) => r.rate);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  return lowest >= BRIEF_THRESHOLD && highest - lowest <= BRIEF_MAX_GAP;
}

export async function collect(policyId: string): Promise<BriefData | null> {
  const db = requireDb();

  const [policy] = await db`SELECT * FROM policies WHERE id = ${policyId}`;
  if (!policy) return null;

  const cards = await db`
    SELECT id, stance, problem_definition, evidence_source, evidence_url,
           actionable_solution
      FROM cards WHERE policy_id = ${policyId} ORDER BY created_at`;
  const cardIds = cards.map((c) => String(c.id));

  const [replyCount] = await db`
    SELECT COUNT(*)::int AS n FROM replies WHERE card_id = ANY(${cardIds})`;

  // 참여 시민은 **사람 단위**로 센다. 작성자는 기기(DID)로 표시되어 한 사람이
  // 여럿으로 보이므로(D21), 반응에 쓰인 필명으로 센다. 계산법을 문서에 적는다.
  const [people] = await db`
    SELECT COUNT(DISTINCT pseudonym)::int AS n FROM reactions
     WHERE card_id = ANY(${cardIds})`;

  const stance: Record<Stance, number> = { SUPPORT: 0, ALTERNATIVE: 0, OPPOSE: 0 };
  for (const card of cards) stance[String(card.stance) as Stance] += 1;

  const rateRows = await db`
    SELECT card_id, cluster, rate FROM card_consensus
     WHERE card_id = ANY(${cardIds}) ORDER BY card_id, cluster`;
  const rates: Record<string, ClusterRate[]> = {};
  for (const row of rateRows) {
    (rates[String(row.card_id)] ??= []).push({
      cluster: Number(row.cluster), rate: Number(row.rate),
    });
  }

  const [run] = await db`SELECT * FROM opinion_runs ORDER BY id DESC LIMIT 1`;
  const clusterRows = await db`SELECT cluster FROM opinion_clusters WHERE size >= 20`;
  const [bridging] = await db`SELECT * FROM bridging_runs ORDER BY id DESC LIMIT 1`;

  // 카드 단위 브리징 점수. 개인의 f_u 는 절대 내보내지 않지만 카드의 b_i 는
  // 공개 값이다(INV-2). 문서에 실어 두면 읽는 쪽이 오픈 API 와 대조할 수 있다.
  const scoreRows = await db`
    SELECT card_id, score, bias FROM card_scores WHERE card_id = ANY(${cardIds})`;
  const scores: Record<string, { score: number; bias: number }> = {};
  for (const row of scoreRows) {
    scores[String(row.card_id)] = { score: Number(row.score), bias: Number(row.bias) };
  }

  const [anchorLeaf] = await db`
    SELECT batch_id FROM anchor_leaves WHERE kind = 'policy' AND item_id = ${policyId}`;
  let anchor: BriefData["anchor"] = null;
  if (anchorLeaf) {
    const [batch] = await db`
      SELECT id, root, ots_status FROM anchor_batches WHERE id = ${anchorLeaf.batch_id}`;
    if (batch) {
      anchor = {
        batch_id: Number(batch.id), root: String(batch.root),
        status: String(batch.ots_status),
      };
    }
  }

  const quote = (row: Record<string, unknown>): Quote => ({
    id: String(row.id),
    bridging: scores[String(row.id)] ?? null,
    stance: String(row.stance) as Stance,
    problem: String(row.problem_definition),
    evidence: String(row.evidence_source),
    evidence_url: String(row.evidence_url),
    solution: String(row.actionable_solution),
  });

  const withRates = cards.map((c) => ({ card: quote(c), rates: rates[String(c.id)] ?? [] }));
  const consensus = withRates
    .filter((e) => e.card.stance === "ALTERNATIVE" && passesBriefGate(e.rates))
    .sort((a, b) => Math.min(...b.rates.map((r) => r.rate)) - Math.min(...a.rates.map((r) => r.rate)));

  // 합의에 이르지 못한 쟁점 — 군집별로 평가가 갈린 카드. 격차가 큰 순서다.
  const unresolved = withRates
    .filter((e) => e.rates.length >= 2 && !passesBriefGate(e.rates))
    .map((e) => ({
      ...e,
      gap: Math.max(...e.rates.map((r) => r.rate)) - Math.min(...e.rates.map((r) => r.rate)),
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);

  const quotes: Record<Stance, Quote[]> = { SUPPORT: [], ALTERNATIVE: [], OPPOSE: [] };
  for (const entry of withRates) quotes[entry.card.stance].push(entry.card);

  const gates: Gate[] = [
    { label: "누적 의견", have: cards.length, need: REQUIRED_OPINIONS,
      met: cards.length >= REQUIRED_OPINIONS },
    { label: "참여 시민", have: Number(people?.n ?? 0), need: REQUIRED_PARTICIPANTS,
      met: Number(people?.n ?? 0) >= REQUIRED_PARTICIPANTS },
    { label: "이념 군집", have: clusterRows.length, need: REQUIRED_CLUSTERS,
      met: clusterRows.length >= REQUIRED_CLUSTERS },
    { label: "합의 대안", have: consensus.length, need: 1, met: consensus.length >= 1 },
  ];

  return {
    policy: {
      id: String(policy.id), title: String(policy.title),
      category: String(policy.category) as Category,
      background: String(policy.background),
      core_question: String(policy.core_question),
      official_source_url: String(policy.official_source_url),
      target_agency: policy.target_agency == null ? null : String(policy.target_agency),
      created_at: Number(policy.created_at),
    },
    opinions: cards.length,
    replies: Number(replyCount?.n ?? 0),
    participants: Number(people?.n ?? 0),
    stance,
    clusters: clusterRows.length,
    convergence: convergence(rates),
    consensus,
    unresolved: unresolved.map(({ card, rates: r }) => ({ card, rates: r })),
    quotes,
    anchor,
    model: bridging
      ? { version: Number(bridging.model_version), seed: Number(bridging.seed),
          snapshot_hash: String(bridging.snapshot_hash) }
      : null,
    gates,
    eligible: gates.every((g) => g.met),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function rateLine(rates: ClusterRate[]): string {
  const line = rates.map((r) => `군집 ${r.cluster + 1} ${percent(r.rate)}`).join(" · ");
  if (rates.length < 2) return line;
  // 격차를 함께 적는다. 찬성률만 늘어놓으면 읽는 쪽이 직접 빼야 하고,
  // 격차가 이 문서의 판정 기준이므로 감추면 관문을 감추는 것이 된다.
  const values = rates.map((r) => r.rate);
  const gap = Math.max(...values) - Math.min(...values);
  return `${line} — 격차 ${(gap * 100).toFixed(1)}%p`;
}

function quoteBlock(card: Quote): string {
  return [
    `> **논점.** ${card.problem}`,
    `> **근거.** ${card.evidence}`,
    `> 출처: ${card.evidence_url}`,
    `> **제안.** ${card.solution}`,
  ].join("\n");
}

/**
 * 권고서를 마크다운으로 만든다.
 *
 * 기준에 못 미쳐도 만듭니다 — 대신 머리말에 그 사실을 적습니다. 감추고
 * 내보내지 않는 것보다, 표본이 작다는 것을 문서 안에서 말하는 편이 낫습니다.
 */
export function render(data: BriefData, verifyBase: string): string {
  const d = data;
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# [정책 권고서] ${d.policy.title}`);
  lines.push("");
  if (!d.eligible) {
    lines.push(`> **⚠ 이 문서는 발행 기준에 못 미칩니다.** 아래 표본 규모를 보고 무게를 판단해 주십시오.`);
    lines.push(`> ${d.gates.filter((g) => !g.met).map((g) => `${g.label} ${g.have}/${g.need}`).join(" · ")}`);
    lines.push("");
  }
  lines.push(`* 분야: ${CATEGORY_LABEL[d.policy.category]}`);
  if (d.policy.target_agency) lines.push(`* 소관: ${d.policy.target_agency}`);
  lines.push(`* 작성일: ${date}`);
  lines.push(`* 공론장: ${verifyBase}/policies/${d.policy.id}`);
  lines.push("");

  lines.push("## 1. 주제와 쟁점");
  lines.push("");
  lines.push(`**쟁점 질문.** ${d.policy.core_question}`);
  lines.push("");
  lines.push(d.policy.background);
  lines.push("");
  lines.push(`공식 출처: ${d.policy.official_source_url}`);
  lines.push("");

  lines.push("## 2. 참여 규모");
  lines.push("");
  lines.push(`| 항목 | 값 |`);
  lines.push(`|-|-|`);
  lines.push(`| 참여 시민 | ${d.participants}명 |`);
  lines.push(`| 의견 | ${d.opinions}건 |`);
  lines.push(`| 댓글 | ${d.replies}건 |`);
  lines.push(`| 이념 군집 | ${d.clusters}개 |`);
  lines.push("");

  lines.push("## 3. 찬반 분포와 수렴도");
  lines.push("");
  lines.push(`찬성 ${d.stance.SUPPORT}건 · 대안 ${d.stance.ALTERNATIVE}건 · 반대 ${d.stance.OPPOSE}건`);
  lines.push("");
  if (d.convergence === null) {
    lines.push("수렴도를 산출할 수 없습니다. 군집 간 비교가 가능한 의견이 아직 없습니다.");
  } else {
    lines.push(`**수렴도 ${percent(d.convergence)}** — 의견마다 *가장 낮은 군집의 찬성률*을 구해 평균한 값입니다. 최솟값을 쓰는 이유는 한 진영의 몰표로 올릴 수 없게 하기 위해서입니다.`);
  }
  lines.push("");

  lines.push("## 4. 진영을 넘은 합의");
  lines.push("");
  if (d.consensus.length === 0) {
    lines.push("**2차 관문을 통과한 대안이 없습니다.** 모든 군집에서 65% 이상 찬성받고 군집 간 격차가 5%p 이내여야 합니다. 이 공론장은 아직 그 지점에 이르지 못했습니다.");
  } else {
    for (const entry of d.consensus) {
      lines.push(quoteBlock(entry.card));
      lines.push("");
      lines.push(`군집별 찬성률: ${rateLine(entry.rates)}`);
      if (entry.card.bridging) {
        lines.push(`브리징 점수 $b_i$ = ${entry.card.bridging.score.toFixed(4)} · 진영 편향 $f_i$ = ${entry.card.bridging.bias.toFixed(4)} · 카드 식별자 \`${entry.card.id}\``);
      }
      lines.push("");
    }
  }

  lines.push("## 5. 합의에 이르지 못한 쟁점");
  lines.push("");
  lines.push("여기를 비우지 않습니다. 합의만 골라 실으면 이 문서는 선전물이 됩니다.");
  lines.push("");
  if (d.unresolved.length === 0) {
    lines.push("군집 간 평가가 갈린 의견이 아직 집계되지 않았습니다.");
  } else {
    for (const entry of d.unresolved) {
      lines.push(`* **${entry.card.solution}** — ${rateLine(entry.rates)}`);
    }
  }
  lines.push("");

  lines.push("## 6. 대표 의견 원문");
  lines.push("");
  lines.push("*아래는 공론장에 올라온 글을 그대로 옮긴 것입니다. 요약하거나 다듬지 않았습니다.*");
  lines.push("");
  for (const stance of ["SUPPORT", "ALTERNATIVE", "OPPOSE"] as Stance[]) {
    const picked = d.quotes[stance].slice(0, 2);
    if (picked.length === 0) continue;
    lines.push(`### ${STANCE_LABEL[stance]}`);
    lines.push("");
    for (const card of picked) {
      lines.push(quoteBlock(card));
      lines.push("");
    }
  }

  lines.push("## 7. 검증 정보");
  lines.push("");
  lines.push("읽는 분이 저희를 믿을 이유는 없습니다. 믿지 않고도 확인할 수 있도록 아래를 함께 싣습니다.");
  lines.push("");
  if (d.anchor) {
    lines.push(`* 앵커 배치 #${d.anchor.batch_id} · 머클 루트 \`${d.anchor.root}\``);
    lines.push(`* 상태: ${d.anchor.status === "stamped" ? "비트코인에 제출됨 (OpenTimestamps)" : d.anchor.status}`);
    lines.push(`* 영수증: ${verifyBase}/api/anchor/batches/${d.anchor.batch_id}/receipt`);
    lines.push(`* 잎 목록: ${verifyBase}/api/anchor/batches/${d.anchor.batch_id}/leaves`);
    lines.push(`* 확인: \`ots verify -d ${d.anchor.root} <영수증 파일>\` — 이 확인에는 저희 코드가 쓰이지 않습니다.`);
  } else {
    lines.push("* 아직 외부 기록(앵커)에 남지 않았습니다. 이 부분은 저희를 믿어야 하는 구간입니다.");
  }
  if (d.model) {
    lines.push(`* 브리징 모델 v${d.model.version} · 시드 ${d.model.seed} · 스냅샷 \`${d.model.snapshot_hash}\``);
  }
  lines.push(`* 군집화: PCA 2차원 투영 후 K-Means. k 는 실루엣 계수로 2~5에서 자동 선택. 인원 20명 미만 군집은 판정에서 제외.`);
  lines.push(`* 참여 시민 수는 **사람 단위**입니다. 작성자는 기기마다 다른 식별자를 갖기 때문에, 반응에 쓰인 익명 필명으로 셉니다.`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("이 문서는 CivicAgora 공론장의 집계 결과이며, 특정 개인이나 단체의 공식 입장이 아닙니다. 내려받은 회원이 본인 판단으로 활용하는 자료입니다. 모든 수치는 위 검증 주소에서 직접 재계산할 수 있습니다.");

  return lines.join("\n");
}
