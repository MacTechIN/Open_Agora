import { NextRequest, NextResponse } from "next/server";
import { publicMap, storeMap } from "@/lib/opinionmap";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 여론 지형도 (VS-F4).
 *
 * 공개합니다. 다만 **누구의 점인지는 담지 않습니다**(INV-2) — 군집 요약과
 * 식별자 없는 점 구름뿐입니다. 참여자가 적으면 아예 내보내지 않습니다:
 * 사람이 몇 안 될 때 점 구름은 익명이 아닙니다.
 */
export async function GET() {
  try {
    return NextResponse.json(await publicMap());
  } catch (error) {
    return fail(error);
  }
}

/** 배치가 계산한 지형도를 받는다. 운영 경로이므로 비밀값으로 잠근다. */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    if (!body?.snapshot_hash || !Array.isArray(body.positions)) {
      return NextResponse.json({ error: "snapshot_hash 와 positions 가 필요합니다" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, stored: await storeMap(body) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
