# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 현재 상태

**구현이 진행 중입니다.** 현재 상황은 `docs/17_STATUS.md`에 있습니다 — 계획이
아니라 실측이므로, 계획 문서와 어긋나면 그쪽이 사실입니다.

주제를 올리고 세 입장으로 의견을 다는 공론장이 웹·Windows·Android에서 같은
데이터로 동작합니다. 브리징·톤 코칭·블록체인은 아직 없습니다.

### 저장소 배치

```
core/          공유 Rust 코어. civicagora.udl 이 유일한 인터페이스 정의
web/           Next.js 15 광장 (open-agora.vercel.app)
apps/windows/  WinUI 3 / .NET 8
apps/android/  Jetpack Compose / Kotlin
apps/ios/      SwiftUI. 뼈대만 — 맥에서만 빌드되고 아직 컴파일된 적 없음
contracts/     한도·검증 픽스처·API 샘플. 코어와 웹이 공유하는 계약
scripts/       불변식 게이트
docs/          단일 진실 공급원
ref_docs/      아카이브(비권위). 수정하지 않음
```

### 명령

```bash
# 코어
cargo test -p civicagora-core              # 전체 (현재 64개)
cargo test -p civicagora-core card::        # 모듈 하나
cargo test -p civicagora-core -- --nocapture 검증할_테스트_이름
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings

# 게이트 — 커밋 전에 돌립니다
./scripts/check-binding-parity.sh          # G-PARITY
./scripts/check-immutability.sh            # G-IMMUT

# 웹
cd web && npm ci && npm run dev
npm run check                              # 계약·중첩·쓰기게이트·import 4종
npm run build

# Windows (윈도우에서만)
pwsh scripts/build-windows.ps1

# Android
cd apps/android && ./gradlew assembleDebug

# iOS (맥에서만)
cd apps/ios && make bootstrap && make open
```

CI는 `.github/workflows/ci.yml`, 배포 링크는 `release.yml`이 만듭니다. main에
푸시하면 `dev` 프리릴리스의 Windows zip과 Android APK가 갱신됩니다.

### 기계 게이트

리뷰로 보이지 않는 종류의 버그만 게이트로 막습니다. 전부 실제로 당한 것에서
나왔습니다.

| 스크립트 | 막는 것 |
|-|-|
| `scripts/check-binding-parity.sh` | Kotlin·C# 바인딩이 갈라지는 것 |
| `scripts/check-immutability.sh` | 삭제 경로가 생기는 것 |
| `web/scripts/check-contract.mjs` | 웹의 한도가 코어와 어긋나는 것 |
| `web/scripts/check-nested-components.mjs` | 한글 IME가 깨지는 렌더 패턴 |
| `web/scripts/check-write-gate.mjs` | 인증 없는 쓰기 경로 |
| `web/scripts/check-client-imports.mjs` | DB 모듈이 브라우저 번들로 끌려가는 것 |
| `web/scripts/check-signing.mjs` | 서명 대상 바이트·식별자 규칙이 코어와 갈리는 것 |
| `web/scripts/check-anchor.mjs` | 앵커링 머클 형식이 코어와 갈리는 것 |
| `scripts/check-artifacts.py` | 고정한 영지식 아티팩트가 바뀌는 것 |
| `scripts/dkim-watch.py` | 허용 도메인의 DKIM 키 폐기·길이 하락 |

### 이 저장소에서 지켜야 하는 것

* **바인딩을 손으로 쓰지 않습니다.** `core/src/civicagora.udl`을 고치고 재생성합니다.
* **HTTP 전송은 각 플랫폼이 합니다.** 코어는 본문 생성과 파싱만 합니다
  (`core/src/api.rs`). 플랫폼이 각자 JSON을 조립하면 필드가 어긋나고, 그 버그는
  서버 로그에서만 보입니다.
* **서명·머클 형식과 식별자 규칙은 코어와 서버가 같아야 합니다.**
  `core/src/{signing,merkle}.rs` 와 `web/lib/{signing,merkle}.ts` 가 같은
  바이트를 만들어야 하고, `contracts/{signing,anchor}-vectors.json` 이 그것을
  양쪽에서 대조합니다. 벡터 파일은 손으로 고치지 않습니다 — 고치면 구현이
  아니라 기댓값을 맞추게 됩니다.
* **사람 단위로 세야 하는 것은 DID로 세지 않습니다.** 한 사람이 기기를 5대까지
  등록할 수 있으므로(D21), 반응·투표는 `web/lib/anon.ts` 의 익명 증명과
  nullifier 로 셉니다. DID로 세면 한 사람이 다섯 몫을 행사합니다.
