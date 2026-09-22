import Link from "next/link";
import { needsBalance } from "@/lib/plaza";
import { CATEGORY_LABEL, type PolicySummary } from "@/lib/types";

function ago(ms: number): string {
  const minutes = Math.floor((Date.now() - Number(ms)) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

/** 찬반 분포 막대. 가운데가 대안이다. */
function Distribution({ p }: { p: PolicySummary }) {
  const total = p.support_count + p.alternative_count + p.oppose_count;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="dist" title={`찬성 ${p.support_count} · 대안 ${p.alternative_count} · 반대 ${p.oppose_count}`}>
      <i className="s" style={{ width: `${pct(p.support_count)}%` }} />
      <i className="a" style={{ width: `${pct(p.alternative_count)}%` }} />
      <i className="o" style={{ width: `${pct(p.oppose_count)}%` }} />
    </div>
  );
}

/**
 * 「반대 의견이 필요해요」 안내.
 *
 * 쏠린 주제에 참여를 권한다. 이 플랫폼은 반대편 의견을 데려오는 것이
 * 목적이므로, 목록에서부터 그 일을 한다.
 */
function BalanceHint({ p }: { p: PolicySummary }) {
  if (!needsBalance(p)) return null;
  const lacking = p.support_count > p.oppose_count ? "반대" : "찬성";
  return <span className="balance">⚖ {lacking} 의견이 필요해요</span>;
}

/** 카드 보기 — 한 주제를 크게 보여준다. */
export function PolicyCard({ p }: { p: PolicySummary }) {
  const total = p.support_count + p.alternative_count + p.oppose_count;
  return (
    <Link href={`/policies/${p.id}`} className="plain">
      <div className="card">
        <div className="row-head">
          <strong style={{ fontSize: 17 }}>{p.title}</strong>
          <span className="muted nowrap">{ago(p.last_activity_at)}</span>
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {CATEGORY_LABEL[p.category]}
          {p.target_agency ? ` · ${p.target_agency}` : ""}
        </div>
        <div style={{ marginTop: 10, fontSize: 15 }}>{p.core_question}</div>
        <Distribution p={p} />
        <div className="muted">
          찬성 {p.support_count} · 대안 {p.alternative_count} · 반대 {p.oppose_count}
          {total > 0 ? ` · 의견 ${total}건` : ""} <BalanceHint p={p} />
        </div>
      </div>
    </Link>
  );
}

/**
 * 목록 보기 — 한 줄로 촘촘하게.
 *
 * 훑어볼 때는 한 화면에 많이 보이는 편이 낫다. 주제가 수백 개면 카드
 * 보기로는 원하는 것을 찾기 전에 지친다.
 */
export function PolicyLine({ p }: { p: PolicySummary }) {
  const total = p.support_count + p.alternative_count + p.oppose_count;
  return (
    <Link href={`/policies/${p.id}`} className="plain">
      <div className="line">
        <span className="tag">{CATEGORY_LABEL[p.category]}</span>
        <span className="line-title">{p.title}</span>
        <Distribution p={p} />
        <span className="muted nowrap">{total}건</span>
        <span className="muted nowrap">{ago(p.last_activity_at)}</span>
      </div>
    </Link>
  );
}
