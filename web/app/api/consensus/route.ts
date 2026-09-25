import { NextRequest, NextResponse } from "next/server";
import { storeRates } from "@/lib/consensus";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 배치가 낸 군집별 찬성률을 받는다 (VS-F5).
 *
 * 인원 20명 미만 군집은 배치에서 이미 빠져 있습니다(INV-5). 어느 카드를
 * 배너로 올릴지는 서버가 정합니다 — 배치는 어느 카드가 `ALTERNATIVE` 인지
 * 모르고, 알 필요도 없습니다.
 */
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
    if (!body?.snapshot_hash || !Array.isArray(body.rates)) {
      return NextResponse.json({ error: "snapshot_hash 와 rates 가 필요합니다" }, { status: 400 });
    }
    const stored = await storeRates(String(body.snapshot_hash), body.rates);
    return NextResponse.json({ ok: true, stored }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
