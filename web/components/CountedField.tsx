"use client";

import { useRef, useState } from "react";
import { graphemeCount } from "@/lib/limits";

/**
 * 글자 수를 세는 입력 칸.
 *
 * ## 반드시 모듈 최상위에 두어야 한다
 *
 * 이 컴포넌트를 다른 컴포넌트 함수 **안에** 정의하면, 부모가 다시 그려질
 * 때마다 React 가 새로운 컴포넌트 종류로 보고 입력창을 통째로 교체한다.
 * 그러면 한글 조합(IME)이 매 글자마다 끊겨 "ㅌㅇㄹ"처럼 자모가 분리된다.
 * 영문은 조합 과정이 없어 멀쩡해 보이므로 놓치기 쉽다.
 *
 * ## 조합 중에는 글자 수를 다시 세지 않는다
 *
 * 한글은 자음·모음이 합쳐지는 동안 중간 상태를 거친다. 그 사이에 글자 수를
 * 갱신하면 숫자가 요동치고, 한도 근처에서는 아직 완성되지 않은 글자 때문에
 * 입력이 막힌 것처럼 보인다. onCompositionEnd 이후에만 센다.
 */
export default function CountedField({
  label,
  value,
  limit,
  onChange,
  placeholder,
  multiline = true,
  hint,
}: {
  label: string;
  value: string;
  limit: number;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  hint?: React.ReactNode;
}) {
  const composing = useRef(false);
  const [, force] = useState(0);

  const count = graphemeCount(value.trim());
  const over = count > limit;

  const handleChange = (next: string) => {
    onChange(next);
    // 조합이 끝난 뒤에만 글자 수 표시를 갱신한다.
    if (!composing.current) force((n) => n + 1);
  };

  const shared = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      handleChange(e.target.value),
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (
      e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      composing.current = false;
      handleChange(e.currentTarget.value);
    },
  };

  return (
    <div className="field">
      <div className="field-head">
        <strong>{label}</strong>
        <span className={over ? "count over" : "count"}>
          {/* 한도만 보여주면 얼마나 줄여야 할지 알 수 없다. */}
          {over ? `${count} / ${limit}자 — ${count - limit}자 초과` : `${count} / ${limit}자`}
        </span>
      </div>
      {multiline ? <textarea {...shared} /> : <input {...shared} />}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/**
 * 글자 수를 세지 않는 단순 입력 칸.
 *
 * 같은 이유로 모듈 최상위에 둔다.
 */
export function PlainField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  optional,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="field">
      <strong style={{ display: "block", marginBottom: 6 }}>
        {label}
        {optional && <span className="muted"> (선택)</span>}
      </strong>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
