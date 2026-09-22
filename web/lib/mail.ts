/**
 * 인증 메일 발송.
 *
 * RESEND_API_KEY 가 없으면 **코드를 서버 로그에 찍고 발송하지 않는다.**
 * 혼자 시험할 때 쓰는 경로이며, 응답으로는 절대 돌려주지 않는다 — 돌려주면
 * 아무나 남의 이메일로 코드를 받아 가입할 수 있다.
 */
const FROM = process.env.MAIL_FROM ?? "CivicAgora <onboarding@resend.dev>";

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
    // 메일 본문이나 키가 로그에 남지 않도록 상태 코드만 남긴다.
    console.error(`[civicagora] 메일 발송 실패 ${response.status}`, detail.slice(0, 200));
    throw new Error("인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
