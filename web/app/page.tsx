import Link from "next/link";
import { migrate, sql } from "@/lib/db";
import { CATEGORY_LABEL, type PolicySummary } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadPolicies(): Promise<{ rows: PolicySummary[]; error?: string }> {
  if (!sql) {
    return { rows: [], error: "DATABASE_URL 이 설정되지 않아 주제를 불러올 수 없습니다." };
  }
  try {
    await migrate();
    const rows = await sql`
      SELECT p.*,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'SUPPORT'), 0)::int     AS support_count,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'ALTERNATIVE'), 0)::int AS alternative_count,
             COALESCE(COUNT(*) FILTER (WHERE c.stance = 'OPPOSE'), 0)::int      AS oppose_count,
             COALESCE(MAX(c.created_at), p.created_at)::bigint                  AS last_activity_at
        FROM policies p
        LEFT JOIN cards c ON c.policy_id = p.id
       GROUP BY p.id
       ORDER BY COALESCE(MAX(c.created_at), p.created_at) DESC
       LIMIT 100`;
    return { rows: rows as unknown as PolicySummary[] };
  } catch (error) {
    console.error(error);
    return { rows: [], error: "주제를 불러오지 못했습니다." };
  }
}

function ago(ms: number): string {
  const minutes = Math.floor((Date.now() - Number(ms)) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default async function Plaza() {
  const { rows, error } = await loadPolicies();

  return (
    <>
      <div className="notice">
        <strong>공론장은 누구나 볼 수 있습니다.</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          읽는 데는 아무것도 필요 없습니다. 글을 쓰려면 이메일 인증이 한 번
          필요하며, 인증 후에도 어떤 글이 누구의 것인지는 저장하지 않습니다.
        </div>
        {/* 명세가 약속한 것과 지금 되는 것이 다르면 사용자가 알아야 한다.
            VS-A4(서명), VS-F6(온체인 앵커)이 끝나면 단계적으로 바뀐다.
            → docs/15_BRIDGE_SERVER.md §6 */}
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          현재는 준비 단계입니다. 글은 공유 서버에 저장되며, 위변조 방지 서명과
          블록체인 기록은 아직 적용되지 않았습니다.
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>
          {rows.length > 0 ? `공론 중인 주제 ${rows.length}건` : "공론 중인 주제"}
        </h2>
        <Link href="/policies/new"><button>주제 올리기</button></Link>
      </div>

      {error && <div className="card error">{error}</div>}

      {!error && rows.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>아직 올라온 주제가 없습니다.</p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요.
          </p>
        </div>
      )}

      {rows.map((p) => {
        const total = p.support_count + p.alternative_count + p.oppose_count;
        const pct = (n: number) => (total ? (n / total) * 100 : 0);
        return (
          <Link key={p.id} href={`/policies/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong style={{ fontSize: 17 }}>{p.title}</strong>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{ago(p.last_activity_at)}</span>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {CATEGORY_LABEL[p.category]}
                {p.target_agency ? ` · ${p.target_agency}` : ""}
              </div>
              <div style={{ marginTop: 10, fontSize: 15 }}>{p.core_question}</div>

              {/* 찬반 분포. 가운데 보라색이 대안이다. */}
              <div className="dist">
                <i className="s" style={{ width: `${pct(p.support_count)}%` }} />
                <i className="a" style={{ width: `${pct(p.alternative_count)}%` }} />
                <i className="o" style={{ width: `${pct(p.oppose_count)}%` }} />
              </div>
              <div className="muted">
                찬성 {p.support_count} · 대안 {p.alternative_count} · 반대 {p.oppose_count}
                {total > 0 ? ` · 의견 ${total}건` : ""}
              </div>
            </div>
          </Link>
        );
      })}
    </>
  );
}
