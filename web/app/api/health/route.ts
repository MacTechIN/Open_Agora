import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 설정 점검.
 *
 * 무엇이 빠졌는지 알려주되 **값은 절대 담지 않는다.** 설정 여부만 참/거짓으로
 * 보인다. 값을 담으면 이 주소를 아는 누구나 연결 문자열과 열쇠를 가져간다.
 */
export async function GET() {
  const auth = process.env.AUTH_SECRET;
  return NextResponse.json({
    database: Boolean(process.env.DATABASE_URL),
    auth_secret: Boolean(auth && auth.length >= 32),
    mail: Boolean(process.env.RESEND_API_KEY),
    notes: {
      database: "없으면 주제·의견을 저장할 수 없습니다.",
      auth_secret: "32자 이상이어야 합니다. 없으면 시민 인증이 동작하지 않습니다.",
      mail: "없으면 인증코드가 메일로 가지 않고 서버 로그에만 남습니다.",
    },
  });
}
