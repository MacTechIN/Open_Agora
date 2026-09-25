import { NextRequest, NextResponse } from "next/server";
import { myPosition } from "@/lib/mymap";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 내 위치 (VS-F4).
 *
 * **영지식 증명으로 본인임을 보인 사람에게만** 돌려줍니다. 명세의 "타인의
 * 위치는 조회 불가"(INV-2)를 지키는 방법은 두 가지뿐입니다 — 아무에게도
 * 주지 않거나, 본인만 받게 하거나. 후자를 택했고, 그 인증 수단이 이미
 * 만들어 둔 필명 증명입니다.
 *
 * 증명 안에 누구인지는 들어 있지 않습니다. 서버가 보는 것은 필명뿐이고,
 * 필명은 이메일·DID 어느 쪽과도 이어지지 않습니다.
 */
export async function POST(request: NextRequest) {
  try {
    const proof = await request.json();
    const place = await myPosition(proof);
    if (!place.ok) {
      return NextResponse.json({ error: place.reason }, { status: 400 });
    }
    return NextResponse.json(place.position ?? { absent: true });
  } catch (error) {
    return fail(error);
  }
}
