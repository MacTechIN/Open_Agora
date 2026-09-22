/**
 * 인증 메일 발송.
 *
 * RESEND_API_KEY 가 없으면 **코드를 서버 로그에 찍고 발송하지 않는다.**
 * 혼자 시험할 때 쓰는 경로이며, 응답으로는 절대 돌려주지 않는다 — 돌려주면
 * 아무나 남의 이메일로 코드를 받아 가입할 수 있다.
 */
const FROM = process.env.MAIL_FROM ?? "CivicAgora <onboarding@resend.dev>";

/**
 * 메일 발송 실패.
 *
 * 사용자가 고칠 수 있는 경우(주소 오타)와 운영자가 고쳐야 하는 경우(발신
 * 도메인 미인증)가 섞여 있으므로, 서버가 받은 이유를 그대로 전달한다.
 * 일반 500 으로 묻으면 어느 쪽인지 알 수 없다.
 */
export class MailError extends Error {}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // 개발 경로. 배포 환경에서 이 줄이 보이면 메일 설정이 빠진 것이다.
    console.warn(`[civicagora] 메일 발송 설정 없음. 인증코드=${code}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `CivicAgora 인증코드 ${code}`,
      text: [
        "CivicAgora 시민 공론장 가입 인증코드입니다.",
        "",
        `    ${code}`,
        "",
        "10분 안에 입력해 주세요.",
        "",
        "이 코드로 확인이 끝나면 회원 자격만 남고,",
        "어떤 글이 누구의 것인지는 저장하지 않습니다.",
        "",
        "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 키가 로그에 남지 않도록 상태 코드와 앞부분만 남긴다.
    console.error(`[civicagora] 메일 발송 실패 ${response.status}`, detail.slice(0, 300));

    // Resend 의 테스트 발신 주소는 계정 소유자에게만 보낼 수 있다.
    // 도메인 인증 전에 남에게 보내려 하면 403 이 온다. 흔한 상황이라
    // 무엇을 해야 하는지 알려준다.
    if (response.status === 403 && FROM.includes("resend.dev")) {
      throw new MailError(
        "아직 발신 도메인이 인증되지 않아 가입자 본인 이메일로만 보낼 수 있습니다. " +
        "운영자가 Resend 에서 도메인을 인증해야 다른 주소로도 발송됩니다."
      );
    }
    throw new MailError("인증 메일을 보내지 못했습니다. 주소를 확인하고 잠시 후 다시 시도해 주세요.");
  }
}
