import { NextResponse } from "next/server";
import { ValidationError } from "./validate";

/**
 * Postgres의 BIGINT는 정밀도 손실을 막으려 문자열로 온다.
 * 화면에서 숫자로 쓰므로 여기서 바꾼다.
 */
export function normalize(row: Record<string, unknown>) {
  return {
    ...row,
    created_at: Number(row.created_at),
    last_activity_at: row.last_activity_at != null ? Number(row.last_activity_at) : undefined,
  };
}

/**
 * 오류 응답.
 *
 * 검증 오류는 사용자가 고칠 수 있으므로 그대로 보여준다. 그 밖의 오류는
 * 내용을 감춘다 — 연결 문자열 같은 것이 응답에 실릴 수 있다.
 */
export function fail(error: unknown) {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: "요청을 처리하지 못했습니다" }, { status: 500 });
}
