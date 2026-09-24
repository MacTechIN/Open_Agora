import { NextRequest, NextResponse } from "next/server";
import { snapshotForBridging } from "@/lib/reactions";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 브리징 배치용 스냅샷 (VS-F3).
 *
 * 배치가 데이터베이스 자격증명을 갖지 않도록 HTTP 로 건넵니다. 자격증명을
 * GitHub 시크릿에도 두면 같은 열쇠가 두 곳에 있게 되고, 그만큼 샐 자리가
 * 늘어납니다.
 *
 * **필명은 나가지 않습니다.** 모델에 필요한 것은 "같은 사람인가"뿐이라
 * 스냅샷 안에서만 통하는 번호로 바꿉니다. 그래도 반응의 모양 자체는 민감한
 * 자료이므로 비밀값으로 잠급니다.
 */
export async function GET(request: NextRequest) {
  try {
    const expected = process.env.BRIDGING_SECRET;
    if (!expected) {
      return NextResponse.json(
        { error: "BRIDGING_SECRET 이 설정되지 않아 배치를 켤 수 없습니다" },
        { status: 503 }
      );
    }
    if ((request.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "권한이 없습니다" }, { status: 401 });
    }
    return NextResponse.json(await snapshotForBridging());
  } catch (error) {
    return fail(error);
  }
}
