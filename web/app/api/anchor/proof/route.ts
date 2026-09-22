import { NextRequest, NextResponse } from "next/server";
import { proofFor } from "@/lib/anchor";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 한 글의 앵커 증명 (VS-F6).
 *
 * 누구나 부를 수 있다. 증명은 감출 것이 아니라 **내보이라고 있는 것**이다.
 *
 *   GET /api/anchor/proof?kind=opinion&id=...
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const kind = params.get("kind");
    const id = (params.get("id") ?? "").trim();
    if (kind !== "policy" && kind !== "opinion") {
      return NextResponse.json({ error: "kind 는 policy 또는 opinion 이어야 합니다" }, { status: 400 });
    }
    if (!id) {
      return NextResponse.json({ error: "id 가 필요합니다" }, { status: 400 });
    }

    const proof = await proofFor(kind, id);
    if (!proof) {
      // 아직 배치에 들어가지 않은 것과 없는 글을 구분한다. 앞의 것은 기다리면
      // 되고, 뒤의 것은 기다려도 오지 않는다.
      return NextResponse.json(
        { error: "아직 앵커에 들어가지 않았습니다", anchored: false },
        { status: 404 }
      );
    }
    return NextResponse.json(proof);
  } catch (error) {
    return fail(error);
  }
}
