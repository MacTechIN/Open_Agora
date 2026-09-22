import Link from "next/link";
import PlazaControls from "@/components/PlazaControls";
import { PolicyCard, PolicyLine } from "@/components/PolicyRow";
import { PAGE_SIZE, loadPlaza, parseQuery } from "@/lib/plaza";
import { CATEGORY_LABEL, type Category, type PolicySummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;

/** 분류별 보기 — 섹션으로 나눠 원하는 종류만 훑을 수 있게 한다. */
function Sections({ rows }: { rows: PolicySummary[] }) {
  const grouped = new Map<Category, PolicySummary[]>();
  for (const row of rows) {
    const list = grouped.get(row.category) ?? [];
    list.push(row);
    grouped.set(row.category, list);
  }
  return (
    <>
      {[...grouped.entries()].map(([category, list]) => (
        <section key={category} style={{ marginBottom: 24 }}>
          <h3 className="section-head">
            {CATEGORY_LABEL[category]} <span className="muted">{list.length}</span>
          </h3>
          {list.map((p) => <PolicyLine key={p.id} p={p} />)}
        </section>
      ))}
    </>
  );
}

function Pager({ page, total, params }: { page: number; total: number; params: URLSearchParams }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  const href = (n: number) => {
    const next = new URLSearchParams(params.toString());
    if (n <= 1) next.delete("page");
    else next.set("page", String(n));
    const query = next.toString();
    return query ? `/?${query}` : "/";
  };

  return (
    <div className="pager">
      {page > 1 && <Link href={href(page - 1)}><button className="ghost">← 이전</button></Link>}
      <span className="muted">{page} / {pages}</span>
      {page < pages && <Link href={href(page + 1)}><button className="ghost">다음 →</button></Link>}
    </div>
  );
}

export default async function Plaza({ searchParams }: { searchParams: Params }) {
  const raw = await searchParams;
  const query = parseQuery(raw);
  const { rows, total, counts, error } = await loadPlaza(query);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) params.set(key, value);
  }

  const filtered = Boolean(query.q || query.category);

  return (
    <>
      <div className="notice">
        <strong>공론장은 누구나 볼 수 있습니다.</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          읽는 데는 아무것도 필요 없습니다. 글을 쓰려면 이메일 인증이 한 번
          필요하며, 인증 후에도 어떤 글이 누구의 것인지는 저장하지 않습니다.
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          현재는 준비 단계입니다. 글은 공유 서버에 저장되며, 위변조 방지 서명과
          블록체인 기록은 아직 적용되지 않았습니다.
        </div>
      </div>

      <div className="plaza-head">
        <h2>
          {filtered ? `검색 결과 ${total}건` : total > 0 ? `공론 중인 주제 ${total}건` : "공론 중인 주제"}
        </h2>
        <Link href="/policies/new"><button>주제 올리기</button></Link>
      </div>

      <PlazaControls counts={counts} total={Object.values(counts).reduce((a, b) => a + b, 0)} />

      {error && <div className="card error">{error}</div>}

      {!error && rows.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            {filtered ? "조건에 맞는 주제가 없습니다." : "아직 올라온 주제가 없습니다."}
          </p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {filtered
              ? "검색어를 바꾸거나 분류를 전체로 두고 다시 찾아보세요."
              : "공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요."}
          </p>
        </div>
      )}

      {query.view === "section" && <Sections rows={rows} />}
      {query.view === "list" && rows.map((p) => <PolicyLine key={p.id} p={p} />)}
      {query.view === "card" && rows.map((p) => <PolicyCard key={p.id} p={p} />)}

      <Pager page={query.page} total={total} params={params} />
    </>
  );
}
