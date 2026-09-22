import { NextRequest, NextResponse } from "next/server";
import { buildBatch } from "@/lib/anchor";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
// 잎이 많으면 머클 계산과 달력 왕복에 시간이 걸린다.
export const maxDuration = 60;

/**
 * 앵커 배치를 만든다 (VS-F6).
 *
 * 일정 시간마다 바깥에서 부른다(.github/workflows/anchor.yml). Vercel Cron 을
 * 쓰지 않는 이유는 무료 요금제의 실행 빈도가 하루 한 번으로 묶여 있어서다.
 *
 * **비밀값으로 잠근다.** 아무나 부를 수 있으면 글 한 건짜리 배치를 계속 만들어
 * 달력에 쓸모없는 제출을 쏟아낼 수 있다. 비밀값이 설정되지 않았으면 아예
 * 거절한다 — 잠기지 않은 채로 도는 것보다 멈춘 것이 낫다.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.ANCHOR_SECRET;
    if (!expected) {
      return NextResponse.json(
        { error: "ANCHOR_SECRET 이 설정되지 않아 앵커링을 켤 수 없습니다" },
        { status: 503 }
      );
    }
    // 비교를 길이부터 하지 않는다 — 타이밍으로 길이를 알려 줄 이유가 없다.
    const given = request.headers.get("authorization") ?? "";
    if (given !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "권한이 없습니다" }, { status: 401 });
    }

    const result = await buildBatch();
    return NextResponse.json(result, { status: result.built ? 201 : 200 });
  } catch (error) {
    return fail(error);
  }
}
