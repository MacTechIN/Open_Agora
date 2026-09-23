import { NextRequest, NextResponse } from "next/server";
import { isMember, migrateAuth } from "@/lib/auth";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 이 기기가 회원인가 (VS-A2′).
 *
 * 앱이 **시작할 때 조용히** 확인하려고 둡니다. 이것이 없으면 사용자는 글을 다
 * 쓰고 등록을 누른 뒤에야 "인증이 필요합니다"를 보게 됩니다. 쓴 글을 잃지는
 * 않지만, 막다른 길에 도착한 뒤에 안내하는 것은 안내가 아닙니다.
 *
 * DID 는 글마다 화면에 이미 드러나 있으므로 여기서 새로 새는 것은 없습니다.
 * 반대로 이메일이나 기기 수는 **담지 않습니다** — 그것은 회원 자격과 사람을
 * 잇는 실마리가 됩니다.
 */
export async function GET(request: NextRequest) {
  try {
    const did = (request.nextUrl.searchParams.get("did") ?? "").trim();
    if (!did.startsWith("did:key:")) {
      return NextResponse.json({ error: "시민 ID가 필요합니다" }, { status: 400 });
    }
    await migrateAuth();
    return NextResponse.json({ member: await isMember(did) });
  } catch (error) {
    return fail(error);
  }
}