* **snarkjs 는 번들하지 않습니다.** `next.config.mjs` 의 `serverExternalPackages`
  에서 빼야 합니다. 번들에 넣으면 증명 검증 한 번이 300초 걸립니다(정상 11ms).
* **검증 경로를 숨기지 않습니다.** 앵커 잎 목록과 영수증은 공개합니다.
  확인 방법을 감추면 앵커링은 또 하나의 "믿어 주세요"가 됩니다.
* **표시 규칙은 네 곳이 같아야 합니다.** 정렬·분류·균형 판정이
  `web/lib/plaza-view.ts`, `apps/windows/MainWindow.xaml.cs`,
  `apps/android/.../Plaza.kt`, `apps/ios/.../Plaza.swift`에 같은 값으로 있습니다.
  한 곳만 고치면 같은 주제가 기기마다 다르게 보입니다.
* **비밀값을 대화나 코드에 넣지 않습니다.** `/api/health`는 설정 여부만
  보고하고 값은 절대 담지 않습니다. 인증코드가 API 응답에 들어가면 남의
  이메일로 가입할 수 있게 됩니다.
* **`AUTH_SECRET`은 한 번 정하면 바꾸지 않습니다.** 바꾸면 이메일 해시의
  유일성이 깨져 같은 사람이 다시 가입할 수 있게 됩니다.

## 프로젝트 개요

CivicAgora는 진영 논리와 권위적 개입 없이 시민이 동등한 자격으로 정책을 검증하는 탈중앙 공론장입니다. 세 원칙이 서로를 제약하며, 기능 추가 시 어느 하나를 희생시키지 않는지 검토해야 합니다.

1. **무신뢰 불변성** — 중앙 서버가 검열·삭제·왜곡할 수 없습니다. 본문은 P2P에, 증명만 온체인에.
2. **진영 논리 차단** — 다수결이 아닌 *브리징*으로 순위를 매깁니다. 상반된 이념 집단 양쪽 모두에게 긍정 평가를 받은 글만 상위 노출됩니다.
3. **처벌이 아닌 유도** — AI는 차단기가 아니라 코치입니다. 사용자는 언제나 원문 게시를 택할 수 있고 대신 평판 차감과 디랭킹을 감수합니다.

## 아키텍처 (4계층)

```
계층 1  네이티브 클라이언트   Windows(WinUI 3, C#) · Android(Compose, Kotlin)
                             └ 공유 Rust 코어 civicagora-core
                               키/DID · ZK 증명(rapidsnark) · rust-libp2p · 온디바이스 톤 스크리닝
계층 2  P2P 데이터           Ceramic ComposeDB · IPFS · libp2p GossipSub
계층 3  연산 서비스          AI 톤 코칭(FastAPI+vLLM) · 브리징/Pol.is 배치 · 브리프·오픈 API
계층 4  온체인 (EVM L2)      Nullifier 레지스트리 · 상태 머클 루트 · 평판 SBT
```

**데이터 분리 원칙: 읽을 수 있는 모든 것은 오프체인, 증명할 수 있는 것만 온체인.** 실명·이메일은 시스템 어디에도 저장되지 않습니다.

**계층 3이 중앙 통제가 되지 않는 장치**: 데이터를 소유하지 않고, 모든 배치 잡이 결정론적이며(스냅샷 해시·모델 버전·시드 기록), 제3자가 재계산해 조작을 증명할 수 있고, 톤 코칭 결과에 구속력이 없습니다. 이 성질을 깨는 변경은 플랫폼의 전제를 무너뜨립니다.

## 절대 깨뜨리면 안 되는 두 가지

### 1. 브리징 불변식

`r̂(u,i) = μ + b_u + b_i + f_u · f_i`에서 **같은 진영의 몰표는 `f_u · f_i` 항이 흡수하므로 `b_i`를 올리지 못합니다.** 반대 성향 집단까지 긍정 평가해야만 `b_i`가 상승합니다. 이것이 플랫폼의 존재 이유이므로, 랭킹 관련 코드를 변경하면 **합성 몰표 데이터로 `b_i`가 상승하지 않음을 검증하는 회귀 테스트**가 필수입니다.

평판 설계도 같은 목적을 공유합니다. 교차 진영 가점(+5)이 동일 진영 가점(+1)의 5배인 것은 의도된 것이며, 이 비율 변경은 제품 성격을 바꿉니다.

