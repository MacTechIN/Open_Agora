"use client";

import Link from "next/link";

/**
 * 오류 표시.
 *
 * 인증이 필요하다는 오류면 인증 화면 링크를 함께 보여준다. 무엇을 해야
 * 하는지 알려주지 않고 막기만 하면 사용자는 길을 잃는다.
 */
export default function ErrorNotice({ message }: { message: string }) {
  const needsRegistration = message.includes("시민 인증");
  return (
    <div className="card error">
      <div>{message}</div>
      {needsRegistration && (
        <div style={{ marginTop: 10 }}>
          <Link href="/register">
            <button>시민 인증 하러 가기</button>
          </Link>
        </div>
      )}
    </div>
  );
}
