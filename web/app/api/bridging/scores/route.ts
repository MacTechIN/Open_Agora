import { NextRequest, NextResponse } from "next/server";
import { storeScores } from "@/lib/reactions";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 배치가 낸 브리징 점수를 받는다 (VS-F3).
 *
 * 카드 단위 값만 받습니다. 사용자 잠재 성향 f_u 는 **보내지도 받지도
 * 않습니다** — 개인의 정치 성향이며 외부로 공개하지 않습니다(INV-2).
 *
 * 스냅샷 해시·모델 버전·시드를 함께 기록합니다. 어느 데이터로 어느 모델이
 * 낸 값인지 남지 않으면 "다시 계산해 보니 다르다"는 말에 답할 수 없습니다.
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
    const { model_version, seed, snapshot_hash, scores } = body ?? {};
    if (!snapshot_hash || typeof snapshot_hash !== "string") {
      return NextResponse.json({ error: "snapshot_hash 가 필요합니다" }, { status: 400 });
    }
    if (!scores || typeof scores !== "object") {
      return NextResponse.json({ error: "scores 가 필요합니다" }, { status: 400 });
    }

    const stored = await storeScores(
      { model_version: Number(model_version), seed: Number(seed), snapshot_hash },
      scores
    );
    return NextResponse.json({ ok: true, stored }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
