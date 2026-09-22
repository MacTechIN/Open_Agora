"use client";

import { useState } from "react";
import { LIMITS, graphemeCount } from "@/lib/limits";
import { QUESTIONS, STANCE_LABEL, type Stance } from "@/lib/types";

export interface OpinionValue {
  stance: Stance;
  problem_definition: string;
  evidence_source: string;
  evidence_url: string;
  actionable_solution: string;
}

export const EMPTY_OPINION: OpinionValue = {
  stance: "SUPPORT",
  problem_definition: "",
  evidence_source: "",
  evidence_url: "",
  actionable_solution: "",
};

/** 세 칸이 모두 채워졌고 한도를 넘지 않았는가. */
export function opinionReady(v: OpinionValue): boolean {
  const ok = (text: string, limit: number) => {
    const n = graphemeCount(text.trim());
    return n > 0 && n <= limit;
  };
  return (
    ok(v.problem_definition, LIMITS.card.problemDefinition) &&
    ok(v.evidence_source, LIMITS.card.evidenceSource) &&
    ok(v.actionable_solution, LIMITS.card.actionableSolution) &&
    v.evidence_url.trim().length > 0
  );
}

function Counted({
  label, value, limit, onChange, placeholder,
}: {
  label: string; value: string; limit: number;
  onChange: (v: string) => void; placeholder: string;
}) {
  const count = graphemeCount(value.trim());
  const over = count > limit;
  return (
    <div className="field">
      <div className="field-head">
        <strong>{label}</strong>
        <span className={over ? "count over" : "count"}>
          {/* 한도만 보여주면 얼마나 줄여야 할지 알 수 없다. */}
          {over ? `${count} / ${limit}자 — ${count - limit}자 초과` : `${count} / ${limit}자`}
        </span>
      </div>
      <textarea value={value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * 의견 작성 폼.
 *
 * 입장에 따라 묻는 말이 바뀐다. 찬성하는 사람에게 "무엇이 문제인가"를 묻는
 * 것은 답할 수 없는 질문이다. 저장되는 필드의 의미와 길이 제한은 고정이고
 * 화면 문구만 바뀐다. 명세: docs/00_PRODUCT_SPEC.md §3.1
 */
export default function OpinionForm({
  value, onChange,
}: {
  value: OpinionValue;
  onChange: (v: OpinionValue) => void;
}) {
  const set = <K extends keyof OpinionValue>(key: K, v: OpinionValue[K]) =>
    onChange({ ...value, [key]: v });
  const q = QUESTIONS[value.stance];

  return (
    <>
      <div className="field">
        <strong style={{ display: "block", marginBottom: 8 }}>어떤 입장이신가요?</strong>
        <div className="stances">
          {(["SUPPORT", "ALTERNATIVE", "OPPOSE"] as Stance[]).map((s) => (
            <button key={s} type="button" className="stance-btn" data-s={s}
                    data-on={value.stance === s}
                    onClick={() => set("stance", s)}>
              {s === "ALTERNATIVE" ? "대안 제시" : STANCE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <Counted label={`① ${q.problem}`} value={value.problem_definition}
               limit={LIMITS.card.problemDefinition}
               onChange={(v) => set("problem_definition", v)}
               placeholder="예) 현행 제도가 모든 업종에 똑같이 적용되어 소상공인에게 과도한 행정 부담을 줍니다." />

      <Counted label="② 어떤 근거가 있나요?" value={value.evidence_source}
               limit={LIMITS.card.evidenceSource}
               onChange={(v) => set("evidence_source", v)}
               placeholder="예) 통계청 2026년 사업체노동력조사에서 5인 미만 사업장의 행정 부담이 가장 높게 나타났습니다." />

      <div className="field">
        <strong style={{ display: "block", marginBottom: 6 }}>근거 자료의 출처 링크</strong>
        <input value={value.evidence_url} placeholder="https://kostat.go.kr/..."
               onChange={(e) => set("evidence_url", e.target.value)} />
        <div className="hint">통계청, 정부 고시, 국회 의안, 학술 논문 같은 1차 자료를 권합니다.</div>
      </div>

      <Counted label={`③ ${q.solution}`} value={value.actionable_solution}
               limit={LIMITS.card.actionableSolution}
               onChange={(v) => set("actionable_solution", v)}
               placeholder="예) 업종별로 기준을 나누고, 소규모 사업장에는 신고 절차를 간소화합니다." />
    </>
  );
}
