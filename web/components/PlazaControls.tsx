"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SORTS, VIEWS, type Sort, type View } from "@/lib/plaza-view";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

/**
 * 광장 탐색 컨트롤.
 *
 * 상태를 주소창에 둔다. 그래야 "입법안 · 균형 필요" 같은 화면을 링크로
 * 공유할 수 있고, 뒤로 가기가 자연스럽게 동작한다.
 */
export default function PlazaControls({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");

  const current = {
    q: params.get("q") ?? "",
    c: params.get("c"),
    sort: (params.get("sort") ?? "active") as Sort,
    view: (params.get("view") ?? "card") as View,
  };

  /** 한 항목만 바꾸고 나머지는 유지한다. 페이지는 항상 1로 되돌린다. */
  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const query = next.toString();
    router.push(query ? `/?${query}` : "/");
  }

  return (
    <div className="controls">
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: draft.trim() || null });
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="주제·쟁점 질문·기관 검색"
          aria-label="검색"
        />
        <button type="submit">검색</button>
        {current.q && (
          <button type="button" className="ghost" onClick={() => { setDraft(""); go({ q: null }); }}>
            지우기
          </button>
        )}
      </form>

      {/* 분류 칩. 숫자를 함께 보여주면 어디에 무엇이 있는지 바로 안다. */}
      <div className="chips">
        <button className="chip" data-on={!current.c} onClick={() => go({ c: null })}>
          전체 {total > 0 && <span className="n">{total}</span>}
        </button>
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((key) => {
          const n = counts[key] ?? 0;
          if (n === 0 && current.c !== key) return null;
          return (
            <button key={key} className="chip" data-on={current.c === key} onClick={() => go({ c: key })}>
              {CATEGORY_LABEL[key]} <span className="n">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="정렬">
          {(Object.keys(SORTS) as Sort[]).map((key) => (
            <button key={key} className="tab" data-on={current.sort === key} onClick={() => go({ sort: key })}>
              {SORTS[key]}
            </button>
          ))}
        </div>
        <div className="tabs" role="group" aria-label="보기 방식">
          {(Object.keys(VIEWS) as View[]).map((key) => (
            <button key={key} className="tab" data-on={current.view === key} onClick={() => go({ view: key })}>
              {VIEWS[key]}
            </button>
          ))}
        </div>
      </div>

      {current.sort === "balance" && (
        <div className="hint" style={{ marginTop: -4 }}>
          한쪽으로 기운 주제를 먼저 보여줍니다. <strong>반대편 의견이 가장 필요한 곳</strong>입니다.
        </div>
      )}
    </div>
  );
}
