import { NextResponse } from "next/server";
import { migrate, requireDb } from "@/lib/db";
import { fail, normalize } from "@/lib/api";

export const dynamic = "force-dynamic";

/** 주제 하나와 그 의견 전부. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await migrate();
    const { id } = await params;
    const db = requireDb();

    const [policy] = await db`SELECT * FROM policies WHERE id = ${id}`;
    if (!policy) {
      return NextResponse.json({ error: "없는 주제입니다" }, { status: 404 });
    }
    const opinions = await db`
      SELECT * FROM cards WHERE policy_id = ${id} ORDER BY created_at DESC`;

    return NextResponse.json({
      policy: normalize(policy),
      opinions: opinions.map(normalize),
    });
  } catch (error) {
    return fail(error);
  }
}
