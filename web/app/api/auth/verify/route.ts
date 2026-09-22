import { NextRequest, NextResponse } from "next/server";
import { AuthError, ConfigError, hashEmail, migrateAuth, verifyAndRegister } from "@/lib/auth";

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
    const result = await verifyAndRegister(hashEmail(address), String(code), identity);

    // 처음 가입인지 기기를 더한 것인지 알려준다. 같은 문구를 쓰면 이미
    // 가입한 사람이 "또 가입됐나?" 하고 헷갈린다. 이메일 자체는 담지 않는다.
    return NextResponse.json({ registered: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 설정 누락은 사용자가 고칠 수 없다. 무엇이 빠졌는지 알려야 운영자가
    // 고칠 수 있고, 사용자도 기다려야 한다는 것을 안다. 값 자체는 담지 않는다.
    if (error instanceof ConfigError) {
      console.error(error.message);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error(error);
    return NextResponse.json({ error: "요청을 처리하지 못했습니다" }, { status: 500 });
  }
}
