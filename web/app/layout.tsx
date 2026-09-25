import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CivicAgora — 시민 공론장",
  description: "정책을 함께 검증하는 시민 공론장",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="wrap">
          <header className="site">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
              <div>
                <h1><a href="/" style={{ color: "inherit" }}>CivicAgora</a></h1>
                <p>정책을 함께 검증하는 시민 공론장</p>
              </div>
              <div style={{ display: "flex", gap: 14, whiteSpace: "nowrap" }}>
                {/* 앵커 기록을 찾을 수 있어야 한다. 확인 경로를 숨기면
                    앵커링은 또 하나의 "믿어 주세요"가 된다. */}
                <a href="/map" className="muted">여론 지형도</a>
                <a href="/anchors" className="muted">앵커 기록</a>
                <a href="/register" className="muted">시민 인증</a>
              </div>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
