# 배포 안내 — 웹 공론장

무료 티어로 시작합니다. 사용자가 늘기 전까지는 비용이 들지 않습니다.

| 역할 | 서비스 | 비고 |
|-|-|-|
| 데이터베이스 | [Neon](https://neon.tech) | Postgres. 무료 0.5GB |
| 웹 호스팅 | [Vercel](https://vercel.com) | Next.js. 무료 개인 프로젝트 |

---

## 1. Neon — 연결 문자열 받기

1. 프로젝트 콘솔에서 왼쪽 위 **Connect** 를 누릅니다.
2. 연결 문자열을 복사합니다.

```
postgresql://사용자:비밀번호@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

**비밀번호가 포함된 접속 정보입니다.** 저장소나 공개된 곳에 올리지 마십시오.
유출되면 `Roles → Reset password` 로 무효화할 수 있습니다.

테이블은 앱이 첫 요청 때 자동으로 만듭니다(`web/lib/db.ts` 의 `migrate()`).
따로 SQL을 실행할 필요가 없습니다.

## 2. Vercel — 배포

1. [vercel.com/new](https://vercel.com/new) 에서 GitHub 계정으로 로그인합니다.
2. `MacTechIN/Open_Agora` 저장소를 선택합니다.
3. **Root Directory 를 `web` 으로 지정합니다.** 이것을 빠뜨리면 저장소
   최상위에서 Next.js를 찾지 못해 빌드가 실패합니다.
4. Environment Variables 에 추가합니다.

   | Name | Value | 없으면 |
   |-|-|-|
   | `DATABASE_URL` | Neon에서 복사한 연결 문자열 | 주제·의견을 저장할 수 없음 |
   | `AUTH_SECRET` | **32자 이상 임의 문자열** | 시민 인증이 동작하지 않음 |
   | `RESEND_API_KEY` | Resend API 키 (선택) | 인증코드가 메일로 안 가고 서버 로그에만 남음 |

   `AUTH_SECRET` 은 이메일 해시에 쓰는 열쇠입니다. **한번 정하면 바꾸지
   않습니다** — 바꾸면 기존 가입 이메일의 해시와 맞지 않아 같은 사람이 다시
   가입할 수 있게 됩니다.

   생성 예시:

   ```powershell
   # PowerShell
   -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
   ```

   ```bash
   # macOS / Linux
   openssl rand -hex 24
   ```

   설정이 제대로 됐는지는 배포 후 `/api/health` 로 확인합니다. 값은 보이지
   않고 설정 여부만 참/거짓으로 나옵니다.

5. Deploy 를 누릅니다.

프레임워크는 `web/vercel.json` 이 `nextjs` 로 지정합니다. 프로젝트 설정의
Framework Preset 이 **Other** 로 잡히면 Vercel 이 정적 사이트로 취급해
`public` 폴더를 찾다가 실패합니다 — Next.js 빌드 자체는 성공하는데 그
다음 단계에서 깨지므로 로그만 보면 원인을 짐작하기 어렵습니다.
설정 화면에서 바꿔도 되지만, 저장소에 적어 두면 새로 연결할 때도 맞습니다.

배포가 끝나면 `https://<프로젝트명>.vercel.app` 주소가 나옵니다.
이후 `main` 에 푸시할 때마다 자동으로 다시 배포됩니다.

## 3. 확인

| 확인할 것 | 기대 |
|-|-|
| 첫 화면 | "아직 올라온 주제가 없습니다" |
| 주제 올리기 | 주제와 첫 의견을 함께 등록 → 상세 화면으로 이동 |
| 광장 복귀 | 방금 올린 주제가 찬반 막대와 함께 보임 |
| 다른 기기·브라우저 | **같은 주제가 보임** ← 공유가 되는지 확인하는 핵심 |

마지막 항목이 중요합니다. 지금까지 네이티브 앱은 각자 로컬 저장소만 봐서
서로의 글이 보이지 않았습니다. 웹에서 다른 기기로 같은 글이 보이면 공유
계층이 동작하는 것입니다.

## 4. 로컬에서 돌리기

```bash
cd web
cp .env.example .env.local     # DATABASE_URL 을 채운다
npm install
npm run dev                    # http://localhost:3000
```

Neon 연결 문자열을 그대로 쓰면 배포본과 같은 데이터를 봅니다. 분리하려면
Neon에서 브랜치를 하나 더 만들어 개발용 연결 문자열을 씁니다.

---

## 아직 안 되는 것

이 배포는 **다리(bridge)** 단계입니다. 명세의 P2P 계층이 아직 없어서
공유 서버를 씁니다. → `docs/15_BRIDGE_SERVER.md`

| 기능 | 상태 |
|-|-|
| 주제·의견 작성과 공유 | 동작 |
| 반응(💡🤝🔍⚖️)과 점수 | 미구현 (VS-D2, VS-G1) |
| 댓글 | 미구현 (VS-D3) |
| AI 톤 코칭 | 미구현 (VS-E1~E3) |
| 브리징 정렬·합의 배너 | 미구현 (VS-F3, F5) |
| 보고서 다운로드 | 미구현 (VS-H2′) |
| 글 서명·위변조 검증 | 미구현 (VS-A4) |
| P2P 전파 | 미구현 (VS-B1, B2′) |

**현재는 서버 운영자가 데이터를 고칠 수 있습니다.** 서명(VS-A4)과 온체인
앵커링(VS-F6)이 붙기 전까지는 그렇습니다. 이 한계를 화면에도 표시해야 합니다.
