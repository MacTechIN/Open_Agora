"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadOrCreateDid } from "@/lib/identity";

/**
 * 글쓰기 전에 회원 여부를 미리 확인한다.
 *
 * 이것이 없으면 사용자는 글을 다 쓰고 등록을 누른 뒤에야 막힌다. 특히 기기를
 * 바꾼 사람은 자기가 왜 막혔는지 알 수 없다 — 분명히 가입했는데 아니라고
 * 하기 때문이다. 그래서 **무엇이 일어났는지**를 먼저 설명한다.
 *
 * 확인하는 동안에는 막지 않는다. 네트워크가 느리다고 글쓰기 화면이 비어
 * 보이면 그것대로 고장으로 보인다.
 */
export default function MemberGate({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOrCreateDid()
      .then(async (did) => {
        const response = await fetch(`/api/auth/status?did=${encodeURIComponent(did)}`);
        const data = await response.json();
        if (!cancelled) setMember(response.ok ? Boolean(data.member) : null);
      })
      // 확인에 실패하면 막지 않는다. 서버가 쓰기 시점에 다시 본다.
      .catch(() => { if (!cancelled) setMember(null); });
    return () => { cancelled = true; };
  }, []);

  if (member === false) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>이 기기를 먼저 등록해 주세요</h3>
        <p style={{ marginTop: 0 }}>
          시민 ID는 <strong>기기 안에서 만들어지고 기기 밖으로 나오지 않습니다.</strong>
          그래서 브라우저를 바꾸거나 데이터를 지우면 새 ID가 됩니다.
        </p>
        <p className="muted">
          이미 인증하셨더라도 <strong>같은 이메일로 다시 인증</strong>하면 됩니다.
          새로 가입되는 것이 아니라 이 기기가 추가됩니다. 1분이면 끝납니다.
        </p>
        <Link href="/register"><button>이 기기 등록하기</button></Link>
      </div>
    );
  }

  return <>{children}</>;
}
