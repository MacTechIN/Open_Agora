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
              <a href="/register" className="muted" style={{ whiteSpace: "nowrap" }}>시민 인증</a>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
