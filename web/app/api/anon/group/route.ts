import { NextResponse } from "next/server";
import { commitments, currentRoot, migrateAnon } from "@/lib/anon";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 익명 회원 명부 (VS-C3a).
 *
 * **공개합니다.** 커밋먼트는 사람을 가리키지 않고, 명부가 공개되어야 회원이
 * 자기 손으로 루트를 계산해 "내가 그 안에 있다"를 확인할 수 있습니다. 서버가
 * 준 루트를 그대로 믿으면 서버가 아무 그룹이나 주고 거기 서명하게 만들 수
 * 있습니다.
 */
export async function GET() {
  try {
    await migrateAnon();
    const root = await currentRoot();
    return NextResponse.json({
      commitments: await commitments(),
      root: root?.root ?? null,
      member_count: root?.count ?? 0,
    });
  } catch (error) {
    return fail(error);
  }
}
