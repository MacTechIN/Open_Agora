import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 설정 점검.
 *
 * 무엇이 빠졌는지 알려주되 **값은 절대 담지 않는다.** 이 주소는 누구나
 * 열 수 있으므로, 값을 담으면 연결 문자열과 열쇠가 그대로 새어 나간다.
 *
 * 대신 진단에 필요한 만큼만 구분해서 알린다 — "없음"과 "설정했지만 짧음"은
 * 고치는 방법이 다르다.
 */
function describe(value: string | undefined, minLength = 1): string {
  if (value === undefined) return "설정되지 않음";
  if (value.length === 0) return "빈 값";
  if (value.length < minLength) return `너무 짧음 (${value.length}자, ${minLength}자 이상 필요)`;
  return "설정됨";
}

export async function GET() {
  const authSecret = process.env.AUTH_SECRET;
  const resendKey = process.env.RESEND_API_KEY;

  // 비슷한 이름으로 잘못 넣은 경우를 찾아준다. 이름이 한 글자만 달라도
  // 없는 것과 같은데, 화면에서는 값이 들어 있는 것처럼 보여 헷갈린다.
  // 이름만 보고 값은 절대 담지 않는다.
  const looksRelated = Object.keys(process.env)
    .filter((name) =>
      /AUTH|SECRET|RESEND|MAIL|CIVIC|AGORA/i.test(name) &&
      !["AUTH_SECRET", "RESEND_API_KEY", "MAIL_FROM"].includes(name)
    )
    .sort();

  return NextResponse.json({
    ok:
      Boolean(process.env.DATABASE_URL) &&
      Boolean(authSecret && authSecret.length >= 32),
    database: {
      status: describe(process.env.DATABASE_URL),
      required: true,
      note: "없으면 주제·의견을 저장할 수 없습니다.",
    },
    auth_secret: {
      status: describe(authSecret, 32),
      required: true,
      note: "이메일 해시에 쓰는 열쇠입니다. 한번 정하면 바꾸지 않습니다.",
    },
    mail: {
      status: describe(resendKey),
      required: false,
      note: "없으면 인증코드가 메일로 가지 않고 서버 로그에만 남습니다.",
    },
    // 환경변수는 배포 시점에 굳는다. 추가한 뒤 재배포하지 않으면 반영되지 않는다.
    // 우리가 쓰지 않는 비슷한 이름이 있으면 오타일 가능성이 높다.
    unused_similar_names: looksRelated,
    expected_names: ["DATABASE_URL", "AUTH_SECRET", "RESEND_API_KEY"],
    deployed_at: new Date().toISOString(),
    hint:
      "값을 추가한 뒤 반드시 재배포해야 반영됩니다. " +
      "Environment 는 Production 에도 체크되어 있어야 합니다.",
  });
}