### 2. 편향 게이트 (G-BIAS)

판단 모델을 바꾸면 **반사실 불변성**을 반드시 통과해야 합니다. 같은 문장에서 정당·인물 이름만 바꾼 쌍의 판단이 달라지면, 그것은 문장이 아니라 이름에 반응한 것이고 정의상 정치 편향입니다. 진영별 오류율 격차도 3%p 이내여야 합니다. 위반 시 배포가 막힙니다(`docs/11_SOVEREIGN_JUDGMENT.md` §7).

판단은 생성이 아니라 **제약 채점**으로 합니다. 샘플링이 없어야 재현이 가능하고, 재현이 가능해야 제재의 근거로 쓸 수 있습니다. 재현 불가한 엔진의 판정은 디랭킹·감점에 쓰지 않습니다.

### 3. 프라이버시 불변식 (INV-1~5)

`docs/02_IDENTITY_PRIVACY.md` §3에 전문이 있습니다. 요약하면:

* 정치 성향 입력값은 단말에만 암호화 저장되며 알고리즘 입력으로도 쓰지 않습니다.
* 개인의 잠재 성향 `f_u`는 외부로 공개하지 않습니다. **오픈 API에서 `user_latent_factor`가 제거되었습니다.** 카드 단위 `f_i`만 공개합니다.
* 누가 어떤 반응을 눌렀는지 공개하지 않습니다.
* 교차 진영 가점은 **일 1회 배치 정산**합니다. 건별 즉시 반영하면 점수 변동으로 반응자의 진영을 역추론할 수 있습니다.
* 집계 공개에 최소 인원 기준을 적용합니다(군집 20명, 안건 50명).

## 핵심 규격 요약

상세는 각 문서에 있습니다. 구현 시 수치를 문서에서 직접 확인하십시오.

| 항목 | 값 |
|-|-|
| 토론 구조 | 3열 — 찬성(SUPPORT) / 대안·합의(ALTERNATIVE) / 반대(OPPOSE) |
| 카드 입력 | 3단 구조화, 150+200+150 = 500자, 근거 URL 필수 |
| 댓글 | 자유 서술 500자, 1단계 깊이만, 반응 불가 |
| 반응 | 💡🤝 (`r=1`) / 🔍⚖️ (`r=0`) |
| 합의 배너 승격 | 모든 군집 찬성률 ≥ 0.60 |
| 대정부 브리프 수록 | 모든 군집 ≥ 0.65 **이며** 군집 간 격차 ≤ 5%p |
| 톤 코칭 | KcELECTRA(0.30 게이트) → kor_unsmile(0.65 배너) → EEVE(순화문) |
| 삭제 | **없음.** 디랭킹 → 블라인드 → 검색 제외 3단계만 |
| 신원 | ZK-Email 검증 + 변경 불가 필명. 실명·이메일 미보관 |

## 문서 지도

| 문서 | 내용 |
|-|-|
| `docs/README.md` | 색인 및 읽는 순서 |
| `docs/00_PRODUCT_SPEC.md` | 3열 구조, 입력·댓글·반응, 안건 등록, 블라인드 |
| `docs/01_ARCHITECTURE.md` | 4계층, 온/오프체인 분리, ComposeDB·Solidity 스키마 |
| `docs/02_IDENTITY_PRIVACY.md` | ZK-Email 파이프라인, 필명, 프라이버시 불변식 |
| `docs/03_ALGORITHMS_AI.md` | 브리징 MF, Pol.is, 톤 코칭 3단계 |
| `docs/04_REPUTATION_MODERATION.md` | 점수·배지·제재, 시민 배심, 중재 투명성 |
| `docs/05_CLIENT_APPS.md` | 네이티브 앱 구조, 공유 Rust 코어, 플랫폼별 제약 |
| `docs/06_GOV_BRIEF_API.md` | 대정부 브리프 양식, 연구자 오픈 API·익명화 |
| `docs/07_ROADMAP.md` | 6단계 24주 로드맵 |
| `docs/08_DECISIONS.md` | **결정 19건의 증거와 근거.** D19는 임시 결정. 미결 사항 별도 |
| `docs/09_DEVELOPMENT_PLAN.md` | **개발 작업 단위.** 38개 수직 슬라이스, 의존 그래프, 불변식 게이트 |
| `docs/10_AI_JUDGMENTS.md` | AI 판단의 구조화 결정 설계, 상용 API와의 비교 |
| `docs/11_SOVEREIGN_JUDGMENT.md` | **주권 판단 계층.** 제약 채점·정본 재현·모델 앵커링·G-BIAS |
| `docs/12_ONCHAIN_DEPENDENCIES.md` | 온체인은 대부분 기존 프로토콜로 대체. **자체 신뢰 설정 금지** |
| `docs/13_VS_C0_FINDINGS.md` | **VS-C0 결과.** ComposeDB 중단으로 데이터 계층 재선정 필요 |
| `docs/14_USER_JOURNEY.md` | 주제 등록부터 보고서 다운로드까지 전 과정 |
| `docs/15_BRIDGE_SERVER.md` | 현재 공유 서버 단계의 한계와 벗어나는 순서 |
| `docs/16_ONCHAIN_PLAN.md` | **블록체인 도입 단계·비용.** 서명 → 앵커링 → 1인1계정 → P2P |
| `docs/17_STATUS.md` | **현재 개발 상황.** 무엇이 돌고 무엇이 없는지의 실측 |

