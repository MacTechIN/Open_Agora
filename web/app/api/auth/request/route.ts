import { NextRequest, NextResponse } from "next/server";
import { AuthError, ConfigError, hashEmail, issueCode, migrateAuth } from "@/lib/auth";
import { MailError, sendVerificationCode } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * 인증코드를 요청한다.
 *
 * **이미 가입한 이메일도 코드를 받습니다.** 한 사람이 기기를 5대까지
 * 등록하므로(D21), 기기를 바꾸거나 앱을 새로 깔면 반드시 다시 여기를
 * 지나야 합니다. 여기서 막으면 D21 이 코드로는 있으나 아무도 쓸 수 없습니다.
 *
 * **가입 여부를 응답에 담지 않습니다.** 담으면 아무나 남의 주소를 넣어
 * 그 사람이 회원인지 알아낼 수 있습니다. 이 플랫폼은 어떤 글이 누구의
 * 것인지조차 저장하지 않는데, 회원 명단을 조회하게 두면 그 노력이
 * 무의미해집니다. 그래서 어떤 주소를 넣든 응답은 똑같습니다.
 *
 * 기기 상한은 **코드를 맞힌 뒤에** 알립니다 — 그 메시지는 메일함을 가진
 * 사람에게만 닿아야 합니다. 남용은 시간당 요청 수로 막습니다.
 */
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
