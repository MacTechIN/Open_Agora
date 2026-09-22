import { NextRequest, NextResponse } from "next/server";
import { AuthError, hashEmail, migrateAuth, verifyAndRegister } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 코드를 확인하고 시민으로 등록한다. */
export async function POST(request: NextRequest) {
  try {
    const { email, code, did } = await request.json();
    const address = String(email ?? "").trim();
    const identity = String(did ?? "").trim();

    if (!identity.startsWith("did:key:")) {
      throw new AuthError("시민 ID가 필요합니다.");
    }
    if (!/^\d{6}$/.test(String(code ?? "").trim())) {
      throw new AuthError("인증코드는 6자리 숫자입니다.");
    }

    await migrateAuth();
    await verifyAndRegister(hashEmail(address), String(code), identity);

    return NextResponse.json({ registered: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "요청을 처리하지 못했습니다" }, { status: 500 });
  }
}
