import { migrate, sql } from "./db";
import { PAGE_SIZE, SORTS, VIEWS, type Sort, type View } from "./plaza-view";
import { CATEGORY_LABEL, type Category, type PolicySummary } from "./types";

export { PAGE_SIZE, SORTS, VIEWS };
export type { Sort, View };

/**
 * 광장 목록 조회.
 *
 * 주제가 수백 개가 되면 문제는 "스크롤이 길다"가 아니라 **"무엇을 봐야
 * 할지 모른다"** 이다. 검색·분류·정렬로 좁히고, 정렬 기준이 이 플랫폼의
 * 목적을 드러내게 한다.
 */


export interface PlazaQuery {
  q: string;
  category: Category | null;
  sort: Sort;
  view: View;
  page: number;
}

export function parseQuery(params: Record<string, string | string[] | undefined>): PlazaQuery {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const category = one("c");
  const sort = one("sort");
  const view = one("view");
  return {
    q: (one("q") ?? "").trim().slice(0, 100),
    category: category && category in CATEGORY_LABEL ? (category as Category) : null,
    sort: sort && sort in SORTS ? (sort as Sort) : "active",
    view: view && view in VIEWS ? (view as View) : "card",
    page: Math.max(1, Number(one("page") ?? 1) || 1),
  };
}

export interface PlazaResult {
  rows: PolicySummary[];
  total: number;
  counts: Record<string, number>;
  error?: string;
}

/**
 * 「균형 필요」 점수.
 *
 * 한쪽으로 쏠린 주제를 위로 올려 **반대편 의견을 데려오는 것**이 목적이다.
 * 일반 커뮤니티는 이렇게 하지 않는다 — 쏠린 글이 더 인기 있기 때문이다.
 * 그러나 이 플랫폼은 진영을 넘는 합의를 만드는 것이 목적이므로, 목록 자체가
 * 그 일을 하게 만든다.
 *
 * 의견이 2건 미만인 주제는 제외한다. 0 대 0 이나 1 대 0 은 쏠린 것이
 * 아니라 아직 시작하지 않은 것이다.
 */
const BALANCE_SCORE = `
  CASE
    WHEN COUNT(c.id) FILTER (WHERE c.stance IN ('SUPPORT','OPPOSE')) < 2 THEN -1
    ELSE ABS(
           COUNT(c.id) FILTER (WHERE c.stance = 'SUPPORT')::float
         - COUNT(c.id) FILTER (WHERE c.stance = 'OPPOSE')::float
         ) / GREATEST(COUNT(c.id) FILTER (WHERE c.stance IN ('SUPPORT','OPPOSE')), 1)
  END`;

export async function loadPlaza(query: PlazaQuery): Promise<PlazaResult> {
  if (!sql) {
    return { rows: [], total: 0, counts: {}, error: "DATABASE_URL 이 설정되지 않아 주제를 불러올 수 없습니다." };
  }
  try {
    await migrate();

    // 검색은 제목·쟁점 질문·배경을 함께 본다. 제목만 보면 "지역화폐"로
    // 검색했을 때 제목에 그 말이 없는 주제를 놓친다.
    const like = query.q ? `%${query.q}%` : null;

    const filters = sql`
      WHERE (${like}::text IS NULL
             OR p.title ILIKE ${like} OR p.core_question ILIKE ${like}
             OR p.background ILIKE ${like} OR p.target_agency ILIKE ${like})
        AND (${query.category}::text IS NULL OR p.category = ${query.category})`;

    const order =
      query.sort === "recent"
        ? sql`ORDER BY p.created_at DESC`
        : query.sort === "opinions"
          ? sql`ORDER BY COUNT(c.id) DESC, MAX(c.created_at) DESC NULLS LAST`
          : query.sort === "balance"
            ? sql`ORDER BY (${sql.unsafe(BALANCE_SCORE)}) DESC, COUNT(c.id) DESC`
            : sql`ORDER BY COALESCE(MAX(c.created_at), p.created_at) DESC`;

    const rows = await sql`
      SELECT p.*,
             COUNT(c.id) FILTER (WHERE c.stance = 'SUPPORT')::int     AS support_count,
             COUNT(c.id) FILTER (WHERE c.stance = 'ALTERNATIVE')::int AS alternative_count,
             COUNT(c.id) FILTER (WHERE c.stance = 'OPPOSE')::int      AS oppose_count,
             COALESCE(MAX(c.created_at), p.created_at)::bigint        AS last_activity_at
        FROM policies p
        LEFT JOIN cards c ON c.policy_id = p.id
        ${filters}
       GROUP BY p.id
       ${order}
       LIMIT ${PAGE_SIZE} OFFSET ${(query.page - 1) * PAGE_SIZE}`;

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM policies p ${filters}`;

    // 분류별 개수. 칩에 숫자를 함께 보여주면 어디에 무엇이 있는지 바로 안다.
    const byCategory = await sql`
      SELECT p.category, COUNT(*)::int AS count FROM policies p GROUP BY p.category`;

    const counts: Record<string, number> = {};
    for (const row of byCategory) counts[String(row.category)] = Number(row.count);

    return { rows: rows as unknown as PolicySummary[], total: Number(count), counts };
  } catch (error) {
    console.error(error);
    return { rows: [], total: 0, counts: {}, error: "주제를 불러오지 못했습니다." };
  }
}

/** 한쪽으로 쏠렸는가. 목록에 안내를 붙일지 판단한다. */
export function needsBalance(s: PolicySummary): boolean {
  const sides = s.support_count + s.oppose_count;
  if (sides < 2) return false;
  return Math.abs(s.support_count - s.oppose_count) / sides >= 0.6;
}
