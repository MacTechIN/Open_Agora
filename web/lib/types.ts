/** 입장. 찬반은 주제가 아니라 안건의 쟁점 질문에 대한 것이다. */
export type Stance = "SUPPORT" | "ALTERNATIVE" | "OPPOSE";

export type Category =
  | "GOV_POLICY" | "LEGISLATION" | "PARTY_POLICY" | "LOCAL"
  | "PUBLIC_ORG" | "SOCIAL_ISSUE" | "WHISTLEBLOW";

export interface Policy {
  id: string;
  title: string;
  category: Category;
  background: string;
  core_question: string;
  official_source_url: string;
  target_agency: string | null;
  author_did: string;
  created_at: number;
  /** 작성자 서명(P1363, 16진). VS-A4 이전 글은 없다. */
  signature: string | null;
}

export interface PolicySummary extends Policy {
  support_count: number;
  alternative_count: number;
  oppose_count: number;
  last_activity_at: number;
}

export interface DebateCard {
  id: string;
  policy_id: string;
  stance: Stance;
  problem_definition: string;
  evidence_source: string;
  evidence_url: string;
  actionable_solution: string;
  author_did: string;
  created_at: number;
  /** 작성자 서명(P1363, 16진). VS-A4 이전 글은 없다. */
  signature: string | null;
}

export const STANCE_LABEL: Record<Stance, string> = {
  SUPPORT: "찬성",
  ALTERNATIVE: "대안",
  OPPOSE: "반대",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  GOV_POLICY: "정부정책",
  LEGISLATION: "입법안",
  PARTY_POLICY: "정당정책",
  LOCAL: "지자체",
  PUBLIC_ORG: "공공기관",
  SOCIAL_ISSUE: "사회현안",
  WHISTLEBLOW: "문제고발",
};

/**
 * 입장에 따라 묻는 말이 달라진다.
 *
 * 찬성하는 사람에게 "무엇이 문제인가"를 묻는 것은 답할 수 없는 질문이다.
 * 세 필드의 의미(논점·근거·제안)와 길이 제한은 고정이고 문구만 바뀐다.
 * 명세: docs/00_PRODUCT_SPEC.md §3.1
 */
export const QUESTIONS: Record<Stance, { problem: string; solution: string }> = {
  SUPPORT: {
    problem: "왜 이 방향이 옳다고 보시나요?",
    solution: "잘 되려면 무엇이 필요할까요?",
  },
  ALTERNATIVE: {
    problem: "어떤 점이 아쉬운가요?",
    solution: "어떤 대안을 제안하시나요?",
  },
  OPPOSE: {
    problem: "무엇이 문제인가요?",
    solution: "대신 어떻게 하면 좋을까요?",
  },
};
