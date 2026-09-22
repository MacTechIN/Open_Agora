import { NextRequest, NextResponse } from "next/server";
import { AuthError, ConfigError, emailAlreadyUsed, hashEmail, issueCode, migrateAuth } from "@/lib/auth";
import { MailError, sendVerificationCode } from "@/lib/mail";

export const dynamic = "force-dynamic";

/** 인증코드를 요청한다. */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    const address = String(email ?? "").trim();
    // 형식만 본다. 실제 수신 여부는 코드가 도착하는지로 확인된다.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new AuthError("이메일 주소를 확인해 주세요.");
    }

    await migrateAuth();
    const emailHash = hashEmail(address);

    if (await emailAlreadyUsed(emailHash)) {
      throw new AuthError("이미 가입한 이메일입니다.");
    }

    const code = await issueCode(emailHash);
    await sendVerificationCode(address, code);

    // 코드를 응답에 담지 않는다. 담으면 남의 이메일로 가입할 수 있다.
    return NextResponse.json({ sent: true });
  } catch (error) {
    if (error instanceof AuthError || error instanceof MailError) {
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
