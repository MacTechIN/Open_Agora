import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 설정 점검.
 *
 * 무엇이 빠졌는지 알려주되 **값은 절대 담지 않는다.** 이 주소는 누구나
 * 열 수 있으므로, 값을 담으면 연결 문자열과 열쇠가 그대로 새어 나간다.
 *
 * 대신 진단에 필요한 만큼만 구분해서 알린다 — "없음", "짧음", "이름에 공백"
 * 은 고치는 방법이 각각 다르다.
 */
function describe(value: string | undefined, minLength = 1): string {
  if (value === undefined) return "설정되지 않음";
  if (value.length === 0) return "빈 값";
  if (value.trim().length === 0) return "공백만 들어 있음";
  if (value.length < minLength) {
    return `너무 짧음 (${value.length}자, ${minLength}자 이상 필요)`;
  }
  return "설정됨";
}

/**
 * 이름이 미묘하게 다른 변수를 찾는다.
 *
 * 앞뒤 공백이나 대소문자가 다르면 전혀 다른 변수가 된다. 관리 화면에서는
 * 멀쩡해 보이므로 눈으로 찾기 어렵다. **이름만 보고 값은 담지 않는다.**
 */
function findNearMiss(expected: string): string | null {
  const target = expected.toUpperCase();
  for (const name of Object.keys(process.env)) {
    if (name === expected) continue;
    const normalized = name.trim().toUpperCase().replace(/[-\s]/g, "_");
    if (normalized === target) {
      // 어떻게 다른지 알려준다. 공백은 눈에 안 보이므로 표시해 준다.
      return JSON.stringify(name);
    }
  }
  return null;
}

export async function GET() {
  const authSecret = process.env.AUTH_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  return NextResponse.json({
    ok: Boolean(databaseUrl) && Boolean(authSecret && authSecret.length >= 32),
    database: {
      status: describe(databaseUrl),
      required: true,
      near_miss: findNearMiss("DATABASE_URL"),
      note: "없으면 주제·의견을 저장할 수 없습니다.",
    },
    auth_secret: {
      status: describe(authSecret, 32),
      required: true,
      near_miss: findNearMiss("AUTH_SECRET"),
      note: "이메일 해시에 쓰는 열쇠입니다. 한번 정하면 바꾸지 않습니다.",
    },
    mail: {
      status: describe(resendKey),
      required: false,
      near_miss: findNearMiss("RESEND_API_KEY"),
      note: "없으면 인증코드가 메일로 가지 않고 서버 로그에만 남습니다.",
    },
    // 어느 배포가 응답했는지. 재배포가 실제로 반영됐는지 구분하는 데 쓴다.
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? "(로컬)",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "(로컬)",
    hint:
      "near_miss 에 이름이 뜨면 그 변수의 이름이 잘못된 것입니다. " +
      "값을 추가한 뒤에는 반드시 재배포해야 하고, Environment 에 Production 이 " +
      "체크되어 있어야 합니다.",
  });
}
