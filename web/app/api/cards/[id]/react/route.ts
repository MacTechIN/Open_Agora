import { NextRequest, NextResponse } from "next/server";
import { react } from "@/lib/reactions";
import { isReactionKind } from "@/lib/scope";
import { migrate, requireDb } from "@/lib/db";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 카드에 반응을 남기거나 바꾼다 (VS-D2).
 *
 * **회원 확인(isMember)을 쓰지 않습니다.** 그것은 DID 로 사람을 특정하는
 * 방식이고, 여기서는 그러면 안 됩니다 — 한 사람이 기기를 다섯 대까지 가질 수
 * 있어(D21) DID 로 세면 다섯 몫이 되고, 무엇보다 누가 무엇을 눌렀는지가
 * 남습니다. 대신 영지식 증명으로 "이 그룹의 누군가"임만 확인합니다.
 *
 * **반응자 목록을 돌려주는 경로는 두지 않습니다**(G-PRIV). 집계만 나갑니다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { kind, at, proof } = body ?? {};

    if (!isReactionKind(kind)) {
      return NextResponse.json({ error: "반응 종류가 올바르지 않습니다" }, { status: 400 });
    }

    await migrate();
    const db = requireDb();
    // 없는 카드에 반응하면 어디에도 보이지 않는 숫자가 된다.
    const [card] = await db`SELECT id FROM cards WHERE id = ${id}`;
    if (!card) {
      return NextResponse.json({ error: "없는 의견입니다" }, { status: 404 });
    }

    const result = await react(proof, id, kind, Number(at));
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, changed: result.changed }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
