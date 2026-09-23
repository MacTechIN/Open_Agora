import { NextRequest, NextResponse } from "next/server";
import { act, countFor, migrateAnon } from "@/lib/anon";
import { migrate, requireDb } from "@/lib/db";
import { fail } from "@/lib/api";
import { hashScopeServer } from "@/lib/scope";

export const dynamic = "force-dynamic";
// Groth16 검증은 짧지만, 첫 호출에 라이브러리를 올리는 시간이 붙는다.
export const maxDuration = 30;

/**
 * 주제에 익명으로 지지를 남긴다 (VS-C3a).
 *
 * **회원 확인(isMember)을 쓰지 않습니다.** 그것은 DID 로 사람을 특정하는
 * 방식이고, 여기서는 그러면 안 됩니다. 대신 영지식 증명으로 "이 그룹의
 * 누군가"임을 보입니다 — 서버는 끝내 누구인지 알지 못합니다.
 *
 * 한 사람이 한 주제에 한 번만 할 수 있습니다. 같은 사람이 같은 주제로 다시
 * 오면 nullifier 가 같기 때문입니다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const proof = await request.json();

    await migrate();
    await migrateAnon();

    // 없는 주제에 지지를 남기면 어디에도 보이지 않는 숫자가 된다.
    const db = requireDb();
    const [policy] = await db`SELECT id FROM policies WHERE id = ${id}`;
    if (!policy) {
      return NextResponse.json({ error: "없는 주제입니다" }, { status: 404 });
    }

    const result = await act(proof, hashScopeServer(id));
    if (!result.ok) {
      // 이미 한 것은 잘못이 아니다. 409 로 구분해 화면이 다르게 말할 수 있게 한다.
      return NextResponse.json(
        { error: result.message, reason: result.reason },
        { status: result.reason === "already" ? 409 : 400 }
      );
    }

    return NextResponse.json({ ok: true, count: await countFor(hashScopeServer(id)) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

/** 지금까지 모인 지지 수. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json({ count: await countFor(hashScopeServer(id)) });
  } catch (error) {
    return fail(error);
  }
}