## 스택

| 영역 | 스택 | 상태 |
|-|-|-|
| 공유 코어 | Rust — rusqlite, p256, unicode-segmentation, `uniffi-rs` 0.28.3 | 사용 중 |
| Windows 앱 | WinUI 3 / Windows App SDK 1.6, C# .NET 8, 언패키지 자체 포함 | 사용 중 |
| Android 앱 | Jetpack Compose, Kotlin 2.0.21, minSdk 26, APK 직배포 | 사용 중 |
| iOS 앱 | SwiftUI, iOS 16+, Secure Enclave, XcodeGen | 뼈대만 |
| 웹 | Next.js 15 App Router + Postgres(Neon), Vercel | 사용 중 |
| P2P | libp2p, IPFS, Ceramic One | 미착수 — ComposeDB 중단으로 재선정 |
| AI 서빙 | Python FastAPI + vLLM | 미착수 |
| ZK | Circom 회로, Semaphore | 미착수 |
| 온체인 | Solidity ^0.8.24, EVM L2, Foundry | 미착수 — 체인 미선정 |

웹뷰 래퍼(Electron·Tauri)는 네이티브 요구에 부합하지 않아 제외되었습니다.
MSIX 패키징도 지금은 쓰지 않습니다 — 서명 인증서 없이 받는 사람이 설치할 수
있어야 해서 언패키지 자체 포함으로 냅니다.

**바인딩은 손으로 쓰지 마십시오.** 코어 인터페이스는 `core/src/civicagora.udl`에
한 번만 정의하고 `uniffi-rs`로 Kotlin·C#·Swift 바인딩을 생성합니다. 수작업 FFI
래퍼는 플랫폼이 어긋나는 가장 흔한 원인입니다.

C# 바인딩은 `uniffi-bindgen-cs`를 쓰며, **태그를 uniffi 버전에 맞춰 고정**합니다
(`v0.9.2+v0.28.3`). 맞추지 않으면 생성된 코드가 런타임에 터집니다.

## 구현 전 확인이 필요한 미결 사항

`docs/08_DECISIONS.md` 말미에 표로 있습니다. 해당 영역을 건드릴 때 임의로 정하지 말고 확인하십시오. 지금 열려 있는 것 중 무게가 큰 것들:

* **웹에서의 글 작성** — 임시 허용 중(D19). 브라우저에 키를 두므로 네이티브보다 약한 신원이고, 그 차이가 아직 화면에 드러나지 않습니다
* **L2 체인 선택** — VS-A4 다음 단계에서 필요
* **허용 이메일 도메인 기준** — DKIM 2048비트를 요구하면 kakao.com·assembly.go.kr이 배제됩니다
* **성향 자기 신고 수집 여부** — Phase 1 전

## 문서 편집 시 주의

`docs/` 아카이브의 마크다운은 외부 편집기 붙여넣기로 이스케이프가 깨져 있습니다(`\*`, `\#`, `&#x20;`). **아카이브는 수정하지 않습니다.** 새 문서는 `docs/`에 정상 마크다운으로 작성하고, 수식은 LaTeX(`$...$`, `$$...$$`)로 표기합니다.

## 언어

모든 문서와 제품 UI는 한국어입니다. AI 모델 선정도 한국어 정치 커뮤니티의 신조어·은어·초성 비하 탐지를 전제로 합니다. 사용자 대면 문자열, 커밋 메시지, 문서는 한국어로 작성합니다.
