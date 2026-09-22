/**
 * 광장 탐색의 표시 상수.
 *
 * 클라이언트 컴포넌트가 쓰므로 **서버 전용 모듈을 import 하지 않는다.**
 * lib/plaza.ts 는 데이터베이스를 쓰므로 여기서 갈라 둔다 — 섞으면 postgres
 * 모듈이 브라우저 번들로 끌려가 빌드가 깨진다.
 */
export const SORTS = {
  active: "활발한 순",
  balance: "균형 필요",
  recent: "최신순",
  opinions: "의견 많은 순",
} as const;

export type Sort = keyof typeof SORTS;

export const VIEWS = { card: "카드", list: "목록", section: "분류별" } as const;
export type View = keyof typeof VIEWS;

export const PAGE_SIZE = 20;
